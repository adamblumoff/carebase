import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollaboratorProvider, useCollaborators } from '../CollaboratorProvider';

const fetchCollaboratorsMock = vi.fn();
const inviteCollaboratorMock = vi.fn();
const acceptInviteMock = vi.fn();

const authState: { status: 'loading' | 'signedOut' | 'signedIn'; user: { id: number } | null } = {
  status: 'signedIn',
  user: { id: 1 },
};

const useAuthMock = vi.fn(() => authState);

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../../api/collaborators', () => ({
  fetchCollaborators: () => fetchCollaboratorsMock(),
  inviteCollaborator: (email: string) => inviteCollaboratorMock(email),
  acceptCollaboratorInvite: (token: string) => acceptInviteMock(token),
}));

function Consumer({ onValue }: { onValue: (value: ReturnType<typeof useCollaborators>) => void }) {
  const ctx = useCollaborators();
  onValue(ctx);
  return null;
}

describe('CollaboratorProvider', () => {
beforeEach(() => {
  vi.clearAllMocks();
  authState.status = 'signedIn';
  authState.user = { id: 1 };
  useAuthMock.mockImplementation(() => authState);
  fetchCollaboratorsMock.mockResolvedValue([]);
});

  it('loads and sorts collaborators on mount', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockResolvedValue([
      { id: 2, email: 'zoe@test.com' },
      { id: 1, email: 'amy@test.com' },
    ]);

    render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      expect(fetchCollaboratorsMock).toHaveBeenCalled();
      const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(latest.collaborators.map((c: any) => c.email)).toEqual(['amy@test.com', 'zoe@test.com']);
      expect(latest.loading).toBe(false);
      expect(latest.error).toBeNull();
    });
  });

  it('handles 403 response by disabling invites and surfacing error', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockRejectedValue({ response: { status: 403 } });

    render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(latest.canInvite).toBe(false);
      expect(latest.error).toContain('Only the plan owner');
    });
  });

  it('resets state when auth signs out', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockResolvedValue([{ id: 1, email: 'amy@test.com' }]);

    const { rerender } = render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(latest.collaborators).toHaveLength(1);
    });

    authState.status = 'signedOut';
    useAuthMock.mockImplementation(() => authState);

    rerender(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(latest.collaborators).toEqual([]);
      expect(fetchCollaboratorsMock).toHaveBeenCalledTimes(1);
    });
  });

  it('invite updates list and clears errors', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockResolvedValue([{ id: 1, email: 'amy@test.com' }]);
    inviteCollaboratorMock.mockResolvedValue({ id: 2, email: 'zoe@test.com' });

    render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      expect(fetchCollaboratorsMock).toHaveBeenCalled();
    });

    const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
    await act(async () => {
      await latest.invite('zoe@test.com');
    });

    const afterInvite = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(afterInvite.collaborators.map((c: any) => c.email)).toEqual(['amy@test.com', 'zoe@test.com']);
    expect(afterInvite.error).toBeNull();
    expect(afterInvite.canInvite).toBe(true);
  });

  it('acceptInviteToken refreshes collaborators and returns collaborator', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockResolvedValueOnce([{ id: 1, email: 'amy@test.com' }]);
    fetchCollaboratorsMock.mockResolvedValueOnce([{ id: 1, email: 'amy@test.com' }, { id: 2, email: 'zoe@test.com' }]);
    acceptInviteMock.mockResolvedValue({ id: 2, email: 'zoe@test.com' });

    render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      expect(fetchCollaboratorsMock).toHaveBeenCalledTimes(1);
    });

    const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
    let collaborator: any;
    await act(async () => {
      collaborator = await latest.acceptInviteToken('token-123');
    });

    expect(collaborator).toEqual({ id: 2, email: 'zoe@test.com' });
    await waitFor(() => {
      expect(fetchCollaboratorsMock).toHaveBeenCalledTimes(2);
      const after = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(after.collaborators).toHaveLength(2);
    });
  });

  it('sets generic error message for unexpected failures', async () => {
    const spy = vi.fn();
    fetchCollaboratorsMock.mockRejectedValue({ response: { status: 500 } });

    render(
      <CollaboratorProvider>
        <Consumer onValue={spy} />
      </CollaboratorProvider>
    );

    await waitFor(() => {
      const latest = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(latest.error).toBe('Unable to load collaborators.');
    });
  });
});
