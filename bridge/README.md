# bridge

Greenfield read-only MetaTrader 5 bridge (fencing-lease Redis transport + durable SQLite journal). Package is `bridge`, importable as `import bridge`.

## Status

Scaffold stage — no MT5 adapter wired to a real terminal yet, no CLI entrypoint. Library and its test suite install and run; nothing here is a runnable service.

## Requirements

- Python 3.11+
- `pydantic>=2.12,<3`

Dev/test only:
- `pytest`
- `hypothesis` (property tests in `tests/unit/test_canonical.py`)

## Install

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install pydantic
pip install pytest hypothesis      # dev/test
```

No `pip install -e .` yet — there's no `pyproject.toml`/`setup.py` in this package. Run everything from the repo root so `bridge` resolves as a top-level import.

## Run tests

```bash
python3 -m pytest -q bridge/tests
```

`tests/integration/*` and `tests/fault/*` use in-process fakes (no live Redis/MT5 required). `tests/unit/test_canonical.py` needs `hypothesis` installed or it fails to collect.
