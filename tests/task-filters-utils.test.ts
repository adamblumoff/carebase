import {
  isTasksPath,
  isValidType,
  normalizeTypeParam,
} from '@/app/(tabs)/tasks/task-filters-utils';

describe('task filter utils', () => {
  test('normalizeTypeParam handles strings, arrays, and invalid values', () => {
    expect(normalizeTypeParam('bill')).toBe('bill');
    expect(normalizeTypeParam(['appointment'])).toBe('appointment');
    expect(normalizeTypeParam(['unknown'])).toBeNull();
    expect(normalizeTypeParam(undefined)).toBeNull();
  });

  test('isValidType only accepts known types', () => {
    expect(isValidType('general')).toBe(true);
    expect(isValidType('all')).toBe(true);
    expect(isValidType('nope')).toBe(false);
  });

  test('isTasksPath matches tasks routes', () => {
    expect(isTasksPath('/tasks')).toBe(true);
    expect(isTasksPath('/tasks/upcoming')).toBe(true);
    expect(isTasksPath('/tasks/review')).toBe(true);
    expect(isTasksPath('/tasks/anything/else')).toBe(true);
    expect(isTasksPath('/today')).toBe(false);
  });
});
