import fs from 'node:fs';
import path from 'node:path';

describe('OAuth callback primary inbox guard', () => {
  test('does not decide primary based on caregiver-local gmail sources', () => {
    const filePath = path.join(__dirname, '..', 'api', 'index.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    const start = source.indexOf('const shouldBecomePrimary');
    const end = source.indexOf('await db', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const block = source.slice(start, end);
    // Regression guard: primary selection must be based on hub-level existing primary,
    // not "first gmail for this caregiver".
    expect(block).not.toContain('anyForCaregiver');
    expect(block).not.toContain('sources.caregiverId');
  });
});
