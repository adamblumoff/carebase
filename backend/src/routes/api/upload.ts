/**
 * Mobile API: Photo upload endpoint
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import { createSource, createItem, createBill, createAuditLog, findRecipientsByUserId } from '../../db/queries.js';
import { extractTextFromImage, getShortExcerpt } from '../../services/ocr.js';
import { storeFile } from '../../services/storage.js';
import { parseSource } from '../../services/parser.js';
import type { User } from '@carebase/shared';

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
router.post('/photo', upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get recipient
    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      return res.status(404).json({ error: 'No recipient found' });
    }
    const recipient = recipients[0];

    // Store the file
    const ext = req.file.mimetype.split('/')[1];
    const storageKey = await storeFile(req.file.buffer, ext);

    // Extract text using OCR
    let ocrText = '';
    try {
      ocrText = await extractTextFromImage(req.file.buffer);
    } catch (ocrError) {
      console.error('OCR failed:', ocrError);
      // Continue even if OCR fails
    }

    // Get short excerpt
    const shortExcerpt = getShortExcerpt(ocrText);

    // Create source record
    const source = await createSource(recipient.id, 'upload', {
      externalId: null,
      sender: 'Photo Upload',
      subject: 'Uploaded Bill Photo',
      shortExcerpt,
      storageKey
    });

    // Parse source
    const parsed = parseSource(source);
    const { classification, appointmentData, billData } = parsed;

    // Create item
    const item = await createItem(
      recipient.id,
      source.id,
      classification.type,
      classification.confidence
    );

    // Create bill if classified as bill
    let createdBill = null;
    if (classification.type === 'bill' && billData) {
      createdBill = await createBill(item.id, billData);
    }

    // Log audit entry
    await createAuditLog(item.id, 'auto_classified', {
      type: classification.type,
      confidence: classification.confidence,
      source: 'photo_upload',
      ocr: true
    });

    console.log(`Created ${classification.type} from photo upload with confidence ${classification.confidence}`);

    res.json({
      success: true,
      classification: {
        type: classification.type,
        confidence: classification.confidence
      },
      item: {
        id: item.id,
        type: item.type
      },
      bill: createdBill,
      ocrText: ocrText.substring(0, 200) // Return first 200 chars for debugging
    });
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: 'Failed to process photo' });
  }
});

export default router;
