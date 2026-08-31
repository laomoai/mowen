DROP INDEX IF EXISTS idx_assistant_threads_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_threads_user_team
ON _assistant_threads (user_id, team_id);
