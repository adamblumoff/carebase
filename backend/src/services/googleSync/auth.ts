import {
  getGoogleCredential,
  upsertGoogleCredential,
  type GoogleCredential
} from '../../db/queries.js';
import { GoogleSyncException } from './errors.js';
import { GOOGLE_TOKEN_ENDPOINT } from './http.js';
import type { AuthenticatedCredential } from './types.js';

function assertClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleSyncException('Missing Google OAuth client credentials', 500, 'missing_credentials');
  }
  return { clientId, clientSecret };
}

export async function exchangeGoogleAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn?: number;
  tokenType?: string;
  idToken?: string;
}> {
  const { clientId, clientSecret } = assertClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new GoogleSyncException(
      `Failed to exchange authorization code: ${payload.error_description || response.statusText}`,
      response.status,
      payload.error
    );
  }

  if (!payload.refresh_token) {
    throw new GoogleSyncException(
      'Google did not return a refresh token. Ensure access_type=offline and prompt=consent.',
      400,
      'missing_refresh_token'
    );
  }

  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
    scope,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : undefined
  };
}

export async function exchangeGoogleAuthorizationCodeServer(
  authorizationCode: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn?: number;
  tokenType?: string;
  idToken?: string;
}> {
  const { clientId, clientSecret } = assertClientCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    access_type: 'offline'
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GoogleSyncException(
      `Failed to exchange authorization code: ${payload.error_description || response.statusText}`,
      response.status,
      payload.error
    );
  }

  if (!payload.refresh_token) {
    throw new GoogleSyncException(
      'Google did not return a refresh token. Ensure access_type=offline and prompt=consent.',
      400,
      'missing_refresh_token'
    );
  }

  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token as string,
    scope,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : undefined,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : undefined
  };
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

  const refreshed = await refreshAccessToken(credential);

  const nextExpiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : credential.expiresAt;
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
    lastPulledAt: credential.lastPulledAt ?? null,
    managedCalendarId: credential.managedCalendarId ?? null,
    managedCalendarSummary: credential.managedCalendarSummary ?? null,
    managedCalendarState: credential.managedCalendarState ?? null,
    managedCalendarVerifiedAt: credential.managedCalendarVerifiedAt ?? null,
    managedCalendarAclRole: credential.managedCalendarAclRole ?? null,
    legacyCalendarId: credential.legacyCalendarId ?? null
  });

  return { credential: updated, accessToken: updated.accessToken };
}

async function refreshAccessToken(
  credential: GoogleCredential
): Promise<{
  access_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}> {
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

  return (await response.json()) as {
    access_token: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    id_token?: string;
  };
}
