/**
 * Settings Screen
 * Streamlined account and app preferences UI
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { API_BASE_URL } from '../config/env';
import { useTheme, spacing, radius, type Palette, type Shadow } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/ToastProvider';
import { useCollaborators } from '../collaborators/CollaboratorProvider';
import { useGoogleCalendarIntegration } from '../hooks/useGoogleCalendarIntegration';
import { formatLastSynced } from './settings/formatters';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { palette, shadow } = useTheme();
  const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
  const auth = useAuth();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);
  const {
    collaborators,
    loading: collaboratorsLoading,
    error: collaboratorError,
    canInvite,
    invite,
    refresh,
  } = useCollaborators();
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePending, setInvitePending] = useState(false);
  const googleIntegration = useGoogleCalendarIntegration();

  const email = auth.user?.email;
  const forwardingAddress = auth.user?.forwardingAddress ?? 'Add your forwarding address';

  const handleConnectGoogle = async () => {
    try {
      const outcome = await googleIntegration.connect();
      if (outcome === 'success') {
        toast.showToast('Google Calendar connected');
      } else {
        toast.showToast('Google connection cancelled');
      }
    } catch (error) {
      console.error('Google connect failed', error);
      toast.showToast('Failed to connect Google Calendar');
    }
  };

  const handleDisconnectGoogle = () => {
    Alert.alert('Disconnect Google Calendar', 'This will stop syncing appointments and bills. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await googleIntegration.disconnect();
            toast.showToast('Disconnected Google Calendar');
          } catch (error) {
            console.error('Disconnect Google Calendar failed', error);
            toast.showToast('Failed to disconnect Google Calendar');
          }
        }
      }
    ]);
  };

  const handleManualSync = async () => {
    try {
      const summary = await googleIntegration.manualSync();
      toast.showToast(`Synced with Google (${summary.pushed} pushed, ${summary.pulled} pulled)`);
    } catch (error) {
      console.error('Manual Google sync failed', error);
      toast.showToast('Failed to sync with Google Calendar');
    }
  };

  useEffect(() => {
    refresh().catch(() => {
      // errors surfaced via collaboratorError
    });
  }, [refresh]);

  const handleInviteCollaborator = async () => {
    if (!inviteEmail.trim()) {
      toast.showToast('Enter an email address');
      return;
    }
    setInvitePending(true);
    try {
      await invite(inviteEmail.trim());
      setInviteEmail('');
      toast.showToast('Invite sent');
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (status === 403) {
        setCanInvite(false);
        setCollaboratorError('Only the plan owner can invite collaborators.');
        toast.showToast('Only the owner can invite collaborators');
      } else if (status === 400) {
        toast.showToast('Invalid email');
      } else {
        console.error('Invite collaborator error:', error);
        toast.showToast('Failed to send invite');
      }
    } finally {
      setInvitePending(false);
    }
  };

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
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
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
          <Text style={styles.sectionTitle}>Care team</Text>
          <View style={styles.card}>
            {collaboratorsLoading ? (
              <Text style={styles.cardHint}>Loading collaborators…</Text>
            ) : collaborators.length === 0 ? (
              <Text style={styles.cardHint}>No collaborators yet.</Text>
            ) : (
              collaborators
                .sort((a, b) => a.email.localeCompare(b.email))
                .map((collaborator) => (
                  <View key={collaborator.id} style={styles.collaboratorRow}>
                    <View style={styles.collaboratorInfo}>
                      <Text style={styles.cardValue}>{collaborator.email}</Text>
                      <Text style={styles.collaboratorMeta}>
                        {collaborator.role === 'owner' ? 'Owner' : 'Contributor'} ·{' '}
                        {collaborator.status === 'accepted' ? 'Accepted' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                ))
            )}
          </View>
          {collaboratorError ? (
            <Text style={styles.sectionHelper}>{collaboratorError}</Text>
          ) : null}
          {canInvite ? (
            <View style={styles.inviteRow}>
              <TextInput
                style={styles.inviteInput}
                placeholder="name@example.com"
                placeholderTextColor={palette.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={inviteEmail}
                onChangeText={setInviteEmail}
              />
              <TouchableOpacity
                style={[styles.inviteButton, invitePending && styles.inviteButtonDisabled]}
                onPress={handleInviteCollaborator}
                disabled={invitePending}
              >
                <Text style={styles.inviteButtonText}>
                  {invitePending ? 'Sending…' : 'Invite'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Calendar sync</Text>
          <View style={styles.card}>
            <View style={styles.integrationHeader}>
              <Text style={styles.cardLabel}>Google Calendar</Text>
              <View
                style={[
                  styles.statusPill,
                  googleIntegration.status?.connected ? styles.statusPillConnected : styles.statusPillDisconnected
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    googleIntegration.status?.connected ? styles.statusPillTextConnected : styles.statusPillTextDisconnected
                  ]}
                >
                  {googleIntegration.status?.connected ? 'Connected' : 'Not connected'}
                </Text>
              </View>
            </View>

            {googleIntegration.loading ? (
              <Text style={styles.cardHint}>Checking your Google connection…</Text>
            ) : (
              <>
                <Text style={styles.cardValue}>Last sync</Text>
                <Text style={styles.cardHint}>{formatLastSynced(googleIntegration.status?.lastSyncedAt ?? null)}</Text>
                <Text style={[styles.cardValue, { marginTop: spacing(2) }]}>Pending updates</Text>
                <Text style={styles.cardHint}>
                  {googleIntegration.status?.syncPendingCount ?? 0} waiting to push
                </Text>
                {googleIntegration.status?.lastError ? (
                  <Text style={styles.integrationError}>{googleIntegration.status.lastError}</Text>
                ) : null}
              </>
            )}

            <View style={styles.integrationActions}>
              {googleIntegration.status?.connected ? (
                <>
                  <TouchableOpacity
                    style={[styles.integrationButton, googleIntegration.syncing && styles.integrationButtonDisabled]}
                    onPress={handleManualSync}
                    disabled={googleIntegration.syncing}
                  >
                    <Text style={styles.integrationButtonText}>
                      {googleIntegration.syncing ? 'Syncing…' : 'Sync now'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.integrationSecondaryButton}
                    onPress={handleDisconnectGoogle}
                    disabled={googleIntegration.connecting}
                  >
                    <Text style={styles.integrationSecondaryText}>
                      {googleIntegration.connecting ? 'Disconnecting…' : 'Disconnect'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={[styles.integrationButton, (!googleIntegration.requestReady || googleIntegration.connecting) && styles.integrationButtonDisabled]}
                  onPress={handleConnectGoogle}
                  disabled={!googleIntegration.requestReady || googleIntegration.connecting}
                >
                  <Text style={styles.integrationButtonText}>
                    {googleIntegration.connecting ? 'Connecting…' : 'Connect Google Calendar'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {googleIntegration.error ? (
            <Text style={styles.sectionHelper}>{googleIntegration.error}</Text>
          ) : null}
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
    collaboratorRow: {
      paddingVertical: spacing(1),
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
      flexDirection: 'row',
      alignItems: 'center',
    },
    collaboratorInfo: {
      flex: 1,
      gap: spacing(0.5),
    },
    collaboratorMeta: {
      fontSize: 12,
      color: palette.textMuted,
    },
    integrationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing(1.5),
    },
    statusPill: {
      paddingHorizontal: spacing(1.5),
      paddingVertical: spacing(0.75),
      borderRadius: 999,
    },
    statusPillConnected: {
      backgroundColor: palette.success,
    },
    statusPillDisconnected: {
      backgroundColor: palette.border,
    },
    statusPillText: {
      fontSize: 12,
      fontWeight: '600',
    },
    statusPillTextConnected: {
      color: '#ffffff',
    },
    statusPillTextDisconnected: {
      color: palette.textMuted,
    },
    integrationActions: {
      marginTop: spacing(2),
      gap: spacing(1),
    },
    integrationButton: {
      backgroundColor: palette.primary,
      borderRadius: radius.md,
      paddingVertical: spacing(1.5),
      alignItems: 'center',
    },
    integrationButtonDisabled: {
      opacity: 0.6,
    },
    integrationButtonText: {
      color: '#ffffff',
      fontWeight: '600',
    },
    integrationSecondaryButton: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing(1.25),
      alignItems: 'center',
    },
    integrationSecondaryText: {
      color: palette.textSecondary,
      fontWeight: '600',
    },
    integrationError: {
      marginTop: spacing(1.5),
      color: palette.danger,
      fontSize: 13,
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
    sectionHelper: {
      marginTop: spacing(1),
      fontSize: 13,
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
    inviteRow: {
      marginTop: spacing(2),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    inviteInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing(1.5),
      paddingVertical: spacing(1),
      color: palette.textPrimary,
      backgroundColor: palette.canvas,
    },
    inviteButton: {
      paddingHorizontal: spacing(2),
      paddingVertical: spacing(1),
      backgroundColor: palette.primary,
      borderRadius: radius.sm,
    },
    inviteButtonDisabled: {
      opacity: 0.5,
    },
    inviteButtonText: {
      color: '#fff',
      fontWeight: '600',
    },
  });
