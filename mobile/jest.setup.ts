import '@testing-library/jest-native/extend-expect';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

if (!(global as any).process) {
  (global as any).process = { env: {} };
}
(global as any).process.env = {
  ...(global as any).process.env,
  EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3000',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'mock-web-client-id',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'mock-ios-client-id',
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'mock-android-client-id',
};
