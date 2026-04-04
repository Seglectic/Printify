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
]);


// ┌──────────────────────┐
// │  Preview service     │
// └──────────────────────┘
const createPreviewer = ({
  imPath,
  previewCacheDir,
  serverSave,
  logStamp,
  errorLogStamp,
}) => {
  fs.mkdirSync(previewCacheDir, { recursive: true });

  const buildPreviewPath = checksum => path.join(previewCacheDir, `${checksum}.png`);

  const getPreviewUrl = checksum => (
    checksum ? `/preview/${encodeURIComponent(checksum)}` : null
  );

  const hasPreview = checksum => (
    Boolean(checksum) && fs.existsSync(buildPreviewPath(checksum))
  );

  const hasLoggedChecksum = checksum => {
    if (!checksum) return false;

    const { printJobs = [] } = serverSave.getData();
    return printJobs.some(job => job && job.chksum === checksum);
  };

  const isPreviewableSource = ({ checksum, sourceFilePath, sourceType, bundledSourceCount }) => {
    if (!checksum || !sourceFilePath || !fs.existsSync(sourceFilePath)) return false;
    if (!PREVIEWABLE_SOURCE_TYPES.has(sourceType)) return false;
    if (sourceType === 'upload-image-bundled') return false;
    if (sourceType === 'upload-image' && bundledSourceCount > 1) return false;

    return true;
  };

  const buildPreviewArgs = ({ sourceFilePath, sourceType, outputPath }) => {
    const inputPath = sourceType === 'upload-pdf'
      ? `${sourceFilePath}[0]`
      : sourceFilePath;

    const args = [inputPath];

    if (sourceType === 'upload-pdf') {
      args.push('-background', 'white', '-alpha', 'remove', '-alpha', 'off');
    } else {
      args.push('-auto-orient');
    }

    args.push('-resize', '50%', outputPath);
    return args;
  };

  const renderPreview = ({ sourceFilePath, sourceType, outputPath }) => new Promise((resolve, reject) => {
    execFile(imPath, buildPreviewArgs({ sourceFilePath, sourceType, outputPath }), error => {
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

    if (hasLoggedChecksum(checksum) && fs.existsSync(outputPath)) {
      return outputPath;
    }

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    try {
      await renderPreview({ sourceFilePath, sourceType, outputPath });
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
    getPreviewUrl,
    hasPreview,
  };
};

module.exports = {
  createPreviewer,
};
