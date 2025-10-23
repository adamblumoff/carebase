import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authEvents } from '../authEvents';

const checkSessionMock = vi.fn();
const logoutMock = vi.fn();
const clerkSignOutMock = vi.fn();

vi.mock('../../api/auth', () => ({
  checkSession: () => checkSessionMock(),
  logout: () => logoutMock(),
}));

const clerkState = {
  isLoaded: true,
  isSignedIn: false,
};

const setActiveMock = vi.fn();
const signInResource = {
  create: vi.fn(),
  attemptFirstFactor: vi.fn(),
  reload: vi.fn(),
  firstFactorVerification: {}
};
const signUpResource = {
  create: vi.fn()
};
const oauthResource = {
  startOAuthFlow: vi.fn().mockResolvedValue({ createdSessionId: '', setActive: vi.fn() })
};

vi.mock('@clerk/clerk-expo', () => ({
  useAuth: () => ({
    isLoaded: clerkState.isLoaded,
    isSignedIn: clerkState.isSignedIn,
    signOut: () => clerkSignOutMock(),
    getToken: vi.fn().mockResolvedValue(null)
  }),
  useSignIn: () => ({
    isLoaded: true,
    signIn: signInResource,
    setActive: setActiveMock
  }),
  useSignUp: () => ({
    isLoaded: true,
    signUp: signUpResource
  }),
  useOAuth: () => oauthResource,
  ClerkProvider: ({ children }: any) => <>{children}</>,
  ClerkLoaded: ({ children }: any) => <>{children}</>
}));

let AuthProvider: typeof import('../AuthContext').AuthProvider;
let useAuth: typeof import('../AuthContext').useAuth;

beforeAll(async () => {
  const mod = await import('../AuthContext');
  AuthProvider = mod.AuthProvider;
  useAuth = mod.useAuth;
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    clerkState.isLoaded = true;
    clerkState.isSignedIn = false;
    clerkSignOutMock.mockResolvedValue(undefined);
    checkSessionMock.mockReset();
    logoutMock.mockReset();
  });

  it('stays signedOut when Clerk reports signed out', async () => {
    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
      expect(checkSessionMock).not.toHaveBeenCalled();
    });
  });

  it('hydrates user when Clerk session exists', async () => {
    clerkState.isSignedIn = true;
    const user = { email: 'user@test.com' };
    checkSessionMock.mockResolvedValue({ authenticated: true, user });

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
      expect(latest.current?.user).toEqual(user);
    });
  });

  it('falls back to signedOut when session lookup fails', async () => {
    clerkState.isSignedIn = true;
    checkSessionMock.mockRejectedValue(new Error('bad'));

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });

  it('signIn accepts next user payload', async () => {
    clerkState.isSignedIn = true;
    const override = { email: 'override@test.com' };
    checkSessionMock.mockResolvedValue({ authenticated: true, user: override });

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current).not.toBeNull();
    });

    act(() => {
      latest.current?.signIn(override);
    });

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
      expect(latest.current?.user).toEqual(override);
    });
  });

  it('signOut calls backend + Clerk once', async () => {
    clerkState.isSignedIn = true;
    checkSessionMock.mockResolvedValue({ authenticated: true, user: { email: 'ok@test.com' } });
    logoutMock.mockResolvedValue(undefined);

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
    });

    await act(async () => {
      await Promise.all([latest.current?.signOut(), latest.current?.signOut()]);
      clerkState.isSignedIn = false;
    });

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(clerkSignOutMock).toHaveBeenCalledTimes(1);
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });

  it('reacts to unauthorized events by signing out', async () => {
    clerkState.isSignedIn = true;
    checkSessionMock.mockResolvedValue({ authenticated: true, user: { email: 'ok@test.com' } });
    logoutMock.mockResolvedValue(undefined);

    const latest = renderAuthProvider();

    await waitFor(() => {
      expect(latest.current?.status).toBe('signedIn');
    });

    await act(async () => {
      authEvents.emitUnauthorized();
      clerkState.isSignedIn = false;
    });

    await waitFor(() => {
      expect(logoutMock).toHaveBeenCalled();
      expect(clerkSignOutMock).toHaveBeenCalled();
      expect(latest.current?.status).toBe('signedOut');
      expect(latest.current?.user).toBeNull();
    });
  });
});
