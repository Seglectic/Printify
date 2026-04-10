// ╭──────────────────────────────────────╮
// │  reprint-source-regression.js        │
// │  Sanity-check bundled reprint source │
// │  tracking so copies do not multiply  │
// ╰──────────────────────────────────────╯
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const { createPrintingService } = require('../lib/printing');
const { createJobLogEntry, createFileChecksum } = require('../lib/logger');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'printify-reprint-'));
const sourcePdfPath = path.join(tempRoot, 'label.pdf');
fs.writeFileSync(sourcePdfPath, Buffer.from('%PDF-1.4\n% test\n', 'utf8'));

const recordedJobs = [];

const printingService = createPrintingService({
  testing: true,
  getTesting: () => true,
  serverSave: {
    incrementPrintCounter() {},
    addPrintJob() {},
  },
  logStore: {
    async addPrintJob(printJob) {
      recordedJobs.push(printJob);
    },
  },
  deduplicator: {
    async addPrintJob() {},
  },
  createFileChecksum,
  createJobLogEntry,
  logStamp() {},
  errorLogStamp() {},
  converter: {},
  previewer: null,
});

const printerConfig = printingService.createPrinterConfig('zebra', {
  displayName: 'Zebra Label Printer',
  driverName: 'Zebra450',
  bundleCopies: true,
  printMode: 'driver',
});

const run = async () => {
  const pdfDocument = await PDFDocument.create();
  pdfDocument.addPage([288, 432]);
  const pdfBytes = await pdfDocument.save();
  fs.writeFileSync(sourcePdfPath, pdfBytes);

  await printingService.reprintLoggedJob({
    printJob: {
      timestamp: '2026-04-10T00:00:00.000',
      filePath: path.join(tempRoot, 'old-bundle.pdf'),
      sourceFilePath: sourcePdfPath,
      originalFilename: 'label x2 x3.pdf',
      chksum: 'deadbeef',
    },
    printerConfig,
    requestBody: {
      copyCount: 5,
    },
  });

  assert.strictEqual(recordedJobs.length, 1, 'expected one bundled log entry');
  assert.strictEqual(recordedJobs[0].filePath !== recordedJobs[0].sourceFilePath, true, 'bundled log should keep separate artifact and source paths');
  assert.strictEqual(recordedJobs[0].sourceFilePath, sourcePdfPath, 'reprint should keep the original source file path');
  assert.strictEqual(recordedJobs[0].originalFilename, 'label x5.pdf', 'reprint filename should reflect the new requested copy count');

  console.log('reprint source regression check passed');
};

run()
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
