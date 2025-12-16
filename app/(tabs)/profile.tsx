import React from 'react';
import { View, Text, Switch } from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Container } from '@/components/Container';
import { Button } from '@/components/Button';
import { SignOutButton } from '@/components/SignOutButton';
import { useUserTheme } from '@/app/(hooks)/useUserTheme';

export default function ProfileScreen() {
  const { systemColorScheme, isDark, setUserTheme, resetTheme, isUpdating } = useUserTheme();
  const router = useRouter();

  const toggleTheme = (value: boolean) => {
    setUserTheme(value ? 'dark' : 'light');
  };

  const resetToSystem = () => {
    resetTheme();
  };

  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Profile' }} />
      <Container>
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
            <Switch value={isDark} onValueChange={toggleTheme} disabled={isUpdating} />
          </View>
          <Text className="text-sm font-semibold text-accent underline" onPress={resetToSystem}>
            Reset to system theme ({systemColorScheme ?? 'light'})
          </Text>
        </View>

        <View className="mt-6 w-full">
          <Button
            title="Suppressed senders"
            onPress={() => router.push('/(tabs)/suppressed-senders')}
          />
        </View>

        <View className="mt-4 w-full">
          <SignOutButton />
        </View>
      </Container>
    </View>
  );
}
