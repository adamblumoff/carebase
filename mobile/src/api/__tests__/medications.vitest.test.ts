import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MedicationWithDetails } from '@carebase/shared';
import apiClient from '../client';

vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

const client = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const { fetchMedications, fetchMedication, createMedication, updateMedication } = await import('../medications');

function createMedicationPayload(): MedicationWithDetails {
  const now = new Date();
  return {
    id: 1,
    recipientId: 10,
    ownerId: 5,
    name: 'Lipitor',
    strengthValue: 5,
    strengthUnit: 'mg',
    form: 'tablet',
    instructions: 'Take daily',
    notes: null,
    prescribingProvider: 'Dr. Now',
    startDate: now,
    endDate: null,
    quantityOnHand: 30,
    refillThreshold: 10,
    preferredPharmacy: 'CVS',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doses: [],
    upcomingIntakes: [],
    refillProjection: null
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('medications API client', () => {
  it('fetches medications with query params', async () => {
    client.get.mockResolvedValueOnce({ data: { medications: [createMedicationPayload()] } });

    const response = await fetchMedications({ includeArchived: true, intakeLimit: 5, statuses: ['taken'] });

    expect(client.get).toHaveBeenCalledWith('/api/medications', {
      params: {
        includeArchived: 'true',
        intakeLimit: '5',
        statuses: 'taken'
      }
    });
    expect(response.medications).toHaveLength(1);
  });

  it('fetches medication detail', async () => {
    client.get.mockResolvedValueOnce({ data: createMedicationPayload() });

    const medication = await fetchMedication(5);
    expect(client.get).toHaveBeenCalledWith('/api/medications/5', { params: undefined });
    expect(medication.id).toBe(1);
  });

  it('creates and updates medications', async () => {
    client.post.mockResolvedValueOnce({ data: createMedicationPayload() });
    client.patch.mockResolvedValueOnce({ data: createMedicationPayload() });

    const created = await createMedication({ recipientId: 10, name: 'Lipitor' });
    expect(client.post).toHaveBeenCalledWith('/api/medications', { recipientId: 10, name: 'Lipitor' });
    expect(created.name).toBe('Lipitor');

    await updateMedication(1, { preferredPharmacy: 'Walgreens' });
    expect(client.patch).toHaveBeenCalledWith('/api/medications/1', { preferredPharmacy: 'Walgreens' });
  });
});
