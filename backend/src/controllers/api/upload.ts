import type { Request, Response } from 'express';
import {
  createSource,
  createItem,
  createBill,
  createAuditLog,
  findRecipientsByUserId,
  upsertBillDraft,
  deleteBillDraft,
} from '../../db/queries.js';
import { extractTextFromImage, getShortExcerpt } from '../../services/ocr.js';
import { storeFile, storeText } from '../../services/storage.js';
import { parseSource } from '../../services/parser.js';
import { extractMedicationDraft } from '../../services/medicationOcr.js';
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

    const query = req.query ?? {};
    const intent = typeof (query as Record<string, unknown>).intent === 'string'
      ? String((query as Record<string, unknown>).intent).toLowerCase()
      : null;
    const requestedTimezoneRaw = typeof (query as Record<string, unknown>).timezone === 'string'
      ? String((query as Record<string, unknown>).timezone).trim()
      : '';
    const defaultTimezone = requestedTimezoneRaw.length > 0 ? requestedTimezoneRaw : 'America/New_York';

    let ocrText = '';
    try {
      ocrText = await extractTextFromImage(req.file.buffer);
    } catch (ocrError) {
      console.error('OCR failed:', ocrError);
    }

    const ocrPreview = ocrText.substring(0, 200);

    if (intent === 'medication') {
      const textForExtraction = ocrText.length > 0 ? ocrText : req.file.originalname ?? '';
      const draft = extractMedicationDraft(textForExtraction, defaultTimezone);

      const medicationResponse: UploadPhotoResponse = {
        success: true,
        medicationDraft: draft,
        ocr: {
          preview: ocrPreview,
          storageKey: null,
          length: ocrText.length
        }
      };

      res.json(medicationResponse);
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

    const parsed = parseSource(source, ocrText);
    const { classification, billData, billOverdue } = parsed;

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
      await deleteBillDraft(item.id);
    } else if (classification.type === 'bill') {
      await upsertBillDraft(item.id, {
        amount: billData?.amount ?? null,
        dueDate: billData?.dueDate ?? null,
        statementDate: billData?.statementDate ?? null,
        payUrl: billData?.payUrl ?? null,
        status: billData?.status ?? 'todo',
        notes: null
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
        preview: ocrPreview,
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
