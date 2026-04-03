// ╭──────────────────────────╮
// │  upload.js               │
// │  Multer setup and        │
// │  upload filename         │
// │  generation helpers      │
// ╰──────────────────────────╯
const multer = require('multer');
const path   = require('path');


// ┌──────────────────────┐
// │  Filename generator  │
// └──────────────────────┘
const crockfordAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const crockStamp = () => {
  let epoch = Math.floor(Date.now());
  let out   = '';

  do {
    out = crockfordAlphabet[epoch % 32] + out;
    epoch = Math.floor(epoch / 32);
  } while (epoch > 0);

  return out;
};


// ┌────────────────────┐
// │  Multer instance   │
// └────────────────────┘
const createUpload = () => {
  const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      // Keep uploaded filenames readable while avoiding collisions.
      const originalName = path.basename(file.originalname);
      cb(null, `${crockStamp()}-${originalName}`);
    },
  });

  return multer({ storage });
};

module.exports = {
  createUpload,
};
