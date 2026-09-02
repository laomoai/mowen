#!/usr/bin/env node
/**
 * 墨问 MCP (stdio)。环境变量：MOWEN_URL、MOWEN_KEY。
 * Cursor / Claude Desktop 用 stdio 启动本文件。这是本地进程，不是在浏览器里打开。
 */
import { createInterface } from "node:readline";

const URL_BASE = (process.env.MOWEN_URL || "https://mowen.lemoai.cn").replace(/\/$/, "");
const API_KEY = (process.env.MOWEN_KEY || "").trim();

const TOOLS = [
  { name: "viewer_me", description: "确认当前 API Key 的用户、空间、权限范围和可见工作区", inputSchema: { type: "object", properties: {} } },
  { name: "list_tables", description: "列出当前 Key 可见的表格", inputSchema: { type: "object", properties: {} } },
  {
    name: "get_schema",
    description: "获取表格字段结构",
    inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] },
  },
  {
    name: "query_records",
    description: "分页查询记录。table 用 API name（tbl_xxx）",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        page_size: { type: "number" },
        cursor: { type: "string" },
        sort: { type: "string", description: "field:asc 或 field:desc" },
      },
      required: ["table"],
    },
  },
  {
    name: "get_record",
    description: "按 id 取一条记录",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" }, id: { type: "string" } },
      required: ["table", "id"],
    },
  },
  {
    name: "create_record",
    description: "新增记录。data 的 key 必须是 column_name",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" }, data: { type: "object" } },
      required: ["table", "data"],
    },
  },
  {
    name: "update_record",
    description: "更新记录",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" }, id: { type: "string" }, data: { type: "object" } },
      required: ["table", "id", "data"],
    },
  },
  {
    name: "delete_record",
    description: "删除记录",
    inputSchema: {
      type: "object",
      properties: { table: { type: "string" }, id: { type: "string" } },
      required: ["table", "id"],
    },
  },
  { name: "list_notes", description: "列出笔记（扁平，用 parent_id 还原树）", inputSchema: { type: "object", properties: {} } },
  {
    name: "get_note",
    description: "读取一篇笔记正文",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_note",
    description: "新建笔记。scope=groups 的 Key 创建根笔记时必须传 folder_id，取 workspace_tree 中目标文件夹的节点 id。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        parent_id: { type: "string", description: "父笔记 id，用于创建笔记子页" },
        folder_id: { type: "string", description: "目标文件夹节点 id，用于创建根笔记" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_note",
    description: "更新笔记标题或正文",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, content: { type: "string" } },
      required: ["id"],
    },
  },
  { name: "workspace_tree", description: "侧栏工作区树（文件夹 / 表格 / 笔记）", inputSchema: { type: "object", properties: {} } },
  {
    name: "move_node",
    description: "把表格、笔记或文件夹移到另一个文件夹。id 和 folder 用 workspace_tree 的节点 id；folder 为空或 root 表示根目录。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, folder: { type: "string", description: "目标文件夹节点 id，省略则到根目录" } },
      required: ["id"],
    },
  },
  { name: "list_groups", description: "文件夹（组）列表", inputSchema: { type: "object", properties: {} } },
];

async function api(method, path, body) {
  if (!API_KEY) throw new Error("缺少 MOWEN_KEY");
  const res = await fetch(URL_BASE + path, {
    method,
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text.slice(0, 800)}`);
  return json;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "viewer_me":
      return api("GET", "/api/viewer/me");
    case "list_tables":
      return api("GET", "/api/tables");
    case "get_schema":
      return api("GET", `/api/tables/${encodeURIComponent(args.table)}`);
    case "query_records": {
      const q = new URLSearchParams();
      q.set("page_size", String(args.page_size || 20));
      if (args.cursor) q.set("cursor", args.cursor);
      if (args.sort) q.set("sort", args.sort);
      return api("GET", `/api/tables/${encodeURIComponent(args.table)}/records?${q}`);
    }
    case "get_record":
      return api("GET", `/api/tables/${encodeURIComponent(args.table)}/records/${encodeURIComponent(args.id)}`);
    case "create_record":
      return api("POST", `/api/tables/${encodeURIComponent(args.table)}/records`, args.data);
    case "update_record":
      return api("PATCH", `/api/tables/${encodeURIComponent(args.table)}/records/${encodeURIComponent(args.id)}`, args.data);
    case "delete_record":
      return api("DELETE", `/api/tables/${encodeURIComponent(args.table)}/records/${encodeURIComponent(args.id)}`);
    case "list_notes":
      return api("GET", "/api/notes");
    case "get_note":
      return api("GET", `/api/notes/${encodeURIComponent(args.id)}`);
    case "create_note":
      return api("POST", "/api/notes", {
        title: args.title,
        content: args.content || "",
        parent_id: args.parent_id || undefined,
        folder_id: args.folder_id || undefined,
      });
    case "update_note":
      return api("PATCH", `/api/notes/${encodeURIComponent(args.id)}`, {
        title: args.title,
        content: args.content,
      });
    case "workspace_tree":
      return api("GET", "/api/workspace/tree");
    case "move_node": {
      const folder = String(args.folder || "").trim();
      const parent_id = !folder || folder === "root" || folder === "null" ? null : folder;
      return api("POST", "/api/workspace/move", { id: args.id, parent_id });
    }
    case "list_groups":
      return api("GET", "/api/groups");
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

function reply(id, result, error) {
  const msg = error
    ? { jsonrpc: "2.0", id, error: { code: -32000, message: String(error.message || error) } }
    : { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "mowen", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const data = await callTool(params?.name, params?.arguments || {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
    } catch (err) {
      return reply(id, null, err);
    }
  }
  if (method === "ping") return reply(id, {});
  if (id !== undefined) reply(id, null, new Error(`不支持的方法: ${method}`));
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    await handle(JSON.parse(trimmed));
  } catch (err) {
    process.stderr.write(String(err) + "\n");
  }
});
