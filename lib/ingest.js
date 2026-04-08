// ╭──────────────────────────╮
// │  ingest.js               │
// │  Upload ingest and       │
// │  duplicate session flow  │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const yauzl = require('yauzl');

const SESSION_TTL_MS = 15 * 60 * 1000;


// ┌──────────────────────┐
// │  Path helpers        │
// └──────────────────────┘
const normalizeRelativePath = value => {
  const normalized = path.posix.normalize(`/${String(value || '').replace(/\\/g, '/')}`);
  return normalized.replace(/^\/+/, '');
};

const buildSafeExtractedPath = (baseDir, entryName) => {
  const relativePath = normalizeRelativePath(entryName)
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/');

  return path.join(baseDir, relativePath);
};

const crockfordAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastStampTick = 0n;
let lastStampCounter = 0n;

const createCrockfordStamp = () => {
  const epochMicros = BigInt(Date.now()) * 1000n;
  const hrMicros = process.hrtime.bigint() / 1000n;
  let tick = epochMicros + (hrMicros % 1000n);

  if (tick <= lastStampTick) {
    lastStampCounter += 1n;
    tick = lastStampTick + lastStampCounter;
  } else {
    lastStampTick = tick;
    lastStampCounter = 0n;
    lastStampTick = tick;
  }

  let epoch = tick;
  let out = '';

  do {
    out = crockfordAlphabet[Number(epoch % 32n)] + out;
    epoch /= 32n;
  } while (epoch > 0n);

  return out;
};

const createSessionId = () => crypto.randomBytes(12).toString('hex');
const createItemId = () => crypto.randomBytes(10).toString('hex');

const removeFileIfPresent = async filePath => {
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const removeEmptyDirectories = async (startDir, stopDir) => {
  let currentDir = startDir ? path.resolve(startDir) : '';
  const resolvedStopDir = stopDir ? path.resolve(stopDir) : '';

  while (currentDir && currentDir.startsWith(resolvedStopDir) && currentDir !== resolvedStopDir) {
    try {
      const entries = await fs.promises.readdir(currentDir);
      if (entries.length > 0) {
        return;
      }

      await fs.promises.rmdir(currentDir);
      currentDir = path.dirname(currentDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        currentDir = path.dirname(currentDir);
        continue;
      }

      if (error.code === 'ENOTEMPTY') {
        return;
      }

      throw error;
    }
  }
};

const removeStagedFile = async (filePath, uploadsDir, errorLogStamp, messagePrefix) => {
  if (!filePath) return;

  try {
    await removeFileIfPresent(filePath);
    await removeEmptyDirectories(path.dirname(filePath), uploadsDir);
  } catch (error) {
    errorLogStamp(`${messagePrefix} ${filePath}:`, error.message);
  }
};

const getUploadsStagingDir = uploadsDir => path.join(uploadsDir, 'staging');

const isStagedUploadPath = (filePath, uploadsDir) => {
  const stagingDir = path.resolve(getUploadsStagingDir(uploadsDir));
  const resolvedFilePath = path.resolve(filePath || '');
  return resolvedFilePath.startsWith(`${stagingDir}${path.sep}`);
};

const moveItemIntoPrinterFolder = async ({ item, printerId, uploadsDir }) => {
  const originalPath = item?.file?.path;

  if (!originalPath || !isStagedUploadPath(originalPath, uploadsDir)) {
    return item;
  }

  const stagingDir = path.resolve(getUploadsStagingDir(uploadsDir));
  const relativePath = path.relative(stagingDir, path.resolve(originalPath));
  const pathSegments = relativePath.split(path.sep).filter(Boolean);
  const targetPath = path.join(uploadsDir, printerId, ...pathSegments);

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.rename(originalPath, targetPath);
  await removeEmptyDirectories(path.dirname(originalPath), stagingDir);

  return {
    ...item,
    file: {
      ...item.file,
      path: targetPath,
      filename: path.basename(targetPath),
    },
    jobMeta: {
      ...item.jobMeta,
      storedFilename: path.basename(targetPath),
      ...(item.jobMeta?.checksumFilePath === originalPath
        ? { checksumFilePath: targetPath }
        : {}),
    },
  };
};

const getUploadStageDir = req => {
  if (!req.printifyUploadStageDir) {
    req.printifyUploadStageDir = createCrockfordStamp();
  }

  return req.printifyUploadStageDir;
};

// ┌──────────────────────┐
// │  Ingest service      │
// └──────────────────────┘
const createIngestService = ({
  uploadsDir,
  printingService,
  deduplicator,
  logStamp,
  errorLogStamp,
}) => {
  const pendingSessions = new Map();
  const uploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const stageDir = getUploadStageDir(req);
      const destinationDir = path.join(getUploadsStagingDir(uploadsDir), stageDir);

      fs.mkdirSync(destinationDir, { recursive: true });
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => {
      cb(null, path.basename(file.originalname));
    },
  });
  const upload = multer({ storage: uploadStorage });

  const scheduleSessionExpiry = sessionId => {
    const session = pendingSessions.get(sessionId);

    if (!session) {
      return;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    session.timeout = setTimeout(async () => {
      const expiringSession = pendingSessions.get(sessionId);
      if (!expiringSession) {
        return;
      }

      pendingSessions.delete(sessionId);

      await Promise.all(expiringSession.items.map(item => (
        removeStagedFile(
          item.file.path,
          uploadsDir,
          errorLogStamp,
          'Pending ingest cleanup failed for'
        )
      )));
    }, SESSION_TTL_MS);
  };

  const clearSessionTimeout = session => {
    if (session?.timeout) {
      clearTimeout(session.timeout);
      session.timeout = null;
    }
  };

  const createJobMeta = ({
    requestPath,
    file,
    sourceType,
    extra = {},
  }) => ({
    originalFilename: file.originalname,
    storedFilename: file.filename,
    sourceRoute: requestPath,
    sourceType,
    ...extra,
  });

  const extractZipEntries = async ({
    zipFile,
    printerId,
    requestPath,
  }) => {
    const zipBaseName = path.parse(zipFile.filename).name;
    const extractionDir = path.join(uploadsDir, printerId, 'extracted', `${Date.now()}-${zipBaseName}`);
    const extractedEntries = [];

    await fs.promises.mkdir(extractionDir, { recursive: true });

    await new Promise((resolve, reject) => {
      yauzl.open(zipFile.path, { lazyEntries: true }, (openError, zipHandle) => {
        if (openError) {
          reject(openError);
          return;
        }

        zipHandle.readEntry();

        zipHandle.on('entry', entry => {
          if (/\/$/.test(entry.fileName)) {
            zipHandle.readEntry();
            return;
          }

          if (path.extname(entry.fileName).toLowerCase() !== '.pdf') {
            zipHandle.readEntry();
            return;
          }

          const extractedPath = buildSafeExtractedPath(extractionDir, entry.fileName);

          zipHandle.openReadStream(entry, (streamError, readStream) => {
            if (streamError) {
              reject(streamError);
              return;
            }

            fs.mkdirSync(path.dirname(extractedPath), { recursive: true });
            const writeStream = fs.createWriteStream(extractedPath);
            readStream.pipe(writeStream);

            writeStream.on('close', () => {
              extractedEntries.push({
                file: {
                  path: extractedPath,
                  filename: path.basename(extractedPath),
                  originalname: entry.fileName,
                },
                jobMeta: createJobMeta({
                  requestPath,
                  file: {
                    filename: path.basename(extractedPath),
                    originalname: entry.fileName,
                  },
                  sourceType: 'upload-zip-pdf',
                  extra: {
                    checksumFilePath: extractedPath,
                    sourceArchiveName: zipFile.originalname,
                  },
                }),
              });
              zipHandle.readEntry();
            });

            writeStream.on('error', reject);
            readStream.on('error', reject);
          });
        });

        zipHandle.on('end', resolve);
        zipHandle.on('error', reject);
      });
    });

    await removeFileIfPresent(zipFile.path);
    return extractedEntries;
  };

  const buildUploadItems = async ({
    requestPath,
    printerId,
    fileKind,
    uploadedFiles,
    uploadedJobMetaList,
  }) => {
    if (fileKind === 'zip') {
      const extractedGroups = await Promise.all(uploadedFiles.map(file => (
        extractZipEntries({
          zipFile: file,
          printerId,
          requestPath,
        })
      )));

      return extractedGroups.flat();
    }

    const sourceType = fileKind === 'pdf' ? 'upload-pdf' : 'upload-image';

    return uploadedFiles.map((file, index) => ({
      file,
      jobMeta: createJobMeta({
        requestPath,
        file,
        sourceType,
        extra: {
          ...(uploadedJobMetaList[index] || {}),
          ...(fileKind === 'image' ? { checksumFilePath: file.path } : {}),
        },
      }),
    }));
  };

  const enrichItemsWithDuplicateChecks = async ({ items, printerConfig }) => {
    return Promise.all(items.map(async item => {
      const checksumFilePath = item.jobMeta.checksumFilePath || item.file.path;
      const checksum = checksumFilePath
        ? await printingService.createFileChecksum(checksumFilePath)
        : null;
      const duplicateJob = checksum
        ? await deduplicator.findRecentDuplicate({
          chksum: checksum,
          printerId: printerConfig.id,
        })
        : null;

      return {
        ...item,
        checksum,
        duplicateJob,
      };
    }));
  };

  const markItemsAsReprints = items => items.map(item => ({
    ...item,
    jobMeta: {
      ...item.jobMeta,
      isReprint: true,
      reprintSourceTimestamp: item.duplicateJob?.timestamp || null,
    },
  }));

  const cleanupDuplicateItems = items => (
    Promise.all(items.map(item => (
      removeStagedFile(
        item?.file?.path,
        uploadsDir,
        errorLogStamp,
        'Duplicate upload cleanup failed for'
      )
    )))
  );

  const canReuseDuplicateSource = item => (
    Boolean(item?.duplicateJob?.filePath) && fs.existsSync(item.duplicateJob.filePath)
  );

  const buildDuplicatePayload = ({ item, printerConfig }) => ({
    id: item.id,
    checksum: item.checksum || null,
    originalFilename: item.jobMeta.originalFilename || item.file.originalname,
    printerId: printerConfig.id,
    duplicateTimestamp: item.duplicateJob?.timestamp || null,
    duplicatePrinterName: item.duplicateJob?.printerName || printerConfig.driverName || null,
    sourceType: item.jobMeta.sourceType || null,
  });

  const stagePendingDuplicates = ({
    pendingItems,
    fileKind,
    printerConfig,
    requestBody = {},
  }) => {
    if (!pendingItems.length) {
      return null;
    }

    const sessionId = createSessionId();
    const session = {
      id: sessionId,
      fileKind,
      printerConfig,
      requestBody,
      items: pendingItems.map(item => ({
        ...item,
        id: createItemId(),
      })),
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
      timeout: null,
    };

    pendingSessions.set(sessionId, session);
    scheduleSessionExpiry(sessionId);

    return {
      sessionId,
      duplicates: session.items.map(item => buildDuplicatePayload({ item, printerConfig })),
    };
  };

  const processUpload = async ({
    requestPath,
    printerConfig,
    fileKind,
    uploadedFiles,
    uploadedJobMetaList = [],
    requestBody = {},
  }) => {
    const uploadItems = await buildUploadItems({
      requestPath,
      printerId: printerConfig.id,
      fileKind,
      uploadedFiles,
      uploadedJobMetaList,
    });
    const scannedItems = await enrichItemsWithDuplicateChecks({
      items: uploadItems,
      printerConfig,
    });
    const readyItems = [];
    const pendingItems = [];

    await Promise.all(scannedItems.map(async item => {
      const itemWithChecksum = {
        ...item,
        jobMeta: {
          ...item.jobMeta,
          ...(item.checksum ? { chksum: item.checksum } : {}),
        },
      };

      if (item.duplicateJob) {
        if (canReuseDuplicateSource(itemWithChecksum)) {
          await removeStagedFile(
            itemWithChecksum.file.path,
            uploadsDir,
            errorLogStamp,
            'Duplicate upload cleanup failed for'
          );
        }
        pendingItems.push(itemWithChecksum);
        return;
      }

      readyItems.push(itemWithChecksum);
    }));

    const sortedReadyItems = await Promise.all(readyItems.map(item => (
      moveItemIntoPrinterFolder({
        item,
        printerId: printerConfig.id,
        uploadsDir,
      })
    )));
    const sortedPendingItems = pendingItems;

    const printedCount = await printingService.printStagedItems({
      items: sortedReadyItems,
      fileKind: fileKind === 'zip' ? 'pdf' : fileKind,
      printerConfig,
      requestBody,
    });
    const pendingSession = stagePendingDuplicates({
      pendingItems: sortedPendingItems,
      fileKind: fileKind === 'zip' ? 'pdf' : fileKind,
      printerConfig,
      requestBody,
    });

    return {
      ok: true,
      printedCount,
      skippedCount: 0,
      skippedDuplicates: [],
      ...(pendingSession ? {
        needsConfirmation: true,
        sessionId: pendingSession.sessionId,
        duplicates: pendingSession.duplicates,
      } : {}),
    };
  };

  const confirmPendingDuplicates = async ({
    sessionId,
    approvedItemIds = [],
  }) => {
    const session = pendingSessions.get(sessionId);

    if (!session) {
      const error = new Error('Pending ingest session not found');
      error.code = 'SESSION_NOT_FOUND';
      throw error;
    }

    clearSessionTimeout(session);
    pendingSessions.delete(sessionId);

    const approvedItemIdSet = new Set(approvedItemIds.map(value => String(value)));
    const approvedItems = session.items.filter(item => approvedItemIdSet.has(item.id));
    const declinedItems = session.items.filter(item => !approvedItemIdSet.has(item.id));
    const approvedReprintItems = markItemsAsReprints(approvedItems);
    const reusableApprovedItems = approvedReprintItems.filter(canReuseDuplicateSource);
    const stagedApprovedItems = await Promise.all(
      approvedReprintItems
        .filter(item => !canReuseDuplicateSource(item))
        .map(item => moveItemIntoPrinterFolder({
          item,
          printerId: session.printerConfig.id,
          uploadsDir,
        }))
    );

    await Promise.all(declinedItems.map(item => (
      removeStagedFile(
        item.file.path,
        uploadsDir,
        errorLogStamp,
        'Declined ingest cleanup failed for'
      )
    )));

    const reuseResults = await Promise.all(reusableApprovedItems.map(item => (
      printingService.reprintLoggedJob({
        printJob: item.duplicateJob,
        printerConfig: session.printerConfig,
        fileKind: session.fileKind,
        requestBody: session.requestBody || {},
        sourceRoute: '/ingest/confirm',
      })
    )));
    const stagedPrintedCount = await printingService.printStagedItems({
      items: stagedApprovedItems,
      fileKind: session.fileKind,
      printerConfig: session.printerConfig,
      requestBody: session.requestBody || {},
    });
    await cleanupDuplicateItems(stagedApprovedItems);
    const printedCount = reuseResults.reduce((total, count) => total + Number(count || 0), 0) + stagedPrintedCount;

    return {
      ok: true,
      printedCount,
      skippedCount: declinedItems.length,
      skippedDuplicates: declinedItems.map(item => ({
        checksum: item.checksum || null,
        originalFilename: item.jobMeta.originalFilename || item.file.originalname,
        printerId: session.printerConfig.id,
      })),
    };
  };

  return {
    createUploadMiddleware: ({ fieldName, isMulti }) => (
      isMulti ? upload.array(fieldName) : upload.single(fieldName)
    ),
    processUpload,
    confirmPendingDuplicates,
  };
};

module.exports = {
  createIngestService,
};
