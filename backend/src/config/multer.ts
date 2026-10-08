import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const uploadPath = path.resolve(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Hash criptográfico para evitar qualquer colisão de nomes
    const fileHash = crypto.randomBytes(10).toString('hex');
    const fileName = `${fileHash}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, fileName);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Limite rígido de 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/pjpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas JPEG, PNG e WEBP são aceitos.'));
    }
  },
});