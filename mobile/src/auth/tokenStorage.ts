import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export const ACCESS_TOKEN_STORAGE_KEY = 'cb.accessToken';
let secureStoreSupportPromise: Promise<boolean> | null = null;

async function secureStorageAvailable(): Promise<boolean> {
  if (!secureStoreSupportPromise) {
    if (typeof SecureStore.isAvailableAsync !== 'function') {
      secureStoreSupportPromise = Promise.resolve(false);
    } else {
      try {
        const availability = SecureStore.isAvailableAsync();
        if (availability && typeof (availability as Promise<boolean>).then === 'function') {
          secureStoreSupportPromise = (availability as Promise<boolean>)
            .then((available) => available)
            .catch(() => false);
        } else {
          secureStoreSupportPromise = Promise.resolve(Boolean(availability));
        }
      } catch {
        secureStoreSupportPromise = Promise.resolve(false);
      }
    }
  }
  return secureStoreSupportPromise;
}

export async function getAccessToken(): Promise<string | null> {
  if (await secureStorageAvailable()) {
    if (typeof SecureStore.getItemAsync === 'function') {
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_STORAGE_KEY);
      if (token) {
        // Ensure legacy AsyncStorage copies are cleaned up.
        await AsyncStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY).catch(() => {});
        return token;
      }
    }
  }
  return AsyncStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  if (await secureStorageAvailable()) {
    if (typeof SecureStore.setItemAsync === 'function') {
      await SecureStore.setItemAsync(ACCESS_TOKEN_STORAGE_KEY, token, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      } as any);
      await AsyncStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY).catch(() => {});
      return;
    }
  }
  await AsyncStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

export async function removeAccessToken(): Promise<void> {
  if (await secureStorageAvailable()) {
    if (typeof SecureStore.deleteItemAsync === 'function') {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_STORAGE_KEY).catch(() => {});
    }
  }
  await AsyncStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY).catch(() => {});
}
