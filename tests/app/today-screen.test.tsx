import React from 'react';
import { render } from '@testing-library/react-native';

const mockTodayFeedQuery = jest.fn();
const mockMyHubQuery = jest.fn();

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-keyboard-aware-scroll-view', () => ({
  KeyboardAwareScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('nativewind', () => ({
  useColorScheme: () => ({ colorScheme: 'light' }),
}));

jest.mock('@/components/Container', () => ({
  Container: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/TaskDetailsSheet', () => ({
  TaskDetailsSheet: () => null,
}));

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      today: { feed: { invalidate: jest.fn() } },
      tasks: {
        stats: { invalidate: jest.fn() },
        listThin: { invalidate: jest.fn() },
        upcoming: { invalidate: jest.fn() },
      },
    }),
    today: {
      feed: {
        useQuery: (...args: any[]) => mockTodayFeedQuery(...args),
      },
    },
    careRecipients: {
      my: {
        useQuery: (...args: any[]) => mockMyHubQuery(...args),
      },
    },
    tasks: {
      toggleStatus: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) },
      review: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) },
    },
    handoff: {
      upsertToday: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) },
    },
  },
}));

beforeEach(() => {
  mockTodayFeedQuery.mockReset();
  mockMyHubQuery.mockReset();

  mockMyHubQuery.mockReturnValue({
    data: { membership: { role: 'owner' } },
    isLoading: false,
    isError: false,
    isSuccess: true,
  });

  mockTodayFeedQuery.mockReturnValue({
    data: {
      hubLocalDate: '2026-01-01',
      hubTimezone: 'America/Chicago',
      handoff: { body: 'Test note' },
      needsReview: [],
      dueToday: [],
      upcoming: [],
      assignedToMe: [],
      recentlyCompleted: [],
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: jest.fn(),
  });
});

test('renders Today sections and daily note', () => {
  // Import after mocks so nativewind/vector-icons don't load their real implementations in Jest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TodayScreen = require('@/app/(tabs)/index').default;
  const screen = render(<TodayScreen />);

  expect(screen.getByText('Daily note')).toBeTruthy();
  expect(screen.getByText('Test note')).toBeTruthy();

  expect(screen.getByText('Needs review')).toBeTruthy();
  expect(screen.getByText('Due today')).toBeTruthy();
  expect(screen.getByText('Upcoming (7 days)')).toBeTruthy();
  expect(screen.getByText('Assigned to me')).toBeTruthy();
  expect(screen.getByText('Recently completed (24h)')).toBeTruthy();

  // Regression guard: Today should only mount its two queries once.
  expect(mockTodayFeedQuery).toHaveBeenCalledTimes(1);
  expect(mockMyHubQuery).toHaveBeenCalledTimes(1);
});
