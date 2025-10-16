import type { Request, Response } from 'express';
import type { User } from '@carebase/shared';
import {
  getGoogleIntegrationStatus,
  upsertGoogleCredential,
  deleteGoogleCredential,
  clearGoogleSyncForUser,
  queueGoogleSyncForUser,
  findUserById
} from '../../../db/queries.js';
import {
  syncUserWithGoogle,
  type GoogleSyncSummary,
  exchangeGoogleAuthorizationCode,
  exchangeGoogleAuthorizationCodeServer
} from '../../../services/googleSync.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { URL } from 'url';

interface ConnectRequestBody {
  accessToken?: string;
  refreshToken?: string;
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

interface SyncRequestBody {
  forceFull?: boolean;
  calendarId?: string;
  pullRemote?: boolean;
}

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
];

function normalizeScope(input: ConnectRequestBody['scope']): string[] {
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
  return (
    process.env.GOOGLE_AUTH_STATE_SECRET ??
    process.env.MOBILE_AUTH_SECRET ??
    process.env.SESSION_SECRET ??
    'carebase-google-state'
  );
}

function getServerRedirectUri(): string {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const url = new URL('/api/integrations/google/callback', base);
  return url.toString();
}

export async function startGoogleIntegrationHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const clientId = getOAuthClientId();
    const statePayload = {
      userId: user.id,
      nonce: crypto.randomBytes(8).toString('hex'),
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

    res.json({
      authUrl: authUrl.toString(),
      redirectUri,
    });
  } catch (error) {
    console.error('Google integration start error:', error);
    res.status(500).json({ error: 'Failed to initiate Google Calendar connection' });
  }
}

export async function googleIntegrationCallbackHandler(req: Request, res: Response): Promise<void> {
  try {
    const { code, state, error, error_description: errorDescription } = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (error) {
      console.error('Google integration callback error:', error, errorDescription);
      res.redirect(`carebase://integrations/google?status=error&code=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect('carebase://integrations/google?status=error&code=missing_code');
      return;
    }

    let payload: { userId: number; nonce: string };
    try {
      payload = jwt.verify(state, getOAuthStateSecret()) as { userId: number; nonce: string };
    } catch (verifyError) {
      console.error('Invalid Google integration state:', verifyError);
      res.redirect('carebase://integrations/google?status=error&code=invalid_state');
      return;
    }

    const user = await findUserById(payload.userId);
    if (!user) {
      res.redirect('carebase://integrations/google?status=error&code=unknown_user');
      return;
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
      lastPulledAt: null,
    });

    await queueGoogleSyncForUser(user.id, credential.calendarId ?? null);

    res.redirect('carebase://integrations/google?status=success');
  } catch (error) {
    console.error('Google integration callback failure:', error);
    res.redirect('carebase://integrations/google?status=error&code=server_error');
  }
}

export async function getGoogleIntegrationStatusHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const status = await getGoogleIntegrationStatus(user.id);
    res.json(status);
  } catch (error) {
    console.error('Google integration status error:', error);
    res.status(500).json({ error: 'Failed to load Google integration status' });
  }
}

export async function connectGoogleIntegrationHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as ConnectRequestBody;
    const calendarId = body.calendarId ?? null;

    let accessToken = body.accessToken ?? null;
    let refreshToken = body.refreshToken ?? null;
    let scope = normalizeScope(body.scope);
    let expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : body.expiresIn
        ? new Date(Date.now() + body.expiresIn * 1000)
        : null;
    let tokenType = body.tokenType;
    let idToken = body.idToken;

    if (body.authorizationCode) {
      if (!body.codeVerifier || !body.redirectUri) {
        res.status(400).json({ error: 'Missing code verifier or redirect URI for authorization code exchange' });
        return;
      }

      const exchange = await exchangeGoogleAuthorizationCode(
        body.authorizationCode,
        body.codeVerifier,
        body.redirectUri
      );

      accessToken = exchange.accessToken;
      refreshToken = exchange.refreshToken;
      scope = exchange.scope.length > 0 ? exchange.scope : scope;
      expiresAt = exchange.expiresIn ? new Date(Date.now() + exchange.expiresIn * 1000) : expiresAt;
      tokenType = exchange.tokenType ?? tokenType;
      idToken = exchange.idToken ?? idToken;
    }

    if (!accessToken || !refreshToken) {
      res.status(400).json({ error: 'Missing Google OAuth tokens' });
      return;
    }

    await upsertGoogleCredential(user.id, {
      accessToken,
      refreshToken,
      scope,
      expiresAt,
      tokenType,
      idToken,
      calendarId,
      syncToken: null,
      lastPulledAt: null
    });

    await queueGoogleSyncForUser(user.id, calendarId);

    const summary = await syncUserWithGoogle(user.id, {
      forceFull: true,
      calendarId,
      pullRemote: true
    });

    res.json({ connected: true, summary });
  } catch (error) {
    console.error('Google integration connect error:', error);
    const message = error instanceof Error ? error.message : 'Failed to connect Google Calendar';
    res.status(500).json({ error: message });
  }
}

export async function disconnectGoogleIntegrationHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    await deleteGoogleCredential(user.id);
    await clearGoogleSyncForUser(user.id);

    res.json({ disconnected: true });
  } catch (error) {
    console.error('Google integration disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
  }
}

export async function manualGoogleSyncHandler(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = req.body as SyncRequestBody;
    const summary: GoogleSyncSummary = await syncUserWithGoogle(user.id, {
      forceFull: body.forceFull,
      calendarId: body.calendarId ?? null,
      pullRemote: body.pullRemote
    });

    res.json(summary);
  } catch (error) {
    console.error('Google integration manual sync error:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync with Google Calendar';
    res.status(500).json({ error: message });
  }
}
