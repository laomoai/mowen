# 墨问“累计余额”字段 V1 开发计划

> 执行状态（2026-09-14）：阶段 0–6 已完成，包含本地实现、自动化回归、性能门禁、生产备份与发布、真实浏览器验收和 VPS 记录。实际验收数据与回滚点见 `docs/releases/2026-09-14-v2.5.0-running-balance.md`。

## 1. 交付策略

以一个完整可验收的纵向功能交付，不先做通用公式平台。开发期间保持三条不可破坏的主线：

1. 普通表格没有累计字段时，继续使用现有快速查询和分页路径。
2. 计算结果只读、不落业务表，不改变现有收支原始数据。
3. 累计在筛选和分页前完成，不允许为了性能让余额语义变错。

## 2. 阶段与任务

### 阶段 0：基线与测试数据

交付：

- 新增固定流水 fixture：期初 `10000`，包含收入、支出、同时间、空时间和历史补录。
- 生成 10k/50k 基准数据的确定性脚本。
- 记录当前无公式列表首页、第二页和 10k 导出耗时，作为对照。

验收：基准脚本可重复运行，不写生产数据库。

### 阶段 1：迁移、类型和配置校验

主要文件：

- `migrations/0035_running_balance_fields.sql`
- `src/types.ts`
- `src/routes/fields.ts`
- `web/src/api/client.ts`

交付：

- `_field_meta.formula_config`。
- `RunningBalanceConfig` 及共享校验器。
- 虚拟字段与实体字段的合并模型。
- 创建/更新配置 API，包含类型、字段存在性、单表数量和数值范围校验。
- 被依赖字段永久删除/改为不兼容类型时的 `409 FORMULA_DEPENDENCY`；单纯隐藏仍允许。

验收：虚拟字段可通过 API 创建、读取和更新，`PRAGMA table_info` 中不出现余额列，非法引用被拒绝。

### 阶段 2：统一服务端计算管线

主要文件：

- 新增 `src/utils/computed-fields.ts`
- `src/utils/query-builder.ts`
- `src/routes/records.ts`
- `src/routes/assistant.ts`（只读字段语义）

交付：

- 经白名单验证的累计余额 SQL/CTE 生成器。
- 列表、单条和导出共用同一虚拟字段投影。
- 筛选和显示排序位于计算 CTE 外层。
- 缺少时间的记录返回空余额，且不参与其他记录的累计。
- 余额排序改用 page/OFFSET，避免单 `id` 游标与计算排序冲突。
- 无累计字段的表不经过 CTE，保持当前查询路径。

验收：需求文档中的数值、筛选、分页、排序和导出用例全部通过。

### 阶段 3：前端配置和只读展示

主要文件：

- `web/src/components/FieldPanel.vue`
- `web/src/components/DataGrid.vue`
- `web/src/components/RowExpand.vue`
- `web/src/components/CellValue.vue`
- `web/src/api/client.ts`

交付：

- 字段类型“累计余额”和结构化配置面板。
- 收入/支出下拉框只显示数字/货币实体字段，时间下拉框只显示日期/日期时间实体字段。
- 配置摘要与“整列重算”确认。
- 表格单元格和行详情只读；缺少时间时显示错误提示。
- 新建表弹窗 V1 暂不提供累计余额，避免在依赖字段尚未落库时配置引用；用户建表后再从字段面板添加。

验收：真实浏览器中完成创建、展示、修改配置、修改历史流水、补录和删除流水的完整流程。

### 阶段 4：版本、权限和回归

主要文件：

- `src/routes/records.ts`
- `src/routes/fields.ts`
- `src/utils/table-revisions.ts`
- `scripts/smoke-running-balance.ts`
- `src/index.ts`（OpenAPI）

交付：

- 整表恢复后的自动重算验收。
- 历史差异不把虚拟余额写入 before/after JSON。
- Web session、全表 API Key 和 `scope=groups` API Key 的读写边界回归。
- OpenAPI 补齐字段配置、只读返回值和错误码。
- 现有 `smoke:revisions`、`smoke:multi-space`、`smoke:viewer` 全部通过。

验收：新增烟测与既有回归烟测都通过。

### 阶段 5：性能门禁

交付：

- 为配置的时间字段与 `id` 创建安全联合索引。
- 10k/50k 数据集下的冷/暖查询、第二页、筛选、余额排序和 10k 导出报告。
- 与阶段 0 基线比较，记录扫描行数和内存峰值。

决策门：

- 达标：进入发布。
- 10k 达标、50k 不达标：明确 V1 表行数上限并准备检查点方案。
- 10k 不达标：暂停发布，不用物化写回掩盖查询设计问题。

### 阶段 6：发布与验收

步骤：

1. 检查 Git 范围和未跟踪文件，完成 TypeScript、Web build、全部烟测和 `git diff --check`。
2. 发布前读取 VPS 实际 release、数据库、空间和服务状态。
3. 使用 SQLite `.backup` 建立一致性回滚点，验证 `PRAGMA quick_check` 和 SHA-256。
4. 创建独立 release，执行 `0035`，原子切换 `/opt/mowen/current`并重启 `mowen.service`。
5. 验证本机/公网健康、SQLite、OpenAPI、Nginx、备份 timer 和新查询性能。
6. 真实浏览器中用隔离验收表走完业务流；不改用户现有收支表。
7. 更新 VPS `CHANGELOG.md` / `SERVER_STATUS.md`，记录 release、备份和回滚命令。
8. 只对本功能文件形成专用 Git commit 并推送，确认 `HEAD == origin/main` 且工作区干净。

## 3. 测试矩阵

| 类别 | 用例 |
|---|---|
| 数值 | 收入、支出、只收入、只支出、负期初、空值、小数舍入 |
| 顺序 | 不同日期、同时间多条、补录历史、空时间 |
| 变更 | 新增、修改、删除、批量新增、回收站恢复、整表恢复 |
| 查询 | 首页、第二页、物理字段筛选、余额筛选、物理列排序、余额排序 |
| 输出 | Web 网格、行详情、API 列表、API 单条、CSV、JSON |
| 权限 | Web session、readonly key、readwrite key、groups scope、跨 Space 禁止 |
| 依赖 | 隐藏被引用字段仍可计算；永久删除/改类型被拒绝；重复新增累计字段被拒绝 |
| 性能 | 10k/50k 首页、后续页、筛选、排序、导出、内存峰值 |

## 4. 预估

在不扩展多账户、通用公式和公式历史的前提下，预计为 `5–8` 个有效开发日：

- 后端数据模型与查询：2–3 日。
- 前端配置与只读展示：1–2 日。
- 回归、性能、浏览器验收和发布：2–3 日。

此预估是范围控制工具，不代替阶段 0/5 的真实基准。如性能门禁要求引入累计检查点，必须单独重估工期。

## 5. 开发完成定义

- 三份设计/需求/计划文档与实现一致。
- 需求验收标准和测试矩阵全部有可重复证据。
- 无累计字段的表格不受查询性能回归。
- 累计余额在列表、详情、筛选、排序、分页、导出和历史恢复后的结果一致。
- 生产发布有 SQLite 备份、旧 release 指针、服务验收和 VPS 变更记录。
- Git 提交、推送和生产 release 可相互对应。
