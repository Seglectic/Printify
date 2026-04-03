// ┌──────────────────────┐
// │  serverDataStore.js  │
// └──────────────────────┘
// Persistent counter storage for page hits and print totals backed by serverData.json.

const fs = require('fs');

const createServerDataStore = ({ serverDataPath }) => {
  let serverData = {
    pageHits: 0,
    printCounter: 0,
  };

  if (fs.existsSync(serverDataPath)) {
    serverData = JSON.parse(fs.readFileSync(serverDataPath));
  } else {
    fs.writeFileSync(serverDataPath, JSON.stringify(serverData));
  }

  const persist = () => {
    fs.writeFileSync(serverDataPath, JSON.stringify(serverData));
  };

  return {
    getData() {
      return { ...serverData };
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
  createServerDataStore,
};
