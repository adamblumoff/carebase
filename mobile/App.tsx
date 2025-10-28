/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import React, { useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme';
import { View, ActivityIndicator, Text, StyleSheet, Linking as RNLinking } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ToastProvider } from './src/ui/ToastProvider';
import { CollaboratorProvider } from './src/collaborators/CollaboratorProvider';
import { PlanProvider } from './src/plan/PlanProvider';
import { usePendingInviteAcceptance } from './src/hooks/usePendingInviteAcceptance';
import { ClerkProvider, ClerkLoaded, useAuth as useClerkAuth } from '@clerk/clerk-expo';
import {
  CLERK_PUBLISHABLE_KEY,
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
  CLERK_JWT_TEMPLATE
} from './src/config';
import {
  clerkTokenCache,
  setClerkTokenFetcher,
  fetchClerkSessionToken,
  clearClerkTokenCache
} from './src/auth/clerkTokenCache';

import { DEFAULT_RETRY_MESSAGE, RetrySplash } from './src/ui/RetrySplash';

function SplashScreen() {
  const { colorScheme, palette } = useTheme();
  return (
    <View style={[styles.splashContainer, { backgroundColor: palette.background }]}> 
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={[styles.splashText, { color: palette.textSecondary }]}>Loading…</Text>
    </View>
  );
}

function AppContent() {
  const { colorScheme } = useTheme();
  const statusBarStyle = colorScheme === 'dark' ? 'light' : 'dark';
  const auth = useAuth();
  const { status, lastError, pendingRetry, retrySession, signOut } = auth;
  const { handleIncomingUrl } = usePendingInviteAcceptance();

  const handleRetryPress = useCallback(() => {
    void retrySession();
  }, [retrySession]);

  const handleSignOutPress = useCallback(() => {
    void signOut();
  }, [signOut]);

  useEffect(() => {
    RNLinking.getInitialURL()
      .then((initialUrl) => {
        if (initialUrl) {
          handleIncomingUrl(initialUrl);
        }
      })
      .catch(() => {});

    const subscription = RNLinking.addEventListener('url', ({ url }) => {
      handleIncomingUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleIncomingUrl]);

  let content: React.ReactNode;
  if (status === 'loading') {
    content = <SplashScreen />;
  } else if (status === 'error') {
    content = (
      <RetrySplash
        message={lastError ?? DEFAULT_RETRY_MESSAGE}
        pending={pendingRetry}
        onRetry={handleRetryPress}
        onSignOut={handleSignOutPress}
      />
    );
  } else {
    const navigator = <AppNavigator isSignedIn={status === 'signedIn'} />;
    content = status === 'signedIn' ? <PlanProvider>{navigator}</PlanProvider> : navigator;
  }

  return (
    <>
      {content}
      <StatusBar style={statusBarStyle} />
    </>
  );
}

function AppBootstrap() {
  return (
    <AuthProvider>
      <CollaboratorProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </CollaboratorProvider>
    </AuthProvider>
  );
}

const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 1000;
const DEFAULT_CLERK_TEMPLATE = 'carebase-backend';

function ClerkTokenBridge(): null {
  const { getToken, isSignedIn } = useClerkAuth();

  useEffect(() => {
    if (!isSignedIn) {
      setClerkTokenFetcher(null);
      clearClerkTokenCache();
      return () => {};
    }

    const templateId = CLERK_JWT_TEMPLATE ?? DEFAULT_CLERK_TEMPLATE;
    setClerkTokenFetcher(() => getToken({ template: templateId }).catch(() => null));

    const prime = async () => {
      await fetchClerkSessionToken();
    };
    prime().catch(() => {});

    const interval = setInterval(() => {
      fetchClerkSessionToken().catch(() => {});
    }, TOKEN_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setClerkTokenFetcher(null);
      if (!isSignedIn) {
        clearClerkTokenCache();
      }
    };
  }, [getToken, isSignedIn]);

  return null;
}

export default function App() {
  if (!CLERK_PUBLISHABLE_KEY && __DEV__) {
    console.warn(
      '[Clerk] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. Authentication will not function.'
    );
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl={CLERK_SIGN_IN_URL}
      signUpUrl={CLERK_SIGN_UP_URL}
      tokenCache={clerkTokenCache}
    >
      <ThemeProvider>
        <ClerkLoaded>
          <ClerkTokenBridge />
          <AppBootstrap />
        </ClerkLoaded>
      </ThemeProvider>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  splashText: {
    fontSize: 14,
  },
});
