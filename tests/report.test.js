import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateReport,
  splitIntervalByLocalDay,
} from "../src/domain/report.js";
import {
  getRollingDateRange,
  localDateKey,
  resolveDateRange,
} from "../src/domain/local-date-range.js";

function visitAt(id, openedAt, durationMs) {
  const endedAt = openedAt + durationMs;
  return {
    id,
    siteId: "s1",
    openedAt,
    endedAt,
    activeIntervals: [{ startedAt: openedAt, endedAt }],
    lastConfirmedAt: endedAt,
    lastActivityAt: endedAt,
  };
}

function aggregateRollingReport(visits, { now, selectedDateKey, dayCount = 7 }) {
  const todayDateKey = localDateKey(now);
  const rangeWindow = resolveDateRange({
    ...getRollingDateRange(now, dayCount),
    todayDateKey,
  });
  const todayWindow = resolveDateRange({
    startDateKey: todayDateKey,
    endDateKey: todayDateKey,
    todayDateKey,
  });
  return aggregateReport({
    rangeVisits: visits,
    todayVisits: visits,
  }, {
    now,
    rangeWindow,
    todayWindow,
    selectedDateKey,
  });
}

test("returns range days and an independent today summary", () => {
  const now = new Date(2026, 8, 2, 12).getTime();
  const rangeWindow = resolveDateRange({
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
    todayDateKey: "2026-09-02",
  });
  const todayWindow = resolveDateRange({
    startDateKey: "2026-09-02",
    endDateKey: "2026-09-02",
    todayDateKey: "2026-09-02",
  });
  const report = aggregateReport({
    rangeVisits: [visitAt("historical", new Date(2026, 7, 1, 9).getTime(), 5_000)],
    todayVisits: [visitAt("today", new Date(2026, 8, 2, 10).getTime(), 7_000)],
  }, {
    now,
    rangeWindow,
    todayWindow,
    selectedDateKey: "2026-08-02",
  });

  assert.deepEqual(report.range, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
  });
  assert.deepEqual(report.todaySummary, { openCount: 1, activeMs: 7_000 });
  assert.deepEqual(report.days.map(day => day.openCount), [1, 0]);
  assert.deepEqual(report.details, []);
  assert.equal("totals" in report, false);
});

test("splits duration at local midnight but keeps the open on openedAt day", () => {
  const openedAt = new Date(2026, 7, 30, 23, 59, 50).getTime();
  const endedAt = new Date(2026, 7, 31, 0, 0, 10).getTime();
  const visit = {
    id: "v1",
    siteId: "s1",
    openedAt,
    endedAt,
    activeIntervals: [{ startedAt: openedAt, endedAt }],
    lastConfirmedAt: endedAt,
    lastActivityAt: endedAt,
  };
  const report = aggregateRollingReport([visit], {
    now: new Date(2026, 7, 31, 12).getTime(),
    selectedDateKey: localDateKey(openedAt),
  });
  const first = report.days.find(day => day.dateKey === localDateKey(openedAt));
  const second = report.days.find(day => day.dateKey === localDateKey(endedAt));
  assert.deepEqual([first.openCount, first.activeMs], [1, 10_000]);
  assert.deepEqual([second.openCount, second.activeMs], [0, 10_000]);
  assert.equal(report.details[0].durationMs, 20_000);
});

test("returns seven ordered zero-filled days", () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const report = aggregateRollingReport([], {
    now,
    selectedDateKey: localDateKey(now),
  });
  assert.equal(report.days.length, 7);
  assert.deepEqual(report.todaySummary, { openCount: 0, activeMs: 0 });
  assert.deepEqual(report.details, []);
  assert.ok(report.days.every(day => day.openCount === 0 && day.activeMs === 0));
  assert.deepEqual(
    report.days.map(day => day.dateKey),
    ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"],
  );
});

test("counts interval overlap for a visit opened before the seven-day window", () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const startedAt = new Date(2026, 7, 24, 23, 59, 50).getTime();
  const endedAt = new Date(2026, 7, 25, 0, 0, 10).getTime();
  const report = aggregateRollingReport([
    {
      id: "v1",
      siteId: "s1",
      openedAt: startedAt,
      endedAt,
      activeIntervals: [{ startedAt, endedAt }],
      lastConfirmedAt: endedAt,
      lastActivityAt: endedAt,
    },
  ], { now, selectedDateKey: localDateKey(now) });

  assert.deepEqual(report.days[0], { dateKey: "2026-08-25", openCount: 0, activeMs: 10_000 });
  assert.equal(
    report.days.reduce((total, day) => total + day.activeMs, 0),
    10_000,
  );
});

test("uses last confirmation for open intervals and keeps full duration with opened-day details", () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const openedAt = new Date(2026, 7, 30, 23, 59, 50).getTime();
  const lastConfirmedAt = new Date(2026, 7, 31, 0, 0, 10).getTime();
  const laterOpenedAt = new Date(2026, 7, 30, 8, 0, 0).getTime();
  const report = aggregateRollingReport([
    {
      id: "oldest",
      siteId: "s1",
      openedAt,
      endedAt: null,
      activeIntervals: [{ startedAt: openedAt, endedAt: null }],
      lastConfirmedAt,
      lastActivityAt: lastConfirmedAt,
    },
    {
      id: "newest",
      siteId: "s1",
      openedAt: laterOpenedAt,
      endedAt: laterOpenedAt + 5_000,
      activeIntervals: [{ startedAt: laterOpenedAt, endedAt: laterOpenedAt + 5_000 }],
      lastConfirmedAt: laterOpenedAt + 5_000,
      lastActivityAt: laterOpenedAt + 5_000,
    },
  ], { now, selectedDateKey: localDateKey(openedAt) });

  assert.equal(report.days.at(-1).activeMs, 10_000);
  assert.deepEqual(report.details.map(detail => detail.id), ["oldest", "newest"]);
  assert.deepEqual(report.details[0], {
    id: "oldest",
    openedAt,
    endedAt: null,
    durationMs: 20_000,
    ongoing: true,
  });
});

test("uses local calendar boundaries for day splits and a rolling window", () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const startedAt = new Date(2026, 7, 30, 23, 59, 59).getTime();
  const endedAt = new Date(2026, 7, 31, 0, 0, 1).getTime();
  const todayDateKey = localDateKey(now);
  const window = resolveDateRange({
    ...getRollingDateRange(now, 7),
    todayDateKey,
  });

  assert.deepEqual(splitIntervalByLocalDay(startedAt, endedAt), [
    { dateKey: "2026-08-30", durationMs: 1_000 },
    { dateKey: "2026-08-31", durationMs: 1_000 },
  ]);
  assert.equal(window.startAt, new Date(2026, 7, 25).getTime());
  assert.equal(window.endAt, new Date(2026, 8, 1).getTime());
  assert.deepEqual(window.days.map(day => day.dateKey), ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"]);
});
