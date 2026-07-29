#!/usr/bin/env bash
# Wires scripts/check-harness-review.sh in as the pre-push hook.
# .git/hooks isn't version-controlled, so each clone runs this once:
#   npm run hooks:install
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cat > "$root/.git/hooks/pre-push" <<'EOF'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/check-harness-review.sh"
EOF
chmod +x "$root/.git/hooks/pre-push"
echo "pre-push hook installed -> scripts/check-harness-review.sh"
