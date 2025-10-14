/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import React, { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ToastProvider } from './src/ui/ToastProvider';

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

  const navigation = useMemo(() => {
    if (auth.status === 'loading') {
      return <SplashScreen />;
    }

    return <AppNavigator isSignedIn={auth.status === 'signedIn'} />;
  }, [auth.status]);

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
      <ToastProvider>
        <AppContent />
      </ToastProvider>
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
