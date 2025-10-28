import { describe, expect, it, vi } from 'vitest';

import {
  finishSignInWithFallback,
  isAlreadySignedInError,
  resolveSessionId,
  type ClerkAuthSnapshot,
  type SetActiveFn
} from '../loginHelpers';

describe('LoginScreen OAuth helpers', () => {
  it('activates explicit session id when provided', async () => {
    const setActive = vi.fn<Parameters<SetActiveFn>, ReturnType<SetActiveFn>>();
    const signIn = vi.fn();

    const result = await finishSignInWithFallback({
      candidateSessionId: 'sess_candidate',
      clerkAuth: {} as ClerkAuthSnapshot,
      activeSetter: setActive,
      signIn
    });

    expect(result).toBe(true);
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_candidate' });
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('falls back to clerk auth session id when candidate missing', async () => {
    const setActive = vi.fn<Parameters<SetActiveFn>, ReturnType<SetActiveFn>>();
    const signIn = vi.fn();

    const result = await finishSignInWithFallback({
      clerkAuth: { sessionId: 'sess_auth', setActive } as ClerkAuthSnapshot,
      signIn
    });

    expect(result).toBe(true);
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_auth' });
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('invokes sign in when already signed in but session id unavailable', async () => {
    const signIn = vi.fn();

    const result = await finishSignInWithFallback({
      clerkAuth: { isSignedIn: true } as ClerkAuthSnapshot,
      signIn
    });

    expect(result).toBe(true);
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('returns false when no session and not signed in', async () => {
    const signIn = vi.fn();

    const result = await finishSignInWithFallback({
      clerkAuth: { isSignedIn: false } as ClerkAuthSnapshot,
      signIn
    });

    expect(result).toBe(false);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('resolves session id preference order', () => {
    const snapshot: ClerkAuthSnapshot = { sessionId: 'sess_auth', session: { id: 'sess_fallback' } };

    expect(resolveSessionId('sess_candidate', snapshot)).toBe('sess_candidate');
    expect(resolveSessionId(null, snapshot)).toBe('sess_auth');
    expect(resolveSessionId(null, { session: { id: 'sess_from_session' } })).toBe('sess_from_session');
    expect(resolveSessionId(null, {})).toBeNull();
  });

  it('detects already-signed-in errors', () => {
    expect(isAlreadySignedInError(new Error("You're already signed in."))).toBe(true);
    expect(isAlreadySignedInError({ message: 'Already Signed In' })).toBe(true);
    expect(isAlreadySignedInError({ errors: [{ code: 'session_exists' }] })).toBe(true);
    expect(isAlreadySignedInError({})).toBe(false);
    expect(isAlreadySignedInError(null)).toBe(false);
  });
});
