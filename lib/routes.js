// ┌─────────────┐
// │  routes.js  │
// └─────────────┘
// Express route registration for static file access, upload endpoints, and server metadata responses.

const path = require('path');

const registerRoutes = ({
  app,
  rootDir,
  upload,
  printers,
  printingService,
  serverDataStore,
  version,
  errorLogStamp,
  logStamp,
}) => {
  app.get('/files/:fileName', (req, res) => {
    const filePath = path.join(rootDir, req.params.fileName);

    res.sendFile(filePath, err => {
      if (err) {
        errorLogStamp(`Error sending file: ${err}`);
        res.status(err.status || 500).end();
      }
    });
  });

  app.post('/zebra', upload.single('pdfFile'), (req, res) => {
    printingService.printPDF(req.file.path, printers.zebra);
    res.status(200).send('OK');
  });

  app.post('/zebrapng', upload.single('pngFile'), (req, res) => {
    printingService.convertPDF(req.file.path, printers.zebra);
    res.status(200).send('OK');
  });

  app.post('/zebrazip', upload.single('zipFile'), (req, res) => {
    logStamp('Zip File');
    const pdfFiles = printingService.extractZip(req.file.path, printers.zebra);
    logStamp(pdfFiles);
    res.status(200).send('OK');
  });

  app.post('/brother', upload.array('pdfFile'), (req, res) => {
    printingService.printPDF(req.files[0].path, printers.brotherLaser);
    res.status(200).send('OK');
  });

  app.post('/brotherImg', upload.array('imgFile'), (req, res) => {
    printingService.convertPDF(req.files[0].path, printers.brotherLaser);
    res.status(200).send('OK');
  });

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

  app.post('/dymopng', upload.single('pngFile'), (req, res) => {
    const filePath = req.file.path;
    let printCount = 1;

    if (req.body.printCount) {
      printCount = req.body.printCount;
    }

    if (printCount > 1) {
      logStamp(`Printing ${printCount} labels`);
    } else {
      logStamp('Printing label');
    }

    for (let index = 0; index < printCount; index += 1) {
      printingService.convertPDF(filePath, printers.dymoLabel);
    }

    res.status(200).send('OK');
  });

  app.get('/version', (req, res) => {
    const pageHits = serverDataStore.incrementPageHits();
    const { printCounter } = serverDataStore.getData();

    res.status(200).json({
      version,
      printCounter: Math.floor(printCounter / 50) * 50,
      pageHits,
    });
  });
};

module.exports = {
  registerRoutes,
};
