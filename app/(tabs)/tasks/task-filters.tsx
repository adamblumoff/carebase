import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  filterOptions,
  isTasksPath,
  isValidType,
  normalizeTypeParam,
  type TaskTypeFilter,
} from './task-filters-utils';

export { filterOptions, type TaskTypeFilter } from './task-filters-utils';

const STORAGE_KEY = 'tasks:filter:type';

type TaskFiltersState = {
  selectedType: TaskTypeFilter;
  setSelectedType: (next: TaskTypeFilter) => void;
};

const TaskFiltersContext = createContext<TaskFiltersState | null>(null);

export const TaskFiltersProvider = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();
  const [selectedType, setSelectedType] = useState<TaskTypeFilter>('all');
  const [isHydrated, setIsHydrated] = useState(false);
  const initialParamRef = useRef<TaskTypeFilter | null>(null);

  const paramType = useMemo(
    () => normalizeTypeParam(searchParams.type as string | string[] | undefined),
    [searchParams.type]
  );

  if (initialParamRef.current === null) {
    initialParamRef.current = paramType ?? null;
  }

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!isMounted) return;
        if (initialParamRef.current) {
          setSelectedType(initialParamRef.current);
        } else if (stored && isValidType(stored)) {
          setSelectedType(stored);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!paramType) return;
    setSelectedType((current) => (current === paramType ? current : paramType));
  }, [paramType]);

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, selectedType).catch(() => {});
    if (!isTasksPath(pathname)) return;

    const nextParam = selectedType === 'all' ? undefined : selectedType;
    const currentParam = paramType ?? undefined;
    if (currentParam === nextParam) return;

    router.setParams({ type: nextParam });
  }, [isHydrated, paramType, pathname, router, selectedType]);

  const value = useMemo(() => ({ selectedType, setSelectedType }), [selectedType]);

  return <TaskFiltersContext.Provider value={value}>{children}</TaskFiltersContext.Provider>;
};

export const useTaskFilters = () => {
  const context = useContext(TaskFiltersContext);
  if (!context) {
    throw new Error('useTaskFilters must be used within TaskFiltersProvider');
  }
  return context;
};
