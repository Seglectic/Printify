// ╭──────────────────────────╮
// │  routes.js               │
// │  Dynamic Express router  │
// │  for static pages, file  │
// │  uploads, and server     │
// │  metadata endpoints      │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const { buildPrinterIconResolver } = require('./icons');
const { compactObject } = require('./logger');

const fileKindConfig = {
  pdf: {
    fieldName: 'pdfFile',
    sourceType: 'upload-pdf',
  },
  image: {
    fieldName: 'imgFile',
    sourceType: 'upload-image',
  },
  zip: {
    fieldName: 'zipFile',
    sourceType: 'upload-zip',
  },
};


// ┌────────────────────┐
// │  Route registrar   │
// └────────────────────┘
const registerRoutes = ({
  app,
  rootDir,
  upload,
  printers,
  printingService,
  previewer,
  serverSave,
  version,
  errorLogStamp,
  logStamp,
}) => {
  const printerIconResolver = buildPrinterIconResolver(path.join(rootDir, 'icons'));
  const printerRegistry = Object.fromEntries(
    Object.entries(printers).map(([printerId, printerConfig]) => (
      [printerId, printingService.createPrinterConfig(printerId, printerConfig)]
    ))
  );

  const buildJobMeta = (req, file, sourceType, extra = {}) => ({
    originalFilename: file.originalname,
    storedFilename: file.filename,
    sourceRoute: req.path,
    sourceType,
    ...extra,
  });

  const formatPrinterLabel = printerConfig => (
    printerConfig.displayName || printerConfig.driverName || printerConfig.id
  );

  const findLoggedJob = ({ timestamp, printerId, chksum }) => {
    const { printJobs = [] } = serverSave.getData();

    return printJobs.find(job => (
      job
      && job.timestamp === timestamp
      && job.printerId === printerId
      && job.chksum === chksum
    )) || null;
  };

  // Keep the upload contract consistent across printers so routes can be
  // inferred from config instead of handwritten one by one.
  const printUploadedFile = (req, file, printerConfig, fileKind, extraJobMeta = {}) => {
    const kindConfig = fileKindConfig[fileKind];
    const jobMeta = buildJobMeta(req, file, kindConfig.sourceType, extraJobMeta);

    switch (fileKind) {
      case 'pdf':
        return printingService.printPDF(file.path, printerConfig, jobMeta);
      case 'image':
        return printingService.convertImgToPdf(file.path, printerConfig, undefined, {
          ...jobMeta,
          checksumFilePath: file.path,
        });
      case 'zip':
        return printingService.extractZip(file.path, printerConfig, {
          ...jobMeta,
          checksumFilePath: file.path,
          sourceArchiveName: file.originalname,
        });
      default:
        return Promise.reject(new Error(`Unsupported file kind: ${fileKind}`));
    }
  };

  // Dymo already relies on printCount for image uploads, so route generation
  // preserves that option instead of making the dynamic routes less capable.
  const getRequestedCopies = req => {
    const requestedCopies = parseInt(req.body.printCount || req.body.copyCount, 10);
    return Number.isFinite(requestedCopies) && requestedCopies > 0 ? requestedCopies : 1;
  };

  // Some label printers handle repeated artwork better when the server bundles
  // copies into one multi-page PDF instead of firing separate print jobs.
  const printUploadedImages = (req, uploadedFiles, printerConfig, printCopies) => {
    if (printerConfig.bundleImageCopies && (uploadedFiles.length > 1 || printCopies > 1)) {
      const bundledFiles = uploadedFiles.flatMap(file => (
        Array.from({ length: printCopies }, () => file.path)
      ));

      return printingService.printBundledImages(bundledFiles, printerConfig, {
        originalFilename: uploadedFiles.length === 1
          ? `${uploadedFiles[0].originalname} x${printCopies}`
          : `${uploadedFiles.length} image files bundled`,
        checksumFilePath: uploadedFiles[0].path,
        sourceRoute: req.path,
        sourceType: 'upload-image-bundled',
        totalCopies: printCopies > 1 ? printCopies : null,
      });
    }

    const jobs = uploadedFiles.flatMap(file => Array.from({ length: printCopies }, (_, index) => ({
      file,
      copyIndex: printCopies > 1 ? index + 1 : null,
      totalCopies: printCopies > 1 ? printCopies : null,
    })));

    return Promise.all(jobs.map(({ file, copyIndex, totalCopies }) => printUploadedFile(
      req,
      file,
      printerConfig,
      'image',
      {
        copyIndex,
        totalCopies,
      }
    )));
  };

  const registerPrinterUploadRoute = (printerId, printerConfig, fileKind, mode) => {
    const kindConfig = fileKindConfig[fileKind];
    const isMulti = mode === 'multi';
    const routePath = `/${printerId}/${fileKind}${isMulti ? '/multi' : ''}`;
    const middleware = isMulti
      ? upload.array(kindConfig.fieldName)
      : upload.single(kindConfig.fieldName);

    app.post(routePath, middleware, async (req, res) => {
      const uploadedFiles = isMulti ? (req.files || []) : (req.file ? [req.file] : []);

      if (!uploadedFiles.length) {
        res.status(400).send('Missing upload');
        return;
      }

      try {
        const printCopies = fileKind === 'image' ? getRequestedCopies(req) : 1;

        if (fileKind === 'image' && printCopies > 1) {
          if (uploadedFiles.length === 1) {
            logStamp(`Printing ${printCopies} labels`);
          } else {
            logStamp(`Printing ${uploadedFiles.length} image files with ${printCopies} copies each`);
          }
        }

        if (fileKind === 'image') {
          await printUploadedImages(req, uploadedFiles, printerConfig, printCopies);
        } else {
          await Promise.all(uploadedFiles.map(file => printUploadedFile(
            req,
            file,
            printerConfig,
            fileKind
          )));
        }

        res.status(200).send('OK');
      } catch (error) {
        errorLogStamp(`Upload route failed for ${routePath}:`, error.message);
        res.status(500).send('Print failed');
      }
    });
  };

  // ┌──────────────────┐
  // │  Static files    │
  // └──────────────────┘
  app.get('/files/:fileName', (req, res) => {
    const filePath = path.join(rootDir, req.params.fileName);

    res.sendFile(filePath, err => {
      if (err) {
        errorLogStamp(`Error sending file: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });

  app.get('/printers', (req, res) => {
    const printerList = Object.entries(printerRegistry).map(([printerId, printerConfig]) => ({
      id: printerId,
      displayName: formatPrinterLabel(printerConfig),
      driverName: printerConfig.driverName,
      printMode: printerConfig.printMode || null,
      acceptedKinds: printerConfig.acceptedKinds || [],
      iconUrl: printerIconResolver.getPrinterIconUrl(printerId, printerConfig),
      labelBuilder: Boolean(printerConfig.labelBuilder),
      bundleImageCopies: Boolean(printerConfig.bundleImageCopies),
      pxSize: printerConfig.pxSize || null,
      density: printerConfig.density || null,
    }));

    res.status(200).json({
      printers: printerList,
    });
  });

  app.get('/', (req, res) => {
    const indexPagePath = path.join(rootDir, 'src', 'pages', 'index.html');

    res.sendFile(indexPagePath, err => {
      if (err) {
        errorLogStamp(`Error sending index page: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });

  // ┌─────────────────────┐
  // │  Printer routes     │
  // └─────────────────────┘
  Object.entries(printerRegistry).forEach(([printerId, printerConfig]) => {
    (printerConfig.acceptedKinds || []).forEach(fileKind => {
      registerPrinterUploadRoute(printerId, printerConfig, fileKind, 'single');
      registerPrinterUploadRoute(printerId, printerConfig, fileKind, 'multi');
    });
  });


  // ┌────────────────────────┐
  // │  Label-maker routes    │
  // └────────────────────────┘
  app.post('/labelmake', async (req, res) => {
    const tapeSize = parseInt(req.body.tapeSize || req.body.tapesize, 10);
    const labelText = (req.body.text || '').toString().replace(/\s+/g, ' ').trim();

    if (!labelText) {
      res.status(400).send('Missing label text');
      return;
    }

    if (![12, 24].includes(tapeSize)) {
      res.status(400).send('Invalid tape size');
      return;
    }

    try {
      await printingService.printLabelText(tapeSize, labelText);
      res.status(200).send('OK');
    } catch (error) {
      errorLogStamp('Label printing failed:', error.message);
      res.status(500).send('Print failed');
    }
  });
  // ┌────────────────────┐
  // │  Server metadata   │
  // └────────────────────┘
  app.get('/logs/recent', (req, res) => {
    const requestedLookBack = Number.parseInt(req.query.lookBack, 10);
    const lookBackMinutes = Number.isFinite(requestedLookBack)
      ? Math.min(Math.max(requestedLookBack, 1), 24 * 60)
      : 60;
    const now = Date.now();
    const lookbackMs = lookBackMinutes * 60 * 1000;
    const { printJobs = [] } = serverSave.getData();

    const recentJobs = printJobs
      .filter(job => {
        const timestamp = Date.parse(job.timestamp);
        return Number.isFinite(timestamp) && (now - timestamp) <= lookbackMs;
      })
      .sort((leftJob, rightJob) => Date.parse(rightJob.timestamp) - Date.parse(leftJob.timestamp))
      .map(job => compactObject({
        timestamp: job.timestamp,
        printerId: job.printerId,
        printerName: job.printerName,
        displayName: printerRegistry[job.printerId]?.displayName || job.printerName,
        iconUrl: printerIconResolver.getPrinterIconUrl(job.printerId, {
          driverName: job.printerName,
        }),
        printMode: job.printMode || null,
        originalFilename: job.originalFilename,
        storedFilename: job.storedFilename || null,
        filePath: job.filePath || null,
        chksum: job.chksum || null,
        previewUrl: previewer && previewer.hasPreview(job.chksum)
          ? previewer.getPreviewUrl(job.chksum)
          : null,
        testing: Boolean(job.testing),
        result: job.result || null,
        sourceType: job.sourceType || null,
        sourceRoute: job.sourceRoute || null,
        sourceArchiveName: job.sourceArchiveName || null,
        bundledSourceCount: job.bundledSourceCount ?? null,
        copyIndex: job.copyIndex ?? null,
        totalCopies: job.totalCopies ?? null,
        transportResponse: job.transportResponse || null,
        error: job.error || null,
      }));

    res.status(200).json({
      jobs: recentJobs,
      windowMinutes: lookBackMinutes,
    });
  });

  app.get('/preview/:checksum', (req, res) => {
    const checksum = String(req.params.checksum || '').trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      res.status(400).send('Invalid preview checksum');
      return;
    }

    if (!previewer || !previewer.hasPreview(checksum)) {
      res.status(404).send('Preview not found');
      return;
    }

    res.sendFile(previewer.getPreviewPath(checksum), err => {
      if (err) {
        errorLogStamp(`Error sending preview: ${err.message}`);
        if (!res.headersSent) {
          res.status(err.status || 500).end();
        }
      }
    });
  });

  // Logged reprints should stay on the shared print path so testing mode and
  // audit metadata behave the same way as fresh uploads.
  app.post('/logs/reprint', async (req, res) => {
    const timestamp = String(req.body.timestamp || '').trim();
    const printerId = String(req.body.printerId || '').trim();
    const chksum = String(req.body.chksum || '').trim().toLowerCase();
    const copyCount = Number.parseInt(req.body.copyCount, 10);
    const normalizedCopyCount = Number.isFinite(copyCount)
      ? Math.min(Math.max(copyCount, 1), 50)
      : 1;
    const printJob = findLoggedJob({ timestamp, printerId, chksum });
    const printerConfig = printerRegistry[printerId];

    if (!printJob) {
      res.status(404).send('Logged job not found');
      return;
    }

    if (!printerConfig) {
      res.status(404).send('Printer not found');
      return;
    }

    if (!printJob.filePath || !fs.existsSync(printJob.filePath)) {
      res.status(410).send('Source file is no longer available');
      return;
    }

    try {
      await Promise.all(Array.from({ length: normalizedCopyCount }, (_, index) => (
        printingService.printPDF(printJob.filePath, printerConfig, {
          originalFilename: printJob.originalFilename,
          storedFilename: printJob.storedFilename,
          sourceRoute: '/logs/reprint',
          sourceType: 'log-reprint',
          checksumFilePath: printJob.filePath,
          copyIndex: normalizedCopyCount > 1 ? index + 1 : null,
          totalCopies: normalizedCopyCount > 1 ? normalizedCopyCount : null,
        })
      )));

      res.status(200).json({
        ok: true,
        copyCount: normalizedCopyCount,
      });
    } catch (error) {
      errorLogStamp('Logged reprint failed:', error.message);
      res.status(500).send('Reprint failed');
    }
  });

  app.get('/version', (req, res) => {
    const pageHits = serverSave.incrementPageHits();
    const { printCounter } = serverSave.getData();

    res.status(200).json({
      version,
      printCounter: Math.floor(printCounter / 50) * 50,
      pageHits,
    });
  });

  // Resolve top-level page slugs like /logs to matching src/pages/*.html files.
  app.get('/:pageName', (req, res, next) => {
    const pageFilePath = path.join(rootDir, 'src', 'pages', `${req.params.pageName}.html`);

    if (!fs.existsSync(pageFilePath)) {
      next();
      return;
    }

    res.sendFile(pageFilePath, err => {
      if (err) {
        errorLogStamp(`Error sending page: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });
};

module.exports = {
  registerRoutes,
};
