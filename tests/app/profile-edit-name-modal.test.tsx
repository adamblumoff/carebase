import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileScreen from '@/app/(tabs)/profile';

const mockReplace = jest.fn();
const mockPush = jest.fn();

const mockUseUserTheme = jest.fn();
const mockUseQueryMy = jest.fn();
const mockUseQueryMe = jest.fn();
const mockUseMutationSetName = jest.fn();

const mockInvalidateMe = jest.fn();

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
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
      caregivers: { me: { invalidate: mockInvalidateMe } },
    }),
    careRecipients: {
      my: {
        useQuery: (...args: any[]) => mockUseQueryMy(...args),
      },
      invite: {
        useMutation: () => ({
          mutate: jest.fn(),
          isLoading: false,
          isError: false,
        }),
      },
    },
    caregivers: {
      me: {
        useQuery: (...args: any[]) => mockUseQueryMe(...args),
      },
      setName: {
        useMutation: (...args: any[]) => mockUseMutationSetName(...args),
      },
    },
  },
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockInvalidateMe.mockClear();

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

test('edits caregiver name via modal and trims before saving', async () => {
  const mutate = jest.fn((input: any) => {});

  mockUseMutationSetName.mockImplementation((opts: any) => ({
    mutate: (input: any) => {
      mutate(input);
      opts?.onSuccess?.();
    },
    isLoading: false,
    isError: false,
  }));

  const screen = render(<ProfileScreen />);

  fireEvent.press(screen.getByText('Edit'));

  expect(screen.getByText('Edit your name')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('Your name'), '  Mom  ');
  fireEvent.press(screen.getByText('Save'));

  await waitFor(() => expect(mockInvalidateMe).toHaveBeenCalled());
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mom' }));
  expect(screen.queryByText('Edit your name')).toBeNull();
});

test('shows inline validation when saving an empty name', () => {
  const mutate = jest.fn();

  mockUseMutationSetName.mockReturnValue({
    mutate,
    isLoading: false,
    isError: false,
  });

  const screen = render(<ProfileScreen />);

  fireEvent.press(screen.getByText('Edit'));
  fireEvent.changeText(screen.getByPlaceholderText('Your name'), '   ');
  fireEvent.press(screen.getByText('Save'));

  expect(screen.getByText('Please enter a name.')).toBeTruthy();
  expect(mutate).not.toHaveBeenCalled();
});
