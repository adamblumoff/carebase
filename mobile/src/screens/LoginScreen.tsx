/**
 * Login Screen
 * Google OAuth Sign In
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert, Linking } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import apiClient from '../api/client';
import { API_ENDPOINTS, API_BASE_URL } from '../config';
import { GOOGLE_CLIENT_ID } from '../config';

// Required for web browser to close properly after auth
WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);

  // Configure Google Auth with backend callback
  const redirectUri = `${API_BASE_URL}/api/auth/google/mobile/callback`;
  console.log('Redirect URI:', redirectUri);
  console.log('Google Client IDs:', GOOGLE_CLIENT_ID);

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_CLIENT_ID.web,
    iosClientId: GOOGLE_CLIENT_ID.ios,
    androidClientId: GOOGLE_CLIENT_ID.android,
    redirectUri: redirectUri,
  });
  console.log('OAuth request created:', request?.url);

  // Handle deep link from backend OAuth callback
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      console.log('Deep link received:', event.url);

      // Parse the deep link URL: carebase://redirect?id_token=...
      const url = event.url;
      if (url.startsWith('carebase://redirect')) {
        const params = new URLSearchParams(url.split('?')[1]);
        const idToken = params.get('id_token');

        if (idToken) {
          handleGoogleSignIn(idToken);
        } else {
          Alert.alert('Error', 'No ID token received from authentication');
          setLoading(false);
        }
      }
    };

    // Listen for deep links
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Check if app was opened with a deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Handle auth response (fallback for direct OAuth flow)
  useEffect(() => {
    if (response?.type === 'success') {
      // Backend redirects back with id_token in params
      const idToken = response.params.id_token;
      if (idToken) {
        handleGoogleSignIn(idToken);
      } else {
        Alert.alert('Error', 'No ID token received');
        setLoading(false);
      }
    } else if (response?.type === 'error') {
      console.error('OAuth error:', response.error);
      Alert.alert('Error', 'Failed to sign in with Google');
      setLoading(false);
    } else if (response?.type === 'cancel') {
      setLoading(false);
    }
  }, [response]);

  const handleGoogleSignIn = async (idToken: string) => {
    setLoading(true);
    try {
      // Exchange Google token for our session
      const result = await apiClient.post(API_ENDPOINTS.exchangeGoogleToken || '/api/auth/google', {
        idToken
      });

      if (result.data.success) {
        // Navigate to main app
        navigation.replace('Plan');
      } else {
        Alert.alert('Error', 'Failed to create session');
      }
    } catch (error: any) {
      console.error('Sign in error:', error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    setLoading(true);
    promptAsync();
  };

  const handleContinueWithoutAuth = () => {
    // For development/testing only
    navigation.replace('Plan');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>Carebase</Text>
        <Text style={styles.tagline}>Healthcare coordination made simple</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome!</Text>
          <Text style={styles.subtitle}>
            Get your weekly plan: Show Up (appointments) and Pay (bills).
          </Text>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={!request || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in with Google</Text>
            )}
          </TouchableOpacity>

          {__DEV__ && (
            <TouchableOpacity style={styles.linkButton} onPress={handleContinueWithoutAuth}>
              <Text style={styles.linkText}>Continue without signing in (Dev)</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          Forward emails to your unique address and we'll automatically organize them.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#2563eb',
    textAlign: 'center',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 48,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    marginTop: 32,
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
});
