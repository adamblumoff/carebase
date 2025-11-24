import { config } from 'dotenv';
import { createHmac } from 'crypto';
import { google } from 'googleapis';

config({ path: '.env' });

const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const;

export const hasGoogleConfig = () => required.every((key) => Boolean(process.env[key]));

export const createOAuthClient = () => {
  if (!hasGoogleConfig()) {
    throw new Error('Google OAuth env vars are missing');
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
};

export const createGmailClient = (refreshToken: string) => {
  const oauth = createOAuthClient();
  oauth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth });
  return { gmail, auth: oauth };
};

export const gmailQuery = 'subject:(appointment OR medication OR bill)';

export const googleScope = ['https://www.googleapis.com/auth/gmail.readonly'];

const stateSecret = process.env.GOOGLE_STATE_SECRET;
if (!stateSecret) {
  throw new Error('GOOGLE_STATE_SECRET environment variable is required');
}

export const signState = (payload: { caregiverId: string }) => {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', stateSecret).update(raw).digest('base64url');
  return `${Buffer.from(raw).toString('base64url')}.${signature}`;
};

export const verifyState = (state: string) => {
  const [rawB64, sig] = state.split('.');
  if (!rawB64 || !sig) throw new Error('Invalid state');
  const raw = Buffer.from(rawB64, 'base64url').toString('utf8');
  const expected = createHmac('sha256', stateSecret).update(raw).digest('base64url');
  if (expected !== sig) throw new Error('Invalid state signature');
  const parsed = JSON.parse(raw) as { caregiverId: string };
  if (!parsed?.caregiverId) throw new Error('Invalid state payload');
  return parsed;
};
