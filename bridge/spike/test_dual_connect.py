"""
Step 0 spike: verify that 2+ portable MT5 terminals can be connected simultaneously
via separate Python processes.

Usage:
  python spike/test_dual_connect.py "C:\\MT5_1\\terminal64.exe" "C:\\MT5_2\\terminal64.exe"

Pass: prints two distinct login numbers
Fail: prints None for one or both — switch to sequential design
"""

import multiprocessing
import sys
import time

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERROR: MetaTrader5 not installed. Run: pip install MetaTrader5")
    sys.exit(1)


def probe_terminal(path: str, result_q: multiprocessing.Queue) -> None:
    ok = mt5.initialize(path=path, portable=True)
    if not ok:
        result_q.put({"path": path, "ok": False, "login": None, "error": str(mt5.last_error())})
        return
    info = mt5.account_info()
    result_q.put({
        "path": path,
        "ok": True,
        "login": info.login if info else None,
        "balance": info.balance if info else None,
    })
    mt5.shutdown()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python test_dual_connect.py <path1> <path2>")
        print("Example:")
        print('  python test_dual_connect.py "C:\\MT5_1\\terminal64.exe" "C:\\MT5_2\\terminal64.exe"')
        sys.exit(1)

    paths = sys.argv[1:]
    print(f"Testing {len(paths)} terminals simultaneously...")

    q: multiprocessing.Queue = multiprocessing.Queue()
    procs = [
        multiprocessing.Process(target=probe_terminal, args=(p, q), daemon=True)
        for p in paths
    ]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=15)

    results = []
    while not q.empty():
        results.append(q.get_nowait())

    print("\n=== Results ===")
    for r in results:
        status = "✅ OK" if r["ok"] and r["login"] else "❌ FAIL"
        print(f"{status}  path={r['path']}  login={r.get('login')}  balance={r.get('balance')}")
        if not r["ok"]:
            print(f"       error={r.get('error')}")

    logins = [r["login"] for r in results if r.get("login")]
    if len(set(logins)) == len(paths):
        print(f"\n✅ SPIKE PASSED — {len(paths)} distinct logins: {logins}")
        print("Proceed with parallel-process bridge design.")
    else:
        print(f"\n❌ SPIKE FAILED — logins={logins}")
        print("Switch to sequential connect/disconnect design (single process).")
