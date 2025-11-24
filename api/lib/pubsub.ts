import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth();

export const verifyPubsubJwt = async (authorization?: string, audience?: string) => {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  const client = await auth.getIdTokenClient(audience ?? '');
  const ticket = await client.verifyIdToken({ idToken: token, audience });
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
    fn();
  }, delayMs);
  debounceMap.set(key, t);
};
