import type { Request, Response } from 'express';
import {
  createSource,
  createItem,
  createBill,
  createAuditLog,
  findRecipientsByUserId,
} from '../../db/queries.js';
import { extractTextFromImage, getShortExcerpt } from '../../services/ocr.js';
import { storeFile, storeText } from '../../services/storage.js';
import { parseSource } from '../../services/parser.js';
import type { User, UploadPhotoResponse } from '@carebase/shared';

export async function uploadPhoto(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }
    const recipient = recipients[0];

    const ext = req.file.mimetype.split('/')[1] ?? 'jpg';
    const storageKey = await storeFile(req.file.buffer, ext);

    let ocrText = '';
    try {
      ocrText = await extractTextFromImage(req.file.buffer);
    } catch (ocrError) {
      console.error('OCR failed:', ocrError);
    }

    const shortExcerpt = getShortExcerpt(ocrText);

    let ocrTextStorageKey: string | null = null;
    if (ocrText) {
      try {
        ocrTextStorageKey = await storeText(ocrText);
      } catch (storeErr) {
        console.error('Failed to persist OCR text transcript:', storeErr);
      }
    }

    const source = await createSource(recipient.id, 'upload', {
      externalId: null,
      sender: 'Photo Upload',
      subject: 'Uploaded Bill Photo',
      shortExcerpt,
      storageKey,
    });

    const ocrPreview = ocrText.slice(0, 400);
    console.log('[upload] OCR text preview:', ocrPreview);

    const parsed = parseSource(source, ocrText);
    const { classification, billData, billOverdue } = parsed;
    console.log('[upload] Parsed classification:', {
      type: classification.type,
      confidence: classification.confidence,
      hasBillData: Boolean(billData),
      billKeys: billData ? Object.keys(billData) : [],
    });
    console.log('[upload] OCR stored key:', ocrTextStorageKey, 'length:', ocrText.length);

    const item = await createItem(recipient.id, source.id, classification.type, classification.confidence);

    let createdBill = null;
    if (classification.type === 'bill' && billData) {
      createdBill = await createBill(item.id, billData);
    }

    await createAuditLog(item.id, 'auto_classified', {
      type: classification.type,
      confidence: classification.confidence,
      source: 'photo_upload',
      ocr: true,
      extractedBill: parsed.billData,
      overdue: billOverdue,
      ocrSnippet: ocrText.substring(0, 2000),
      ocrStorageKey: ocrTextStorageKey,
      ocrLength: ocrText.length,
    });

    console.log(
      `Created ${classification.type} from photo upload with confidence ${classification.confidence}`,
    );

    const responsePayload: UploadPhotoResponse = {
      success: true,
      classification: {
        detectedType: classification.type,
        confidence: classification.confidence,
      },
      item,
      bill: createdBill,
      extracted: parsed.billData ?? null,
      overdue: billOverdue,
      ocr: {
        preview: ocrText.substring(0, 200),
        storageKey: ocrTextStorageKey,
        length: ocrText.length,
      },
    };

    res.json(responsePayload);
  } catch (error) {
    console.error('Photo upload error:', error);
    res.status(500).json({ error: 'Failed to process photo' });
  }
}
