import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  DATE_RANGE_ERROR_MESSAGES,
  DateRangeError,
  getRollingDateRange,
  resolveDateRange,
} from "../src/domain/local-date-range.js";

const TODAY = "2026-09-02";

test("builds inclusive 1, 14, and 30-day local windows", () => {
  const one = resolveDateRange({
    startDateKey: TODAY,
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });
  const fourteen = resolveDateRange({
    startDateKey: "2026-08-20",
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });
  const thirty = resolveDateRange({
    startDateKey: "2026-08-04",
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });

  assert.deepEqual([one.dayCount, fourteen.dayCount, thirty.dayCount], [1, 14, 30]);
  assert.equal(one.endAt, new Date(2026, 8, 3).getTime());
  assert.deepEqual(getRollingDateRange(new Date(2026, 8, 2, 12).getTime()), {
    startDateKey: "2026-08-20",
    endDateKey: TODAY,
  });
});

test("rejects missing, impossible, reversed, future, and 31-day ranges", () => {
  const cases = [
    [{ startDateKey: "", endDateKey: TODAY }, "INVALID_DATE_RANGE"],
    [{ startDateKey: "2026-02-30", endDateKey: TODAY }, "INVALID_DATE_RANGE"],
    [{ startDateKey: TODAY, endDateKey: "2026-08-31" }, "START_AFTER_END"],
    [{ startDateKey: TODAY, endDateKey: "2026-09-03" }, "END_AFTER_TODAY"],
    [{ startDateKey: "2026-08-03", endDateKey: TODAY }, "RANGE_TOO_LONG"],
  ];

  for (const [range, code] of cases) {
    assert.throws(
      () => resolveDateRange({ ...range, todayDateKey: TODAY }),
      error => error instanceof DateRangeError
        && error.code === code
        && error.message === DATE_RANGE_ERROR_MESSAGES[code],
    );
  }
});

test("crosses month, year, and leap day by local calendar", () => {
  const window = resolveDateRange({
    startDateKey: "2024-02-28",
    endDateKey: "2024-03-01",
    todayDateKey: "2024-03-01",
  });

  assert.deepEqual(window.days.map(day => day.dateKey), [
    "2024-02-28",
    "2024-02-29",
    "2024-03-01",
  ]);
});

test("does not treat daylight-saving days as fixed 24-hour periods", () => {
  const moduleUrl = new URL("../src/domain/local-date-range.js", import.meta.url).href;
  const script = `
    import { resolveDateRange } from ${JSON.stringify(moduleUrl)};
    const value = resolveDateRange({
      startDateKey: "2026-03-07",
      endDateKey: "2026-03-09",
      todayDateKey: "2026-03-09",
    });
    process.stdout.write(JSON.stringify(value.days.map(day => day.endedAt - day.startedAt)));
  `;
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
  });

  assert.deepEqual(JSON.parse(result), [86_400_000, 82_800_000, 86_400_000]);
});
