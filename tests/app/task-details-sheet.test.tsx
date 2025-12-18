import React from 'react';
import { render } from '@testing-library/react-native';

const mockByIdQuery = jest.fn();
const mockTaskEventsQuery = jest.fn();
const mockMembershipQuery = jest.fn();
const mockTeamQuery = jest.fn();

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/lib/trpc/client', () => ({
  trpc: {
    tasks: {
      byId: {
        useQuery: (...args: any[]) => mockByIdQuery(...args),
      },
      assign: {
        useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      },
      snooze: {
        useMutation: () => ({ mutate: jest.fn(), isPending: false }),
      },
    },
    taskEvents: {
      list: {
        useQuery: (...args: any[]) => mockTaskEventsQuery(...args),
      },
    },
    careRecipients: {
      my: {
        useQuery: (...args: any[]) => mockMembershipQuery(...args),
      },
      team: {
        useQuery: (...args: any[]) => mockTeamQuery(...args),
      },
    },
  },
}));

beforeEach(() => {
  mockByIdQuery.mockReset();
  mockTaskEventsQuery.mockReset();
  mockMembershipQuery.mockReset();
  mockTeamQuery.mockReset();

  mockByIdQuery.mockReturnValue({ data: null, isFetching: false });
  mockTaskEventsQuery.mockReturnValue({ data: [], isLoading: false });
  mockMembershipQuery.mockReturnValue({
    data: { membership: { role: 'owner', caregiverId: 'caregiver-1' } },
    isLoading: false,
    isError: false,
    isSuccess: true,
  });
  mockTeamQuery.mockReturnValue({ data: [], isLoading: false });
});

test('does not fetch details for non-uuid task ids', () => {
  const TaskDetailsSheet = require('@/components/TaskDetailsSheet').TaskDetailsSheet;

  render(
    <TaskDetailsSheet
      visible
      task={{ id: 'temp-123', title: 'Draft', type: 'general', status: 'todo' }}
      onClose={() => undefined}
    />
  );

  const [, byIdOptions] = mockByIdQuery.mock.calls[0];
  const [, eventsOptions] = mockTaskEventsQuery.mock.calls[0];

  expect(byIdOptions.enabled).toBe(false);
  expect(eventsOptions.enabled).toBe(false);
});

test('fetches details for uuid task ids', () => {
  const TaskDetailsSheet = require('@/components/TaskDetailsSheet').TaskDetailsSheet;

  render(
    <TaskDetailsSheet
      visible
      task={{
        id: '11111111-1111-1111-1111-111111111111',
        title: 'Task',
        type: 'general',
        status: 'todo',
      }}
      onClose={() => undefined}
    />
  );

  const [, byIdOptions] = mockByIdQuery.mock.calls[0];
  expect(byIdOptions.enabled).toBe(true);
});
