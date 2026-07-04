-- Bridge/Redis-only source migration.
-- Removes tables that only supported legacy FTP/manual HTML report imports.

DROP TABLE IF EXISTS "ReportImport";
DROP TABLE IF EXISTS "EquityHistory";
