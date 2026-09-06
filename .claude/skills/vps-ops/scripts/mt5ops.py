#!/usr/bin/env python
"""mt5ops.py — MT5 terminal + analytic service stack ops on forexvps.

Commands: status, reboot-check, svc, stack, term, pause, resume, notify,
restart-computer. Stdlib only. Run from any cwd.

Part of the vps-ops skill (merged from the former mt5-ops skill, 2026-08-25).
"""
import argparse
import glob
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

ANALYTIC = r"C:\analytic"
BRIDGE_ENV = os.path.join(ANALYTIC, "bridge", ".env")
# Account registry: bridge/state/discovered-accounts/<login>.json, written by
# the bridge when it attaches (old bridge/accounts/ retired with the
# 2026-08-30 schtasks migration — same field names, so only the path moved).
ACCOUNTS_DIR = os.path.join(ANALYTIC, "bridge", "state",
                            "discovered-accounts")
HEALTH_DIR = os.path.join(ANALYTIC, "bridge", "state", "health")
STARTUP_DIR = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows",
                           "Start Menu", "Programs", "Startup")
# bridge + redis-wsl are dispatched specially (scheduled task / WSL TCP),
# not NSSM — see svc_state(). hermes-gateway dropped: not this stack.
SERVICES = ["analytic-web", "analytic-worker", "caddy", "bridge",
            "redis-wsl", "postgresql-x64-18"]
# caddy first on stop (sole public exposure), core data plane last.
STOP_ORDER = ["caddy", "analytic-web", "analytic-worker", "bridge"]
START_ORDER = ["bridge", "analytic-worker", "analytic-web", "caddy"]
# Service control is nssm-only on this host (sc.exe is unusable from the
# agent session). nssm status/start/stop/restart work on any SCM service.
NSSM = r"C:\Windows\nssm.exe"
# Paused auto-launch shortcuts are parked here by `pause`, restored by `resume`.
PAUSE_DIR = r"C:\pause"


def run(cmd, timeout=60, **kw):
    return subprocess.run(cmd, capture_output=True, text=True,
                          timeout=timeout, **kw)


# ---------- accounts / terminals ----------

def load_accounts():
    """login -> {exe, folder, server} from bridge/accounts/*.json."""
    out = {}
    for f in glob.glob(os.path.join(ACCOUNTS_DIR, "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        login = d.get("expected_login")
        exe = d.get("executable_path") or ""
        if not login or not exe:
            continue
        folder = pathlib.Path(exe).parent.name  # C:\MT3 -> MT3
        out[str(login)] = {"exe": exe, "folder": folder,
                           "server": d.get("expected_server", "?")}
    return out


def load_health():
    """login -> health dict from bridge/state/health/*.json."""
    out = {}
    for f in glob.glob(os.path.join(HEALTH_DIR, "*.json")):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        if d.get("login"):
            out[str(d["login"])] = d
    return out


def all_terminals():
    """[(pid, exe, cmdline, age_s)] for EVERY terminal64.exe process,
    liveupdate children included. cmdline is "" when unreadable."""
    r = run(["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='terminal64.exe'\" "
             "| Select-Object ProcessId,ExecutablePath,CommandLine,"
             "@{n='AgeS';e={[int]((Get-Date) - $_.CreationDate).TotalSeconds}} "
             "| ConvertTo-Json -Compress"])
    procs = []
    if r.returncode == 0 and r.stdout.strip():
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            data = []
        if isinstance(data, dict):
            data = [data]
        for p in data:
            procs.append((int(p["ProcessId"]), p.get("ExecutablePath") or "",
                          p.get("CommandLine") or "", int(p.get("AgeS") or 0)))
    return procs


def running_terminals():
    """[(pid, exe_path)] for real terminals; excludes liveupdate children."""
    return [(pid, exe) for pid, exe, _cl, _age in all_terminals()
            if "liveupdate" not in exe.lower()]


# Kill-candidate grace windows. MT5's liveupdate handoff legitimately runs
# terminal64.exe from the data-dir liveupdate staging folder for a short
# window; persisting past it means the handoff is stuck (2026-09-06
# incident: two staging duplicates ran 8+ min next to the real terminals).
STAGING_GRACE_S = 180
UPDATER_STALE_S = 600


def classify_terminal(exe, cmdline, age_s, known_exes):
    """ok | nonportable | staging-duplicate | updater | unknown.

    Sanctioned = install-dir exe of a discovered account AND /portable (or
    -portable) on the command line — same portable rule bridge discovery
    uses. Unknown classifications are LISTED but never auto-killed."""
    if not cmdline:
        return "unknown"  # command line unreadable — never auto-kill
    if "liveupdate" in exe.lower():
        return "updater" if "/update" in cmdline.lower() else \
            "staging-duplicate"
    if not re.search(r"[/-]portable", cmdline, re.I):
        return "nonportable"  # direct run — wrong profile, EA never loads
    return "ok" if exe.lower() in known_exes else "unknown"


def lnk_map(folder=STARTUP_DIR):
    """{MTfolder: .lnk path} for shortcuts in `folder` pointing at terminals."""
    r = run(["powershell", "-NoProfile", "-Command",
             "$sh = New-Object -ComObject WScript.Shell; "
             "Get-ChildItem \"" + folder + "\\*.lnk\" | ForEach-Object { "
             "$s = $sh.CreateShortcut($_.FullName); "
             "Write-Output ($_.FullName + \"|\" + $s.TargetPath) }"])
    out = {}
    for line in (r.stdout or "").splitlines():
        if "|" not in line:
            continue
        lnk, target = line.split("|", 1)
        m = re.search(r"\\(MT\d+)\\terminal64\.exe$", target.strip(), re.I)
        if m:
            out[m.group(1).upper()] = lnk.strip()
    return out


def autostart_state(folder):
    """on = .lnk in Startup, paused = parked in C:\\pause, none = missing."""
    if folder in lnk_map(STARTUP_DIR):
        return "on"
    if folder in lnk_map(PAUSE_DIR):
        return "paused"
    return "none"


# ---------- redis ----------

def redis_url():
    c = _redis_conf()
    if not c:
        sys.exit("ERROR: REDIS_URL not found in bridge/.env")
    return c


def _redis_conf():
    """(password, host, port) from bridge/.env REDIS_URL, or None."""
    try:
        txt = pathlib.Path(BRIDGE_ENV).read_text(encoding="utf-8",
                                                 errors="ignore")
    except OSError:
        return None
    m = re.search(r"^REDIS_URL=redis://:([^@]+)@([^:/]+):(\d+)",
                  txt, re.M)
    return (m.group(1), m.group(2), m.group(3)) if m else None


def redis_reachable():
    """TCP probe 6379 — Redis lives in WSL behind the keepalive task, so
    there is no Windows service state to read."""
    import socket
    c = _redis_conf()
    host, port = (c[1], c[2]) if c else ("127.0.0.1", "6379")
    try:
        with socket.create_connection((host, int(port)), timeout=3):
            return True
    except OSError:
        return False


def redis_cmd(*args):
    pw, host, port = redis_url()
    env = dict(os.environ, REDISCLI_AUTH=pw, WSLENV="REDISCLI_AUTH")
    return run(["wsl", "-e", "redis-cli", "-h", host, "-p", port,
                "--no-auth-warning", *args], env=env)


def live_state(login):
    """(fresh: bool, ttl: int, info: dict) for mt5:account:{login}:live."""
    key = "mt5:account:{%s}:live" % login
    t = redis_cmd("TTL", key)
    try:
        ttl = int(t.stdout.strip())
    except ValueError:
        ttl = -2
    info = {}
    if ttl > 0:
        g = redis_cmd("GET", key)
        try:
            d = json.loads(g.stdout)
            acct = (d.get("payload", {}).get("account", {})
                    .get("raw", {}))
            pos = d.get("payload", {}).get("positions", {})
            rows = pos.get("rows") if isinstance(pos, dict) else None
            info = {"name": acct.get("name", "?"),
                    "balance": acct.get("balance"),
                    "equity": acct.get("equity"),
                    "positions": len(rows) if rows is not None else "?"}
        except Exception:
            info = {}
    return ttl > 0, ttl, info


# ---------- services ----------

BRIDGE_TASK = "analytic-bridge"


def bridge_task_state():
    """Running / Ready / ... / NOT_FOUND for the analytic-bridge task."""
    r = run(["powershell", "-NoProfile", "-Command",
             "(Get-ScheduledTask -TaskName '%s' "
             "-ErrorAction SilentlyContinue).State" % BRIDGE_TASK])
    out = _clean(r.stdout)
    return out if out else "NOT_FOUND"


def svc_state(name):
    """Service state as a string. bridge = scheduled task (NSSM variant
    retired 2026-08-30), redis-wsl = WSL TCP probe, others = nssm status
    (UTF-16LE — strip embedded NULs)."""
    if name == "bridge":
        return bridge_task_state()
    if name == "redis-wsl":
        return "up" if redis_reachable() else "DOWN"
    r = run([NSSM, "status", name], timeout=60)
    out = _clean(r.stdout)
    if r.returncode != 0 or not out or "Can't open service" in _clean(r.stderr):
        return "NOT_FOUND"
    return out


def svc_action(name, action):
    """stop/start/restart dispatch: schtasks for the bridge, nssm for the
    rest. redis-wsl refuses — WSL lifecycle is the keepalive task's job."""
    if name == "bridge":
        if action in ("stop", "restart"):
            run(["schtasks", "/End", "/TN", BRIDGE_TASK], timeout=60)
        if action in ("start", "restart"):
            run(["schtasks", "/Run", "/TN", BRIDGE_TASK], timeout=60)
        return
    if name == "redis-wsl":
        sys.exit("ERROR: redis runs inside WSL (systemd, kept alive by the "
                 "analytic-redis-wsl-keepalive task) — not svc-controllable")
    run([NSSM, action, name], timeout=180)


def _clean(s):
    return (s or "").replace("\x00", "").strip()


def svc_wait(name, want, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if svc_state(name) == want:
            return True
        time.sleep(2)
    return False


def cmd_svc(action, name):
    if name not in SERVICES:
        sys.exit("ERROR: unknown service %r" % name)
    if action == "status":
        print("%s: %s" % (name, svc_state(name)))
        return
    if action == "restart":
        svc_action(name, "restart")
    else:
        svc_action(name, action)
    want = ("Running" if name == "bridge" else
            "SERVICE_RUNNING" if action in ("start", "restart") else
            "SERVICE_STOPPED")
    ok = svc_wait(name, want, 60)
    print("%s: %s%s" % (name, svc_state(name),
                        "" if ok else "  (did not reach %s in 60s)" % want))
    if name == "bridge" and action in ("start", "restart"):
        print("bridge warmup: live TTLs republish in ~5-6 min")
    if svc_state(name) != want:
        sys.exit(1)


def cmd_stack(action, all_flag):
    if action == "stop":
        order = STOP_ORDER + (["redis-wsl", "postgresql-x64-18"]
                              if all_flag else [])
    else:
        order = list(reversed(STOP_ORDER))
    for name in order:
        if name == "redis-wsl":
            print("redis-wsl: manual only (WSL keepalive task)")
            continue
        svc_action(name, action)
        want = ("Ready" if name == "bridge" and action == "stop" else
                "Running" if name == "bridge" else
                "SERVICE_STOPPED" if action == "stop" else "SERVICE_RUNNING")
        svc_wait(name, want, 90)
        print("%s: %s" % (name, svc_state(name)))


# ---------- status ----------

def collect_status():
    accounts = load_accounts()
    health = load_health()
    procs = running_terminals()
    by_folder = {}
    for pid, exe in procs:
        by_folder.setdefault(pathlib.Path(exe).parent.name.upper(), []).append(pid)
    lines, ok = [], True

    lines.append("== services ==")
    for s in SERVICES:
        st = svc_state(s)
        if st not in ("SERVICE_RUNNING", "Running", "up"):
            ok = False
        lines.append("  %-20s %s" % (s, st))

    lines.append("== terminals ==")
    if not accounts:
        ok = False
        lines.append("  (no accounts in %s — bridge never attached?)"
                     % ACCOUNTS_DIR)
    for login, a in sorted(accounts.items()):
        pids = by_folder.get(a["folder"].upper(), [])
        h = health.get(login, {})
        running = bool(pids)
        auto = autostart_state(a["folder"].upper())
        if not running:
            ok = False
        lines.append("  %-5s login=%s pids=%s autostart=%s%s" % (
            a["folder"], login, pids or "-", auto,
            "  <- NOT RUNNING" if not running else ""))

    lines.append("== bridge live (Redis) ==")
    for login in sorted(accounts):
        fresh, ttl, info = live_state(login)
        h = health.get(login, {})
        if not fresh:
            ok = False
        name = info.get("name", "?")
        bal = info.get("balance")
        eq = info.get("equity")
        pos = info.get("positions")
        lines.append("  %s %-24s TTL=%2ds bal=%s eq=%s pos=%s restarts=%s" % (
            login, name[:24], ttl,
            bal if bal is not None else "?",
            eq if eq is not None else "?",
            pos, h.get("restart_count", "?")))
    return ok, lines


def cmd_status(notify=False):
    ok, lines = collect_status()
    print("\n".join(lines))
    print("STATUS: %s" % ("OK" if ok else "DEGRADED"))
    if notify:
        text = "MT5 status %s\n%s" % (
            "OK" if ok else "DEGRADED", "\n".join(lines[1:]))
        cmd_notify(text)
    sys.exit(0 if ok else 1)


def cmd_reboot_check(wait_s):
    deadline = time.time() + wait_s
    while True:
        ok, lines = collect_status()
        if ok:
            print("\n".join(lines))
            print("REBOOT-CHECK: PASS")
            return
        if time.time() >= deadline:
            print("\n".join(lines))
            print("REBOOT-CHECK: FAIL (timeout %ss)" % wait_s)
            sys.exit(1)
        time.sleep(15)


# ---------- terminals ----------

def cmd_term(action, target, force=False):
    accounts = load_accounts()
    procs = running_terminals()
    if action == "list":
        for pid, exe in procs:
            folder = pathlib.Path(exe).parent.name.upper()
            print("  pid %-6d %s  autostart=%s" % (
                pid, folder, autostart_state(folder)))
        for login, a in sorted(accounts.items()):
            up = any(pathlib.Path(e).parent.name.upper() == a["folder"].upper()
                     for _, e in procs)
            if not up:
                print("  %-5s login=%s DOWN (autostart=%s)" % (
                    a["folder"], login, autostart_state(a["folder"].upper())))
        return
    folder = resolve_folder(target, accounts)
    pids = [p for p, e in procs
            if pathlib.Path(e).parent.name.upper() == folder]
    if action == "close":
        if not pids:
            sys.exit("ERROR: no running terminal in %s" % folder)
        fresh, _, info = next(
            (live_state(l) for l, a in accounts.items()
             if a["folder"].upper() == folder), (False, 0, {}))
        if fresh and isinstance(info.get("positions"), int) and info["positions"] > 0:
            print("WARNING: %s has %s OPEN positions — closing the terminal "
                  "stops its EAs (positions stay server-side)."
                  % (folder, info["positions"]))
        for pid in pids:
            run(["taskkill", "/PID", str(pid)], timeout=30)  # graceful WM_CLOSE
        deadline = time.time() + 20
        while time.time() < deadline and any(
                p for p, e in running_terminals()
                if pathlib.Path(e).parent.name.upper() == folder):
            time.sleep(2)
        left = [p for p, e in running_terminals()
                if pathlib.Path(e).parent.name.upper() == folder]
        if left:
            if not force:
                sys.exit("still alive %s — rerun with --force" % left)
            for pid in left:
                run(["taskkill", "/F", "/PID", str(pid)], timeout=30)
        print("closed %s (pids %s)" % (folder, pids))
    elif action == "start":
        # vps-ops rule: NEVER launch terminal64.exe directly — always start
        # a .lnk so the terminal gets its portable profile wiring. Prefer the
        # Startup .lnk; fall back to the parked C:\pause .lnk (autostart stays
        # paused — starting a paused terminal manually is allowed).
        lnk = lnk_map(STARTUP_DIR).get(folder)
        note = ""
        if not lnk:
            lnk = lnk_map(PAUSE_DIR).get(folder)
            if lnk:
                note = " (parked in %s — autostart stays PAUSED)" % PAUSE_DIR
        if not lnk:
            sys.exit(
                "ERROR: no .lnk for %s in Startup or %s — refusing to launch "
                "terminal64.exe directly (portable profile rule). Restore "
                "the .lnk first: pause/resume or recreate it." % (folder,
                                                                  PAUSE_DIR))
        r = run(["powershell", "-NoProfile", "-Command",
                 "Start-Process -FilePath '%s'" % lnk])
        if r.returncode != 0:
            sys.exit("ERROR: Start-Process failed: %s" % r.stderr.strip())
        print("started %s via %s%s" % (folder, lnk, note))
        print("bridge live key repopulates within ~60s — verify with 'status'")


def cmd_term_rogue(kill):
    """List (and with --kill, force-kill) unsanctioned terminal64.exe
    processes: direct runs without a portable flag, liveupdate staging
    duplicates that outlived the handoff grace window, and stale updaters.
    Default is list-only — the kill is operator-confirmed via --kill."""
    accounts = load_accounts()
    if not accounts:
        sys.exit("ERROR: no accounts in %s — cannot classify" % ACCOUNTS_DIR)
    known = {a["exe"].lower() for a in accounts.values() if a["exe"]}
    candidates = []
    for pid, exe, cmdline, age_s in all_terminals():
        kind = classify_terminal(exe, cmdline, age_s, known)
        rogue = (kind == "nonportable"
                 or (kind == "staging-duplicate" and age_s > STAGING_GRACE_S)
                 or (kind == "updater" and age_s > UPDATER_STALE_S))
        if rogue:
            candidates.append(pid)
        print("  pid %-6d %-18s age=%-6ds %s" % (
            pid, kind, age_s, (cmdline or exe)[:100]))
    if not candidates:
        print("no rogue terminal processes")
        return
    if not kill:
        print("\nrogue pids: %s — rerun with --kill to force-kill "
              "(taskkill /F; staging processes ignore WM_CLOSE)"
              % candidates)
        sys.exit(1)
    for pid in candidates:
        r = run(["taskkill", "/F", "/PID", str(pid)], timeout=30)
        state = "killed" if r.returncode == 0 else \
            "FAILED: %s" % _clean(r.stderr)
        print("pid %-6d %s" % (pid, state))
    gone = set(candidates) - {p[0] for p in all_terminals()}
    print("cleared %d/%d rogue process(es)" % (len(gone), len(candidates)))
    sys.exit(0 if len(gone) == len(candidates) else 1)


def resolve_folder(target, accounts):
    t = target.upper().lstrip("MT")
    for login, a in accounts.items():
        if a["folder"].upper() == ("MT" + t) or login == target:
            return a["folder"].upper()
    sys.exit("ERROR: %r matches no account (folders: %s)"
             % (target, sorted(a["folder"] for a in accounts.values())))


# ---------- pause / resume ----------

def cmd_pause(action, target, dry=False):
    """pause: move the terminal's Startup .lnk to C:\\pause (no auto-launch
    on reboot). resume: move it back from C:\\pause."""
    accounts = load_accounts()
    folder = resolve_folder(target, accounts)
    state = autostart_state(folder)
    if action == "pause":
        if state != "on":
            sys.exit("ERROR: %s autostart is %s (nothing in Startup to pause)"
                     % (folder, state))
        src = lnk_map(STARTUP_DIR)[folder]
        dst = os.path.join(PAUSE_DIR, os.path.basename(src))
    else:  # resume
        if state != "paused":
            sys.exit("ERROR: %s autostart is %s (nothing parked in %s)"
                     % (folder, state, PAUSE_DIR))
        src = lnk_map(PAUSE_DIR)[folder]
        dst = os.path.join(STARTUP_DIR, os.path.basename(src))
    if os.path.exists(dst):
        sys.exit("ERROR: destination already exists: %s" % dst)
    verb = "would move" if dry else "moved"
    print("%s: %s -> %s" % (verb, src, dst))
    if not dry:
        os.rename(src, dst)
        print("%s autostart %s (terminal unaffected until next reboot)"
              % (folder, "OFF" if action == "pause" else "ON"))


# ---------- notify ----------

def default_sms_target():
    for p in (os.path.join(os.environ["LOCALAPPDATA"], "hermes", ".env"),
              os.path.join(os.path.expanduser("~"), ".hermes", ".env")):
        if os.path.exists(p):
            m = re.search(r"^PHOTON_ALLOWED_USERS=\+?\d+[, ]*\+?(\d+)",
                          pathlib.Path(p).read_text(errors="ignore"), re.M)
            if m:
                return "+" + m.group(1)
    return None


def cmd_notify(text, to=None, dry=False):
    sidecar = json.load(open(os.path.join(
        os.environ["LOCALAPPDATA"], "hermes", "runtime",
        "photon-sidecar.json")))
    target = to or default_sms_target()
    if not target:
        sys.exit("ERROR: no SMS target (pass --to +66...)")
    print("sidecar port=%s -> %s%s" % (sidecar["port"], target,
                                       "  [dry-run]" if dry else ""))
    if dry:
        return
    req = urllib.request.Request(
        "http://127.0.0.1:%s/send" % sidecar["port"],
        data=json.dumps({"spaceId": target, "text": text}).encode(),
        headers={"Content-Type": "application/json",
                 "X-Hermes-Sidecar-Token": sidecar["token"]},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print("sidecar:", resp.status, resp.read().decode()[:200])
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print("sidecar error %s: %s" % (e.code, body))
        if "target_not_allowed" in body:
            print("Photon free tier cannot initiate to this number — "
                  "it must message the line first.")
        sys.exit(1)


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(prog="mt5ops")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("status"); s.add_argument("--notify", action="store_true")
    s = sub.add_parser("reboot-check"); s.add_argument("--wait", type=int, default=300)
    s = sub.add_parser("svc")
    s.add_argument("action", choices=["status", "start", "stop", "restart"])
    s.add_argument("name")
    s = sub.add_parser("stack")
    s.add_argument("action", choices=["stop", "start"])
    s.add_argument("--all", action="store_true")
    s = sub.add_parser("term")
    s.add_argument("action", choices=["list", "close", "start", "rogue"])
    s.add_argument("target", nargs="?")
    s.add_argument("--force", action="store_true")
    s.add_argument("--kill", action="store_true")
    p = sub.add_parser("pause"); p.add_argument("target")
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("resume"); p.add_argument("target")
    p.add_argument("--dry-run", action="store_true")
    n = sub.add_parser("notify"); n.add_argument("text", nargs="?")
    n.add_argument("--to"); n.add_argument("--dry-run", action="store_true")
    sub.add_parser("restart-computer")
    a = ap.parse_args()

    if a.cmd == "status":
        cmd_status(a.notify)
    elif a.cmd == "reboot-check":
        cmd_reboot_check(a.wait)
    elif a.cmd == "svc":
        cmd_svc(a.action, a.name)
    elif a.cmd == "stack":
        cmd_stack(a.action, a.all)
    elif a.cmd == "term":
        if a.action == "rogue":
            cmd_term_rogue(a.kill)
        elif a.action != "list" and not a.target:
            sys.exit("ERROR: term %s needs a target (MT folder or login)" % a.action)
        else:
            cmd_term(a.action, a.target, a.force)
    elif a.cmd in ("pause", "resume"):
        cmd_pause(a.cmd, a.target, a.dry_run)
    elif a.cmd == "notify":
        if not a.text:
            sys.exit("ERROR: notify needs text (or use status --notify)")
        cmd_notify(a.text, a.to, a.dry_run)
    elif a.cmd == "restart-computer":
        r = run(["shutdown", "/r", "/t", "30"], timeout=30)
        if r.returncode != 0:
            print("restart blocked for the agent (%s)." % r.stderr.strip())
            print("run yourself:  shutdown /r /t 30")
            sys.exit(1)
        print("rebooting in 30s")


if __name__ == "__main__":
    main()
