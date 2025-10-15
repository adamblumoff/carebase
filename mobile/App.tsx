/**
 * Carebase Mobile App
 * Healthcare coordination: Show Up (appointments) + Pay (bills)
 */
import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import AppNavigator from './src/navigation/AppNavigator';
import { ThemeProvider, useTheme } from './src/theme';
import { View, ActivityIndicator, Text, StyleSheet, Linking as RNLinking } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ToastProvider, useToast } from './src/ui/ToastProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { acceptCollaboratorInvite } from './src/api/collaborators';
import { emitPlanChanged } from './src/utils/planEvents';

function SplashScreen() {
  const { colorScheme, palette } = useTheme();
  return (
    <View style={[styles.splashContainer, { backgroundColor: palette.background }]}> 
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={[styles.splashText, { color: palette.textSecondary }]}>Loading…</Text>
    </View>
  );
}

const PENDING_INVITE_TOKEN_KEY = 'carebase_pending_invite_token';

const extractTokenFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get('token');
    return value ? decodeURIComponent(value) : null;
  } catch {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
};

function AppContent() {
  const { colorScheme } = useTheme();
  const statusBarStyle = colorScheme === 'dark' ? 'light' : 'dark';
  const auth = useAuth();
  const toast = useToast();
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const processingInviteRef = useRef(false);

  const navigation = useMemo(() => {
    if (auth.status === 'loading') {
      return <SplashScreen />;
    }

    return <AppNavigator isSignedIn={auth.status === 'signedIn'} />;
  }, [auth.status]);

  const handleIncomingUrl = useCallback(
    async (incomingUrl: string | null) => {
      const token = extractTokenFromUrl(incomingUrl);
      if (!token) {
        return;
      }
      await AsyncStorage.setItem(PENDING_INVITE_TOKEN_KEY, token).catch(() => {});
      setPendingInviteToken(token);
    },
    []
  );

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

  useEffect(() => {
    AsyncStorage.getItem(PENDING_INVITE_TOKEN_KEY)
      .then((stored) => {
        if (stored) {
          setPendingInviteToken(stored);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (auth.status !== 'signedIn') {
      return;
    }

    let cancelled = false;

    const maybeAcceptInvite = async () => {
      const storedToken = pendingInviteToken || (await AsyncStorage.getItem(PENDING_INVITE_TOKEN_KEY));
      if (!storedToken || processingInviteRef.current) {
        return;
      }

      processingInviteRef.current = true;
      try {
        await acceptCollaboratorInvite(storedToken);
        if (cancelled) return;
        await AsyncStorage.removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
        setPendingInviteToken(null);
        toast.showToast('Invite accepted. Updating plan…');
        emitPlanChanged();
      } catch (error: any) {
        if (cancelled) return;
        const status = error?.response?.status;
        if (status === 404) {
          toast.showToast('Invite already used or expired.');
          await AsyncStorage.removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
          setPendingInviteToken(null);
        } else if (status === 401) {
          toast.showToast('Sign in with the invited email to finish accepting.');
        } else {
          toast.showToast('Unable to accept invite right now. Try again later.');
        }
      } finally {
        processingInviteRef.current = false;
      }
    };

    maybeAcceptInvite();

    return () => {
      cancelled = true;
    };
  }, [auth.status, pendingInviteToken, toast]);

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
