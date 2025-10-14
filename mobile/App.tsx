/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from './src/api/client';
import { API_ENDPOINTS } from './src/config';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user?: any };

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
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        if (!token) {
          if (mounted) {
            setAuthState({ status: 'signedOut' });
          }
          return;
        }

        try {
          const response = await apiClient.get(API_ENDPOINTS.checkSession);
          if (response.data?.authenticated) {
            if (mounted) {
              setAuthState({ status: 'signedIn', user: response.data.user });
            }
            return;
          }
        } catch (error) {
          console.warn('Session check failed, clearing token', error);
        }

        await AsyncStorage.removeItem('accessToken');
        if (mounted) {
          setAuthState({ status: 'signedOut' });
        }
      } catch (error) {
        console.error('Auth bootstrap error', error);
        if (mounted) {
          setAuthState({ status: 'signedOut' });
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const navigation = useMemo(() => {
    if (authState.status === 'loading') {
      return <SplashScreen />;
    }

    return <AppNavigator isSignedIn={authState.status === 'signedIn'} />;
  }, [authState]);

  return (
    <>
      {navigation}
      <StatusBar style={statusBarStyle} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
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
