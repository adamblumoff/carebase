/**
 * Mobile API: Photo upload endpoint
 */
import express, { Request, Response } from 'express';
import multer from 'multer';
import { createSource, createItem, createBill, createAuditLog, findRecipientsByUserId } from '../../db/queries.js';
import { extractTextFromImage, getShortExcerpt } from '../../services/ocr.js';
import { storeFile, storeText } from '../../services/storage.js';
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

    // Get short excerpt for quick display, but keep full text for parsing
    const shortExcerpt = getShortExcerpt(ocrText);

    // Persist full OCR transcript for deeper debugging
    let ocrTextStorageKey: string | null = null;
    if (ocrText) {
      try {
        ocrTextStorageKey = await storeText(ocrText);
      } catch (storeErr) {
        console.error('Failed to persist OCR text transcript:', storeErr);
      }
    }

    // Create source record
    const source = await createSource(recipient.id, 'upload', {
      externalId: null,
      sender: 'Photo Upload',
      subject: 'Uploaded Bill Photo',
      shortExcerpt,
      storageKey
    });

    // Temporary logging to inspect OCR output on device vs tests
    const ocrPreview = ocrText.slice(0, 400);
    console.log('[upload] OCR text preview:', ocrPreview);

    // Parse source using full OCR text for classification/extraction
    const parsed = parseSource(source, ocrText);
    const { classification, billData, billOverdue } = parsed;
    console.log('[upload] Parsed classification:', {
      type: classification.type,
      confidence: classification.confidence,
      hasBillData: Boolean(billData),
      billKeys: billData ? Object.keys(billData) : []
    });
    console.log('[upload] OCR stored key:', ocrTextStorageKey, 'length:', ocrText.length);

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
      ocr: true,
      extractedBill: parsed.billData,
      overdue: billOverdue,
      ocrSnippet: ocrText.substring(0, 2000),
      ocrStorageKey: ocrTextStorageKey,
      ocrLength: ocrText.length
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
      extracted: parsed.billData,
      overdue: billOverdue,
      ocrText: ocrText.substring(0, 200), // Quick preview for front-end debug
      ocrTextFull: ocrText,
      ocrStorageKey: ocrTextStorageKey
    });
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: 'Failed to process photo' });
  }
});

export default router;
