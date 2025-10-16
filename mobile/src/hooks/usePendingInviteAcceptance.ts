import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../ui/ToastProvider';
import { emitPlanChanged } from '../utils/planEvents';
import { useCollaborators } from '../collaborators/CollaboratorProvider';

const PENDING_INVITE_TOKEN_KEY = 'carebase_pending_invite_token';

export const extractTokenFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const value = parsed.searchParams.get('token');
    return value ? decodeURIComponent(value) : null;
  } catch {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
};

export interface PendingInviteController {
  pendingToken: string | null;
  handleIncomingUrl: (url: string | null) => Promise<void>;
}

export function usePendingInviteAcceptance(): PendingInviteController {
  const auth = useAuth();
  const toast = useToast();
  const { acceptInviteToken } = useCollaborators();
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const processingRef = useRef(false);

  const storeToken = useCallback(async (token: string | null) => {
    if (!token) return;
    await AsyncStorage.setItem(PENDING_INVITE_TOKEN_KEY, token).catch(() => {});
    setPendingToken(token);
  }, []);

  const handleIncomingUrl = useCallback(
    async (url: string | null) => {
      const token = extractTokenFromUrl(url);
      if (token) {
        await storeToken(token);
      }
    },
    [storeToken]
  );

  useEffect(() => {
    AsyncStorage.getItem(PENDING_INVITE_TOKEN_KEY)
      .then((stored) => {
        if (stored) {
          setPendingToken(stored);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (auth.status !== 'signedIn') {
      return;
    }
    if (!pendingToken || processingRef.current) {
      return;
    }

    let cancelled = false;
    processingRef.current = true;

    const acceptInvite = async () => {
      try {
        await acceptInviteToken(pendingToken);
        if (cancelled) return;
        await AsyncStorage.removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
        setPendingToken(null);
        toast.showToast('Invite accepted. Updating plan…');
        emitPlanChanged();
      } catch (error: any) {
        if (cancelled) return;
        const status = error?.response?.status;
        if (status === 404) {
          toast.showToast('Invite already used or expired.');
          await AsyncStorage.removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
          setPendingToken(null);
        } else if (status === 401) {
          toast.showToast('Sign in with the invited email to finish accepting.');
        } else {
          toast.showToast('Unable to accept invite right now. Try again later.');
        }
      } finally {
        processingRef.current = false;
      }
    };

    acceptInvite();

    return () => {
      cancelled = true;
    };
  }, [acceptInviteToken, auth.status, pendingToken, toast]);

  return {
    pendingToken,
    handleIncomingUrl,
  };
}
