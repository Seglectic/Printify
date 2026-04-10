// ╭────────────────────────────╮
// │  configurator.js           │
// │  Loads root YAML config    │
// │  and normalizes runtime    │
// │  values for the app        │
// ╰────────────────────────────╯
const path = require('path');
const {
  rootDir,
  readParsedConfig,
  getDefaultImPath,
} = require('./runtimeConfig');


// ┌─────────────────┐
// │  Project paths  │
// └─────────────────┘
const packageJson  = require(path.join(rootDir, 'package.json'));
const parsedConfig = readParsedConfig();


// ┌─────────────────┐
// │  Runtime flags  │
// └─────────────────┘
const port    = parsedConfig.port ?? 8020;
const testing = parsedConfig.testing ?? true;
const imPath  = parsedConfig.imPath || getDefaultImPath();
const assistant = parsedConfig.assistant !== undefined
  ? parsedConfig.assistant
  : (parsedConfig.clippy === false ? 'none' : 'Clippy');
const supportedFileKinds = new Set(['pdf', 'image', 'zip']);
const supportedPrintModes = new Set(['driver', 'cli']);
const supportedSizeUnits = new Map([
  ['inch', 'inch'],
  ['inches', 'inch'],
  ['in', 'inch'],
  ['mm', 'mm'],
  ['millimeter', 'mm'],
  ['millimeters', 'mm'],
  ['cm', 'cm'],
  ['centimeter', 'cm'],
  ['centimeters', 'cm'],
  ['px', 'px'],
  ['pixel', 'px'],
  ['pixels', 'px'],
]);

const parseDecimalSize = sizeValue => {
  const match = String(sizeValue || '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);

  if (!match) {
    return null;
  }

  return {
    width: Number.parseFloat(match[1]),
    height: Number.parseFloat(match[2]),
  };
};

const normalizeSizeUnit = unitValue => {
  const normalized = String(unitValue || '').trim().toLowerCase();
  return supportedSizeUnits.get(normalized) || null;
};

// Keep the runtime pixel size as a single normalized string because the
// converter and browser clients both already speak in "WIDTHxHEIGHT" form.
const formatPxSize = ({ width, height }) => `${width}x${height}`;

// Operators configure physical size in decimal units, but downstream print
// prep still needs a concrete pixel box for ImageMagick resize and builder
// canvas dimensions. This resolver is the one place that translates:
//   1. physical size + density -> pixels
//   2. raw pixel size -> normalized pixel size
// so the rest of the app can consume one stable shape.
const resolvePxSize = ({ printerId, size, units, density, legacyPxSize }) => {
  if (size === null || size === undefined || size === '') {
    if (!legacyPxSize) {
      return {
        size: null,
        units: null,
        sizePxWidth: null,
        sizePxHeight: null,
        sizePx: null,
      };
    }

    const parsedLegacySize = parseDecimalSize(legacyPxSize);

    if (!parsedLegacySize) {
      throw new Error(`Printer "${printerId}" has invalid legacy pxSize "${legacyPxSize}"`);
    }

    const sizePxWidth = Math.round(parsedLegacySize.width);
    const sizePxHeight = Math.round(parsedLegacySize.height);

    return {
      size: String(legacyPxSize),
      units: 'px',
      sizePxWidth,
      sizePxHeight,
      sizePx: formatPxSize({
        width: sizePxWidth,
        height: sizePxHeight,
      }),
    };
  }

  const parsedSize = parseDecimalSize(size);

  if (!parsedSize) {
    throw new Error(`Printer "${printerId}" has invalid size "${size}"`);
  }

  const normalizedUnits = normalizeSizeUnit(units);

  if (!normalizedUnits) {
    throw new Error(`Printer "${printerId}" has unsupported units "${units}"`);
  }

  let sizePxWidth = null;
  let sizePxHeight = null;

  if (normalizedUnits === 'px') {
    sizePxWidth = Math.round(parsedSize.width);
    sizePxHeight = Math.round(parsedSize.height);
  } else {
    const numericDensity = Number.parseFloat(density);

    if (!Number.isFinite(numericDensity) || numericDensity <= 0) {
      throw new Error(`Printer "${printerId}" needs a positive density when size units are not pixels`);
    }

    const pixelsPerUnit = normalizedUnits === 'inch'
      ? numericDensity
      : (normalizedUnits === 'cm' ? numericDensity / 2.54 : numericDensity / 25.4);

    sizePxWidth = Math.round(parsedSize.width * pixelsPerUnit);
    sizePxHeight = Math.round(parsedSize.height * pixelsPerUnit);
  }

  return {
    size: String(size),
    units: normalizedUnits,
    sizePxWidth,
    sizePxHeight,
    sizePx: formatPxSize({
      width: sizePxWidth,
      height: sizePxHeight,
    }),
  };
};


// ┌───────────────────────┐
// │  Printer definitions  │
// └───────────────────────┘
const printers = parsedConfig.printers || {};

Object.entries(printers).forEach(([printerId, printerConfig]) => {
  const printMode = printerConfig.printMode || 'driver';

  if (!supportedPrintModes.has(printMode)) {
    throw new Error(`Printer "${printerId}" has unsupported printMode "${printMode}"`);
  }

  if (printMode === 'driver' && !printerConfig.driverName) {
    throw new Error(`Printer "${printerId}" is missing driverName`);
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
  Object.assign(printerConfig, resolvePxSize({
    printerId,
    size: printerConfig.size,
    units: printerConfig.units,
    density: printerConfig.density,
    legacyPxSize: printerConfig.pxSize,
  }));
});

module.exports = {
  rootDir,
  staticDir: path.join(rootDir, 'src'),
  iconsDir: path.join(rootDir, 'icons'),
  logsDir: path.join(rootDir, 'logs'),
  uploadsDir: path.join(rootDir, 'uploads'),
  previewCacheDir: path.join(rootDir, 'lib', 'previewCache'),
  serverDataPath: path.join(rootDir, 'serverData.json'),
  version: packageJson.version,
  port,
  testing,
  assistant,
  imPath,
  printers,
};
