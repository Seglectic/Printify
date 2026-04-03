// ╭────────────────────────────╮
// │  configurator.js           │
// │  Loads root YAML config    │
// │  and normalizes runtime    │
// │  values for the app        │
// ╰────────────────────────────╯
const fs   = require('fs');
const path = require('path');
const YAML = require('yaml');


// ┌─────────────────┐
// │  Project paths  │
// └─────────────────┘
const rootDir      = path.resolve(__dirname, '..');
const packageJson  = require(path.join(rootDir, 'package.json'));
const configPath   = path.join(rootDir, 'config.yaml');
const rawConfig    = fs.readFileSync(configPath, 'utf8');
const parsedConfig = YAML.parse(rawConfig) || {};


// ┌─────────────────┐
// │  Runtime flags  │
// └─────────────────┘
const port    = parsedConfig.port ?? 8020;
const testing = parsedConfig.testing ?? true;
const imPath  = parsedConfig.imPath
  || (process.platform === 'win32'
    ? 'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe'
    : 'convert');


// ┌───────────────────────┐
// │  Printer definitions  │
// └───────────────────────┘
const printers = parsedConfig.printers || {};

Object.entries(printers).forEach(([printerId, printerConfig]) => {
  if (!printerConfig.driverName) {
    throw new Error(`Printer "${printerId}" is missing driverName`);
  }

  if (!printerConfig.printMode) {
    throw new Error(`Printer "${printerId}" is missing printMode`);
  }
});

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
