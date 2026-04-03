// ╭──────────────────────────╮
// │  logger.js               │
// │  Timestamped log helpers │
// │  shared across server    │
// │  modules                 │
// ╰──────────────────────────╯
const moment = require('moment');
const path = require('path');


// ┌──────────────────────┐
// │  Shared log format   │
// └──────────────────────┘
const momentLogFormat = 'MMMDD HH:mm:ss';
const isoLogFormat = moment.HTML5_FMT.DATETIME_LOCAL_MS;

const logWith = (writer, args) => {
  const currentTime = moment().format(momentLogFormat);
  writer(`${currentTime}|`, ...args);
};

const createJobLogEntry = ({
  filePath,
  printerConfig,
  testing,
  result,
  originalFilename,
  storedFilename,
  sourceType,
  sourceRoute,
  sourceArchiveName,
  copyIndex,
  totalCopies,
  transportResponse,
  error,
}) => ({
  timestamp: moment().format(isoLogFormat),
  printerId: printerConfig?.id || null,
  printerName: printerConfig?.driverName || null,
  printMode: printerConfig?.printMode || null,
  originalFilename: originalFilename || path.basename(filePath),
  storedFilename: storedFilename || (filePath ? path.basename(filePath) : null),
  filePath: filePath || null,
  testing: Boolean(testing),
  result,
  sourceType: sourceType || null,
  sourceRoute: sourceRoute || null,
  sourceArchiveName: sourceArchiveName || null,
  copyIndex: Number.isInteger(copyIndex) ? copyIndex : null,
  totalCopies: Number.isInteger(totalCopies) ? totalCopies : null,
  transportResponse: transportResponse || null,
  error: error ? error.message : null,
});

const logStamp      = (...args) => logWith(console.log, args);
const errorLogStamp = (...args) => logWith(console.error, args);

module.exports = {
  createJobLogEntry,
  logStamp,
  errorLogStamp,
};
