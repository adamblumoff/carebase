import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOAuth } from '@clerk/clerk-expo';
import * as AuthSession from 'expo-auth-session';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { ErrorBanner } from '@/components/auth/ErrorBanner';
import { GoogleButton } from '@/components/GoogleButton';

export default function SignInScreen() {
  const router = useRouter();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectUrl = AuthSession.makeRedirectUri({
    scheme: 'carebase',
    // For Expo Go/device; set preferLocalhost true if using a local dev client build
    preferLocalhost: false,
  });

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const { createdSessionId, setActive, signIn, signUp } = await startOAuthFlow({ redirectUrl });

      const sessionId = createdSessionId ?? signIn?.createdSessionId ?? signUp?.createdSessionId;

      if (sessionId && setActive) {
        await setActive({ session: sessionId });
        router.replace('/');
        return;
      }

      setError('Could not complete Google sign-in. Please try again.');
    } catch (err: any) {
      const message =
        err?.errors?.[0]?.message ?? err?.message ?? 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-2xl font-semibold text-text dark:text-text-dark">Welcome back</Text>
          <Text className="text-base text-text-muted dark:text-text-muted-dark">
            Sign in with Google to continue.
          </Text>
        </View>

        <ErrorBanner message={error} />

        <GoogleButton title="Continue with Google" onPress={handleGoogleSignIn} loading={loading} />
      </View>
    </AuthLayout>
  );
}
