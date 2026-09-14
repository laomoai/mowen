CREATE TABLE IF NOT EXISTS _entity_heads (
  team_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('record', 'note')),
  table_name TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (team_id, entity_type, table_name, entity_id)
);

CREATE TABLE IF NOT EXISTS _revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('record', 'note')),
  table_name TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('update', 'restore')),
  snapshot_json TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  actor_user_id INTEGER,
  actor_api_key_id INTEGER,
  auth_mode TEXT NOT NULL,
  restore_from_id INTEGER REFERENCES _revisions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (team_id, entity_type, table_name, entity_id, entity_version)
);

CREATE INDEX IF NOT EXISTS idx_revisions_history
  ON _revisions(team_id, entity_type, table_name, entity_id, created_at DESC, id DESC);
