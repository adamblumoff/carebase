import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  createSource,
  createItem,
  createAppointment,
  createBill,
  createAuditLog,
  findUserById,
  markGoogleSyncPending
} from '../db/queries.js';
import { parseSource } from '../services/parser.js';
import { storeText } from '../services/storage.js';
import type { Source } from '@carebase/shared';

const router = express.Router();

const rateLimitWindowMs = 60_000;
const defaultRateLimit = Number.parseInt(process.env.INBOUND_WEBHOOK_RATE_LIMIT ?? '30', 10);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function pruneRateLimitBuckets(now: number): void {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function rateLimitInbound(req: Request, res: Response, next: NextFunction): void {
  if (!Number.isFinite(defaultRateLimit) || defaultRateLimit <= 0) {
    next();
    return;
  }

  const now = Date.now();
  pruneRateLimitBuckets(now);
  const key =
    (req.ip && req.ip !== '::ffff:127.0.0.1' ? req.ip : req.headers['x-forwarded-for'])?.toString() ??
    'unknown';
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > defaultRateLimit) {
    res.status(429).json({ error: 'Too many inbound webhook requests' });
    return;
  }

  next();
}

function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getRawBody(req: Request): string | null {
  return typeof (req as any).rawBody === 'string' ? ((req as any).rawBody as string) : null;
}

function validatePostmarkSignature(req: Request, rawBody: string): boolean {
  const signature = req.header('x-postmark-signature');
  const secret = process.env.POSTMARK_INBOUND_SECRET;
  if (!signature) {
    return false;
  }
  if (!secret) {
    console.error('POSTMARK_INBOUND_SECRET is not set; refusing to accept Postmark webhook');
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  return timingSafeCompare(signature, expected);
}

function validateResendSignature(req: Request, rawBody: string): boolean {
  const signature = req.header('x-resend-signature');
  const timestamp = req.header('x-resend-timestamp');
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!signature) {
    return false;
  }
  if (!secret || !timestamp) {
    console.error('Resend webhook received without configured RESEND_INBOUND_SECRET or timestamp header');
    return false;
  }
  const toleranceMs = Number.parseInt(process.env.RESEND_WEBHOOK_TOLERANCE_MS ?? `${5 * 60_000}`, 10);
  const tsNumber = Number.parseInt(timestamp, 10);
  if (Number.isFinite(tsNumber) && toleranceMs > 0) {
    const age = Math.abs(Date.now() - tsNumber * 1000);
    if (age > toleranceMs) {
      console.warn('Resend webhook signature expired', { ageMs: age });
      return false;
    }
  }
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return timingSafeCompare(signature, expected);
}

function verifyInboundSignature(req: Request): boolean {
  const rawBody = getRawBody(req);
  if (!rawBody) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Inbound webhook missing raw body for signature verification');
      return false;
    }
    return true;
  }

  if (req.header('x-postmark-signature')) {
    return validatePostmarkSignature(req, rawBody);
  }
  if (req.header('x-resend-signature')) {
    return validateResendSignature(req, rawBody);
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('Inbound webhook missing signature headers');
    return false;
  }
  return true;
}

/**
 * Postmark inbound email webhook
 * Expects: { From, To, Subject, TextBody, MessageID }
 * Also supports Resend format for backward compatibility
 */
router.post('/inbound-email', rateLimitInbound, async (req: Request, res: Response) => {
  try {
    if (!verifyInboundSignature(req)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
    // Handle both Postmark (capitalized) and Resend (lowercase) formats
    const from = req.body.From || req.body.from;
    const to = req.body.To || req.body.to;
    const subject = req.body.Subject || req.body.subject;
    const text = req.body.TextBody || req.body.text;
    const messageId = req.body.MessageID || req.body.messageId;

    console.log('Inbound email webhook:', { from, to, subject, provider: req.body.From ? 'Postmark' : 'Resend' });

    // Find user by forwarding address
    const userResult = await import('../db/client.js').then(m => m.default.query(
      'SELECT u.*, r.id as recipient_id FROM users u JOIN recipients r ON u.id = r.user_id WHERE u.forwarding_address = $1 LIMIT 1',
      [to]
    ));

    if (userResult.rows.length === 0) {
      console.log('No user found for forwarding address:', to);
      return res.status(404).json({ error: 'User not found' });
    }

    const { recipient_id } = userResult.rows[0];

    // Extract short excerpt (first 500 chars)
    const shortExcerpt = text ? text.substring(0, 500) : '';

    // Store full text if longer
    let storageKey = null;
    if (text && text.length > 500) {
      storageKey = await storeText(text);
    }

    // Create source record
    const source = await createSource(recipient_id, 'email', {
      externalId: messageId,
      sender: from,
      subject,
      shortExcerpt,
      storageKey
    });

    // Parse source to create item
    await processSource(source);

    res.json({ success: true, sourceId: source.id });
  } catch (error) {
    console.error('Inbound email webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Process source and create item
 * @param source - Source record
 */
async function processSource(source: Source): Promise<void> {
  const parsed = parseSource(source);
  const { classification, appointmentData, billData } = parsed;

  // Create item
    const item = await createItem(
      source.recipientId,
      source.id,
      classification.type,
      classification.confidence
    );

  // Create appointment or bill based on classification
  if (classification.type === 'appointment' && appointmentData) {
    const appointment = await createAppointment(item.id, appointmentData, { mutationSource: 'inbound' });
    await markGoogleSyncPending(appointment.itemId);
  } else if (classification.type === 'bill' && billData) {
    const bill = await createBill(item.id, billData, { mutationSource: 'inbound' });
    await markGoogleSyncPending(bill.itemId);
  }

  // Log audit entry
  await createAuditLog(item.id, 'auto_classified', {
    type: classification.type,
    confidence: classification.confidence,
    sender: source.sender,
    subject: source.subject
  });

  console.log(`Created ${classification.type} item with confidence ${classification.confidence}`);
}

export default router;
