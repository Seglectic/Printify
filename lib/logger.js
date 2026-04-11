// ╭──────────────────────────╮
// │  logger.js               │
// │  Shared log helpers      │
// │  shared across server    │
// │  modules                 │
// ╰──────────────────────────╯
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toLoggedPath } = require('./filePaths');


// ┌──────────────────────┐
// │  Shared log format   │
// └──────────────────────┘
const isoLogFormat = moment.HTML5_FMT.DATETIME_LOCAL_MS;

const compactObject = value => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => (
    entryValue !== null
    && entryValue !== undefined
    && entryValue !== ''
  ))
);

const logWith = (writer, args) => writer(...args);

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

// UUIDv6 keeps the timestamp in the leading bits, which gives us a stable,
// sortable job id for rapid reprint bursts without leaning on plain ISO time.
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
  transportResponse,
  error,
}) => compactObject({
  jobId: createJobId(),
  timestamp: moment().format(isoLogFormat),
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
  transportResponse: transportResponse || null,
  error: error ? error.message : null,
});

const logStamp      = (...args) => logWith(console.log, args);
const errorLogStamp = (...args) => logWith(console.error, args);

module.exports = {
  createFileChecksum,
  createJobLogEntry,
  compactObject,
  logStamp,
  errorLogStamp,
};
