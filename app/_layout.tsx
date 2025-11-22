import '../global.css';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache';
import { Slot, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import React, { useEffect } from 'react';

export default function Layout() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    return (
      <SafeAreaProvider>
        <Text style={{ marginTop: 48, textAlign: 'center' }}>
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env
        </Text>
      </SafeAreaProvider>
    );
  }

  return (
    <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
      <SafeAreaProvider>
        <AuthGate />
      </SafeAreaProvider>
    </ClerkProvider>
  );
}

function AuthGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isSignedIn && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (isSignedIn && inAuthGroup) {
      router.replace('/');
    }
  }, [isLoaded, isSignedIn, segments, router]);

  if (!isLoaded) return null;
  return <Slot />;
}
