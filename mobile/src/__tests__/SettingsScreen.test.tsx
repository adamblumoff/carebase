import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from '../screens/SettingsScreen';
import { ThemeProvider } from '../theme';
import { AuthContext } from '../auth/AuthContext';

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

const { ToastProvider } = require('../ui/ToastProvider');

jest.mock('../api/collaborators', () => ({
  fetchCollaborators: jest.fn().mockResolvedValue([]),
  inviteCollaborator: jest.fn().mockResolvedValue({
    id: 1,
    recipientId: 1,
    userId: null,
    email: 'new@test.com',
    role: 'contributor',
    status: 'pending',
    inviteToken: '',
    invitedBy: 1,
    invitedAt: new Date().toISOString(),
    acceptedAt: null,
  }),
  acceptCollaboratorInvite: jest.fn(),
}));

jest.useFakeTimers();

const renderWithProviders = (ui: React.ReactElement, authOverrides = {}) => {
  const authValue = {
    status: 'signedIn' as const,
    user: { email: 'user@test.com' },
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
    ...authOverrides,
  };

  return render(
    <ThemeProvider>
      <AuthContext.Provider value={authValue}>
        <ToastProvider>{ui}</ToastProvider>
      </AuthContext.Provider>
    </ThemeProvider>
  );
};

describe('SettingsScreen logout', () => {
  it('calls signOut when confirmed', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const [, confirm] = buttons ?? [];
      confirm?.onPress?.();
      return 0;
    });
    const signOut = jest.fn().mockResolvedValue(undefined);
    const { getByText } = renderWithProviders(<SettingsScreen /> as any, { signOut });

    fireEvent.press(getByText('Log out'));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
  });
});
