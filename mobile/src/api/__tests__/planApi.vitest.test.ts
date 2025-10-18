import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPlan, fetchPlanVersion } from '../plan';
import { API_ENDPOINTS } from '../../config';

const getMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

describe('plan API', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('fetchPlan returns plan payload', async () => {
    const plan = { planVersion: 3 };
    getMock.mockResolvedValue({ data: plan });

    const result = await fetchPlan();

    expect(getMock).toHaveBeenCalledWith(API_ENDPOINTS.getPlan);
    expect(result).toBe(plan);
  });

  it('fetchPlanVersion returns version number or 0 fallback', async () => {
    getMock
      .mockResolvedValueOnce({ data: { planVersion: 5 } })
      .mockResolvedValueOnce({ data: {} });

    const first = await fetchPlanVersion();
    const second = await fetchPlanVersion();

    expect(getMock).toHaveBeenNthCalledWith(1, API_ENDPOINTS.getPlanVersion);
    expect(getMock).toHaveBeenNthCalledWith(2, API_ENDPOINTS.getPlanVersion);
    expect(first).toBe(5);
    expect(second).toBe(0);
  });
});
