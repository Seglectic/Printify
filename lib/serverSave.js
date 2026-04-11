// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  print-count storage     │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');
const moment = require('moment');

const PRETTY_PRINT_SPACES = 2;
const DATA_VERSION = '2.0';

const getNowIso = () => moment().format(moment.HTML5_FMT.DATETIME_LOCAL_MS);


// ┌───────────────────────┐
// │  Save file wrapper    │
// └───────────────────────┘
const createServerSave = ({
  serverDataPath,
  logStats = null,
  onPrintJobSaved = () => {},
}) => {
  const printJobListeners = [onPrintJobSaved];
  const getDefaultServerData = () => ({
    pageHits:     0,
    lastStartedAt: null,
    dataVersion: DATA_VERSION,
    printerPreferences: {},
  });

  const normalizeServerData = rawServerData => {
    const nextServerData = {
      ...getDefaultServerData(),
      pageHits: rawServerData?.pageHits,
      lastStartedAt: rawServerData?.lastStartedAt,
      dataVersion: rawServerData?.dataVersion,
      printerPreferences: rawServerData?.printerPreferences,
    };

    nextServerData.dataVersion = nextServerData.dataVersion || DATA_VERSION;
    nextServerData.printerPreferences = rawServerData?.printerPreferences && typeof rawServerData.printerPreferences === 'object'
      ? rawServerData.printerPreferences
      : {};

    return nextServerData;
  };

  const stringifyServerData = value => `${JSON.stringify(value, null, PRETTY_PRINT_SPACES)}\n`;

  let serverData = getDefaultServerData();

  if (fs.existsSync(serverDataPath)) {
    serverData = normalizeServerData(JSON.parse(fs.readFileSync(serverDataPath, 'utf8')));
  } else {
    fs.writeFileSync(serverDataPath, stringifyServerData(serverData));
  }

  const persist = () => {
    fs.writeFileSync(serverDataPath, stringifyServerData(serverData));
  };

  serverData.lastStartedAt = getNowIso();
  serverData.dataVersion = DATA_VERSION;
  persist();

  return {
    getData: () => {
      const logSnapshot = logStats?.getSnapshot ? logStats.getSnapshot() : {};

      return {
      ...serverData,
      ...logSnapshot,
    };
    },
    addPrintJobListener(listener) {
      if (typeof listener === 'function') {
        printJobListeners.push(listener);
      }
    },
    addPrintJob(printJob) {
      if (logStats?.addPrintJob) {
        void logStats.addPrintJob(printJob);
      }

      persist();
      printJobListeners.forEach(listener => listener(printJob));
      return printJob;
    },
    incrementPrintCounter() {
      return logStats?.getSnapshot ? logStats.getSnapshot().printCounter : 0;
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
  };
};

module.exports = {
  createServerSave,
};
