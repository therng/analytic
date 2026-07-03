#!/bin/bash
# PostToolUse: auto prisma generate after schema.prisma edits
input=$(cat)
path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$path" == *"schema.prisma"* ]]; then
  project_root=$(git -C "$(dirname "$path")" rev-parse --show-toplevel 2>/dev/null)
  if [[ -n "$project_root" ]]; then
    cd "$project_root" && npx prisma generate 2>/dev/null || true
  fi
fi
