import fs from 'node:fs';
import path from 'node:path';

describe('task scoping backfill', () => {
  test('careRecipients router backfills tasks with null careRecipientId', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'care-recipients', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('Backfill');
    expect(source).toContain('.update(tasks)');
    expect(source).toContain('isNull(tasks.careRecipientId)');
    expect(source).toContain('eq(tasks.createdById, caregiverId)');
  });
});
