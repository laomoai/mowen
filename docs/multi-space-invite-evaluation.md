# 多空间与邀请码注册评估

日期：2026-08-31

## 结论

可以升级，而且现在的代码已经有一半基础：业务数据大多已经按 `team_id` 隔离，`_teams` 已经承担“空间”概念，Web 和小程序的只读接口也都通过当前 `teamId` 取数据。

但当前模型仍是“一个用户只属于一个空间”：`_users.team_id` 是单值，`/api/auth/me`、`/api/teams/current`、成员管理、管理后台、API Key 创建都默认一个用户只有一个当前空间。所以要升级为“每个人多个空间”，核心不是 UI，而是权限模型升级。

推荐采用渐进升级：

1. 先引入成员关系表，让用户可以属于多个空间。
2. 保留 `_users.team_id` 作为短期兼容字段，逐步改为 `current_team_id` 或会话中的 active space。
3. 邀请码注册先走“加入指定空间”的闭环，再扩展邮箱邀请和管理员创建空间。
4. 小程序仍保持 API Key 模式；API Key 继续绑定一个空间，不建议一个 Key 跨多个空间。

## 当前结构

### 已有能力

- `_teams`：空间表，字段包括 `id`、`name`、`created_by`。
- `_users.team_id`：当前用户所属空间，但只能存一个。
- `_meta`、`_groups`、`_notes`、`_workspace_nodes`、`_api_keys`、`_files` 等已有 `team_id`。
- `authMiddleware` 会把 session/API Key 转成 `teamId`，后续路由用 `teamId` 做数据隔离。
- `/api/teams/current` 可查看和管理当前空间成员。
- 管理后台 `/api/admin/spaces` 已有空间管理雏形。
- 邀请邮件已有，但复用了 `_password_resets` 作为邀请 token。

### 当前限制

- 一个邮箱只能有一个 `_users` 记录，而且 `_users.team_id` 只能指向一个空间。
- 添加成员时，如果邮箱已经存在，会返回“已经属于另一个空间”，不能加入第二个空间。
- session 里没有 active space，`authMiddleware` 只能从 `_users.team_id` 推出当前空间。
- 管理后台的成员统计和删除逻辑都基于 `_users.team_id`。
- 邀请不是独立实体，缺少邀请状态、邀请空间、角色、过期、最大使用次数等信息。

## 推荐目标模型

### 空间成员表

新增：

```sql
CREATE TABLE _team_members (
  team_id INTEGER NOT NULL REFERENCES _teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  invited_by INTEGER REFERENCES _users(id),
  PRIMARY KEY (team_id, user_id)
);
```

建议角色：

- `owner`：空间拥有者，可删除空间、转让空间、管理成员。
- `admin`：可管理内容和成员，但不能删除/转让空间。
- `member`：普通编辑成员。
- `viewer`：只读成员，后续可选。

短期可以只实现 `owner` / `member`，但表结构预留 `role`。

### 当前空间

推荐新增 `_users.current_team_id`，而不是继续用 `_users.team_id` 表达归属。

```sql
ALTER TABLE _users ADD COLUMN current_team_id INTEGER REFERENCES _teams(id);
```

迁移时：

- 用现有 `_users.team_id` 批量填充 `_team_members`。
- 把 `_users.current_team_id` 设置为原 `_users.team_id`。
- 暂时保留 `_users.team_id` 作为兼容字段，等全站改完再废弃。

### 邀请码

新增独立邀请表，不建议继续复用 `_password_resets`：

```sql
CREATE TABLE _team_invites (
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
```

用户看到的是明文邀请码，数据库只存 hash，避免泄露后无法撤回。

邀请码注册流程：

1. 用户打开注册页，输入邮箱、密码、邀请码。
2. 后端校验邀请码未撤销、未过期、未超过使用次数。
3. 如果邮箱不存在：创建用户，加入邀请对应空间，设置 `current_team_id`。
4. 如果邮箱已存在且已登录：加入该空间，不重复创建用户。
5. 如果邮箱已存在但未登录：提示先登录再使用邀请码加入空间。

## 接口改造

### 认证

需要改：

- `GET /api/auth/me`
  - 返回当前空间 `current_team`。
  - 返回用户可访问空间列表 `spaces`。
- `POST /api/auth/register`
  - 支持 `invite_code`。
  - 非首次注册时，如果未开放公开注册且没有邀请码，继续拒绝。
- 新增 `POST /api/auth/switch-space`
  - body: `{ team_id }`
  - 校验用户是该空间成员。
  - 更新 `_users.current_team_id`，或写入 session 中的 active team。

建议返回：

```json
{
  "data": {
    "id": 1,
    "email": "a@example.com",
    "name": "老墨",
    "current_team": { "id": 10, "name": "个人空间", "role": "owner" },
    "spaces": [
      { "id": 10, "name": "个人空间", "role": "owner" },
      { "id": 12, "name": "项目空间", "role": "member" }
    ]
  }
}
```

### 空间

建议新增/调整：

- `GET /api/teams`：当前用户所有空间。
- `POST /api/teams`：创建新空间，创建者自动成为 owner。
- `GET /api/teams/current`：改用 active team，不再查 `_users.team_id`。
- `POST /api/teams/current/invites`：创建邀请码。
- `GET /api/teams/current/invites`：查看邀请码。
- `DELETE /api/teams/current/invites/:id`：撤销邀请码。
- `POST /api/teams/join`：已登录用户用邀请码加入空间。

### API Key

建议保持“一个 API Key 只属于一个空间”：

- 创建 Key 时绑定当前 active team。
- `/api/viewer/me` 返回该 Key 所属空间。
- 小程序本地最近访问仍按 `baseUrl + apiKey` 隔离即可。

这样对小程序最稳，不需要在小程序里做多空间登录。

## Web UI 改造

推荐改动：

- 左侧顶部或设置页增加空间切换器。
- 设置页“当前工作空间”改成：
  - 当前空间名称
  - 我的角色
  - 成员管理
  - 邀请码管理
- 注册页增加邀请码输入框。
- 登录后如果用户有多个空间，默认进入 `current_team_id`；没有则进入第一个可访问空间。
- 管理后台从“用户只属于一个空间”改成 membership 视角。

## 小程序影响

短期影响不大：

- 小程序继续输入 API Key。
- API Key 绑定哪个空间，小程序就展示哪个空间。
- 设置页的工作空间信息来自 `/api/viewer/me`，会自动显示实际空间。

未来如果要小程序也支持账号登录和空间切换，那是第二阶段，不建议和这次一起做。

## 迁移风险

主要风险在四处：

1. 权限遗漏：所有 `teamId` 来源必须从 active team 来，不能残留 `_users.team_id`。
2. 成员删除：不能再硬删 `_users`，应删除 `_team_members` 关系；只有用户没有任何空间时才考虑禁用或保留空账号。
3. 空间删除：删除空间应删除该空间 membership 和空间数据，但不要删除同时属于其他空间的用户。
4. 邀请安全：邀请码应存 hash，支持过期、撤销、使用次数限制，避免永久有效明文码。

## 推荐开发顺序

1. 新增迁移：`_team_members`、`_team_invites`、`_users.current_team_id`，并从 `_users.team_id` 回填。
2. 新增成员/空间工具函数：获取 active team、校验 membership、创建个人空间、加入空间。
3. 改 `authMiddleware`：session 用户用 `current_team_id` + membership 推出 `teamId`。
4. 改 `/api/auth/me`、注册、登录、切换空间。
5. 改 `/api/teams/current` 和成员管理，从 `_users.team_id` 改 `_team_members`。
6. 改管理后台空间接口，避免删除成员时硬删用户。
7. Web UI 增加空间切换、邀请码创建、邀请码注册。
8. 回归测试：单空间旧用户、多空间同一用户、邀请码注册、已登录加入空间、API Key 访问、小程序 viewer。

## 建议验收用例

- 旧账号迁移后仍能登录，原空间数据不变。
- 一个用户创建第二个空间后，可在两个空间间切换，数据完全隔离。
- A 空间邀请已存在账号加入，不会创建第二个用户。
- 删除 A 空间成员时，该用户在 B 空间仍可正常使用。
- 邀请码过期、撤销、超过次数后都无法使用。
- API Key 创建后只访问所属空间，小程序显示对应空间名称和内容。
- 管理后台空间列表的成员数、表数、笔记数正确。
