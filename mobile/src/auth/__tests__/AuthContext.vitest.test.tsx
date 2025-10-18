import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authEvents } from '../authEvents';
import { ACCESS_TOKEN_STORAGE_KEY } from '../tokenStorage';

vi.mock('expo-secure-store', () => ({
  __esModule: true,
  isAvailableAsync: vi.fn().mockResolvedValue(false),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
}));

const checkSessionMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('../../api/auth', () => ({
  checkSession: () => checkSessionMock(),
  logout: () => logoutMock(),
}));

function renderAuthProvider() {
  const latest: { current: ReturnType<typeof useAuth> | null } = { current: null };

  function Capture() {
    latest.current = useAuth();
    return null;
  }

  render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  );

  return latest;
}

describe('AuthProvider', () => {
beforeEach(async () => {
  vi.clearAllMocks();
  await AsyncStorage.clear();
});

  it('boots to signedOut when no token', async () => {
    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });

  it('hydrates user when token and session valid', async () => {
    const user = { email: 'user@test.com' };
    await AsyncStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'token');
    checkSessionMock.mockResolvedValue({ authenticated: true, user });

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
      expect(latest.current?.user).toEqual(user);
    });
  });

  it('clears token and signs out when session check fails', async () => {
    await AsyncStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'token');
    checkSessionMock.mockRejectedValue(new Error('bad'));

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });

  it('signIn updates status immediately', async () => {
    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current).not.toBeNull();
    });

    const { signIn } = latest.current!;
    const nextUser = { email: 'fresh@test.com' };

    act(() => {
      signIn(nextUser);
    });

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
      expect(latest.current?.user).toEqual(nextUser);
    });
  });

  it('signOut removes token, invokes logout, and flips status once', async () => {
    await AsyncStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'token');
    checkSessionMock.mockResolvedValue({ authenticated: true, user: { email: 'ok@test.com' } });
    logoutMock.mockResolvedValue(undefined);

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
    });

    const { signOut } = latest.current!;

    await act(async () => {
      await Promise.all([signOut(), signOut()]);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(ACCESS_TOKEN_STORAGE_KEY);
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });

  it('reacts to unauthorized events by signing out', async () => {
    await AsyncStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'token');
    checkSessionMock.mockResolvedValue({ authenticated: true, user: { email: 'ok@test.com' } });
    logoutMock.mockResolvedValue(undefined);

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
    });

    await act(async () => {
      authEvents.emitUnauthorized();
    });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });
});
let AuthProvider: typeof import('../AuthContext').AuthProvider;
let useAuth: typeof import('../AuthContext').useAuth;

beforeAll(async () => {
  const mod = await import('../AuthContext');
  AuthProvider = mod.AuthProvider;
  useAuth = mod.useAuth;
});
