// ╭──────────────────────────╮
// │  previewer.js            │
// │  Preview cache helpers   │
// │  for log drawer thumbs   │
// ╰──────────────────────────╯
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PREVIEWABLE_SOURCE_TYPES = new Set([
  'upload-pdf',
  'upload-image',
  'upload-image-bundled',
  'upload-zip-pdf',
]);


// ┌──────────────────────┐
// │  Preview service     │
// └──────────────────────┘
const createPreviewer = ({
  imPath,
  previewCacheDir,
  logStamp,
  errorLogStamp,
}) => {
  fs.mkdirSync(previewCacheDir, { recursive: true });

  const buildPreviewPath = checksum => path.join(previewCacheDir, `${checksum}.png`);
  const buildThumbnailPath = checksum => path.join(previewCacheDir, `${checksum}.thumb.png`);

  const getPreviewUrl = checksum => (
    checksum ? `/preview/${encodeURIComponent(checksum)}` : null
  );

  const getThumbnailUrl = checksum => (
    checksum ? `/preview-thumb/${encodeURIComponent(checksum)}` : null
  );

  const hasPreview = checksum => (
    Boolean(checksum) && fs.existsSync(buildPreviewPath(checksum))
  );

  const hasThumbnail = checksum => (
    Boolean(checksum) && fs.existsSync(buildThumbnailPath(checksum))
  );

  const isPreviewableSource = ({ checksum, sourceFilePath, sourceType, bundledSourceCount }) => {
    if (!checksum || !sourceFilePath || !fs.existsSync(sourceFilePath)) return false;
    if (!PREVIEWABLE_SOURCE_TYPES.has(sourceType)) return false;
    if (sourceType === 'upload-image' && bundledSourceCount > 1) return false;

    return true;
  };

  const buildPreviewArgs = ({ sourceFilePath, sourceType, outputPath, thumbnail = false }) => {
    const inputPath = sourceType === 'upload-pdf'
      ? `${sourceFilePath}[0]`
      : sourceFilePath;

    const args = [inputPath];

    if (sourceType === 'upload-pdf') {
      args.push('-background', 'white', '-alpha', 'remove', '-alpha', 'off');
    } else {
      args.push('-auto-orient');
    }

    if (thumbnail) {
      args.push('-thumbnail', '320x320>');
    }

    args.push(outputPath);
    return args;
  };

  const renderPreview = ({ sourceFilePath, sourceType, outputPath, thumbnail = false }) => new Promise((resolve, reject) => {
    execFile(imPath, buildPreviewArgs({ sourceFilePath, sourceType, outputPath, thumbnail }), error => {
      if (error) {
        reject(error);
        return;
      }

      resolve(outputPath);
    });
  });

  const ensurePreviewForJob = async ({
    checksum,
    sourceFilePath,
    sourceType,
    bundledSourceCount = null,
  }) => {
    if (!isPreviewableSource({
      checksum,
      sourceFilePath,
      sourceType,
      bundledSourceCount,
    })) {
      return null;
    }

    const outputPath = buildPreviewPath(checksum);
    const thumbnailPath = buildThumbnailPath(checksum);

    try {
      if (!fs.existsSync(outputPath)) {
        await renderPreview({ sourceFilePath, sourceType, outputPath });
      }

      if (!fs.existsSync(thumbnailPath)) {
        await renderPreview({ sourceFilePath, sourceType, outputPath: thumbnailPath, thumbnail: true });
      }

      logStamp(`Preview generated for checksum ${checksum}`);
      return outputPath;
    } catch (error) {
      errorLogStamp('Preview generation failed:', error.message);
      return null;
    }
  };

  return {
    ensurePreviewForJob,
    getPreviewPath: buildPreviewPath,
    getThumbnailPath: buildThumbnailPath,
    getPreviewUrl,
    getThumbnailUrl,
    hasPreview,
    hasThumbnail,
  };
};

module.exports = {
  createPreviewer,
};
