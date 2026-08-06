STANDARD: SSH→Windows PowerShell command execution from macOS zsh.

TWO-TIER STRATEGY:

## Tier 1: Simple Commands (Single-Quoted SSH)

Direct SSH with single-quoted outer shell.

**Pattern:**
```bash
ssh forexvps 'powershell -NoProfile -Command "..."'
ssh forexvps 'nssm status bridge'
```

**What works:**
- `nssm` commands (status, start, stop, restart)
- `taskkill /PID <pid> /F`
- Simple `Get-Process`, `Get-Item`, `Test-Path`
- Pipes and Select-Object (`| Select-Object`)
- Environment variable expansion in double-quoted PowerShell strings (`$env:APPDATA`)

**Escaping rules:**
- Backslashes in Windows paths: literal (no escaping needed in bash single quotes)
- Double quotes inside: use `\"` in PowerShell (bash single quotes pass through literally)
- Variable expansion: `$env:VAR` expands in PowerShell double-quoted strings, not bash

**Example (correct):**
```bash
ssh forexvps 'powershell -NoProfile -Command "Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Filter *.lnk"'
```

Bash passes literally: `Get-ChildItem "$env:APPDATA\...` — PowerShell expands `$env:APPDATA`.

## Tier 2: Complex PowerShell (Base64-Encoded Commands)

Multi-statement scripts, variables, conditionals, loops, pipes → encode to avoid quote nesting hell.

**Pattern:**
```bash
ps_script='... PowerShell code here ...'
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```

**When to use:**
- Scripts with 2+ statements (variable assignment + use)
- Conditionals (`if/else`)
- Loops (`foreach`, `while`)
- Complex quoting (nested strings, arrays)
- Passwords/sensitive values (Base64 obfuscates, doesn't echo in shell history)

**macOS-compatible encoding (critical):**
```bash
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
```
- `iconv -f UTF-8 -t UTF-16LE` — PowerShell's `-EncodedCommand` requires UTF-16LE BOM + encoding
- `base64 | tr -d '\n'` — macOS base64 (no `-w0` flag like GNU)
- Result: single line, ready for SSH `-Command` parameter

**Example (Tier 2 — complex conditional):**
```bash
ps_script='if (Test-Path C:\Pause) {
    Get-ChildItem C:\Pause -Filter *.lnk
} else {
    Write-Host "No paused terminals"
}'

encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```

## Decision Tree

| Requirement | Tier | Example |
|---|---|---|
| Status check | 1 | `ssh forexvps 'nssm status bridge'` |
| List processes | 1 | `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64"'` |
| Path with `$env:` | 1 | `ssh forexvps 'powershell ... \"$env:APPDATA\...\"'` |
| Multiple statements | 2 | `if/then; do X; do Y` |
| Variable assignment + use | 2 | `$p = ...; & script.ps1 $p` |
| Password embedding | 2 | `ConvertTo-SecureString -String "pwd"` |
| Conditional output | 2 | `if (...) { ... } else { ... }` |

## Credential Handling

**NEVER embed passwords in plain Tier 1 commands.** Options:

1. **Interactive session (safest):** RDP/console, script prompts via `Read-Host -AsSecureString`, no password in SSH string
   ```bash
   ssh forexvps 'powershell -NoProfile -File C:\script.ps1'
   ```

2. **Tier 2 Base64 (when automation required):** Password Base64-obfuscated, doesn't echo to shell history
   ```bash
   ps_script='$p = ConvertTo-SecureString -String "<password>" -AsPlainText -Force; & script.ps1 -Pass $p'
   encoded=$(...)
   ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
   ```
   Note: Base64 is obfuscation, not encryption. Still security-sensitive — treat command as secret material.

3. **FORBIDDEN:** Bash double-quotes with variables
   ```bash
   # WRONG — password expands in bash, visible in history
   ssh forexvps "powershell ... -String '$pwd' ..."
   ```

## Testing

Both tiers validated end-to-end (macOS zsh → SSH → Windows PowerShell):
- Tier 1: `nssm`, Get-Process, pipes, env vars ✓
- Tier 2: Multi-line, conditionals, loops, variables ✓
- Encoding: UTF-8→UTF-16LE→base64→-EncodedCommand ✓
