/**
 * Login Screen
 * Google OAuth Sign In using WebBrowser and Passport backend
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import * as WebBrowser from 'expo-web-browser';
import apiClient from '../api/client';
import { API_ENDPOINTS, API_BASE_URL } from '../config';

// Required for web browser to close properly after auth
WebBrowser.maybeCompleteAuthSession();

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      // Open OAuth flow in browser - uses Passport's built-in OAuth handling
      // Backend will handle the OAuth dance and create a session
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_BASE_URL}/auth/google?mobile=true`,
        'carebase://'
      );

      console.log('WebBrowser result:', result);

      if (result.type === 'success') {
        // Check if we're now authenticated by checking session
        const sessionCheck = await apiClient.get(API_ENDPOINTS.checkSession);

        if (sessionCheck.data.authenticated) {
          navigation.replace('Plan');
        } else {
          Alert.alert('Error', 'Authentication succeeded but session was not created');
          setLoading(false);
        }
      } else if (result.type === 'cancel') {
        setLoading(false);
      } else {
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
