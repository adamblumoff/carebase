import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { Item, Source, User } from '@carebase/shared';
import { uploadPhoto } from './upload.js';

test('uploadPhoto skips bill creation when supporting fields are missing', async () => {
  const queries = await import('../../db/queries.js');
  const ocr = await import('../../services/ocr.js');
  const storage = await import('../../services/storage.js');
  const parser = await import('../../services/parser.js');

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

  const findRecipientsMock = mock.method(queries, 'findRecipientsByUserId', async () => [recipient]);
  const createSourceMock = mock.method(queries, 'createSource', async () => source);
  const createItemMock = mock.method(queries, 'createItem', async () => item);
  const createBillMock = mock.method(queries, 'createBill', async () => {
    throw new Error('should not create bill without supporting fields');
  });
  const createAuditMock = mock.method(queries, 'createAuditLog', async () => {});

  mock.method(storage, 'storeFile', async () => 'file-key');
  mock.method(storage, 'storeText', async () => 'text-key');
  mock.method(ocr, 'extractTextFromImage', async () => 'stubbed ocr text');
  mock.method(parser, 'parseSource', () => ({
    classification: { type: 'bill', confidence: 0.82 },
    billData: { amount: 120, status: 'todo' },
    billOverdue: false,
    appointmentData: null
  }));

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

  assert.equal(statusCode, null);
  assert.ok(jsonPayload);
  assert.equal(jsonPayload.bill, null);
  assert.equal(jsonPayload.classification.detectedType, 'bill');
  assert.equal(jsonPayload.extracted.amount, 120);
  assert.equal(jsonPayload.item.reviewStatus, 'pending_review');
  assert.equal(createItemMock.mock.calls[0]?.[4], 'pending_review');
  assert.equal(createBillMock.mock.callCount(), 0);

  assert.equal(findRecipientsMock.mock.callCount(), 1);
  assert.equal(createSourceMock.mock.callCount(), 1);
  assert.equal(createItemMock.mock.callCount(), 1);
  assert.equal(createAuditMock.mock.callCount(), 1);

  mock.restoreAll();
});
