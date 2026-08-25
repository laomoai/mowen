# MoWen Reader Mini Program

墨问微信小程序只读阅读器。Web 版负责创建、编辑和 API Key 授权；小程序只负责查询和阅读。

## 开发顺序

1. 后端先部署 `/api/viewer/*` 安全只读接口。
2. 小程序在微信开发者工具中打开 `miniprogram/`。
3. 在微信小程序后台配置合法 request 域名：`https://mowen.lemoai.cn`。
4. Web 版创建 `readonly + scope=groups` API Key。
5. 小程序输入 `https://mowen.lemoai.cn` 和 API Key 验证连接。

## 依赖接口

小程序优先使用 viewer 安全接口：

- `GET /api/viewer/me`
- `GET /api/viewer/tables/:tableName/records`
- `GET /api/viewer/tables/:tableName/records/:id`

通用只读接口：

- `GET /api/workspace/tree`
- `GET /api/notes/:id`
- `GET /api/files/sign?key=...`

不要在小程序里直接使用普通单条记录接口 `GET /api/tables/:tableName/records/:id`，它会返回整行数据，不适合作为小程序首版默认读取路径。

## 本地验证

后端安全接口 smoke test：

```bash
npm run smoke:viewer
```

小程序静态检查：

```bash
find miniprogram -name '*.json' -print0 | xargs -0 -I{} node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" {}
find miniprogram -name '*.js' -print0 | xargs -0 -I{} node --check {}
```
