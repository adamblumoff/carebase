import React from 'react';
import { View, Text, Switch } from 'react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { Container } from '@/components/Container';
import { ScreenContent } from '@/components/ScreenContent';
import { SignOutButton } from '@/components/SignOutButton';

export default function ProfileScreen() {
  const { colorScheme, setColorScheme, systemColorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  const toggleTheme = (value: boolean) => {
    setColorScheme(value ? 'dark' : 'light');
  };

  const resetToSystem = () => {
    if (systemColorScheme) setColorScheme(systemColorScheme);
  };

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Profile' }} />
      <Container>
        <ScreenContent path="app/(tabs)/profile.tsx" title="Profile & Preferences">
          <Text className="text-base text-text dark:text-text-dark">
            Control how the app looks and sign out.
          </Text>
        </ScreenContent>

        <View className="mt-4 w-full gap-4 rounded-xl border border-border bg-white p-4 dark:border-border-dark dark:bg-surface-card-dark">
          <View className="flex-row items-center justify-between">
            <View className="gap-1">
              <Text className="text-base font-semibold text-text dark:text-text-dark">
                Dark mode
              </Text>
              <Text className="text-sm text-text-muted dark:text-text-muted-dark">
                Follow system by default; override anytime.
              </Text>
            </View>
            <Switch value={isDark} onValueChange={toggleTheme} />
          </View>
          <Text className="text-sm font-semibold text-accent underline" onPress={resetToSystem}>
            Reset to system theme ({systemColorScheme ?? 'auto'})
          </Text>
        </View>

        <View className="mt-6 w-full">
          <SignOutButton />
        </View>
      </Container>
    </View>
  );
}
