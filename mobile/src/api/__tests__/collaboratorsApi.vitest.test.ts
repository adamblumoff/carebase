import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptCollaboratorInvite,
  fetchCollaborators,
  inviteCollaborator,
} from '../collaborators';
import { API_ENDPOINTS } from '../../config';

const getMock = vi.fn();
const postMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}));

describe('collaborators API', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('fetchCollaborators returns list or empty array', async () => {
    getMock
      .mockResolvedValueOnce({ data: { collaborators: [{ id: 1, email: 'a@test.com' }] } })
      .mockResolvedValueOnce({ data: {} });

    const first = await fetchCollaborators();
    const second = await fetchCollaborators();

    expect(getMock).toHaveBeenNthCalledWith(1, API_ENDPOINTS.collaborators.list);
    expect(getMock).toHaveBeenNthCalledWith(2, API_ENDPOINTS.collaborators.list);
    expect(first).toEqual([{ id: 1, email: 'a@test.com' }]);
    expect(second).toEqual([]);
  });

  it('inviteCollaborator posts email and role', async () => {
    const collaborator = { id: 2, email: 'b@test.com' };
    postMock.mockResolvedValue({ data: { collaborator } });

    const result = await inviteCollaborator('b@test.com', 'owner');

    expect(postMock).toHaveBeenCalledWith(API_ENDPOINTS.collaborators.invite, {
      email: 'b@test.com',
      role: 'owner',
    });
    expect(result).toBe(collaborator);
  });

  it('acceptCollaboratorInvite posts token and returns collaborator', async () => {
    const collaborator = { id: 3, email: 'c@test.com' };
    postMock.mockResolvedValue({ data: { collaborator } });

    const result = await acceptCollaboratorInvite('token-123');

    expect(postMock).toHaveBeenCalledWith(API_ENDPOINTS.collaborators.accept, { token: 'token-123' });
    expect(result).toBe(collaborator);
  });
});
