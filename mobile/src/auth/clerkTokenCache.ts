import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

type TokenFetcher = () => Promise<string | null>;

const STORAGE_PREFIX = 'clerk_token_cache';

export const clerkTokenCache = {
  async getToken(key: string): Promise<string | null> {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storageKey = `${STORAGE_PREFIX}_${safeKey}`;

    try {
      if (typeof SecureStore.getItemAsync === 'function') {
        const value = await SecureStore.getItemAsync(storageKey);
        if (value) {
          // Clear any legacy copies in AsyncStorage.
          await AsyncStorage.removeItem(storageKey).catch(() => {});
          return value;
        }
      }
    } catch (error) {
      console.warn('[Clerk] Failed to read SecureStore token', error);
    }

    try {
      return await AsyncStorage.getItem(storageKey);
    } catch (error) {
      console.warn('[Clerk] Failed to read AsyncStorage token', error);
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storageKey = `${STORAGE_PREFIX}_${safeKey}`;

    try {
      if (typeof SecureStore.setItemAsync === 'function') {
        if (value) {
          await SecureStore.setItemAsync(storageKey, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
          } as any);
          await AsyncStorage.removeItem(storageKey).catch(() => {});
          return;
        }
        if (typeof SecureStore.deleteItemAsync === 'function') {
          await SecureStore.deleteItemAsync(storageKey).catch(() => {});
        }
      }
    } catch (error) {
      console.warn('[Clerk] Failed to persist SecureStore token', error);
    }

    if (!value) {
      await AsyncStorage.removeItem(storageKey).catch(() => {});
      return;
    }

    try {
      await AsyncStorage.setItem(storageKey, value);
    } catch (error) {
      console.warn('[Clerk] Failed to persist AsyncStorage token', error);
    }
  }
};

let tokenFetcher: TokenFetcher | null = null;

export function setClerkTokenFetcher(fetcher: TokenFetcher | null): void {
  tokenFetcher = fetcher;
}

export async function fetchClerkSessionToken(): Promise<string | null> {
  if (!tokenFetcher) {
    return null;
  }
  try {
    return await tokenFetcher();
  } catch (error) {
    console.warn('[Clerk] Token fetcher failed', error);
    return null;
  }
}
