import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateAppointment, deleteAppointment } from '../appointments';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

const patchMock = vi.fn();
const deleteMock = vi.fn();
const formatMock = vi.fn((date: Date) => `formatted-${date.toISOString()}`);

vi.mock('../client', () => ({
  default: {
    patch: (...args: unknown[]) => patchMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

vi.mock('../../utils/date', () => ({
  formatForPayload: (date: Date) => formatMock(date),
}));

describe('appointments API', () => {
  beforeEach(() => {
    patchMock.mockReset();
    deleteMock.mockReset();
    formatMock.mockClear();
  });

  it('serializes updates and calls PATCH endpoint', async () => {
    const id = 42;
    const start = new Date('2025-05-01T10:00:00Z');
    const end = new Date('2025-05-01T11:00:00Z');
    const response = { data: { id, summary: 'updated' } };
    patchMock.mockResolvedValue(response);

    const result = await updateAppointment(id, {
      start,
      end,
      summary: 'Visit',
      location: null,
      prepNote: '',
      assignedCollaboratorId: null,
    });

    expect(formatMock).toHaveBeenCalledWith(start);
    expect(formatMock).toHaveBeenCalledWith(end);
    expect(patchMock).toHaveBeenCalledWith(
      API_ENDPOINTS.updateAppointment(id),
      expect.objectContaining({
        startLocal: `formatted-${start.toISOString()}`,
        endLocal: `formatted-${end.toISOString()}`,
        summary: 'Visit',
        location: undefined,
        prepNote: '',
        assignedCollaboratorId: undefined,
      })
    );
    expect(result).toEqual(response.data);
  });

  it('deleteAppointment calls DELETE endpoint', async () => {
    deleteMock.mockResolvedValue(undefined);

    await deleteAppointment(10);

    expect(deleteMock).toHaveBeenCalledWith(API_ENDPOINTS.deleteAppointment(10));
  });
});
