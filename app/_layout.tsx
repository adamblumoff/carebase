
import '../global.css';
import { Stack } from "expo-router";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React from 'react';
import { ClerkProvider } from '@clerk/clerk-expo';
import { tokenCache } from '@clerk/clerk-expo/token-cache'

export default function Layout() {
  return (
    <ClerkProvider tokenCache={tokenCache}>
      <SafeAreaProvider>
        <Stack />
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
