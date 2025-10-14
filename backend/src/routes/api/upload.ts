/**
 * Mobile API: Photo upload endpoint
 */
import express from 'express';
import multer from 'multer';
import { uploadPhoto } from '../../controllers/api/upload.js';

const router = express.Router();

// Configure multer for file upload with size limit (5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    // Only allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * POST /api/upload/photo
 * Upload a photo of a bill (with OCR)
 */
router.post('/photo', upload.single('photo'), uploadPhoto);

export default router;
