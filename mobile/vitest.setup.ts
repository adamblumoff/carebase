import React from 'react';
import { vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(async () => {
        store.clear();
      })
    }
  };
});

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn().mockResolvedValue({ type: 'dismiss' })
}));

vi.mock('expo-linking', () => ({
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  getInitialURL: vi.fn(async () => null)
}));

vi.mock('expo-constants', () => {
  let appOwnership = 'standalone';
  return {
    __esModule: true,
    default: {
      expoConfig: { extra: {} },
      get appOwnership() {
        return appOwnership;
      }
    },
    __setAppOwnership: (value: string) => {
      appOwnership = value;
    }
  };
});

vi.mock('expo-notifications', () => {
  const defaultPermission = {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never'
  } as const;
  const grantedPermission = {
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never'
  } as const;

  const getPermissionsAsync = vi.fn(async () => ({ ...defaultPermission }));
  const requestPermissionsAsync = vi.fn(async () => ({ ...grantedPermission }));
  const getAllScheduledNotificationsAsync = vi.fn(async () => []);
  const scheduleNotificationAsync = vi.fn(async () => 'mock-notification-id');
  const cancelScheduledNotificationAsync = vi.fn(async () => {});

  return {
    __esModule: true,
    setNotificationHandler: vi.fn(),
    addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
    getLastNotificationResponseAsync: vi.fn(async () => null),
    setNotificationCategoryAsync: vi.fn(async () => {}),
    setNotificationChannelAsync: vi.fn(async () => {}),
    getPermissionsAsync,
    requestPermissionsAsync,
    getAllScheduledNotificationsAsync,
    scheduleNotificationAsync,
    cancelScheduledNotificationAsync,
    AndroidImportance: { MAX: 5 }
  };
});

const defaultClerkState = {
  isLoaded: true,
  isSignedIn: false,
  signOut: vi.fn().mockResolvedValue(undefined),
  getToken: vi.fn().mockResolvedValue(null)
};

const defaultSignInResource = {
  create: vi.fn(),
  attemptFirstFactor: vi.fn(),
  reload: vi.fn(),
  firstFactorVerification: {}
};

const defaultSignUpResource = {
  create: vi.fn()
};

const defaultOAuthResource = {
  startOAuthFlow: vi.fn().mockResolvedValue({ createdSessionId: '', setActive: vi.fn() })
};

vi.mock('@clerk/clerk-expo', () => ({
  __esModule: true,
  ClerkProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  ClerkLoaded: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SignedIn: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  SignedOut: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useAuth: () => ({
    ...defaultClerkState
  }),
  useSignIn: () => ({
    isLoaded: true,
    signIn: defaultSignInResource,
    setActive: vi.fn()
  }),
  useSignUp: () => ({
    isLoaded: true,
    signUp: defaultSignUpResource
  }),
  useOAuth: () => defaultOAuthResource,
  __clerkMockState: {
    auth: defaultClerkState,
    signIn: defaultSignInResource,
    signUp: defaultSignUpResource,
    oauth: defaultOAuthResource
  }
}));
