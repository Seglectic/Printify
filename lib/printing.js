// ╭──────────────────────────╮
// │  printing.js             │
// │  Print job prep and      │
// │  dispatch helpers for    │
// │  files sent to printers  │
// ╰──────────────────────────╯
const fs                        = require('fs');
const path                      = require('path');
const pdfToPrinter              = require('pdf-to-printer');
const { PDFDocument }           = require('pdf-lib');
const { execFile, spawn }       = require('child_process');


// ┌──────────────────────┐
// │  Printing service    │
// └──────────────────────┘
const createPrintingService = ({
  testing,
  serverSave,
  logStore,
  deduplicator,
  createFileChecksum,
  createJobLogEntry,
  logStamp,
  errorLogStamp,
  converter,
  previewer,
}) => {
  const formatPrinterTarget = printerConfig => (
    printerConfig?.displayName
    || printerConfig?.driverName
    || printerConfig?.id
    || printerConfig?.cliCommand
    || 'unknown-printer'
  );

  const createPrinterConfig = (printerId, printerConfig) => ({
    id: printerId,
    ...printerConfig,
  });

  const resolvePlatformPrinterConfig = printerConfig => {
    return {
      ...printerConfig,
      printMode: printerConfig.printMode === 'cli'
        ? 'cli'
        : (process.platform === 'linux' ? 'lp' : 'pdfToPrinter'),
    };
  };

  const resolvePrintArgs = (jobMetaOrCallback, callback) => {
    if (typeof jobMetaOrCallback === 'function') {
      return {
        done: jobMetaOrCallback,
        jobMeta: {},
      };
    }

    return {
      done: typeof callback === 'function' ? callback : () => {},
      jobMeta: jobMetaOrCallback || {},
    };
  };

  const buildBundledPdfPath = (sourceFilePath, printerConfig) => (
    path.join(
      path.dirname(sourceFilePath),
      `${Date.now()}-${path.parse(sourceFilePath).name}-${printerConfig.id || 'printer'}-bundle.pdf`
    )
  );

  const formatCopiedJobName = (fileName, copyCount) => {
    if (!fileName || copyCount <= 1) {
      return fileName || null;
    }

    const parsedPath = path.parse(fileName);
    return `${parsedPath.name} x${copyCount}${parsedPath.ext}`;
  };

  // Keep PDF copy bundling in-process so reprints behave the same way across
  // platforms and produce an auditable artifact beside the source file.
  const createBundledPdfCopy = async ({ sourceFilePath, outputPdfPath, copyCount }) => {
    const sourceBuffer = await fs.promises.readFile(sourceFilePath);
    const sourceDocument = await PDFDocument.load(sourceBuffer);
    const bundledDocument = await PDFDocument.create();
    const sourcePageIndexes = sourceDocument.getPageIndices();

    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      const copiedPages = await bundledDocument.copyPages(sourceDocument, sourcePageIndexes);
      copiedPages.forEach(page => {
        bundledDocument.addPage(page);
      });
    }

    const bundledBytes = await bundledDocument.save();
    await fs.promises.writeFile(outputPdfPath, bundledBytes);
    return outputPdfPath;
  };

  const getRequestedCopies = requestBody => {
    const requestedCopies = parseInt(requestBody?.printCount || requestBody?.copyCount, 10);
    return Number.isFinite(requestedCopies) && requestedCopies > 0
      ? Math.min(requestedCopies, 50)
      : 1;
  };

  const printPdfWithCopies = async ({
    filePath,
    printerConfig,
    copyCount = 1,
    jobMeta = {},
    bundledSourceType = 'upload-pdf-bundled',
  }) => {
    const normalizedCopyCount = Number.isFinite(copyCount) && copyCount > 0
      ? Math.min(copyCount, 50)
      : 1;
    const shouldBundleCopies = Boolean(
      printerConfig?.bundleCopies
      && normalizedCopyCount > 1
      && String(filePath || '').toLowerCase().endsWith('.pdf')
    );

    if (shouldBundleCopies) {
      const bundledPdfPath = buildBundledPdfPath(filePath, printerConfig);

      await createBundledPdfCopy({
        sourceFilePath: filePath,
        outputPdfPath: bundledPdfPath,
        copyCount: normalizedCopyCount,
      });

      await printPDF(bundledPdfPath, printerConfig, {
        ...jobMeta,
        originalFilename: formatCopiedJobName(
          jobMeta.originalFilename || path.basename(filePath),
          normalizedCopyCount
        ),
        storedFilename: path.basename(bundledPdfPath),
        sourceType: bundledSourceType,
        totalCopies: normalizedCopyCount,
        bundledSourceCount: normalizedCopyCount,
      });

      return 1;
    }

    await Promise.all(Array.from({ length: normalizedCopyCount }, (_, index) => (
      printPDF(filePath, printerConfig, {
        ...jobMeta,
        originalFilename: formatCopiedJobName(
          jobMeta.originalFilename || path.basename(filePath),
          normalizedCopyCount
        ),
        storedFilename: jobMeta.storedFilename || path.basename(filePath),
        copyIndex: normalizedCopyCount > 1 ? index + 1 : null,
        totalCopies: normalizedCopyCount > 1 ? normalizedCopyCount : null,
      })
    )));

    return 1;
  };

  const reprintLoggedJob = async ({
    printJob,
    printerConfig,
    fileKind,
    requestBody = {},
    sourceRoute = '/logs/reprint',
  }) => {
    if (!printJob?.filePath || !fs.existsSync(printJob.filePath)) {
      throw new Error('Source file is no longer available');
    }

    const copyCount = getRequestedCopies(requestBody);

    if (String(printJob.filePath || '').toLowerCase().endsWith('.pdf')) {
      return printPdfWithCopies({
        filePath: printJob.filePath,
        printerConfig,
        copyCount,
        bundledSourceType: 'log-reprint-bundled',
        jobMeta: {
          originalFilename: printJob.originalFilename || path.basename(printJob.filePath),
          storedFilename: printJob.storedFilename || path.basename(printJob.filePath),
          sourceRoute,
          sourceType: 'log-reprint',
          chksum: printJob.chksum || null,
          isReprint: true,
          reprintSourceTimestamp: printJob.timestamp || null,
        },
      });
    }

    await Promise.all(Array.from({ length: copyCount }, (_, index) => (
      printPDF(printJob.filePath, printerConfig, {
        originalFilename: formatCopiedJobName(
          printJob.originalFilename || path.basename(printJob.filePath),
          copyCount
        ),
        storedFilename: printJob.storedFilename || path.basename(printJob.filePath),
        sourceRoute,
        sourceType: 'log-reprint',
        chksum: printJob.chksum || null,
        isReprint: true,
        reprintSourceTimestamp: printJob.timestamp || null,
        copyIndex: copyCount > 1 ? index + 1 : null,
        totalCopies: copyCount > 1 ? copyCount : null,
      })
    )));

    return 1;
  };

  // Shared success/failure bookkeeping so each transport logs the same way.
  const recordPrintJob = async (filePath, printerConfig, result, jobMeta = {}, extra = {}) => {
    let chksum = extra.chksum ?? jobMeta.chksum ?? null;
    let fileSizeBytes = extra.fileSizeBytes ?? jobMeta.fileSizeBytes ?? null;
    const checksumFilePath = jobMeta.checksumFilePath || filePath;

    if (!chksum) {
      try {
        chksum = await createFileChecksum(checksumFilePath);
      } catch (error) {
        errorLogStamp('Checksum failed:', error.message);
      }
    }

    if (!Number.isFinite(fileSizeBytes) && filePath) {
      try {
        const fileStat = await fs.promises.stat(filePath);
        fileSizeBytes = fileStat.size;
      } catch (error) {
        errorLogStamp('File size lookup failed:', error.message);
      }
    }

    if (previewer && chksum) {
      await previewer.ensurePreviewForJob({
        checksum: chksum,
        sourceFilePath: checksumFilePath,
        sourceType: jobMeta.sourceType,
        bundledSourceCount: extra.bundledSourceCount ?? jobMeta.bundledSourceCount ?? null,
      });
    }

    const printJob = createJobLogEntry({
      filePath,
      printerConfig,
      testing,
      result,
      fileSizeBytes,
      chksum,
      ...jobMeta,
      ...extra,
    });

    try {
      await logStore.addPrintJob(printJob);
    } catch (error) {
      errorLogStamp('Print job log append failed:', error.message);
    }

    if (deduplicator) {
      try {
        await deduplicator.addPrintJob(printJob);
      } catch (error) {
        errorLogStamp('Checksum index append failed:', error.message);
      }
    }

    serverSave.addPrintJob(printJob);
    return printJob;
  };

  const finishPrint = async (filePath, printerConfig, jobMeta, transportResponse) => {
    logStamp('Printing file:', filePath, `to printer: ${formatPrinterTarget(printerConfig)}`);
    serverSave.incrementPrintCounter();
    await recordPrintJob(filePath, printerConfig, 'printed', jobMeta, { transportResponse });
  };

  const runPdfToPrinter = (filePath, printerConfig, done) => (
    pdfToPrinter.print(filePath, {
      printer: printerConfig.driverName,
      scale: 'fit',
      landscape: false,
    })
      .then(jobId => {
        done(null, jobId);
        return jobId;
      })
      .catch(error => {
        errorLogStamp('Printing failed:', error);
        done(error);
        throw error;
      })
  );

  const runUnixPrint = (filePath, printerConfig, done) => {
    const args = [];
    if (printerConfig.driverName) {
      args.push('-d', printerConfig.driverName);
    }
    args.push(filePath);

    return new Promise((resolve, reject) => {
      execFile('lp', args, (error, stdout, stderr) => {
        if (error) {
          errorLogStamp('Printing failed:', stderr || error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };

  const runCliPrint = (filePath, printerConfig, done) => {
    const cliCommand = printerConfig.cliCommand;
    const cliArgs = (printerConfig.cliArgs || []).map(arg => (
      arg
        .replace('{file}', filePath)
    ));

    if (!cliCommand) {
      const error = new Error('CLI printMode requires cliCommand');
      done(error);
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(cliCommand, cliArgs, { stdio: 'pipe' });
      let stderr = '';
      let stdout = '';

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('error', error => {
        done(error);
        reject(error);
      });

      child.on('close', code => {
        if (code !== 0) {
          const error = new Error(stderr || `CLI print failed with code ${code}`);
          errorLogStamp('Printing failed:', error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };

  const printPdfItems = async ({ items, printerConfig, printCopies }) => {
    await Promise.all(items.map(item => (
      printPdfWithCopies({
        filePath: item.file.path,
        printerConfig,
        copyCount: printCopies,
        bundledSourceType: 'upload-pdf-bundled',
        jobMeta: {
          ...item.jobMeta,
          chksum: item.checksum || item.jobMeta.chksum || null,
        },
      })
    )));

    return items.length;
  };

  const printImageItems = async ({ items, printerConfig, printCopies }) => {
    if (!items.length) {
      return 0;
    }

    if (printCopies > 1) {
      if (items.length === 1) {
        logStamp(`Printing ${printCopies} labels`);
      } else {
        logStamp(`Printing ${items.length} image files with ${printCopies} copies each`);
      }
    }

    if (printerConfig.bundleCopies && (items.length > 1 || printCopies > 1)) {
      const bundledFiles = items.flatMap(({ file }) => (
        Array.from({ length: printCopies }, () => file.path)
      ));
      const primaryItem = items[0];

      await converter
        .convertImgsToPdf(bundledFiles, printerConfig, buildBundledPdfPath(primaryItem.file.path, printerConfig))
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...primaryItem.jobMeta,
          originalFilename: items.length === 1
            ? `${primaryItem.file.originalname} x${printCopies}`
            : `${items.length} image files bundled`,
          checksumFilePath: primaryItem.file.path,
          sourceType: 'upload-image-bundled',
          totalCopies: printCopies > 1 ? printCopies : null,
          bundledSourceCount: bundledFiles.length,
          chksum: primaryItem.checksum || primaryItem.jobMeta.chksum || null,
          storedFilename: path.basename(outputPdfPath),
        }));

      return items.length;
    }

    await Promise.all(items.flatMap(item => (
      Array.from({ length: printCopies }, (_, index) => (
        converter
          .convertImgToPdf(item.file.path, printerConfig, undefined)
          .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
            ...item.jobMeta,
            chksum: item.checksum || item.jobMeta.chksum || null,
            copyIndex: printCopies > 1 ? index + 1 : null,
            totalCopies: printCopies > 1 ? printCopies : null,
            storedFilename: path.basename(outputPdfPath),
          }))
      ))
    )));

    return items.length;
  };

  const printStagedItems = async ({
    items,
    fileKind,
    printerConfig,
    requestBody = {},
  }) => {
    if (!items.length) {
      return 0;
    }

    if (fileKind === 'image') {
      return printImageItems({
        items,
        printerConfig,
        printCopies: getRequestedCopies(requestBody),
      });
    }

    return printPdfItems({
      items,
      printerConfig,
      printCopies: getRequestedCopies(requestBody),
    });
  };


  // ┌─────────────────┐
  // │  Print a PDF    │
  // └─────────────────┘
  const printPDF = (filePath, printerConfig, jobMetaOrCallback, callback) => {
    const { done, jobMeta } = resolvePrintArgs(jobMetaOrCallback, callback);
    const platformPrinterConfig = resolvePlatformPrinterConfig(printerConfig);
    const requiresDriverName = platformPrinterConfig?.printMode !== 'cli';

    if (!platformPrinterConfig || (requiresDriverName && !platformPrinterConfig.driverName)) {
      const error = new Error('printPDF requires a printer object with a driverName for driver printing');
      done(error);
      return Promise.reject(error);
    }

    if (testing) {
      logStamp('Testing mode: skipped printing', filePath, `to printer: ${formatPrinterTarget(platformPrinterConfig)}`);
      serverSave.incrementPrintCounter();
      return recordPrintJob(filePath, platformPrinterConfig, 'skipped-testing', jobMeta)
        .then(() => done(null));
    }

    let printPromise;

    switch (platformPrinterConfig.printMode) {
      case 'pdfToPrinter':
        printPromise = runPdfToPrinter(filePath, platformPrinterConfig, done);
        break;
      case 'unixPrint':
      case 'lp':
        printPromise = runUnixPrint(filePath, platformPrinterConfig, done);
        break;
      case 'cli':
        printPromise = runCliPrint(filePath, platformPrinterConfig, done);
        break;
      default: {
        const error = new Error(`Unsupported printMode: ${platformPrinterConfig.printMode}`);
        done(error);
        return Promise.reject(error);
      }
    }

    return printPromise
      .then(async result => {
        await finishPrint(filePath, platformPrinterConfig, jobMeta, result);
        return result;
      })
      .catch(async error => {
        await recordPrintJob(filePath, platformPrinterConfig, 'failed', jobMeta, { error });
        throw error;
      });
  };
  // ┌──────────────────────┐
  // │  Print label text    │
  // └──────────────────────┘
  const printLabelText = async (tapeSize, labelText) => {
    void spawn;
    throw new Error(`Label printing is not implemented for ${tapeSize}mm tape: ${labelText}`);
  };

    return {
      createFileChecksum,
      createPrinterConfig,
      printStagedItems,
      reprintLoggedJob,
      convertImgsToPdf: (imgFilePaths, printerConfig, pdfFilePath, jobMeta = {}) => (
      converter
        .convertImgsToPdf(imgFilePaths, printerConfig, pdfFilePath)
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...jobMeta,
          storedFilename: path.basename(outputPdfPath),
        }))
    ),
    convertImgToPdf: (imgFilePath, printerConfig, pdfFilePath, jobMeta = {}) => (
      converter
        .convertImgToPdf(imgFilePath, printerConfig, pdfFilePath)
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...jobMeta,
          storedFilename: path.basename(outputPdfPath),
        }))
    ),
    printBundledImages: (imgFilePaths, printerConfig, jobMeta = {}) => (
      converter
        .convertImgsToPdf(imgFilePaths, printerConfig, buildBundledPdfPath(imgFilePaths[0], printerConfig))
        .then(outputPdfPath => printPDF(outputPdfPath, printerConfig, {
          ...jobMeta,
          bundledSourceCount: imgFilePaths.length,
          storedFilename: path.basename(outputPdfPath),
        }))
    ),
    printLabelText,
    printPDF,
  };
};

module.exports = {
  createPrintingService,
};
