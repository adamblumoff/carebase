import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { API_ENDPOINTS } from '../config';

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: any | null;
  setUser: (user: any | null) => void;
  setStatus: (status: 'loading' | 'signedOut' | 'signedIn') => void;
  signIn: (user?: any) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  initialStatus?: 'loading' | 'signedOut' | 'signedIn';
  initialUser?: any;
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  initialStatus = 'loading',
  initialUser = null,
  children,
}) => {
  const [status, setStatus] = useState<'loading' | 'signedOut' | 'signedIn'>(initialStatus);
  const [user, setUser] = useState<any | null>(initialUser);

  const signIn = useCallback((nextUser?: any) => {
    setUser(nextUser ?? null);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiClient.post(API_ENDPOINTS.logout).catch((error) => {
        console.warn('Logout call failed', error);
      });
    } catch (error) {
      console.warn('Logout request error', error);
    } finally {
      await AsyncStorage.removeItem('accessToken').catch(() => {});
      setUser(null);
      setStatus('signedOut');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      setStatus,
      setUser,
      signIn,
      signOut,
    }),
    [status, user, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
