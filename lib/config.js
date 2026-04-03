// ┌─────────────┐
// │  config.js  │
// └─────────────┘
// Central app configuration for paths, runtime flags, versioning, and printer definitions.

const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJson = require(path.join(rootDir, 'package.json'));

const port = 8020;
const testing = true;
const imPath = process.platform === 'win32'
  ? 'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe'
  : 'convert';

const printers = {
  zebra: {
    name: 'Zebra450',
    size: '800x1200',
    density: '300',
  },
  brotherLaser: {
    name: 'Brother2360DUSB',
    size: null,
    density: null,
  },
  dymoLabel: {
    name: 'DYMO4XLUSB',
    size: '425x200',
    density: '200',
  },
};

module.exports = {
  rootDir,
  staticDir: path.join(rootDir, 'src'),
  uploadsDir: path.join(rootDir, 'uploads'),
  serverDataPath: path.join(rootDir, 'serverData.json'),
  version: packageJson.version,
  port,
  testing,
  imPath,
  printers,
};
