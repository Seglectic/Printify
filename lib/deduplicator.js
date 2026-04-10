// ╭──────────────────────────╮
// │  deduplicator.js         │
// │  In-memory recent        │
// │  duplicate cache         │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');


// ┌──────────────────────┐
// │  Date helpers        │
// └──────────────────────┘
const DEDUPE_LOOKBACK_DAYS = 30;

const parseTimestamp = timestamp => {
  const parsedTime = Date.parse(timestamp);
  return Number.isFinite(parsedTime) ? parsedTime : null;
};

const formatMonthKeyForTime = time => {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const getMonthFilePath = (logsDir, monthKey) => path.join(logsDir, `${monthKey}.ndjson`);

const getMonthKeysInRange = (startTime, endTime) => {
  const monthKeys = [];
  const cursor = new Date(startTime);

  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= endTime) {
    monthKeys.push(formatMonthKeyForTime(cursor.getTime()));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return monthKeys;
};

const isEligibleDuplicateSource = entry => (
  entry
  && entry.chksum
  && entry.printerId
  && entry.result !== 'failed'
  && !entry.isReprint
);

const buildChecksumKey = ({ chksum, printerId }) => `${printerId}::${chksum}`;


// ┌──────────────────────┐
// │  Cache service       │
// └──────────────────────┘
const createDeduplicator = ({
  logsDir,
  logStamp,
  errorLogStamp,
}) => {
  const recentEntries = new Map();
  let initialized = false;

  const getCutoffTime = () => (
    Date.now() - (DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  );

  const pruneExpiredEntries = () => {
    const cutoffTime = getCutoffTime();

    recentEntries.forEach((entry, key) => {
      if ((parseTimestamp(entry.timestamp) ?? 0) < cutoffTime) {
        recentEntries.delete(key);
      }
    });
  };

  const rememberEntry = entry => {
    if (!isEligibleDuplicateSource(entry)) {
      return;
    }

    const timestamp = parseTimestamp(entry.timestamp);
    if (timestamp === null || timestamp < getCutoffTime()) {
      return;
    }

    const cacheKey = buildChecksumKey(entry);
    const currentEntry = recentEntries.get(cacheKey);

    if (!currentEntry || (parseTimestamp(currentEntry.timestamp) ?? 0) <= timestamp) {
      recentEntries.set(cacheKey, {
        chksum: entry.chksum,
        timestamp: entry.timestamp,
        printerId: entry.printerId,
        printerName: entry.printerName || null,
        filePath: entry.filePath || null,
        originalFilename: entry.originalFilename || null,
        sourceType: entry.sourceType || null,
        result: entry.result || null,
        isReprint: Boolean(entry.isReprint),
      });
    }
  };

  const loadMonthEntries = async monthKey => {
    const monthFilePath = getMonthFilePath(logsDir, monthKey);

    try {
      const rawContent = await fs.promises.readFile(monthFilePath, 'utf8');
      return rawContent
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .flatMap(line => {
          try {
            return [JSON.parse(line)];
          } catch (error) {
            errorLogStamp(`Skipping malformed log line in ${monthKey}:`, error.message);
            return [];
          }
        });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errorLogStamp(`Deduplicator warmup failed for ${monthKey}:`, error.message);
      }

      return [];
    }
  };

  const initialize = async () => {
    if (initialized) {
      pruneExpiredEntries();
      return {
        entryCount: recentEntries.size,
        lookbackDays: DEDUPE_LOOKBACK_DAYS,
      };
    }

    logStamp(`Building ${DEDUPE_LOOKBACK_DAYS}-day duplicate cache from recent logs...`);

    const now = Date.now();
    const monthKeys = getMonthKeysInRange(getCutoffTime(), now);
    const monthEntries = await Promise.all(monthKeys.map(loadMonthEntries));

    monthEntries.flat().forEach(rememberEntry);
    pruneExpiredEntries();
    initialized = true;

    logStamp(`Deduplicator ready with ${recentEntries.size} recent entries`);

    return {
      entryCount: recentEntries.size,
      lookbackDays: DEDUPE_LOOKBACK_DAYS,
    };
  };

  const addPrintJob = async printJob => {
    pruneExpiredEntries();
    rememberEntry(printJob);
  };

  const findRecentDuplicate = async ({ chksum, printerId }) => {
    if (!chksum || !printerId) {
      return null;
    }

    pruneExpiredEntries();
    return recentEntries.get(buildChecksumKey({ chksum, printerId })) || null;
  };

  const getStats = () => {
    pruneExpiredEntries();

    return {
      initialized,
      entryCount: recentEntries.size,
      lookbackDays: DEDUPE_LOOKBACK_DAYS,
    };
  };

  const purgeAll = () => {
    recentEntries.clear();
    initialized = false;
  };

  return {
    addPrintJob,
    findRecentDuplicate,
    getStats,
    initialize,
    purgeAll,
  };
};

module.exports = {
  createDeduplicator,
};
