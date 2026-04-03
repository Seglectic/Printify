// ╭──────────────────────────╮
// │  converter.js            │
// │  ImageMagick helpers for │
// │  converting img files    │
// │  into printable PDFs     │
// ╰──────────────────────────╯
const fs       = require('fs');
const path     = require('path');
const { exec } = require('child_process');


// ┌──────────────────────┐
// │  Converter service   │
// └──────────────────────┘
const createConverter = ({
  imPath,
  logStamp,
  errorLogStamp,
}) => {
  // Reuse the same sizing options for one-off image jobs and bundled pages so
  // printer-specific dimensions stay in one place.
  const buildPdfConversionFlags = printerConfig => {
    const flags = [];

    if (printerConfig.density) flags.push(`-density ${printerConfig.density}`);
    if (printerConfig.pxSize) flags.push(`-resize "${printerConfig.pxSize}"`);

    return flags.join(' ');
  };

  // Keep generated bundle names readable because operators inspect uploads
  // directly when diagnosing print issues on shared machines.
  const buildBundledPdfPath = (imgFilePaths, pdfFilePath) => {
    if (pdfFilePath) return pdfFilePath;

    const firstFile = imgFilePaths[0];
    const firstName = path.parse(firstFile).name;
    return path.join(path.dirname(firstFile), `${firstName}-bundle-${Date.now()}.pdf`);
  };

  // ┌────────────────────┐
  // │  Convert to PDF    │
  // └────────────────────┘
  const convertImgsToPdf = (imgFilePaths, printerConfig, pdfFilePath) => {
    if (!Array.isArray(imgFilePaths) || imgFilePaths.length === 0) {
      errorLogStamp('No input image files were provided.');
      return Promise.reject(new Error('No input image files were provided.'));
    }

    const missingInput = imgFilePaths.find(imgFilePath => !fs.existsSync(imgFilePath));

    if (missingInput) {
      errorLogStamp('Input img file does not exist.');
      return Promise.reject(new Error(`Input img file does not exist: ${missingInput}`));
    }

    const outputPdfPath = buildBundledPdfPath(imgFilePaths, pdfFilePath);
    const inputArgs = imgFilePaths.map(imgFilePath => `"${imgFilePath}"`).join(' ');
    const conversionFlags = buildPdfConversionFlags(printerConfig);
    const command = `"${imPath}" ${inputArgs}${conversionFlags ? ` ${conversionFlags}` : ''} -format "pdf" "${outputPdfPath}"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          errorLogStamp(`ImageMagick error: ${error.message}`);
          reject(error);
          return;
        }

        if (stderr) {
          errorLogStamp(`ImageMagick stderr: ${stderr}`);
          reject(new Error(stderr));
          return;
        }

        logStamp(`ImageMagick command executed successfully. Output: ${stdout}`);
        resolve(outputPdfPath);
      });
    });
  };

  const convertImgToPdf = (imgFilePath, printerConfig, pdfFilePath) => (
    convertImgsToPdf([imgFilePath], printerConfig, pdfFilePath || `${imgFilePath}.pdf`)
  );

  return {
    convertImgsToPdf,
    convertImgToPdf,
  };
};

module.exports = {
  createConverter,
};
