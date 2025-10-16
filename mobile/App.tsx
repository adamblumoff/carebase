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

  const navigation = useMemo(() => {
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
      {navigation}
      <StatusBar style={statusBarStyle} />
    </>
  );
}

function AppBootstrap() {
  return (
    <AuthProvider>
      <PlanProvider>
        <CollaboratorProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </CollaboratorProvider>
      </PlanProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppBootstrap />
    </ThemeProvider>
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
