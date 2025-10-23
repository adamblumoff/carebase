import { logInfo } from './logger.js';
import { GoogleSyncException } from './errors.js';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CHANNELS_API = 'https://www.googleapis.com/calendar/v3/channels/stop';
export const GOOGLE_WEBHOOK_PATH = '/api/integrations/google/webhook';

export function getGoogleWebhookAddress(): string {
  const base =
    process.env.GOOGLE_SYNC_WEBHOOK_BASE_URL ??
    process.env.GOOGLE_SYNC_WEBHOOK_URL ??
    process.env.BASE_URL ??
    'http://localhost:3000';
  const url = new URL(GOOGLE_WEBHOOK_PATH, base);
  return url.toString();
}

export async function googleJsonRequest(
  accessToken: string,
  url: string,
  init: RequestInit & { retry?: boolean } = {}
): Promise<any> {
  const method = (init.method ?? 'GET').toUpperCase();
  let safeUrl = url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('access_token');
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('syncToken');
    safeUrl = `${parsed.origin}${parsed.pathname}${parsed.search ? `?${parsed.search}` : ''}`;
  } catch {
    // leave safeUrl as original when URL parsing fails
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {})
    }
  });

  if (response.status === 204) {
    logInfo(`Google API request succeeded with no content`, { method, url: safeUrl, status: response.status });
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GoogleSyncException(
      `Google API request failed: ${payload.error?.message || response.statusText}`,
      response.status,
      payload.error?.status,
      {
        method,
        url: safeUrl,
        status: response.status,
        payload
      }
    );
  }

  logInfo(`Google API request succeeded`, {
    method,
    url: safeUrl,
    status: response.status,
    payloadSummary: Array.isArray(payload?.items)
      ? { items: payload.items.length, nextSyncToken: payload.nextSyncToken ?? null }
      : Object.keys(payload || {}).slice(0, 5)
  });

  return payload;
}
