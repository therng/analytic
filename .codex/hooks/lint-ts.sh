#!/bin/bash
# PostToolUse: auto-lint TypeScript files after edit
input=$(cat)
path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$path" =~ \.(ts|tsx)$ ]] && [[ "$path" != *"node_modules"* ]] && [[ -n "$path" ]]; then
  project_root=$(git -C "$(dirname "$path")" rev-parse --show-toplevel 2>/dev/null)
  if [[ -n "$project_root" ]]; then
    cd "$project_root" && npx eslint --fix "$path" 2>/dev/null || true
  fi
fi
