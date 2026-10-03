CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  role TEXT,
  teacher TEXT,
  class_name TEXT,
  notifications INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS delivery_state (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_iso)
);

CREATE TABLE IF NOT EXISTS acknowledgements (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  publication_key TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_iso, publication_key)
);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_teacher ON profiles(teacher);
CREATE INDEX IF NOT EXISTS idx_profiles_class ON profiles(class_name);
