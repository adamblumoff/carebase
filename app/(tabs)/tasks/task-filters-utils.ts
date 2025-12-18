export const filterOptions = ['all', 'appointment', 'bill', 'medication', 'general'] as const;
export type TaskTypeFilter = (typeof filterOptions)[number];

export const normalizeTypeParam = (value: string | string[] | undefined): TaskTypeFilter | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (filterOptions.includes(raw as TaskTypeFilter)) {
    return raw as TaskTypeFilter;
  }
  return null;
};

export const isValidType = (value: string): value is TaskTypeFilter =>
  filterOptions.includes(value as TaskTypeFilter);

export const isTasksPath = (pathname: string) =>
  pathname === '/tasks' || pathname.startsWith('/tasks/');
