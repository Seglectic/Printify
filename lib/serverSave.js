// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  print-count storage     │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');

const MAX_PRINT_JOBS = 250;


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

    return nextServerData;
  };

  let serverData = getDefaultServerData();

  if (fs.existsSync(serverDataPath)) {
    serverData = normalizeServerData(JSON.parse(fs.readFileSync(serverDataPath)));
  } else {
    fs.writeFileSync(serverDataPath, JSON.stringify(serverData));
  }

  const persist = () => {
    fs.writeFileSync(serverDataPath, JSON.stringify(serverData));
  };

  return {
    getData: () => ({ ...serverData }),
    addPrintJobListener(listener) {
      if (typeof listener === 'function') {
        printJobListeners.push(listener);
      }
    },
    addPrintJob(printJob) {
      serverData.printJobs.push(printJob);

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
