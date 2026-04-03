const express = require('express');


// ╭───────────────╮
// │  lib Modules  │
// ╰───────────────╯
const {
  rootDir,
  staticDir,
  serverDataPath,
  version,
  port,
  testing,
  imPath,
  printers,
} = require('./lib/configurator');
const { createConverter }        = require('./lib/converter');
const { logStamp, errorLogStamp } = require('./lib/logger');
const { createUpload }            = require('./lib/upload');
const { createServerSave }        = require('./lib/serverSave');
const { createPrintingService }   = require('./lib/printing');
const { registerRoutes }          = require('./lib/routes');


// ┌─────────┐
// │  Boot   │
// └─────────┘
const app = express();                                   // Main Express app instance
const upload = createUpload();                           // Shared Multer uploader for file endpoints
const serverSave = createServerSave({ serverDataPath }); // Persist lightweight server stats across restarts.
const converter = createConverter({
  imPath,
  logStamp,
  errorLogStamp,
});

// Centralize print prep and dispatch so routes stay thin.
const printingService = createPrintingService({
  testing,
  serverSave,
  logStamp,
  errorLogStamp,
  converter,
});


// ┌────────────────┐
// │  Server wiring │
// └────────────────┘
logStamp(`Printify.js v${version}`);

// Shared request middleware for JSON, form bodies, and static UI assets.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(staticDir));

// Mount all app routes with the shared services they depend on.
registerRoutes({
  app,
  rootDir,
  upload,
  printers,
  printingService,
  serverSave,
  version,
  errorLogStamp,
  logStamp,
});

// Start the HTTP server after middleware and routes are in place.
app.listen(port, () => {
  logStamp(`Server is running on port ${port}`);
});
