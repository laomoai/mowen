import type { AppDatabase } from '../db/sqlite'

export type StoredMsg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  draft_json: string | null
  steps_json: string | null
  topic: string | null
  created_at: number
}

export type ThreadRow = {
  id: string
  user_id: number
  team_id: number | null
  title: string
  summary: string
  updated_at: number
}

export async function getOrCreateThread(db: AppDatabase, userId: number, teamId?: number): Promise<ThreadRow> {
  const existing = teamId === undefined
    ? await db.prepare(
      `SELECT id, user_id, team_id, title, summary, updated_at
       FROM _assistant_threads
       WHERE user_id = ? AND team_id IS NULL`,
    ).bind(userId).first<ThreadRow>()
    : await db.prepare(
      `SELECT id, user_id, team_id, title, summary, updated_at
       FROM _assistant_threads
       WHERE user_id = ? AND team_id = ?`,
    ).bind(userId, teamId).first<ThreadRow>()
  if (existing) return existing
  const id = 'at_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await db.prepare(
    `INSERT INTO _assistant_threads (id, user_id, team_id, title) VALUES (?, ?, ?, '对话')`,
  ).bind(id, userId, teamId ?? null).run()
  return {
    id, user_id: userId, team_id: teamId ?? null, title: '对话', summary: '', updated_at: Math.floor(Date.now() / 1000),
  }
}

export async function listMessages(db: AppDatabase, threadId: string, limit = 120): Promise<StoredMsg[]> {
  const rows = await db.prepare(
    `SELECT id, role, content, draft_json, steps_json, topic, created_at
     FROM _assistant_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC`,
  ).bind(threadId).all<StoredMsg>()
  const all = rows.results ?? []
  return all.length > limit ? all.slice(all.length - limit) : all
}

export async function appendMessage(
  db: AppDatabase,
  threadId: string,
  msg: { role: 'user' | 'assistant'; content: string; draft?: unknown; steps?: unknown; topic?: string | null },
): Promise<void> {
  const id = 'am_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await db.prepare(
    `INSERT INTO _assistant_messages (id, thread_id, role, content, draft_json, steps_json, topic)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    threadId,
    msg.role,
    msg.content,
    msg.draft ? JSON.stringify(msg.draft) : null,
    msg.steps ? JSON.stringify(msg.steps) : null,
    msg.topic ?? null,
  ).run()
  await db.prepare(`UPDATE _assistant_threads SET updated_at = unixepoch() WHERE id = ?`).bind(threadId).run()
}

export async function updateThreadMeta(
  db: AppDatabase,
  threadId: string,
  patch: { title?: string; summary?: string },
): Promise<void> {
  const sets: string[] = ['updated_at = unixepoch()']
  const params: unknown[] = []
  if (patch.title !== undefined) {
    sets.push('title = ?')
    params.push(patch.title)
  }
  if (patch.summary !== undefined) {
    sets.push('summary = ?')
    params.push(patch.summary)
  }
  params.push(threadId)
  await db.prepare(`UPDATE _assistant_threads SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()
}

export function recentForModel(msgs: StoredMsg[], keep = 10): StoredMsg[] {
  return msgs.slice(-keep)
}

export function lastUserBefore(msgs: StoredMsg[], excludeLastUser: string): string {
  const users = msgs.filter((m) => m.role === 'user' && m.content !== excludeLastUser)
  return users.length ? users[users.length - 1].content : ''
}
