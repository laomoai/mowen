# 墨问“累计余额”字段 V1 技术方案

## 1. 技术决策

V1 不引入通用公式库，不执行用户输入的 JavaScript 或 SQL。产品只提供结构化的“累计余额”配置，后端将经白名单校验的配置编译成 SQLite 窗口函数查询。

累计余额是虚拟读字段：

- 配置存在 `_field_meta`。
- 不向动态业务表执行 `ALTER TABLE ADD COLUMN`。
- 不把计算结果持久化到每条记录。
- 列表、单条和导出在服务端用同一计算管线产生结果。

选择虚拟计算的原因：

1. 原始收支是唯一数据事实，不会出现余额列和流水脱节。
2. 补录、删除、修改历史流水不需要执行大量 UPDATE。
3. 整表版本只保存原始行，不增加重复快照体积。
4. 旧版应用回滚时会忽略元数据中的虚拟字段，不破坏业务表。

## 2. 数据模型

### 2.1 迁移

新增 `migrations/0035_running_balance_fields.sql`：

```sql
ALTER TABLE _field_meta ADD COLUMN formula_config TEXT;
```

V1 不再增加独立公式表。`field_type = 'running_balance'` 表示该条 `_field_meta` 是虚拟字段；`column_name` 仍是系统生成的稳定标识符，但它不出现在 `PRAGMA table_info`。

### 2.2 配置结构

```ts
type RunningBalanceConfig = {
  version: 1
  kind: 'running_balance'
  opening_balance: string
  income_field: string | null
  expense_field: string | null
  order_field: string
  tie_breaker: 'id'
  null_as_zero: true
  precision: 2
}
```

入库前必须校验：

- `opening_balance` 是有限十进制数，最多两位小数，且数值范围受限。
- 引用字段必须存在于当前业务表的 `PRAGMA table_info`，不能引用虚拟字段。
- 收入/支出类型是 `number` 或 `currency`；顺序字段类型是 `date` 或 `datetime`。
- 收入/支出不能是同一字段，也不能同时为 `null`。
- 同一表内不存在另一个 `running_balance` 字段。

## 3. 字段模型改造

当前 `getMergedFields()` 只以 `PRAGMA table_info` 为主集合，会丢弃只存在于 `_field_meta` 的虚拟字段。需改为：

```text
实体字段 = PRAGMA table_info + 对应 meta
虚拟字段 = meta 中 field_type=running_balance 且 PRAGMA 无同名列
最终字段 = 实体字段 + 虚拟字段，按 order_index 排序
```

返回给客户端的字段增加：

```ts
{
  field_type: 'running_balance',
  virtual: true,
  read_only: true,
  sqliteType: 'VIRTUAL',
  formula_config: RunningBalanceConfig
}
```

`POST /fields` 遇到 `running_balance` 时只写 `_field_meta`，不执行 `ALTER TABLE`。`PATCH /fields/:colName` 允许更新 title、width、hidden、order 和 `formula_config`，禁止通过普通类型切换绕过依赖校验。

## 4. 查询设计

### 4.1 内层累计、外层筛选

累计必须在任何用户筛选、显示排序和分页之前完成：

```sql
WITH "__mowen_computed" AS (
  SELECT
    t.*,
    CASE
      WHEN "col_transaction_time" IS NULL
        OR TRIM(CAST("col_transaction_time" AS TEXT)) = ''
      THEN NULL
      ELSE ROUND(
        CAST(? AS NUMERIC) +
        SUM(
          CASE
            WHEN "col_transaction_time" IS NULL
              OR TRIM(CAST("col_transaction_time" AS TEXT)) = ''
            THEN 0
            ELSE COALESCE(CAST("col_income" AS NUMERIC), 0)
               - COALESCE(CAST("col_expense" AS NUMERIC), 0)
          END
        ) OVER (
          ORDER BY
            CASE WHEN "col_transaction_time" IS NULL
                   OR TRIM(CAST("col_transaction_time" AS TEXT)) = ''
                 THEN 1 ELSE 0 END,
            "col_transaction_time" ASC,
            "id" ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
        2
      )
    END AS "field_balance"
  FROM "tbl_xxx" AS t
)
SELECT *
FROM "__mowen_computed"
WHERE /* 用户筛选 */
ORDER BY /* 视图显示排序 */
LIMIT ? OFFSET ?;
```

真实代码不接受上述 SQL 中的任意名称。表名和字段名先与 `getUserTables()` / `PRAGMA table_info` 白名单比对，再通过统一标识符引用器生成；期初余额和分页数值使用绑定参数。

### 4.2 统一查询管线

抽取一个虚拟字段查询层，供以下路径共用：

- `GET /api/tables/:tableName/records`
- `GET /api/tables/:tableName/records/:id`
- `GET /api/tables/:tableName/export`

列表和导出不能各自拼一套公式 SQL。单条详情也必须先在内层建立全表累计，再以 `id` 在外层取一条，不能先过滤到单行再计算。

V1 不允许累计余额作为 link 字段的展示字段，避免 link search 再引入一条跨表计算路径。

### 4.3 筛选、排序和分页

- 原始字段和累计余额的筛选都放在 CTE 外层，保证筛选不改变账本余额。
- 视图可以按余额显示排序，但窗口函数始终使用配置中的时间字段和 `id ASC`。
- 未显式指定显示排序时，累计余额表按配置的时间字段 `DESC, id DESC` 返回，而不是按插入 `id` 倒序。这能避免补录旧日期时产生“余额与上下行对不上”的假象。
- 当前自定义排序下的单 `id` 游标不是严格复合游标。V1 对“按余额排序”使用 `page`/`OFFSET` 分页；默认实体 `id DESC` 可保留现有游标语义。
- 即使只返回第二页，累计也在分页前完成。

## 5. 读写边界

### 5.1 写入

所有可写字段继续以 `PRAGMA table_info` 为白名单，因此虚拟余额天然不会出现在 INSERT/UPDATE SQL 中。Web 端同时根据 `read_only` 隐藏编辑控件，但后端白名单是真正安全边界。

### 5.2 字段依赖

隐藏被依赖字段不会破坏计算，因此允许。在永久删除字段或将字段改为不兼容类型之前，查询当前表所有 `formula_config`。如果目标字段被引用，拒绝变更并返回：

```json
{
  "error": {
    "code": "FORMULA_DEPENDENCY",
    "message": "字段正被累计余额‘余额’使用"
  }
}
```

## 6. 精度决策

当前墨问 `currency` 实体列使用 SQLite `REAL`。V1 为保持现有数据兼容，在 SQLite 中用 `NUMERIC` 转换并对每行最终结果 `ROUND(..., 2)`。

这不是财务级十进制保证。如后续实现专业记账、多币种或对账，需另立迁移将金额按最小货币单位整数化，不在本 V1 中偷换存量数据语义。

## 7. 性能设计

窗口累计会扫描并按流水顺序处理数据，不再是现有默认查询的纯 `pageSize` 成本。V1 采取：

1. 为配置的时间字段与 `id` 创建联合索引。
2. 每表限制一个累计余额，避免多个窗口重复扫描。
3. 缓存已校验配置和 SQL 模板，不缓存用户数据结果。
4. 用 10k/50k 固定数据集建立基准；如不达标，发布前决定表行数上限或引入累计检查点。

索引名使用可预测的安全名称，例如经白名单后的 `idx_<table>_<order>_running_balance`。修改排序字段时创建新索引；V1 不自动删除旧索引，避免变更路径执行不必要的破坏性 DDL，后续由维护工具审计冗余索引。

## 8. 历史版本集成

- `_table_revisions` 继续记录实体行的 before/after，不包含虚拟余额。
- 重建某个历史整表状态时，差异面板不把虚拟余额当作原始字段差异。
- 恢复完成后的列表刷新重新计算余额。
- V1 公式配置不进入整表数据版本，与当前“不恢复字段/表结构”的边界一致。

## 9. 错误模型

| 代码 | HTTP | 含义 |
|---|---:|---|
| `INVALID_FORMULA_CONFIG` | 400 | 期初值、字段类型或配置结构无效 |
| `FORMULA_FIELD_LIMIT` | 409 | 当前表已有累计余额字段 |
| `FORMULA_DEPENDENCY` | 409 | 试图删除或改变被依赖字段 |
| `FORMULA_FIELD_READ_ONLY` | 400 | 尝试写入虚拟计算结果（严格模式） |

对普通记录写入，V1 默认忽略客户端携带的虚拟字段值；在管理接口和自动化测试中可使用严格模式验证错误代码。

## 10. 可观测性

- 不记录整行收支数据或公式查询结果。
- 可记录表名摘要、累计字段 ID、扫描行数、查询耗时和错误代码。
- 当扫描行数或耗时超过阈值时输出结构化 warning，不输出金额和备注内容。

## 11. 回滚

- 代码回滚：切回前一 release；旧代码只会看到实体列，虚拟字段暂时不显示。
- 数据库回滚：`formula_config` 是可空新列，不必破坏性删除。
- 业务数据：累计余额不落实体列，回滚不需要清理行数据。
