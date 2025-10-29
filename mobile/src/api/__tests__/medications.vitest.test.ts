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

const {
  fetchMedications,
  fetchMedication,
  createMedication,
  updateMedication,
  archiveMedication,
  unarchiveMedication,
  createMedicationDose,
  updateMedicationDose,
  deleteMedicationDose,
  recordMedicationIntake,
  updateMedicationIntakeStatus,
  setMedicationRefillProjection,
  clearMedicationRefillProjection
} = await import('../medications');

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

    const response = await fetchMedications({
      includeArchived: true,
      intakeLimit: 5,
      intakeLookbackDays: 3,
      statuses: ['taken', 'skipped']
    });

    expect(client.get).toHaveBeenCalledWith('/api/medications', {
      params: {
        includeArchived: 'true',
        intakeLimit: '5',
        intakeLookbackDays: '3',
        statuses: 'taken,skipped'
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

  it('archives and unarchives medications', async () => {
    client.patch.mockResolvedValue({ data: createMedicationPayload() });

    await archiveMedication(2);
    expect(client.patch).toHaveBeenCalledWith('/api/medications/2/archive');

    await unarchiveMedication(2);
    expect(client.patch).toHaveBeenCalledWith('/api/medications/2/unarchive');
  });

  it('manages medication doses', async () => {
    client.post.mockResolvedValue({ data: createMedicationPayload() });
    client.patch.mockResolvedValue({ data: createMedicationPayload() });
    client.delete.mockResolvedValue({ data: createMedicationPayload() });

    await createMedicationDose(1, { label: 'Morning', timeOfDay: '08:00', timezone: 'America/Chicago' });
    expect(client.post).toHaveBeenCalledWith('/api/medications/1/doses', {
      label: 'Morning',
      timeOfDay: '08:00',
      timezone: 'America/Chicago'
    });

    await updateMedicationDose(1, 9, { label: 'Evening', timeOfDay: '20:00', timezone: 'America/New_York' });
    expect(client.patch).toHaveBeenCalledWith('/api/medications/1/doses/9', {
      label: 'Evening',
      timeOfDay: '20:00',
      timezone: 'America/New_York'
    });

    await deleteMedicationDose(1, 9);
    expect(client.delete).toHaveBeenCalledWith('/api/medications/1/doses/9');
  });

  it('records and updates medication intakes', async () => {
    client.post.mockResolvedValue({ data: createMedicationPayload() });
    client.patch.mockResolvedValue({ data: createMedicationPayload() });

    await recordMedicationIntake(1, {
      doseId: 9,
      scheduledFor: new Date().toISOString(),
      status: 'taken'
    });
    expect(client.post).toHaveBeenCalledWith('/api/medications/1/intakes', expect.any(Object));

    await updateMedicationIntakeStatus(1, 55, 'skipped');
    expect(client.patch).toHaveBeenCalledWith('/api/medications/1/intakes/55', { status: 'skipped' });
  });

  it('sets and clears refill projections', async () => {
    client.post.mockResolvedValue({ data: createMedicationPayload() });
    client.delete.mockResolvedValue({ data: createMedicationPayload() });

    await setMedicationRefillProjection(5, '2025-05-01');
    expect(client.post).toHaveBeenCalledWith('/api/medications/5/refill', { expectedRunOutOn: '2025-05-01' });

    await clearMedicationRefillProjection(5);
    expect(client.delete).toHaveBeenCalledWith('/api/medications/5/refill');
  });
});
