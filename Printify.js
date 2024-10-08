const express           = require('express'       );
const multer            = require('multer'        );
const path              = require('path'          );
const printer           = require('pdf-to-printer');
const moment            = require('moment'        ); 
const fs                = require('fs'            );
const { exec }          = require('child_process' );
const yauzl             = require('yauzl'        );
const { fileURLToPath } = require('url'           );


// ┌────────────────┐
// │  Library Init  │
// └────────────────┘
const app    = express();
const upload = multer({ dest: 'uploads/' });


// ┌───────────┐
// │  Globals  │
// └───────────┘
const zebraPrinter   = 'ZP450';                                                   // Zebra Printer 
const brotherPrinter = 'Brother2360DUSB';                                         // Brother Printer
const dymoPrinter    = 'DYMO LabelWriter 4XL';                                    // Dymo Printer
const port           = 80;                                                        // Webserver port
const testing        = true;                                                     // Set true to disable printing
const imPath         = "C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe"; // Filepath to imagemagick's convert.exe for PNG -> PDF

//ANCHOR Test object for printer types
//TODO The bro printer doesn't accept size, need to account for that
const printers = {
  zebra:{
    "name":"ZP450",
    "size":"800x1200",
    "density":"200"
  },
  brotherLaser:{
    "name":"Brother2360DUSB",
    "size":null,
    "density":null
  },
  dymoLabel:{
    "name":"DYMO LabelWriter 4XLZP450",
    "size":"425x200",
    "density":"200"
  }
}

// Get the current version from package.json
const package = require('./package.json');
const version = package.version;
console.log('Printify.js v'+version);

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
function extractZip(zipFilePath, printerName) {
  const extractionPath = 'uploads/extracted';                            // Directory name for extraction
  const pdfPaths = [];                                                   // List of extracted PDF file paths to return
  const extractionPromise = new Promise((resolve, reject) => {           // Create a promise to return the list of extracted files
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {   
      if (err) { reject(err); return; }                                  // Return if there's an error opening the zip
      zipfile.readEntry();                                                // Begin reading entries (files or directories)

      zipfile.on('entry', entry => {                                     // Handle each entry
        const filePath = path.join(extractionPath, entry.fileName);      // Build the file path
        if (/\/$/.test(entry.fileName)) {                                 // Directory entry - ensure directory exists, then continue reading entries
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
      const printPromises = pdfPaths.map(pdfPath => printPDF(pdfPath, printerName));
      return Promise.all(printPromises).then(() => pdfPaths);          
    })
    .catch(error => {
      console.error('Error extracting and printing PDFs:', error.message);
      throw error;
    })
    .finally(() => {
      console.log('Zip print complete.');
      // Clean up extracted files after printing (Causes instability)
      // fs.rmSync(extractionPath, { recursive: true });
    });
}

//ANCHOR This is my test generic routine to convert a .pdf file to a .png
function convertPDF(pngFilePath,printer,pdfFilePath){
  if (!fs.existsSync(pngFilePath)) {console.error('Input PNG file does not exist.'); return; }
  if(!pdfFilePath){pdfFilePath=pngFilePath+'.pdf';} // Append ".pdf" to the converted output filename
  let command = ""                                  // Init command to send to the imagemagick converter
  if (printer.size){                                // If the output res specified, use this cmd
    command = `"${imPath}" "${pngFilePath}" -density ${printer.density} -resize "${printer.size}" -format "pdf" "${pdfFilePath}"`;
  }else{
    command = `"${imPath}" "${pngFilePath}" -format "pdf" -extent 0x0 "${pdfFilePath}"`; // This variant doesn't resize and uses -extent 0x0 to remove the white borders for the brother printer
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`ImageMagick error: ${error.message}`); return;
    }
    if (stderr) {
      console.error(`ImageMagick stderr: ${stderr}`); return;
    }
    console.log(`ImageMagick command executed successfully. Output: ${stdout}`);
    printPDF(pdfFilePath,zebraPrinter);
  });
}


// ┌───────────────────────────────────────────────┐
// │  Print PDF Callback                           │
// │  Prints file filePath on printer printerName  │
// └───────────────────────────────────────────────┘
function printPDF(filePath, printerName) {
  // Print the PDF file
  if (!testing){
    printer.print(filePath, 
        //Printer settings/config object
        { 
          printer: printerName,
          // pageSize: '4x6in', //Doesn't work?
          scale: 'fit',
          landscape: false,
        })
      .then(jobId => {
        // console.log(`Job ID: ${jobId}`);
      })
      .catch(error => {
        console.error('Printing failed:', error);
      });
  }
  //Log the event
  let currentTime = moment().format('MMMM, D, HH:mm:ss');
  console.log(currentTime,':','Printing file:', filePath, 'to printer: '+printerName);

  //Increment the print count
  printGet();
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
      console.error(`Error sending file: ${err}`);
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
  printPDF(filePath,zebraPrinter)
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
  console.log('Zip File');
  let pdfFiles = extractZip(filePath,zebraPrinter);
  console.log(pdfFiles);
  res.status(200).send('OK');
});

app.post('/brother', upload.array('pdfFile'), (req, res, next) => {
  let filePath = req.files[0].path;
  printPDF(filePath,brotherPrinter)
  res.status(200).send('OK');
});

//Brother image file handling (PNG TIF or JPEG)
app.post('/brotherImg', upload.array('imgFile'), (req, res, next) => {
  let filePath = req.files[0].path;
  // convertPDFBrother(filePath)
  convertPDF(filePath,printers.brotherLaser);
  res.status(200).send('OK');
});

app.post('/dymopng', upload.single('pngFile'), (req, res, next) => {
  let filePath = req.file.path;
  let printCount = 1;
  if (req.body.printCount){
    printCount = req.body.printCount;
  }
  if (printCount > 1){
    console.log('Printing '+printCount+' labels');
  } else {
    console.log('Printing label');
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
  let currentTime = moment().format('MMMM, D, HH:mm:ss');
  console.log(currentTime,`: Server is running on port ${port}`);
});
