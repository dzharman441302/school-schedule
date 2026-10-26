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

-- v0.3: one user follows several classes and teachers. Each row is one subscription.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_value ON subscriptions(kind, value);

-- What was last sent to a user for a day, per subscription (target «c:9Б» or «t:Фамилия И.О.»).
CREATE TABLE IF NOT EXISTS deliveries (
  user_id TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  target TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date_iso, target)
);

-- Carry over the single class or teacher of v0.2 profiles and their delivery marks.
-- Safe to run again: existing rows are kept.
INSERT OR IGNORE INTO subscriptions(user_id, kind, value, created_at)
  SELECT user_id, 'teacher', teacher, COALESCE(updated_at, created_at) FROM profiles WHERE role = 'teacher' AND teacher IS NOT NULL AND teacher <> '';
INSERT OR IGNORE INTO subscriptions(user_id, kind, value, created_at)
  SELECT user_id, 'class', class_name, COALESCE(updated_at, created_at) FROM profiles WHERE role = 'student' AND class_name IS NOT NULL AND class_name <> '';
INSERT OR IGNORE INTO deliveries(user_id, date_iso, target, content_hash, updated_at)
  SELECT d.user_id, d.date_iso, CASE p.role WHEN 'teacher' THEN 't:' || p.teacher ELSE 'c:' || p.class_name END, d.content_hash, d.updated_at
  FROM delivery_state d JOIN profiles p ON p.user_id = d.user_id
  WHERE (p.role = 'teacher' AND p.teacher IS NOT NULL) OR (p.role = 'student' AND p.class_name IS NOT NULL);

-- v0.4: announcements sent to subscribers, one row per notice and person.
CREATE TABLE IF NOT EXISTS notice_deliveries (
  notice_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (notice_id, user_id)
);
