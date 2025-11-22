import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'done']);

export const caregivers = pgTable('caregivers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const careRecipients = pgTable('care_recipients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatus('status').default('todo').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  careRecipientId: uuid('care_recipient_id').references(() => careRecipients.id),
  createdById: uuid('created_by_id').references(() => caregivers.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const taskAssignments = pgTable('task_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id),
  caregiverId: uuid('caregiver_id')
    .notNull()
    .references(() => caregivers.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});
