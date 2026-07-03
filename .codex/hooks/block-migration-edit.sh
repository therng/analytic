#!/bin/bash
# PreToolUse: block edits to already-applied Prisma migration SQL files
input=$(cat)
path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

if [[ "$path" =~ prisma/migrations/[^/]+/migration\.sql$ ]]; then
  printf 'ห้ามแก้ไข migration ที่ apply ไปแล้วโดยตรง: %s — ให้สร้าง migration ใหม่แทน (ใช้ /create-migration)\n' "$path" >&2
  exit 2
fi
