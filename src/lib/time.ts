const BANGKOK_OFFSET_HOURS = 7;
const BANGKOK_OFFSET_MS = BANGKOK_OFFSET_HOURS * 60 * 60 * 1000;
const TABLE_TO_BANGKOK_OFFSET_HOURS = 4;
const TABLE_TO_BANGKOK_OFFSET_MS = TABLE_TO_BANGKOK_OFFSET_HOURS * 60 * 60 * 1000;

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

export function formatBangkokDateLabel(value: Date | string | number | null | undefined) {
  const parts = getBangkokDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${EN_MONTH_LABELS[parts.month - 1]} ${parts.day}, ${parts.year}`;
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

  return `${EN_MONTH_LABELS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

export function formatTableTimeLabel(value: Date | string | number | null | undefined) {
  const parts = getRawDateParts(value);
  if (!parts) {
    return "-";
  }

  return `${padTwo(parts.hours)}:${padTwo(parts.minutes)}:${padTwo(parts.seconds)}`;
}

const WEEKDAY_LABELS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const SHORT_MONTH_LABELS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

export function formatSparklineXLabel(
  value: Date | string | number | null | undefined,
  timeframe: string,
): string {
  // Data points use table-time format (Bangkok - 4h stored as UTC).
  // Must use table-to-thai helpers, not raw Bangkok UTC offset.
  const parts = getThaiPartsFromTableTime(value);
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

