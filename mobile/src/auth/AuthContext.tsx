import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { checkSession, logout as apiLogout } from '../api/auth';
import { authEvents } from './authEvents';
import { getAccessToken, removeAccessToken } from './tokenStorage';

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

const signIn = useCallback((nextUser?: any) => {
  setUser(nextUser ?? null);
  setStatus('signedIn');
}, []);

  const signOut = useCallback(async () => {
    if (status === 'signedOut' || signOutInProgress.current) {
      return;
    }
    signOutInProgress.current = true;
    try {
      await apiLogout().catch((error) => {
        console.warn('Logout call failed', error);
      });
    } catch (error) {
      console.warn('Logout request error', error);
    } finally {
      await removeAccessToken().catch(() => {});
      setUser(null);
      setStatus('signedOut');
      signOutInProgress.current = false;
    }
  }, [status]);

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

    const bootstrap = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (mounted) {
            setStatus('signedOut');
          }
          return;
        }

        try {
          const response = await checkSession();
          if (response.authenticated && mounted) {
            setUser(response.user ?? null);
            setStatus('signedIn');
            return;
          }
        } catch (error) {
          console.warn('Session check failed, clearing token', error);
        }

        await removeAccessToken().catch(() => {});
        if (mounted) {
          setUser(null);
          setStatus('signedOut');
        }
      } catch (error) {
        console.error('Auth bootstrap error', error);
        if (mounted) {
          setUser(null);
          setStatus('signedOut');
        }
      }
    };

    bootstrap();

    const unsubscribe = authEvents.onUnauthorized(() => {
      signOut().catch(() => {});
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [signOut]);

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
