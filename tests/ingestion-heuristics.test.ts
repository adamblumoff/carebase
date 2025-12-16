import {
  decideTaskRouting,
  hasBulkHeaderSignals,
  shouldTombstoneMessage,
  toHeaderMap,
} from '../api/lib/ingestionHeuristics';

import { classificationFixtures } from './fixtures/classification-fixtures';

describe('ingestion heuristics', () => {
  test('tombstones Gmail Promotions/Social/Forums categories', () => {
    expect(shouldTombstoneMessage(['INBOX', 'CATEGORY_PROMOTIONS'])).toBe(true);
    expect(shouldTombstoneMessage(['INBOX', 'CATEGORY_SOCIAL'])).toBe(true);
    expect(shouldTombstoneMessage(['INBOX', 'CATEGORY_FORUMS'])).toBe(true);
    expect(shouldTombstoneMessage(['INBOX', 'CATEGORY_UPDATES'])).toBe(false);
  });

  test('detects bulk/newsletter header signals', () => {
    const headers = toHeaderMap([
      { name: 'Subject', value: 'Weekly digest' },
      { name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' },
    ]);
    expect(hasBulkHeaderSignals(headers)).toBe(true);
  });

  test.each(classificationFixtures)('$kind $case: $name', (fixture) => {
    const decision = decideTaskRouting({
      bucket: fixture.bucket,
      classificationFailed: fixture.classificationFailed,
      modelConfidence: fixture.modelConfidence,
      parsed: fixture.parsed,
      subject: fixture.subject,
      snippet: fixture.snippet,
      bulkSignals: fixture.bulkSignals,
    });

    expect(decision.taskType).toBe(fixture.expected.taskType);
    expect(decision.reviewState).toBe(fixture.expected.reviewState);
    expect(decision.shouldDrop).toBe(fixture.expected.shouldDrop);
  });
});
