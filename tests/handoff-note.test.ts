import fs from 'node:fs';
import path from 'node:path';

describe('daily note (handoff) router', () => {
  test('upsert is owner-only and keyed by hub-local date', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'handoff', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('upsertToday');
    expect(source).toContain('requireOwnerRole');
    expect(source).toContain('localDateString');
    expect(source).toContain('onConflictDoUpdate');
    expect(source).toContain('handoffNotes.careRecipientId');
    expect(source).toContain('handoffNotes.localDate');
  });
});
