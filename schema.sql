CREATE TABLE IF NOT EXISTS people (
  google_sub TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  picture TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_people_created_at
ON people(created_at);

CREATE TABLE IF NOT EXISTS profiles (
  google_sub TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  picture TEXT NOT NULL DEFAULT '',
  music TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
