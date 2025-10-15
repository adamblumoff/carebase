import express, { Request, Response } from 'express';
import multer from 'multer';
import { ensureAuthenticated, ensureRecipient } from '../middleware/auth.js';
import { createSource } from '../db/queries.js';
import { extractTextFromImage, getShortExcerpt } from '../services/ocr.js';
import { storeFile } from '../services/storage.js';

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
 * Upload photo of bill
 * POST /upload/photo
 */
router.post('/photo', ensureAuthenticated, ensureRecipient, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const recipient = req.recipient;

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

    // Process source (same as email webhook)
    const { parseSource } = await import('../services/parser.js');
    const { createItem, createAppointment, createBill, createAuditLog } = await import('../db/queries.js');

    const parsed = parseSource(source, ocrText);
    const { classification, appointmentData, billData, billOverdue } = parsed;

    // Create item
    const item = await createItem(
      source.recipientId,
      source.id,
      classification.type,
      classification.confidence
    );

    // Create appointment or bill based on classification
    if (classification.type === 'appointment' && appointmentData) {
      await createAppointment(item.id, appointmentData);
    } else if (classification.type === 'bill' && billData) {
      await createBill(item.id, billData);
    }

    // Log audit entry
    await createAuditLog(item.id, 'auto_classified', {
      type: classification.type,
      confidence: classification.confidence,
      source: 'photo_upload',
      ocr: true,
      extractedBill: billData,
      overdue: billOverdue,
      ocrSnippet: ocrText.substring(0, 2000)
    });

    console.log(`Created ${classification.type} from photo upload with confidence ${classification.confidence}`);

    res.redirect('/plan');
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: 'Failed to process photo' });
  }
});

export default router;
