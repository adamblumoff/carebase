import { and, eq, inArray, sql } from 'drizzle-orm';

import { pushTokens } from '../db/schema';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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

const shouldDisableTokenFromReceipt = (receipt: any) => {
  if (!receipt) return false;
  if (receipt.status !== 'error') return false;
  const details = receipt.details ?? {};
  const error = details.error ?? receipt.message ?? '';
  return (
    error === 'DeviceNotRegistered' ||
    String(error).includes('DeviceNotRegistered') ||
    String(error).includes('InvalidCredentials')
  );
};

export const sendPushToCaregiver = async ({
  db,
  caregiverId,
  title,
  body,
  data,
  log,
}: {
  db: any;
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

  let responseJson: any = null;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    responseJson = await res.json().catch(() => null);
  } catch (err) {
    log?.error?.({ err, caregiverId }, 'push send failed');
    return { ok: false as const, sent: 0 };
  }

  const receipts = asArray(responseJson?.data);
  const invalidTokens: string[] = [];
  receipts.forEach((receipt, idx) => {
    if (!shouldDisableTokenFromReceipt(receipt)) return;
    const token = messages[idx]?.to;
    if (token) invalidTokens.push(token);
  });

  if (invalidTokens.length) {
    const now = new Date();
    await db
      .update(pushTokens)
      .set({ disabledAt: now, updatedAt: now })
      .where(inArray(pushTokens.token, invalidTokens));
  }

  return { ok: true as const, sent: messages.length };
};
