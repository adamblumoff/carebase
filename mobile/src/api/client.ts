/**
 * API client for making requests to the backend
 */
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: false,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  async (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);

    try {
      const accessToken = await AsyncStorage.getItem('accessToken');
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
        console.log('[API] Added bearer token to request');
      }
    } catch (error) {
      console.error('[API] Failed to load access token:', error);
    }

    return config;
  },
  (error) => Promise.reject(error)
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

      if (error.response.status === 401) {
        AsyncStorage.removeItem('accessToken').catch(() => {
          // ignore cleanup errors
        });
        // Flag for consumers to prompt re-auth; session bootstrap handles redirect.
        error.response.config.headers['x-auth-cleared'] = '1';
      }
    } else {
      console.error(`[API] Network error:`, error.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
