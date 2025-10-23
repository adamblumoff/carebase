import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSession, logout } from '../auth';
import { API_ENDPOINTS } from '../../config';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

describe('auth API', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('checkSession fetches session payload', async () => {
    const payload = { authenticated: true, user: { email: 'user@test.com' } };
    getMock.mockResolvedValue({ data: payload });

    const result = await checkSession();

    expect(getMock).toHaveBeenCalledWith(API_ENDPOINTS.checkSession);
    expect(result).toBe(payload);
  });

  it('logout posts to logout endpoint', async () => {
    postMock.mockResolvedValue(undefined);

    await logout();

    expect(postMock).toHaveBeenCalledWith(API_ENDPOINTS.logout);
  });
});
