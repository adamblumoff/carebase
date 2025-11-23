import { Stack } from 'expo-router';
import { View } from 'react-native';

export default function Home() {
  return (
    <View className="flex flex-1 bg-surface px-4 dark:bg-surface-dark">
      <Stack.Screen options={{ title: 'Home' }} />
    </View>
  );
}
