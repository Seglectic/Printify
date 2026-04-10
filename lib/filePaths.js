// ╭──────────────────────────╮
// │  filePaths.js            │
// │  Shared helpers for      │
// │  logged project paths    │
// ╰──────────────────────────╯
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const normalizeRelativeSegments = value => (
  String(value || '').replace(/[\\/]+/g, path.sep)
);

const resolveLoggedPath = filePath => {
  const normalizedPath = String(filePath || '').trim();

  if (!normalizedPath) {
    return null;
  }

  if (path.isAbsolute(normalizedPath)) {
    return path.resolve(normalizedPath);
  }

  return path.resolve(projectRoot, normalizeRelativeSegments(normalizedPath));
};

const toLoggedPath = filePath => {
  const absolutePath = resolveLoggedPath(filePath);

  if (!absolutePath) {
    return null;
  }

  const relativePath = path.relative(projectRoot, absolutePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return absolutePath;
  }

  return relativePath.split(path.sep).join('/');
};

module.exports = {
  resolveLoggedPath,
  toLoggedPath,
};
