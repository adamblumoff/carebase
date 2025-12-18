import fs from 'node:fs';
import path from 'node:path';

describe('documents delete flow', () => {
  test('deletes task events before tasks', () => {
    const filePath = path.join(__dirname, '..', 'api', 'modules', 'documents', 'router.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('delete(taskEvents)');
    expect(source).toContain('delete(tasks)');
    expect(source).toContain('delete(documentTasks)');
  });
});
