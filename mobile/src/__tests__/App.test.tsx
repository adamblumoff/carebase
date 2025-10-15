import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../App';
import apiClient from '../api/client';
import { Linking as RNLinking } from 'react-native';

jest.mock('../api/collaborators', () => ({
  acceptCollaboratorInvite: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../ui/ToastProvider', () => {
  const React = require('react');
  const ToastContext = React.createContext({ showToast: jest.fn() });
  return {
    __esModule: true,
    ToastProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(ToastContext.Provider, { value: { showToast: jest.fn() } }, children),
    useToast: () => ({ showToast: jest.fn() }),
  };
});

const mockAppNavigator = jest.fn();

jest.mock('../navigation/AppNavigator', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ isSignedIn }: { isSignedIn: boolean }) => {
      mockAppNavigator(isSignedIn);
      return React.createElement(View, null, React.createElement(Text, null, isSignedIn ? 'AppStack' : 'AuthStack'));
    },
  };
});

jest.mock('../api/client', () => ({
  get: jest.fn(),
  post: jest.fn(),
  interceptors: {
    request: { use: jest.fn() },
    response: { use: jest.fn((success: any) => success) },
  },
}));

const mockedClient = apiClient as jest.Mocked<typeof apiClient>;

describe('App bootstrap auth', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    jest.spyOn(RNLinking, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
    jest.spyOn(RNLinking, 'getInitialURL').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders login flow when no token', async () => {
    const { getByText } = render(<App />);

    await waitFor(() => {
      expect(mockAppNavigator).toHaveBeenCalledWith(false);
      expect(getByText('AuthStack')).toBeTruthy();
    });
  });

  it('renders plan flow when token valid', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('token');
    mockedClient.get.mockResolvedValue({ data: { authenticated: true, user: { email: 'user@test.com' } } });

    const { getByText } = render(<App />);

    await waitFor(() => {
      expect(mockAppNavigator).toHaveBeenCalledWith(true);
      expect(getByText('AppStack')).toBeTruthy();
    });
  });
});
