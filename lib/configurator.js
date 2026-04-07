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
const clippy  = parsedConfig.clippy ?? true;
const imPath  = parsedConfig.imPath || getDefaultImPath();
const supportedFileKinds = new Set(['pdf', 'image', 'zip']);
const supportedPrintModes = new Set(['driver', 'cli']);


// ┌───────────────────────┐
// │  Printer definitions  │
// └───────────────────────┘
const printers = parsedConfig.printers || {};

Object.entries(printers).forEach(([printerId, printerConfig]) => {
  if (!printerConfig.driverName) {
    throw new Error(`Printer "${printerId}" is missing driverName`);
  }

  const printMode = printerConfig.printMode || 'driver';

  if (!supportedPrintModes.has(printMode)) {
    throw new Error(`Printer "${printerId}" has unsupported printMode "${printMode}"`);
  }

  if (printMode === 'cli' && !printerConfig.cliCommand) {
    throw new Error(`Printer "${printerId}" uses cli printMode but is missing cliCommand`);
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

  printerConfig.printMode = printMode;
  printerConfig.bundleCopies = Boolean(printerConfig.bundleCopies);
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
  clippy,
  imPath,
  printers,
};
