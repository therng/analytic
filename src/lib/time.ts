const BANGKOK_OFFSET_HOURS = 7;
const BANGKOK_OFFSET_MS = BANGKOK_OFFSET_HOURS * 60 * 60 * 1000;

function padTwo(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Worker-layer epoch -> Date conversion for every Deal/Order/Position/
 * OpenPosition timestamp. MT5's `time`/`time_setup`/`time_done` fields
 * (both the live `positions_get()`/tick feed AND the history
 * `history_deals_get()`/`history_orders_get()` APIs) are the broker trade
 * server's own wall clock encoded as epoch seconds — NOT true UTC unless
 * the broker server happens to run UTC. `offsetMinutes`
 * (TradingAccount.brokerUtcOffsetMinutes, e.g. 180 for a UTC+3 server) must
 * be subtracted exactly once here to recover the true UTC instant before
 * anything is written to PostgreSQL.
 *
 * Verified directly against production MT5 (2026-07-29, account 7954220,
 * broker ICMarketsSC-MT5-2): `positions_get()` and `history_deals_get()`
 * returned the IDENTICAL raw epoch (1785363660) for the opening deal/
 * position of the same ticket — one clock base for both APIs, not two.
 * (An earlier version of this function treated the two as different, based
 * on a since-disproven imported_at-skew check that was circular: the
 * ingestion cursor itself advances in the same mislabeled epoch space, so
 * that check could never have detected the offset.)
 */
export function epochSecondsToDate(
  epochSeconds: number,
  offsetMinutes: number,
): Date {
  return new Date(epochSeconds * 1000 - offsetMinutes * 60 * 1000);
}

export function toTimestamp(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

const BANGKOK_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Bangkok",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function getBangkokDateParts(
  value: Date | string | number | null | undefined,
) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) {
    return null;
  }

  const raw: Record<string, string> = {};
  for (const part of BANGKOK_PARTS_FORMATTER.formatToParts(
    new Date(timestamp),
  )) {
    raw[part.type] = part.value;
  }

  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hours: Number(raw.hour) % 24, // some ICU builds render midnight as "24"
    minutes: Number(raw.minute),
    seconds: Number(raw.second),
  };
}

export function getBangkokDateKey(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}`;
}

export function getBangkokHour(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.hours : null;
}

export function startOfBangkokDayTimestamp(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day) - BANGKOK_OFFSET_MS;
}

export function endOfBangkokDayTimestamp(
  value: Date | string | number | null | undefined,
) {
  const start = startOfBangkokDayTimestamp(value);
  return start == null ? null : start + 24 * 60 * 60 * 1000 - 1;
}

export function startOfBangkokDay(
  value: Date | string | number | null | undefined,
) {
  const timestamp = startOfBangkokDayTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

export function endOfBangkokDay(
  value: Date | string | number | null | undefined,
) {
  const timestamp = endOfBangkokDayTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

export function addBangkokDays(
  value: Date | string | number | null | undefined,
  days: number,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days) - BANGKOK_OFFSET_MS,
  );
}

export function startOfBangkokWeek(
  value: Date | string | number | null | undefined,
) {
  if (value == null) {
    return null;
  }

  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  // Sunday-start week (getUTCDay(): Sun=0 ... Sat=6 maps directly to days-back-to-Sunday).
  const weekOffset = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return addBangkokDays(value, -weekOffset);
}

export function startOfBangkokMonth(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, 1) - BANGKOK_OFFSET_MS);
}

export function endOfBangkokMonth(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month, 1) - BANGKOK_OFFSET_MS - 1);
}

export function startOfBangkokYear(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, 0, 1) - BANGKOK_OFFSET_MS);
}

export function endOfBangkokYear(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year + 1, 0, 1) - BANGKOK_OFFSET_MS - 1);
}

export function getBangkokYear(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.year : null;
}

export function getBangkokMonthIndex(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.month - 1 : null;
}

export function formatBangkokDateTime(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${parts.year}.${padTwo(parts.month)}.${padTwo(parts.day)} ${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

const WEEKDAY_LABELS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const SHORT_MONTH_LABELS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
export function formatTooltipDateLabel(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return `${WEEKDAY_LABELS[weekday]} ${parts.day} ${SHORT_MONTH_LABELS[parts.month - 1]}`;
}

export function formatTooltipTimeLabel(
  value: Date | string | number | null | undefined,
) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${padTwo(parts.hours)}:${padTwo(parts.minutes)}`;
}

export function formatSparklineXLabel(
  value: Date | string | number | null | undefined,
  timeframe: string,
): string {
  const parts = getBangkokDateParts(value);
  if (!parts) return "-";
  switch (timeframe) {
    case "1d":
      return String(parts.hours);
    case "1w": {
      const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      return WEEKDAY_LABELS[d.getUTCDay()] ?? "-";
    }
    case "1m":
      return `${parts.day} ${SHORT_MONTH_LABELS[parts.month - 1]}`;
    case "1y":
    default:
      return SHORT_MONTH_LABELS[parts.month - 1] ?? "-";
  }
}
