const express = require('express');
const multer  = require('multer');
const path    = require('path');
const printer = require('pdf-to-printer');
const moment  = require('moment'); 
const fs      = require('fs');
const im      = require('imagemagick');                                    //Doesn't work on Windows well :)
const { exec } = require('child_process');


// ┌────────────────┐
// │  Library Init  │
// └────────────────┘
const app    = express();
const upload = multer({ dest: 'uploads/' });


// ┌──────────┐
// │  Global  │
// └──────────┘
const zebraPrinter   = 'ZP450';                                            // Zebra Printer Name
const brotherPrinter = 'Brother2360D';                                     // Brother Printer Name
const port           = 80;                                                 // Webserver port
const testing        = false;                                              // Set true to disable printing
const imPath  = "C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/convert.exe"  // Filepath to imagemagick's convert.exe for PNG -> PDF



// ┌───────────────────────────────────────────────────────────┐
// │  Convert PDF                               │              │
// │  Runs imagemagick's convert.exe on a file                 │
// │  with to convert it into a PDF then run printer callback  │
// └───────────────────────────────────────────────────────────┘
function convertPDF(pngFilePath, pdfFilePath){
  //---  Check if the input path exists  ---//
  if (!fs.existsSync(pngFilePath)) {
    console.error('Input PNG file does not exist.'); return;
  }

    //---  Append .pdf to the file output  ---//
  if(!pdfFilePath){pdfFilePath=pngFilePath+'.pdf';}

  let command = `"${imPath}" "${pngFilePath}" -density 200 -resize "800x1200" -format "pdf" "${pdfFilePath}"`;
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`ImageMagick error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`ImageMagick stderr: ${stderr}`);
      return;
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


// ┌───────────────────────┐
// │  Handle file uploads  │
// └───────────────────────┘
app.post('/zebra', upload.single('pdfFile'), (req, res, next) => {
  const filePath = req.file.path;
  printPDF(filePath,zebraPrinter)
  res.status(200).send('OK');
});

app.post('/zebrapng', upload.single('pngFile'), (req, res, next) => {
  const filePath = req.file.path;
  convertPDF(filePath);
  res.status(200).send('OK');
});

app.post('/brother', upload.array('pdfFile'), (req, res, next) => {
  const filePath = req.file.path;
  printPDF(filePath,brotherPrinter)
  res.status(200).send('OK');
});


// Start the server
app.listen(port, () => {
  let currentTime = moment().format('MMMM, D, HH:mm:ss');
  console.log(currentTime,`: Server is running on port ${port}`);
});
