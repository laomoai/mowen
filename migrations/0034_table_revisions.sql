CREATE TABLE IF NOT EXISTS _table_revision_heads (
  team_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (team_id, table_name)
);

CREATE TABLE IF NOT EXISTS _table_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  table_version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete', 'batch_insert', 'restore')),
  before_rows_json TEXT NOT NULL DEFAULT '[]',
  after_rows_json TEXT NOT NULL DEFAULT '[]',
  changed_record_ids_json TEXT NOT NULL DEFAULT '[]',
  actor_user_id INTEGER,
  actor_api_key_id INTEGER,
  auth_mode TEXT NOT NULL,
  restore_from_id INTEGER REFERENCES _table_revisions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (team_id, table_name, table_version)
);

CREATE INDEX IF NOT EXISTS idx_table_revisions_history
  ON _table_revisions(team_id, table_name, table_version DESC);
