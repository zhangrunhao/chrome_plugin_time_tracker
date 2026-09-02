export const DATE_RANGE_ERROR_MESSAGES = Object.freeze({
  INVALID_DATE_RANGE: "请选择有效的起始和终止日期",
  START_AFTER_END: "起始日期不能晚于终止日期",
  END_AFTER_TODAY: "终止日期不能晚于今天",
  RANGE_TOO_LONG: "日期范围最多为 30 天",
});

export class DateRangeError extends RangeError {
  constructor(code) {
    super(DATE_RANGE_ERROR_MESSAGES[code]);
    this.name = "DateRangeError";
    this.code = code;
  }
}

export function localDateKey(at) {
  const date = new Date(at);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }

  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function nextLocalMidnight(at) {
  const date = new Date(at);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
}

export function resolveDateRange({ startDateKey, endDateKey, todayDateKey }) {
  const startAt = parseLocalDateKey(startDateKey);
  const endStartedAt = parseLocalDateKey(endDateKey);
  const todayAt = parseLocalDateKey(todayDateKey);
  if (startAt === null || endStartedAt === null || todayAt === null) {
    throw new DateRangeError("INVALID_DATE_RANGE");
  }
  if (startAt > endStartedAt) {
    throw new DateRangeError("START_AFTER_END");
  }
  if (endStartedAt > todayAt) {
    throw new DateRangeError("END_AFTER_TODAY");
  }

  const days = [];
  let startedAt = startAt;
  while (startedAt <= endStartedAt && days.length <= 30) {
    const endedAt = nextLocalMidnight(startedAt);
    days.push({ dateKey: localDateKey(startedAt), startedAt, endedAt });
    startedAt = endedAt;
  }
  if (days.length > 30 || startedAt <= endStartedAt) {
    throw new DateRangeError("RANGE_TOO_LONG");
  }

  return {
    startDateKey,
    endDateKey,
    startAt,
    endAt: days.at(-1).endedAt,
    dayCount: days.length,
    days,
  };
}

export function getRollingDateRange(now, dayCount = 14) {
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 30) {
    throw new RangeError("dayCount must be an integer from 1 through 30");
  }

  const today = new Date(now);
  const startedAt = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - dayCount + 1,
  ).getTime();
  return {
    startDateKey: localDateKey(startedAt),
    endDateKey: localDateKey(now),
  };
}
