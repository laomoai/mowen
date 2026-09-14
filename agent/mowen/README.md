# 墨问 Agent 接入

发给 Agent：

```
请根据 https://mowen.lemoai.cn/agent/mowen/SKILL.md 安装墨问，环境变量 MOWEN_KEY=你的密钥
```

Skill 名称：墨问。密钥以 `mw_` 开头。

多空间账号请在目标空间里创建对应 API Key。Agent/小程序使用哪把 Key，就只能看到那把 Key 所属空间和授权文件夹范围内的数据。

## 累计余额字段

v1.1 起，CLI 和 MCP 能识别、查询和配置 `running_balance` 虚拟字段。这类字段会返回 `virtual=true` 和 `read_only=true`，不得放入记录新增或更新请求。按累计余额排序时使用页码分页，不使用游标。
