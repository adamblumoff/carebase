import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
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
export const careRecipientRole = pgEnum('care_recipient_role', ['owner', 'viewer']);
export const careRecipientTimezoneSource = pgEnum('care_recipient_timezone_source', [
  'unset',
  'owner_device',
  'explicit',
]);
export const pushPlatform = pgEnum('push_platform', ['ios', 'android', 'web']);
export const notificationType = pgEnum('notification_type', [
  'task_assigned',
  'review_digest',
  'appointment_today',
]);
export const taskEventTypeValues = [
  'created',
  'reviewed',
  'status_toggled',
  'assigned',
  'snoozed',
  'updated_details',
] as const;
export const taskEventType = pgEnum('task_event_type', taskEventTypeValues);
export const documentStatus = pgEnum('document_status', [
  'uploaded',
  'processing',
  'ready',
  'error',
]);

export const caregivers = pgTable('caregivers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  themePreference: themePreference('theme_preference').default('light').notNull(),
  timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const careRecipients = pgTable('care_recipients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  timezone: varchar('timezone', { length: 64 }).default('UTC').notNull(),
  timezoneSource: careRecipientTimezoneSource('timezone_source').default('unset').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const careProfileBasics = pgTable(
  'care_profile_basics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    fullName: text('full_name').notNull(),
    dob: date('dob'),
    notes: text('notes'),
    updatedByCaregiverId: uuid('updated_by_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    careRecipientUnique: uniqueIndex('care_profile_basics_care_recipient_uidx').on(
      table.careRecipientId
    ),
  })
);

export const careProfileContacts = pgTable(
  'care_profile_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    name: text('name').notNull(),
    relationship: text('relationship'),
    phone: text('phone'),
    email: varchar('email', { length: 255 }),
    address: text('address'),
    isEmergency: boolean('is_emergency').default(false).notNull(),
    updatedByCaregiverId: uuid('updated_by_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    careRecipientIdx: index('care_profile_contacts_care_recipient_idx').on(
      table.careRecipientId
    ),
  })
);

export const careRecipientMemberships = pgTable(
  'care_recipient_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    caregiverId: uuid('caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    role: careRecipientRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    caregiverUnique: uniqueIndex('care_recipient_memberships_caregiver_uidx').on(table.caregiverId),
    careRecipientCaregiverUnique: uniqueIndex(
      'care_recipient_memberships_care_recipient_caregiver_uidx'
    ).on(table.careRecipientId, table.caregiverId),
  })
);

export const careInvitations = pgTable(
  'care_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    token: varchar('token', { length: 64 }).notNull(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    invitedByCaregiverId: uuid('invited_by_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    invitedEmail: varchar('invited_email', { length: 255 }),
    role: careRecipientRole('role').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByCaregiverId: uuid('used_by_caregiver_id').references(() => caregivers.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('care_invitations_token_uidx').on(table.token),
  })
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: taskType('type').default('general').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').default('todo').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    reviewState: reviewState('review_state').default('approved').notNull(),
    provider: sourceProvider('provider'),
    externalId: text('external_id'),
    sourceId: text('source_id'),
    sourceLink: text('source_link'),
    sender: text('sender'),
    senderDomain: text('sender_domain'),
    rawSnippet: text('raw_snippet'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    ingestionId: text('ingestion_id'),
    ingestionDebug: jsonb('ingestion_debug'),
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
  },
  (table) => ({
    externalUnique: uniqueIndex('tasks_care_recipient_provider_external_uidx').on(
      table.careRecipientId,
      table.provider,
      table.externalId
    ),
    careRecipientCreatedIdx: index('tasks_care_recipient_created_at_idx').on(
      table.careRecipientId,
      table.createdAt
    ),
    careRecipientReviewIdx: index('tasks_care_recipient_review_state_idx').on(
      table.careRecipientId,
      table.reviewState
    ),
    careRecipientStatusUpdatedIdx: index('tasks_care_recipient_status_updated_at_idx').on(
      table.careRecipientId,
      table.status,
      table.updatedAt
    ),
    careRecipientStartIdx: index('tasks_care_recipient_start_at_idx').on(
      table.careRecipientId,
      table.startAt
    ),
    careRecipientDueIdx: index('tasks_care_recipient_due_at_idx').on(
      table.careRecipientId,
      table.dueAt
    ),
  })
);

export const taskAssignments = pgTable(
  'task_assignments',
  {
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
  },
  (table) => ({
    taskUnique: uniqueIndex('task_assignments_task_uidx').on(table.taskId),
    caregiverIdx: index('task_assignments_caregiver_id_idx').on(table.caregiverId),
  })
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caregiverId: uuid('caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    token: text('token').notNull(),
    platform: pushPlatform('platform').notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('push_tokens_token_uidx').on(table.token),
    caregiverActiveIdx: index('push_tokens_caregiver_disabled_at_idx').on(
      table.caregiverId,
      table.disabledAt
    ),
  })
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caregiverId: uuid('caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    type: notificationType('type').notNull(),
    key: varchar('key', { length: 64 }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    unique: uniqueIndex('notification_deliveries_caregiver_type_key_uidx').on(
      table.caregiverId,
      table.type,
      table.key
    ),
  })
);

export const handoffNotes = pgTable(
  'handoff_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    localDate: varchar('local_date', { length: 10 }).notNull(),
    body: text('body').notNull(),
    updatedByCaregiverId: uuid('updated_by_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    unique: uniqueIndex('handoff_notes_care_recipient_local_date_uidx').on(
      table.careRecipientId,
      table.localDate
    ),
  })
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    uploadedByCaregiverId: uuid('uploaded_by_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    filename: text('filename').notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    pageCount: integer('page_count'),
    status: documentStatus('status').default('uploaded').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    careRecipientIdx: index('documents_care_recipient_idx').on(table.careRecipientId),
    storageKeyUnique: uniqueIndex('documents_storage_key_uidx').on(table.storageKey),
    statusIdx: index('documents_status_idx').on(table.status),
  })
);

export const documentTasks = pgTable(
  'document_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    documentTaskUnique: uniqueIndex('document_tasks_document_task_uidx').on(
      table.documentId,
      table.taskId
    ),
    documentIdx: index('document_tasks_document_idx').on(table.documentId),
  })
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    careRecipientId: uuid('care_recipient_id')
      .notNull()
      .references(() => careRecipients.id),
    actorCaregiverId: uuid('actor_caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    type: taskEventType('type').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    taskCreatedIdx: index('task_events_task_id_created_at_idx').on(table.taskId, table.createdAt),
  })
);

export const sources = pgTable(
  'sources',
  {
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
    isPrimary: boolean('is_primary').default(false).notNull(),
    errorMessage: text('error_message'),
    watchId: text('watch_id'),
    watchExpiration: timestamp('watch_expiration', { withTimezone: true }),
    calendarChannelId: text('calendar_channel_id'),
    calendarResourceId: text('calendar_resource_id'),
    calendarSyncToken: text('calendar_sync_token'),
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    caregiverProviderEmailIdx: uniqueIndex('sources_caregiver_provider_email_idx').on(
      table.caregiverId,
      table.provider,
      table.accountEmail
    ),
  })
);

export const ingestionEvents = pgTable('ingestion_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id),
  caregiverId: uuid('caregiver_id')
    .notNull()
    .references(() => caregivers.id),
  provider: sourceProvider('provider').notNull(),
  type: text('type').default('gmail').notNull(),
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
  durationMs: integer('duration_ms'),
});

export const senderSuppressions = pgTable(
  'sender_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caregiverId: uuid('caregiver_id')
      .notNull()
      .references(() => caregivers.id),
    provider: sourceProvider('provider').notNull(),
    senderDomain: varchar('sender_domain', { length: 255 }).notNull(),
    ignoreCount: integer('ignore_count').default(0).notNull(),
    suppressed: boolean('suppressed').default(false).notNull(),
    lastIgnoredAt: timestamp('last_ignored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => ({
    caregiverProviderDomainIdx: uniqueIndex(
      'sender_suppressions_caregiver_provider_domain_uidx'
    ).on(table.caregiverId, table.provider, table.senderDomain),
  })
);
