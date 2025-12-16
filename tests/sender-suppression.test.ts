import {
  normalizeDomainInput,
  parseSenderDomain,
  shouldSuppressAfterIgnore,
  SENDER_SUPPRESSION_IGNORE_THRESHOLD,
} from '../api/lib/senderSuppression';

describe('sender suppression helpers', () => {
  test('normalizeDomainInput trims, lowercases, and strips leading @', () => {
    expect(normalizeDomainInput('  @Example.COM ')).toBe('example.com');
  });

  test('parseSenderDomain prefers explicit senderDomain', () => {
    expect(parseSenderDomain('Name <a@b.com>', 'Explicit.COM')).toBe('explicit.com');
  });

  test('parseSenderDomain extracts domain from From header', () => {
    expect(parseSenderDomain('Promo <promo@news.example.com>', null)).toBe('news.example.com');
    expect(parseSenderDomain('promo@news.example.com', null)).toBe('news.example.com');
    expect(parseSenderDomain(null, null)).toBe(null);
  });

  test('shouldSuppressAfterIgnore respects threshold', () => {
    expect(SENDER_SUPPRESSION_IGNORE_THRESHOLD).toBe(3);
    expect(shouldSuppressAfterIgnore({ currentIgnoreCount: 0, threshold: 3 })).toBe(false);
    expect(shouldSuppressAfterIgnore({ currentIgnoreCount: 1, threshold: 3 })).toBe(false);
    expect(shouldSuppressAfterIgnore({ currentIgnoreCount: 2, threshold: 3 })).toBe(true);
  });
});
