WHEN: `ssh forexvps` fails, hangs, garbles output, or command has embedded quotes/`-match`/multi-line.

FAIL:
| Symptom | Cause | Action |
|---|---|---|
| timeout / no route | host down, firewall | report, don't retry >1 |
| `Permission denied (publickey)` | key rotated/wrong user | report verbatim, no password fallback |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | rebuilt or MITM | STOP. confirm rebuild w/ user. never auto-accept, never edit known_hosts silently |
| hangs, no output | quoting error, missing `-NoProfile` | test `ssh forexvps 'whoami'` first |
| garbled space-separated chars (`C : \ ...`) | UTF-16 output (nssm get/status) misread as ASCII | redirect to file, read back — don't parse console stream |

DO — `-EncodedCommand` (use for anything with `"`/`'`/`-match`/multi-line):
```bash
CMD='Get-Service | Where-Object { $_.Name -match "MT5|Bridge" }'
ENC=$(printf '%s' "$CMD" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand $ENC"
```
Output wrapped in `#< CLIXML` noise — ignore those lines.

DO — exact output needed (e.g. verify nssm param):
```bash
CMD='& nssm get bridge AppParameters | Out-File -FilePath C:\analytic\logs\check.txt -Encoding utf8'
ENC=$(printf '%s' "$CMD" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand $ENC"
CMD2='[System.IO.File]::ReadAllText("C:\analytic\logs\check.txt")'
ENC2=$(printf '%s' "$CMD2" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand $ENC2"
```

FORBIDDEN: backtick escapes (`` `r`n ``) — mangled crossing bash→ssh→PowerShell, silent no-op.
