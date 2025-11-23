import React from 'react';
import { ActivityIndicator, Image, Pressable, PressableProps, Text, View } from 'react-native';

type GoogleButtonProps = {
  title?: string;
  loading?: boolean;
} & PressableProps;

export function GoogleButton({
  title = 'Sign in with Google',
  loading = false,
  disabled,
  ...rest
}: GoogleButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      className="w-full"
      {...rest}
      style={({ pressed }) => ({
        opacity: isDisabled ? 0.55 : pressed ? 0.86 : 1,
      })}>
      <View className="h-12 flex-row items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-4">
        <Image
          source={require('../assets/google-g-logo.png')}
          style={{ width: 18, height: 18 }}
          resizeMode="contain"
        />
        {loading ? (
          <ActivityIndicator color="#1F1F1F" />
        ) : (
          <Text style={{ fontFamily: 'Roboto_500Medium' }} className="text-[14px] text-[#1F1F1F]">
            {title}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
