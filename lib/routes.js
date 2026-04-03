// ╭──────────────────────────╮
// │  routes.js               │
// │  Express route setup for │
// │  static files, uploads,  │
// │  and server metadata     │
// ╰──────────────────────────╯
const path = require('path');


// ┌────────────────────┐
// │  Route registrar   │
// └────────────────────┘
const registerRoutes = ({
  app,
  rootDir,
  upload,
  printers,
  printingService,
  serverSave,
  version,
  errorLogStamp,
  logStamp,
}) => {
  const printerRegistry = Object.fromEntries(
    Object.entries(printers).map(([printerId, printerConfig]) => (
      [printerId, printingService.createPrinterConfig(printerId, printerConfig)]
    ))
  );

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


  // ┌──────────────────┐
  // │  Zebra routes    │
  // └──────────────────┘
  app.post('/zebra', upload.single('pdfFile'), (req, res) => {
    printingService.printPDF(req.file.path, printerRegistry.zebra, {
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
      sourceRoute: req.path,
      sourceType: 'upload-pdf',
    });
    res.status(200).send('OK');
  });

  app.post('/zebrapng', upload.single('pngFile'), (req, res) => {
    printingService.convertImgToPdf(req.file.path, printerRegistry.zebra, undefined, {
      originalFilename: req.file.originalname,
      checksumFilePath: req.file.path,
      storedFilename: req.file.filename,
      sourceRoute: req.path,
      sourceType: 'upload-image',
    });
    res.status(200).send('OK');
  });

  app.post('/zebrazip', upload.single('zipFile'), (req, res) => {
    logStamp('Zip File');
    const pdfFiles = printingService.extractZip(req.file.path, printerRegistry.zebra, {
      checksumFilePath: req.file.path,
      sourceArchiveName: req.file.originalname,
      sourceRoute: req.path,
      sourceType: 'upload-zip',
    });
    logStamp(pdfFiles);
    res.status(200).send('OK');
  });


  // ┌────────────────────┐
  // │  Brother routes    │
  // └────────────────────┘
  app.post('/brother', upload.array('pdfFile'), (req, res) => {
    printingService.printPDF(req.files[0].path, printerRegistry.brotherLaser, {
      originalFilename: req.files[0].originalname,
      storedFilename: req.files[0].filename,
      sourceRoute: req.path,
      sourceType: 'upload-pdf',
    });
    res.status(200).send('OK');
  });

  app.post('/brotherImg', upload.array('imgFile'), (req, res) => {
    printingService.convertImgToPdf(req.files[0].path, printerRegistry.brotherLaser, undefined, {
      originalFilename: req.files[0].originalname,
      checksumFilePath: req.files[0].path,
      storedFilename: req.files[0].filename,
      sourceRoute: req.path,
      sourceType: 'upload-image',
    });
    res.status(200).send('OK');
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


  // ┌─────────────────┐
  // │  Dymo routes    │
  // └─────────────────┘
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
      printingService.convertImgToPdf(filePath, printerRegistry.dymoLabel, undefined, {
        originalFilename: req.file.originalname,
        checksumFilePath: filePath,
        sourceRoute: req.path,
        sourceType: 'upload-image',
        copyIndex: index + 1,
        totalCopies: Number(printCount),
      });
    }

    res.status(200).send('OK');
  });


  // ┌────────────────────┐
  // │  Server metadata   │
  // └────────────────────┘
  app.get('/version', (req, res) => {
    const pageHits = serverSave.incrementPageHits();
    const { printCounter } = serverSave.getData();

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
