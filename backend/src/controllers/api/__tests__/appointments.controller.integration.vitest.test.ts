import type { Request, Response, NextFunction } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  deleteAppointmentAsOwner: vi.fn(),
  fetchAppointmentForUser: vi.fn(),
  getAppointmentContext: vi.fn(),
  updateAppointmentAsCollaborator: vi.fn(),
  updateAppointmentAsOwner: vi.fn()
}));

const validationMocks = vi.hoisted(() => ({
  validateBody: vi.fn(),
  validateParams: vi.fn()
}));

vi.mock('../../../services/appointmentService.js', () => serviceMocks);
vi.mock('../../../utils/validation.js', () => validationMocks);

const { deleteAppointmentAsOwner, fetchAppointmentForUser, getAppointmentContext, updateAppointmentAsCollaborator, updateAppointmentAsOwner } =
  serviceMocks;
const { validateBody, validateParams } = validationMocks;

const module = await import('../appointments.js');
const { getAppointment, patchAppointment, removeAppointment } = module;

function responseStub() {
  const res = {
    status: vi.fn(function (this: Response) {
      return this;
    }),
    json: vi.fn(function (this: Response) {
      return this;
    })
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };

  res.status = vi.fn((code: number) => {
    (res as any).__status = code;
    return res;
  });
  res.json = vi.fn((payload: unknown) => {
    (res as any).__json = payload;
    return res;
  });
  return res;
}

const next: NextFunction = vi.fn();
const user = { id: 20 } as any;

describe('appointment controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateParams.mockReturnValue({ id: 9 });
  });

  it('getAppointment returns appointment data', async () => {
    const res = responseStub();
    fetchAppointmentForUser.mockResolvedValueOnce({ id: 9, summary: 'Checkup' });

    await getAppointment({ user } as Request, res, next);

    expect(validateParams).toHaveBeenCalled();
    expect(fetchAppointmentForUser).toHaveBeenCalledWith(user, 9);
    expect(res.json).toHaveBeenCalledWith({ id: 9, summary: 'Checkup' });
  });

  it('patchAppointment uses owner update when context role owner', async () => {
    const res = responseStub();
    getAppointmentContext.mockResolvedValueOnce({ role: 'owner' });
    validateBody.mockReturnValueOnce({ summary: 'Updated summary' });
    updateAppointmentAsOwner.mockResolvedValueOnce({ id: 9, summary: 'Updated summary' });

    await patchAppointment({ user, body: {} } as Request, res, next);

    expect(updateAppointmentAsOwner).toHaveBeenCalledWith(user, 9, { summary: 'Updated summary' });
    expect(res.json).toHaveBeenCalledWith({ id: 9, summary: 'Updated summary' });
  });

  it('patchAppointment uses collaborator update when context role collaborator', async () => {
    const res = responseStub();
    getAppointmentContext.mockResolvedValueOnce({ role: 'collaborator' });
    validateBody.mockReturnValueOnce({ prepNote: 'Bring documents' });
    updateAppointmentAsCollaborator.mockResolvedValueOnce({ id: 9, prepNote: 'Bring documents' });

    await patchAppointment({ user, body: {} } as Request, res, next);

    expect(updateAppointmentAsCollaborator).toHaveBeenCalledWith(user, 9, 'Bring documents');
    expect(res.json).toHaveBeenCalledWith({ id: 9, prepNote: 'Bring documents' });
  });

  it('removeAppointment deletes appointment as owner', async () => {
    const res = responseStub();

    await removeAppointment({ user } as Request, res, next);

    expect(deleteAppointmentAsOwner).toHaveBeenCalledWith(user, 9);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('handlers return 401 when user missing', async () => {
    const res = responseStub();
    await getAppointment({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
