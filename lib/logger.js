// ┌─────────────┐
// │  logger.js  │
// └─────────────┘
// Shared timestamped logging helpers used across the server and print pipeline.

const moment = require('moment');

const momentLogFormat = 'MMMDD HH:mm:ss';

const logWith = (writer, args) => {
  const currentTime = moment().format(momentLogFormat);
  writer(`${currentTime}|`, ...args);
};

const logStamp = (...args) => {
  logWith(console.log, args);
};

const errorLogStamp = (...args) => {
  logWith(console.error, args);
};

module.exports = {
  logStamp,
  errorLogStamp,
};
