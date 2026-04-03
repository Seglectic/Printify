// ╭──────────────────────────╮
// │  converter.js            │
// │  ImageMagick helpers for │
// │  converting img files    │
// │  into printable PDFs     │
// ╰──────────────────────────╯
const fs       = require('fs');
const { exec } = require('child_process');


// ┌──────────────────────┐
// │  Converter service   │
// └──────────────────────┘
const createConverter = ({
  imPath,
  logStamp,
  errorLogStamp,
}) => {
  // ┌────────────────────┐
  // │  Convert to PDF    │
  // └────────────────────┘
  const convertImgToPdf = (imgFilePath, printerConfig, pdfFilePath) => {
    if (!fs.existsSync(imgFilePath)) {
      errorLogStamp('Input img file does not exist.');
      return Promise.reject(new Error('Input img file does not exist.'));
    }

    const outputPdfPath = pdfFilePath || `${imgFilePath}.pdf`;
    let command = '';

    if (printerConfig.pxSize) {
      command = `"${imPath}" "${imgFilePath}" -density ${printerConfig.density} -resize "${printerConfig.pxSize}" -format "pdf" "${outputPdfPath}"`;
    } else {
      command = `"${imPath}" "${imgFilePath}" -format "pdf" -extent 0x0 "${outputPdfPath}"`;
    }

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

  return {
    convertImgToPdf,
  };
};

module.exports = {
  createConverter,
};
