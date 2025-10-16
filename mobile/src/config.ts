/**
 * App configuration
 */

// API base URL - configurable via Expo env (EXPO_PUBLIC_API_BASE_URL)
// For development on device, point EXPO_PUBLIC_API_BASE_URL to your ngrok tunnel.
// Defaults fall back to localhost for emulator/simulator.
const DEFAULT_DEV_URL = 'http://localhost:3000';
const DEFAULT_PROD_URL = 'https://your-production-url.com';

const envVars = (typeof process !== 'undefined' && process.env) ? process.env : {};

export const API_BASE_URL =
  envVars.EXPO_PUBLIC_API_BASE_URL ||
  (__DEV__ ? DEFAULT_DEV_URL : DEFAULT_PROD_URL);

// Google OAuth configuration
// Get these from Google Cloud Console
export const GOOGLE_CLIENT_ID = {
  // Web client ID (used for iOS)
  web: envVars.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'your-web-client-id.apps.googleusercontent.com',
  // iOS client ID
  ios: envVars.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'your-ios-client-id.apps.googleusercontent.com',
  // Android client ID
  android: envVars.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'your-android-client-id.apps.googleusercontent.com',
};

export const API_ENDPOINTS = {
  // Auth
  checkSession: '/api/auth/session',
  logout: '/api/auth/logout',
  getUserInfo: '/api/auth/user',
  mobileLogin: '/api/auth/mobile-login',

  // Plan
  getPlan: '/api/plan',
  getPlanVersion: '/api/plan/version',

  // Appointments
  getAppointment: (id: number) => `/api/appointments/${id}`,
  updateAppointment: (id: number) => `/api/appointments/${id}`,
  deleteAppointment: (id: number) => `/api/appointments/${id}`,

  // Bills
  getBill: (id: number) => `/api/bills/${id}`,
  updateBill: (id: number) => `/api/bills/${id}`,
  deleteBill: (id: number) => `/api/bills/${id}`,
  markBillPaid: (id: number) => `/api/bills/${id}/mark-paid`,

  // Upload
  uploadPhoto: '/api/upload/photo',

  // Collaborators
  collaborators: {
    list: '/api/collaborators',
    invite: '/api/collaborators',
    accept: '/api/collaborators/accept',
  },

  // Integrations
  googleIntegration: {
    status: '/api/integrations/google/status',
    connect: '/api/integrations/google/connect',
    sync: '/api/integrations/google/sync',
  },
};
