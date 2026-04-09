// ╭──────────────────────────╮
// │  Printify.js             │
// │  Main server entry for   │
// │  routes, printing, and   │
// │  live log updates        │
// ╰──────────────────────────╯
const http    = require('http');
const express = require('express');
const path    = require('path');

let WebSocketServer = null;
let WebSocket       = null;

try {
  ({ WebSocketServer, WebSocket } = require('ws'));
} catch (error) {
  WebSocketServer = null;
  WebSocket = null;
}


// ╭───────────────╮
// │  lib Modules  │
// ╰───────────────╯
const {
  rootDir,
  staticDir,
  iconsDir,
  logsDir,
  uploadsDir,
  previewCacheDir,
  serverDataPath,
  version,
  port,
  testing,
  clippy,
  imPath,
  printers,
} = require('./lib/configurator');
const { createConverter }        = require('./lib/converter');
const { createPreviewer }        = require('./lib/previewer');
const {
  compactObject,
  createFileChecksum,
  createJobLogEntry,
  logStamp,
  errorLogStamp,
} = require('./lib/logger');
const { createServerSave }        = require('./lib/serverSave');
const { createLogStore }          = require('./lib/logStore');
const { createDeduplicator }      = require('./lib/deduplicator');
const { createPrintingService }   = require('./lib/printing');
const { createIngestService }     = require('./lib/ingest');
const { registerRoutes }          = require('./lib/routes');


// ┌─────────┐
// │  Boot   │
// └─────────┘
const app = express();                                   // Main Express app instance
const httpServer = http.createServer(app);
const serverSave = createServerSave({
  serverDataPath,
  onPrintJobSaved: () => {},
}); // Persist lightweight server stats across restarts.
const logStore = createLogStore({
  logsDir,
  errorLogStamp,
});
const deduplicator = createDeduplicator({
  logsDir,
  logStamp,
  errorLogStamp,
});
const converter = createConverter({
  imPath,
  logStamp,
  errorLogStamp,
});
const previewer = createPreviewer({
  imPath,
  previewCacheDir,
  logStamp,
  errorLogStamp,
});

// Centralize print prep and dispatch so routes stay thin.
const printingService = createPrintingService({
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
});
const ingestService = createIngestService({
  uploadsDir,
  printingService,
  deduplicator,
  logStamp,
  errorLogStamp,
});


// ┌────────────────┐
// │  Server wiring │
// └────────────────┘
const logSocketClients = new Set();
const notifyRecentLogUpdate = () => {
  if (!WebSocket) {
    return;
  }

  const payload = JSON.stringify({ type: 'print-jobs-updated' });

  logSocketClients.forEach(socket => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    }
  });
};

serverSave.addPrintJobListener(notifyRecentLogUpdate);

logStamp(`Printify.js v${version}`);

Object.entries(printers).forEach(([printerId, printerConfig]) => {
  logStamp(`Configured printer "${printerId}":`, compactObject({
    displayName: printerConfig.displayName,
    printMode: printerConfig.printMode,
    driverName: printerConfig.driverName,
    size: printerConfig.size,
    units: printerConfig.units,
    density: printerConfig.density,
    sizePx: printerConfig.sizePx,
    acceptedKinds: printerConfig.acceptedKinds,
    labelBuilder: Boolean(printerConfig.labelBuilder),
    bundleCopies: Boolean(printerConfig.bundleCopies),
  }));
});

// Shared request middleware for JSON, form bodies, and static UI assets.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(staticDir));
app.use('/icons', express.static(iconsDir));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(iconsDir, 'favicon.ico'));
});

// Mount all app routes with the shared services they depend on.
registerRoutes({
  app,
  rootDir,
  printers,
  printingService,
  ingestService,
  previewer,
  serverSave,
  logStore,
  version,
  clippy,
  errorLogStamp,
  logStamp,
});

if (WebSocketServer) {
  const logSocketServer = new WebSocketServer({
    server: httpServer,
    path: '/ws/logs',
  });

  logSocketServer.on('connection', socket => {
    logSocketClients.add(socket);
    socket.send(JSON.stringify({ type: 'connected' }));

    socket.on('close', () => {
      logSocketClients.delete(socket);
    });

    socket.on('error', error => {
      errorLogStamp('Log websocket error:', error.message);
    });
  });
} else {
  errorLogStamp('WebSocket support disabled: install dependencies to enable /ws/logs updates.');
}

// Start the HTTP server after middleware and routes are in place.
const startServer = async () => {
  try {
    await deduplicator.initialize();
  } catch (error) {
    errorLogStamp('Checksum cache initialization failed:', error.message);
  }

  httpServer.listen(port, () => {
    logStamp(`Server is running on port ${port}`);
  });
};

startServer();
