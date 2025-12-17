import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';

const mockReplace = jest.fn();
const mockPush = jest.fn();

const mockUseUserTheme = jest.fn();
const mockUseQueryMy = jest.fn();
const mockUseQueryMe = jest.fn();
const mockUseMutationInvite = jest.fn();

const mockClipboardSetStringAsync = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: any[]) => mockClipboardSetStringAsync(...args),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

jest.mock('@/components/Container', () => ({
  Container: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/SignOutButton', () => ({
  SignOutButton: () => null,
}));

jest.mock('@/app/(hooks)/useUserTheme', () => ({
  useUserTheme: () => mockUseUserTheme(),
}));

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      caregivers: { me: { invalidate: jest.fn() } },
    }),
    careRecipients: {
      my: {
        useQuery: (...args: any[]) => mockUseQueryMy(...args),
      },
      invite: {
        useMutation: (...args: any[]) => mockUseMutationInvite(...args),
      },
    },
    caregivers: {
      me: {
        useQuery: (...args: any[]) => mockUseQueryMe(...args),
      },
      setName: {
        useMutation: () => ({
          mutate: jest.fn(),
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockClipboardSetStringAsync.mockReset().mockResolvedValue(undefined);

  mockUseUserTheme.mockReturnValue({
    systemColorScheme: 'light',
    isDark: false,
    setUserTheme: jest.fn(),
    resetTheme: jest.fn(),
    isUpdating: false,
  });

  mockUseQueryMy.mockReturnValue({
    data: { careRecipient: { id: 'cr1', name: 'Mom' }, membership: { role: 'owner' } },
    isSuccess: true,
    isLoading: false,
  });

  mockUseQueryMe.mockReturnValue({
    data: { name: 'Adam', email: 'adam@example.com' },
    isError: false,
  });
});

test('creates invite and allows copying the code', async () => {
  jest.useFakeTimers();

  mockUseMutationInvite.mockImplementation((opts: any) => ({
    mutate: () =>
      opts?.onSuccess?.({
        token: 'INVITE_1234',
        expiresAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
      }),
    isLoading: false,
    isError: false,
  }));

  const screen = render(<ProfileScreen />);

  fireEvent.press(screen.getByText('Create invite code'));
  expect(screen.getByText('Invite code')).toBeTruthy();
  expect(screen.getByText('INVITE_1234')).toBeTruthy();

  fireEvent.press(screen.getByText('Copy'));
  expect(mockClipboardSetStringAsync).toHaveBeenCalledWith('INVITE_1234');

  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByText('Copied')).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(1600);
  });

  expect(screen.getByText('Copy')).toBeTruthy();

  fireEvent.press(screen.getByText('Close'));
  expect(screen.queryByText('Invite code')).toBeNull();

  jest.useRealTimers();
});
