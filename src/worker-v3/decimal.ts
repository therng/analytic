import { Prisma } from "@prisma/client";

export function isFiniteNumeric(value: unknown): boolean {
  if (typeof value !== "number" && typeof value !== "string") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

export function toDecimal(value: unknown): Prisma.Decimal | null {
  if (!isFiniteNumeric(value)) return null;
  return new Prisma.Decimal(String(value));
}

export function toDecimalOrZero(value: unknown): Prisma.Decimal {
  return toDecimal(value) ?? new Prisma.Decimal(0);
}
