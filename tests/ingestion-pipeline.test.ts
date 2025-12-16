import { processGmailMessageToTask } from '../api/lib/ingestionPipeline';

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
      ignoredSourceIds: new Set(),
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
      ignoredSourceIds: new Set(),
      suppressedSenderDomains: new Set(['news.example.com']),
      classify,
      parse,
      now: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.action).toBe('tombstoned');
    expect(classify).not.toHaveBeenCalled();
    expect((result as any).payload?.senderDomain).toBe('news.example.com');
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

    const result = await processGmailMessageToTask({
      message: {
        id: `msg-${fixture.kind}-${fixture.case}`,
        labelIds: ['INBOX'],
        snippet: fixture.snippet,
        payload: { headers },
      },
      accountEmail: 'user@example.com',
      caregiverId: 'caregiver-1',
      ignoredSourceIds: new Set(),
      classify,
      parse,
    });

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
