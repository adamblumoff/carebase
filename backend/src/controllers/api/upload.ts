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
import type { User, UploadPhotoResponse, ItemReviewStatus } from '@carebase/shared';

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

    const billHasAmount = typeof billData?.amount === 'number';
    const billHasSupportField = Boolean(billData?.dueDate || billData?.statementDate || billData?.payUrl);
    const canAutoCreateBill = classification.type === 'bill' && billData && billHasAmount && billHasSupportField;
    const reviewStatus: ItemReviewStatus =
      classification.type === 'bill' && !canAutoCreateBill ? 'pending_review' : 'auto';

    const item = await createItem(
      recipient.id,
      source.id,
      classification.type,
      classification.confidence,
      reviewStatus
    );

    let createdBill = null;
    if (canAutoCreateBill && billData) {
      createdBill = await createBill(item.id, billData);
    } else if (classification.type === 'bill') {
      console.log('[upload] Skipping bill creation due to missing supporting fields', {
        billHasAmount,
        hasDueDate: Boolean(billData?.dueDate),
        hasStatementDate: Boolean(billData?.statementDate),
        hasPayUrl: Boolean(billData?.payUrl)
      });
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
      billAutoCreated: canAutoCreateBill,
      reviewStatus
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
