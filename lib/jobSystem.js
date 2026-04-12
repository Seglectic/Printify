// ╭──────────────────────────╮
// │  jobSystem.js            │
// │  Shared job lifecycle    │
// │  ids, checksums, logs,   │
// │  and live queue state    │
// ╰──────────────────────────╯
const crypto = require('crypto');
const fs = require('fs');
const moment = require('moment');
const path = require('path');
const { toLoggedPath } = require('./filePaths');
const { compactObject } = require('./logger');

const DEFAULT_STALE_JOB_MS = 10 * 60 * 1000;
const DEFAULT_TERMINAL_JOB_MS = 1500;
const DEFAULT_BROADCAST_DEBOUNCE_MS = 30;
const ISO_LOG_FORMAT = moment.HTML5_FMT.DATETIME_LOCAL_MS;


// ┌──────────────────────┐
// │  Sortable job ids    │
// └──────────────────────┘
const UUID_GREGORIAN_OFFSET_100NS = 122192928000000000n;
const UUID_100NS_PER_MILLISECOND = 10000n;
let lastUuidTimestamp = 0n;
const uuidNodeId = crypto.randomBytes(6);

const formatUuidBytes = bytes => [
  bytes.subarray(0, 4).toString('hex'),
  bytes.subarray(4, 6).toString('hex'),
  bytes.subarray(6, 8).toString('hex'),
  bytes.subarray(8, 10).toString('hex'),
  bytes.subarray(10, 16).toString('hex'),
].join('-');

// UUIDv6 keeps time in the leading bits, which makes bursts of print work
// easier to trace across logs, queue state, and duplicate-confirm follow-ups.
const createJobId = () => {
  let timestamp100ns = UUID_GREGORIAN_OFFSET_100NS + (BigInt(Date.now()) * UUID_100NS_PER_MILLISECOND);

  if (timestamp100ns <= lastUuidTimestamp) {
    timestamp100ns = lastUuidTimestamp + 1n;
  }

  lastUuidTimestamp = timestamp100ns;

  const clockSeq = crypto.randomBytes(2);
  const bytes = Buffer.alloc(16);
  const timestampHex = timestamp100ns.toString(16).padStart(15, '0');

  bytes.write(timestampHex.slice(0, 8), 0, 'hex');
  bytes.write(timestampHex.slice(8, 12), 4, 'hex');
  bytes[6] = 0x60 | Number.parseInt(timestampHex.slice(12, 13), 16);
  bytes[7] = Number.parseInt(timestampHex.slice(13, 15), 16);
  bytes[8] = 0x80 | (clockSeq[0] & 0x3f);
  bytes[9] = clockSeq[1];
  uuidNodeId.copy(bytes, 10);

  return formatUuidBytes(bytes);
};


// ┌──────────────────────┐
// │  Checksum helpers    │
// └──────────────────────┘
const createFileChecksum = filePath => new Promise((resolve, reject) => {
  if (!filePath) {
    resolve(null);
    return;
  }

  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);

  stream.on('data', chunk => {
    hash.update(chunk);
  });

  stream.on('error', reject);
  stream.on('end', () => {
    resolve(hash.digest('hex'));
  });
});


// ┌──────────────────────┐
// │  Log entry shaping   │
// └──────────────────────┘
const createJobLogEntry = ({
  filePath,
  printerConfig,
  testing,
  result,
  fileSizeBytes,
  chksum,
  isReprint,
  reprintSourceTimestamp,
  originalFilename,
  sourceFilePath,
  sourceType,
  sourceRoute,
  sourceArchiveName,
  bundledSourceCount,
  pages,
  paperAreaSquareMm,
  copyIndex,
  totalCopies,
  tapeWidthMm,
  lengthMm,
  transportResponse,
  error,
}) => compactObject({
  jobId: createJobId(),
  timestamp: moment().format(ISO_LOG_FORMAT),
  printerId: printerConfig?.id,
  printerName: printerConfig?.driverName,
  printMode: printerConfig?.printMode,
  originalFilename: originalFilename || path.basename(filePath),
  filePath: toLoggedPath(filePath),
  sourceFilePath: sourceFilePath && sourceFilePath !== filePath ? toLoggedPath(sourceFilePath) : null,
  fileSizeBytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
  chksum: chksum || null,
  isReprint: Boolean(isReprint || sourceType === 'log-reprint'),
  reprintSourceTimestamp: reprintSourceTimestamp || null,
  testing: Boolean(testing),
  result,
  sourceType: sourceType || null,
  sourceRoute: sourceRoute || null,
  sourceArchiveName: sourceArchiveName || null,
  bundledSourceCount: Number.isInteger(bundledSourceCount) ? bundledSourceCount : null,
  pages: Number.isInteger(pages) && pages > 0 ? pages : null,
  paperAreaSquareMm: Number.isFinite(paperAreaSquareMm) ? Math.round(paperAreaSquareMm * 100) / 100 : null,
  copyIndex: Number.isInteger(copyIndex) ? copyIndex : null,
  totalCopies: Number.isInteger(totalCopies) ? totalCopies : null,
  tapeWidthMm: Number.isFinite(tapeWidthMm) ? tapeWidthMm : null,
  lengthMm: Number.isFinite(lengthMm) ? lengthMm : null,
  transportResponse: transportResponse || null,
  error: error ? error.message : null,
});


// ┌──────────────────────┐
// │  Queue state helpers │
// └──────────────────────┘
const clampProgress = value => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.min(1, Math.max(0, numericValue));
};

const isTerminalJobState = state => state === 'success' || state === 'error';

const createJobSystem = ({
  staleJobMs = DEFAULT_STALE_JOB_MS,
  terminalJobMs = DEFAULT_TERMINAL_JOB_MS,
  broadcastDebounceMs = DEFAULT_BROADCAST_DEBOUNCE_MS,
  onQueueChange = () => {},
  logStamp = () => {},
  errorLogStamp = () => {},
} = {}) => {
  const jobs = new Map();
  let emitTimer = null;
  let sequence = 0;

  const toPublicJob = job => ({
    id: job.id,
    groupId: job.groupId || null,
    clientJobId: job.clientJobId || null,
    printerId: job.printerId || null,
    originalFilename: job.originalFilename || null,
    sourceRoute: job.sourceRoute || null,
    sourceType: job.sourceType || null,
    state: job.state,
    statusIcon: job.statusIcon,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    settledAt: job.settledAt || null,
    copyIndex: job.copyIndex ?? null,
    totalCopies: job.totalCopies ?? null,
    message: job.message || null,
    error: job.error || null,
  });

  const getVisiblePublicJobs = () => Array.from(jobs.values())
    .sort((left, right) => left.sequence - right.sequence)
    .map(toPublicJob);

  const emitQueueChange = () => {
    emitTimer = null;
    onQueueChange({
      type: 'job-queue-updated',
      jobs: getVisiblePublicJobs(),
    });
  };

  const queueQueueChange = () => {
    if (emitTimer) {
      return;
    }

    emitTimer = setTimeout(() => {
      emitQueueChange();
    }, broadcastDebounceMs);
  };

  const clearJobTimers = job => {
    if (job?.staleTimer) {
      clearTimeout(job.staleTimer);
      job.staleTimer = null;
    }

    if (job?.cleanupTimer) {
      clearTimeout(job.cleanupTimer);
      job.cleanupTimer = null;
    }
  };

  const removeTrackedJob = jobId => {
    const job = jobs.get(jobId);

    if (!job) {
      return;
    }

    clearJobTimers(job);
    jobs.delete(jobId);
    queueQueueChange();
  };

  const scheduleJobCleanup = (job, durationMs) => {
    if (!job) {
      return;
    }

    if (job.cleanupTimer) {
      clearTimeout(job.cleanupTimer);
    }

    job.cleanupTimer = setTimeout(() => {
      removeTrackedJob(job.id);
    }, durationMs);
  };

  const scheduleStaleTimeout = job => {
    if (!job) {
      return;
    }

    if (job.staleTimer) {
      clearTimeout(job.staleTimer);
    }

    job.staleTimer = setTimeout(() => {
      const staleJob = jobs.get(job.id);

      if (!staleJob || staleJob.state === 'success' || staleJob.state === 'error') {
        return;
      }

      staleJob.state = 'error';
      staleJob.statusIcon = 'error';
      staleJob.progress = 1;
      staleJob.updatedAt = Date.now();
      staleJob.settledAt = staleJob.updatedAt;
      staleJob.error = staleJob.error || 'Job timed out before the server marked it complete';
      queueQueueChange();
      scheduleJobCleanup(staleJob, terminalJobMs);
    }, staleJobMs);
  };

  const ensureTrackedJob = ({
    id,
    groupId,
    clientJobId,
    printerId,
    originalFilename,
    sourceRoute,
    sourceType,
    copyIndex = null,
    totalCopies = null,
  } = {}) => {
    const jobId = String(id || createJobId()).trim() || createJobId();
    const now = Date.now();
    const existingJob = jobs.get(jobId);

    if (existingJob) {
      existingJob.groupId = groupId || existingJob.groupId || null;
      existingJob.clientJobId = clientJobId || existingJob.clientJobId || null;
      existingJob.printerId = printerId || existingJob.printerId || null;
      existingJob.originalFilename = originalFilename || existingJob.originalFilename || null;
      existingJob.sourceRoute = sourceRoute || existingJob.sourceRoute || null;
      existingJob.sourceType = sourceType || existingJob.sourceType || null;
      existingJob.copyIndex = copyIndex ?? existingJob.copyIndex ?? null;
      existingJob.totalCopies = totalCopies ?? existingJob.totalCopies ?? null;
      existingJob.updatedAt = now;
      return existingJob;
    }

    const job = {
      id: jobId,
      sequence,
      groupId: groupId || null,
      clientJobId: clientJobId || null,
      printerId: printerId || null,
      originalFilename: originalFilename || null,
      sourceRoute: sourceRoute || null,
      sourceType: sourceType || null,
      state: 'queued',
      statusIcon: 'working',
      progress: 0.08,
      createdAt: now,
      updatedAt: now,
      settledAt: null,
      copyIndex,
      totalCopies,
      message: null,
      error: null,
      staleTimer: null,
      cleanupTimer: null,
    };

    sequence += 1;
    jobs.set(jobId, job);
    scheduleStaleTimeout(job);
    return job;
  };

  const updateTrackedJob = (jobId, patch = {}) => {
    const job = jobs.get(jobId);

    if (!job) {
      return null;
    }

    if (patch.printerId !== undefined) job.printerId = patch.printerId || null;
    if (patch.originalFilename !== undefined) job.originalFilename = patch.originalFilename || null;
    if (patch.sourceRoute !== undefined) job.sourceRoute = patch.sourceRoute || null;
    if (patch.sourceType !== undefined) job.sourceType = patch.sourceType || null;
    if (patch.copyIndex !== undefined) job.copyIndex = patch.copyIndex ?? null;
    if (patch.totalCopies !== undefined) job.totalCopies = patch.totalCopies ?? null;
    if (patch.state !== undefined) job.state = patch.state;
    if (patch.statusIcon !== undefined) job.statusIcon = patch.statusIcon;
    if (patch.message !== undefined) job.message = patch.message || null;
    if (patch.error !== undefined) job.error = patch.error || null;

    const nextProgress = clampProgress(patch.progress);
    if (nextProgress !== null) {
      job.progress = nextProgress;
    }

    job.updatedAt = Date.now();

    if (job.state === 'success' || job.state === 'error') {
      job.settledAt = job.updatedAt;
      clearJobTimers(job);
      scheduleJobCleanup(job, terminalJobMs);
    } else {
      scheduleStaleTimeout(job);
    }

    queueQueueChange();
    return job;
  };

  const startTrackedJob = jobMeta => {
    const job = ensureTrackedJob(jobMeta);
    updateTrackedJob(job.id, {
      state: 'printing',
      statusIcon: 'working',
      progress: 0.82,
      message: 'Sending to printer',
    });
    return job.id;
  };

  const markJobPrinting = (jobId, patch = {}) => updateTrackedJob(jobId, {
    ...patch,
    state: 'printing',
    statusIcon: 'working',
    progress: patch.progress ?? 0.82,
    message: patch.message || 'Sending to printer',
  });

  const completeTrackedJob = (jobId, patch = {}) => updateTrackedJob(jobId, {
    ...patch,
    state: 'success',
    statusIcon: 'success',
    progress: 1,
    error: null,
    message: patch.message || 'Print job completed',
  });

  const failTrackedJob = (jobId, error, patch = {}) => updateTrackedJob(jobId, {
    ...patch,
    state: 'error',
    statusIcon: 'error',
    progress: 1,
    error: error ? String(error.message || error) : (patch.error || 'Print job failed'),
    message: patch.message || 'Print job failed',
  });


  // ┌──────────────────────┐
  // │  Public API          │
  // └──────────────────────┘
  return {
    createJobId,
    createFileChecksum,
    createJobLogEntry,
    startTrackedJob,
    markJobPrinting,
    completeTrackedJob,
    failTrackedJob,
    updateTrackedJob,
    ensureTrackedJob,
    removeTrackedJob,
    getPublicJobs: () => Array.from(jobs.values())
      .sort((left, right) => left.sequence - right.sequence)
      .map(toPublicJob),
    getActiveJobs: getVisiblePublicJobs,
    clearAll: () => {
      try {
        Array.from(jobs.values()).forEach(clearJobTimers);
      } catch (error) {
        errorLogStamp('Job system cleanup failed:', error.message);
      }

      if (emitTimer) {
        clearTimeout(emitTimer);
        emitTimer = null;
      }

      jobs.clear();
      queueQueueChange();
    },
    debugLog: (...args) => logStamp('[id-debug]', ...args),
    debugError: (...args) => errorLogStamp('[id-debug]', ...args),
  };
};

module.exports = {
  createJobSystem,
};
