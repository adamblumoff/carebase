-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  google_id VARCHAR(255) UNIQUE,
  legacy_google_id VARCHAR(255) UNIQUE,
  clerk_user_id VARCHAR(255) UNIQUE,
  password_reset_required BOOLEAN NOT NULL DEFAULT false,
  forwarding_address VARCHAR(255) NOT NULL UNIQUE,
  plan_secret VARCHAR(64) NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 0,
  plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legacy_google_id VARCHAR(255) UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR(255) UNIQUE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE users
  ALTER COLUMN google_id DROP NOT NULL;

UPDATE users
  SET legacy_google_id = google_id
  WHERE google_id IS NOT NULL
    AND legacy_google_id IS DISTINCT FROM google_id;

CREATE TABLE IF NOT EXISTS users_mfa_status (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(10) NOT NULL CHECK (status IN ('pending', 'grace', 'required', 'enrolled')),
  last_transition_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  grace_expires_at TIMESTAMP
);

-- Recipients table (care recipients)
CREATE TABLE IF NOT EXISTS recipients (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sources table (email or upload intake)
CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('email', 'upload')),
  external_id VARCHAR(255),
  sender VARCHAR(255),
  subject VARCHAR(500),
  short_excerpt TEXT,
  storage_key VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Items table (parsed entries)
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  detected_type VARCHAR(20) NOT NULL CHECK (detected_type IN ('appointment', 'bill', 'noise')),
  confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  review_status VARCHAR(20) NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto', 'pending_review')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'auto'
    CHECK (review_status IN ('auto', 'pending_review'));

-- Care collaborators table
CREATE TABLE IF NOT EXISTS care_collaborators (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  invite_token VARCHAR(64) NOT NULL UNIQUE,
  invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP
);

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE UNIQUE,
  start_local TIMESTAMPTZ NOT NULL,
  end_local TIMESTAMPTZ NOT NULL,
  start_time_zone VARCHAR(100),
  end_time_zone VARCHAR(100),
  start_offset VARCHAR(6),
  end_offset VARCHAR(6),
  location VARCHAR(500),
  prep_note TEXT,
  summary VARCHAR(500) NOT NULL,
  ics_token VARCHAR(64) NOT NULL UNIQUE,
  assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS start_time_zone VARCHAR(100);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS end_time_zone VARCHAR(100);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS start_offset VARCHAR(6);

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS end_offset VARCHAR(6);

ALTER TABLE appointments
  ALTER COLUMN start_local TYPE TIMESTAMPTZ
  USING (
    CASE
      WHEN pg_typeof(start_local)::text = 'timestamp without time zone'
        THEN start_local AT TIME ZONE COALESCE(start_time_zone, 'UTC')
      ELSE start_local
    END
  );

ALTER TABLE appointments
  ALTER COLUMN end_local TYPE TIMESTAMPTZ
  USING (
    CASE
      WHEN pg_typeof(end_local)::text = 'timestamp without time zone'
        THEN end_local AT TIME ZONE COALESCE(end_time_zone, 'UTC')
      ELSE end_local
    END
  );

-- Bills table
CREATE TABLE IF NOT EXISTS bills (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE UNIQUE,
  statement_date DATE,
  amount DECIMAL(10, 2),
  due_date DATE,
  pay_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'overdue', 'paid')),
  task_key VARCHAR(64),
  assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bill drafts table (pending review data)
CREATE TABLE IF NOT EXISTS bill_drafts (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2),
  due_date DATE,
  statement_date DATE,
  pay_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'overdue', 'paid')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bill_drafts
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE bill_drafts
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'overdue', 'paid'));

ALTER TABLE bill_drafts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE bill_drafts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Medications table
CREATE TABLE IF NOT EXISTS medications (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  strength_value DECIMAL(10, 2),
  strength_unit VARCHAR(64),
  form VARCHAR(64),
  instructions TEXT,
  notes TEXT,
  prescribing_provider VARCHAR(255),
  start_date DATE,
  end_date DATE,
  quantity_on_hand INTEGER,
  refill_threshold INTEGER,
  preferred_pharmacy VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP
);

-- Medication doses table
CREATE TABLE IF NOT EXISTS medication_doses (
  id SERIAL PRIMARY KEY,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  label VARCHAR(255),
  time_of_day TIME NOT NULL,
  timezone VARCHAR(100) NOT NULL,
  reminder_window_minutes INTEGER NOT NULL DEFAULT 120,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Medication intakes table
CREATE TABLE IF NOT EXISTS medication_intakes (
  id SERIAL PRIMARY KEY,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  dose_id INTEGER REFERENCES medication_doses(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  status VARCHAR(10) NOT NULL CHECK (status IN ('taken', 'skipped', 'expired')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Medication refill forecasts helper table
CREATE TABLE IF NOT EXISTS medication_refill_forecasts (
  medication_id INTEGER PRIMARY KEY REFERENCES medications(id) ON DELETE CASCADE,
  expected_run_out_on DATE,
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Google sync links table
CREATE TABLE IF NOT EXISTS google_sync_links (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  calendar_id TEXT,
  event_id TEXT,
  etag TEXT,
  last_synced_at TIMESTAMP,
  last_sync_direction VARCHAR(10) CHECK (last_sync_direction IN ('push', 'pull')),
  local_hash VARCHAR(128),
  remote_updated_at TIMESTAMP,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'pending', 'error')),
  last_error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS calendar_id TEXT;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS event_id TEXT;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS etag TEXT;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS last_sync_direction VARCHAR(10) CHECK (last_sync_direction IN ('push', 'pull'));

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS local_hash VARCHAR(128);

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS remote_updated_at TIMESTAMP;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'pending', 'error'));

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE google_sync_links
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_google_sync_links_event ON google_sync_links(event_id);
CREATE INDEX IF NOT EXISTS idx_google_sync_links_calendar ON google_sync_links(calendar_id);

-- Google OAuth credentials table
CREATE TABLE IF NOT EXISTS google_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scope TEXT[],
  expires_at TIMESTAMP,
  token_type VARCHAR(50),
  id_token TEXT,
  calendar_id TEXT,
  sync_token TEXT,
  last_pulled_at TIMESTAMP,
  needs_reauth BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_google_credentials_clerk_user ON google_credentials(clerk_user_id);

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS access_token TEXT;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS refresh_token TEXT;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS scope TEXT[];

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS token_type VARCHAR(50);

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS id_token TEXT;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS calendar_id TEXT;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS sync_token TEXT;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMP;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS needs_reauth BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE google_credentials
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_google_credentials_expires_at ON google_credentials(expires_at);

-- Care collaborators table
CREATE TABLE IF NOT EXISTS care_collaborators (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  invite_token VARCHAR(64) NOT NULL UNIQUE,
  invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  accepted_at TIMESTAMP
);

-- Audit table (classification and parsing decisions)
CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  meta JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_recipients_user_id ON recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_recipient_id ON sources(recipient_id);
CREATE INDEX IF NOT EXISTS idx_items_recipient_id ON items(recipient_id);
CREATE INDEX IF NOT EXISTS idx_items_source_id ON items(source_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_local ON appointments(start_local);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date);
CREATE INDEX IF NOT EXISTS idx_collaborators_recipient_id ON care_collaborators(recipient_id);
CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON care_collaborators(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaborators_recipient_email ON care_collaborators(recipient_id, email);
CREATE INDEX IF NOT EXISTS idx_audit_item_id ON audit(item_id);
