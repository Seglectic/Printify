// ╭──────────────────────────╮
// │  serverSave.js           │
// │  Persistent page-hit and │
// │  print-count storage     │
// │  backed by JSON          │
// ╰──────────────────────────╯
const fs = require('fs');


// ┌───────────────────────┐
// │  Save file wrapper    │
// └───────────────────────┘
const createServerSave = ({ serverDataPath }) => {
  let serverData = {
    pageHits:     0,
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
    getData: () => ({ ...serverData }),
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
