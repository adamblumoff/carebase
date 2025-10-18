import { act, renderHook, waitFor } from '@testing-library/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractTokenFromUrl,
  usePendingInviteAcceptance,
} from '../usePendingInviteAcceptance';

const toastMock = { showToast: vi.fn() };
const acceptInviteMock = vi.fn();
const emitPlanChangedMock = vi.fn();
const authState: { status: 'loading' | 'signedOut' | 'signedIn'; user: any } = {
  status: 'signedOut',
  user: null,
};

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => toastMock,
}));

vi.mock('../../collaborators/CollaboratorProvider', () => ({
  useCollaborators: () => ({
    acceptInviteToken: (token: string) => acceptInviteMock(token),
  }),
}));

vi.mock('../../utils/planEvents', () => ({
  emitPlanChanged: () => emitPlanChangedMock(),
}));

const STORAGE_KEY = 'carebase_pending_invite_token';

describe('usePendingInviteAcceptance', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    toastMock.showToast.mockReset();
    await AsyncStorage.clear();
    authState.status = 'signedOut';
  });

  it('extractTokenFromUrl parses variants', () => {
    expect(extractTokenFromUrl('https://example.com?token=abc')).toBe('abc');
    expect(extractTokenFromUrl('app://callback?foo=1&token=abc%20123')).toBe('abc 123');
    expect(extractTokenFromUrl('?token=xyz')).toBe('xyz');
    expect(extractTokenFromUrl(null)).toBeNull();
  });

  it('handleIncomingUrl stores token for later', async () => {
    const { result } = renderHook(() => usePendingInviteAcceptance());

    await act(async () => {
      await result.current.handleIncomingUrl('https://example.com?token=invite-123');
    });

    await waitFor(() => {
      expect(result.current.pendingToken).toBe('invite-123');
    });
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('invite-123');
  });

  it('accepts pending invite once signed in and clears token', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'pending-token');
    authState.status = 'signedIn';
    acceptInviteMock.mockResolvedValue({ id: 1 });

    const { result } = renderHook(() => usePendingInviteAcceptance());

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith('pending-token');
    });

    await waitFor(async () => {
      expect(result.current.pendingToken).toBeNull();
      expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    expect(toastMock.showToast).toHaveBeenCalledWith('Invite accepted. Updating plan…');
    expect(emitPlanChangedMock).toHaveBeenCalled();
  });

  it('surfaces 404 errors and clears stored token', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'stale-token');
    authState.status = 'signedIn';
    acceptInviteMock.mockRejectedValue({ response: { status: 404 } });

    renderHook(() => usePendingInviteAcceptance());

    await waitFor(() => {
      expect(toastMock.showToast).toHaveBeenCalledWith('Invite already used or expired.');
    });
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
