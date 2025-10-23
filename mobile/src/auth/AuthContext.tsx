import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef
} from 'react';
import { checkSession, logout as apiLogout } from '../api/auth';
import { authEvents } from './authEvents';
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
  const { isLoaded, isSignedIn, signOut: clerkSignOut } = useClerkAuth();

  const loadSessionUser = useCallback(async () => {
    setStatus('loading');
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
    }
  }, []);

  const signIn = useCallback(
    (nextUser?: any) => {
      if (nextUser) {
        setUser(nextUser ?? null);
        setStatus('signedIn');
        return;
      }
      loadSessionUser().catch(() => {
        // handled in loadSessionUser
      });
    },
    [loadSessionUser]
  );

  const signOut = useCallback(async () => {
    if (status === 'signedOut' || signOutInProgress.current) {
      return;
    }
    signOutInProgress.current = true;
    try {
      await apiLogout().catch((error) => {
        console.warn('Logout call failed', error);
      });
      await clerkSignOut().catch((error) => {
        console.warn('Clerk sign out failed', error);
      });
    } catch (error) {
      console.warn('Logout request error', error);
    } finally {
      setUser(null);
      setStatus('signedOut');
      signOutInProgress.current = false;
    }
  }, [status, clerkSignOut]);

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
    let mounted = true;

    if (!isLoaded) {
      return () => {
        mounted = false;
      };
    }

    if (!isSignedIn) {
      setUser(null);
      setStatus('signedOut');
      return () => {
        mounted = false;
      };
    }

    loadSessionUser().catch(() => {
      /* handled in loader */
    });

    const unsubscribe = authEvents.onUnauthorized(() => {
      signOut().catch(() => {});
    });

    return () => {
      mounted = false;
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
