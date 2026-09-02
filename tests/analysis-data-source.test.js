import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisDataSource } from "../src/analysis/data-source.js";
import {
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
} from "../src/shared/protocol.js";

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createDataSourceHarness({ now, responses = [] }) {
  const queryCalls = [];
  const sentMessages = [];
  const dataSource = createAnalysisDataSource({
    siteRepository: {
      async list() {
        return [];
      },
    },
    trackingRepository: {
      async queryVisitsForReport(siteId, rangeStart, rangeEnd) {
        queryCalls.push({ siteId, rangeStart, rangeEnd });
        return [];
      },
    },
    clock: { now: () => now },
    async sendMessage(message) {
      sentMessages.push(copy(message));
      return copy(responses.shift() ?? { ok: true, data: null });
    },
  });

  return { dataSource, queryCalls, sentMessages };
}

test("reuses the selected query when its range contains today", async () => {
  const harness = createDataSourceHarness({
    now: new Date(2026, 8, 2, 12).getTime(),
  });
  const report = await harness.dataSource.getReport("s1", {
    startDateKey: "2026-08-20",
    endDateKey: "2026-09-02",
    selectedDateKey: "2026-09-02",
  });

  assert.deepEqual(harness.queryCalls, [{
    siteId: "s1",
    rangeStart: new Date(2026, 7, 20).getTime(),
    rangeEnd: new Date(2026, 8, 3).getTime(),
  }]);
  assert.equal(report.days.length, 14);
});

test("queries an excluded today as its own one-day window", async () => {
  const harness = createDataSourceHarness({
    now: new Date(2026, 8, 2, 12).getTime(),
  });
  const report = await harness.dataSource.getReport("s1", {
    startDateKey: "2026-01-01",
    endDateKey: "2026-01-02",
    selectedDateKey: "2026-01-02",
  });

  assert.deepEqual(harness.queryCalls, [
    {
      siteId: "s1",
      rangeStart: new Date(2026, 0, 1).getTime(),
      rangeEnd: new Date(2026, 0, 3).getTime(),
    },
    {
      siteId: "s1",
      rangeStart: new Date(2026, 8, 2).getTime(),
      rangeEnd: new Date(2026, 8, 3).getTime(),
    },
  ]);
  assert.deepEqual(report.range, {
    startDateKey: "2026-01-01",
    endDateKey: "2026-01-02",
  });
});

test("sends exact management commands and rejects a stable background error", async () => {
  const harness = createDataSourceHarness({
    now: new Date(2026, 8, 2, 12).getTime(),
    responses: [
      { ok: true, data: { id: "s2" } },
      {
        ok: false,
        error: {
          code: "DELETE_HISTORY_FAILED",
          message: "删除历史失败，请重试",
        },
      },
    ],
  });

  await harness.dataSource.addSite({ name: "B 站", input: "bilibili.com" });
  await assert.rejects(harness.dataSource.deleteSiteHistory("s1"), error => {
    assert.equal(error.code, "DELETE_HISTORY_FAILED");
    assert.equal(error.message, "删除历史失败，请重试");
    return true;
  });
  assert.deepEqual(harness.sentMessages, [
    { type: WEBTRACE_ADD_SITE, name: "B 站", input: "bilibili.com" },
    { type: WEBTRACE_DELETE_SITE_HISTORY, siteId: "s1" },
  ]);
  assert.equal("setSiteEnabled" in harness.dataSource, false);
});
