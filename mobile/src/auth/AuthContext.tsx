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

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: any | null;
  signIn: (user?: any) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'signedIn'>('loading');
  const [user, setUser] = useState<any | null>(null);
  const signOutInProgress = useRef(false);
  const statusRef = useRef<'loading' | 'signedOut' | 'signedIn'>(status);
  const bootstrappedRef = useRef(false);
  const sessionRequestRef = useRef<Promise<void> | null>(null);
  const clerkSignedInRef = useRef<boolean | null>(null);
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

    if (initial) {
      setStatus('loading');
    } else if (!keepSignedIn) {
      setStatus('loading');
    }

    const request = (async () => {
      try {
        const session = await checkSession();
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
        setStatus('signedOut');
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
    } catch (error) {
      console.warn('Logout request error', error);
    } finally {
      signOutInProgress.current = false;
    }
  }, [clerkSignOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signIn,
      signOut,
    }),
    [status, user, signIn, signOut]
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
