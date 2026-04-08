// ╭──────────────────────────╮
// │  ingest.js               │
// │  Upload ingest and       │
// │  duplicate session flow  │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
        removeFileIfPresent(item.file.path).catch(error => {
          errorLogStamp(`Pending ingest cleanup failed for ${item.file.path}:`, error.message);
        })
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
  }) => {
    if (!pendingItems.length) {
      return null;
    }

    const sessionId = createSessionId();
    const session = {
      id: sessionId,
      fileKind,
      printerConfig,
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

    scannedItems.forEach(item => {
      const itemWithChecksum = {
        ...item,
        jobMeta: {
          ...item.jobMeta,
          ...(item.checksum ? { chksum: item.checksum } : {}),
        },
      };

      if (item.duplicateJob) {
        pendingItems.push(itemWithChecksum);
        return;
      }

      readyItems.push(itemWithChecksum);
    });

    const printedCount = await printingService.printStagedItems({
      items: readyItems,
      fileKind: fileKind === 'zip' ? 'pdf' : fileKind,
      printerConfig,
      requestBody,
    });
    const pendingSession = stagePendingDuplicates({
      pendingItems,
      fileKind: fileKind === 'zip' ? 'pdf' : fileKind,
      printerConfig,
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

    await Promise.all(declinedItems.map(item => (
      removeFileIfPresent(item.file.path).catch(error => {
        errorLogStamp(`Declined ingest cleanup failed for ${item.file.path}:`, error.message);
      })
    )));

    const printedCount = await printingService.printStagedItems({
      items: approvedReprintItems,
      fileKind: session.fileKind,
      printerConfig: session.printerConfig,
      requestBody: {},
    });

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
    processUpload,
    confirmPendingDuplicates,
  };
};

module.exports = {
  createIngestService,
};
