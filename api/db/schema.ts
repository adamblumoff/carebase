import { sql } from 'drizzle-orm';
import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const taskStatus = pgEnum('task_status', [
  'todo',
  'in_progress',
  'scheduled',
  'snoozed',
  'done',
]);
export const taskType = pgEnum('task_type', ['appointment', 'bill', 'medication', 'general']);
export const reviewState = pgEnum('review_state', ['pending', 'approved', 'ignored']);
export const sourceProvider = pgEnum('source_provider', ['gmail']);
export const sourceStatus = pgEnum('source_status', ['active', 'errored', 'disconnected']);
export const themePreference = pgEnum('theme_preference', ['light', 'dark']);

export const caregivers = pgTable('caregivers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  themePreference: themePreference('theme_preference').default('light').notNull(),
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
  type: taskType('type').default('general').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatus('status').default('todo').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  reviewState: reviewState('review_state').default('approved').notNull(),
  provider: sourceProvider('provider'),
  sourceId: text('source_id'),
  sourceLink: text('source_link'),
  sender: text('sender'),
  rawSnippet: text('raw_snippet'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  syncedAt: timestamp('synced_at', { withTimezone: true }),
  ingestionId: text('ingestion_id'),
  careRecipientId: uuid('care_recipient_id').references(() => careRecipients.id),
  createdById: uuid('created_by_id').references(() => caregivers.id),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  location: text('location'),
  organizer: text('organizer'),
  attendees: text('attendees').array(),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  currency: varchar('currency', { length: 8 }),
  vendor: text('vendor'),
  referenceNumber: text('reference_number'),
  statementPeriod: text('statement_period'),
  medicationName: text('medication_name'),
  dosage: text('dosage'),
  frequency: text('frequency'),
  route: text('route'),
  nextDoseAt: timestamp('next_dose_at', { withTimezone: true }),
  prescribingProvider: text('prescribing_provider'),
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

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  caregiverId: uuid('caregiver_id')
    .notNull()
    .references(() => caregivers.id),
  provider: sourceProvider('provider').notNull(),
  accountEmail: varchar('account_email', { length: 255 }).notNull(),
  refreshToken: text('refresh_token').notNull(),
  scopes: text('scopes').array(),
  historyId: text('history_id'),
  cursor: text('cursor'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  status: sourceStatus('status').default('active').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const ingestionEvents = pgTable('ingestion_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  caregiverId: uuid('caregiver_id')
    .notNull()
    .references(() => caregivers.id),
  provider: sourceProvider('provider').notNull(),
  ingestionId: text('ingestion_id'),
  historyId: text('history_id'),
  startedAt: timestamp('started_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdCount: integer('created_count').default(0).notNull(),
  updatedCount: integer('updated_count').default(0).notNull(),
  skippedCount: integer('skipped_count').default(0).notNull(),
  errorCount: integer('error_count').default(0).notNull(),
  errorMessage: text('error_message'),
});
