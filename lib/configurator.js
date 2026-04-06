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
const getDefaultImPath = () => {
  if (process.platform === 'win32') {
    return 'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe';
  }

  // Homebrew installs ImageMagick 7 as "magick" on macOS, and "convert"
  // prints a deprecation warning that this app currently treats as a failure.
  if (process.platform === 'darwin') {
    return 'magick';
  }

  return 'convert';
};

const port    = parsedConfig.port ?? 8020;
const testing = parsedConfig.testing ?? true;
const imPath  = parsedConfig.imPath || getDefaultImPath();
const supportedFileKinds = new Set(['pdf', 'image', 'zip']);
const supportedPrintModes = new Set(['pdfToPrinter', 'unixPrint', 'lp', 'cli']);


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

  if (!supportedPrintModes.has(printerConfig.printMode)) {
    throw new Error(`Printer "${printerId}" has unsupported printMode "${printerConfig.printMode}"`);
  }

  if (printerConfig.linuxPrintMode && !supportedPrintModes.has(printerConfig.linuxPrintMode)) {
    throw new Error(`Printer "${printerId}" has unsupported linuxPrintMode "${printerConfig.linuxPrintMode}"`);
  }

  if (!Array.isArray(printerConfig.acceptedKinds) || printerConfig.acceptedKinds.length === 0) {
    throw new Error(`Printer "${printerId}" must define a non-empty acceptedKinds array`);
  }

  printerConfig.acceptedKinds.forEach(fileKind => {
    if (!supportedFileKinds.has(fileKind)) {
      throw new Error(`Printer "${printerId}" has unsupported acceptedKinds value "${fileKind}"`);
    }
  });

  if (printerConfig.labelBuilder && !printerConfig.acceptedKinds.includes('image')) {
    throw new Error(`Printer "${printerId}" enables the label builder but does not accept image uploads`);
  }
});

module.exports = {
  rootDir,
  staticDir: path.join(rootDir, 'src'),
  iconsDir: path.join(rootDir, 'icons'),
  uploadsDir: path.join(rootDir, 'uploads'),
  previewCacheDir: path.join(rootDir, 'lib', 'previewCache'),
  serverDataPath: path.join(rootDir, 'serverData.json'),
  version: packageJson.version,
  port,
  testing,
  imPath,
  printers,
};
