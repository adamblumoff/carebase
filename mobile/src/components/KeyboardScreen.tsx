import React, { PropsWithChildren } from 'react';
import {
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  ViewStyle,
  ScrollViewProps,
} from 'react-native';

interface KeyboardScreenProps extends PropsWithChildren {
  containerStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: ScrollViewProps;
  keyboardVerticalOffset?: number;
}

export function KeyboardScreen({
  children,
  containerStyle,
  contentContainerStyle,
  scrollProps,
  keyboardVerticalOffset = Platform.OS === 'ios' ? 24 : 0,
}: KeyboardScreenProps): JSX.Element {
  return (
    <SafeAreaView style={[{ flex: 1 }, containerStyle]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={contentContainerStyle}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
