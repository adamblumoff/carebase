import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DbClient } from '../db/client';
import { pushTokens } from '../db/schema';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_MAX_MESSAGES_PER_REQUEST = 100;

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
};

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const chunk = <T>(values: T[], size: number) => {
  if (size <= 0) return [values];
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
};

const shouldDisableTokenFromReceipt = (receipt: any) => {
  if (!receipt) return false;
  if (receipt.status !== 'error') return false;
  const details = receipt.details ?? {};
  const error = details.error ?? receipt.message ?? '';
  return error === 'DeviceNotRegistered' || String(error).includes('DeviceNotRegistered');
};

export const sendPushToCaregiver = async ({
  db,
  caregiverId,
  title,
  body,
  data,
  log,
}: {
  db: DbClient;
  caregiverId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  log?: any;
}) => {
  const tokens = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(and(eq(pushTokens.caregiverId, caregiverId), sql`${pushTokens.disabledAt} IS NULL`));

  const toList = tokens.map((t: any) => t.token).filter(Boolean);
  if (!toList.length) return { ok: true as const, sent: 0 };

  const messages: ExpoPushMessage[] = toList.map((to) => ({
    to,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
  }));

  const invalidTokens: string[] = [];
  const chunks = chunk(messages, EXPO_MAX_MESSAGES_PER_REQUEST);
  let ok = true;
  let sent = 0;

  for (const batch of chunks) {
    let responseJson: any = null;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      const raw = await res.text().catch(() => '');
      responseJson = raw ? JSON.parse(raw) : null;

      if (!res.ok) {
        ok = false;
        log?.error?.(
          { status: res.status, caregiverId, body: raw.slice(0, 500) },
          'push send failed (non-2xx)'
        );
        continue;
      }

      if (!responseJson || !responseJson.data) {
        ok = false;
        log?.error?.({ caregiverId, body: raw.slice(0, 500) }, 'push send failed (bad response)');
        continue;
      }
    } catch (err) {
      ok = false;
      log?.error?.({ err, caregiverId }, 'push send failed');
      continue;
    }

    const receipts = asArray(responseJson?.data);
    receipts.forEach((receipt, idx) => {
      if (!shouldDisableTokenFromReceipt(receipt)) return;
      const token = batch[idx]?.to;
      if (token) invalidTokens.push(token);
    });
    sent += batch.length;
  }

  if (invalidTokens.length) {
    const now = new Date();
    await db
      .update(pushTokens)
      .set({ disabledAt: now, updatedAt: now })
      .where(inArray(pushTokens.token, invalidTokens));
  }

  return { ok: ok as boolean, sent };
};
