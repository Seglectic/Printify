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
  configDir,
  configPath,
  staticDir,
  iconsDir,
  fontsDir,
  logsDir,
  uploadsDir,
  previewCacheDir,
  serverDataPath,
  version,
  port,
  testing,
  assistant,
  imPath,
  printers,
} = require('./lib/configurator');
const { createRuntimeConfig }    = require('./lib/runtimeConfig');
const { createConverter }        = require('./lib/converter');
const { createPreviewer }        = require('./lib/previewer');
const {
  createTui,
  promptForAlternativePort,
} = require('./lib/tui');
const {
  createFileChecksum,
  createJobLogEntry,
  logStamp,
  errorLogStamp,
} = require('./lib/logger');
const { createServerSave }        = require('./lib/serverSave');
const { createLogStore }          = require('./lib/logStore');
const { createLogStats }          = require('./lib/logStats');
const { createDeduplicator }      = require('./lib/deduplicator');
const { createPrintingService }   = require('./lib/printing');
const { createIngestService }     = require('./lib/ingest');
const { registerRoutes }          = require('./lib/routes');


// ┌─────────┐
// │  Boot   │
// └─────────┘
const app = express();                                   // Main Express app instance
const httpServer = http.createServer(app);
const runtimeConfig = createRuntimeConfig();
const logStore = createLogStore({
  logsDir,
  errorLogStamp,
});
const logStats = createLogStats({
  logsDir,
  printerRegistry: printers,
  logStamp,
  errorLogStamp,
});
const serverSave = createServerSave({
  serverDataPath,
  logStats,
  onPrintJobSaved: () => {},
}); // Persist lightweight server stats across restarts.
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
  getTesting: () => runtimeConfig.getOption('testing'),
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

// Shared request middleware for JSON, form bodies, and static UI assets.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(staticDir));
app.use('/fonts', express.static(path.join(staticDir, 'fonts')));
app.use('/icons', express.static(iconsDir));
app.use('/fonts', express.static(fontsDir));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(iconsDir, 'favicon.ico'));
});

// Mount all app routes with the shared services they depend on.
registerRoutes({
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
});

const tui = createTui({
  runtimeConfig,
  logsDir,
  uploadsDir,
  logStore,
  logStats,
  deduplicator,
  ingestService,
  onLogsPurged: notifyRecentLogUpdate,
  logStamp,
  errorLogStamp,
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

  logSocketServer.on('error', () => {});
} else {
  errorLogStamp('WebSocket support disabled: install dependencies to enable /ws/logs updates.');
}

// Start the HTTP server after middleware and routes are in place.
const listenOnPort = requestedPort => new Promise((resolve, reject) => {
  const handleListening = () => {
    httpServer.off('error', handleError);
    resolve();
  };

  const handleError = error => {
    httpServer.off('listening', handleListening);
    reject(error);
  };

  httpServer.once('listening', handleListening);
  httpServer.once('error', handleError);
  httpServer.listen(requestedPort);
});

const startServer = async () => {
  try {
    await logStats.initialize();
  } catch (error) {
    errorLogStamp('Log stats initialization failed:', error.message);
  }

  try {
    await deduplicator.initialize();
  } catch (error) {
    errorLogStamp('Checksum cache initialization failed:', error.message);
  }

  let requestedPort = runtimeConfig.getOption('port') || port;

  while (true) {
    try {
      await listenOnPort(requestedPort);
      logStamp(`Server is running on port ${requestedPort}`);
      tui.start();
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        errorLogStamp(`Server failed to start on port ${requestedPort}:`, error.message);
        process.exitCode = 1;
        return;
      }

      const nextPort = await promptForAlternativePort({
        blockedPort: requestedPort,
        runtimeConfig,
        logStamp,
        errorLogStamp,
      });

      if (!nextPort) {
        errorLogStamp('Server did not start. Update config/config.yaml or free the blocked port and try again.');
        process.exitCode = 1;
        return;
      }

      requestedPort = nextPort;
    }
  }
};

startServer();
