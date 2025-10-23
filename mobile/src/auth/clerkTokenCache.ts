type TokenFetcher = () => Promise<string | null>;

const STORAGE_PREFIX = 'clerk_token_cache';
const DEFAULT_TOKEN_KEY = 'session';
const CLOCK_SKEW_MS = 60_000;

type AsyncStorageLike = {
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

type SecureStoreLike = {
  getItemAsync?: (key: string) => Promise<string | null>;
  setItemAsync?: (
    key: string,
    value: string,
    options?: { keychainAccessible?: unknown }
  ) => Promise<void>;
  deleteItemAsync?: (key: string) => Promise<void>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: unknown;
};

let asyncStorage: AsyncStorageLike | null = null;
let secureStore: SecureStoreLike | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-async-storage/async-storage');
  asyncStorage = mod?.default ?? mod;
} catch {
  asyncStorage = null;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  secureStore = require('expo-secure-store');
} catch {
  secureStore = null;
}

type MemoryEntry = {
  token: string;
  expiresAt: number | null;
};

const memoryTokens = new Map<string, MemoryEntry>();

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function isExpired(entry: MemoryEntry | undefined): boolean {
  if (!entry) {
    return true;
  }
  if (!entry.expiresAt) {
    return false;
  }
  return entry.expiresAt - CLOCK_SKEW_MS <= Date.now();
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    let json: string;
    if (typeof globalThis.atob === 'function') {
      const binary = globalThis.atob(padded);
      let result = '';
      for (let i = 0; i < binary.length; i += 1) {
        result += String.fromCharCode(binary.charCodeAt(i));
      }
      json = result;
    } else if (typeof (globalThis as any).Buffer !== 'undefined') {
      json = (globalThis as any).Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    const data = JSON.parse(json) as { exp?: number };
    if (typeof data.exp === 'number') {
      return data.exp * 1000;
    }
  } catch (error) {
    console.warn('[Clerk] Failed to decode token expiry', error);
  }
  return null;
}

function setMemoryToken(key: string, token: string | null): void {
  const normalized = sanitizeKey(key);
  if (!token) {
    memoryTokens.delete(normalized);
    return;
  }
  const expiresAt = decodeJwtExpiry(token);
  memoryTokens.set(normalized, { token, expiresAt });
}

function getMemoryToken(key: string): string | null {
  const normalized = sanitizeKey(key);
  const entry = memoryTokens.get(normalized);
  if (!entry) {
    return null;
  }
  if (isExpired(entry)) {
    memoryTokens.delete(normalized);
    return null;
  }
  return entry.token;
}

export const clerkTokenCache = {
  async getToken(key: string): Promise<string | null> {
    const safeKey = sanitizeKey(key);
    const cached = getMemoryToken(safeKey);
    if (cached) {
      return cached;
    }

    const storageKey = `${STORAGE_PREFIX}_${safeKey}`;

    try {
      if (typeof secureStore?.getItemAsync === 'function') {
        const value = await secureStore.getItemAsync(storageKey);
        if (value) {
          await asyncStorage?.removeItem?.(storageKey).catch(() => {});
          setMemoryToken(safeKey, value);
          const cachedValue = getMemoryToken(safeKey);
          return cachedValue;
        }
      }
    } catch (error) {
      console.warn('[Clerk] Failed to read SecureStore token', error);
    }

    try {
      const value = await asyncStorage?.getItem?.(storageKey);
      if (value) {
        setMemoryToken(safeKey, value);
        return getMemoryToken(safeKey);
      }
      return value;
    } catch (error) {
      console.warn('[Clerk] Failed to read AsyncStorage token', error);
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    const safeKey = sanitizeKey(key);
    setMemoryToken(safeKey, value || null);

    const storageKey = `${STORAGE_PREFIX}_${safeKey}`;

    try {
      if (typeof secureStore?.setItemAsync === 'function') {
        if (value) {
          await secureStore.setItemAsync(storageKey, value, {
            keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
          } as any);
          await asyncStorage?.removeItem?.(storageKey).catch(() => {});
          return;
        }
        if (typeof secureStore.deleteItemAsync === 'function') {
          await secureStore.deleteItemAsync(storageKey).catch(() => {});
        }
      }
    } catch (error) {
      console.warn('[Clerk] Failed to persist SecureStore token', error);
    }

    if (!value) {
      await asyncStorage?.removeItem?.(storageKey).catch(() => {});
      return;
    }

    try {
      await asyncStorage?.setItem?.(storageKey, value);
    } catch (error) {
      console.warn('[Clerk] Failed to persist AsyncStorage token', error);
    }
  }
};

let tokenFetcher: TokenFetcher | null = null;

export function clearClerkTokenCache(key: string = DEFAULT_TOKEN_KEY): void {
  const safeKey = sanitizeKey(key);
  setMemoryToken(safeKey, null);
  const storageKey = `${STORAGE_PREFIX}_${safeKey}`;
  secureStore?.deleteItemAsync?.(storageKey).catch(() => {});
  asyncStorage?.removeItem?.(storageKey).catch(() => {});
}

export function setClerkTokenFetcher(fetcher: TokenFetcher | null): void {
  if (!fetcher) {
    tokenFetcher = null;
    setMemoryToken(DEFAULT_TOKEN_KEY, null);
    return;
  }
  tokenFetcher = async () => {
    const token = await fetcher();
    if (token) {
      setMemoryToken(DEFAULT_TOKEN_KEY, token);
    }
    return token;
  };
}

export async function fetchClerkSessionToken(): Promise<string | null> {
  const cached = getMemoryToken(DEFAULT_TOKEN_KEY);
  if (cached) {
    return cached;
  }

  const persisted = await clerkTokenCache.getToken(DEFAULT_TOKEN_KEY);
  if (persisted) {
    return persisted;
  }

  if (!tokenFetcher) {
    return null;
  }

  try {
    const token = await tokenFetcher();
    if (token) {
      setMemoryToken(DEFAULT_TOKEN_KEY, token);
    }
    return token;
  } catch (error) {
    console.warn('[Clerk] Token fetcher failed', error);
    return null;
  }
}
