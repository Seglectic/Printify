// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  print-count storage     │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');
const moment = require('moment');

const PRETTY_PRINT_SPACES = 2;
const DATA_VERSION = '1.0';

const compactObject = value => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => (
    entryValue !== null
    && entryValue !== undefined
    && entryValue !== ''
  ))
);

const getTodayKey = () => moment().format('YYYY-MM-DD');
const getNowIso = () => moment().format(moment.HTML5_FMT.DATETIME_LOCAL_MS);
const isSuccessfulPrintJob = printJob => printJob && printJob.result !== 'failed';


// ┌───────────────────────┐
// │  Save file wrapper    │
// └───────────────────────┘
const createServerSave = ({
  serverDataPath,
  onPrintJobSaved = () => {},
}) => {
  const printJobListeners = [onPrintJobSaved];
  const getDefaultServerData = () => ({
    pageHits:     0,
    printCounter: 0,
    lastStartedAt: null,
    lastPrintAt: null,
    lastPrintJob: null,
    dailyStats: {},
    dataVersion: DATA_VERSION,
  });

  const normalizeServerData = rawServerData => {
    const defaultServerData = getDefaultServerData();
    const nextServerData = {
      ...defaultServerData,
      ...(rawServerData || {}),
    };

    if (!nextServerData.dailyStats || typeof nextServerData.dailyStats !== 'object' || Array.isArray(nextServerData.dailyStats)) {
      nextServerData.dailyStats = {};
    }

    if (!nextServerData.lastPrintJob || typeof nextServerData.lastPrintJob !== 'object' || Array.isArray(nextServerData.lastPrintJob)) {
      nextServerData.lastPrintJob = null;
    }

    nextServerData.dataVersion = nextServerData.dataVersion || DATA_VERSION;

    if (!nextServerData.lastPrintAt || !nextServerData.lastPrintJob) {
      const legacyPrintJobs = Array.isArray(rawServerData?.printJobs)
        ? rawServerData.printJobs.map(printJob => compactObject(printJob || {}))
        : [];
      const lastPrintJob = legacyPrintJobs
        .filter(isSuccessfulPrintJob)
        .sort((leftJob, rightJob) => Date.parse(rightJob.timestamp) - Date.parse(leftJob.timestamp))[0] || null;

      if (lastPrintJob) {
        nextServerData.lastPrintAt = nextServerData.lastPrintAt || lastPrintJob.timestamp || null;
        nextServerData.lastPrintJob = nextServerData.lastPrintJob || lastPrintJob;
      }
    }

    return nextServerData;
  };

  const stringifyServerData = value => `${JSON.stringify(value, null, PRETTY_PRINT_SPACES)}\n`;
  const ensureDailyStatsEntry = dateKey => {
    if (!serverData.dailyStats[dateKey] || typeof serverData.dailyStats[dateKey] !== 'object') {
      serverData.dailyStats[dateKey] = {
        prints: 0,
        pageHits: 0,
      };
    }
  };

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
    getData: () => ({ ...serverData }),
    addPrintJobListener(listener) {
      if (typeof listener === 'function') {
        printJobListeners.push(listener);
      }
    },
    addPrintJob(printJob) {
      const normalizedPrintJob = compactObject(printJob || {});

      if (normalizedPrintJob.result !== 'failed') {
        const todayKey = getTodayKey();
        ensureDailyStatsEntry(todayKey);
        serverData.dailyStats[todayKey].prints += 1;
        serverData.lastPrintAt = normalizedPrintJob.timestamp || getNowIso();
        serverData.lastPrintJob = normalizedPrintJob;
      }

      persist();
      printJobListeners.forEach(listener => listener(printJob));
      return printJob;
    },
    incrementPrintCounter() {
      serverData.printCounter += 1;
      persist();
      return serverData.printCounter;
    },
    incrementPageHits() {
      const todayKey = getTodayKey();
      ensureDailyStatsEntry(todayKey);
      serverData.pageHits += 1;
      serverData.dailyStats[todayKey].pageHits += 1;
      persist();
      return serverData.pageHits;
    },
  };
};

module.exports = {
  createServerSave,
};
