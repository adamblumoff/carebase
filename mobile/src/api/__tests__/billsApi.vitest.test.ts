import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteBill, markBillPaid, updateBill } from '../bills';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

const patchMock = vi.fn();
const deleteMock = vi.fn();
const postMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    patch: (...args: unknown[]) => patchMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

describe('bills API', () => {
  beforeEach(() => {
    patchMock.mockReset();
    deleteMock.mockReset();
    postMock.mockReset();
  });

  it('serializes update payload with optional fields', async () => {
    const response = { data: { id: 1 } };
    patchMock.mockResolvedValue(response);

    const result = await updateBill(1, {
      amount: 120.5,
      dueDate: '2025-01-01',
      statementDate: null,
      payUrl: null,
      status: 'paid',
      assignedCollaboratorId: null,
    });

    expect(patchMock).toHaveBeenCalledWith(
      API_ENDPOINTS.updateBill(1),
      expect.objectContaining({
        amount: 120.5,
        dueDate: '2025-01-01',
        statementDate: undefined,
        payUrl: undefined,
        status: 'paid',
        assignedCollaboratorId: undefined,
      }),
    );
    expect(result).toBe(response.data);
  });

  it('deleteBill hits delete endpoint', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteBill(5);

    expect(deleteMock).toHaveBeenCalledWith(API_ENDPOINTS.deleteBill(5));
  });

  it('markBillPaid posts and returns payload', async () => {
    const payload = { id: 7, status: 'paid' };
    postMock.mockResolvedValue({ data: payload });

    const result = await markBillPaid(7);

    expect(postMock).toHaveBeenCalledWith(API_ENDPOINTS.markBillPaid(7));
    expect(result).toBe(payload);
  });
});
