/**
 * Login Screen
 * Minimal green-forward sign-in experience
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/ToastProvider';

WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const [loading, setLoading] = useState(false);
  const auth = useAuth();
  const toast = useToast();

  const authenticate = async () => {
    setLoading(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_BASE_URL}/auth/google?mobile=true`,
        'carebase://'
      );

      if (result.type !== 'success') {
        setLoading(false);
        return;
      }

      const params = new URLSearchParams(result.url.split('?')[1] ?? '');
      const rawToken = params.get('loginToken');
      const loginToken = rawToken ? rawToken.replace(/#.*/, '') : null;

      if (!loginToken) {
        Alert.alert('Error', 'Authentication failed. Please try again.');
        setLoading(false);
        return;
      }

      const exchangeResponse = await apiClient.post(API_ENDPOINTS.mobileLogin, { authToken: loginToken });
      const { accessToken } = exchangeResponse.data;
      if (!accessToken) {
        throw new Error('Access token missing from response');
      }

      await AsyncStorage.setItem('accessToken', accessToken);
      await AsyncStorage.removeItem('sessionCookie');

      const sessionCheck = await apiClient.get(API_ENDPOINTS.checkSession);
      if (sessionCheck.data.authenticated) {
        auth.signIn(sessionCheck.data.user);
        toast.showToast('Signed in');
      } else {
        throw new Error('Session not established');
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      Alert.alert('Error', error.message || 'Failed to sign in');
      toast.showToast('Failed to sign in');
      await AsyncStorage.removeItem('accessToken');
    } finally {
      setLoading(false);
    }
  };

  const handleContinueWithoutAuth = () => {
    AsyncStorage.removeItem('accessToken').catch(() => {});
    auth.signIn();
    toast.showToast('Signed in (dev bypass)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={styles.container}>
        <View style={styles.brandBlock}>
          <Text style={styles.brandName}>Carebase</Text>
          <Text style={styles.brandTagline}>All your care tasks, organized for the week ahead.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardText}>
            Use your Google account to sync appointments and bills securely.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={authenticate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Google</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.noteText}>
            You’ll be redirected to Google and back. We never store your password.
          </Text>

          {__DEV__ && (
            <TouchableOpacity style={styles.devButton} onPress={handleContinueWithoutAuth}>
              <Text style={styles.devButtonText}>Skip sign in (dev only)</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: palette.background,
    },
    container: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing(3),
      paddingVertical: spacing(6),
    },
    brandBlock: {
      marginBottom: spacing(4),
    },
    brandName: {
      fontSize: 36,
      fontWeight: '700',
      color: palette.primary,
    },
    brandTagline: {
      marginTop: spacing(1),
      fontSize: 16,
      lineHeight: 22,
      color: palette.textSecondary,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radius.md,
      padding: spacing(3),
      ...shadow.card,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: palette.textPrimary,
    },
    cardText: {
      marginTop: spacing(1),
      fontSize: 14,
      color: palette.textSecondary,
      lineHeight: 20,
    },
    primaryButton: {
      marginTop: spacing(3),
      backgroundColor: palette.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.75),
      alignItems: 'center',
    },
    primaryButtonDisabled: {
      opacity: 0.7,
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    noteText: {
      marginTop: spacing(1.5),
      fontSize: 12,
      color: palette.textMuted,
      lineHeight: 18,
    },
    devButton: {
      marginTop: spacing(3),
      paddingVertical: spacing(1.25),
      alignItems: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.textMuted,
    },
    devButtonText: {
      color: palette.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
