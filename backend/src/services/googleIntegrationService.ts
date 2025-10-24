import type { User } from '@carebase/shared';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { URL } from 'url';
import {
  clearGoogleSyncForUser,
  deleteGoogleCredential,
  findUserById,
  getGoogleIntegrationStatus,
  getUserMfaStatus,
  queueGoogleSyncForUser,
  upsertGoogleCredential
} from '../db/queries.js';
import {
  syncUserWithGoogle,
  exchangeGoogleAuthorizationCode,
  exchangeGoogleAuthorizationCodeServer,
  type GoogleSyncSummary,
  stopCalendarWatchForUser,
  ensureManagedCalendarForUser,
  migrateEventsToManagedCalendar,
  refreshManagedCalendarWatch,
  ensureManagedCalendarAclForUser
} from './googleSync.js';
import { UnauthorizedError, ValidationError } from '../utils/errors.js';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events'
];

async function assertMfaEnrolled(user: User): Promise<void> {
  const status = await getUserMfaStatus(user.id);
  if (!status || status.status !== 'enrolled') {
    throw new ValidationError({
      code: 'mfa_required',
      message: 'Multi-factor authentication must be enrolled before connecting Google Calendar.'
    });
  }
}

function normalizeScope(input: string | string[] | undefined): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return input.split(' ').map((value) => value.trim()).filter(Boolean);
}

function getOAuthClientId(): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID or GOOGLE_CLIENT_ID must be configured');
  }
  return clientId;
}

function getOAuthStateSecret(): string {
  const secret =
    process.env.GOOGLE_AUTH_STATE_SECRET ??
    (process.env.NODE_ENV === 'test' ? 'test-google-state-secret' : undefined);
  if (!secret) {
    throw new Error('GOOGLE_AUTH_STATE_SECRET must be configured');
  }
  return secret;
}

function getServerRedirectUri(): string {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const url = new URL('/api/integrations/google/callback', base);
  return url.toString();
}

export async function startGoogleIntegration(user: User): Promise<{ authUrl: string; redirectUri: string }> {
  await assertMfaEnrolled(user);
  const clientId = getOAuthClientId();
  const statePayload = {
    userId: user.id,
    nonce: crypto.randomBytes(8).toString('hex')
  };

  const state = jwt.sign(statePayload, getOAuthStateSecret(), { expiresIn: '10m' });
  const redirectUri = getServerRedirectUri();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('scope', GOOGLE_SCOPES.join(' '));

  return {
    authUrl: authUrl.toString(),
    redirectUri
  };
}

export async function handleGoogleCallback(params: {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}): Promise<{ redirect: string }> {
  const { code, state, error, error_description: errorDescription } = params;

  if (error) {
    return { redirect: `carebase://integrations/google?status=error&code=${encodeURIComponent(error)}` };
  }

  if (!code || !state) {
    return { redirect: 'carebase://integrations/google?status=error&code=missing_code' };
  }

  let payload: { userId: number; nonce: string };
  try {
    payload = jwt.verify(state, getOAuthStateSecret()) as { userId: number; nonce: string };
  } catch (verifyError) {
    return { redirect: 'carebase://integrations/google?status=error&code=invalid_state' };
  }

  const user = await findUserById(payload.userId);
  if (!user) {
    return { redirect: 'carebase://integrations/google?status=error&code=unknown_user' };
  }

  try {
    await assertMfaEnrolled(user);
  } catch (error) {
    const validation = error instanceof ValidationError ? error : null;
    const code = validation?.code ?? 'mfa_required';
    return { redirect: `carebase://integrations/google?status=error&code=${encodeURIComponent(code)}` };
  }

  const redirectUri = getServerRedirectUri();
  const exchange = await exchangeGoogleAuthorizationCodeServer(code, redirectUri);
  const expiresAt = exchange.expiresIn ? new Date(Date.now() + exchange.expiresIn * 1000) : null;

  const credential = await upsertGoogleCredential(user.id, {
    accessToken: exchange.accessToken,
    refreshToken: exchange.refreshToken,
    scope: exchange.scope,
    expiresAt,
    tokenType: exchange.tokenType,
    idToken: exchange.idToken,
    calendarId: null,
    syncToken: null,
    lastPulledAt: null
  }, { clerkUserId: user.clerkUserId });

  const managed = await ensureManagedCalendarForUser(credential, exchange.accessToken);
  const migrationSummary = await migrateEventsToManagedCalendar(credential, exchange.accessToken, managed.calendarId);
  await refreshManagedCalendarWatch(
    credential,
    exchange.accessToken,
    managed.calendarId,
    migrationSummary.previousCalendarIds
  );
  await ensureManagedCalendarAclForUser(credential, exchange.accessToken, managed.calendarId);

  await queueGoogleSyncForUser(user.id, managed.calendarId);

  return { redirect: 'carebase://integrations/google?status=success' };
}

export async function connectGoogleIntegration(
  user: User,
  payload: {
    accessToken?: string | null;
    refreshToken?: string | null;
    scope?: string | string[];
    expiresAt?: string;
    expiresIn?: number;
    tokenType?: string;
    idToken?: string;
    calendarId?: string | null;
    authorizationCode?: string;
    codeVerifier?: string;
    redirectUri?: string;
  }
): Promise<{ connected: true; summary: GoogleSyncSummary }> {
  await assertMfaEnrolled(user);
  let accessToken = payload.accessToken ?? null;
  let refreshToken = payload.refreshToken ?? null;
  let scope = normalizeScope(payload.scope);
  let expiresAt = payload.expiresAt
    ? new Date(payload.expiresAt)
    : payload.expiresIn
      ? new Date(Date.now() + payload.expiresIn * 1000)
      : null;
  let tokenType = payload.tokenType ?? null;
  let idToken = payload.idToken ?? null;
  const calendarId = payload.calendarId ?? null;

  if (payload.authorizationCode) {
    if (!payload.codeVerifier || !payload.redirectUri) {
      throw new ValidationError({ code: 'missing_code_verifier', message: 'Missing code verifier or redirect URI' });
    }

    const exchange = await exchangeGoogleAuthorizationCode(
      payload.authorizationCode,
      payload.codeVerifier,
      payload.redirectUri
    );

    accessToken = exchange.accessToken;
    refreshToken = exchange.refreshToken;
    scope = exchange.scope.length > 0 ? exchange.scope : scope;
    expiresAt = exchange.expiresIn ? new Date(Date.now() + exchange.expiresIn * 1000) : expiresAt;
    tokenType = exchange.tokenType ?? tokenType;
    idToken = exchange.idToken ?? idToken;
  }

  if (!accessToken || !refreshToken) {
    throw new ValidationError({ code: 'missing_tokens', message: 'Missing Google OAuth tokens' });
  }

  const credential = await upsertGoogleCredential(user.id, {
    accessToken,
    refreshToken,
    scope,
    expiresAt,
    tokenType,
    idToken,
    calendarId,
    syncToken: null,
    lastPulledAt: null
  }, { clerkUserId: user.clerkUserId });

  const managed = await ensureManagedCalendarForUser(credential, accessToken);
  const migrationSummary = await migrateEventsToManagedCalendar(credential, accessToken, managed.calendarId);
  await refreshManagedCalendarWatch(
    credential,
    accessToken,
    managed.calendarId,
    migrationSummary.previousCalendarIds
  );
  await ensureManagedCalendarAclForUser(credential, accessToken, managed.calendarId);

  await queueGoogleSyncForUser(user.id, managed.calendarId);

  const summary = await syncUserWithGoogle(user.id, {
    forceFull: true,
    calendarId: managed.calendarId,
    pullRemote: true
  });

  return { connected: true, summary };
}

export async function disconnectGoogleIntegration(user: User): Promise<{ disconnected: true }> {
  await stopCalendarWatchForUser(user.id).catch((error) => {
    console.warn(
      'Failed to stop Google watch channel during disconnect',
      error instanceof Error ? error.message : error
    );
  });
  await deleteGoogleCredential(user.id);
  await clearGoogleSyncForUser(user.id);
  return { disconnected: true };
}

export async function manualGoogleSync(
  user: User,
  options: { forceFull?: boolean; calendarId?: string | null; pullRemote?: boolean }
): Promise<GoogleSyncSummary> {
  return syncUserWithGoogle(user.id, {
    forceFull: options.forceFull,
    calendarId: options.calendarId ?? null,
    pullRemote: options.pullRemote
  });
}

export async function loadGoogleIntegrationStatus(user: User) {
  return getGoogleIntegrationStatus(user.id);
}

export async function verifyUser(user: User | undefined): Promise<User> {
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}
