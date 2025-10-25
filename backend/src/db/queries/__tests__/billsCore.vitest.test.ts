import { beforeEach, describe, expect, it, vi } from 'vitest';

const tokenMock = vi.hoisted(() => vi.fn(() => 'task-key'));

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
  hydrateBillWithGoogleSync: vi.fn((bill) => ({ ...bill, hydrated: true })),
  projectGoogleSyncMetadata: vi.fn(() => ({ synced: true }))
}));

const payloadMocks = vi.hoisted(() => ({
  toBillPayload: vi.fn((bill) => ({ id: bill.id }))
}));

vi.mock('../shared.js', () => ({
  db: dbMocks,
  generateToken: tokenMock
}));
vi.mock('../plan.js', () => planMocks);
vi.mock('../collaborators.js', () => collaboratorMocks);
vi.mock('../google.js', () => googleMocks);
vi.mock('../../../utils/planPayload.js', () => payloadMocks);

const {
  billRowToBill,
  createBill,
  updateBill,
  updateBillForRecipient,
  updateBillStatus,
  updateBillStatusForRecipient,
  getUpcomingBills,
  deleteBill
} = await import('../bills.js');

const baseRow = {
  id: 10,
  item_id: 300,
  statement_date: new Date('2025-09-01T00:00:00.000Z'),
  amount: '120.50',
  due_date: new Date('2025-09-30T00:00:00.000Z'),
  pay_url: 'https://pay.example.com',
  status: 'todo',
  task_key: 'task-key',
  assigned_collaborator_id: null,
  created_at: new Date('2025-08-15T00:00:00.000Z')
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.query.mockResolvedValue({ rows: [baseRow], rowCount: 1 });
});

describe('bill queries', () => {
  it('maps raw rows into bill domain objects', () => {
    expect(billRowToBill({ ...baseRow })).toMatchObject({
      id: 10,
      amount: 120.5,
      googleSync: { synced: true }
    });
  });

  it('creates bill with sanitized pay url', async () => {
    const createPayload = {
      statementDate: new Date('2025-09-01T00:00:00.000Z'),
      amount: 120.5,
      dueDate: new Date('2025-09-30T00:00:00.000Z'),
      payUrl: 'https://pay.example.com/pay?ref=1),',
      status: 'todo'
    };
    const result = await createBill(300, createPayload);

    expect(tokenMock).toHaveBeenCalledWith(16);
    const [, params] = dbMocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      300,
      createPayload.statementDate,
      createPayload.amount,
      createPayload.dueDate,
      'https://pay.example.com/pay?ref=1',
      'todo',
      'task-key'
    ]);
    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(300, expect.objectContaining({
      delta: expect.objectContaining({ action: 'created' })
    }));
    expect(result.hydrated).toBe(true);
  });

  it('updates bill with collaborator schema enforced and optional queue disable', async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{ ...baseRow, pay_url: null }],
      rowCount: 1
    });

    const bill = await updateBill(10, 42, {
      statementDate: null,
      amount: 99.99,
      dueDate: null,
      payUrl: 'http://invalid.com', // should sanitize to null
      status: 'done',
      assignedCollaboratorId: 55
    }, {
      mutationSource: 'api',
      queueGoogleSync: false
    });

    expect(collaboratorMocks.ensureCollaboratorSchema).toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE bills AS b'), expect.any(Array));
    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(300, expect.objectContaining({
      queueGoogleSync: false,
      delta: expect.objectContaining({ source: 'api', action: 'updated' })
    }));
    expect(bill.payUrl).toBeNull();
  });

  it('throws when update returns no rows', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(updateBill(10, 42, {
      statementDate: null,
      amount: 1,
      dueDate: null,
      payUrl: null,
      status: 'todo'
    })).rejects.toThrow('Bill not found');
  });

  it('updates bill status for owner and collaborator', async () => {
    await updateBillStatus(10, 42, 'done');
    await updateBillStatusForRecipient(10, 84, 'done');

    expect(planMocks.touchPlanForItem).toHaveBeenNthCalledWith(1, 300, expect.objectContaining({
      delta: expect.objectContaining({ source: 'rest' })
    }));
    expect(planMocks.touchPlanForItem).toHaveBeenNthCalledWith(2, 300, expect.objectContaining({
      delta: expect.objectContaining({ source: 'collaborator' })
    }));
  });

  it('returns upcoming bills and deletes bill with plan sync', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [baseRow, { ...baseRow, id: 11 }], rowCount: 2 });
    const bills = await getUpcomingBills(1, new Date('2025-09-01'), new Date('2025-10-01'));
    expect(bills).toHaveLength(2);

    dbMocks.query.mockResolvedValueOnce({ rows: [{ item_id: 300 }], rowCount: 1 });
    await deleteBill(10, 42);

    expect(planMocks.touchPlanForItem).toHaveBeenCalledWith(300, expect.objectContaining({
      delta: expect.objectContaining({ action: 'deleted' })
    }));
  });
});
