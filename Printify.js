const express = require('express');

const {
  rootDir,
  staticDir,
  serverDataPath,
  version,
  port,
  testing,
  imPath,
  printers,
} = require('./lib/config');
const { logStamp, errorLogStamp } = require('./lib/logger');
const { createUpload } = require('./lib/upload');
const { createServerDataStore } = require('./lib/serverDataStore');
const { createPrintingService } = require('./lib/printing');
const { registerRoutes } = require('./lib/routes');


// ┌────────────────┐
// │  Library Init  │
// └────────────────┘
const app = express();
const upload = createUpload();
const serverDataStore = createServerDataStore({ serverDataPath });
const printingService = createPrintingService({
  testing,
  imPath,
  serverDataStore,
  logStamp,
  errorLogStamp,
});


// ╭────────────────────────╮
// │  Web Vars and helpers  │
// ╰────────────────────────╯
logStamp(`Printify.js v${version}`);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(staticDir));

registerRoutes({
  app,
  rootDir,
  upload,
  printers,
  printingService,
  serverDataStore,
  version,
  errorLogStamp,
  logStamp,
});

app.listen(port, () => {
  logStamp(`Server is running on port ${port}`);
});
