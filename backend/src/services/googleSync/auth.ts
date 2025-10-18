import { GOOGLE_TOKEN_ENDPOINT } from './constants.js';
import { GoogleSyncException } from './types.js';

export function assertClientCredentials(): { clientId: string; clientSecret: string } {
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
