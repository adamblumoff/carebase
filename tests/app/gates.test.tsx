import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import { AuthGate, SetupGate } from '@/components/gates';

const mockReplace = jest.fn();
const mockUseSegments = jest.fn();
const mockUseAuth = jest.fn();
const mockUseColorScheme = jest.fn();
const mockUseQuery = jest.fn();

jest.mock('expo-router', () => ({
  Slot: () => null,
  router: { replace: (...args: any[]) => mockReplace(...args) },
  useSegments: () => mockUseSegments(),
}));

jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('nativewind', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    careRecipients: {
      my: {
        useQuery: (...args: any[]) => mockUseQuery(...args),
      },
    },
  },
}));

beforeEach(() => {
  mockReplace.mockClear();
  mockUseSegments.mockReset();
  mockUseAuth.mockReset();
  mockUseColorScheme.mockReset();
  mockUseQuery.mockReset();
  mockUseColorScheme.mockReturnValue({ colorScheme: 'light' });
});

describe('AuthGate', () => {
  test('redirects signed-out users into auth', async () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false });
    mockUseSegments.mockReturnValue(['(tabs)']);

    render(<AuthGate />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/sign-in'));
  });
});

describe('SetupGate', () => {
  test('routes to /setup when membership is missing', async () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    mockUseSegments.mockReturnValue(['(tabs)']);
    mockUseQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
      error: { data: { code: 'PRECONDITION_FAILED' }, message: 'Care recipient not set up' },
      refetch: jest.fn(),
    });

    const screen = render(
      <SetupGate>
        <Text testID="child">Child</Text>
      </SetupGate>
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/setup'));
    expect(screen.queryByTestId('child')).toBeNull();
  });

  test('debounces the error screen to avoid a flash', async () => {
    jest.useFakeTimers();

    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });
    mockUseSegments.mockReturnValue(['(tabs)']);
    mockUseQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
      error: { data: { code: 'INTERNAL_SERVER_ERROR' }, message: 'boom' },
      refetch: jest.fn(),
    });

    const screen = render(
      <SetupGate>
        <Text>Child</Text>
      </SetupGate>
    );

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(550);
    });

    expect(screen.getByText('Something went wrong')).toBeTruthy();

    jest.useRealTimers();
  });
});
