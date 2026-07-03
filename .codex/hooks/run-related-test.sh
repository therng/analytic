#!/bin/bash
# PostToolUse: run the matching *.test.ts file after edits to trading/worker logic
input=$(cat)
path=$(echo "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

if [[ -z "$path" ]] || [[ "$path" != *"src/lib/trading/"* && "$path" != *"src/worker/"* ]]; then
  exit 0
fi
if [[ "$path" == *"node_modules"* ]] || [[ "$path" != *.ts ]]; then
  exit 0
fi

project_root=$(git -C "$(dirname "$path")" rev-parse --show-toplevel 2>/dev/null)
[[ -z "$project_root" ]] && exit 0

if [[ "$path" == *.test.ts ]]; then
  test_file="$path"
else
  test_file="${path%.ts}.test.ts"
fi

if [[ -f "$test_file" ]]; then
  cd "$project_root" && node --import tsx --test "$test_file" 2>&1 | tail -20
fi
