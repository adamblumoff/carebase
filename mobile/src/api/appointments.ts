import type {
  AppointmentPayload,
  AppointmentUpdateRequest,
} from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config';
import { formatForPayload } from '../utils/date';

export interface UpdateAppointmentParams {
  start?: Date;
  end?: Date;
  summary?: string;
  location?: string | null;
  prepNote?: string | null;
  assignedCollaboratorId?: number | null;
}

const serializeAppointmentUpdate = (
  params: UpdateAppointmentParams
): AppointmentUpdateRequest => {
  const payload: AppointmentUpdateRequest = {};

  if (params.start) {
    payload.startLocal = formatForPayload(params.start);
  }
  if (params.end) {
    payload.endLocal = formatForPayload(params.end);
  }
  if (params.summary !== undefined) {
    payload.summary = params.summary;
  }
  if (params.location !== undefined) {
    payload.location = params.location ?? undefined;
  }
  if (params.prepNote !== undefined) {
    payload.prepNote = params.prepNote ?? undefined;
  }
  if (params.assignedCollaboratorId !== undefined) {
    payload.assignedCollaboratorId = params.assignedCollaboratorId ?? undefined;
  }

  return payload;
};

export async function updateAppointment(
  id: number,
  params: UpdateAppointmentParams
): Promise<AppointmentPayload> {
  const payload = serializeAppointmentUpdate(params);
  const response = await apiClient.patch(API_ENDPOINTS.updateAppointment(id), payload);
  return response.data as AppointmentPayload;
}

export async function deleteAppointment(id: number): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.deleteAppointment(id));
}
