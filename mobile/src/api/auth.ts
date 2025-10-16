import type { User } from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config';

export interface SessionResponse {
  authenticated: boolean;
  user: User | null;
}

export interface MobileLoginResponse {
  accessToken: string;
}

export async function checkSession(): Promise<SessionResponse> {
  const response = await apiClient.get(API_ENDPOINTS.checkSession);
  return response.data as SessionResponse;
}

export async function mobileLogin(authToken: string): Promise<MobileLoginResponse> {
  const response = await apiClient.post(API_ENDPOINTS.mobileLogin, { authToken });
  return response.data as MobileLoginResponse;
}

export async function logout(): Promise<void> {
  await apiClient.post(API_ENDPOINTS.logout);
}
