# 墨问数据安全、备份与版本管理方案

## 1. 目标与边界

本文保留完整方案评估。截至 2026-09-14，其中“VPS 本机 SQLite 每小时在线备份”与“笔记/整表历史版本”已在生产启用；附件备份、自动保留清理、R2/本地异地副本、审计日志和恢复演练仍未实施。当前准确的上线范围与回滚方式见 `docs/releases/2026-09-14-v2.4.0-data-safety-versioning.md`。

需要同时解决四类问题：

1. **主机或磁盘故障**：恢复 SQLite、上传图片和运行配置。
2. **误删与错误修改**：用户可以恢复单条记录、笔记或整张表，而不需要回滚整库。
3. **账号或服务器被入侵**：攻击者即使获得生产机写权限，也不能删掉所有备份。
4. **操作可追溯**：能回答谁在什么时候修改、删除或恢复了什么。

备份、回收站、版本历史和审计日志是四个不同的能力，不能相互替代。

## 2. 现状与缺口

### 已有基础

- 后端是 Node + Hono + SQLite，SQLite 使用 WAL、`busy_timeout=5000`、外键和 `synchronous=NORMAL`。
- 数据默认位于 `DATA_DIR`：数据库为 `mowen.sqlite`，图片为 `files/`。两者必须作为一个恢复单元考虑。
- 记录删除和表删除会把 JSON 快照放入 `_trash`；表快照包含字段、行、分组、链接和仪表盘元数据。
- `_trash` 的目标保留期是 30 天。笔记使用 `deleted_at` 软删除，可恢复同一次删除的子树。
- 部署清单已声明使用 `sqlite3 ... ".backup ..."` 和 `PRAGMA quick_check`。

### 主要缺口

1. **当前不能证明有自动备份**。仓库只有一条部署清单中的备份命令，而且目标文件名固定，反复执行会覆盖上一份；没有调度、保留策略、异地副本、失败告警和恢复演练证据。
2. **回收站与主库处于同一故障域**。SQLite 文件损坏、磁盘丢失或 Space 整体硬删除时，回收站不能救援。
3. **30 天清理依赖访问回收站接口触发**，不是可观测的定时任务。笔记软删除又是另一套机制，保留语义不统一。
4. **只保护“删除”，不保护“修改”**。记录更新、笔记编辑、字段类型/选项调整和工作区移动都没有用户可见的历史版本。
5. **图片和数据库可能不一致**。图片在本地目录即时写入和删除，只备份 SQLite 会丢附件；无停机地分别备份 DB 和 `files/` 也可能产生时间窗口。
6. **备份包含高敏感数据**。密码哈希在库内，而 `0028_api_key_plain.sql` 还增加了 API Key 明文列。备份如果未加密，会把单点泄露扩大为历史多副本泄露。
7. **没有审计链**。现有数据可告诉我们当前是什么，但不能稳定说明是谁以哪种身份通过哪个请求改成这样的。

## 3. 三种可选方案

| 方案 | 内容 | 优点 | 缺点 | 适合情况 |
|---|---|---|---|---|
| A. 运维备份型 | SQLite 定时快照 + `files/` + 异地加密备份 + 恢复演练 | 成本最低，能先解决主机损坏和整库误操作 | 单条内容回退需管理员从整库快照提取，用户不能自助看版本 | 要尽快建立灾备底线 |
| B. 混合保护型（推荐） | A + 笔记/记录/表结构修订历史 + 审计日志 + 恢复 UI | 既能整体灾备，又能快速恢复单个对象；与现有 SQLite 和动态表模型相容 | 要改写入路径和 UI，需要定义版本合并/保留规则 | 当前产品阶段最均衡的选择 |
| C. 全量事件溯源/PITR 型 | 每次变更写不可变事件，用快照+事件重放到任意时点 | 理论上追溯和时点恢复最强 | 需重构所有写入、幂等、模式演进和重放逻辑；动态表使复杂度更高 | 只有合规或大规模协作真正要求时再做 |

### 结论

建议选 **B 混合保护型**，但分三期实施。先完成 A，确保“有数据可恢复”；再加入用户可见的版本和审计。不建议现在引入全量事件溯源，它会迫使动态表格的每一个 DDL/DML 路径都改为可重放事件，付出远高于当前收益。

### 产品功能拆分决策

数据安全按两个独立功能交付：

1. **SQLite 整库备份**：使用 VPS 外部维护脚本 + systemd timer 调度 `.backup`、校验、保留和异地上传。它不改墨问应用代码。
2. **应用级版本**：对记录和笔记保存历史、显示差异并恢复为新版本，详见 `docs/application-versioning-design.md`。

Cloudflare 异地目标选 **R2，不选 D1**：

- D1 不支持直接导入原始 `.sqlite` 文件，需要先 `.dump` 为 SQL，修改与 D1 不兼容的语句，再执行导入。
- 把 VPS SQLite 持续同步到 D1 需要增量变更捕获、幂等、删除同步和动态表结构同步，已经不是低侵入备份。
- D1 Time Travel 只保护已写入 D1 的数据，不会自动保护 VPS 上的原始 SQLite。
- R2 是对象/文件存储，可直接接收带时间戳的 `.sqlite` 快照、manifest 和附件备份，不需要转换数据模型。
- R2 可为备份前缀设置 Bucket Lock，在指定期限内防止对象被删除或覆盖；保留到期后再由 lifecycle 清理。

推荐的副本关系：

```text
VPS 生产 SQLite
  -> VPS 本机轮转快照（快速恢复）
  -> Cloudflare R2 锁定快照（主机级灾备）
  -> Mac/其他存储定期下载（可选第三副本）
```

只下载到 Mac 也可行，但 Mac 关机、断网或磁盘离线时会中断备份，因此不宜作为唯一异地副本。

## 3.1 SQLite 本身可用的低侵入备份能力

| SQLite 能力 | 能否在线执行 | 侵入程度 | 对本项目的判断 |
|---|---:|---:|---|
| CLI `.backup` / Online Backup API | 可以 | 极低 | **首选**。应用无需停机，无需改代码或表结构，生成备份开始时点的一致快照 |
| `VACUUM INTO` | 可以 | 极低 | 适合较低频的紧凑归档；会重写整份数据，CPU/I/O 比 `.backup` 更高 |
| `sqlite3_rsync` | 可以 | 低 | 可通过 SSH 直接生成远端一致副本，节省传输；但不自带多版本保留，且需确认生产两端安装的 SQLite 版本/工具兼容 |
| Session Extension changeset | 可以 | 中高 | 能捕获行变更和生成可反转 changeset，但需嵌入数据库连接和处理表结构变化，不是零侵入备份 |
| Snapshot API | 是读取快照 | 高 | 用于在 WAL 中重开历史读事务，不是独立持久备份，不应当作灾备 |
| `.dump` | 可以读出 | 低 | 逻辑 SQL 导出适合人工审查/跨版本迁移，恢复慢且不如数据库快照完整，不作为主备份 |
| `.recover` | 不适用 | — | 它是数据库已损坏后的尽力抢救工具，不是备份方案 |

SQLite 的“增量 Online Backup”指分页、分步复制，以减少长时间锁定；最终输出仍是一份完整数据库。它不是像 PostgreSQL WAL 归档一样的持续时点恢复。

对墨问最低侵入的第一版可以完全在应用外部完成：

```text
systemd timer
  -> sqlite3 在线 .backup 到临时文件
  -> 对备份文件执行 PRAGMA quick_check
  -> 校验通过后原子改名为带时间戳的快照
  -> 按 24 小时 / 30 日 / 12 周 / 12 月保留
  -> 将已校验快照复制到异机或对象存储
```

这个流程不调用墨问 API，不修改 Hono/better-sqlite3 代码，不添加迁移，也不需要停掉 `mowen.service`。它与当前 `deploy/vps-deploy.json` 已声明的 `.backup` 方向一致，但要把当前固定目标文件改为带时间戳的临时文件和原子改名，否则每次备份会覆盖上一份。

但要明确两个边界：

1. SQLite 只认识 `mowen.sqlite` 内的数据，不会备份 `DATA_DIR/files/` 中的图片。如果要完整恢复产品，图片仍须单独备份。
2. 定时 SQLite 快照可以把整库回到某个时间点，但不会自动给用户提供“只恢复这篇笔记的上一版”。后者仍属于应用级版本功能。

## 4. 推荐方案设计

### 4.1 第一层：可验证的整体备份

#### 备份节奏

- 每 15 分钟：使用 SQLite Online Backup（CLI `.backup`）生成带时间戳的数据库快照，保留 24 小时。
- 每小时：把最新已校验数据库快照和 `files/` 写入加密、去重的备份仓库。
- 保留策略：24 个小时版、30 个日版、12 个周版、12 个月版；实际数量再按数据增长和成本调整。
- 每日：至少一份上传到与 VPS 分离的 OSS Bucket。
- 每月：在隔离临时目录执行一次真实恢复演练，不覆盖生产库。

#### 一致性做法

SQLite 开启 WAL 时不能用普通 `cp` 只复制正在写的主文件。应该使用 `.backup`/Online Backup API 或 `VACUUM INTO` 获得一致快照。本项目更适合 `.backup`：它所需 CPU 更少且可增量读取；`VACUUM INTO` 更适合偶尔生成紧凑的归档副本。

图片对象是 UUID 路径且不会原地覆盖，这对备份有利；但当前删除是立即物理删除。建议改为：

1. 删除时先把 `_files` 标记为 `deleted_at`，不立即删物理文件。
2. 至少延迟 48 小时且确认已有一份成功异地快照后，再清理对象。
3. 每个备份生成 `manifest.json`，记录快照时间、应用提交、迁移版本、DB SHA-256、文件数、文件字节数和工具版本。

如果需要强一致的数据库+文件包，可每日设置一个很短的写入维护窗口：暂停写入、生成 DB 快照、快照 `files/`、恢复写入。它比一开始引入分布式存储更可控。

#### 异地和不可变

- 可选工具：`restic` 备份到阿里云 OSS，利用客户端加密、去重、快照和保留策略。
- VPS 上的备份身份只允许向专用前缀写入，不给 Bucket 管理权。执行删除/裁剪的高权限凭据放在另一个管理环境。
- OSS 端开启版本管理；如需抗入侵删库，再对专用 Bucket 设置 30 天 WORM 保留。WORM 锁定后不可缩短或取消，必须先在测试 Bucket 验证成本和清理流程。
- 不把 OSS 挂载目录当作生产 SQLite 盘；OSS 是备份目标，不是 SQLite 文件系统的替代品。

### 4.2 第二层：用户可见的版本历史

建议使用统一的 `_revisions` 表，由应用层写入，不要给每张动态表生成一套 SQLite trigger。可用的核心字段：

```text
id, team_id, entity_type, entity_id, entity_version,
operation, snapshot_json, actor_type, actor_id, api_key_id,
request_id, created_at
```

版本范围按价值排序：

1. **笔记**：保存 title/content/icon/cover/description/parent 的快照。自动保存要在同一用户、同一笔记的 30–60 秒窗口内合并，避免每个按键都生成版本。
2. **数据记录**：每次更新保存行快照，创建/删除/恢复也作为版本。
3. **表结构**：字段新增、隐藏、重命名、选项变更保存结构快照；第一版只支持“查看差异”，不自动回滚 DDL。
4. **工作区结构**：文件夹移动、表/笔记移动和归档先记审计日志；必要时再做回滚。

恢复旧版本时，不覆盖或删除历史，而是把选中快照复制成一个**新的当前版本**。这样可以反向撤销一次错误恢复。

还应给笔记和记录增加版本号/乐观锁。客户端使用 `If-Match` 或在请求中带 `base_version`；服务端发现版本落后时返回 409，避免两个端相互覆盖。

建议默认保留每个对象最近 100 个版本或 90 天，对用户手动命名/锁定的版本不自动清理。

### 4.3 第三层：审计日志

审计日志不应等同于版本快照。建议独立 `_audit_events`：

- `team_id`、actor 类型/用户/API Key、action、entity type/id、request id、时间、结果。
- 可记 IP 摘要和 User-Agent，但要设置保留期和隐私边界。
- 不记密码、Session Cookie、API Key 明文、完整请求头或笔记正文。
- 对 Space 删除、成员移除、Key 创建/撤销、批量删除、回收站清空和版本恢复设为高优先级事件。
- 审计事件定时输出到异地、只追加目标，否则生产库管理员仍可改写历史。

### 4.4 密钥与备份加密

P0 安全整改应包含 API Key 明文存储的去留决策：

- **最安全**：删除 `key_plain`，Key 只在创建时显示一次，库内只保留哈希和前缀。用户丢失后重新生成。
- **为了可再次查看 Key**：使用应用层包密钥加密，包密钥不放在 SQLite 和同一份备份中，而是交给 KMS/独立 Secret 管理。

备份应在离开 VPS 前完成客户端加密，传输必须使用 TLS。备份仓库密码和 OSS 凭据不写入 Git、日志、`manifest.json` 或 SQLite。应另外保留一份加密的“灾难恢复密钥包”，否则有备份也无法恢复会话签名和文件链接。

## 5. 建议的验收指标

### 备份可用性

- DB RPO（最大可接受数据丢失）≤ 15 分钟。
- 整体灾难 RPO（含图片）≤ 1 小时。
- RTO（从确认故障到服务可用）≤ 2 小时。
- 连续两个备份周期无成功快照必须告警。
- 恢复后执行 `PRAGMA integrity_check`，返回 `ok`。
- 核对数据库中 `_files` 和物理文件：无缺失引用，孤儿文件数有报告。
- 在隔离端口启动恢复库，通过健康检查、登录、多 Space 隔离、笔记读取、表记录读取和随机图片下载。

### 版本与审计

- 新建、修改、删除、恢复都有正确 Space 归属和 actor。
- 使用旧 `base_version` 的更新被 409 拒绝，不静默覆盖。
- 恢复旧版本会创建新版本，恢复前后内容都可追溯。
- `scope=groups` 的 API Key 不能查看或恢复授权文件夹之外的历史。
- 审计日志不出现密码、Cookie、Key 明文和笔记正文。

## 6. 建议实施顺序

### P0：先让数据真正可恢复

1. 盘点生产 `DATA_DIR`/`SQLITE_PATH`、数据量、文件量、空间和 OSS 区域，不依赖仓库默认值猜生产状态。
2. 实现带时间戳的 SQLite 快照、快照校验和 manifest。
3. 使用 systemd timer 调度，不将定时任务绑在 Web 请求上。
4. 建立 restic + 独立 OSS Bucket 异地副本，先开版本管理，WORM 先在测试 Bucket 试运行。
5. 写恢复脚本和 runbook，完成第一次隔离恢复演练后才把状态标为“已有可用备份”。
6. 修改文件删除为延迟物理删除，统一记录与笔记的保留任务。
7. 决定并修复 `key_plain` 风险。

### P1：产品级版本恢复

1. 增加 `_revisions`、对象版本号和保留任务。
2. 先接入笔记和记录更新，再接入表结构。
3. 提供历史列表、差异查看、版本命名/锁定和“恢复为新版本”。
4. 补齐 Web、小程序和 API Key 权限回归测试。

### P2：可追溯和抗入侵

1. 增加 `_audit_events` 和管理员审计页。
2. 审计事件定时外送到只追加存储。
3. 在测试恢复和成本策略通过后，锁定生产备份 Bucket 的 WORM 保留策略。
4. 按实际合规需求再评估是否值得引入事件溯源或更细粒度 PITR。

## 7. 参考资料

- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html)
- [restic 备份与调度](https://restic.readthedocs.io/en/stable/040_backup.html)
- [restic 保留与裁剪](https://restic.readthedocs.io/en/stable/060_forget.html)
- [restic 仓库校验](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)
- [阿里云 OSS 版本管理](https://www.alibabacloud.com/help/en/oss/user-guide/overview-78/)
- [阿里云 OSS WORM 保留策略](https://www.alibabacloud.com/help/en/oss/user-guide/oss-retention-policies)
- [Cloudflare D1 导入与导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare R2 对象上传](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2 Bucket Lock](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
