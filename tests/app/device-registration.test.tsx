import React from 'react';
import { render } from '@testing-library/react-native';

import { DeviceRegistration } from '@/components/DeviceRegistration';

const mockUseAuth = jest.fn();
const mockSetTimezoneMutate = jest.fn();
const mockRegisterPushMutate = jest.fn();

jest.mock('@clerk/clerk-expo', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-device', () => ({
  isDevice: false,
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'proj' } } },
  easConfig: { projectId: 'proj' },
}));

jest.mock('@/lib/device-timezone', () => ({
  getDeviceTimeZone: () => 'America/Chicago',
}));

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    caregivers: {
      setTimezone: {
        useMutation: () => ({ mutate: mockSetTimezoneMutate }),
      },
    },
    pushTokens: {
      register: {
        useMutation: () => ({ mutate: mockRegisterPushMutate }),
      },
    },
  },
}));

beforeEach(() => {
  mockUseAuth.mockReset();
  mockSetTimezoneMutate.mockReset();
  mockRegisterPushMutate.mockReset();
});

test('sets timezone once per sign-in', () => {
  mockUseAuth.mockReturnValue({ isSignedIn: true });

  const screen = render(<DeviceRegistration />);
  screen.rerender(<DeviceRegistration />);
  screen.rerender(<DeviceRegistration />);

  expect(mockSetTimezoneMutate).toHaveBeenCalledTimes(1);
  expect(mockSetTimezoneMutate).toHaveBeenCalledWith(
    { timezone: 'America/Chicago' },
    expect.any(Object)
  );
});

test('resets guards after sign-out', () => {
  mockUseAuth.mockReturnValue({ isSignedIn: true });
  const screen = render(<DeviceRegistration />);
  expect(mockSetTimezoneMutate).toHaveBeenCalledTimes(1);

  mockUseAuth.mockReturnValue({ isSignedIn: false });
  screen.rerender(<DeviceRegistration />);

  mockUseAuth.mockReturnValue({ isSignedIn: true });
  screen.rerender(<DeviceRegistration />);

  expect(mockSetTimezoneMutate).toHaveBeenCalledTimes(2);
});
