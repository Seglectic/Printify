const express           = require('express'       );
const multer            = require('multer'        );
const path              = require('path'          );
const printer           = require('pdf-to-printer');
const moment            = require('moment'        ); 
const fs                = require('fs'            );
const { exec, execFile, spawn } = require('child_process' );
const yauzl             = require('yauzl'        );
const { fileURLToPath } = require('url'           );
const momentLogFormat   = 'MMMDD HH:mm:ss';

const logStamp = (...args) => {
  const currentTime = moment().format(momentLogFormat);
  console.log(`${currentTime}|`, ...args);
};

const errorLogStamp = (...args) => {
  const currentTime = moment().format(momentLogFormat);
  console.error(`${currentTime}|`, ...args);
};


// ┌────────────────┐
// │  Library Init  │
// └────────────────┘
const app    = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));


// ┌───────────┐
// │  Globals  │
// └───────────┘
const port           = 8020;                                                        // Webserver port
const testing        = true;                                                       // Set true to disable printing
const imPath         = process.platform === 'win32'                                 // Check for winders
  ? "C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe"                       // Set to its fucky path
  : "convert";                                                                      // or simply use convert (might change in imagemagick 7)

//ANCHOR Test object for printer types
//TODO The bro printer doesn't accept size, need to account for that
const printers = {
  zebra:{
    "name":"Zebra450",
    "size":"800x1200",
    "density":"300"
  },
  brotherLaser:{
    "name":"Brother2360DUSB",
    "size":null,
    "density":null
  },
  dymoLabel:{
    "name":"DYMO4XLUSB",
    "size":"425x200",
    "density":"200"
  }
}
// const brotherLabelPrinter = 'PTE-550W'; // TODO either create a labelMakers group or squeeze into printers
// const labelMediaOptions = {
//   12: '12mm',
//   24: '24mm'
// };

// ╭────────────────────────╮
// │  Web Vars and helpers  │
// ╰────────────────────────╯
// Get the current version from package.json
const package = require('./package.json');
const version = package.version;
logStamp('Printify.js v'+version);
// Page hit and print count tracker
let pageHits = 0;
let printCounter = 0;
let serverData = {
  pageHits: pageHits,
  printCounter: printCounter
}

// load the serverData file, create it if it doesn't exist
if(fs.existsSync('serverData.json')){
  serverData = JSON.parse(fs.readFileSync('serverData.json'));
  pageHits = serverData.pageHits;
  printCounter = serverData.printCounter;
} else {
  fs.writeFileSync('serverData.json', JSON.stringify(serverData));
}

// Increments the print count in the log file
function printGet(){
  printCounter++;
  serverData.printCounter = printCounter;
  fs.writeFileSync('serverData.json', JSON.stringify(serverData));
}

// ╭──────────────────────────╮
// │  Zip Extractor           │
// │  Extracts and prints     │
// │  all PDFs in a zip file  │
// ╰──────────────────────────╯
function extractZip(zipFilePath, printer) {
  const extractionPath = 'uploads/extracted';                            // Directory name for extraction
  const pdfPaths = [];                                                   // List of extracted PDF file paths to return
  const extractionPromise = new Promise((resolve, reject) => {           // Create a promise to return the list of extracted files
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {   
      if (err) { reject(err); return; }                                  // Return if there's an error opening the zip
      zipfile.readEntry();                                                // Begin reading entries (files or directories)

      zipfile.on('entry', entry => {                                     // Handle each entry
        const filePath = path.join(extractionPath, entry.fileName);      // Build the file path
        if (/\/$/.test(entry.fileName)) {                                // Directory entry - ensure directory exists, then continue reading entries
          fs.mkdirSync(filePath, { recursive: true });
          zipfile.readEntry();
        } else {                                                         // File entry - extract the file and continue reading entries
          if (path.extname(filePath).toLowerCase() === '.pdf') {         // If the file is a PDF
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) throw err;
              fs.mkdirSync(path.dirname(filePath), { recursive: true }); // Ensure parent directory exists
              const writeStream = fs.createWriteStream(filePath);        // Create write stream to save file
              readStream.pipe(writeStream);                              // Pipe read stream into write stream
              writeStream.on('close', () => {
                pdfPaths.push(filePath);                                 // Add file path to the list of extracted files
                zipfile.readEntry();                                     // Continue reading entries
              });
            });
          } else {                                                       // Skip if it's not a PDF
            zipfile.readEntry();
          }
        }
      });

      zipfile.on('end', () => {                                          // When the entries are done being read
        resolve(pdfPaths);                                               // Resolve the promise with the list of extracted files
      });

      zipfile.on('error', err => {
        reject(err);
      });
    });
  });

  return extractionPromise                                               // Return the promise so they can wait for it to resolve
    .then(pdfPaths => {                                                  // Once the promise resolves print the PDFs and return them
      const printPromises = pdfPaths.map(pdfPath => printPDF(pdfPath, printer));
      return Promise.all(printPromises).then(() => pdfPaths);          
    })
    .catch(error => {
      errorLogStamp('Error extracting and printing PDFs:', error.message);
      throw error;
    })
    .finally(() => {
      logStamp('Zip print complete.');
      // Clean up extracted files after printing (Causes instability)
      // fs.rmSync(extractionPath, { recursive: true });
    });
}

//ANCHOR This is my generic routine to convert a .pdf file to a .png
function convertPDF(pngFilePath,printer,pdfFilePath){
  if (!fs.existsSync(pngFilePath)) {errorLogStamp('Input PNG file does not exist.'); return; }
  if(!pdfFilePath){pdfFilePath=pngFilePath+'.pdf';} // Append ".pdf" to the converted output filename
  let command = ""                                  
  if (printer.size){                                // If the output res specified, use this cmd
    command = `"${imPath}" "${pngFilePath}" -density ${printer.density} -resize "${printer.size}" -format "pdf" "${pdfFilePath}"`;
  }else{
    command = `"${imPath}" "${pngFilePath}" -format "pdf" -extent 0x0 "${pdfFilePath}"`; // This variant doesn't resize and uses -extent 0x0 to remove the white borders for the brother printer
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      errorLogStamp(`ImageMagick error: ${error.message}`); return;
    }
    if (stderr) {
      errorLogStamp(`ImageMagick stderr: ${stderr}`); return;
    }
    logStamp(`ImageMagick command executed successfully. Output: ${stdout}`);
    printPDF(pdfFilePath,printer);
  });
}

// ╭─────────────────────────────────────╮
// │  labelText                          │
// │  Attempt to print a string of text  │
// │  to a connected label maker         │
// ╰─────────────────────────────────────╯
function printLabelText(labelText, printer){

}


// ┌───────────────────────────────────────────────┐
// │  Print PDF Callback                           │
// │  Prints file filePath on given printer object │
// └───────────────────────────────────────────────┘
function printPDF(filePath, printer, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  if (!printer || !printer.name) {
    const error = new Error('printPDF requires a printer object with a name');
    done(error);
    return Promise.reject(error);
  }

  if (testing) {
    logStamp('Testing mode: skipped printing', filePath, 'to printer: '+printer.name);
    printGet();
    return Promise.resolve().then(() => done(null));
  }

  // Print the PDF file
  if (process.platform === 'linux') {
    const args = [];
    if (printer.name) {
      args.push('-d', printer.name);
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
    }).finally(() => {
      logStamp('Printing file:', filePath, 'to printer: '+printer.name);
      printGet();
    });
  }

  // Windows/macOS: use pdf-to-printer
  return printer.print(
      filePath,
      // Printer settings/config object
      {
        printer: printer.name,
        scale: 'fit',
        landscape: false,
      }
    )
    .then(jobId => {
      done(null, jobId);
      return jobId;
    })
    .catch(error => {
      errorLogStamp('Printing failed:', error);
      done(error);
      throw error;
    })
    .finally(() => {
      logStamp('Printing file:', filePath, 'to printer: '+printer.name);
      printGet();
    });
}

// ┌────────────────────┐
// │  Serve Files       │
// └────────────────────┘
app.use(express.static(__dirname + '/src'));
// Define the route for serving files
app.get('/files/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(__dirname, fileName);

  res.sendFile(filePath, (err) => {
    if (err) {
      errorLogStamp(`Error sending file: ${err}`);
      res.status(err.status || 500).end();
    } else {
      // console.log(`File sent: ${fileName}`);
    }
  });
});


// ╭───────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
// │                                      //SECTION Process file upload endpoints                                      │
// ╰───────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
app.post('/zebra', upload.single('pdfFile'), (req, res, next) => {
  const filePath = req.file.path;
  printPDF(filePath,printers.zebra)
  res.status(200).send('OK');
});

app.post('/zebrapng', upload.single('pngFile'), (req, res, next) => {
  const filePath = req.file.path;
  // convertPDFZebra(filePath);
  convertPDF(filePath,printers.zebra);
  res.status(200).send('OK');
});

//Zebra Zip file handling
app.post('/zebrazip', upload.single('zipFile'), (req, res, next) => {
  const filePath = req.file.path;
  logStamp('Zip File');
  let pdfFiles = extractZip(filePath,printers.zebra);
  logStamp(pdfFiles);
  res.status(200).send('OK');
});

app.post('/brother', upload.array('pdfFile'), (req, res, next) => {
  let filePath = req.files[0].path;
  printPDF(filePath,printers.brotherLaser)
  res.status(200).send('OK');
});

//Brother image file handling (PNG TIF or JPEG)
app.post('/brotherImg', upload.array('imgFile'), (req, res, next) => {
  let filePath = req.files[0].path;
  // convertPDFBrother(filePath)
  convertPDF(filePath,printers.brotherLaser);
  res.status(200).send('OK');
});

app.post('/labelmake', async (req, res) => {
  const tapeSize = parseInt(req.body.tapeSize || req.body.tapesize, 10);
  const labelText = (req.body.text || '').toString().replace(/\s+/g, ' ').trim();

  if (!labelText) {
    res.status(400).send('Missing label text');
    return;
  }
  if (![12, 24].includes(tapeSize)) {
    res.status(400).send('Invalid tape size');
    return;
  }

  try {
    await printLabelText(tapeSize, labelText);

    res.status(200).send('OK');
  } catch (error) {
    errorLogStamp('Label printing failed:', error.message);
    res.status(500).send('Print failed');
  }
});

app.post('/dymopng', upload.single('pngFile'), (req, res, next) => {
  let filePath = req.file.path;
  let printCount = 1;
  if (req.body.printCount){
    printCount = req.body.printCount;
  }
  if (printCount > 1){
    logStamp('Printing '+printCount+' labels');
  } else {
    logStamp('Printing label');
  }
  for (let i = 0; i < printCount; i++){
    // convertPDFDymo(filePath);
    convertPDF(filePath,printers.dymoLabel);
  }
  res.status(200).send('OK');
});


// ╭────────────────────╮
// │  Send server info  │
// ╰────────────────────╯
app.get('/version', (req, res) => { // Returns the current server version with the number of page hits and prints
  pageHits++;
  serverData.pageHits = pageHits;
  fs.writeFileSync('serverData.json', JSON.stringify(serverData));
  // Send the version, page hits, and print count as json
  res.status(200).json({
    version: version,
    printCounter: Math.floor(printCounter/50)*50, // Round printcount down to nearest 50
    pageHits: pageHits
  });
});

// Start the server
app.listen(port, () => {
  logStamp(`Server is running on port ${port}`);
});
