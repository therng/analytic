"""bridge_v2 — clean MT5 raw-data extraction and transport.

Three jobs only:
  1. Connect to one portable MT5 terminal.
  2. Pull raw MT5 data (account, positions, deals, orders) without field loss.
  3. Emit it straight through (files in Phase 1, Redis in Phase 2).

No reconstruction, no barriers, no PostgreSQL-backed ACK, no MAE/MFE, no
close-position dedupe. Closed positions are reconstructed later by the Node
worker from faithfully-published raw Deals/Orders.
"""
