---
name: 墨问
description: >
  通过墨问（MoWen）HTTP API 管理表格、记录、笔记和工作区。
  在用户要查表、写记录、读写笔记、或提到 墨问 / MoWen / mowen.lemoai.cn 时使用。
  斜杠命令：/mowen
---

# 墨问 MoWen

用环境变量调用官方 API，不要手写 curl，也不要把密钥写进仓库。

```
MOWEN_URL   默认 https://mowen.lemoai.cn
MOWEN_KEY   设置里创建的 API Key（请求头 X-API-Key）
```

脚本与本文件同目录：`scripts/mowen.py`。

```bash
python3 scripts/mowen.py tables
python3 scripts/mowen.py schema --table tbl_xxx
python3 scripts/mowen.py query --table tbl_xxx --limit 20
python3 scripts/mowen.py get --table tbl_xxx --id 1
python3 scripts/mowen.py insert --table tbl_xxx --data '{"col_xxx":"值"}'
python3 scripts/mowen.py update --table tbl_xxx --id 1 --data '{"col_xxx":"新值"}'
python3 scripts/mowen.py delete --table tbl_xxx --id 1

python3 scripts/mowen.py whoami
python3 scripts/mowen.py notes
python3 scripts/mowen.py note --id n_xxx
python3 scripts/mowen.py create-note --title "标题" --content "正文"
python3 scripts/mowen.py update-note --id n_xxx --content "新正文"
python3 scripts/mowen.py archive-note --id n_xxx

python3 scripts/mowen.py workspace
python3 scripts/mowen.py move --id wn_t_xxxx --folder wn_f_目标文件夹
python3 scripts/mowen.py move --id wn_n_xxxx --folder root
python3 scripts/mowen.py groups
```

## 约定

- 表格对外用 `name`（如 `tbl_abc123`），界面显示名是 `title`。写记录用字段的 `column_name`。
- 移动侧栏位置用 `move`，`--id` 是 `workspace` 返回的节点 `id`，不是 `tbl_` / `n_`。`--folder` 是目标文件夹节点 id，`root` 表示根目录。
- `PATCH /api/notes/:id` 的 `parent_id` 是旧的笔记套笔记，不要用来换文件夹。
- API Key 归属创建它的空间；一个用户加入多个空间时，给 Agent/小程序使用对应空间里创建的 Key。
- `scope=groups` 的 Key 只能访问所选文件夹及子文件夹里的表和笔记。
- 笔记树用 `parent_id` 还原层级。
- 鉴权头是 `X-API-Key`。只读 Key 不能写。
- `whoami` 走 `/api/viewer/me`，用于确认当前 Key 的用户、空间、权限范围和可见工作区。
- Web 登录态接口支持多空间、邀请码注册和切换空间；本 Skill 只使用 API Key，不持有网页登录态。
- 完整接口：`$MOWEN_URL/api/docs` 与 `$MOWEN_URL/api/openapi.json`。

## 没有 Key 时

让用户到 https://mowen.lemoai.cn/settings 创建一把文件夹范围的 Key，再设置 `MOWEN_KEY`。不要编造密钥。
