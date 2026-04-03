// ╭──────────────────────────╮
// │  printing.js             │
// │  Print job prep and      │
// │  dispatch helpers for    │
// │  files sent to printers  │
// ╰──────────────────────────╯
const fs                        = require('fs');
const path                      = require('path');
const yauzl                     = require('yauzl');
const pdfToPrinter              = require('pdf-to-printer');
const { exec, execFile, spawn } = require('child_process');


// ┌──────────────────────┐
// │  Printing service    │
// └──────────────────────┘
const createPrintingService = ({
  testing,
  imPath,
  serverSave,
  logStamp,
  errorLogStamp,
}) => {
  // Shared success/failure bookkeeping so each transport logs the same way.
  const finishPrint = (filePath, printerConfig) => {
    logStamp('Printing file:', filePath, `to printer: ${printerConfig.driverName}`);
    serverSave.incrementPrintCounter();
  };

  const runPdfToPrinter = (filePath, printerConfig, done) => (
    pdfToPrinter.print(filePath, {
      printer: printerConfig.driverName,
      scale: 'fit',
      landscape: false,
    })
      .then(jobId => {
        done(null, jobId);
        return jobId;
      })
      .catch(error => {
        errorLogStamp('Printing failed:', error);
        done(error);
        throw error;
      })
  );

  const runUnixPrint = (filePath, printerConfig, done) => {
    const args = [];
    if (printerConfig.driverName) {
      args.push('-d', printerConfig.driverName);
    }
    args.push(filePath);

    return new Promise((resolve, reject) => {
      execFile('lp', args, (error, stdout, stderr) => {
        if (error) {
          errorLogStamp('Printing failed:', stderr || error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };

  const runCliPrint = (filePath, printerConfig, done) => {
    const cliCommand = printerConfig.cliCommand;
    const cliArgs = (printerConfig.cliArgs || []).map(arg => (
      arg
        .replace('{file}', filePath)
        .replace('{driverName}', printerConfig.driverName)
    ));

    if (!cliCommand) {
      const error = new Error('CLI printMode requires cliCommand');
      done(error);
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(cliCommand, cliArgs, { stdio: 'pipe' });
      let stderr = '';
      let stdout = '';

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('error', error => {
        done(error);
        reject(error);
      });

      child.on('close', code => {
        if (code !== 0) {
          const error = new Error(stderr || `CLI print failed with code ${code}`);
          errorLogStamp('Printing failed:', error.message);
          done(error);
          reject(error);
          return;
        }

        done(null, stdout);
        resolve(stdout);
      });
    });
  };


  // ┌─────────────────┐
  // │  Print a PDF    │
  // └─────────────────┘
  const printPDF = (filePath, printerConfig, callback) => {
    const done = typeof callback === 'function' ? callback : () => {};

    if (!printerConfig || !printerConfig.driverName) {
      const error = new Error('printPDF requires a printer object with a driverName');
      done(error);
      return Promise.reject(error);
    }

    if (testing) {
      logStamp('Testing mode: skipped printing', filePath, `to printer: ${printerConfig.driverName}`);
      serverSave.incrementPrintCounter();
      return Promise.resolve().then(() => done(null));
    }

    let printPromise;

    switch (printerConfig.printMode) {
      case 'pdfToPrinter':
        printPromise = runPdfToPrinter(filePath, printerConfig, done);
        break;
      case 'unixPrint':
        printPromise = runUnixPrint(filePath, printerConfig, done);
        break;
      case 'cli':
        printPromise = runCliPrint(filePath, printerConfig, done);
        break;
      default: {
        const error = new Error(`Unsupported printMode: ${printerConfig.printMode}`);
        done(error);
        return Promise.reject(error);
      }
    }

    return printPromise.finally(() => {
      finishPrint(filePath, printerConfig);
    });
  };


  // ┌─────────────────┐
  // │  Extract a ZIP  │
  // └─────────────────┘
  const extractZip = (zipFilePath, printerConfig) => {
    const extractionPath = 'uploads/extracted';
    const pdfPaths       = [];

    const extractionPromise = new Promise((resolve, reject) => {
      yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          reject(err);
          return;
        }

        zipfile.readEntry();

        zipfile.on('entry', entry => {
          const filePath = path.join(extractionPath, entry.fileName);

          if (/\/$/.test(entry.fileName)) {
            fs.mkdirSync(filePath, { recursive: true });
            zipfile.readEntry();
            return;
          }

          if (path.extname(filePath).toLowerCase() !== '.pdf') {
            zipfile.readEntry();
            return;
          }

          zipfile.openReadStream(entry, (streamError, readStream) => {
            if (streamError) {
              reject(streamError);
              return;
            }

            // Preserve nested ZIP paths so bundled label sets still work.
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const writeStream = fs.createWriteStream(filePath);
            readStream.pipe(writeStream);

            writeStream.on('close', () => {
              pdfPaths.push(filePath);
              zipfile.readEntry();
            });
          });
        });

        zipfile.on('end', () => {
          resolve(pdfPaths);
        });

        zipfile.on('error', reject);
      });
    });

    return extractionPromise
      .then(extractedPdfPaths => {
        const printPromises = extractedPdfPaths.map(pdfPath => printPDF(pdfPath, printerConfig));
        return Promise.all(printPromises).then(() => extractedPdfPaths);
      })
      .catch(error => {
        errorLogStamp('Error extracting and printing PDFs:', error.message);
        throw error;
      })
      .finally(() => {
        logStamp('Zip print complete.');
      });
  };


  // ┌────────────────────┐
  // │  Convert to PDF    │
  // └────────────────────┘
  const convertPDF = (pngFilePath, printerConfig, pdfFilePath) => {
    if (!fs.existsSync(pngFilePath)) {
      errorLogStamp('Input PNG file does not exist.');
      return;
    }

    const outputPdfPath = pdfFilePath || `${pngFilePath}.pdf`;
    let command = '';

    if (printerConfig.pxSize) {
      command = `"${imPath}" "${pngFilePath}" -density ${printerConfig.density} -resize "${printerConfig.pxSize}" -format "pdf" "${outputPdfPath}"`;
    } else {
      command = `"${imPath}" "${pngFilePath}" -format "pdf" -extent 0x0 "${outputPdfPath}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        errorLogStamp(`ImageMagick error: ${error.message}`);
        return;
      }

      if (stderr) {
        errorLogStamp(`ImageMagick stderr: ${stderr}`);
        return;
      }

      logStamp(`ImageMagick command executed successfully. Output: ${stdout}`);
      printPDF(outputPdfPath, printerConfig);
    });
  };


  // ┌──────────────────────┐
  // │  Print label text    │
  // └──────────────────────┘
  const printLabelText = async (tapeSize, labelText) => {
    void spawn;
    throw new Error(`Label printing is not implemented for ${tapeSize}mm tape: ${labelText}`);
  };

  return {
    extractZip,
    convertPDF,
    printLabelText,
    printPDF,
  };
};

module.exports = {
  createPrintingService,
};
