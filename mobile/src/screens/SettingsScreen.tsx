/**
 * Settings Screen
 * Streamlined account and app preferences UI
 */
import React, { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { API_BASE_URL } from '../config';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/ToastProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const auth = useAuth();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  const email = auth.user?.email;
  const forwardingAddress = auth.user?.forwardingAddress ?? 'Add your forwarding address';

  const handleLogout = () => {
    if (loggingOut) return;
    Alert.alert('Log out', 'Are you sure you want to sign out of Carebase?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          try {
            await auth.signOut();
            toast.showToast('Signed out');
          } catch (error) {
            console.error('Logout error', error);
            Alert.alert('Error', 'Failed to sign out. Please try again.');
            toast.showToast('Failed to sign out');
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        bounces={false}
      >
        <View style={styles.headerCard}>
          <Text style={styles.headerEyebrow}>Account</Text>
          <Text style={styles.headerTitle}>Carebase Companion</Text>
          {email ? (
            <Text style={styles.headerSubtitle}>{email}</Text>
          ) : (
            <Text style={styles.headerSubtitle}>
              Manage how we gather care info and keep your plan in sync.
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inbox routing</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Forwarding address</Text>
            <Text style={styles.cardValue}>{forwardingAddress}</Text>
            <Text style={styles.cardHint}>
              Forward healthcare emails here so Carebase can build your weekly checklist.
            </Text>
          </View>

          <TouchableOpacity style={styles.chevronRow}>
            <Text style={styles.chevronText}>Manage email rules</Text>
            <Text style={styles.chevronIcon}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App preferences</Text>
          <TouchableOpacity style={styles.chevronRow}>
            <Text style={styles.chevronText}>Notifications</Text>
            <Text style={styles.chevronSubtext}>Weekly digest</Text>
            <Text style={styles.chevronIcon}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chevronRow}>
            <Text style={styles.chevronText}>Week start day</Text>
            <Text style={styles.chevronSubtext}>Sunday</Text>
            <Text style={styles.chevronIcon}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Version</Text>
            <Text style={styles.cardValue}>0.1.0 (beta)</Text>
            <Text style={styles.cardLabel}>API base URL</Text>
            <Text style={styles.cardValue}>{API_BASE_URL}</Text>
          </View>
          <TouchableOpacity style={styles.chevronRow}>
            <Text style={styles.chevronText}>Privacy policy</Text>
            <Text style={styles.chevronIcon}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.chevronRow}>
            <Text style={styles.chevronText}>Terms of service</Text>
            <Text style={styles.chevronIcon}>›</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.logoutButton, loggingOut && styles.logoutButtonDisabled]}
          onPress={handleLogout}
          disabled={loggingOut}
        >
          <Text style={styles.logoutButtonText}>{loggingOut ? 'Logging out…' : 'Log out'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (palette: Palette, shadow: Shadow) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: palette.surfaceMuted,
    },
    container: {
      flex: 1,
    },
    content: {
      padding: spacing(3),
      paddingBottom: spacing(6),
    },
    headerCard: {
      backgroundColor: palette.canvas,
      borderRadius: radius.lg,
      padding: spacing(3),
      marginBottom: spacing(3),
      ...shadow.card,
    },
    headerEyebrow: {
      color: palette.accent,
      fontSize: 12,
      textTransform: 'uppercase',
      fontWeight: '700',
      letterSpacing: 1,
    },
    headerTitle: {
      color: '#fff',
      fontSize: 24,
      fontWeight: '700',
      marginTop: spacing(0.5),
    },
    headerSubtitle: {
      color: '#cbd5f5',
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing(1.5),
    },
    section: {
      marginTop: spacing(3),
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.textPrimary,
      marginBottom: spacing(1.5),
    },
    card: {
      backgroundColor: palette.canvas,
      borderRadius: radius.md,
      padding: spacing(2.5),
      ...shadow.card,
      marginBottom: spacing(2),
    },
    cardLabel: {
      fontSize: 12,
      textTransform: 'uppercase',
      fontWeight: '600',
      color: palette.textMuted,
      marginTop: spacing(1),
    },
    cardValue: {
      fontSize: 15,
      color: palette.textPrimary,
      marginTop: spacing(0.5),
    },
    cardHint: {
      fontSize: 13,
      color: palette.textSecondary,
      marginTop: spacing(1.5),
      lineHeight: 20,
    },
    chevronRow: {
      backgroundColor: palette.canvas,
      borderRadius: radius.md,
      paddingVertical: spacing(2),
      paddingHorizontal: spacing(2.5),
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing(1.5),
      ...shadow.card,
    },
    chevronText: {
      fontSize: 15,
      color: palette.textPrimary,
      fontWeight: '600',
      flex: 1,
    },
    chevronSubtext: {
      fontSize: 13,
      color: palette.textMuted,
      marginRight: spacing(1),
    },
    chevronIcon: {
      fontSize: 22,
      color: palette.textMuted,
    },
    logoutButton: {
      marginTop: spacing(4),
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: palette.danger,
      paddingVertical: spacing(1.75),
      alignItems: 'center',
    },
    logoutButtonDisabled: {
      opacity: 0.6,
    },
    logoutButtonText: {
      color: palette.danger,
      fontSize: 15,
      fontWeight: '700',
    },
  });
