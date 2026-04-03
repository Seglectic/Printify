// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  print-count storage     │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');

const MAX_PRINT_JOBS = 250;
const PRETTY_PRINT_SPACES = 2;

const compactObject = value => Object.fromEntries(
  Object.entries(value).filter(([, entryValue]) => (
    entryValue !== null
    && entryValue !== undefined
    && entryValue !== ''
  ))
);


// ┌───────────────────────┐
// │  Save file wrapper    │
// └───────────────────────┘
const createServerSave = ({
  serverDataPath,
  onPrintJobSaved = () => {},
}) => {
  const printJobListeners = [onPrintJobSaved];
  const getDefaultServerData = () => ({
    pageHits:     0,
    printCounter: 0,
    printJobs:    [],
  });

  const normalizeServerData = rawServerData => {
    const defaultServerData = getDefaultServerData();
    const nextServerData = {
      ...defaultServerData,
      ...(rawServerData || {}),
    };

    if (!Array.isArray(nextServerData.printJobs)) {
      nextServerData.printJobs = [];
    }

    nextServerData.printJobs = nextServerData.printJobs.map(printJob => compactObject(printJob || {}));

    return nextServerData;
  };

  const stringifyServerData = value => `${JSON.stringify(value, null, PRETTY_PRINT_SPACES)}\n`;

  let serverData = getDefaultServerData();

  if (fs.existsSync(serverDataPath)) {
    serverData = normalizeServerData(JSON.parse(fs.readFileSync(serverDataPath, 'utf8')));
  } else {
    fs.writeFileSync(serverDataPath, stringifyServerData(serverData));
  }

  const persist = () => {
    fs.writeFileSync(serverDataPath, stringifyServerData(serverData));
  };

  persist();

  return {
    getData: () => ({ ...serverData }),
    addPrintJobListener(listener) {
      if (typeof listener === 'function') {
        printJobListeners.push(listener);
      }
    },
    addPrintJob(printJob) {
      serverData.printJobs.push(compactObject(printJob || {}));

      if (serverData.printJobs.length > MAX_PRINT_JOBS) {
        serverData.printJobs = serverData.printJobs.slice(-MAX_PRINT_JOBS);
      }

      persist();
      printJobListeners.forEach(listener => listener(printJob));
      return printJob;
    },
    incrementPrintCounter() {
      serverData.printCounter += 1;
      persist();
      return serverData.printCounter;
    },
    incrementPageHits() {
      serverData.pageHits += 1;
      persist();
      return serverData.pageHits;
    },
  };
};

module.exports = {
  createServerSave,
};
