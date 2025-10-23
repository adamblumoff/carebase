/**
 * Login Screen – Clerk-native flows for Expo
 *
 * Supports:
 * - Email + Password
 * - Email Magic Link (code entry)
 * - Google / Facebook / Apple OAuth
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useAuth as useClerkAuth,
  useSignIn,
  useSignUp,
  useOAuth
} from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useAuth } from '../auth/AuthContext';

WebBrowser.maybeCompleteAuthSession();

type SetActiveFn = (params: { session: string }) => Promise<void> | void;

type MagicLinkState = {
  pending: boolean;
  error: string | null;
  code: string;
};

export default function LoginScreen() {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const auth = useAuth();
  const clerkAuth = useClerkAuth();
  const { signIn, isLoaded: isSignInLoaded, setActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();

  const googleOAuth = useOAuth({ strategy: 'oauth_google' });
  const facebookOAuth = useOAuth({ strategy: 'oauth_facebook' });
  const appleOAuth = useOAuth({ strategy: 'oauth_apple' });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicLink, setMagicLink] = useState<MagicLinkState>({
    pending: false,
    error: null,
    code: ''
  });
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishSignIn = async (
    createdSessionId?: string | null,
    activeSetter?: SetActiveFn | null
  ) => {
    if (!createdSessionId) {
      return;
    }
    const setter = activeSetter ?? setActive ?? clerkAuth.setActive;
    await setter?.({ session: createdSessionId });
    await auth.signIn();
  };

  const handlePasswordSignIn = async () => {
    if (!isSignInLoaded) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const attempt = await signIn.create({
        identifier: email.trim(),
        password
      });

      if (attempt.status === 'complete') {
        await finishSignIn(attempt.createdSessionId);
        setInfo('Welcome back!');
      } else if (attempt.status === 'needs_first_factor') {
        setError('Additional verification required. Please check your email or configured factor.');
      } else {
        setError('Unable to sign in. Please try again.');
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage ?? 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestMagicLink = async () => {
    if (!isSignInLoaded) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const attempt = await signIn.create({
        identifier: email.trim(),
        strategy: 'email_link'
      });

      if (attempt.status === 'complete') {
        await finishSignIn(attempt.createdSessionId);
        setInfo('You are signed in.');
        return;
      }

      if (attempt.status === 'needs_first_factor') {
        setMagicLink({
          pending: true,
          error: null,
          code: ''
        });
        setInfo('Magic link sent! Open the email or enter the verification code below.');
      } else {
        setError('Unable to send magic link. Please try again.');
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.longMessage ?? 'Unable to send magic link.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMagicLinkCode = async () => {
    if (!isSignInLoaded) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'email_link',
        code: magicLink.code.trim()
      });

      if (attempt.status === 'complete') {
        await finishSignIn(attempt.createdSessionId);
        setInfo('Signed in successfully.');
        setMagicLink({ pending: false, error: null, code: '' });
      } else {
        setMagicLink((prev) => ({
          ...prev,
          error: 'Verification code is invalid or expired.'
        }));
      }
    } catch (err: any) {
      setMagicLink((prev) => ({
        ...prev,
        error: err?.errors?.[0]?.longMessage ?? 'Unable to verify the code.'
      }));
    } finally {
      setLoading(false);
    }
  };

  const autoCompleteSignUp = async (
    resource: typeof signUp | null | undefined,
    emailAddress: string | null | undefined
  ) => {
    if (!resource) {
      return null;
    }

    try {
      const missing = resource.missingFields ?? [];
      const updatePayload: Record<string, unknown> = {};

      if (missing.includes('username')) {
        const base = (resource.username ?? emailAddress ?? 'carebasesignup').split('@')[0];
        const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'carebaseuser';
        updatePayload.username = sanitized;
      }

      if (missing.includes('password')) {
        updatePayload.password = Array.from({ length: 24 }, () =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'[Math.floor(Math.random() * 70)]
        ).join('');
      }

      if (Object.keys(updatePayload).length > 0) {
        await resource.update(updatePayload);
      }

      const completion = await resource.create({ transfer: true });
      return completion?.createdSessionId ?? resource.createdSessionId ?? null;
    } catch (err) {
      console.error('[Auth] Failed to auto-complete Clerk sign-up', err);
      return null;
    }
  };

  const handleOAuth = async (flow: ReturnType<typeof useOAuth>, provider: string) => {
    if (!clerkAuth.isLoaded) {
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      console.log(`[Auth] Starting ${provider} OAuth flow`);
      const result = await flow.startOAuthFlow();
      console.log('[Auth] OAuth flow result', result);
      if (result?.signIn?.firstFactorVerification?.error) {
        console.log('[Auth] signIn firstFactor verification error', result.signIn.firstFactorVerification.error);
      }

      if (!result) {
        setError('We could not start the OAuth flow. Please try again.');
        return;
      }

      const sessionId =
        result.createdSessionId ??
        result.signIn?.createdSessionId ??
        result.signUp?.createdSessionId ??
        null;

      if (sessionId) {
        await finishSignIn(sessionId, result.setActive);
        setInfo('Signed in successfully.');
        return;
      }

      if (result.signUp) {
        const completedSession = await autoCompleteSignUp(
          result.signUp,
          result.signUp.emailAddress ?? result.signIn?.identifier ?? email
        );
        if (completedSession) {
          await finishSignIn(completedSession, result.setActive);
          setInfo('Signed in successfully.');
          return;
        }
        setInfo('Complete sign-up in the browser to finish authentication.');
        return;
      }

      if (result.signIn?.status === 'needs_second_factor') {
        setError('Additional verification required in browser.');
        return;
      }

      setError('OAuth sign-in was cancelled or incomplete.');
    } catch (err: any) {
      console.error('[Auth] OAuth flow error', err);
      setError(err?.errors?.[0]?.longMessage ?? 'Unable to complete OAuth sign-in.');
    } finally {
      setLoading(false);
    }
  };

  if (auth.status === 'loading' || !isSignInLoaded || !isSignUpLoaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brandBlock}>
          <Text style={styles.brandName}>Carebase</Text>
          <Text style={styles.brandTagline}>
            All your care tasks, organized for the week ahead.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Text style={styles.cardText}>
            Choose the method that works best for you. We support secure email sign in, password, magic
            links, and social providers.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              style={styles.input}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Enter your password"
              style={styles.input}
            />
            <TouchableOpacity
              onPress={handlePasswordSignIn}
              style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
              disabled={loading}
            >
              <Text style={styles.primaryButtonText}>Continue with Email & Password</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.fieldGroup}>
            <TouchableOpacity
              onPress={handleRequestMagicLink}
              style={[styles.secondaryButton, loading && styles.secondaryButtonDisabled]}
              disabled={loading}
            >
              <Text style={styles.secondaryButtonText}>Email me a magic link</Text>
            </TouchableOpacity>
            {magicLink.pending && (
              <>
                <Text style={styles.helperText}>
                  Enter the verification code from your email if you prefer not to tap the link directly.
                </Text>
                <TextInput
                  value={magicLink.code}
                  onChangeText={(value) =>
                    setMagicLink((prev) => ({ ...prev, code: value, error: null }))
                  }
                  placeholder="Enter verification code"
                  style={styles.input}
                  keyboardType="number-pad"
                />
                <TouchableOpacity
                  onPress={handleVerifyMagicLinkCode}
                  style={[styles.secondaryButton, loading && styles.secondaryButtonDisabled]}
                  disabled={loading || magicLink.code.trim().length === 0}
                >
                  <Text style={styles.secondaryButtonText}>Verify code</Text>
                </TouchableOpacity>
                {magicLink.error && <Text style={styles.errorText}>{magicLink.error}</Text>}
              </>
            )}
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>Social sign-in</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.socialButtons}>
            <TouchableOpacity
              style={[styles.socialButton, styles.googleButton]}
              onPress={() => handleOAuth(googleOAuth, 'google')}
              disabled={loading}
            >
              <Text style={[styles.socialButtonText, styles.googleButtonText]}>Continue with Google</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.socialButton, styles.facebookButton]}
              onPress={() => handleOAuth(facebookOAuth, 'facebook')}
              disabled={loading}
            >
              <Text style={styles.socialButtonText}>Continue with Facebook</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.socialButton, styles.appleButton]}
              onPress={() => handleOAuth(appleOAuth, 'apple')}
              disabled={loading}
            >
              <Text style={styles.socialButtonText}>Continue with Apple</Text>
            </TouchableOpacity>
          </View>

          {info && <Text style={styles.infoText}>{info}</Text>}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={styles.loadingText}>Working...</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: palette.background
    },
    container: {
      flexGrow: 1,
      justifyContent: 'flex-start',
      paddingHorizontal: spacing(3),
      paddingTop: spacing(8),
      paddingBottom: spacing(6)
    },
    brandBlock: {
      marginBottom: spacing(1)
    },
    brandName: {
      fontSize: 36,
      fontWeight: '700',
      color: palette.primary
    },
    brandTagline: {
      marginTop: spacing(1),
      fontSize: 16,
      lineHeight: 22,
      color: palette.textSecondary
    },
    card: {
      backgroundColor: palette.canvas,
      borderRadius: radius.md,
      padding: spacing(3),
      ...shadow.card
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: palette.textPrimary
    },
    cardText: {
      marginTop: spacing(1),
      fontSize: 14,
      color: palette.textSecondary,
      lineHeight: 20
    },
    fieldGroup: {
      marginTop: spacing(3)
    },
    fieldLabel: {
      fontSize: 13,
      color: palette.textSecondary,
      marginBottom: spacing(1)
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing(1.5),
      paddingVertical: spacing(1.25),
      color: palette.textPrimary
    },
    primaryButton: {
      marginTop: spacing(2),
      backgroundColor: palette.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.75),
      alignItems: 'center'
    },
    primaryButtonDisabled: {
      opacity: 0.7
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700'
    },
    secondaryButton: {
      marginTop: spacing(2),
      backgroundColor: palette.canvas,
      borderRadius: radius.sm,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
      borderWidth: 1,
      borderColor: palette.border
    },
    secondaryButtonDisabled: {
      opacity: 0.7
    },
    secondaryButtonText: {
      color: palette.textPrimary,
      fontSize: 15,
      fontWeight: '600'
    },
    helperText: {
      marginTop: spacing(1),
      fontSize: 12,
      color: palette.textMuted
    },
    divider: {
      marginTop: spacing(4),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1)
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: palette.border
    },
    dividerText: {
      fontSize: 12,
      color: palette.textMuted
    },
    socialButtons: {
      marginTop: spacing(2),
      gap: spacing(1.5)
    },
    socialButton: {
      borderRadius: radius.sm,
      paddingVertical: spacing(1.5),
      alignItems: 'center'
    },
    googleButton: {
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: palette.border
    },
    facebookButton: {
      backgroundColor: '#1877F2'
    },
    appleButton: {
      backgroundColor: '#000'
    },
    socialButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 15
    },
    googleButtonText: {
      color: '#D14343'
    },
    infoText: {
      marginTop: spacing(2),
      fontSize: 13,
      color: palette.textSecondary
    },
    errorText: {
      marginTop: spacing(2),
      fontSize: 13,
      color: palette.danger ?? '#D14343'
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center'
    },
    loadingOverlay: {
      marginTop: spacing(2),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1)
    },
    loadingText: {
      color: palette.textSecondary,
      fontSize: 13
    }
  });
