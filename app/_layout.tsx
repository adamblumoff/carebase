
import '../global.css';
import { Stack } from "expo-router";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React from 'react';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <Stack />
    </SafeAreaProvider>
  );
}
