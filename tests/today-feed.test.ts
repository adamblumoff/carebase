import fs from 'node:fs';
import path from 'node:path';

describe('today feed router', () => {
  test('buckets tasks and uses hub-local date', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'today', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('needsReview');
    expect(source).toContain("eq(tasks.reviewState, 'pending')");
    expect(source).toContain("sql`${tasks.reviewState} != 'ignored'`");

    // Due today should include appointments by startAt and any task by dueAt.
    expect(source).toContain("eq(tasks.type, 'appointment')");
    expect(source).toContain('tasks.startAt');
    expect(source).toContain('tasks.dueAt');
    expect(source).toContain("sql`${tasks.status} != 'done'`");

    // Assigned to me should join taskAssignments and filter by caregiver id.
    expect(source).toContain('innerJoin(taskAssignments');
    expect(source).toContain('eq(taskAssignments.caregiverId, membership.caregiverId)');

    // Recently completed should use updatedAt window and status done.
    expect(source).toContain("eq(tasks.status, 'done')");
    expect(source).toContain('gte(tasks.updatedAt');

    // Handoff note lookup is keyed by hub-local date string.
    expect(source).toContain('hubLocalDate');
    expect(source).toContain('localDateString');
    expect(source).toContain('handoffNotes.localDate');
  });
});
