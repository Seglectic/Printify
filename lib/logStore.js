// ╭──────────────────────────╮
// │  logStore.js             │
// │  Monthly NDJSON-backed   │
// │  print job storage       │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');

const RECENT_BUFFER_LIMIT = 500;

const buildJobKey = printJob => [
  printJob?.jobId || '',
  printJob?.timestamp || '',
  printJob?.printerId || '',
  printJob?.chksum || '',
  printJob?.filePath || '',
].join('|');

const parseTimestamp = timestamp => {
  const parsedTime = Date.parse(timestamp);
  return Number.isFinite(parsedTime) ? parsedTime : null;
};

const formatMonthKeyForDate = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const getMonthKey = timestamp => {
  const parsedTime = parseTimestamp(timestamp);
  const date = parsedTime === null ? new Date() : new Date(parsedTime);
  return formatMonthKeyForDate(date);
};

const getMonthFilePath = (logsDir, monthKey) => path.join(logsDir, `${monthKey}.ndjson`);
const isNonReprintJob = printJob => printJob && !printJob.isReprint;
const compareJobsNewestFirst = (leftJob, rightJob) => {
  const rightTime = parseTimestamp(rightJob.timestamp) ?? 0;
  const leftTime = parseTimestamp(leftJob.timestamp) ?? 0;

  if (rightTime !== leftTime) {
    return rightTime - leftTime;
  }

  return String(rightJob.jobId || '').localeCompare(String(leftJob.jobId || ''));
};

const getMonthKeysInRange = (startTime, endTime) => {
  const monthKeys = [];
  const cursor = new Date(startTime);

  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= endTime) {
    monthKeys.push(formatMonthKeyForDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return monthKeys;
};


// ┌──────────────────────┐
// │  Log store service   │
// └──────────────────────┘
const createLogStore = ({
  logsDir,
  errorLogStamp,
}) => {
  fs.mkdirSync(logsDir, { recursive: true });

  const monthCache = new Map();
  const recentBuffer = [];
  let writeQueue = Promise.resolve();

  const loadMonthJobs = async monthKey => {
    if (monthCache.has(monthKey)) {
      return monthCache.get(monthKey);
    }

    const monthFilePath = getMonthFilePath(logsDir, monthKey);

    try {
      const rawContent = await fs.promises.readFile(monthFilePath, 'utf8');
      const jobs = rawContent
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
      monthCache.set(monthKey, jobs);
      return jobs;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errorLogStamp(`Log read failed for ${monthKey}:`, error.message);
      }

      const jobs = [];
      monthCache.set(monthKey, jobs);
      return jobs;
    }
  };

  const appendJobToRecentBuffer = printJob => {
    recentBuffer.push(printJob);

    if (recentBuffer.length > RECENT_BUFFER_LIMIT) {
      recentBuffer.splice(0, recentBuffer.length - RECENT_BUFFER_LIMIT);
    }
  };

  const addPrintJob = async printJob => {
    const monthKey = getMonthKey(printJob.timestamp);
    const monthFilePath = getMonthFilePath(logsDir, monthKey);
    const serializedPrintJob = `${JSON.stringify(printJob)}\n`;

    appendJobToRecentBuffer(printJob);

    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
      await fs.promises.mkdir(logsDir, { recursive: true });
      await fs.promises.appendFile(monthFilePath, serializedPrintJob, 'utf8');

      if (monthCache.has(monthKey)) {
        monthCache.get(monthKey).push(printJob);
      }
      });

    return writeQueue;
  };

  const getRecentJobs = async ({ lookBackMinutes }) => {
    const now = Date.now();
    const lookbackMs = lookBackMinutes * 60 * 1000;
    const cutoffTime = now - lookbackMs;
    const monthKeys = getMonthKeysInRange(cutoffTime, now);
    const jobsByKey = new Map();
    const monthJobs = await Promise.all(monthKeys.map(loadMonthJobs));

    monthJobs.flat().forEach(printJob => {
      jobsByKey.set(buildJobKey(printJob), printJob);
    });

    recentBuffer.forEach(printJob => {
      jobsByKey.set(buildJobKey(printJob), printJob);
    });

    return Array.from(jobsByKey.values())
      .filter(printJob => {
        const timestamp = parseTimestamp(printJob.timestamp);
        return timestamp !== null && timestamp >= cutoffTime;
      })
      .sort(compareJobsNewestFirst);
  };

  const findPrintJob = async ({ timestamp, printerId, chksum }) => {
    if (!timestamp || !printerId) {
      return null;
    }

    const monthJobs = await loadMonthJobs(getMonthKey(timestamp));

    return monthJobs.find(printJob => (
      printJob
      && printJob.timestamp === timestamp
      && printJob.printerId === printerId
      && printJob.chksum === chksum
    )) || recentBuffer.find(printJob => (
      printJob
      && printJob.timestamp === timestamp
      && printJob.printerId === printerId
      && printJob.chksum === chksum
    )) || null;
  };

  const findOriginalJob = async ({ chksum, beforeTimestamp = null }) => {
    if (!chksum) {
      return null;
    }

    const beforeTime = beforeTimestamp ? parseTimestamp(beforeTimestamp) : null;
    const recentMatch = recentBuffer
      .filter(printJob => (
        isNonReprintJob(printJob)
        && printJob.chksum === chksum
        && (beforeTime === null || ((parseTimestamp(printJob.timestamp) ?? 0) < beforeTime))
      ))
      .sort(compareJobsNewestFirst)[0] || null;

    if (recentMatch) {
      return recentMatch;
    }

    const monthKeys = (await fs.promises.readdir(logsDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^\d{4}-\d{2}\.ndjson$/.test(entry.name))
      .map(entry => entry.name.replace(/\.ndjson$/, ''))
      .sort()
      .reverse();

    for (const monthKey of monthKeys) {
      const monthJobs = await loadMonthJobs(monthKey);
      const originalJob = monthJobs
        .filter(printJob => (
          isNonReprintJob(printJob)
          && printJob.chksum === chksum
          && (beforeTime === null || ((parseTimestamp(printJob.timestamp) ?? 0) < beforeTime))
        ))
        .sort(compareJobsNewestFirst)[0] || null;

      if (originalJob) {
        return originalJob;
      }
    }

    return null;
  };

  const findRecentJobByChecksum = async ({ chksum, lookBackMinutes, includeReprints = false }) => {
    if (!chksum) {
      return null;
    }

    const recentJobs = await getRecentJobs({ lookBackMinutes });

    return recentJobs.find(printJob => (
      printJob
      && printJob.chksum === chksum
      && printJob.result !== 'failed'
      && (includeReprints || isNonReprintJob(printJob))
    )) || null;
  };

  const purgeAll = async () => {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        recentBuffer.splice(0, recentBuffer.length);
        monthCache.clear();
        await fs.promises.rm(logsDir, { recursive: true, force: true });
        await fs.promises.mkdir(logsDir, { recursive: true });
      });

    return writeQueue;
  };

  return {
    addPrintJob,
    findPrintJob,
    findOriginalJob,
    findRecentJobByChecksum,
    getRecentJobs,
    purgeAll,
  };
};

module.exports = {
  createLogStore,
};
