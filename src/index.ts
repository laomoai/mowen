import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { apiReference } from '@scalar/hono-api-reference'
import type { Env, AuthVariables } from './types'
import { authMiddleware, tableAccessMiddleware } from './middleware/auth'
import authRouter from './routes/auth'
import tablesRouter from './routes/tables'
import recordsRouter from './routes/records'
import adminRouter from './routes/admin'
import fieldsRouter from './routes/fields'
import groupsRouter from './routes/groups'
import trashRouter from './routes/trash'
import uploadRouter from './routes/upload'
import dashboardsRouter from './routes/dashboards'
import preferencesRouter from './routes/preferences'
import notesRouter from './routes/notes'
import teamsRouter from './routes/teams'
import administrationRouter from './routes/administration'
import avatarsRouter from './routes/avatars'
import workspaceRouter from './routes/workspace'
import assistantRouter from './routes/assistant'
import filesRouter from './routes/files'
import viewerRouter from './routes/viewer'

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

// ── 全局中间件 ────────────────────────────────────────────────
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['X-API-Key', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  })
)

// ── 健康检查（无需认证）────────────────────────────────────────
app.get('/api/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
)

// ── OpenAPI JSON 文档（无需认证，供 AI Agent 读取）──────────────
app.get('/api/openapi.json', (c) => {
  const serverUrl = requestOrigin(c)
  return c.json(openApiSpec(serverUrl))
})

// ── Scalar API 文档 UI（无需认证）────────────────────────────────
app.get(
  '/api/docs',
  apiReference({
    spec: { url: '/api/openapi.json' },
    pageTitle: '墨问 API',
    theme: 'purple',
  })
)

// auth 路由不需要认证，必须在 authMiddleware 之前注册
app.route('/api/auth', authRouter)
app.route('/api/avatars', avatarsRouter)

// ── 需要认证的路由 ─────────────────────────────────────────────
app.use('/api/*', async (c, next) => {
  await next()
  if (!c.req.path.startsWith('/api/files')) {
    c.header('Cache-Control', 'no-store')
  }
})
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/files')) return next()
  return authMiddleware(c, next)
})
// 不再缓存：表列表用了 COUNT(*)，需要实时；表结构极少变更但也不值得缓存的复杂度

// 表访问控制：scope=groups 的 Key 只能访问关联分组内的表
app.use('/api/tables/:tableName/*', tableAccessMiddleware)
app.use('/api/tables/:tableName', tableAccessMiddleware)

app.route('/api/tables', tablesRouter)
app.route('/api/tables', recordsRouter)
app.route('/api/tables', fieldsRouter)
app.route('/api/admin', adminRouter)
app.route('/api/admin', administrationRouter)
app.route('/api/groups', groupsRouter)
app.route('/api/trash', trashRouter)
app.route('/api/upload', uploadRouter)
app.route('/api/tables', dashboardsRouter)
app.route('/api/user', preferencesRouter)
app.route('/api/notes', notesRouter)
app.route('/api/teams', teamsRouter)
app.route('/api/workspace', workspaceRouter)
app.route('/api/assistant', assistantRouter)
app.route('/api/files', filesRouter)
app.route('/api/viewer', viewerRouter)

export { app }

// ── OpenAPI 3.0 Spec ──────────────────────────────────────────
function requestOrigin(c: { req: { header(name: string): string | undefined; url: string } }): string {
  const url = new URL(c.req.url)
  const forwardedProto = c.req.header('X-Forwarded-Proto')?.split(',')[0]?.trim()
  const forwardedHost = c.req.header('X-Forwarded-Host')?.split(',')[0]?.trim()
    || c.req.header('Host')?.split(',')[0]?.trim()
  const proto = forwardedProto || url.protocol.replace(/:$/, '')
  const host = forwardedHost || url.host
  return `${proto}://${host}`
}

function openApiSpec(serverUrl: string) {
  return {
    openapi: '3.0.0',
    info: {
      title: '墨问 MoWen API',
      version: '2.2.0',
      description: `墨问 HTTP API。Agent / 小程序使用 \`X-API-Key\`；Web 管理接口使用登录后的 Cookie Session。

表格用 \`name\`（如 tbl_abc123），显示名是 \`title\`；写记录用字段 \`column_name\`。
文件夹权限：\`scope=groups\` 的 Key 可访问所选文件夹里的表格和笔记。工作区树见 \`/api/workspace/*\`。
Web 登录态支持一个账号加入多个空间；API Key 归属创建它的空间和授权范围，适合小程序和 Skill 直接访问。
分页用游标 \`cursor\` / \`next_cursor\`。时间是 UTC ISO 8601。

Skill：\`/agent/mowen/SKILL.md\``,
    },
    servers: [{ url: serverUrl }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        CookieAuth: { type: 'apiKey', in: 'cookie', name: 'mowen_session' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
        FieldMapping: {
          type: 'object',
          description: 'Mapping of column name → display info, useful for understanding each column',
          additionalProperties: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Field display name' },
              field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'currency', 'percent', 'email', 'url', 'date', 'datetime', 'checkbox', 'select', 'image', 'link', 'totp', 'password'] },
            },
          },
          example: { name: { title: 'Name', field_type: 'text' }, created_at: { title: 'Created At', field_type: 'datetime' } },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page_size: { type: 'integer' },
            count: { type: 'integer', description: 'Number of records returned on this page' },
            next_cursor: { type: 'string', nullable: true, description: 'Cursor for the next page; null means this is the last page' },
          },
        },
        SpaceSummary: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'admin', 'member', 'viewer'] },
          },
        },
        SessionUser: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            name: { type: 'string' },
            picture: { type: 'string' },
            role: { type: 'string' },
            team: {
              type: 'object',
              nullable: true,
              deprecated: true,
              description: 'Legacy alias of current_team for old clients.',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
              },
            },
            current_team: { allOf: [{ $ref: '#/components/schemas/SpaceSummary' }], nullable: true },
            spaces: {
              type: 'array',
              items: { $ref: '#/components/schemas/SpaceSummary' },
            },
          },
        },
        TeamInvite: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            code: { type: 'string' },
            role: { type: 'string' },
            max_uses: { type: 'integer', nullable: true },
            used_count: { type: 'integer' },
            expires_at: { type: 'integer', nullable: true },
            revoked_at: { type: 'integer', nullable: true },
            created_at: { type: 'integer' },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Health check',
          security: [],
          responses: { '200': { description: 'Service is healthy' } },
        },
      },
      '/api/viewer/me': {
        get: {
          summary: 'Validate API key for readonly mini program viewer',
          description: 'Returns API key type, scope, and a visible workspace summary. Intended for the WeChat Mini Program readonly reader.',
          responses: {
            '200': {
              description: 'Viewer connection summary',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          ok: { type: 'boolean' },
                          key_type: { type: 'string', enum: ['readonly', 'readwrite'] },
                          scope: { type: 'string', enum: ['all', 'groups'] },
                          user: {
                            type: 'object',
                            nullable: true,
                            properties: {
                              id: { type: 'integer' },
                              email: { type: 'string' },
                              name: { type: 'string' },
                              picture: { type: 'string', nullable: true },
                            },
                          },
                          team: {
                            type: 'object',
                            nullable: true,
                            properties: {
                              id: { type: 'integer' },
                              name: { type: 'string' },
                            },
                          },
                          workspace: {
                            type: 'object',
                            properties: {
                              title: { type: 'string' },
                              folder_count: { type: 'integer' },
                              note_count: { type: 'integer' },
                              table_count: { type: 'integer' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Missing or invalid API key' },
          },
        },
      },
      '/api/viewer/workspace': {
        get: {
          summary: 'List visible workspace nodes for readonly mini program viewer',
          description: 'Returns folder, table, and note nodes allowed by the API key scope. This is the readonly mini program equivalent of the workspace tree.',
          responses: {
            '200': {
              description: 'Visible workspace nodes',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            kind: { type: 'string', enum: ['folder', 'table', 'note'] },
                            parent_id: { type: 'string', nullable: true },
                            sort_order: { type: 'integer' },
                            title: { type: 'string' },
                            ref: { type: 'string', nullable: true, description: 'Table name or note id for leaf nodes' },
                            group_id: { type: 'integer', nullable: true },
                            icon: { type: 'string', nullable: true },
                            row_count: { type: 'integer', nullable: true, description: 'Table row count for table nodes; null for folders and notes' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Missing or invalid API key' },
          },
        },
      },
      '/api/viewer/notes/{id}': {
        get: {
          summary: 'Get one note for readonly mini program viewer',
          description: 'Returns Markdown content and display metadata for one visible note. Editing fields and internal ownership fields are omitted.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Readonly note detail',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          title: { type: 'string' },
                          content: { type: 'string', description: 'Markdown content' },
                          icon: { type: 'string', nullable: true },
                          parent_id: { type: 'string', nullable: true },
                          sort_order: { type: 'integer' },
                          created_at: { type: 'integer' },
                          updated_at: { type: 'integer' },
                          cover: { type: 'string', nullable: true },
                          description: { type: 'string', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Note not allowed by API key scope' },
            '404': { description: 'Note not found' },
          },
        },
      },
      '/api/viewer/tables/{tableName}/records': {
        get: {
          summary: 'List records for readonly mini program viewer',
          description: 'Returns only viewer-safe fields. Hidden fields, password fields, and totp fields are excluded before the response is created. Filters and sorting are also restricted to viewer-safe fields.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page_size', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'The id of the last record from the previous page' },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Format: safe_field:asc or safe_field:desc' },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated viewer-safe fields. id is always retained when available.' },
            { name: 'filter[field]', in: 'query', schema: { type: 'string' }, description: 'Equality filter over viewer-safe fields; supports suffixes __gt/__gte/__lt/__lte/__like/__ne' },
          ],
          responses: {
            '200': {
              description: 'Safe record list + safe field metadata',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' } },
                      table: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          title: { type: 'string' },
                          icon: { type: 'string', nullable: true },
                          row_count: { type: 'integer', nullable: true },
                        },
                      },
                      fields: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            column_name: { type: 'string' },
                            title: { type: 'string' },
                            field_type: { type: 'string' },
                          },
                        },
                      },
                      meta: { $ref: '#/components/schemas/PaginationMeta' },
                    },
                  },
                },
              },
            },
            '403': { description: 'Table not allowed by API key scope' },
            '404': { description: 'Table not found' },
          },
        },
      },
      '/api/viewer/tables/{tableName}/records/{id}': {
        get: {
          summary: 'Get one safe record for readonly mini program viewer',
          description: 'Returns one record with only viewer-safe fields. Hidden fields, password fields, and totp fields are excluded before the response is created.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated viewer-safe fields. id is always retained when available.' },
          ],
          responses: {
            '200': {
              description: 'Safe record detail + safe field metadata',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'object' },
                      table: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          title: { type: 'string' },
                          icon: { type: 'string', nullable: true },
                          row_count: { type: 'integer', nullable: true },
                        },
                      },
                      fields: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            column_name: { type: 'string' },
                            title: { type: 'string' },
                            field_type: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Table not allowed by API key scope' },
            '404': { description: 'Table or record not found' },
          },
        },
      },
      '/api/tables': {
        get: {
          summary: 'List all tables',
          responses: {
            '200': {
              description: 'Table list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', description: 'API table name (e.g. tbl_abc123)' },
                            title: { type: 'string', nullable: true, description: 'Display name (e.g. "Customer List")' },
                            row_count: { type: 'integer', description: 'Total number of records' },
                            icon: { type: 'string', nullable: true, description: 'Table icon emoji or ion:* identifier' },
                            is_locked: { type: 'boolean', description: 'Whether the table is locked' },
                            groups: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'integer' },
                                  name: { type: 'string' },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create table',
          description: 'Dynamically create a table. The id and created_at fields are added automatically. It is recommended to create tables via the UI (which auto-generates a tbl_ prefixed name), but the API also accepts a custom name.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'columns'],
                  properties: {
                    name: { type: 'string', description: 'API table name (e.g. tbl_abc123)', example: 'tbl_orders01' },
                    title: { type: 'string', description: 'Display name', example: 'Order Management' },
                    folder_id: { type: 'string', nullable: true, description: 'Optional workspace folder node id. Places the table under that folder and into the matching group.' },
                    columns: {
                      type: 'array',
                      description: 'Field definitions',
                      items: {
                        type: 'object',
                        required: ['name', 'type'],
                        properties: {
                          name: { type: 'string', description: 'Column name', example: 'col_amt1' },
                          title: { type: 'string', description: 'Display name', example: 'Amount' },
                          type: { type: 'string', enum: ['TEXT', 'INTEGER', 'REAL', 'BLOB'], description: 'SQLite type' },
                          field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'currency', 'percent', 'email', 'url', 'date', 'datetime', 'checkbox', 'select'], description: 'UI field type' },
                          nullable: { type: 'boolean', default: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Table created successfully' },
            '409': { description: 'Table already exists' },
          },
        },
      },
      '/api/tables/{tableName}': {
        get: {
          summary: 'Get table schema',
          description: 'Returns the field definitions for a table, including display names, field types, and the table icon.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Table schema',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', description: 'API table name' },
                          title: { type: 'string', description: 'Display name' },
                          icon: { type: 'string', nullable: true, description: 'Table icon emoji or ion:* identifier' },
                          columns: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                name: { type: 'string', description: 'Column name' },
                                title: { type: 'string', description: 'Display name' },
                                type: { type: 'string', description: 'SQLite type' },
                                field_type: { type: 'string', description: 'UI field type' },
                                nullable: { type: 'boolean' },
                                isPrimaryKey: { type: 'boolean' },
                                defaultValue: { type: 'string', nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          summary: 'Update table metadata',
          description: 'Updates table title, icon, or lock state.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Display name' },
                    icon: { type: 'string', nullable: true, description: 'Emoji or ion:* icon; null clears the icon' },
                    is_locked: { type: 'boolean', description: 'Lock or unlock the table' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated successfully' },
            '400': { description: 'Nothing to update' },
            '404': { description: 'Table not found' },
          },
        },
        delete: {
          summary: 'Delete table (moves to trash)',
          description: 'Deletes the table from the active list and stores a full table snapshot in trash so it can be restored later.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted successfully' },
            '404': { description: 'Table not found' },
          },
        },
      },
      '/api/tables/{tableName}/records': {
        get: {
          summary: 'List records (paginated)',
          description: 'datetime fields are automatically converted to ISO 8601 UTC format (e.g. 2026-03-15T04:37:31.000Z). The response includes a fields mapping to help interpret column names.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page_size', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'The id of the last record from the previous page' },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Format: field:asc or field:desc' },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated list of fields to return' },
            { name: 'filter[field]', in: 'query', schema: { type: 'string' }, description: 'Equality filter; supports suffixes __gt/__gte/__lt/__lte/__like/__ne' },
          ],
          responses: {
            '200': {
              description: 'Record list + field mapping',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { type: 'object' }, description: 'Array of records; datetime fields are ISO 8601 strings' },
                      fields: { $ref: '#/components/schemas/FieldMapping' },
                      meta: { $ref: '#/components/schemas/PaginationMeta' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create record',
          description: 'Request body is a JSON object with column names as keys. datetime fields accept a Unix timestamp (seconds) or an ISO 8601 string.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '201': { description: 'Created successfully; returns { id, ...fields }' } },
        },
      },
      '/api/tables/{tableName}/records/batch': {
        post: {
          summary: 'Batch create records (up to 500)',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { records: { type: 'array', items: { type: 'object' } } },
                },
              },
            },
          },
          responses: { '201': { description: 'Batch insert successful' } },
        },
      },
      '/api/tables/{tableName}/records/{id}': {
        get: {
          summary: 'Get single record',
          description: 'Returns record data + fields mapping. datetime fields are in ISO 8601 UTC format.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Record detail + field mapping', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object' }, fields: { $ref: '#/components/schemas/FieldMapping' } } } } } } },
        },
        patch: {
          summary: 'Update record',
          description: 'datetime fields accept a Unix timestamp (seconds) or an ISO 8601 string.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'Updated successfully' } },
        },
        delete: {
          summary: 'Delete record',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Deleted successfully' } },
        },
      },
      '/api/tables/{tableName}/records/search': {
        get: {
          summary: 'Search records (for link field picker)',
          description: 'Returns a simplified list of {id, title} for use in link field record selectors. The title is the value of the first text field in the table. Use tableName="_notes" to search notes (returns owner-filtered notes; id is a string like "n_xxx").',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' }, description: 'Table name, or "_notes" to search notes' },
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search keyword (matches against the primary text field, or note title for _notes)' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 }, description: 'Max number of results' },
          ],
          responses: {
            '200': {
              description: 'Search results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', description: 'Record id (integer string for tables, "n_xxx" string for _notes)' },
                            title: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/tables/{tableName}/export': {
        get: {
          summary: 'Export table records',
          description: 'Exports records as CSV or JSON. Supports the same filter and sort parameters as the list-records endpoint. Exports are capped at 10,000 rows; larger result sets return 413.',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'format', in: 'query', required: true, schema: { type: 'string', enum: ['csv', 'json'] } },
            { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Format: field:asc or field:desc' },
            { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated list of fields to export' },
            { name: 'filter[field]', in: 'query', schema: { type: 'string' }, description: 'Equality filter; supports suffixes __gt/__gte/__lt/__lte/__like/__ne/__nlike' },
          ],
          responses: {
            '200': { description: 'Exported file stream' },
            '413': { description: 'Export exceeds the 10,000 row limit' },
            '404': { description: 'Table not found' },
          },
        },
      },
      '/api/tables/{tableName}/fields': {
        get: {
          summary: 'Get field metadata',
          description: 'Returns field display names, types, widths, visibility, etc. Used by the frontend UI to drive rendering.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Field metadata list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            column_name: { type: 'string' },
                            title: { type: 'string' },
                            field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'currency', 'percent', 'email', 'url', 'date', 'datetime', 'checkbox', 'select', 'image', 'link', 'totp', 'password'] },
                            select_options: { type: 'array', nullable: true },
                            order_index: { type: 'integer' },
                            width: { type: 'integer' },
                            is_hidden: { type: 'boolean' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Add field',
          description: 'Executes ALTER TABLE ADD COLUMN and writes to _field_meta.',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'field_type'],
                  properties: {
                    title: { type: 'string', description: 'Field display name' },
                    column_name: { type: 'string', description: 'Optional; auto-generated from title if omitted' },
                    field_type: { type: 'string', enum: ['text', 'longtext', 'number', 'currency', 'percent', 'email', 'url', 'date', 'datetime', 'checkbox', 'select', 'image', 'link', 'totp', 'password'] },
                    nullable: { type: 'boolean', default: true },
                    select_options: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' }, color: { type: 'string' } } } },
                    link_table: { type: 'string', description: 'Required when field_type is "link". The target table name to link to. Use "_notes" to link to a note.' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Field created successfully' },
            '409': { description: 'Field already exists' },
          },
        },
      },
      '/api/tables/{tableName}/fields/{colName}': {
        patch: {
          summary: 'Update field metadata',
          description: 'Modify field display name, type, width, visibility, etc. (does not alter the database schema).',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'colName', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    field_type: { type: 'string' },
                    width: { type: 'integer' },
                    is_hidden: { type: 'boolean' },
                    order_index: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Updated successfully' } },
        },
        delete: {
          summary: 'Delete (hide) field',
          parameters: [
            { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'colName', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Operation successful' } },
        },
      },
      '/api/admin/keys': {
        get: { summary: 'List API Keys (with group info and note root access)', responses: { '200': { description: 'Key list' } } },
        post: {
          summary: 'Create API Key',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['readonly', 'readwrite'] },
                    scope: { type: 'string', enum: ['all', 'groups'], description: 'all = all tables (notes follow notes_scope); groups = tables and notes inside selected folders' },
                    group_ids: { type: 'array', items: { type: 'integer' }, description: 'Folder/group IDs when scope=groups.' },
                    notes_scope: { type: 'string', enum: ['all', 'none', 'roots'], description: 'Used when scope=all. Ignored for scope=groups (folder membership includes notes).' },
                    note_root_ids: { type: 'array', items: { type: 'string' }, description: 'List of note root IDs when notes_scope=roots' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created successfully; plaintext key is returned only once' } },
        },
      },
      '/api/admin/keys/{id}': {
        patch: {
          summary: "Update Key's table scope, note scope, and associated groups/directories",
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    scope: { type: 'string', enum: ['all', 'groups'] },
                    group_ids: { type: 'array', items: { type: 'integer' } },
                    notes_scope: { type: 'string', enum: ['all', 'none', 'roots'] },
                    note_root_ids: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Updated successfully' } },
        },
        delete: {
          summary: 'Revoke API Key',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Revoked successfully' } },
        },
      },
      '/api/admin/keys/{id}/permanent': {
        delete: {
          summary: 'Permanently delete a revoked API Key',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Deleted successfully' },
            '400': { description: 'Only revoked keys can be permanently deleted' },
            '404': { description: 'Key not found' },
          },
        },
      },
      '/api/groups': {
        get: {
          summary: 'List all groups (with associated tables)',
          description: 'A group is the permission and membership record for a sidebar folder. The UI folder and this group share the same id (`group_id`).',
          responses: { '200': { description: 'Group list' } },
        },
        post: {
          summary: 'Create group (also creates a sidebar folder)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string', description: 'Group name' },
                    sort_order: { type: 'integer', description: 'Sort weight; lower values appear first' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Created successfully' }, '409': { description: 'Group already exists' } },
        },
      },
      '/api/groups/{id}': {
        patch: {
          summary: 'Update group',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    sort_order: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Updated successfully' } },
        },
        delete: {
          summary: 'Delete group (tables are not affected)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'Deleted successfully' } },
        },
      },
      '/api/groups/{id}/tables': {
        put: {
          summary: 'Set tables in group (full replace; also nests them under the folder in the sidebar)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tables: { type: 'array', items: { type: 'string' }, description: 'List of table names' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Set successfully' } },
        },
      },
      '/api/groups/{id}/keys': {
        put: {
          summary: 'Set keys in group (full replace)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['key_ids'],
                  properties: {
                    key_ids: { type: 'array', items: { type: 'integer' }, description: 'List of API key IDs' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Set successfully' },
            '400': { description: 'Invalid request body' },
            '404': { description: 'Group not found' },
          },
        },
      },
      '/api/workspace/tree': {
        get: {
          summary: 'List sidebar workspace nodes',
          description: 'Flat list of folder, table, and note nodes. Rebuild the tree with `parent_id`. Folders do not have a content page. Table/note `ref` is the table name or note id. Does not replace group-based key authorization.',
          responses: {
            '200': {
              description: 'Workspace nodes',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', example: 'wn_f_abc' },
                            kind: { type: 'string', enum: ['folder', 'table', 'note'] },
                            parent_id: { type: 'string', nullable: true },
                            sort_order: { type: 'integer' },
                            title: { type: 'string' },
                            ref: { type: 'string', nullable: true, description: 'table name or note id; null for folders' },
                            group_id: { type: 'integer', nullable: true, description: 'Present on folders; same id as /api/groups' },
                            icon: { type: 'string', nullable: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/workspace/folders': {
        post: {
          summary: 'Create sidebar folder',
          description: 'Also inserts a matching group used by scope=groups API keys.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    parent_id: { type: 'string', nullable: true, description: 'Parent folder workspace node id' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Folder created' }, '400': { description: 'Invalid parent or empty name' } },
        },
      },
      '/api/workspace/folders/{id}': {
        patch: {
          summary: 'Rename sidebar folder (and its group)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { title: { type: 'string' } } },
              },
            },
          },
          responses: { '200': { description: 'Renamed' }, '404': { description: 'Folder not found' } },
        },
        delete: {
          summary: 'Delete empty sidebar folder',
          description: 'Fails with 409 if the folder still has children. Does not drop tables.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted' },
            '409': { description: 'Folder is not empty' },
          },
        },
      },
      '/api/workspace/move': {
        post: {
          summary: 'Move a workspace node',
          description: 'parent_id must be a folder or null (root). Moving a table also updates that folder\'s group membership for scoped keys. Moving a note only changes the sidebar.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string', description: 'Workspace node id' },
                    parent_id: { type: 'string', nullable: true },
                    sort_order: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Moved' }, '400': { description: 'Invalid parent (cycle or not a folder)' } },
        },
      },
      '/api/trash': {
        get: {
          summary: 'List trash items',
          description: 'Returns deleted records and deleted table snapshots. Table snapshots have `record_id = 0` and `record_data.__kind = "table"`.',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'page_size', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            '200': { description: 'Trash list' },
          },
        },
        delete: {
          summary: 'Empty trash',
          description: 'Permanently deletes all trash items visible to the current team/user scope.',
          responses: {
            '200': { description: 'Trash emptied' },
          },
        },
      },
      '/api/trash/{id}': {
        delete: {
          summary: 'Delete one trash item permanently',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Deleted permanently' },
            '404': { description: 'Trash item not found' },
          },
        },
      },
      '/api/trash/{id}/restore': {
        post: {
          summary: 'Restore one trash item',
          description: 'Restores either a deleted record or a deleted table snapshot.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Restored successfully' },
            '404': { description: 'Trash item not found' },
            '409': { description: 'Restore blocked because the target table already exists' },
          },
        },
      },
      '/api/notes': {
        get: {
          summary: 'List notes',
          description: 'Returns notes at root level (parent_id IS NULL) by default. Pass `parent_id` to list children of a specific note. Session users see notes in the active Space; API keys see notes allowed by the key scope.',
          parameters: [
            { name: 'parent_id', in: 'query', schema: { type: 'string' }, description: 'Filter by parent note ID. Omit or pass "root" for top-level notes.' },
          ],
          responses: {
            '200': {
              description: 'Note list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', example: 'n_abc123def456' },
                            title: { type: 'string' },
                            icon: { type: 'string', nullable: true },
                            parent_id: { type: 'string', nullable: true },
                            sort_order: { type: 'integer' },
                            created_at: { type: 'integer', description: 'Unix timestamp (seconds)' },
                            updated_at: { type: 'integer', description: 'Unix timestamp (seconds)' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create note',
          description: 'Creates a new note. Content size is limited to 1MB.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'Note title; defaults to "Untitled" if omitted', example: 'Meeting notes' },
                    content: { type: 'string', description: 'Note body (Markdown); max 1MB' },
                    parent_id: { type: 'string', nullable: true, description: 'Parent note ID for the note document tree (sub-pages). Not a workspace folder.' },
                    folder_id: { type: 'string', nullable: true, description: 'Optional workspace folder node id for a root note in the sidebar. Ignored when parent_id is set. Does not change note API-key scope.' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Created successfully; returns { id, title }' },
            '400': { description: 'Invalid parent_id' },
            '413': { description: 'Content exceeds 1MB limit' },
          },
        },
      },
      '/api/notes/tree': {
        get: {
          summary: 'Get full notes tree',
          description: 'Returns all active (non-deleted, non-archived) notes (up to 500) as a flat list. Use `parent_id` to reconstruct the hierarchy client-side. Archived notes are excluded; use `/api/notes/archived` to access them.',
          responses: {
            '200': {
              description: 'Full note tree (flat list)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            title: { type: 'string' },
                            icon: { type: 'string', nullable: true },
                            parent_id: { type: 'string', nullable: true },
                            sort_order: { type: 'integer' },
                            is_locked: { type: 'integer', description: '1 = locked, 0 = unlocked' },
                            created_at: { type: 'integer' },
                            updated_at: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/notes/trash': {
        get: {
          summary: 'List deleted notes',
          description: 'Returns soft-deleted root-level notes (up to 50), ordered by deletion time descending.',
          responses: {
            '200': {
              description: 'Deleted note list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            title: { type: 'string' },
                            icon: { type: 'string', nullable: true },
                            deleted_at: { type: 'integer', description: 'Unix timestamp (seconds)' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/notes/{id}': {
        get: {
          summary: 'Get note (with content)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Note detail including content',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          title: { type: 'string' },
                          content: { type: 'string', description: 'Note body (Markdown)' },
                          icon: { type: 'string', nullable: true },
                          parent_id: { type: 'string', nullable: true },
                          sort_order: { type: 'integer' },
                          is_locked: { type: 'integer' },
                          created_at: { type: 'integer' },
                          updated_at: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': { description: 'Note not found' },
          },
        },
        patch: {
          summary: 'Update note',
          description: 'Partially update a note. Only provided fields are updated.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    content: { type: 'string', description: 'Max 1MB' },
                    icon: { type: 'string', nullable: true },
                    parent_id: { type: 'string', nullable: true, description: 'Move note to a different parent; null to move to root' },
                    sort_order: { type: 'integer' },
                    is_locked: { type: 'boolean' },
                    cover: { type: 'string', nullable: true, description: 'Storage key for cover image; null to clear' },
                    description: { type: 'string', nullable: true, description: 'Knowledge base description; null to clear' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated successfully' },
            '400': { description: 'No valid fields / circular reference' },
            '404': { description: 'Note not found' },
            '413': { description: 'Content exceeds 1MB limit' },
          },
        },
        delete: {
          summary: 'Soft-delete note (and all descendants)',
          description: 'Marks the note and all its descendants as deleted. Use `POST /api/notes/{id}/restore` to undo.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted successfully' } },
        },
      },
      '/api/notes/{id}/restore': {
        post: {
          summary: 'Restore deleted note',
          description: 'Restores a soft-deleted note and all its descendants that were deleted at the same time.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Restored successfully' },
            '404': { description: 'Deleted note not found' },
          },
        },
      },
      '/api/notes/{id}/permanent': {
        delete: {
          summary: 'Delete trashed note permanently',
          description: 'Permanently removes a note that is already in the notes trash.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Deleted permanently' },
            '404': { description: 'Trashed note not found' },
          },
        },
      },
      '/api/notes/archived': {
        get: {
          summary: 'List archived root notes (Knowledge Base)',
          description: 'Returns root notes that have archived children, aggregated with count. Used as the Knowledge Base card list.',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search keyword (matches archived note titles)' },
          ],
          responses: {
            '200': {
              description: 'Archived root note list',
              content: { 'application/json': { schema: { type: 'object', properties: {
                data: { type: 'array', items: { type: 'object', properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  icon: { type: 'string', nullable: true },
                  cover: { type: 'string', nullable: true, description: 'Storage key for cover image' },
                  description: { type: 'string', nullable: true },
                  archived_count: { type: 'integer', description: 'Number of archived notes under this root' },
                  created_at: { type: 'integer' },
                  updated_at: { type: 'integer' },
                } } },
              } } } },
            },
          },
        },
      },
      '/api/notes/{id}/archived-children': {
        get: {
          summary: 'List archived children of a root note',
          description: 'Returns all archived descendants of a root note, including non-archived intermediate path nodes to preserve tree structure.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Archived children list (flat, use parent_id to build tree)',
              content: { 'application/json': { schema: { type: 'object', properties: {
                data: { type: 'array', items: { type: 'object', properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  icon: { type: 'string', nullable: true },
                  parent_id: { type: 'string', nullable: true },
                  archived_at: { type: 'integer', nullable: true, description: 'Non-null = archived; null = path node' },
                  sort_order: { type: 'integer' },
                  created_at: { type: 'integer' },
                  updated_at: { type: 'integer' },
                } } },
              } } } },
            },
            '403': { description: 'Access denied' },
          },
        },
      },
      '/api/notes/{id}/archive': {
        post: {
          summary: 'Archive a note and its descendants',
          description: 'Sets archived_at on the note and all its descendants. Root notes (parent_id IS NULL) cannot be archived directly.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Archived successfully; returns archived_count' },
            '400': { description: 'Cannot archive root notes directly' },
            '403': { description: 'Access denied' },
            '404': { description: 'Note not found' },
          },
        },
      },
      '/api/notes/{id}/unarchive': {
        post: {
          summary: 'Unarchive a note and its descendants',
          description: 'Clears archived_at on the note and all its descendants, restoring them to the sidebar.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Unarchived successfully' },
            '403': { description: 'Access denied' },
          },
        },
      },
      '/api/notes/batch-archive': {
        post: {
          summary: 'Batch archive multiple notes',
          description: 'Archives multiple notes and their descendants in one request. Maximum 50 notes per batch.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['ids'], properties: {
              ids: { type: 'array', items: { type: 'string' }, description: 'Note IDs to archive (max 50)', maxItems: 50 },
            } } } },
          },
          responses: {
            '200': { description: 'Batch archived successfully; returns archived_count' },
            '400': { description: 'Invalid body or exceeds 50 limit' },
          },
        },
      },
      '/api/tables/{tableName}/dashboard': {
        get: {
          summary: 'Get dashboard config',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Dashboard config' },
            '404': { description: 'Table not found' },
          },
        },
        put: {
          summary: 'Save dashboard config',
          parameters: [{ name: 'tableName', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    config: { type: 'array', items: {}, description: 'Dashboard blocks/configuration array' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Saved successfully' },
            '400': { description: 'Payload too large' },
            '404': { description: 'Table not found' },
          },
        },
      },
      '/api/user/preferences': {
        get: {
          summary: 'Get user preferences',
          responses: {
            '200': { description: 'Current user preference blob' },
          },
        },
        put: {
          summary: 'Save user preferences',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            '200': { description: 'Saved successfully' },
            '400': { description: 'Payload too large' },
          },
        },
      },
      '/api/admin/users': {
        get: {
          summary: 'List users',
          description: 'Admin only.',
          responses: {
            '200': { description: 'User list' },
            '403': { description: 'Admin access required' },
          },
        },
        post: {
          summary: 'Create user',
          description: 'Admin only.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    email: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string', enum: ['admin', 'user'] },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Created successfully' },
            '403': { description: 'Admin access required' },
            '409': { description: 'User already exists' },
          },
        },
      },
      '/api/admin/users/{id}': {
        patch: {
          summary: 'Update user',
          description: 'Admin only. Updates role or status.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['admin', 'user'] },
                    status: { type: 'string', enum: ['active', 'disabled'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Updated successfully' },
            '403': { description: 'Admin access required / cannot disable self' },
            '404': { description: 'User not found' },
          },
        },
        delete: {
          summary: 'Disable user',
          description: 'Admin only. Soft-disables the user account.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Disabled successfully' },
            '403': { description: 'Admin access required / cannot disable self' },
            '404': { description: 'User not found' },
          },
        },
      },
      '/api/teams/current': {
        get: {
          summary: 'Get current team',
          responses: {
            '200': { description: 'Team detail with members' },
            '400': { description: 'No team associated with current account' },
            '404': { description: 'Team not found' },
          },
        },
        patch: {
          summary: 'Rename current team',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Renamed successfully' },
            '400': { description: 'No team / invalid body' },
          },
        },
      },
      '/api/teams': {
        get: {
          summary: 'List spaces for current signed-in user',
          security: [{ CookieAuth: [] }],
          responses: {
            '200': {
              description: 'Visible spaces for the current session user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/SpaceSummary' },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Not authenticated' },
          },
        },
        post: {
          summary: 'Create a new space and switch to it',
          security: [{ CookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Space created and selected' },
            '400': { description: 'Invalid body' },
            '401': { description: 'Not authenticated' },
          },
        },
      },
      '/api/teams/current/members': {
        post: {
          summary: 'Add team member',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    email: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Added existing user to team' },
            '201': { description: 'Created account and added to team' },
            '400': { description: 'No team / invalid body' },
            '409': { description: 'Already a member' },
          },
        },
      },
      '/api/teams/current/members/{userId}/invite': {
        post: {
          summary: 'Resend invite email to a current space member',
          security: [{ CookieAuth: [] }],
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Invite email sent' },
            '400': { description: 'No team' },
            '403': { description: 'Owner access required' },
            '404': { description: 'Member not found' },
            '502': { description: 'Mail provider failed' },
          },
        },
      },
      '/api/teams/current/invites': {
        get: {
          summary: 'List invite codes for current space',
          security: [{ CookieAuth: [] }],
          responses: {
            '200': {
              description: 'Current space invite codes',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/TeamInvite' },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'No team' },
            '403': { description: 'Owner access required' },
          },
        },
        post: {
          summary: 'Create an invite code for current space',
          security: [{ CookieAuth: [] }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    role: { type: 'string', enum: ['admin', 'member', 'viewer'], default: 'member' },
                    max_uses: { type: 'integer', nullable: true },
                    expires_in_days: { type: 'integer', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Invite code created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/TeamInvite' },
                    },
                  },
                },
              },
            },
            '400': { description: 'No team / invalid body' },
            '403': { description: 'Owner access required' },
          },
        },
      },
      '/api/teams/current/invites/{id}': {
        delete: {
          summary: 'Revoke an invite code',
          security: [{ CookieAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Invite revoked' },
            '400': { description: 'No team' },
            '403': { description: 'Owner access required' },
            '404': { description: 'Invite not found' },
          },
        },
      },
      '/api/teams/current/members/{userId}': {
        delete: {
          summary: 'Remove team member',
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': { description: 'Removed successfully' },
            '400': { description: 'Cannot remove yourself / no team' },
            '404': { description: 'User not found in this team' },
          },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Get current signed-in user',
          description: 'Returns the signed-in user, the active space, and every space the account belongs to. The legacy team field mirrors current_team for older clients.',
          security: [{ CookieAuth: [] }],
          responses: {
            '200': {
              description: 'Current session user',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/SessionUser' },
                    },
                  },
                },
              },
            },
            '401': { description: 'Not authenticated' },
          },
        },
      },
      '/api/auth/switch-space': {
        post: {
          summary: 'Switch active space for current signed-in user',
          security: [{ CookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['team_id'],
                  properties: {
                    team_id: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Active space switched' },
            '400': { description: 'Invalid body' },
            '401': { description: 'Not authenticated' },
            '403': { description: 'User is not a member of this space' },
          },
        },
      },
      '/api/auth/join': {
        post: {
          summary: 'Join a space with an invite code',
          security: [{ CookieAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['invite_code'],
                  properties: {
                    invite_code: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Joined and switched to invited space' },
            '400': { description: 'Invalid invite code or request body' },
            '401': { description: 'Not authenticated' },
            '403': { description: 'Invite cannot be used' },
            '409': { description: 'Already a member' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          summary: 'Sign in with email and password',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Signed in; sets session cookie' },
            '401': { description: 'Invalid email or password' },
          },
        },
      },
      '/api/auth/register': {
        post: {
          summary: 'Register the first admin, public user, or invite-code user',
          description: 'When invite_code is present, a new account joins the invited space even if public registration is closed.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string', minLength: 8 },
                    name: { type: 'string' },
                    invite_code: { type: 'string', description: 'Optional code created by a space owner' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Registered and signed in' },
            '403': { description: 'Registration is closed' },
            '409': { description: 'Email already registered' },
          },
        },
      },
      '/api/auth/setup-status': {
        get: {
          summary: 'Whether bootstrap registration is open',
          security: [],
          responses: { '200': { description: 'bootstrap / publicRegister flags' } },
        },
      },
      '/api/auth/forgot-password': {
        post: {
          summary: 'Request a password-reset email',
          security: [],
          responses: { '200': { description: 'Always 200 if the body is valid (does not reveal whether the email exists)' } },
        },
      },
      '/api/auth/reset-password': {
        post: {
          summary: 'Set a new password with a reset token',
          security: [],
          responses: { '200': { description: 'Password updated and signed in' }, '400': { description: 'Invalid or expired token' } },
        },
      },
      '/api/auth/logout': {
        post: {
          summary: 'Log out current session',
          security: [],
          responses: {
            '200': { description: 'Logged out successfully' },
          },
        },
      },
      '/api/files/{path}': {
        get: {
          summary: 'Proxy an uploaded file',
          description: 'Authenticated file proxy used for image display. Files are stored on the server disk.',
          parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' }, description: 'Storage key after /api/files/' }],
          responses: {
            '200': { description: 'File stream' },
            '404': { description: 'File not found' },
          },
        },
      },
      '/api/upload/image': {
        post: {
          summary: 'Upload image',
          description: 'Upload an image file (thumb + display). Returns storage paths. Use the returned paths to set image field values on records. Requires write permission.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['thumb', 'display'],
                  properties: {
                    thumb: { type: 'string', format: 'binary', description: 'Thumbnail image' },
                    display: { type: 'string', format: 'binary', description: 'Display-size image' },
                    name: { type: 'string', description: 'Original filename, defaults to "image"' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Upload successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          thumb: { type: 'string', description: 'Storage key for thumbnail' },
                          display: { type: 'string', description: 'Storage key for display image' },
                          name: { type: 'string', description: 'Original filename' },
                          size: { type: 'integer', description: 'File size in bytes' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '400': { description: 'Missing required fields' },
            '403': { description: 'Read-only key' },
          },
        },
        delete: {
          summary: 'Delete image',
          description: 'Delete uploaded image files from storage.',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['thumb', 'display'],
                  properties: {
                    thumb: { type: 'string', description: 'Storage key for thumbnail to delete' },
                    display: { type: 'string', description: 'Storage key for display image to delete' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Deleted successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          success: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
            '403': { description: 'Read-only key' },
          },
        },
      },
    },
  }
}
