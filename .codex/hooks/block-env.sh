#!/bin/bash
# PreToolUse: block edits to .env files
input=$(cat)
path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$path" =~ (^|/)\.env($|\.(local|production|development|example)$) ]]; then
  printf 'ห้ามแก้ไขไฟล์ secret โดยตรง: %s — แก้ไขด้วยตนเองเท่านั้น\n' "$path" >&2
  exit 2
fi
