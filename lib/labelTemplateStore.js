// ╭──────────────────────────╮
// │  labelTemplateStore.js   │
// │  Filesystem-backed label │
// │  template browser/save   │
// │  helpers for the builder │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');

const TEMPLATE_FILE_EXTENSION = '.label-template.json';
const TEMPLATE_SCHEMA_VERSION = '1.0';

const sanitizeTemplateSegment = value => String(value || '')
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120);

const normalizeRelativeTemplatePath = value => {
  const rawValue = String(value || '').replace(/\\/g, '/').trim();

  if (!rawValue) {
    return '';
  }

  const normalizedValue = path.posix.normalize(rawValue).replace(/^\/+/, '');

  if (!normalizedValue || normalizedValue === '.') {
    return '';
  }

  if (normalizedValue.split('/').includes('..')) {
    throw new Error('Invalid template path');
  }

  return normalizedValue;
};

const resolveTemplatePath = (rootDir, relativePath = '') => {
  const normalizedPath = normalizeRelativeTemplatePath(relativePath);
  const resolvedPath = path.resolve(rootDir, normalizedPath);
  const resolvedRootDir = path.resolve(rootDir);

  if (resolvedPath !== resolvedRootDir && !resolvedPath.startsWith(`${resolvedRootDir}${path.sep}`)) {
    throw new Error('Template path escapes template root');
  }

  return {
    normalizedPath,
    resolvedPath,
  };
};

const getTemplateFileName = templateName => {
  const sanitizedName = sanitizeTemplateSegment(templateName) || 'Untitled Template';
  return `${sanitizedName}${TEMPLATE_FILE_EXTENSION}`;
};

const readTemplatePayload = templateFilePath => JSON.parse(fs.readFileSync(templateFilePath, 'utf8'));

const buildTemplateListEntry = (templateRootDir, templateFilePath) => {
  const payload = readTemplatePayload(templateFilePath);
  const relativeFilePath = path.relative(templateRootDir, templateFilePath).replace(/\\/g, '/');
  const builderDocument = payload.document || {};
  const metadata = builderDocument.metadata || {};

  return {
    name: payload.name || metadata.displayName || path.basename(templateFilePath, TEMPLATE_FILE_EXTENSION),
    path: relativeFilePath,
    updatedAt: payload.updatedAt || metadata.updatedAt || null,
    createdAt: payload.createdAt || metadata.createdAt || null,
    thumbnailDataUrl: payload.thumbnailDataUrl || metadata.thumbnailDataUrl || null,
    printerId: metadata.printerId || null,
    printerDisplayName: metadata.printerDisplayName || null,
    objectCount: Array.isArray(builderDocument.objects) ? builderDocument.objects.length : 0,
    schemaVersion: payload.schemaVersion || TEMPLATE_SCHEMA_VERSION,
  };
};

const createLabelTemplateStore = ({
  templatesDir,
}) => {
  fs.mkdirSync(templatesDir, { recursive: true });

  return {
    listDirectory(relativeDirectoryPath = '') {
      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, relativeDirectoryPath);

      if (!fs.existsSync(resolvedPath)) {
        throw new Error('Template directory not found');
      }

      const directoryEntries = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const folders = [];
      const templates = [];

      directoryEntries.forEach(entry => {
        const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          folders.push({
            name: entry.name,
            path: entryPath,
          });
          return;
        }

        if (entry.isFile() && entry.name.endsWith(TEMPLATE_FILE_EXTENSION)) {
          try {
            templates.push(buildTemplateListEntry(templatesDir, path.join(resolvedPath, entry.name)));
          } catch (error) {
            // Skip malformed template files so one broken JSON file does not take down browsing.
          }
        }
      });

      folders.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
      templates.sort((left, right) => right.updatedAt?.localeCompare(left.updatedAt || '') || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

      return {
        currentPath: normalizedPath,
        parentPath: normalizedPath.includes('/') ? normalizedPath.split('/').slice(0, -1).join('/') : '',
        folders,
        templates,
      };
    },

    loadTemplate(relativeTemplatePath) {
      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, relativeTemplatePath);

      if (!resolvedPath.endsWith(TEMPLATE_FILE_EXTENSION) || !fs.existsSync(resolvedPath)) {
        throw new Error('Template file not found');
      }

      const payload = readTemplatePayload(resolvedPath);
      return {
        path: normalizedPath,
        ...payload,
      };
    },

    saveTemplate({
      directoryPath = '',
      name,
      document,
      thumbnailDataUrl = null,
    }) {
      const templateName = sanitizeTemplateSegment(name) || 'Untitled Template';
      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, directoryPath);
      const templateFileName = getTemplateFileName(templateName);
      const templateFilePath = path.join(resolvedPath, templateFileName);
      const nextTimestamp = new Date().toISOString();

      fs.mkdirSync(resolvedPath, { recursive: true });

      let existingPayload = null;
      if (fs.existsSync(templateFilePath)) {
        try {
          existingPayload = readTemplatePayload(templateFilePath);
        } catch (error) {
          existingPayload = null;
        }
      }

      const payload = {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        name: templateName,
        createdAt: existingPayload?.createdAt || nextTimestamp,
        updatedAt: nextTimestamp,
        thumbnailDataUrl: thumbnailDataUrl || existingPayload?.thumbnailDataUrl || null,
        document,
      };

      fs.writeFileSync(templateFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

      return {
        directoryPath: normalizedPath,
        template: buildTemplateListEntry(templatesDir, templateFilePath),
      };
    },

    createFolder({
      directoryPath = '',
      name,
    }) {
      const folderName = sanitizeTemplateSegment(name);

      if (!folderName) {
        throw new Error('Folder name is required');
      }

      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, directoryPath);
      const nextFolderPath = path.join(resolvedPath, folderName);
      fs.mkdirSync(nextFolderPath, { recursive: true });

      return {
        parentPath: normalizedPath,
        folder: {
          name: folderName,
          path: normalizeRelativeTemplatePath(normalizedPath ? `${normalizedPath}/${folderName}` : folderName),
        },
      };
    },

    deleteTemplate(relativeTemplatePath) {
      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, relativeTemplatePath);

      if (!resolvedPath.endsWith(TEMPLATE_FILE_EXTENSION) || !fs.existsSync(resolvedPath)) {
        throw new Error('Template file not found');
      }

      const template = buildTemplateListEntry(templatesDir, resolvedPath);
      fs.unlinkSync(resolvedPath);

      return {
        path: normalizedPath,
        template,
      };
    },

    deleteFolder(relativeDirectoryPath) {
      const { normalizedPath, resolvedPath } = resolveTemplatePath(templatesDir, relativeDirectoryPath);

      if (!normalizedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
        throw new Error('Template folder not found');
      }

      const folder = {
        name: path.basename(resolvedPath),
        path: normalizedPath,
      };

      fs.rmSync(resolvedPath, {
        recursive: true,
        force: false,
      });

      return {
        folder,
      };
    },
  };
};

module.exports = {
  createLabelTemplateStore,
};
