-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  google_id VARCHAR(255) NOT NULL UNIQUE,
  forwarding_address VARCHAR(255) NOT NULL UNIQUE,
  plan_secret VARCHAR(64) NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 0,
  plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
  start_local TIMESTAMP NOT NULL,
  end_local TIMESTAMP NOT NULL,
  location VARCHAR(500),
  prep_note TEXT,
  summary VARCHAR(500) NOT NULL,
  ics_token VARCHAR(64) NOT NULL UNIQUE,
  assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
