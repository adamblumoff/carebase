import { logInfo } from './logger.js';
import { GoogleSyncException } from './types.js';

export interface GoogleJsonRequestOptions {
  verbose?: boolean;
}

export async function googleJsonRequest(
  accessToken: string,
  url: string,
  init: RequestInit & { retry?: boolean } = {},
  options: GoogleJsonRequestOptions = {}
): Promise<any> {
  const verbose = options.verbose ?? false;
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
    if (verbose) {
      logInfo(`Google API request succeeded with no content`, {
        method,
        url: safeUrl,
        status: response.status
      });
    }
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

  if (verbose) {
    logInfo(`Google API request succeeded`, {
      method,
      url: safeUrl,
      status: response.status,
      payloadSummary: Array.isArray(payload?.items)
        ? { items: payload.items.length, nextSyncToken: payload.nextSyncToken ?? null }
        : Object.keys(payload || {}).slice(0, 5)
    });
  }

  return payload;
}
