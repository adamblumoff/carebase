/**
 * API client for making requests to the backend
 */
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { authEvents } from '../auth/authEvents';
import { getAccessToken, removeAccessToken } from '../auth/tokenStorage';

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
    if (__DEV__) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    }

    try {
      const accessToken = await getAccessToken();
      if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
        if (__DEV__) {
          console.log('[API] Added bearer token to request');
        }
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
    if (__DEV__) {
      console.log(`[API] Response: ${response.status}`);
    }
    return response;
  },
  (error) => {
    if (error.response) {
      const status = error.response.status;
      const hadBearer = typeof error.config?.headers?.Authorization === 'string';
      const logger =
        status === 401 && !hadBearer && __DEV__ ? console.debug : console.error;
      logger(`[API] Error: ${status}`, error.response.data);

      if (status === 401 && hadBearer) {
        removeAccessToken().catch(() => {
          // ignore cleanup errors
        });
        authEvents.emitUnauthorized();
      }
    } else {
      console.error(`[API] Network error:`, error.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
