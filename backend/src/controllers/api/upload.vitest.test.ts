import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Item, Source, User } from '@carebase/shared';

const queries = await import('../../db/queries.js');
const ocr = await import('../../services/ocr.js');
const storage = await import('../../services/storage.js');
const parser = await import('../../services/parser.js');
const { uploadPhoto } = await import('./upload.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uploadPhoto controller', () => {
  it('skips bill creation when supporting fields are missing', async () => {
    const recipient = { id: 44 } as any;
    const source: Source = {
      id: 91,
      recipientId: recipient.id,
      kind: 'upload',
      externalId: null,
      sender: 'Photo Upload',
      subject: 'Stubbed subject',
      shortExcerpt: 'stub',
      storageKey: 'file-key',
      createdAt: new Date()
    };

    const item: Item = {
      id: 501,
      recipientId: recipient.id,
      sourceId: source.id,
      detectedType: 'bill',
      confidence: 0.82,
      reviewStatus: 'pending_review',
      createdAt: new Date()
    };

    const findRecipientsMock = vi
      .spyOn(queries, 'findRecipientsByUserId')
      .mockResolvedValue([recipient]);
    const createSourceMock = vi.spyOn(queries, 'createSource').mockResolvedValue(source);
    const createItemMock = vi.spyOn(queries, 'createItem').mockResolvedValue(item);
    const createBillMock = vi.spyOn(queries, 'createBill').mockImplementation(() => {
      throw new Error('should not create bill without supporting fields');
    });
    const createAuditMock = vi.spyOn(queries, 'createAuditLog').mockResolvedValue();
    const upsertBillDraftMock = vi.spyOn(queries, 'upsertBillDraft').mockResolvedValue();

    vi.spyOn(storage, 'storeFile').mockResolvedValue('file-key');
    vi.spyOn(storage, 'storeText').mockResolvedValue('text-key');
    vi.spyOn(ocr, 'extractTextFromImage').mockResolvedValue('stubbed ocr text');
    vi.spyOn(parser, 'parseSource').mockReturnValue({
      classification: { type: 'bill', confidence: 0.82 },
      billData: { amount: 120, status: 'todo' },
      billOverdue: false,
      appointmentData: null
    });

    let statusCode: number | null = null;
    let jsonPayload: any = null;
    const res: Partial<Response> = {
      status(code: number) {
        statusCode = code;
        return this as Response;
      },
      json(payload: unknown) {
        jsonPayload = payload;
        return this as Response;
      }
    };

    const req = {
      user: { id: 1 } as User,
      file: {
        buffer: Buffer.from('fake'),
        mimetype: 'image/png'
      }
    } as unknown as Request;

    await uploadPhoto(req, res as Response);

    expect(statusCode).toBeNull();
    expect(jsonPayload).toBeTruthy();
    expect(jsonPayload?.bill).toBeNull();
    expect(jsonPayload?.classification.detectedType).toBe('bill');
    expect(jsonPayload?.extracted.amount).toBe(120);
    expect(jsonPayload?.item.reviewStatus).toBe('pending_review');
    expect(createItemMock.mock.calls[0]?.[4]).toBe('pending_review');
    expect(createBillMock).not.toHaveBeenCalled();

    expect(findRecipientsMock).toHaveBeenCalledTimes(1);
    expect(createSourceMock).toHaveBeenCalledTimes(1);
    expect(createItemMock).toHaveBeenCalledTimes(1);
    expect(createAuditMock).toHaveBeenCalledTimes(1);
    expect(upsertBillDraftMock).toHaveBeenCalledTimes(1);
  });
});
