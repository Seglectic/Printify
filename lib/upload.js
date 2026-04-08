// ╭──────────────────────────╮
// │  upload.js               │
// │  Multer setup and        │
// │  upload filename         │
// │  generation helpers      │
// ╰──────────────────────────╯
const multer = require('multer');
const fs     = require('fs');
const path   = require('path');


// ┌──────────────────────┐
// │  Filename generator  │
// └──────────────────────┘
const crockfordAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastStampTick = 0n;
let lastStampCounter = 0n;

const crockStamp = () => {
  const epochMicros = BigInt(Date.now()) * 1000n;
  const hrMicros = process.hrtime.bigint() / 1000n;
  let tick = epochMicros + (hrMicros % 1000n);

  if (tick <= lastStampTick) {
    lastStampCounter += 1n;
    tick = lastStampTick + lastStampCounter;
  } else {
    lastStampTick = tick;
    lastStampCounter = 0n;
  }

  let epoch = tick;
  let out   = '';

  do {
    out = crockfordAlphabet[Number(epoch % 32n)] + out;
    epoch /= 32n;
  } while (epoch > 0n);

  return out;
};


// ┌────────────────────┐
// │  Multer instance   │
// └────────────────────┘
const normalizePrinterFolder = printerId => {
  const normalized = String(printerId || '').trim();
  return normalized ? path.basename(normalized) : '';
};

const getUploadStageDir = req => {
  if (!req.printifyUploadStageDir) {
    req.printifyUploadStageDir = crockStamp();
  }

  return req.printifyUploadStageDir;
};

const createUpload = ({ uploadsDir }) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const printerFolder = normalizePrinterFolder(req.printifyPrinterId || req.params?.printerId);
      const stageDir = getUploadStageDir(req);
      const destinationDir = printerFolder
        ? path.join(uploadsDir, printerFolder, stageDir)
        : uploadsDir;

      fs.mkdirSync(destinationDir, { recursive: true });
      cb(null, destinationDir);
    },
    filename: (req, file, cb) => {
      // Preserve the uploaded basename; uniqueness comes from the staged folder.
      cb(null, path.basename(file.originalname));
    },
  });

  return multer({ storage });
};

module.exports = {
  createUpload,
};
