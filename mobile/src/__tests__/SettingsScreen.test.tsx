import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from '../screens/SettingsScreen';
import { ThemeProvider } from '../theme';
import { AuthContext } from '../auth/AuthContext';

const mockToast = jest.fn();

jest.mock('../ui/ToastProvider', () => {
  const React = require('react');
  const ToastContext = React.createContext({ showToast: jest.fn() });
  return {
    __esModule: true,
    ToastProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(ToastContext.Provider, { value: { showToast: mockToast } }, children),
    useToast: () => ({ showToast: mockToast }),
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

jest.mock('../api/googleIntegration', () => ({
  fetchGoogleIntegrationStatus: jest.fn().mockResolvedValue({
    connected: false,
    calendarId: null,
    lastSyncedAt: null,
    syncPendingCount: 0,
    lastError: null,
  }),
  beginGoogleIntegrationConnect: jest.fn().mockResolvedValue({
    authUrl: 'https://example.com/google-auth',
    redirectUri: 'https://example.com/callback',
  }),
  disconnectGoogleIntegration: jest.fn().mockResolvedValue(undefined),
  triggerGoogleManualSync: jest.fn().mockResolvedValue({
    pushed: 0,
    pulled: 0,
    deleted: 0,
    errors: [],
    calendarId: 'primary',
  }),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'dismiss' }),
}));

jest.useFakeTimers();

const mockConnect = jest.fn().mockResolvedValue('success');
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockManualSync = jest.fn().mockResolvedValue({
  pushed: 0,
  pulled: 0,
  deleted: 0,
  errors: [],
  calendarId: 'primary',
});

const createIntegrationState = (overrides: Record<string, any> = {}) => ({
  status: null,
  loading: false,
  connecting: false,
  syncing: false,
  error: null,
  connect: mockConnect,
  disconnect: mockDisconnect,
  manualSync: mockManualSync,
  refreshStatus: jest.fn(),
  requestReady: true,
  ...overrides,
});

let integrationState = createIntegrationState();

const mockUseGoogleCalendarIntegration = jest.fn(() => integrationState);

jest.mock('../hooks/useGoogleCalendarIntegration', () => ({
  useGoogleCalendarIntegration: () => mockUseGoogleCalendarIntegration(),
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockToast.mockClear();
    mockConnect.mockResolvedValue('success');
    mockDisconnect.mockResolvedValue(undefined);
    mockManualSync.mockResolvedValue({
      pushed: 0,
      pulled: 0,
      deleted: 0,
      errors: [],
      calendarId: 'primary',
    });
    integrationState = createIntegrationState();
    mockUseGoogleCalendarIntegration.mockImplementation(() => integrationState);
  });

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

    expect(mockToast).toHaveBeenCalledWith('Signed out');
  });

  it('connects Google Calendar and shows success toast', async () => {
    const { getByText } = renderWithProviders(<SettingsScreen /> as any);

    await act(async () => {
      fireEvent.press(getByText('Connect Google Calendar'));
    });

    expect(mockConnect).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Google Calendar connected');
    });
  });

  it('runs manual sync when already connected', async () => {
    integrationState = createIntegrationState({
      status: {
        connected: true,
        calendarId: 'primary',
        lastSyncedAt: null,
        syncPendingCount: 0,
        lastError: null,
      },
    });
    mockUseGoogleCalendarIntegration.mockImplementation(() => integrationState);
    mockManualSync.mockResolvedValue({
      pushed: 2,
      pulled: 1,
      deleted: 0,
      errors: [],
      calendarId: 'primary',
    });

    const { getByText } = renderWithProviders(<SettingsScreen /> as any);

    await act(async () => {
      fireEvent.press(getByText('Sync now'));
    });

    expect(mockManualSync).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Synced with Google (2 pushed, 1 pulled)');
    });
  });

  it('confirms and disconnects Google Calendar', async () => {
    integrationState = createIntegrationState({
      status: {
        connected: true,
        calendarId: 'primary',
        lastSyncedAt: null,
        syncPendingCount: 0,
        lastError: null,
      },
    });
    mockUseGoogleCalendarIntegration.mockImplementation(() => integrationState);

    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const [, disconnect] = buttons ?? [];
      disconnect?.onPress?.();
      return 0;
    });

    const { getByText } = renderWithProviders(<SettingsScreen /> as any);

    await act(async () => {
      fireEvent.press(getByText('Disconnect'));
    });

    expect(mockDisconnect).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Disconnected Google Calendar');
    });
  });
});
