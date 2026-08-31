import type { AppDatabase } from './db/sqlite'
import type { LocalBucket } from './storage/local-bucket'

export type Env = {
  DB: AppDatabase
  BUCKET: LocalBucket
  ENVIRONMENT: string
  ADMIN_KEY?: string
  SESSION_SECRET: string
  ALLOW_PUBLIC_REGISTER?: string
  PUBLIC_ORIGIN: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  DEEPSEEK_API_KEY?: string
}

export type SessionUser = {
  email: string
  name: string
  picture: string
}

export type UserRow = {
  id: number
  email: string
  name: string
  picture: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
  created_at: number
  last_login: number | null
}

export type ColumnInfo = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export type ApiKeyRow = {
  id: number
  key_prefix: string
  key_hash: string
  name: string
  type: 'readonly' | 'readwrite'
  created_at: number
  is_active: number
}

// 经过 auth 中间件后挂载到 context 上的变量
export type AuthVariables = {
  keyType: 'readonly' | 'readwrite'
  keyScope: 'all' | 'groups'
  allowedTables: string[] | null // null = all tables, string[] = restricted
  allowedGroupIds: number[] | null // group IDs this key has access to (null = all)
  allowedNoteRootIds: string[] | null
  user?: SessionUser
  userId?: number               // _users.id，ADMIN_KEY 时为 undefined
  userRole?: 'admin' | 'user'   // _users.role
  teamId?: number               // _users.team_id，ADMIN_KEY 时为 undefined
}
