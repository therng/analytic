# vps-mt5-ops

A Cowork plugin for checking and controlling the MT5 Bridge system running on two Windows VPS hosts (`icvps`, `forexvps`) — MT5 terminal processes, the `MT5Bridge` nssm service, and Redis heartbeat health — with optional iMessage status summaries.

Built against the bridge system documented in `analytic/bridge/README.md`.

## What it does

The `vps-mt5-ops` skill covers:

- Checking MT5 terminal process count and bridge service status on `icvps` and/or `forexvps`
- Cross-checking Redis heartbeat keys (`mt5:bridge:heartbeat:{login}`) for per-terminal liveness
- Opening or closing individual MT5 terminals
- Starting, stopping, or restarting the `MT5Bridge` service
- Sending a status summary via iMessage

## Prerequisites

- **SSH access**: the `icvps` and `forexvps` host aliases must already be configured with key-based auth in the local `~/.ssh/config` on the machine Claude is running on.
- **Desktop Commander MCP**: used for real local-shell SSH sessions (the sandboxed Bash tool cannot reach these hosts).
- **Read and Send iMessages MCP**: used to send status summaries.
- **Redis credentials**: read from `analytic/bridge/.env` (`REDIS_URL`) when a heartbeat check is needed — never hardcoded in this plugin.

## Install

Drag the `.plugin` file into Cowork, or install from the file card. No additional configuration needed beyond the prerequisites above.

## Files

```
vps-mt5-ops/
├── .claude-plugin/plugin.json
├── skills/vps-mt5-ops/
│   ├── SKILL.md
│   └── references/vps-commands.md   # exact tested command strings
└── README.md
```
