import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { checkSession, logout as apiLogout } from '../api/auth';
import { authEvents } from './authEvents';
import { clearClerkTokenCache } from './clerkTokenCache';
import { useAuth as useClerkAuth } from '@clerk/clerk-expo';

const AUTO_RETRY_DELAY_MS = 2000;
const DEFAULT_SESSION_ERROR = 'We couldn\'t refresh your session. Please try again.';

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn' | 'error';
  user: any | null;
  lastError: string | null;
  pendingRetry: boolean;
  signIn: (user?: any) => void;
  signOut: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'signedIn' | 'error'>('loading');
  const [user, setUser] = useState<any | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const signOutInProgress = useRef(false);
  const statusRef = useRef<'loading' | 'signedOut' | 'signedIn' | 'error'>(status);
  const bootstrappedRef = useRef(false);
  const sessionRequestRef = useRef<Promise<void> | null>(null);
  const clerkSignedInRef = useRef<boolean | null>(null);
  const autoRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryAttemptedRef = useRef(false);
  const { isLoaded, isSignedIn, signOut: clerkSignOut } = useClerkAuth();

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  type LoadSessionOptions = {
    initial?: boolean;
    keepSignedIn?: boolean;
  };

  const loadSessionUser = useCallback(async (options: LoadSessionOptions = {}) => {
    const { initial = false, keepSignedIn = false } = options;

    if (sessionRequestRef.current) {
      return sessionRequestRef.current;
    }

    if (initial || !keepSignedIn) {
      setStatus('loading');
      setLastError(null);
    }

    if (autoRetryTimeoutRef.current) {
      clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
    }

    const request = (async () => {
      try {
        const session = await checkSession();
        setLastError(null);
        setPendingRetry(false);
        autoRetryAttemptedRef.current = false;

        if (session.authenticated) {
          setUser(session.user ?? null);
          setStatus('signedIn');
        } else {
          setUser(null);
          setStatus('signedOut');
        }
      } catch (error) {
        console.error('Session bootstrap error', error);
        setUser(null);
        setStatus('error');
        setLastError(DEFAULT_SESSION_ERROR);

        if (initial && !autoRetryAttemptedRef.current) {
          autoRetryAttemptedRef.current = true;
          setPendingRetry(true);
          autoRetryTimeoutRef.current = setTimeout(() => {
            const retryPromise = loadSessionUser({ keepSignedIn: true });
            retryPromise
              .catch(() => {
                // error handling occurs inside loadSessionUser
              })
              .finally(() => {
                setPendingRetry(false);
              });
          }, AUTO_RETRY_DELAY_MS);
        } else {
          setPendingRetry(false);
        }
      } finally {
        bootstrappedRef.current = true;
        sessionRequestRef.current = null;
      }
    })();

    sessionRequestRef.current = request;
    return request;
  }, []);

  const signIn = useCallback(
    (nextUser?: any) => {
      setLastError(null);
      setPendingRetry(false);
      if (nextUser) {
        setUser(nextUser ?? null);
        setStatus('signedIn');
        bootstrappedRef.current = true;
        return;
      }
      loadSessionUser({ keepSignedIn: true }).catch(() => {
        // handled in loadSessionUser
      });
    },
    [loadSessionUser]
  );

  const signOut = useCallback(async () => {
    if (statusRef.current === 'signedOut' || signOutInProgress.current) {
      return;
    }
    signOutInProgress.current = true;
    try {
      await Promise.allSettled([
        clerkSignOut().catch((error) => {
          console.warn('Clerk sign out failed', error);
        }),
        apiLogout().catch((error) => {
          console.warn('Logout call failed', error);
        })
      ]);
      clearClerkTokenCache();
      setUser(null);
      setStatus('signedOut');
      setLastError(null);
      setPendingRetry(false);
      autoRetryAttemptedRef.current = false;
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
        autoRetryTimeoutRef.current = null;
      }
    } catch (error) {
      console.warn('Logout request error', error);
    } finally {
      signOutInProgress.current = false;
    }
  }, [clerkSignOut]);

  const retrySession = useCallback(async () => {
    if (pendingRetry) {
      return;
    }

    setPendingRetry(true);
    setLastError(null);

    if (autoRetryTimeoutRef.current) {
      clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
    }

    try {
      await loadSessionUser({ keepSignedIn: true });
    } finally {
      setPendingRetry(false);
    }
  }, [pendingRetry, loadSessionUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      lastError,
      pendingRetry,
      signIn,
      signOut,
      retrySession
    }),
    [status, user, lastError, pendingRetry, signIn, signOut, retrySession]
  );

  useEffect(() => {
    if (!isLoaded) {
      return () => {};
    }

    const wasSignedIn = clerkSignedInRef.current;

    if (!bootstrappedRef.current) {
      clerkSignedInRef.current = isSignedIn;
      loadSessionUser({ initial: true, keepSignedIn: isSignedIn }).catch(() => {
        /* handled in loader */
      });
    } else if (isSignedIn && !wasSignedIn) {
      loadSessionUser({ keepSignedIn: true }).catch(() => {
        /* handled in loader */
      });
      clerkSignedInRef.current = true;
    } else if (!isSignedIn && wasSignedIn) {
      clearClerkTokenCache();
      setUser(null);
      setStatus('signedOut');
      clerkSignedInRef.current = false;
    } else {
      clerkSignedInRef.current = isSignedIn;
    }

    const unsubscribe = authEvents.onUnauthorized(() => {
      signOut().catch(() => {});
    });

    return () => {
      unsubscribe();
    };
  }, [isLoaded, isSignedIn, loadSessionUser, signOut]);

  useEffect(() => {
    return () => {
      if (autoRetryTimeoutRef.current) {
        clearTimeout(autoRetryTimeoutRef.current);
      }
    };
  }, []);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};

export { AuthContext };
