import { OAuth2Client } from 'google-auth-library';

const oauthClient = new OAuth2Client();

export const verifyPubsubJwt = async (authorization?: string, audience?: string) => {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  // Pub/Sub push tokens are Google-signed; public certs are fetched without ADC.
  const ticket = await oauthClient.verifyIdToken({ idToken: token, audience });
  return ticket.getPayload();
};

export const debounceMap = new Map<string, NodeJS.Timeout>();

export const debounceRun = (key: string, delayMs: number, fn: () => void) => {
  const existing = debounceMap.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const t = setTimeout(() => {
    debounceMap.delete(key);
    try {
      const maybePromise = fn();
      if (maybePromise instanceof Promise) {
        void maybePromise.catch((err) => {
          console.error('debounced fn rejected', err);
        });
      }
    } catch (err) {
      console.error('debounced fn threw', err);
    }
  }, delayMs);
  debounceMap.set(key, t);
};
