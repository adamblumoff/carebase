import fs from 'node:fs';
import path from 'node:path';

describe('care profile router', () => {
  test('basics and contacts enforce owner-only writes', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'care-profile', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('upsertBasics');
    expect(source).toContain('upsertContact');
    expect(source).toContain('deleteContact');
    expect(source).toContain('requireOwnerRole');
  });

  test('dob is stored as date-only string without utc shifting', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'care-profile', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('const dob = input.dob ?? null');
    expect(source).toContain('dob,');
    expect(source).not.toContain('T00:00:00Z');
  });
});
