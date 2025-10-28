import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '../theme';

export const DEFAULT_RETRY_MESSAGE = "We couldn't refresh your session. Please try again.";

export type RetrySplashProps = {
  message?: string | null;
  pending: boolean;
  onRetry: () => void;
  onSignOut: () => void;
};

export function RetrySplash({ message, pending, onRetry, onSignOut }: RetrySplashProps) {
  const { palette } = useTheme();
  const displayMessage = message && message.trim().length > 0 ? message : DEFAULT_RETRY_MESSAGE;
  const statusCopy = pending ? "Hang tight—we're reconnecting." : displayMessage;

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}> 
      {pending ? <ActivityIndicator size="large" color={palette.primary} /> : <View style={styles.spacer} />}
      <Text style={[styles.message, { color: palette.textSecondary }]}>{statusCopy}</Text>
      <TouchableOpacity
        style={[
          styles.primaryButton,
          {
            backgroundColor: palette.primary,
            opacity: pending ? 0.6 : 1
          }
        ]}
        disabled={pending}
        onPress={onRetry}
      >
        <Text style={styles.primaryButtonText}>{pending ? 'Retrying…' : 'Try again'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onSignOut}>
        <Text style={[styles.secondaryButtonText, { color: palette.textSecondary }]}>Sign out instead</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  spacer: {
    height: 48
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    marginHorizontal: 32
  },
  primaryButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  secondaryButton: {
    marginTop: 16,
    paddingVertical: 8
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600'
  }
});

