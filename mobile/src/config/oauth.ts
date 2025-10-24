import { readEnv } from './env';

export const GOOGLE_CLIENT_ID = {
  web: readEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID') || 'your-web-client-id.apps.googleusercontent.com',
  ios: readEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID') || 'your-ios-client-id.apps.googleusercontent.com',
  android: readEnv('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID') || 'your-android-client-id.apps.googleusercontent.com'
};
