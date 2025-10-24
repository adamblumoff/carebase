import type { PlanPayload } from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config/apiEndpoints';

export async function fetchPlan(): Promise<PlanPayload> {
  const response = await apiClient.get(API_ENDPOINTS.getPlan);
  return response.data as PlanPayload;
}

export async function fetchPlanVersion(): Promise<number> {
  const response = await apiClient.get(API_ENDPOINTS.getPlanVersion);
  const version = response.data?.planVersion;
  return typeof version === 'number' ? version : 0;
}
