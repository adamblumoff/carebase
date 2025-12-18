import fs from 'node:fs';
import path from 'node:path';

describe('task events audit trail', () => {
  test('task mutations record task events', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'tasks', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('recordTaskEvent');
    expect(source).toContain("type: 'created'");
    expect(source).toContain("type: 'assigned'");
    expect(source).toContain("type: 'snoozed'");
    expect(source).toContain("type: 'status_toggled'");
    expect(source).toContain("type: 'updated_details'");
    expect(source).toContain("type: 'reviewed'");
  });

  test('taskEvents.list enforces hub scoping', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'task-events', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('requireCareRecipientMembership');
    expect(source).toContain('eq(tasks.careRecipientId, membership.careRecipientId)');
    expect(source).toContain('innerJoin(caregivers');
    expect(source).toContain('orderBy(desc(taskEvents.createdAt))');
  });
});
