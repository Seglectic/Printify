// ╭──────────────────────────╮
// │  Printify.js            │
// │  Main server entry for  │
// │  routes, printing, and  │
// │  live log updates       │
// ╰──────────────────────────╯
const http = require('http');
const express = require('express');

let WebSocketServer = null;
let WebSocket = null;

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
  serverDataPath,
  version,
  port,
  testing,
  imPath,
  printers,
} = require('./lib/configurator');
const { createConverter }        = require('./lib/converter');
const {
  createFileChecksum,
  createJobLogEntry,
  logStamp,
  errorLogStamp,
} = require('./lib/logger');
const { createUpload }            = require('./lib/upload');
const { createServerSave }        = require('./lib/serverSave');
const { createPrintingService }   = require('./lib/printing');
const { registerRoutes }          = require('./lib/routes');


// ┌─────────┐
// │  Boot   │
// └─────────┘
const app = express();                                   // Main Express app instance
const upload = createUpload();                           // Shared Multer uploader for file endpoints
const httpServer = http.createServer(app);
const serverSave = createServerSave({
  serverDataPath,
  onPrintJobSaved: () => {},
}); // Persist lightweight server stats across restarts.
const converter = createConverter({
  imPath,
  logStamp,
  errorLogStamp,
});

// Centralize print prep and dispatch so routes stay thin.
const printingService = createPrintingService({
  testing,
  serverSave,
  createFileChecksum,
  createJobLogEntry,
  logStamp,
  errorLogStamp,
  converter,
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
httpServer.listen(port, () => {
  logStamp(`Server is running on port ${port}`);
});
