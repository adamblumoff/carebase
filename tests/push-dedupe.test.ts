import fs from 'node:fs';
import path from 'node:path';

describe('push notification dedupe + wiring', () => {
  test('notification deliveries dedupe is used for digests', () => {
    const filePath = path.join(__dirname, '..', 'api', 'lib', 'notifications.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('notificationDeliveries');
    expect(source).toContain('onConflictDoNothing');
    expect(source).toContain("type: 'review_digest'");
    expect(source).toContain("type: 'appointment_today'");
  });

  test('assignment push is sent via Expo push helper', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'tasks', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('sendPushToCaregiver');
    expect(source).toContain("title: 'Task assigned to you'");
    expect(source).toContain("data: { type: 'task_assigned'");
  });
});
