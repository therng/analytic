from __future__ import annotations

import ast
from pathlib import Path

SRC_ROOT = Path(__file__).resolve().parents[2] / "src" / "bridge"
PROHIBITED_CALLS = {
    "kill",
    "login",
    "order_check",
    "order_send",
    "popen",
    "restart",
    "run",
    "start",
    "terminate",
}


def test_runtime_has_no_terminal_control_or_trading_calls() -> None:
    violations: list[str] = []
    for path in SRC_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name: str | None = None
            if isinstance(node.func, ast.Attribute):
                name = node.func.attr.casefold()
            elif isinstance(node.func, ast.Name):
                name = node.func.id.casefold()
            if name in PROHIBITED_CALLS:
                violations.append(f"{path.name}:{node.lineno}:{name}")

    assert violations == []
