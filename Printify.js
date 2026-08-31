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
  dataDir,
  logsDir,
  uploadsDir,
  labelTemplatesDir,
  previewCacheDir,
  serverDataPath,
  version,
  port,
  testing,
  assistant,
  imPath,
} = require('./lib/configurator');
const { createPluginManager } = require('./lib/pluginLoader');
const { createRuntimeConfig }    = require('./lib/runtimeConfig');
const { createConverter }        = require('./lib/converter');
const { createPreviewer }        = require('./lib/previewer');
const {
  createTui,
  promptForAlternativePort,
} = require('./lib/tui');
const {
  logStamp,
  errorLogStamp,
} = require('./lib/logger');
const { createServerSave }        = require('./lib/serverSave');
const { createLogStore }          = require('./lib/logStore');
const { createLogStats }          = require('./lib/logStats');
const { createDeduplicator }      = require('./lib/deduplicator');
const { createJobSystem }         = require('./lib/jobSystem');
const { createPrintingService }   = require('./lib/printing');
const { createIngestService }     = require('./lib/ingest');
const { createPrinterManager }    = require('./lib/printerManager');
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
  printerRegistry: {},
  logStamp,
  errorLogStamp,
});
const serverSave = createServerSave({
  serverDataPath,
  legacyServerDataPath: path.join(rootDir, 'serverData.json'),
  logStats,
  onPrintJobSaved: () => {},
  errorLogStamp,
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
const logSocketClients = new Set();

const notifySocketClients = payload => {
  if (!WebSocket) {
    return;
  }

  const message = JSON.stringify(payload);

  logSocketClients.forEach(socket => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  });
};
const jobSystem = createJobSystem({
  onQueueChange: notifySocketClients,
  logStamp,
  errorLogStamp,
});
let printerManager = null;
let pluginManager = null;

// Centralize print prep and dispatch so routes stay thin.
const printingService = createPrintingService({
  testing,
  getTesting: () => runtimeConfig.getOption('testing'),
  serverSave,
  logStore,
  deduplicator,
  logStamp,
  errorLogStamp,
  converter,
  previewer,
  jobSystem,
});
const ingestService = createIngestService({
  uploadsDir,
  printingService,
  deduplicator,
  inspectUpload: context => pluginManager?.inspectUpload?.(context),
  resolvePendingUploadAction: context => pluginManager?.resolvePendingUploadAction?.(context),
  logStamp,
  errorLogStamp,
});

const notifyRecentLogUpdate = () => {
  notifySocketClients({ type: 'print-jobs-updated' });
};

pluginManager = createPluginManager({
  rootDir,
  runtimeConfig,
  serverSave,
  reloadPrinters: reason => printerManager?.reload(reason),
  logStamp,
  errorLogStamp,
});
printerManager = createPrinterManager({
  runtimeConfig,
  printingService,
  serverSave,
  logStats,
  logStamp,
  errorLogStamp,
  onReload: payload => {
    pluginManager.syncFromConfig();
    notifySocketClients(payload);
  },
});


// ┌────────────────┐
// │  Server wiring │
// └────────────────┘
serverSave.addPrintJobListener(notifyRecentLogUpdate);

logStamp(`Printify.js v${version}`);

// Shared request middleware for JSON, form bodies, and static UI assets.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  // Optional plugins can declare when they need cross-origin isolation.
  if (pluginManager.shouldApplyIsolationHeaders(req.path)) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }

  next();
});
app.use(express.static(staticDir));
pluginManager.registerStaticRoutes(app);
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
  staticDir,
  dataDir,
  configDir,
  configPath,
  iconsDir,
  labelTemplatesDir,
  printerManager,
  printingService,
  ingestService,
  previewer,
  serverSave,
  logStore,
  version,
  assistant,
  pluginLoader: pluginManager,
  runtimeConfig,
  reloadPrinters: reason => printerManager.reload(reason),
  errorLogStamp,
  logStamp,
  jobSystem,
});

const tui = createTui({
  runtimeConfig,
  logsDir,
  uploadsDir,
  logStore,
  logStats,
  deduplicator,
  ingestService,
  onLogsPurged: () => {
    serverSave.syncPrinterCache();
    notifyRecentLogUpdate();
  },
  onReload: reason => printerManager.reload(reason),
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
    socket.send(JSON.stringify({
      type: 'job-queue-sync',
      jobs: jobSystem.getActiveJobs(),
    }));

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
    serverSave.syncPrinterCache();
  } catch (error) {
    errorLogStamp('Log stats initialization failed:', error.message);
  }

  try {
    await deduplicator.initialize();
  } catch (error) {
    errorLogStamp('Checksum cache initialization failed:', error.message);
  }

  let requestedPort = runtimeConfig.getOption('port') || port;

  // Plugin poll timers and the config file watcher keep the event loop alive,
  // so setting process.exitCode on a failed start is not enough: the process
  // lingers forever without ever serving. Tear the handles down and leave with
  // a real exit code, which is also what lets a service manager notice.
  const abortStartup = message => {
    errorLogStamp(message);

    try {
      pluginManager?.stopAll?.();
    } catch (error) {
      errorLogStamp('Plugin shutdown during failed startup failed:', error.message);
    }

    process.exit(1);
  };

  while (true) {
    try {
      await listenOnPort(requestedPort);
      logStamp(`Server is running on port ${requestedPort}`);
      tui.start();
      return;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        abortStartup(`Server failed to start on port ${requestedPort}: ${error.message}`);
        return;
      }

      const nextPort = await promptForAlternativePort({
        blockedPort: requestedPort,
        runtimeConfig,
        logStamp,
        errorLogStamp,
      });

      if (!nextPort) {
        abortStartup('Server did not start. Update config/config.yaml or free the blocked port and try again.');
        return;
      }

      requestedPort = nextPort;
    }
  }
};

startServer();
