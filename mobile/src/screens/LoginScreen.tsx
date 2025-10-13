/**
 * Login Screen
 * Google OAuth Sign In using WebBrowser and Passport backend
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import { palette, spacing, radius, shadow } from '../theme';

// Required for web browser to close properly after auth
WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // Open OAuth flow in browser - backend completes Google OAuth and issues a mobile token
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_BASE_URL}/auth/google?mobile=true`,
        'carebase://'
      );

      console.log('WebBrowser result:', result);

      if (result.type === 'success') {
        // Extract login token from the redirect URL
        const url = result.url;
        console.log('Success URL:', url);

        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const rawToken = params.get('loginToken');
        const loginToken = rawToken ? rawToken.replace(/#.*/, '') : null;

        if (!loginToken) {
          console.error('Missing login token in redirect URL');
          Alert.alert('Error', 'Authentication failed: missing login token.');
          setLoading(false);
          return;
        }

        console.log('Received login token, exchanging for access token...');
        try {
          const exchangeResponse = await apiClient.post(API_ENDPOINTS.mobileLogin, { authToken: loginToken });
          const { accessToken } = exchangeResponse.data;

          if (!accessToken) {
            throw new Error('Access token not provided');
          }

          await AsyncStorage.setItem('accessToken', accessToken);
          await AsyncStorage.removeItem('sessionCookie');
          console.log('Access token stored successfully');
        } catch (exchangeError: any) {
          console.error('Failed to exchange login token:', exchangeError?.response?.data || exchangeError);
          Alert.alert('Error', 'Authentication failed during session exchange.');
          setLoading(false);
          return;
        }

        // Check if we're now authenticated by checking session
        console.log('Checking session...');
        try {
          const sessionCheck = await apiClient.get(API_ENDPOINTS.checkSession);
          console.log('Session check response:', sessionCheck.data);

          if (sessionCheck.data.authenticated) {
            console.log('Session authenticated! Navigating to Plan...');
            navigation.replace('Plan');
          } else {
            console.error('Session not authenticated');
            Alert.alert('Error', 'Authentication succeeded but session was not created.');
            setLoading(false);
          }
        } catch (checkError: any) {
          console.error('Session check error:', checkError);
          Alert.alert('Error', 'Failed to verify authentication status.');
          try {
            await AsyncStorage.removeItem('accessToken');
          } catch {
            // ignore cleanup errors
          }
          setLoading(false);
          return;
        }
      } else if (result.type === 'cancel') {
        console.log('User cancelled OAuth');
        setLoading(false);
      } else {
        console.error('OAuth failed:', result);
        Alert.alert('Error', 'Authentication failed');
        setLoading(false);
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      Alert.alert('Error', error.message || 'Failed to sign in');
      setLoading(false);
    }
  };

  const handleContinueWithoutAuth = () => {
    // For development/testing only
    AsyncStorage.removeItem('accessToken').catch(() => {
      // ignore cleanup errors
    });
    navigation.replace('Plan');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>Carebase</Text>
          <Text style={styles.headline}>Your care command center</Text>
          <Text style={styles.subheadline}>
            Track appointments, bills, and prep notes in one guided weekly view.
          </Text>

          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Show up on time</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Never miss a payment</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Share with family</Text>
            </View>
          </View>
        </View>

        <View style={[styles.card, shadow.card]}>
          <Text style={styles.cardTitle}>Sign in with your Google account</Text>
          <Text style={styles.cardSubtitle}>
            We’ll securely connect to your Carebase backend and keep your plan synced across devices.
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Google</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.helperText}>
            You’ll be returned to the app after approving Google sign-in.
          </Text>

          {__DEV__ && (
            <TouchableOpacity style={styles.secondaryButton} onPress={handleContinueWithoutAuth}>
              <Text style={styles.secondaryButtonText}>Continue without signing in (dev)</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>How it works</Text>
          <Text style={styles.footerText}>
            • Forward healthcare emails to your Carebase inbox{'\n'}
            • We extract visits and bills into a weekly checklist{'\n'}
            • Share the plan so everyone shows up prepared
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: palette.surfaceMuted,
  },
  scrollContent: {
    paddingBottom: spacing(6),
  },
  hero: {
    backgroundColor: palette.canvas,
    paddingHorizontal: spacing(3),
    paddingTop: spacing(6),
    paddingBottom: spacing(5),
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  brand: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headline: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
    marginTop: spacing(1),
  },
  subheadline: {
    color: '#e2e8f0',
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing(1.5),
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1),
    marginTop: spacing(3),
  },
  badge: {
    backgroundColor: 'rgba(148, 163, 184, 0.18)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
  },
  badgeText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    marginHorizontal: spacing(3),
    marginTop: -spacing(3),
    padding: spacing(3),
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: palette.textPrimary,
  },
  cardSubtitle: {
    fontSize: 14,
    color: palette.textSecondary,
    lineHeight: 20,
    marginTop: spacing(1.5),
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
  helperText: {
    marginTop: spacing(1.5),
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  secondaryButton: {
    marginTop: spacing(2.5),
    paddingVertical: spacing(1.5),
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.textMuted,
  },
  secondaryButtonText: {
    color: palette.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    marginTop: spacing(4),
    paddingHorizontal: spacing(3),
    paddingBottom: spacing(5),
  },
  footerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: spacing(1),
  },
  footerText: {
    fontSize: 13,
    lineHeight: 20,
    color: palette.textSecondary,
  },
});
