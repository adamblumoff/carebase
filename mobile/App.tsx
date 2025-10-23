/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import React, { useMemo, useEffect, useCallback } from 'react';
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
import { clerkTokenCache, setClerkTokenFetcher } from './src/auth/clerkTokenCache';

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
  const { handleIncomingUrl } = usePendingInviteAcceptance();

  const navigator = useMemo(() => {
    if (auth.status === 'loading') {
      return <SplashScreen />;
    }
    return <AppNavigator isSignedIn={auth.status === 'signedIn'} />;
  }, [auth.status]);

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

  return (
    <>
      {auth.status === 'signedIn' ? <PlanProvider>{navigator}</PlanProvider> : navigator}
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

function ClerkTokenBridge(): null {
  const { getToken, isSignedIn } = useClerkAuth();

  useEffect(() => {
    setClerkTokenFetcher(() => {
      if (!isSignedIn) {
        return Promise.resolve(null);
      }
      const options = CLERK_JWT_TEMPLATE ? { template: CLERK_JWT_TEMPLATE } : undefined;
      return getToken(options).catch(() => null);
    });

    return () => {
      setClerkTokenFetcher(null);
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
