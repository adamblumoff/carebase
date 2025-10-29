import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Notifications from 'expo-notifications';
import { __setAppOwnership } from 'expo-constants';
import { useNotifications } from '../useNotifications';

const notifications = vi.mocked(Notifications);

vi.mock('../../navigation/navigationRef', () => ({
  navigate: vi.fn()
}));

const showToast = vi.fn();

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showToast })
}));

const buildPermission = (
  status: 'undetermined' | 'denied' | 'granted' | 'provisional',
  options?: Partial<{ granted: boolean; canAskAgain: boolean }>
) => ({
  status,
  granted: options?.granted ?? (status === 'granted' || status === 'provisional'),
  canAskAgain: options?.canAskAgain ?? true,
  expires: 'never'
});

describe('useNotifications', () => {
  beforeEach(() => {
    showToast.mockReset();
    __setAppOwnership('standalone');
    notifications.getPermissionsAsync.mockResolvedValue(
      buildPermission('undetermined', { granted: false, canAskAgain: true }) as any
    );
    notifications.requestPermissionsAsync.mockResolvedValue(buildPermission('granted') as any);
    notifications.addNotificationReceivedListener.mockReturnValue({ remove: vi.fn() } as any);
    notifications.addNotificationResponseReceivedListener.mockReturnValue({ remove: vi.fn() } as any);
    notifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it('requests notification permissions when status is undetermined', async () => {
    const { unmount } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    unmount();
  });

  it('surfaces a warning when permissions are denied and cannot be requested again', async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce(
      buildPermission('denied', { granted: false, canAskAgain: false }) as any
    );
    const { unmount } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        'Enable notifications in Settings to get medication reminders.'
      );
    });

    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    unmount();
  });

  it('warns when running inside Expo Go', async () => {
    __setAppOwnership('expo');
    notifications.getPermissionsAsync.mockResolvedValueOnce(buildPermission('granted') as any);
    const { unmount } = renderHook(() => useNotifications());

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        'Use a development build to test medication notifications.'
      );
    });

    unmount();
  });
});
