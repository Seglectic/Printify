// ╭──────────────────────────╮
// │  logStats.js             │
// │  In-memory print stats   │
// │  rebuilt from log files  │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');


// ┌──────────────────────┐
// │  Shared stat shapes  │
// └──────────────────────┘
const normalizeCounter = value => (Number.isFinite(value) && value > 0 ? value : 0);
const roundSquareMillimeters = value => (
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
);

const getDefaultTotals = () => ({
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

const getDefaultDailyStats = () => ({
  prints: 0,
  pageHits: 0,
  pages: 0,
  actualPages: 0,
  testingPages: 0,
  paperAreaSquareMm: 0,
  actualPaperAreaSquareMm: 0,
  testingPaperAreaSquareMm: 0,
});

const getDefaultPrinterStats = () => ({
  ...getDefaultTotals(),
});

const compactObject = value => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => (
    entryValue !== null
    && entryValue !== undefined
    && entryValue !== ''
  ))
);

const parseTimestamp = timestamp => {
  const parsedTime = Date.parse(timestamp);
  return Number.isFinite(parsedTime) ? parsedTime : null;
};

const getDateKey = timestamp => {
  const parsedTime = parseTimestamp(timestamp);
  const date = parsedTime === null ? new Date() : new Date(parsedTime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isSuccessfulPrintJob = printJob => printJob && printJob.result !== 'failed';


// ┌──────────────────────┐
// │  Stats cache         │
// └──────────────────────┘
const createLogStats = ({
  logsDir,
  printerRegistry = {},
  logStamp,
  errorLogStamp,
}) => {
  let initialized = false;
  let totals = getDefaultTotals();
  let dailyStats = {};
  let printers = {};
  let lastPrintAt = null;
  let lastPrintJob = null;

  const resetState = () => {
    totals = getDefaultTotals();
    dailyStats = {};
    printers = Object.fromEntries(
      Object.keys(printerRegistry || {}).map(printerId => [printerId, getDefaultPrinterStats()])
    );
    lastPrintAt = null;
    lastPrintJob = null;
  };

  const ensureDailyStatsEntry = dateKey => {
    if (!dailyStats[dateKey] || typeof dailyStats[dateKey] !== 'object' || Array.isArray(dailyStats[dateKey])) {
      dailyStats[dateKey] = getDefaultDailyStats();
    }

    return dailyStats[dateKey];
  };

  const ensurePrinterStatsEntry = printerId => {
    if (!printerId) {
      return null;
    }

    if (!printers[printerId] || typeof printers[printerId] !== 'object' || Array.isArray(printers[printerId])) {
      printers[printerId] = getDefaultPrinterStats();
    }

    return printers[printerId];
  };

  const applyPrintJob = printJob => {
    if (!isSuccessfulPrintJob(printJob)) {
      return;
    }

    const normalizedPrintJob = compactObject(printJob || {});
    const pages = normalizeCounter(normalizedPrintJob.pages);
    const paperAreaSquareMm = roundSquareMillimeters(normalizedPrintJob.paperAreaSquareMm);
    const isTestingJob = Boolean(normalizedPrintJob.testing);
    const dateKey = getDateKey(normalizedPrintJob.timestamp);
    const dayStats = ensureDailyStatsEntry(dateKey);
    const printerStats = ensurePrinterStatsEntry(normalizedPrintJob.printerId);

    totals.printCounter += 1;
    totals.pageCounter += pages;
    totals.paperAreaSquareMm = roundSquareMillimeters(totals.paperAreaSquareMm + paperAreaSquareMm);

    if (isTestingJob) {
      totals.testingPrintCounter += 1;
      totals.testingPageCounter += pages;
      totals.testingPaperAreaSquareMm = roundSquareMillimeters(
        totals.testingPaperAreaSquareMm + paperAreaSquareMm
      );
    } else {
      totals.actualPrintCounter += 1;
      totals.actualPageCounter += pages;
      totals.actualPaperAreaSquareMm = roundSquareMillimeters(
        totals.actualPaperAreaSquareMm + paperAreaSquareMm
      );
    }

    dayStats.prints += 1;
    dayStats.pages += pages;
    dayStats.paperAreaSquareMm = roundSquareMillimeters(dayStats.paperAreaSquareMm + paperAreaSquareMm);

    if (isTestingJob) {
      dayStats.testingPages += pages;
      dayStats.testingPaperAreaSquareMm = roundSquareMillimeters(
        dayStats.testingPaperAreaSquareMm + paperAreaSquareMm
      );
    } else {
      dayStats.actualPages += pages;
      dayStats.actualPaperAreaSquareMm = roundSquareMillimeters(
        dayStats.actualPaperAreaSquareMm + paperAreaSquareMm
      );
    }

    if (printerStats) {
      printerStats.printCounter += 1;
      printerStats.pageCounter += pages;
      printerStats.paperAreaSquareMm = roundSquareMillimeters(
        printerStats.paperAreaSquareMm + paperAreaSquareMm
      );

      if (isTestingJob) {
        printerStats.testingPrintCounter += 1;
        printerStats.testingPageCounter += pages;
        printerStats.testingPaperAreaSquareMm = roundSquareMillimeters(
          printerStats.testingPaperAreaSquareMm + paperAreaSquareMm
        );
      } else {
        printerStats.actualPrintCounter += 1;
        printerStats.actualPageCounter += pages;
        printerStats.actualPaperAreaSquareMm = roundSquareMillimeters(
          printerStats.actualPaperAreaSquareMm + paperAreaSquareMm
        );
      }
    }

    const currentLastPrintTime = parseTimestamp(lastPrintAt) ?? 0;
    const nextPrintTime = parseTimestamp(normalizedPrintJob.timestamp) ?? 0;

    if (!lastPrintJob || nextPrintTime >= currentLastPrintTime) {
      lastPrintAt = normalizedPrintJob.timestamp || null;
      lastPrintJob = normalizedPrintJob;
    }
  };

  const initialize = async () => {
    if (initialized) {
      return {
        printCounter: totals.printCounter,
        printerCount: Object.keys(printers).length,
        dayCount: Object.keys(dailyStats).length,
      };
    }

    resetState();
    logStamp('Building in-memory print stats from log history...');

    let logEntries = [];

    try {
      const logFiles = (await fs.promises.readdir(logsDir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && /^\d{4}-\d{2}\.ndjson$/.test(entry.name))
        .map(entry => path.join(logsDir, entry.name))
        .sort();

      for (const filePath of logFiles) {
        const rawContent = await fs.promises.readFile(filePath, 'utf8');

        rawContent
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .forEach(line => {
            try {
              logEntries.push(JSON.parse(line));
            } catch (error) {
              errorLogStamp(`Skipping malformed log line in ${path.basename(filePath)}:`, error.message);
            }
          });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errorLogStamp('Log stats warmup failed:', error.message);
      }
    }

    logEntries
      .sort((leftJob, rightJob) => (parseTimestamp(leftJob?.timestamp) ?? 0) - (parseTimestamp(rightJob?.timestamp) ?? 0))
      .forEach(applyPrintJob);

    initialized = true;
    logEntries = [];

    logStamp(`Log stats ready with ${totals.printCounter} recorded prints`);

    return {
      printCounter: totals.printCounter,
      printerCount: Object.keys(printers).length,
      dayCount: Object.keys(dailyStats).length,
    };
  };

  const addPrintJob = async printJob => {
    applyPrintJob(printJob);
  };

  const addPageHit = timestamp => {
    const dateKey = getDateKey(timestamp);
    const dayStats = ensureDailyStatsEntry(dateKey);
    dayStats.pageHits += 1;
  };

  const getSnapshot = () => ({
    ...totals,
    lastPrintAt,
    lastPrintJob: lastPrintJob ? { ...lastPrintJob } : null,
    dailyStats: Object.fromEntries(
      Object.entries(dailyStats).map(([dateKey, value]) => [dateKey, { ...value }])
    ),
    printers: Object.fromEntries(
      Object.entries(printers).map(([printerId, value]) => [printerId, { ...value }])
    ),
  });

  const purgeAll = () => {
    resetState();
    initialized = false;
  };

  resetState();

  return {
    addPageHit,
    addPrintJob,
    getSnapshot,
    initialize,
    purgeAll,
  };
};

module.exports = {
  createLogStats,
};
