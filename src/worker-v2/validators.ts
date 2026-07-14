import { isFiniteNumeric } from "./decimal";
import { decodePositionSide } from "./mt5-enums";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDealRecord(login: unknown, record: unknown, accountNo: string): ValidationResult {
  if (String(login) !== accountNo) return { ok: false, reason: "login mismatch" };
  if (!isRecord(record)) return { ok: false, reason: "record is not an object" };
  if (!isPresent(record.ticket)) return { ok: false, reason: "missing ticket" };
  if (!isFiniteNumeric(record.time)) return { ok: false, reason: "invalid time" };
  if (isPresent(record.volume) && (!isFiniteNumeric(record.volume) || Number(record.volume) < 0)) {
    return { ok: false, reason: "invalid volume" };
  }
  for (const field of ["price", "profit", "swap", "commission", "fee"] as const) {
    if (isPresent(record[field]) && !isFiniteNumeric(record[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}

export function validateOrderRecord(login: unknown, record: unknown, accountNo: string): ValidationResult {
  if (String(login) !== accountNo) return { ok: false, reason: "login mismatch" };
  if (!isRecord(record)) return { ok: false, reason: "record is not an object" };
  if (!isPresent(record.ticket)) return { ok: false, reason: "missing ticket" };

  const hasSetup = isPresent(record.time_setup);
  const hasDone = isPresent(record.time_done);
  if (!hasSetup && !hasDone) return { ok: false, reason: "missing both time_setup and time_done" };
  if (hasSetup && !isFiniteNumeric(record.time_setup)) return { ok: false, reason: "invalid time_setup" };
  if (hasDone && !isFiniteNumeric(record.time_done)) return { ok: false, reason: "invalid time_done" };

  for (const field of ["volume_initial", "volume_current"] as const) {
    if (isPresent(record[field]) && (!isFiniteNumeric(record[field]) || Number(record[field]) < 0)) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  for (const field of ["price_open", "price_current", "sl", "tp", "price_stoplimit"] as const) {
    if (isPresent(record[field]) && !isFiniteNumeric(record[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}

export function validateLiveHash(hash: Record<string, string> | null, accountNo: string): ValidationResult {
  if (!hash || Object.keys(hash).length === 0) return { ok: false, reason: "missing live hash" };
  if (!isPresent(hash.login) || String(hash.login) !== accountNo) return { ok: false, reason: "login mismatch" };
  for (const field of ["balance", "equity", "margin", "margin_free"] as const) {
    if (!isFiniteNumeric(hash[field])) return { ok: false, reason: `invalid ${field}` };
  }
  if (isPresent(hash.margin_level) && !isFiniteNumeric(hash.margin_level)) {
    return { ok: false, reason: "invalid margin_level" };
  }
  return { ok: true };
}

export function validatePositionsPayload(
  raw: string | null,
): { ok: true; positions: unknown[] } | { ok: false; reason: string } {
  if (!isPresent(raw)) return { ok: false, reason: "missing positions payload" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    return { ok: false, reason: "malformed JSON" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "positions payload is not an array" };
  return { ok: true, positions: parsed };
}

export function validateOpenPositionCandidate(position: unknown): ValidationResult {
  if (!isRecord(position)) return { ok: false, reason: "position is not an object" };
  if (!isPresent(position.ticket)) return { ok: false, reason: "missing ticket" };
  if (decodePositionSide(position.type) === null) return { ok: false, reason: "invalid position type/side" };
  for (const field of ["volume", "price_open", "price_current", "profit", "swap"] as const) {
    if (isPresent(position[field]) && !isFiniteNumeric(position[field])) {
      return { ok: false, reason: `invalid ${field}` };
    }
  }
  return { ok: true };
}
