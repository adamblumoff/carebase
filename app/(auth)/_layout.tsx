import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@clerk/clerk-expo';
import { useColorScheme } from 'nativewind';

export default function AuthRoutesLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { colorScheme } = useColorScheme();
  const backgroundColor = colorScheme === 'dark' ? '#1C2521' : '#F5F7F6';

  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor },
      }}
    />
  );
}
