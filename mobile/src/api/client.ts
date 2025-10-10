/**
 * API client for making requests to the backend
 */
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true, // Send cookies with requests
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add session ID from AsyncStorage to Cookie header
apiClient.interceptors.request.use(
  async (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);

    // Get session ID from AsyncStorage and add it as a cookie header
    try {
      const sessionId = await AsyncStorage.getItem('sessionId');
      if (sessionId) {
        config.headers.Cookie = `connect.sid=${sessionId}`;
        console.log('[API] Added session cookie to request');
      }
    } catch (error) {
      console.error('[API] Failed to get session ID:', error);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    console.log(`[API] Response: ${response.status}`);
    return response;
  },
  (error) => {
    if (error.response) {
      console.error(`[API] Error: ${error.response.status}`, error.response.data);
    } else {
      console.error(`[API] Network error:`, error.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
