# Python Style Guide

Based on PEP 8 + Ruff linter (as used in `backend/` and `collector/`).

## Formatting
- **Indent**: 4 spaces
- **Line length**: 88 characters (Ruff default)
- **Quotes**: double quotes preferred
- **Imports**: stdlib → third-party → local, separated by blank lines

## Naming
- `snake_case` — functions, variables, modules
- `PascalCase` — classes (Pydantic models, FastAPI routers)
- `SCREAMING_SNAKE_CASE` — module-level constants

## FastAPI / Pydantic
- Use Pydantic models from `shared/` for cross-service type safety
- Route handlers should be thin — delegate logic to service functions
- Use `async def` for all route handlers and DB operations
- Validate with Pydantic at API boundaries; trust internal types

## Security
- HMAC signing required for Collector → Gateway communication (use `backend/security.py`)
- Never log raw secrets or account credentials
- Use `pydantic-settings` for environment config (not `os.environ` directly)

## Testing
- Run: `cd backend && source venv/bin/activate && PYTHONPATH=.. pytest`
- Use `fakeredis[lua]` for Redis in tests
- Use `httpx.AsyncClient` for FastAPI endpoint tests

## Comments
- One short line when the WHY is non-obvious
- No docstrings for simple functions; add only for public API functions
