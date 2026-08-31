# 多空间与邀请码注册技术方案审查与开发计划

日期：2026-08-31

当前基线提交：`0160369 docs: evaluate multi-space invite registration`

## 技术方案审查

### 总体判断

方案可行，推荐按“先数据模型，后认证，最后 UI”的顺序开发。现有系统的表格、笔记、文件夹、附件、API Key 已经普遍带 `team_id`，因此升级成本主要集中在“用户和空间关系”以及“当前空间选择”。

不建议为了快速上线继续扩展 `_users.team_id`。这个字段只能表达一个归属，一旦一个邮箱进入多个空间，所有基于 `_users.team_id` 的判断都会变成隐性权限漏洞或产品限制。

### 必须坚持的设计决策

1. 用户身份和空间成员关系分离。
   - `_users` 只表示账号。
   - `_team_members` 表示账号属于哪些空间，以及在每个空间里的角色。

2. 当前空间必须是显式概念。
   - Web 登录态必须能确定 active team。
   - 所有业务路由仍然只接收一个 `teamId`，这样现有数据隔离逻辑可以最大限度复用。

3. API Key 继续绑定单个空间。
   - 小程序输入哪个 Key，就看到该 Key 所属空间。
   - 不让一个 Key 横跨多个空间，避免只读阅读器权限变复杂。

4. 邀请码必须独立建表。
   - 不复用 `_password_resets`。
   - 数据库存 hash，不存明文邀请码。
   - 必须支持过期、撤销、使用次数。

5. 移除成员不等于删除账号。
   - 从某个空间移除成员，只删除 `_team_members` 关系。
   - 如果用户还在其他空间，账号必须保留。

## 关键代码审查

### 数据库

当前已有：

- `_teams`
- `_users.team_id`
- `_meta.team_id`
- `_groups.team_id`
- `_notes.team_id`
- `_workspace_nodes.team_id`
- `_api_keys.team_id`
- `_files.team_id`

需要新增：

- `_team_members`
- `_team_invites`
- `_users.current_team_id`

需要保留兼容：

- `_users.team_id` 暂时保留，迁移和旧代码过渡用。
- 等所有查询都切到 `_team_members/current_team_id` 后，再考虑废弃。

### 认证中间件

当前 `src/middleware/auth.ts`：

- session 登录后读取 `_users.team_id`
- API Key 登录后读取 `_api_keys.team_id`

调整原则：

- session：从 `_users.current_team_id` 读取当前空间，并校验 `_team_members` 中存在 active 成员关系。
- API Key：仍从 `_api_keys.team_id` 读取，不依赖用户当前空间。
- ADMIN_KEY：仍可无 `teamId`，保留系统级能力。

风险点：

- 如果只更新 `_users.current_team_id`，但不校验 membership，被篡改数据库时会产生越权。
- 如果 `current_team_id` 为空，要自动选择第一个 active membership 或返回 `NO_TEAM`。

### 注册与登录

当前 `src/routes/auth.ts`：

- `/register` 只有 bootstrap 或 `ALLOW_PUBLIC_REGISTER=true` 才允许。
- 普通注册会自动创建个人 `_teams` 并把 `_users.team_id` 指向它。
- 邀请邮件复用 `_password_resets`。

调整原则：

- bootstrap 注册仍创建第一个 admin 和个人空间。
- 非 bootstrap 注册：
  - 有有效邀请码：允许注册并加入邀请空间。
  - `ALLOW_PUBLIC_REGISTER=true` 且无邀请码：允许注册并创建个人空间。
  - 其他情况拒绝。
- 登录后如果 `current_team_id` 不可用，自动选第一个 active membership。

### 空间与成员接口

当前 `src/routes/teams.ts` 和 `src/routes/administration.ts`：

- 成员列表从 `_users WHERE team_id = ?` 取。
- 添加成员时禁止已有邮箱加入另一个空间。
- 移除成员调用 `hardDeleteMember`，会删除用户账号。

必须调整：

- 成员列表从 `_team_members JOIN _users` 取。
- 添加成员：
  - 已有用户：插入 membership。
  - 新用户：创建用户，再插入 membership，并发送邀请/设置密码入口。
- 移除成员：删除 membership，不硬删用户。
- owner 不能移除自己，owner 转让以后才可离开空间。

### 管理后台

当前 `src/routes/admin.ts` 和 `src/routes/administration.ts` 仍有不少 `_users.team_id` 统计和展示逻辑。

调整原则：

- 用户列表展示用户拥有的空间列表或当前空间，不再只展示单个 `team_name`。
- 空间成员统计从 `_team_members` 聚合。
- 删除空间时：
  - 删除该空间业务数据。
  - 删除该空间 memberships。
  - 不删除仍属于其他空间的用户。

### Web UI

当前：

- 设置页已有“空间名称、成员、API Key”。
- 管理后台已有“空间列表、添加空间、空间详情”。
- 登录页暂无邀请码字段。
- App 顶部/侧栏暂无空间切换器。

推荐：

- `AppLayout` 顶部增加当前空间切换器。
- `Settings` 空间 Tab 增加邀请码管理。
- `LoginPage` 注册模式增加邀请码输入框。
- `Administration` 改成 membership 视角，文案避免“移除成员会删除账号”。

### 小程序

小程序暂不做多空间账号登录。

保持：

- 继续输入 API Key。
- `/api/viewer/me` 返回 Key 绑定空间。
- 最近访问按 `baseUrl + apiKey` 隔离。

需要回归：

- 多空间后创建的 API Key 必须只读到 Key 所属空间。
- 设置页显示的头像、姓名、邮箱、当前工作空间仍来自 `/api/viewer/me`。

## 数据迁移设计

新增迁移建议为 `0031_multi_space_memberships.sql`。

迁移内容：

```sql
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
```

注意：SQLite 的 `ALTER TABLE ADD COLUMN` 不能直接重复执行；本项目迁移文件按顺序只执行一次，符合当前迁移机制。

## 接口计划

### Auth

新增/调整：

- `GET /api/auth/me`
  - 返回 `current_team` 和 `spaces`。
- `POST /api/auth/register`
  - body 支持 `invite_code`。
- `POST /api/auth/switch-space`
  - body: `{ team_id }`
  - 更新 `_users.current_team_id`。
- `POST /api/auth/join`
  - 已登录用户用邀请码加入空间。

### Teams

新增/调整：

- `GET /api/teams`
  - 当前用户可访问空间列表。
- `POST /api/teams`
  - 创建新空间。
- `GET /api/teams/current`
  - 从 active team 查空间详情和成员。
- `POST /api/teams/current/members`
  - 支持已有用户加入当前空间。
- `DELETE /api/teams/current/members/:userId`
  - 只移除 membership。
- `POST /api/teams/current/invites`
  - 创建邀请码。
- `GET /api/teams/current/invites`
  - 列出邀请码。
- `DELETE /api/teams/current/invites/:id`
  - 撤销邀请码。

### Administration

调整：

- 空间成员统计从 `_team_members` 来。
- 空间成员详情从 `_team_members JOIN _users` 来。
- 添加成员支持已有用户。
- 移除成员不删除账号。
- 删除空间不删除仍在其他空间的账号。

## 开发计划

### 阶段 0：保护当前稳定版本

目标：

- 当前小程序和 Web 功能已有 GitHub 基线。
- 本技术方案入库。

验收：

- GitHub 有评估文档和技术计划。
- 未跟踪品牌图片不混入提交。

### 阶段 1：数据库和服务层

目标：

- 添加迁移。
- 添加 `src/utils/team-members.ts` 或扩展 `src/utils/members.ts`。

任务：

1. 新增 `0031_multi_space_memberships.sql`。
2. 实现：
   - `listUserSpaces(db, userId)`
   - `getActiveTeamForUser(db, userId)`
   - `setActiveTeam(db, userId, teamId)`
   - `assertTeamMember(db, userId, teamId)`
   - `addTeamMember(db, teamId, userId, role, invitedBy)`
   - `removeTeamMember(db, teamId, userId)`
   - `createInvite(db, teamId, opts)`
   - `redeemInvite(db, code, userId)`
3. 增加单元/脚本级 smoke 检查。

验收：

- 旧用户迁移后 `_team_members` 有对应记录。
- `current_team_id` 正确回填。
- 重复运行迁移不会破坏数据。

### 阶段 2：认证链路

目标：

- session 登录的 `teamId` 从 active team 来。

任务：

1. 改 `authMiddleware`。
2. 改 `/api/auth/me` 返回 spaces/current_team。
3. 改登录后 active team 兜底。
4. 新增 `/api/auth/switch-space`。

验收：

- 单空间老账号登录无感。
- 多空间账号切换后，`/api/workspace/tree` 数据随空间变化。
- 非成员不能切换到该空间。

### 阶段 3：邀请码注册与加入

目标：

- 有邀请码即可注册。
- 已登录用户可用邀请码加入空间。

任务：

1. 改 `/api/auth/register` 支持 `invite_code`。
2. 新增 `/api/auth/join`。
3. 邀请码 hash、过期、撤销、次数限制。
4. 注册页增加邀请码输入。

验收：

- 关闭公开注册时，邀请码注册成功。
- 无邀请码注册仍按原规则拒绝。
- 邀请码过期/撤销/超次数失败。
- 已存在邮箱不能被未登录注册流程劫持。

### 阶段 4：空间和成员管理

目标：

- 当前空间成员管理完全改成 membership。

任务：

1. 改 `/api/teams/current`。
2. 改添加成员、重发邀请、移除成员。
3. 新增邀请码管理接口。
4. 设置页增加邀请码管理 UI。

验收：

- 已有用户可加入第二个空间。
- 移除 A 空间成员后，用户在 B 空间仍可用。
- owner 保护有效。

### 阶段 5：Web 空间切换

目标：

- 多空间用户能在 Web 内清晰切换空间。

任务：

1. `client.ts` 更新类型和 API。
2. `router` auth cache 支持 spaces/current_team。
3. `AppLayout` 增加空间切换器。
4. 切换后刷新 workspace、tables、notes、settings、assistant 相关 query cache。

验收：

- 切换空间后列表立即变化。
- 浏览器刷新后仍进入上次 current space。
- 多空间下 API Key 创建绑定当前空间。

### 阶段 6：管理后台与删除逻辑

目标：

- Admin 视角与多空间模型一致。

任务：

1. 改 `/api/admin/spaces` 统计。
2. 改空间详情成员查询。
3. 改添加成员和移除成员。
4. 改 `hardDeleteSpace`：删除 memberships，不误删多空间用户。
5. 更新管理后台文案。

验收：

- 删除空间不会删除仍属于其他空间的用户。
- 空间成员数准确。
- 管理后台添加已有用户到空间成功。

### 阶段 7：小程序回归

目标：

- 小程序不新增多空间登录，但继续正确读取 API Key 所属空间。

任务：

1. 回归 `/api/viewer/me`。
2. 回归 `/api/viewer/workspace`。
3. 回归 note/table/detail/image。
4. 确认最近访问仍按 API Key 隔离。

验收：

- 同一用户两个空间各创建一个 API Key，小程序输入不同 Key 显示不同空间。
- 设置页显示实际空间名、头像、邮箱。
- 图片、emoji、表格筛选保持正常。

## 测试计划

### 后端 smoke

建议新增 `scripts/smoke-multi-space.ts`：

覆盖：

- bootstrap 用户迁移
- 创建第二空间
- 邀请码注册新用户
- 已有用户加入第二空间
- 切换空间
- 创建 API Key 并验证 viewer workspace
- 移除 membership

### Web build

每阶段至少执行：

```bash
npm run build:web
```

### Viewer smoke

保持：

```bash
npm run smoke:viewer
```

并扩展为多空间 Key 验证。

## 上线策略

推荐 Preview/本地先跑完整迁移和 smoke，再部署生产。

生产部署前必须确认：

- 数据库已备份。
- 迁移可前向执行。
- 至少一个管理员账号迁移后仍有 owner membership。
- 当前 `SESSION_SECRET` 不变，否则用户会全部掉登录。

生产部署后验证：

- 老账号登录。
- 原空间数据完整。
- 创建邀请码。
- 邀请码注册。
- 多空间切换。
- 小程序 API Key 读取。

## 不建议同时做的事

- 小程序账号登录和空间切换。
- 空间级细粒度权限矩阵。
- owner 转让和审计日志。
- 邀请码公开落地页。
- 废弃 `_users.team_id` 字段。

这些可以排到第二阶段，避免第一阶段权限模型过大。
