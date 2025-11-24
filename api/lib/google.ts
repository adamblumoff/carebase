import { config } from 'dotenv';
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
