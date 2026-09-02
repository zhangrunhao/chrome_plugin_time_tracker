import { getVisitDurationMs } from "./visit-time.js";
import { localDateKey } from "./local-date-range.js";

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

function aggregateDays(visits, window, now) {
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

  return window.days.map(day => dayByKey.get(day.dateKey));
}

function selectedDetails(visits, selectedDateKey, now) {
  return visits
    .filter(visit => localDateKey(visit.openedAt) === selectedDateKey)
    .sort((left, right) => right.openedAt - left.openedAt)
    .map(visit => ({
      id: visit.id,
      openedAt: visit.openedAt,
      endedAt: visit.endedAt,
      durationMs: getVisitDurationMs(visit, { asOf: now }),
      ongoing: visit.endedAt === null,
    }));
}

export function aggregateReport(
  { rangeVisits, todayVisits },
  { now, rangeWindow, todayWindow, selectedDateKey },
) {
  const days = aggregateDays(rangeVisits, rangeWindow, now);
  const [today] = aggregateDays(todayVisits, todayWindow, now);

  return {
    range: {
      startDateKey: rangeWindow.startDateKey,
      endDateKey: rangeWindow.endDateKey,
    },
    todaySummary: { openCount: today.openCount, activeMs: today.activeMs },
    days,
    selectedDateKey,
    details: selectedDetails(rangeVisits, selectedDateKey, now),
  };
}
