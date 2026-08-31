#!/usr/bin/env python3
"""墨问 CLI。环境变量：MOWEN_URL、MOWEN_KEY。"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "https://mowen.lemoai.cn"


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def request(method: str, path: str, body: dict | None = None, query: dict | None = None):
    base = (os.environ.get("MOWEN_URL") or DEFAULT_URL).rstrip("/")
    key = (os.environ.get("MOWEN_KEY") or "").strip()
    if not key:
        die("缺少 MOWEN_KEY。到设置页创建 API Key 后导出该环境变量。")
    url = base + path
    if query:
        q = {k: v for k, v in query.items() if v is not None and v != ""}
        if q:
            url += "?" + urllib.parse.urlencode(q)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "X-API-Key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        die(f"HTTP {e.code} {method} {path}\n{err}")
    except urllib.error.URLError as e:
        die(f"无法连接 {base}: {e.reason}")


def dumps(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def parse_data(raw: str) -> dict:
    try:
        val = json.loads(raw)
    except json.JSONDecodeError as e:
        die(f"--data 不是合法 JSON: {e}")
    if not isinstance(val, dict):
        die("--data 必须是 JSON 对象")
    return val


def main() -> None:
    p = argparse.ArgumentParser(prog="mowen", description="墨问 agent CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("tables", help="列出表格")
    s = sub.add_parser("schema", help="表结构")
    s.add_argument("--table", required=True)
    s = sub.add_parser("query", help="查记录")
    s.add_argument("--table", required=True)
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--cursor")
    s.add_argument("--sort")
    s = sub.add_parser("get", help="单条记录")
    s.add_argument("--table", required=True)
    s.add_argument("--id", required=True)
    s = sub.add_parser("insert", help="新增记录")
    s.add_argument("--table", required=True)
    s.add_argument("--data", required=True)
    s = sub.add_parser("update", help="更新记录")
    s.add_argument("--table", required=True)
    s.add_argument("--id", required=True)
    s.add_argument("--data", required=True)
    s = sub.add_parser("delete", help="删除记录")
    s.add_argument("--table", required=True)
    s.add_argument("--id", required=True)

    sub.add_parser("notes", help="笔记列表")
    s = sub.add_parser("note", help="笔记详情")
    s.add_argument("--id", required=True)
    s = sub.add_parser("create-note")
    s.add_argument("--title", required=True)
    s.add_argument("--content", default="")
    s.add_argument("--parent-id")
    s = sub.add_parser("update-note")
    s.add_argument("--id", required=True)
    s.add_argument("--title")
    s.add_argument("--content")
    s = sub.add_parser("archive-note")
    s.add_argument("--id", required=True)
    s = sub.add_parser("unarchive-note")
    s.add_argument("--id", required=True)

    sub.add_parser("workspace", help="侧栏工作区树")
    s = sub.add_parser("move", help="把表格/笔记/文件夹移到另一个文件夹")
    s.add_argument("--id", required=True, help="工作区节点 id（workspace 里的 id）")
    s.add_argument("--folder", default="", help="目标文件夹节点 id；省略或 root 表示工作区根目录")
    sub.add_parser("groups", help="文件夹/组")

    args = p.parse_args()
    c = args.cmd

    if c == "tables":
        dumps(request("GET", "/api/tables"))
    elif c == "schema":
        dumps(request("GET", f"/api/tables/{args.table}"))
    elif c == "query":
        dumps(request("GET", f"/api/tables/{args.table}/records", query={
            "page_size": str(args.limit),
            "cursor": args.cursor,
            "sort": args.sort,
        }))
    elif c == "get":
        dumps(request("GET", f"/api/tables/{args.table}/records/{args.id}"))
    elif c == "insert":
        dumps(request("POST", f"/api/tables/{args.table}/records", parse_data(args.data)))
    elif c == "update":
        dumps(request("PATCH", f"/api/tables/{args.table}/records/{args.id}", parse_data(args.data)))
    elif c == "delete":
        dumps(request("DELETE", f"/api/tables/{args.table}/records/{args.id}"))
    elif c == "notes":
        dumps(request("GET", "/api/notes"))
    elif c == "note":
        dumps(request("GET", f"/api/notes/{args.id}"))
    elif c == "create-note":
        body = {"title": args.title, "content": args.content}
        if args.parent_id:
            body["parent_id"] = args.parent_id
        dumps(request("POST", "/api/notes", body))
    elif c == "update-note":
        body = {}
        if args.title is not None:
            body["title"] = args.title
        if args.content is not None:
            body["content"] = args.content
        if not body:
            die("update-note 需要 --title 或 --content")
        dumps(request("PATCH", f"/api/notes/{args.id}", body))
    elif c == "archive-note":
        dumps(request("POST", f"/api/notes/{args.id}/archive"))
    elif c == "unarchive-note":
        dumps(request("POST", f"/api/notes/{args.id}/unarchive"))
    elif c == "workspace":
        dumps(request("GET", "/api/workspace/tree"))
    elif c == "move":
        folder = (args.folder or "").strip()
        parent_id = None if folder in ("", "root", "null") else folder
        dumps(request("POST", "/api/workspace/move", {"id": args.id, "parent_id": parent_id}))
    elif c == "groups":
        dumps(request("GET", "/api/groups"))


if __name__ == "__main__":
    main()
