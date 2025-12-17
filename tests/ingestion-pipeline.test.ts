import { processGmailMessageToTask } from '../api/lib/ingestionPipeline';
import { shouldTombstoneNonActionableMessage, toHeaderMap } from '../api/lib/ingestionHeuristics';

import { classificationFixtures } from './fixtures/classification-fixtures';

describe('ingestion pipeline', () => {
  test('tombstones Promotions category before calling classifier', async () => {
    const classify = jest.fn(async () => ({ label: 'appointments', confidence: 0.9 }) as any);
    const parse = jest.fn(() => ({
      title: 'Promo',
      type: 'general' as const,
      confidence: 0.5,
      description: 'Sale',
    }));

    const result = await processGmailMessageToTask({
      message: {
        id: 'm1',
        labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
        snippet: 'Sale',
        payload: { headers: [{ name: 'Subject', value: 'Sale' }] },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.action).toBe('tombstoned');
    expect(classify).not.toHaveBeenCalled();
  });

  test('tombstones suppressed sender domains before calling classifier', async () => {
    const classify = jest.fn(async () => ({ label: 'bills', confidence: 0.9 }) as any);
    const parse = jest.fn(() => ({
      title: 'Whatever',
      type: 'general' as const,
      confidence: 0.5,
      description: 'Sale',
    }));

    const result = await processGmailMessageToTask({
      message: {
        id: 'm2',
        labelIds: ['INBOX'],
        snippet: 'Sale',
        payload: {
          headers: [
            { name: 'Subject', value: 'Sale' },
            { name: 'From', value: 'Promo <promo@news.example.com>' },
          ],
        },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(),
      suppressedSenderDomains: new Set(['news.example.com']),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.action).toBe('tombstoned');
    expect(classify).not.toHaveBeenCalled();
    expect((result as any).payload?.senderDomain).toBe('news.example.com');
  });

  test('tombstones bulk marketing without evidence before calling classifier', async () => {
    const classify = jest.fn(async () => ({ label: 'needs_review', confidence: 0.5 }) as any);
    const parse = jest.fn(() => ({
      title: 'Appointment specials',
      type: 'general' as const,
      confidence: 0.35,
      description: 'Limited time offer. Save 25% off.',
      startAt: null,
      location: null,
      organizer: null,
      amount: null,
      dueAt: null,
      dosage: null,
      frequency: null,
      prescribingProvider: null,
    }));

    const result = await processGmailMessageToTask({
      message: {
        id: 'm3',
        labelIds: ['INBOX'],
        snippet: 'Limited time offer. Save 25% off.',
        payload: {
          headers: [
            { name: 'Subject', value: 'Appointment specials — 25% off this week' },
            { name: 'From', value: 'Deals <deals@example.com>' },
            { name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' },
          ],
        },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.action).toBe('tombstoned');
    expect(classify).not.toHaveBeenCalled();
    expect((result as any).payload?.reviewState).toBe('ignored');
  });

  test('does not tombstone bulk email when there is hard evidence', async () => {
    const classify = jest.fn(async () => ({ label: 'appointments', confidence: 0.9 }) as any);
    const parse = jest.fn(() => ({
      title: 'Appointment confirmed',
      type: 'appointment' as const,
      confidence: 0.9,
      description: 'Your appointment is confirmed for Jan 21 at 2:30 PM at 123 Main St.',
      startAt: new Date('2026-01-21T14:30:00Z'),
      location: '123 Main St',
      organizer: 'Example Health',
      amount: null,
      dueAt: null,
      dosage: null,
      frequency: null,
      prescribingProvider: null,
    }));

    const result = await processGmailMessageToTask({
      message: {
        id: 'm4',
        labelIds: ['INBOX'],
        snippet: 'Your appointment is confirmed for Jan 21 at 2:30 PM at 123 Main St.',
        payload: {
          headers: [
            {
              name: 'Subject',
              value: 'Appointment confirmed: Dr. Patel — Tue Jan 21, 2026 2:30 PM',
            },
            { name: 'From', value: 'Example Health <no-reply@examplehealth.com>' },
            { name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' },
          ],
        },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.action).toBe('upsert');
    expect(classify).toHaveBeenCalled();
  });

  test('strips angle brackets from Message-ID before ignore checks', async () => {
    const classify = jest.fn(async () => ({ label: 'appointments', confidence: 0.9 }) as any);
    const parse = jest.fn(() => ({
      title: 'Ignored',
      type: 'general' as const,
      confidence: 0.5,
      description: 'Ignored',
    }));

    const result = await processGmailMessageToTask({
      message: {
        id: 'm5',
        labelIds: ['INBOX'],
        snippet: 'Ignored',
        payload: {
          headers: [
            { name: 'Subject', value: 'Ignored' },
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'Message-ID', value: ' <abc123@example.com> ' },
          ],
        },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(['abc123@example.com']),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result).toEqual({ action: 'skipped_ignored', id: 'm5' });
    expect(classify).not.toHaveBeenCalled();
  });

  test.each(classificationFixtures)('$kind $case: $name', async (fixture) => {
    const classify = jest.fn(async () => {
      if (fixture.classificationFailed) {
        return { error: new Error('classifier failed') } as any;
      }
      return { label: fixture.bucket, confidence: fixture.modelConfidence ?? 0 } as any;
    });

    const parse = jest.fn(() => fixture.parsed as any);

    const headers = [
      { name: 'Subject', value: fixture.subject },
      { name: 'From', value: 'sender@example.com' },
    ];
    if (fixture.bulkSignals) {
      headers.push({ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' });
    }

    const shouldTombstone =
      shouldTombstoneNonActionableMessage({
        subject: fixture.subject,
        snippet: fixture.snippet,
        headerMap: toHeaderMap(headers),
        bulkSignals: fixture.bulkSignals,
        parsed: fixture.parsed as any,
      }).shouldTombstone === true;

    const result = await processGmailMessageToTask({
      message: {
        id: `msg-${fixture.kind}-${fixture.case}`,
        labelIds: ['INBOX'],
        snippet: fixture.snippet,
        payload: { headers },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      careRecipientId: 'recipient-1',
      ignoredExternalIds: new Set(),
      classify,
      parse,
    });

    if (shouldTombstone) {
      expect(result.action).toBe('tombstoned');
      expect(classify).not.toHaveBeenCalled();
      return;
    }

    if (fixture.expected.shouldDrop) {
      expect(result.action).toBe('skipped_low_confidence');
      return;
    }

    expect(result.action).toBe('upsert');
    if (result.action !== 'upsert') return;

    expect(result.payload.type).toBe(fixture.expected.taskType);
    expect(result.payload.reviewState).toBe(fixture.expected.reviewState);
  });
});
