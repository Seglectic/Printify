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
  });

  const normalizeServerData = rawServerData => {
    const nextServerData = {
      ...getDefaultServerData(),
      pageHits: rawServerData?.pageHits,
      lastStartedAt: rawServerData?.lastStartedAt,
      dataVersion: rawServerData?.dataVersion,
    };

    nextServerData.dataVersion = nextServerData.dataVersion || DATA_VERSION;

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
  };
};

module.exports = {
  createServerSave,
};
