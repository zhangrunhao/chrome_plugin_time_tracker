import test from "node:test";
import assert from "node:assert/strict";
import {
  getRollingDateRange,
  localDateKey,
} from "../src/domain/local-date-range.js";
import { createWebTraceHarness } from "./helpers/webtrace-harness.js";

function reportTotals(report) {
  return report.days.reduce(
    (totals, day) => ({
      openCount: totals.openCount + day.openCount,
      activeMs: totals.activeMs + day.activeMs,
    }),
    { openCount: 0, activeMs: 0 },
  );
}

test("proves the complete WebTrace V1.1 lifecycle through real production boundaries", async t => {
  const startedAt = new Date(2026, 7, 30, 23, 59, 40).getTime();
  const harness = await createWebTraceHarness({ now: startedAt });
  t.after(() => harness.close());

  // 1. Adding the site normalizes the input without backfilling the open tab.
  const site = await harness.addSite({
    name: "知乎",
    input: "https://www.zhihu.com/question/1",
  });
  assert.deepEqual(site, {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: startedAt,
  });
  assert.equal((await harness.getVisits(site.id)).length, 0);

  // 2. Only a fresh outside-to-target navigation opens the first visit.
  await harness.navigate(1, "https://example.org/");
  await harness.navigate(1, "https://www.zhihu.com/");
  let visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].openedAt, startedAt);
  assert.equal(visits[0].endedAt, null);
  const firstVisitId = visits[0].id;

  // 3. The active, focused, visible tab accumulates only confirmed time.
  await harness.activateTab(1);
  await harness.focusWindow(1);
  await harness.setVisible(1, true);
  harness.advanceTo(startedAt + 4_000);
  await harness.confirm(1);
  harness.advanceTo(startedAt + 8_000);
  await harness.confirm(1);
  let report = await harness.getReport(site.id, { selectedDateKey: "2026-08-30" });
  assert.deepEqual(reportTotals(report), { openCount: 1, activeMs: 8_000 });
  visits = await harness.getVisits(site.id);
  assert.deepEqual(visits[0].activeIntervals, [
    { startedAt, endedAt: null },
  ]);

  // 4. Refresh and same-site subdomain navigation retain the first visit.
  await harness.navigate(1, "https://www.zhihu.com/");
  await harness.navigate(1, "https://zhuanlan.zhihu.com/p/1");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].id, firstVisitId);
  assert.equal(reportTotals(
    await harness.getReport(site.id, { selectedDateKey: "2026-08-30" }),
  ).openCount, 1);

  // 5. A same-site child tab inherits instead of opening a second visit.
  await harness.createTab({
    tabId: 2,
    windowId: 1,
    openerTabId: 1,
    url: "https://www.zhihu.com/question/2",
  });
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].id, firstVisitId);
  assert.equal(visits[0].endedAt, null);

  // 6. Switching to the child and back creates two non-overlapping intervals.
  await harness.activateTab(2);
  await harness.setVisible(2, true);
  harness.advanceTo(startedAt + 12_000);
  await harness.confirm(2);
  await harness.activateTab(1);
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].activeIntervals.length, 2);
  assert.deepEqual(visits[0].activeIntervals, [
    { startedAt, endedAt: startedAt + 8_000 },
    { startedAt: startedAt + 8_000, endedAt: startedAt + 12_000 },
  ]);
  assert.ok(
    visits[0].activeIntervals[0].endedAt <= visits[0].activeIntervals[1].startedAt,
  );

  // 7. A confirmed interval crossing local midnight splits duration, not ownership.
  await harness.setVisible(1, true);
  harness.advanceTo(startedAt + 18_000);
  await harness.confirm(1);
  harness.advanceTo(startedAt + 26_000);
  await harness.confirm(1);
  report = await harness.getReport(site.id, { selectedDateKey: "2026-08-30" });
  const openingDay = report.days.find(day => day.dateKey === "2026-08-30");
  const nextDay = report.days.find(day => day.dateKey === "2026-08-31");
  assert.deepEqual(openingDay, {
    dateKey: "2026-08-30",
    openCount: 1,
    activeMs: 20_000,
  });
  assert.deepEqual(nextDay, {
    dateKey: "2026-08-31",
    openCount: 0,
    activeMs: 6_000,
  });
  assert.deepEqual(reportTotals(report), { openCount: 1, activeMs: 26_000 });
  assert.equal(report.details.length, 1);
  assert.equal(report.details[0].durationMs, 26_000);
  assert.deepEqual(
    (await harness.getReport(site.id, { selectedDateKey: "2026-08-31" })).details,
    [],
  );

  // 8. The first visit ends only after every associated tab leaves the site.
  await harness.navigate(1, "https://example.org/one");
  visits = await harness.getVisits(site.id);
  assert.equal(visits[0].endedAt, null);
  await harness.navigate(2, "https://example.org/two");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].endedAt, startedAt + 26_000);
  assert.ok(visits[0].activeIntervals.every(interval => interval.endedAt !== null));

  // 9. A later outside-to-target entry opens a second visit.
  await harness.navigate(1, "https://www.zhihu.com/question/3");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 2);
  assert.equal(visits[1].endedAt, null);
  const secondVisitId = visits[1].id;

  // 10. Continuous tracking keeps the site enabled while a normal leave ends the visit.
  await harness.navigate(1, "https://example.org/again");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 2);
  assert.equal(visits[1].id, secondVisitId);
  assert.equal(visits[1].endedAt, startedAt + 26_000);
  assert.equal((await harness.listSites())[0].enabled, true);
  assert.deepEqual(
    reportTotals(await harness.getReport(site.id, { selectedDateKey: "2026-08-31" })),
    { openCount: 2, activeMs: 26_000 },
  );

  // 11. Returning under continuous tracking opens the third visit.
  await harness.navigate(1, "https://www.zhihu.com/question/4");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 3);
  assert.equal(visits[2].endedAt, null);
  const deletedVisitIds = visits.map(visit => visit.id);

  // 12. Default and historical reports use 14/30-day ranges with an independent today summary.
  const reportNow = new Date(2026, 7, 31, 12).getTime();
  await harness.advanceTo(reportNow);
  const defaultReport = await harness.getReport(site.id);
  assert.equal(defaultReport.days.length, 14);
  assert.deepEqual(defaultReport.range, {
    startDateKey: getRollingDateRange(reportNow).startDateKey,
    endDateKey: localDateKey(reportNow),
  });
  const historical = await harness.getReport(site.id, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-30",
    selectedDateKey: "2026-08-30",
  });
  assert.equal(historical.days.length, 30);
  assert.deepEqual(historical.range, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-30",
  });
  assert.deepEqual(historical.todaySummary, defaultReport.todaySummary);

  // 13. Deletion zeroes the default range, preserves enabled config, and refresh stays empty.
  await harness.deleteHistory(site.id);
  report = await harness.getReport(site.id);
  assert.deepEqual(reportTotals(report), { openCount: 0, activeMs: 0 });
  assert.equal(report.days.length, 14);
  assert.ok(report.days.every(day => day.openCount === 0 && day.activeMs === 0));
  assert.deepEqual(report.details, []);
  assert.deepEqual(await harness.listSites(), [site]);
  await harness.navigate(1, "https://www.zhihu.com/question/4");
  assert.equal((await harness.getVisits(site.id)).length, 0);

  // 14. Only a post-deletion leave-and-return creates one fresh visit.
  await harness.navigate(1, "https://example.org/fresh");
  harness.advanceTo(reportNow + 4_000);
  await harness.navigate(1, "https://www.zhihu.com/question/5");
  visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].openedAt, reportNow + 4_000);
  assert.equal(visits[0].endedAt, null);
  assert.equal(deletedVisitIds.includes(visits[0].id), false);
  assert.deepEqual(
    reportTotals(await harness.getReport(site.id, { selectedDateKey: "2026-08-31" })),
    { openCount: 1, activeMs: 0 },
  );
  assert.equal((await harness.listSites())[0].enabled, true);
});

test("treats an observable non-HTTP top-level commit as leaving the configured site", async t => {
  const startedAt = new Date(2026, 8, 1, 16, 30, 0).getTime();
  const harness = await createWebTraceHarness({ now: startedAt });
  t.after(() => harness.close());

  const site = await harness.addSite({
    name: "知乎",
    input: "zhihu.com",
  });

  await harness.navigate(1, "https://example.org/");
  await harness.navigate(1, "https://www.zhihu.com/first");
  assert.equal((await harness.getVisits(site.id)).length, 1);

  await harness.navigate(1, "chrome://extensions/");
  const [firstVisit] = await harness.getVisits(site.id);
  assert.equal(firstVisit.endedAt, startedAt);

  await harness.navigate(1, "https://www.zhihu.com/second");
  const visits = await harness.getVisits(site.id);
  assert.equal(visits.length, 2);
  assert.equal(visits[1].endedAt, null);
});
