ALTER TABLE _users ADD COLUMN current_team_id INTEGER REFERENCES _teams(id);

CREATE TABLE IF NOT EXISTS _team_members (
  team_id INTEGER NOT NULL REFERENCES _teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  invited_by INTEGER REFERENCES _users(id),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON _team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON _team_members(team_id);

CREATE TABLE IF NOT EXISTS _team_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES _teams(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_by INTEGER REFERENCES _users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_team_invites_team ON _team_invites(team_id);

INSERT OR IGNORE INTO _team_members (team_id, user_id, role, status, joined_at)
SELECT
  u.team_id,
  u.id,
  CASE WHEN t.created_by = u.id THEN 'owner' ELSE 'member' END,
  'active',
  COALESCE(u.created_at, unixepoch())
FROM _users u
JOIN _teams t ON t.id = u.team_id
WHERE u.team_id IS NOT NULL;

UPDATE _users
SET current_team_id = COALESCE(current_team_id, team_id)
WHERE team_id IS NOT NULL;
