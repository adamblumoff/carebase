import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../../App';
import apiClient from '../api/client';

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
