import { getVisitDurationMs } from "./visit-time.js";

export function localDateKey(at) {
  const date = new Date(at);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDayStart(at) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function getSevenDayWindow(now) {
  const today = new Date(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const startedAt = date.getTime();
    const endedAt = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    return { dateKey: localDateKey(startedAt), startedAt, endedAt };
  });

  return {
    startAt: days[0].startedAt,
    endAt: days.at(-1).endedAt,
    days,
  };
}

export function splitIntervalByLocalDay(startedAt, endedAt) {
  const parts = [];
  let partStartedAt = startedAt;

  while (partStartedAt < endedAt) {
    const date = new Date(partStartedAt);
    const nextMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const partEndedAt = Math.min(endedAt, nextMidnight);
    parts.push({
      dateKey: localDateKey(partStartedAt),
      durationMs: partEndedAt - partStartedAt,
    });
    partStartedAt = partEndedAt;
  }

  return parts;
}

function effectiveIntervalEnd(interval, visit, now) {
  return interval.endedAt === null
    ? Math.min(now, visit.lastConfirmedAt)
    : interval.endedAt;
}

export function aggregateSevenDayReport(visits, { now, selectedDateKey }) {
  const window = getSevenDayWindow(now);
  const dayByKey = new Map(
    window.days.map(day => [day.dateKey, { dateKey: day.dateKey, openCount: 0, activeMs: 0 }]),
  );

  for (const visit of visits) {
    const openedDay = dayByKey.get(localDateKey(visit.openedAt));
    if (openedDay) {
      openedDay.openCount += 1;
    }

    for (const interval of visit.activeIntervals) {
      const intervalEndedAt = effectiveIntervalEnd(interval, visit, now);
      const startedAt = Math.max(interval.startedAt, window.startAt);
      const endedAt = Math.min(intervalEndedAt, window.endAt);
      if (endedAt <= startedAt) {
        continue;
      }

      for (const part of splitIntervalByLocalDay(startedAt, endedAt)) {
        const day = dayByKey.get(part.dateKey);
        if (day) {
          day.activeMs += part.durationMs;
        }
      }
    }
  }

  const days = window.days.map(day => dayByKey.get(day.dateKey));
  const totals = days.reduce(
    (result, day) => ({
      openCount: result.openCount + day.openCount,
      activeMs: result.activeMs + day.activeMs,
    }),
    { openCount: 0, activeMs: 0 },
  );
  const details = visits
    .filter(visit => localDateKey(visit.openedAt) === selectedDateKey)
    .sort((left, right) => right.openedAt - left.openedAt)
    .map(visit => ({
      id: visit.id,
      openedAt: visit.openedAt,
      endedAt: visit.endedAt,
      durationMs: getVisitDurationMs(visit, { asOf: now }),
      ongoing: visit.endedAt === null,
    }));

  return { days, totals, selectedDateKey, details };
}
