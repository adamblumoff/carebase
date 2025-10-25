import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokenMock = vi.hoisted(() => vi.fn(() => 'ics-token'));

const dbMocks = vi.hoisted(() => ({
  query: vi.fn()
}));

const planMocks = vi.hoisted(() => ({
  touchPlanForItem: vi.fn()
}));

const collaboratorMocks = vi.hoisted(() => ({
  ensureCollaboratorSchema: vi.fn()
}));

const googleMocks = vi.hoisted(() => ({
  GOOGLE_SYNC_PROJECTION: 'mock',
  ensureGoogleIntegrationSchema: vi.fn(),
  hydrateAppointmentWithGoogleSync: vi.fn((appointment) => ({ ...appointment, hydrated: true })),
  projectGoogleSyncMetadata: vi.fn(() => ({ synced: true }))
}));

const timezoneMocks = vi.hoisted(() => ({
  getDefaultTimeZone: vi.fn(() => 'America/Chicago'),
  toUtcDateFromLocalTime: vi.fn((_value: string, _timeZone: string) => new Date('2025-10-25T15:00:00.000Z')),
  formatInstantWithZone: vi.fn(() => ({ dateTime: '2025-10-25T10:00:00-05:00' }))
}));

const payloadMocks = vi.hoisted(() => ({
  toAppointmentPayload: vi.fn((appointment) => ({ id: appointment.id }))
}));

vi.mock('../shared.js', () => ({
  db: dbMocks,
  generateToken: tokenMock
}));
vi.mock('../plan.js', () => planMocks);
vi.mock('../collaborators.js', () => collaboratorMocks);
vi.mock('../google.js', () => googleMocks);
vi.mock('../../../utils/timezone.js', () => timezoneMocks);
vi.mock('../../../utils/planPayload.js', () => payloadMocks);

const {
  appointmentRowToAppointment,
  createAppointment,
  updateAppointment,
  updateAppointmentForRecipient,
  deleteAppointment
} = await import('../appointments.js');

const baseRow = {
  id: 1,
  item_id: 200,
  start_local: new Date('2025-10-25T12:00:00.000Z'),
  end_local: new Date('2025-10-25T13:00:00.000Z'),
  start_time_zone: 'America/Chicago',
  end_time_zone: 'America/Chicago',
  start_offset: '-05:00',
  end_offset: '-05:00',
  location: 'Clinic',
  prep_note: 'Bring ID',
  summary: 'Consultation',
  ics_token: 'ics-token',
  assigned_collaborator_id: null,
  created_at: new Date('2025-10-01T00:00:00.000Z')
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.query.mockResolvedValue({ rows: [baseRow], rowCount: 1 });
});

describe('appointment queries', () => {
  it('converts raw rows to domain appointments', () => {
    const appointment = appointmentRowToAppointment({ ...baseRow });
    expect(appointment).toMatchObject({
      id: 1,
      itemId: 200,
      googleSync: { synced: true }
    });
  });

  it('creates appointment and hydrates with google metadata', async () => {
    const result = await createAppointment(200, {
      startLocal: '2025-10-25T10:00:00',
      endLocal: '2025-10-25T11:00:00',
      summary: 'Consultation',
      location: 'Clinic',
      prepNote: 'Bring ID',
      startTimeZone: undefined,
      endTimeZone: undefined
    });

    expect(tokenMock).toHaveBeenCalledWith(32);
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO appointments'), expect.any(Array));
    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(200, expect.objectContaining({
      delta: expect.objectContaining({
        action: 'created',
        source: 'rest'
      })
    }));
    expect(result.hydrated).toBe(true);
  });

  it('updates appointment with custom options and queues plan delta', async () => {
    const appointment = await updateAppointment(1, 99, {
      startLocal: '2025-10-25T10:00:00',
      endLocal: '2025-10-25T11:30:00',
      summary: 'Updated',
      location: 'Clinic',
      prepNote: null,
      assignedCollaboratorId: 12,
      startTimeZone: 'America/Chicago',
      endTimeZone: null
    }, {
      mutationSource: 'api',
      queueGoogleSync: false
    });

    expect(collaboratorMocks.ensureCollaboratorSchema).toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE appointments AS a'), expect.any(Array));
    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(200, expect.objectContaining({
      queueGoogleSync: false,
      delta: expect.objectContaining({ source: 'api', action: 'updated' })
    }));
    expect(appointment.hydrated).toBe(true);
  });

  it('throws when appointment update finds no rows', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(updateAppointment(1, 99, {
      startLocal: '2025-10-25T10:00:00',
      endLocal: '2025-10-25T11:30:00'
    })).rejects.toThrow('Appointment not found');
  });

  it('updates appointments for recipient and defaults collaborator source', async () => {
    await updateAppointmentForRecipient(1, 88, {
      startLocal: '2025-10-25T10:00:00',
      endLocal: '2025-10-25T11:00:00'
    });

    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(200, expect.objectContaining({
      delta: expect.objectContaining({ source: 'collaborator' })
    }));
  });

  it('deletes appointment and synchronizes plan', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{ item_id: 200 }], rowCount: 1 });

    await deleteAppointment(5, 42);

    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(200, expect.objectContaining({
      delta: expect.objectContaining({ action: 'deleted', entityId: 5 })
    }));
  });
});
