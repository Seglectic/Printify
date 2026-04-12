// ╭──────────────────────────╮
// │  logger.js               │
// │  Shared log helpers      │
// │  shared across server    │
// │  modules                 │
// ╰──────────────────────────╯
// ┌──────────────────────┐
// │  Shared log format   │
// └──────────────────────┘
const compactObject = value => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => (
    entryValue !== null
    && entryValue !== undefined
    && entryValue !== ''
  ))
);

const logWith = (writer, args) => writer(...args);

const logStamp      = (...args) => logWith(console.log, args);
const errorLogStamp = (...args) => logWith(console.error, args);

module.exports = {
  compactObject,
  logStamp,
  errorLogStamp,
};
