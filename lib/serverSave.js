// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  printer cache storage   │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const moment = require('moment');

const PRETTY_PRINT_SPACES = 2;
const DATA_VERSION = '3.0';
const COUNTER_KEYS = [
  'printCounter',
  'pageCounter',
  'actualPrintCounter',
  'actualPageCounter',
  'testingPrintCounter',
  'testingPageCounter',
  'paperAreaSquareMm',
  'actualPaperAreaSquareMm',
  'testingPaperAreaSquareMm',
];

const getNowIso = () => moment().format(moment.HTML5_FMT.DATETIME_LOCAL_MS);
const normalizeCounter = value => (Number.isFinite(value) ? value : 0);

// ┌────────────────────────────────────────────────────────────┐
// │  Crash-safe write                                          │
// │  The appliance this runs on is powered by a single USB     │
// │  plug, so a write can be interrupted at any moment. A      │
// │  half-written file here used to take the whole server down │
// │  on next boot, so land the bytes in a temp file first and  │
// │  rename over the target once they are safely on disk.      │
// └────────────────────────────────────────────────────────────┘
const writeFileAtomic = (targetPath, contents) => {
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  const handle = fs.openSync(tempPath, 'w');

  try {
    fs.writeFileSync(handle, contents);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }

  fs.renameSync(tempPath, targetPath);
};

const getDefaultPrinterCache = () => ({
  online: true,
  printCounter: 0,
  pageCounter: 0,
  actualPrintCounter: 0,
  actualPageCounter: 0,
  testingPrintCounter: 0,
  testingPageCounter: 0,
  paperAreaSquareMm: 0,
  actualPaperAreaSquareMm: 0,
  testingPaperAreaSquareMm: 0,
});

const normalizePrinterCacheEntry = rawPrinterEntry => {
  const nextPrinterEntry = {
    ...getDefaultPrinterCache(),
    online: rawPrinterEntry?.online !== false,
  };

  COUNTER_KEYS.forEach(counterKey => {
    nextPrinterEntry[counterKey] = normalizeCounter(rawPrinterEntry?.[counterKey]);
  });

  return nextPrinterEntry;
};

const getDefaultServerData = () => ({
  pageHits: 0,
  lastStartedAt: null,
  dataVersion: DATA_VERSION,
  printerPreferences: {},
  printers: {},
});

const normalizeServerData = rawServerData => {
  const nextServerData = {
    ...getDefaultServerData(),
    pageHits: normalizeCounter(rawServerData?.pageHits),
    lastStartedAt: rawServerData?.lastStartedAt || null,
    dataVersion: rawServerData?.dataVersion || DATA_VERSION,
    printerPreferences: rawServerData?.printerPreferences,
    printers: rawServerData?.printers,
  };

  nextServerData.printerPreferences = rawServerData?.printerPreferences && typeof rawServerData.printerPreferences === 'object'
    ? rawServerData.printerPreferences
    : {};
  nextServerData.printers = rawServerData?.printers && typeof rawServerData.printers === 'object'
    ? Object.fromEntries(
      Object.entries(rawServerData.printers).map(([printerId, printerEntry]) => (
        [printerId, normalizePrinterCacheEntry(printerEntry)]
      ))
    )
    : {};

  return nextServerData;
};

const stringifyServerData = value => `${JSON.stringify(value, null, PRETTY_PRINT_SPACES)}\n`;


// ┌───────────────────────┐
// │  Save file wrapper    │
// └───────────────────────┘
const createServerSave = ({
  serverDataPath,
  legacyServerDataPath = null,
  logStats = null,
  onPrintJobSaved = () => {},
  errorLogStamp = () => {},
}) => {
  const printJobListeners = [onPrintJobSaved];
  const configuredPrinterIds = new Set();

  fs.mkdirSync(path.dirname(serverDataPath), { recursive: true });

  if (!fs.existsSync(serverDataPath) && legacyServerDataPath && fs.existsSync(legacyServerDataPath)) {
    fs.renameSync(legacyServerDataPath, serverDataPath);
  }

  let serverData = getDefaultServerData();

  if (fs.existsSync(serverDataPath)) {
    // An empty file still passes existsSync, so an interrupted write reaches
    // JSON.parse as "" and throws. Losing the counters is annoying; refusing to
    // boot the label printer because of them is worse. Keep the damaged file so
    // the numbers can be recovered by hand, then carry on with defaults.
    try {
      serverData = normalizeServerData(JSON.parse(fs.readFileSync(serverDataPath, 'utf8')));
    } catch (error) {
      const quarantinePath = `${serverDataPath}.corrupt-${Date.now()}`;

      try {
        fs.renameSync(serverDataPath, quarantinePath);
        errorLogStamp(
          `Server data at ${serverDataPath} was unreadable (${error.message}).`
          + ` Moved it to ${quarantinePath} and started from defaults.`
        );
      } catch (renameError) {
        errorLogStamp(
          `Server data at ${serverDataPath} was unreadable (${error.message})`
          + ` and could not be set aside (${renameError.message}). Starting from defaults.`
        );
      }

      serverData = getDefaultServerData();
      writeFileAtomic(serverDataPath, stringifyServerData(serverData));
    }
  } else {
    writeFileAtomic(serverDataPath, stringifyServerData(serverData));
  }

  const persist = () => {
    serverData.dataVersion = DATA_VERSION;
    writeFileAtomic(serverDataPath, stringifyServerData(serverData));
  };

  const getLogSnapshot = () => (logStats?.getSnapshot ? logStats.getSnapshot() : {});

  const buildMergedPrinterCache = () => {
    const logSnapshot = getLogSnapshot();
    const logPrinters = logSnapshot.printers || {};
    const knownPrinterIds = new Set([
      ...Object.keys(serverData.printers || {}),
      ...Object.keys(logPrinters),
      ...Array.from(configuredPrinterIds),
    ]);

    return Object.fromEntries(
      Array.from(knownPrinterIds).map(printerId => {
        const cachedEntry = normalizePrinterCacheEntry(serverData.printers?.[printerId]);
        const logEntry = logPrinters[printerId] || {};
        const mergedEntry = {
          ...cachedEntry,
          online: cachedEntry.online !== false,
        };

        COUNTER_KEYS.forEach(counterKey => {
          mergedEntry[counterKey] = normalizeCounter(logEntry[counterKey]);
        });

        return [printerId, mergedEntry];
      })
    );
  };

  const syncPrinterCache = () => {
    serverData.printers = buildMergedPrinterCache();
    persist();
    return serverData.printers;
  };

  const getData = () => {
    const logSnapshot = getLogSnapshot();
    return {
      ...serverData,
      ...logSnapshot,
      printers: buildMergedPrinterCache(),
    };
  };

  serverData.lastStartedAt = getNowIso();
  syncPrinterCache();

  return {
    getData,
    addPrintJobListener(listener) {
      if (typeof listener === 'function') {
        printJobListeners.push(listener);
      }
    },
    async addPrintJob(printJob) {
      if (logStats?.addPrintJob) {
        await logStats.addPrintJob(printJob);
      }

      syncPrinterCache();
      printJobListeners.forEach(listener => listener(printJob));
      return printJob;
    },
    incrementPrintCounter() {
      return getLogSnapshot().printCounter || 0;
    },
    incrementPageHits() {
      serverData.pageHits += 1;
      if (logStats?.addPageHit) {
        logStats.addPageHit(getNowIso());
      }
      persist();
      return serverData.pageHits;
    },
    getPrinterPreferences(printerId) {
      if (!printerId) {
        return {};
      }

      return serverData.printerPreferences?.[printerId] || {};
    },
    setPrinterPreference(printerId, key, value) {
      if (!printerId || !key) {
        return null;
      }

      if (!serverData.printerPreferences || typeof serverData.printerPreferences !== 'object') {
        serverData.printerPreferences = {};
      }

      const currentPreferences = serverData.printerPreferences[printerId] || {};
      serverData.printerPreferences[printerId] = {
        ...currentPreferences,
        [key]: value,
      };
      persist();
      return serverData.printerPreferences[printerId];
    },
    isPrinterOnline(printerId) {
      return normalizePrinterCacheEntry(serverData.printers?.[printerId]).online;
    },
    setPrinterOnline(printerId, online) {
      if (!printerId) {
        return null;
      }

      serverData.printers[printerId] = {
        ...normalizePrinterCacheEntry(serverData.printers?.[printerId]),
        online: online !== false,
      };
      persist();
      return serverData.printers[printerId];
    },
    syncPrinterCache,
    setConfiguredPrinters(printerIds = []) {
      configuredPrinterIds.clear();
      printerIds.forEach(printerId => {
        if (printerId) {
          configuredPrinterIds.add(printerId);
        }
      });

      syncPrinterCache();
    },
  };
};

module.exports = {
  createServerSave,
};
