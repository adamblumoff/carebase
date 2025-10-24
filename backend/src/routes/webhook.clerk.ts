import express, { Request, Response } from 'express';
import { Webhook, type WebhookRequiredHeaders } from 'svix';
import { handleClerkWebhookEvent } from '../services/clerkWebhookService.js';

const router = express.Router();

function getRawBody(req: Request): string | null {
  return typeof (req as any).rawBody === 'string' ? ((req as any).rawBody as string) : null;
}

router.post('/', async (req: Request, res: Response) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[ClerkWebhook] CLERK_WEBHOOK_SECRET is not configured');
    res.status(500).json({ error: 'Clerk webhook secret not configured' });
    return;
  }

  const rawBody = getRawBody(req);
  if (!rawBody) {
    res.status(400).json({ error: 'Missing raw request body for Clerk webhook verification' });
    return;
  }

  const headers = req.headers as WebhookRequiredHeaders;
  const webhook = new Webhook(secret);

  try {
    const event = webhook.verify(rawBody, headers) as { type: string; data: Record<string, unknown> };
    await handleClerkWebhookEvent(event);
    res.status(204).end();
  } catch (error) {
    console.error('[ClerkWebhook] signature verification failed', error instanceof Error ? error.message : error);
    res.status(400).json({ error: 'Invalid Clerk webhook signature' });
  }
});

export default router;

