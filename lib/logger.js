// ╭──────────────────────────╮
// │  logger.js               │
// │  Timestamped log helpers │
// │  shared across server    │
// │  modules                 │
// ╰──────────────────────────╯
const moment = require('moment');


// ┌──────────────────────┐
// │  Shared log format   │
// └──────────────────────┘
const momentLogFormat = 'MMMDD HH:mm:ss';

const logWith = (writer, args) => {
  const currentTime = moment().format(momentLogFormat);
  writer(`${currentTime}|`, ...args);
};

const logStamp      = (...args) => logWith(console.log, args);
const errorLogStamp = (...args) => logWith(console.error, args);

module.exports = {
  logStamp,
  errorLogStamp,
};
