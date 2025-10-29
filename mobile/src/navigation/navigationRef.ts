import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type PendingNavigation = {
  name: keyof RootStackParamList;
  params?: RootStackParamList[keyof RootStackParamList];
};

const pendingNavigations: PendingNavigation[] = [];

export function navigate<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params?: RootStackParamList[RouteName]
): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
    return;
  }

  pendingNavigations.push({ name, params });
}

export function flushNavigationQueue(): void {
  if (!navigationRef.isReady()) {
    return;
  }

  while (pendingNavigations.length > 0) {
    const next = pendingNavigations.shift();
    if (!next) continue;
    try {
      navigationRef.navigate(
        next.name as keyof RootStackParamList,
        next.params as RootStackParamList[keyof RootStackParamList]
      );
    } catch (error) {
      console.warn('Navigation action failed', error);
    }
  }
}
