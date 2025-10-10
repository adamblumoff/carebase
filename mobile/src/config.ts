/**
 * App configuration
 */

// API base URL - change this to your backend URL
// For development on physical device, use your computer's local IP
// For emulator/simulator, use localhost
export const API_BASE_URL = __DEV__
  ? 'http://localhost:3000' // Change to http://192.168.x.x:3000 for physical device
  : 'https://your-production-url.com';

// Google OAuth configuration
// Get these from Google Cloud Console
export const GOOGLE_CLIENT_ID = {
  // Web client ID (used for iOS)
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 'your-web-client-id.apps.googleusercontent.com',
  // iOS client ID
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 'your-ios-client-id.apps.googleusercontent.com',
  // Android client ID
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 'your-android-client-id.apps.googleusercontent.com',
};

export const API_ENDPOINTS = {
  // Auth
  checkSession: '/api/auth/session',
  logout: '/api/auth/logout',
  getUserInfo: '/api/auth/user',
  exchangeGoogleToken: '/api/auth/google',

  // Plan
  getPlan: '/api/plan',

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
};
