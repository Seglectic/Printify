// ╭──────────────────────────╮
// │  routes.js               │
// │  Dynamic Express router  │
// │  for static pages, file  │
// │  uploads, and server     │
// │  metadata endpoints      │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const { resolveLoggedPath } = require('./filePaths');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const YAML = require('yaml');
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

const barcodeFormatConfig = {
  code128: {
    bcid: 'code128',
    scale: 3,
    height: 24,
  },
  code39: {
    bcid: 'code39',
    scale: 3,
    height: 24,
  },
  datamatrix: {
    bcid: 'datamatrix',
    scale: 6,
    height: 24,
  },
  pdf417: {
    bcid: 'pdf417',
    scale: 2,
    height: 20,
  },
  ean13: {
    bcid: 'ean13',
    scale: 3,
    height: 24,
  },
  upca: {
    bcid: 'upca',
    scale: 3,
    height: 24,
  },
};


// ┌────────────────────┐
// │  Route registrar   │
// └────────────────────┘
const registerRoutes = ({
  app,
  rootDir,
  configDir,
  configPath,
  iconsDir,
  printers,
  printingService,
  ingestService,
  previewer,
  serverSave,
  logStore,
  version,
  assistant,
  runtimeConfig,
  errorLogStamp,
  logStamp,
}) => {
  const printerIconResolver = buildPrinterIconResolver(iconsDir);
  const printerRegistry = Object.fromEntries(
    Object.entries(printers).map(([printerId, printerConfig]) => (
      [printerId, printingService.createPrinterConfig(printerId, printerConfig)]
    ))
  );

  const formatPrinterLabel = printerConfig => (
    printerConfig.displayName || printerConfig.driverName || printerConfig.id
  );

  const registerPrinterUploadRoute = (printerId, printerConfig, fileKind, mode) => {
    const kindConfig = fileKindConfig[fileKind];
    const isMulti = mode === 'multi';
    const routePath = `/${printerId}/${fileKind}${isMulti ? '/multi' : ''}`;
    const assignPrinterId = (req, res, next) => {
      req.printifyPrinterId = printerId;
      next();
    };
    const middleware = ingestService.createUploadMiddleware({
      fieldName: kindConfig.fieldName,
      isMulti,
    });

    app.post(routePath, assignPrinterId, middleware, async (req, res) => {
      const uploadedFiles = isMulti ? (req.files || []) : (req.file ? [req.file] : []);
      let uploadedJobMetaList = [];

      if (!uploadedFiles.length) {
        res.status(400).send('Missing upload');
        return;
      }

      try {
        uploadedJobMetaList = JSON.parse(req.body.jobMetaList || '[]');
        if (!Array.isArray(uploadedJobMetaList)) {
          uploadedJobMetaList = [];
        }
      } catch (error) {
        uploadedJobMetaList = [];
      }

      try {
        const ingestResult = await ingestService.processUpload({
          requestPath: req.path,
          printerConfig,
          fileKind,
          uploadedFiles,
          uploadedJobMetaList,
          requestBody: req.body,
        });

        res.status(200).json(ingestResult);
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
      bundleCopies: Boolean(printerConfig.bundleCopies),
      size: printerConfig.size || null,
      units: printerConfig.units || null,
      density: printerConfig.density || null,
      sizePx: printerConfig.sizePx || null,
      sizePxWidth: printerConfig.sizePxWidth || null,
      sizePxHeight: printerConfig.sizePxHeight || null,
    }));

    res.status(200).json({
      printers: printerList,
    });
  });

  app.get('/label-builder/code', async (req, res) => {
    const codeText = String(req.query.text || '').trim();
    const codeFormat = String(req.query.format || 'qrcode').trim().toLowerCase();
    const requestedSize = Number.parseInt(req.query.size, 10);
    const codeSize = Number.isFinite(requestedSize)
      ? Math.min(Math.max(requestedSize, 128), 1024)
      : 384;

    if (!codeText) {
      res.status(400).send('Missing code text');
      return;
    }

    try {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');

      if (barcodeFormatConfig[codeFormat]) {
        const barcodeConfig = barcodeFormatConfig[codeFormat];
        const barcodeBuffer = await bwipjs.toBuffer({
          bcid: barcodeConfig.bcid,
          text: codeText,
          scale: barcodeConfig.scale,
          height: barcodeConfig.height,
          includetext: false,
          backgroundcolor: 'FFFFFF',
        });

        res.send(barcodeBuffer);
        return;
      }

      const qrBuffer = await QRCode.toBuffer(codeText, {
        errorCorrectionLevel: 'M',
        margin: 1,
        type: 'png',
        width: codeSize,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      res.send(qrBuffer);
    } catch (error) {
      errorLogStamp('Code image generation failed:', error.message);
      res.status(500).send('Code image generation failed');
    }
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

  app.post('/ingest/:sessionId/confirm', async (req, res) => {
    const sessionId = String(req.params.sessionId || '').trim();
    const approvedItemIds = Array.isArray(req.body?.approvedItemIds)
      ? req.body.approvedItemIds.map(value => String(value))
      : [];

    if (!sessionId) {
      res.status(400).json({
        error: 'Missing session id',
      });
      return;
    }

    try {
      const result = await ingestService.confirmPendingDuplicates({
        sessionId,
        approvedItemIds,
      });

      res.status(200).json(result);
    } catch (error) {
      if (error.code === 'SESSION_NOT_FOUND') {
        res.status(404).json({
          error: 'Pending ingest session not found',
        });
        return;
      }

      errorLogStamp('Pending ingest confirmation failed:', error.message);
      res.status(500).json({
        error: 'Could not confirm duplicate upload',
      });
    }
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
  app.get('/logs/recent', async (req, res) => {
    const requestedLookBack = Number.parseInt(req.query.lookBack, 10);
    const lookBackMinutes = Number.isFinite(requestedLookBack)
      ? Math.min(Math.max(requestedLookBack, 1), 7 * 24 * 60)
      : 60;
    try {
      const recentJobs = (await logStore.getRecentJobs({ lookBackMinutes }))
        .map(job => {
          const previewChecksum = job.chksum || null;

          return compactObject({
            jobId: job.jobId || null,
            timestamp: job.timestamp,
            printerId: job.printerId,
            printerName: job.printerName,
            displayName: printerRegistry[job.printerId]?.displayName || job.printerName,
            iconUrl: printerIconResolver.getPrinterIconUrl(job.printerId, {
              driverName: job.printerName,
            }),
            printMode: job.printMode || null,
            originalFilename: job.originalFilename,
            filePath: job.filePath || null,
            sourceFilePath: job.sourceFilePath || null,
            fileSizeBytes: job.fileSizeBytes ?? null,
            chksum: job.chksum || null,
            isReprint: Boolean(job.isReprint || job.sourceType === 'log-reprint'),
            reprintSourceTimestamp: job.reprintSourceTimestamp || null,
            previewUrl: previewer && previewer.hasPreview(previewChecksum)
              ? previewer.getPreviewUrl(previewChecksum)
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
          });
        });

      res.status(200).json({
        jobs: recentJobs,
        windowMinutes: lookBackMinutes,
      });
    } catch (error) {
      errorLogStamp('Recent log lookup failed:', error.message);
      res.status(500).json({
        error: 'Could not load recent log data',
      });
    }
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

  app.get('/logs/original', async (req, res) => {
    const chksum = String(req.query.chksum || '').trim().toLowerCase();
    const beforeTimestamp = String(req.query.beforeTimestamp || '').trim();

    if (!chksum) {
      res.status(400).json({
        error: 'Missing checksum',
      });
      return;
    }

    try {
      const originalJob = await logStore.findOriginalJob({
        chksum,
        beforeTimestamp: beforeTimestamp || null,
      });
      const previewChecksum = originalJob?.chksum || null;

      if (!originalJob) {
        res.status(404).json({
          error: 'Original log entry not found',
        });
        return;
      }

      res.status(200).json({
        job: compactObject({
          jobId: originalJob.jobId || null,
          timestamp: originalJob.timestamp,
          printerId: originalJob.printerId,
          printerName: originalJob.printerName,
          displayName: printerRegistry[originalJob.printerId]?.displayName || originalJob.printerName,
          iconUrl: printerIconResolver.getPrinterIconUrl(originalJob.printerId, {
            driverName: originalJob.printerName,
          }),
          printMode: originalJob.printMode || null,
          originalFilename: originalJob.originalFilename,
          filePath: originalJob.filePath || null,
          sourceFilePath: originalJob.sourceFilePath || null,
          chksum: originalJob.chksum || null,
          isReprint: Boolean(originalJob.isReprint || originalJob.sourceType === 'log-reprint'),
          reprintSourceTimestamp: originalJob.reprintSourceTimestamp || null,
          previewUrl: previewer && previewer.hasPreview(previewChecksum)
            ? previewer.getPreviewUrl(previewChecksum)
            : null,
          testing: Boolean(originalJob.testing),
          result: originalJob.result || null,
          sourceType: originalJob.sourceType || null,
          sourceRoute: originalJob.sourceRoute || null,
          sourceArchiveName: originalJob.sourceArchiveName || null,
          bundledSourceCount: originalJob.bundledSourceCount ?? null,
          copyIndex: originalJob.copyIndex ?? null,
          totalCopies: originalJob.totalCopies ?? null,
          transportResponse: originalJob.transportResponse || null,
          error: originalJob.error || null,
        }),
      });
    } catch (error) {
      errorLogStamp('Original log lookup failed:', error.message);
      res.status(500).json({
        error: 'Could not resolve original log entry',
      });
    }
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
    const printJob = await logStore.findPrintJob({ timestamp, printerId, chksum });
    const printerConfig = printerRegistry[printerId];

    if (!printJob) {
      res.status(404).send('Logged job not found');
      return;
    }

    if (!printerConfig) {
      res.status(404).send('Printer not found');
      return;
    }

    const reprintSourcePath = resolveLoggedPath(printJob.sourceFilePath || printJob.filePath);

    if (!reprintSourcePath || !fs.existsSync(reprintSourcePath)) {
      res.status(410).send('Source file is no longer available');
      return;
    }

    try {
      await printingService.reprintLoggedJob({
        printJob,
        printerConfig,
        fileKind: 'pdf',
        requestBody: {
          copyCount: normalizedCopyCount,
        },
        sourceRoute: '/logs/reprint',
      });

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
    const configuredAssistant = runtimeConfig
      ? runtimeConfig.getOption('assistant')
      : assistant;

    res.status(200).json({
      version,
      assistant: configuredAssistant,
      printCounter: Math.floor(printCounter / 50) * 50,
      pageHits,
    });
  });

  app.get('/config', (req, res) => {
    try {
      const rawConfig = runtimeConfig
        ? runtimeConfig.readRawConfig()
        : fs.readFileSync(configPath, 'utf8');

      res.status(200).json({
        rawConfig,
      });
    } catch (error) {
      errorLogStamp('Config read failed:', error.message);
      res.status(500).json({
        error: 'Could not read config/config.yaml',
      });
    }
  });

  app.post('/config', (req, res) => {
    try {
      const rawConfig = String(req.body.rawConfig || '');

      if (!rawConfig.trim()) {
        res.status(400).json({
          error: 'Config content cannot be empty',
        });
        return;
      }

      if (runtimeConfig) {
        runtimeConfig.saveRawConfig(rawConfig);
      } else {
        YAML.parse(rawConfig);
        fs.writeFileSync(configPath, rawConfig.endsWith('\n') ? rawConfig : `${rawConfig}\n`, 'utf8');
      }

      res.status(200).json({
        ok: true,
      });
    } catch (error) {
      errorLogStamp('Config save failed:', error.message);
      res.status(400).json({
        error: `Config save failed: ${error.message}`,
      });
    }
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
