import type { BillPayload, BillUpdateRequest, BillStatus } from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config';

export interface UpdateBillParams {
  amount?: number | null;
  dueDate?: string | null;
  statementDate?: string | null;
  payUrl?: string | null;
  status?: BillStatus;
  assignedCollaboratorId?: number | null;
}

const serializeBillUpdate = (params: UpdateBillParams): BillUpdateRequest => {
  const payload: BillUpdateRequest = {};

  if (params.amount !== undefined) {
    payload.amount = params.amount ?? undefined;
  }
  if (params.dueDate !== undefined) {
    payload.dueDate = params.dueDate ?? undefined;
  }
  if (params.statementDate !== undefined) {
    payload.statementDate = params.statementDate ?? undefined;
  }
  if (params.payUrl !== undefined) {
    payload.payUrl = params.payUrl ?? undefined;
  }
  if (params.status !== undefined) {
    payload.status = params.status;
  }
  if (params.assignedCollaboratorId !== undefined) {
    payload.assignedCollaboratorId = params.assignedCollaboratorId ?? undefined;
  }

  return payload;
};

export async function updateBill(id: number, params: UpdateBillParams): Promise<BillPayload> {
  const payload = serializeBillUpdate(params);
  const response = await apiClient.patch(API_ENDPOINTS.updateBill(id), payload);
  return response.data as BillPayload;
}

export async function deleteBill(id: number): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.deleteBill(id));
}

export async function markBillPaid(id: number): Promise<BillPayload> {
  const response = await apiClient.post(API_ENDPOINTS.markBillPaid(id));
  return response.data as BillPayload;
}
