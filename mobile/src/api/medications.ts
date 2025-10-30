import type {
  MedicationCreateRequest,
  MedicationDoseInput,
  MedicationDoseUpdateInput,
  MedicationIntakeRecordRequest,
  MedicationIntakeStatus,
  MedicationUpdateRequest,
  MedicationWithDetails,
  MedicationDeleteResponse,
  MedicationIntakeDeleteResponse
} from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config/apiEndpoints';

export interface MedicationListResponse {
  medications: MedicationWithDetails[];
}

export interface MedicationListOptions {
  includeArchived?: boolean;
  intakeLimit?: number;
  intakeLookbackDays?: number;
  statuses?: MedicationIntakeStatus[];
}

function buildQueryParams(options: MedicationListOptions | undefined): Record<string, string> | undefined {
  if (!options) return undefined;
  const params: Record<string, string> = {};
  if (options.includeArchived !== undefined) {
    params.includeArchived = String(options.includeArchived);
  }
  if (options.intakeLimit !== undefined) {
    params.intakeLimit = String(options.intakeLimit);
  }
  if (options.intakeLookbackDays !== undefined) {
    params.intakeLookbackDays = String(options.intakeLookbackDays);
  }
  if (options.statuses && options.statuses.length > 0) {
    params.statuses = options.statuses.join(',');
  }
  return params;
}

export async function fetchMedications(options?: MedicationListOptions): Promise<MedicationListResponse> {
  const params = buildQueryParams(options);
  const response = await apiClient.get(API_ENDPOINTS.medications.list, { params });
  return response.data as MedicationListResponse;
}

export async function fetchMedication(id: number, options?: MedicationListOptions): Promise<MedicationWithDetails> {
  const params = buildQueryParams(options);
  const response = await apiClient.get(API_ENDPOINTS.medications.detail(id), { params });
  return response.data as MedicationWithDetails;
}

export async function createMedication(payload: MedicationCreateRequest): Promise<MedicationWithDetails> {
  const response = await apiClient.post(API_ENDPOINTS.medications.create, payload);
  return response.data as MedicationWithDetails;
}

export async function updateMedication(id: number, payload: MedicationUpdateRequest): Promise<MedicationWithDetails> {
  const response = await apiClient.patch(API_ENDPOINTS.medications.update(id), payload);
  return response.data as MedicationWithDetails;
}

export async function archiveMedication(id: number): Promise<MedicationWithDetails> {
  const response = await apiClient.patch(API_ENDPOINTS.medications.archive(id));
  return response.data as MedicationWithDetails;
}

export async function unarchiveMedication(id: number): Promise<MedicationWithDetails> {
  const response = await apiClient.patch(API_ENDPOINTS.medications.unarchive(id));
  return response.data as MedicationWithDetails;
}

export async function createMedicationDose(id: number, dose: MedicationDoseInput): Promise<MedicationWithDetails> {
  const response = await apiClient.post(API_ENDPOINTS.medications.doses(id), dose);
  return response.data as MedicationWithDetails;
}

export async function updateMedicationDose(
  id: number,
  doseId: number,
  dose: MedicationDoseUpdateInput
): Promise<MedicationWithDetails> {
  const response = await apiClient.patch(API_ENDPOINTS.medications.dose(id, doseId), dose);
  return response.data as MedicationWithDetails;
}

export async function deleteMedicationDose(id: number, doseId: number): Promise<MedicationWithDetails> {
  const response = await apiClient.delete(API_ENDPOINTS.medications.dose(id, doseId));
  return response.data as MedicationWithDetails;
}

export async function deleteMedication(id: number): Promise<MedicationDeleteResponse> {
  const response = await apiClient.delete(API_ENDPOINTS.medications.remove(id));
  return response.data as MedicationDeleteResponse;
}

export async function recordMedicationIntake(
  id: number,
  payload: MedicationIntakeRecordRequest
): Promise<MedicationWithDetails> {
  const response = await apiClient.post(API_ENDPOINTS.medications.intakes(id), payload);
  return response.data as MedicationWithDetails;
}

export async function deleteMedicationIntake(
  id: number,
  intakeId: number
): Promise<MedicationIntakeDeleteResponse> {
  const response = await apiClient.delete(API_ENDPOINTS.medications.intake(id, intakeId));
  return response.data as MedicationIntakeDeleteResponse;
}

export async function updateMedicationIntakeStatus(
  id: number,
  intakeId: number,
  status: MedicationIntakeStatus
): Promise<MedicationWithDetails> {
  const response = await apiClient.patch(API_ENDPOINTS.medications.intake(id, intakeId), { status });
  return response.data as MedicationWithDetails;
}

export async function setMedicationRefillProjection(
  id: number,
  expectedRunOutOn: string | null
): Promise<MedicationWithDetails> {
  const response = await apiClient.post(API_ENDPOINTS.medications.refill(id), { expectedRunOutOn });
  return response.data as MedicationWithDetails;
}

export async function clearMedicationRefillProjection(id: number): Promise<MedicationWithDetails> {
  const response = await apiClient.delete(API_ENDPOINTS.medications.refill(id));
  return response.data as MedicationWithDetails;
}
