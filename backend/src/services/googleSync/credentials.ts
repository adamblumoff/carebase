import {
  getGoogleCredential,
  upsertGoogleCredential,
  type GoogleCredential
} from '../../db/queries.js';
import { GOOGLE_TOKEN_ENDPOINT } from './constants.js';
import { assertClientCredentials } from './auth.js';
import { GoogleSyncException, type AuthenticatedCredential } from './types.js';

async function refreshAccessToken(credential: GoogleCredential): Promise<AuthenticatedCredential> {
  const { clientId, clientSecret } = assertClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: credential.refreshToken
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    throw new GoogleSyncException(
      `Failed to refresh Google access token: ${errorPayload.error_description || response.statusText}`,
      response.status,
      errorPayload.error
    );
  }

  const refreshed = (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };

  const nextExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : credential.expiresAt;
  const scope = refreshed.scope ? refreshed.scope.split(' ') : credential.scope;

  const updated = await upsertGoogleCredential(credential.userId, {
    accessToken: refreshed.access_token,
    refreshToken: credential.refreshToken,
    scope,
    expiresAt: nextExpiresAt ?? null,
    tokenType: refreshed.token_type ?? credential.tokenType ?? undefined,
    idToken: refreshed.id_token ?? credential.idToken ?? undefined,
    calendarId: credential.calendarId,
    syncToken: credential.syncToken,
    lastPulledAt: credential.lastPulledAt ?? null
  });

  return { credential: updated, accessToken: updated.accessToken };
}

export async function ensureValidAccessToken(userId: number): Promise<AuthenticatedCredential> {
  const credential = await getGoogleCredential(userId);
  if (!credential) {
    throw new GoogleSyncException('Google Calendar is not connected for this user', 400, 'not_connected');
  }

  const expiresAt = credential.expiresAt ? new Date(credential.expiresAt) : null;
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

  if (!needsRefresh) {
    return { credential, accessToken: credential.accessToken };
  }

  return refreshAccessToken(credential);
}
