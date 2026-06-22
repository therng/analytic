const BANGKOK_OFFSET_HOURS = 7;
const BANGKOK_OFFSET_MS = BANGKOK_OFFSET_HOURS * 60 * 60 * 1000;
const TABLE_TO_BANGKOK_OFFSET_HOURS = 4;
const TABLE_TO_BANGKOK_OFFSET_MS = TABLE_TO_BANGKOK_OFFSET_HOURS * 60 * 60 * 1000;

export type SessionKey = "asia" | "london" | "ny" | "overnight";

function padTwo(value: number) {
  return String(value).padStart(2, "0");
}

export function toTimestamp(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getBangkokShiftedDate(value: Date | string | number) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) {
    return null;
  }

  return new Date(timestamp + BANGKOK_OFFSET_MS);
}

function getRawUtcDate(value: Date | string | number) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) {
    return null;
  }

  return new Date(timestamp);
}

function getRawDateParts(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  const raw = getRawUtcDate(value);
  if (!raw) {
    return null;
  }

  return {
    year: raw.getUTCFullYear(),
    month: raw.getUTCMonth() + 1,
    day: raw.getUTCDate(),
    hours: raw.getUTCHours(),
    minutes: raw.getUTCMinutes(),
    seconds: raw.getUTCSeconds(),
  };
}

export function getBangkokDateParts(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  const shifted = getBangkokShiftedDate(value);
  if (!shifted) {
    return null;
  }

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
  };
}

export function getBangkokDateKey(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}`;
}

export function getUTCDateKey(value: Date | string | number | null | undefined): string | null {
  if (value == null) return null;
  const d = new Date(value as string | number | Date);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${padTwo(d.getUTCMonth() + 1)}-${padTwo(d.getUTCDate())}`;
}

export function getBangkokHour(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.hours : null;
}

export function resolveMarketSession(date: Date | string | number = new Date()): SessionKey {
  const hour = getBangkokHour(date);
  if (hour == null) {
    return "overnight";
  }

  if (hour >= 7 && hour < 14) {
    return "asia";
  }

  if (hour >= 14 && hour < 20) {
    return "london";
  }

  if (hour >= 20 || hour < 2) {
    return "ny";
  }

  return "overnight";
}

export function startOfBangkokDayTimestamp(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day) - BANGKOK_OFFSET_MS;
}

export function endOfBangkokDayTimestamp(value: Date | string | number | null | undefined) {
  const start = startOfBangkokDayTimestamp(value);
  return start == null ? null : start + 24 * 60 * 60 * 1000 - 1;
}

export function startOfBangkokDay(value: Date | string | number | null | undefined) {
  const timestamp = startOfBangkokDayTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

export function endOfBangkokDay(value: Date | string | number | null | undefined) {
  const timestamp = endOfBangkokDayTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

export function addBangkokDays(value: Date | string | number | null | undefined, days: number) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days) - BANGKOK_OFFSET_MS);
}

export function startOfBangkokWeek(value: Date | string | number | null | undefined) {
  if (value == null) {
    return null;
  }

  const shifted = getBangkokShiftedDate(value);
  if (!shifted) {
    return null;
  }

  const weekOffset = (shifted.getUTCDay() + 6) % 7;
  return addBangkokDays(value, -weekOffset);
}

export function startOfBangkokMonth(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, 1) - BANGKOK_OFFSET_MS);
}

export function endOfBangkokMonth(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month, 1) - BANGKOK_OFFSET_MS - 1);
}

export function startOfBangkokYear(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, 0, 1) - BANGKOK_OFFSET_MS);
}

export function endOfBangkokYear(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year + 1, 0, 1) - BANGKOK_OFFSET_MS - 1);
}

export function getBangkokYear(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.year : null;
}

export function getBangkokMonthIndex(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  return parts ? parts.month - 1 : null;
}

export function formatBangkokDateTime(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${parts.year}.${padTwo(parts.month)}.${padTwo(parts.day)} ${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

export function formatBangkokDateLabel(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthLabels[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

export function formatBangkokTimeLabel(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

export function formatTableDateTime(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${parts.year}.${padTwo(parts.month)}.${padTwo(parts.day)} ${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

export function formatTableDateLabel(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  if (!parts) {
    return "-";
  }

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthLabels[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

export function formatTableTimeLabel(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatTooltipDateLabel(value: Date | string | number | null | undefined) {
  if (value == null) {
    return "-";
  }
  const raw = getRawUtcDate(value);
  if (!raw) {
    return "-";
  }

  return `${WEEKDAY_LABELS[raw.getUTCDay()]} ${raw.getUTCDate()} ${SHORT_MONTH_LABELS[raw.getUTCMonth()]}`;
}

export function formatTooltipTimeLabel(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${padTwo(parts.hours)}:${padTwo(parts.minutes)}`;
}

export function getTableHour(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  return parts ? parts.hours : null;
}

export function formatSparklineXLabel(
  value: Date | string | number | null | undefined,
  timeframe: string,
): string {
  const raw = value != null ? getRawUtcDate(value as Date | string | number) : null;
  if (!raw) return "-";
  switch (timeframe) {
    case "1d":
      return `${padTwo(raw.getUTCHours())}:00`;
    case "1w": {
      const nextDay = new Date(raw.getTime() + 24 * 60 * 60 * 1000);
      return WEEKDAY_LABELS[nextDay.getUTCDay()];
    }
    case "1m":
      return `${raw.getUTCDate()} ${SHORT_MONTH_LABELS[raw.getUTCMonth()]}`;
    case "1y":
    default:
      return SHORT_MONTH_LABELS[raw.getUTCMonth()];
  }
}

function getThaiPartsFromTableTime(value: Date | string | number | null | undefined) {
  const timestamp = toTimestamp(value);
  if (timestamp == null) {
    return null;
  }

  return getRawDateParts(timestamp + TABLE_TO_BANGKOK_OFFSET_MS);
}

export function getThaiDateKeyFromTableTime(value: Date | string | number | null | undefined) {
  const parts = getThaiPartsFromTableTime(value);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${padTwo(parts.month)}-${padTwo(parts.day)}`;
}

export function getThaiHourFromTableTime(value: Date | string | number | null | undefined) {
  const parts = getThaiPartsFromTableTime(value);
  return parts ? parts.hours : null;
}

export function startOfThaiDayInTableTimeTimestamp(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return Date.UTC(parts.year, parts.month - 1, parts.day, -TABLE_TO_BANGKOK_OFFSET_HOURS, 0, 0, 0);
}

export function endOfThaiDayInTableTimeTimestamp(value: Date | string | number | null | undefined) {
  const start = startOfThaiDayInTableTimeTimestamp(value);
  return start == null ? null : start + 24 * 60 * 60 * 1000 - 1;
}

export function startOfThaiDayInTableTime(value: Date | string | number | null | undefined) {
  const timestamp = startOfThaiDayInTableTimeTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

export function convertBangkokReportTimeToTableTimestamp(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return null;
  }

  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours - TABLE_TO_BANGKOK_OFFSET_HOURS,
    parts.minutes,
    parts.seconds,
    0,
  );
}

export function convertBangkokReportTimeToTableDate(value: Date | string | number | null | undefined) {
  const timestamp = convertBangkokReportTimeToTableTimestamp(value);
  return timestamp == null ? null : new Date(timestamp);
}

function extractDateMatch(text: string) {
  const ymdMatch = text.match(
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (ymdMatch) {
    const [, year, month, day, hh = "0", mm = "0", ss = "0"] = ymdMatch;
    return {
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
      day: Number.parseInt(day, 10),
      hh: Number.parseInt(hh, 10),
      mm: Number.parseInt(mm, 10),
      ss: Number.parseInt(ss, 10)
    };
  }

  const dmyMatch = text.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dmyMatch) {
    const [, day, month, year, hh = "0", mm = "0", ss = "0"] = dmyMatch;
    return {
      year: Number.parseInt(year, 10),
      month: Number.parseInt(month, 10),
      day: Number.parseInt(day, 10),
      hh: Number.parseInt(hh, 10),
      mm: Number.parseInt(mm, 10),
      ss: Number.parseInt(ss, 10)
    };
  }

  return null;
}

export function parseTableDate(value: string) {
  const text = value.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return new Date(Number.NaN);
  }

  const match = extractDateMatch(text);
  if (match) {
    return new Date(
      Date.UTC(
        match.year,
        match.month - 1,
        match.day,
        match.hh,
        match.mm,
        match.ss,
      ),
    );
  }

  const nativeParsed = new Date(text);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed;
  }

  return new Date(Number.NaN);
}

export function parseBangkokDate(value: string) {
  const text = value.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) {
    return new Date(Number.NaN);
  }

  const match = extractDateMatch(text);
  if (match) {
    return new Date(
      Date.UTC(
        match.year,
        match.month - 1,
        match.day,
        match.hh - BANGKOK_OFFSET_HOURS,
        match.mm,
        match.ss,
      ),
    );
  }

  const nativeParsed = new Date(text);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed;
  }

  return new Date(Number.NaN);
}
