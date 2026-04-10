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
  storedFilename,
  sourceType,
  sourceRoute,
  sourceArchiveName,
  bundledSourceCount,
  copyIndex,
  totalCopies,
  transportResponse,
  error,
}) => compactObject({
  timestamp: moment().format(isoLogFormat),
  printerId: printerConfig?.id,
  printerName: printerConfig?.driverName,
  printMode: printerConfig?.printMode,
  originalFilename: originalFilename || path.basename(filePath),
  storedFilename: storedFilename || (filePath ? path.basename(filePath) : null),
  filePath: filePath || null,
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
