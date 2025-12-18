import { taskEventTypeValues, taskEvents } from '../db/schema';

export type TaskEventType = (typeof taskEventTypeValues)[number];

export const recordTaskEvent = async ({
  db,
  taskId,
  careRecipientId,
  actorCaregiverId,
  type,
  payload,
}: {
  db: any;
  taskId: string;
  careRecipientId: string;
  actorCaregiverId: string;
  type: TaskEventType;
  payload?: any;
}) => {
  const now = new Date();
  await db.insert(taskEvents).values({
    taskId,
    careRecipientId,
    actorCaregiverId,
    type,
    payload: payload ?? null,
    createdAt: now,
  });
};
