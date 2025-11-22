import { Stack, Link } from 'expo-router';
import { View, Text } from 'react-native';

import { Button } from '@/components/Button';
import { Container } from '@/components/Container';
import { ScreenContent } from '@/components/ScreenContent';
import { SignOutButton } from '@/components/SignOutButton';

export default function Home() {
  return (
    <View className="flex flex-1 bg-white">
      <Stack.Screen options={{ title: 'Home' }} />
      <Container>
        <ScreenContent path="app/index.tsx" title="Home">
          <Text className="mb-4 text-base text-gray-700">You are signed in.</Text>
          <SignOutButton />
        </ScreenContent>
        <Link href="/tasks" asChild>
          <Button title="View Tasks" className="mb-3" />
        </Link>
        <Link href={{ pathname: '/details', params: { name: 'Dan' } }} asChild>
          <Button title="Show Details" />
        </Link>
      </Container>
    </View>
  );
}
