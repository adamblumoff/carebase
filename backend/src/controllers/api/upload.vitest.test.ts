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
  it('returns 401 when request lacks authenticated user', async () => {
    const res: Partial<Response> = {
      status: vi.fn(() => res as Response),
      json: vi.fn(() => res as Response)
    };

    await uploadPhoto({} as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not authenticated' });
  });

  it('returns 400 when no file is attached', async () => {
    const res: Partial<Response> = {
      status: vi.fn(() => res as Response),
      json: vi.fn(() => res as Response)
    };

    await uploadPhoto({ user: { id: 1 } } as unknown as Request, res as Response);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'No file uploaded' });
  });

  it('responds 404 when user has no recipients', async () => {
    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([]);

    const res: Partial<Response> = {
      status: vi.fn(() => res as Response),
      json: vi.fn(() => res as Response)
    };

    await uploadPhoto(
      {
        user: { id: 22 } as User,
        file: { buffer: Buffer.from('fake'), mimetype: 'image/png' }
      } as unknown as Request,
      res as Response
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No recipient found' });
  });

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

  it('persists bill automatically when supporting fields exist', async () => {
    const recipient = { id: 20 } as any;
    const source = { id: 11 } as Source;
    const item = { id: 101, recipientId: recipient.id, sourceId: source.id } as Item;
    const bill = { id: 301 };

    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([recipient]);
    vi.spyOn(queries, 'createSource').mockResolvedValue(source);
    vi.spyOn(queries, 'createItem').mockResolvedValue({ ...item, reviewStatus: 'auto', detectedType: 'bill', confidence: 0.95 } as any);
    const createBillMock = vi.spyOn(queries, 'createBill').mockResolvedValue(bill as any);
    const deleteDraftMock = vi.spyOn(queries, 'deleteBillDraft').mockResolvedValue();
    vi.spyOn(queries, 'createAuditLog').mockResolvedValue();
    vi.spyOn(storage, 'storeFile').mockResolvedValue('file-key');
    vi.spyOn(storage, 'storeText').mockResolvedValue('text-key');
    vi.spyOn(ocr, 'extractTextFromImage').mockResolvedValue('structured bill text');
    vi.spyOn(parser, 'parseSource').mockReturnValue({
      classification: { type: 'bill', confidence: 0.95 },
      billData: { amount: 55, dueDate: '2030-12-01', payUrl: 'https://pay.example.com', status: 'todo' },
      billOverdue: false,
      appointmentData: null
    });

    const res: Partial<Response> = {
      json: vi.fn(() => res as Response),
      status: vi.fn(() => res as Response)
    };

    await uploadPhoto(
      {
        user: { id: 99 } as User,
        file: { buffer: Buffer.from('bill'), mimetype: 'application/pdf' }
      } as unknown as Request,
      res as Response
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(createBillMock).toHaveBeenCalledTimes(1);
    expect(deleteDraftMock).toHaveBeenCalledWith(item.id);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        bill: bill,
        item: expect.objectContaining({ reviewStatus: 'auto' }),
        classification: expect.objectContaining({ detectedType: 'bill' })
      })
    );
  });

  it('continues when OCR and transcript persistence fail', async () => {
    const recipient = { id: 77 } as any;
    const source = { id: 555 } as Source;
    const item = { id: 888, recipientId: recipient.id, sourceId: source.id, reviewStatus: 'auto', detectedType: 'noise', confidence: 0.1 } as any;

    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([recipient]);
    vi.spyOn(queries, 'createSource').mockResolvedValue(source);
    vi.spyOn(queries, 'createItem').mockResolvedValue(item);
    vi.spyOn(queries, 'createAuditLog').mockResolvedValue();
    const upsertDraftMock = vi.spyOn(queries, 'upsertBillDraft').mockResolvedValue();
    const createBillMock = vi.spyOn(queries, 'createBill').mockResolvedValue(null as any);

    vi.spyOn(storage, 'storeFile').mockResolvedValue('file-key');
    vi.spyOn(storage, 'storeText').mockRejectedValue(new Error('disk-full'));
    vi.spyOn(ocr, 'extractTextFromImage').mockRejectedValue(new Error('ocr offline'));
    vi.spyOn(parser, 'parseSource').mockReturnValue({
      classification: { type: 'noise', confidence: 0.2 },
      billData: null,
      billOverdue: false,
      appointmentData: null
    });

    const res: Partial<Response> = {
      json: vi.fn(() => res as Response),
      status: vi.fn(() => res as Response)
    };

    await uploadPhoto(
      {
        user: { id: 10 } as User,
        file: { buffer: Buffer.from('fail-case'), mimetype: 'image/jpeg' }
      } as unknown as Request,
      res as Response
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(createBillMock).not.toHaveBeenCalled();
    expect(upsertDraftMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: expect.objectContaining({ detectedType: 'noise' }),
        bill: null,
        ocr: expect.objectContaining({ storageKey: null })
      })
    );
  });
});
