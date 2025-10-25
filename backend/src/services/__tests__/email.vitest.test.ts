import { afterEach, describe, expect, it, vi } from 'vitest';

const digestData = {
  recipient: { display_name: 'Alex Patient' },
  appointments: [
    { summary: 'Checkup', start_local: '2025-11-01T15:00:00.000Z', location: 'Clinic', prep_note: 'Bring ID' }
  ],
  bills: [{ amount: 120.5, due_date: '2025-11-05T00:00:00.000Z', status: 'todo' }],
  planUrl: 'https://carebase.dev/plan'
};

const inviteData = {
  inviterEmail: 'owner@example.com',
  acceptUrl: 'https://carebase.dev/collaborators/accept?token=abc',
  appOpenUrl: 'carebase://invite?token=abc',
  appDownloadUrl: 'https://apps.example.com/carebase'
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
  delete process.env.INBOUND_EMAIL_DOMAIN;
});

describe('email service', () => {
  it('skips digest email when Resend is not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const module = await import('../email.js');

    const result = await module.sendDigestEmail('user@example.com', digestData);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith('Resend API key missing; skipping digest email');
  });

  it('sends digest email via Resend when API key provided', async () => {
    const sendMock = vi.fn().mockResolvedValue({ id: 'email_123' });
    const resendCtor = vi.fn(() => ({ emails: { send: sendMock } }));
    process.env.RESEND_API_KEY = 'test-key';
    process.env.INBOUND_EMAIL_DOMAIN = 'carebase.dev';

    vi.doMock('resend', () => ({ Resend: resendCtor }));
    const module = await import('../email.js');

    const result = await module.sendDigestEmail('user@example.com', digestData);

    expect(resendCtor).toHaveBeenCalledWith('test-key');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Inbox to Week <noreply@carebase.dev>',
        to: 'user@example.com',
        subject: "Alex Patient's Weekly Plan"
      })
    );
    expect(result).toEqual({ id: 'email_123' });
  });

  it('sends collaborator invite email with optional links', async () => {
    const sendMock = vi.fn().mockResolvedValue({ id: 'invite_456' });
    const resendCtor = vi.fn(() => ({ emails: { send: sendMock } }));
    process.env.RESEND_API_KEY = 'invite-key';
    vi.doMock('resend', () => ({ Resend: resendCtor }));
    const module = await import('../email.js');

    const result = await module.sendCollaboratorInviteEmail('friend@example.com', inviteData);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'friend@example.com',
        subject: 'You’re invited to Carebase'
      })
    );
    expect(result).toEqual({ id: 'invite_456' });
  });
});
