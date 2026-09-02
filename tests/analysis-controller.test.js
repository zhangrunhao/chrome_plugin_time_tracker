import test from "node:test";
import assert from "node:assert/strict";
import {
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
} from "../src/shared/protocol.js";
import { createAnalysisDataSource } from "../src/analysis/data-source.js";
import { createAnalysisController } from "../src/analysis/controller.js";

function copy(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createViewFake() {
  return {
    models: [],
    lastModel: null,
    render(model) {
      this.lastModel = copy(model);
      this.models.push(this.lastModel);
    },
  };
}

function createSchedulerFake() {
  const intervals = [];
  return {
    intervals,
    setInterval(callback, delay) {
      const interval = { callback, delay, active: true };
      intervals.push(interval);
      return interval;
    },
    clearInterval(interval) {
      interval.active = false;
    },
  };
}

function createVisibilityFake(visible = true) {
  const listeners = new Set();
  return {
    isVisible() {
      return visible;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setVisible(nextVisible) {
      visible = nextVisible;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function createAnalysisHarness({
  now,
  sites = [],
  visits = [],
  commandResponder,
} = {}) {
  let currentNow = now;
  let storedSites = copy(sites);
  let storedVisits = copy(visits);
  let nextSiteId = 1;
  const repositoryCalls = {
    listSites: 0,
    getReport: [],
    queryVisitsForReport: [],
    sendMessage: [],
  };
  const siteRepository = {
    async list() {
      repositoryCalls.listSites += 1;
      return copy(storedSites);
    },
  };
  const trackingRepository = {
    async queryVisitsForReport(siteId, rangeStart, rangeEnd) {
      repositoryCalls.queryVisitsForReport.push({ siteId, rangeStart, rangeEnd });
      return copy(storedVisits.filter(visit => visit.siteId === siteId));
    },
  };
  const clock = {
    now() {
      return currentNow;
    },
    set(value) {
      currentNow = value;
    },
  };
  const sendMessage = async message => {
    repositoryCalls.sendMessage.push(copy(message));
    if (commandResponder !== undefined) {
      return commandResponder(copy(message));
    }

    if (message.type === WEBTRACE_ADD_SITE) {
      const site = {
        id: `added-${nextSiteId}`,
        name: message.name.trim(),
        domain: message.input,
        enabled: true,
        createdAt: currentNow,
      };
      nextSiteId += 1;
      storedSites.push(site);
      return { ok: true, data: copy(site) };
    }
    if (message.type === WEBTRACE_DELETE_SITE_HISTORY) {
      storedVisits = storedVisits.filter(visit => visit.siteId !== message.siteId);
      return {
        ok: true,
        data: copy(storedSites.find(site => site.id === message.siteId)),
      };
    }
    throw new Error(`Unexpected command: ${message.type}`);
  };

  const dataSource = createAnalysisDataSource({
    siteRepository,
    trackingRepository,
    clock,
    sendMessage,
  });
  const getReport = dataSource.getReport.bind(dataSource);
  dataSource.getReport = (siteId, options) => {
    repositoryCalls.getReport.push({ siteId, options: copy(options) });
    return getReport(siteId, options);
  };
  Object.defineProperties(dataSource, {
    sites: {
      get: () => copy(storedSites),
      set: nextSites => {
        storedSites = copy(nextSites);
      },
    },
    visits: {
      get: () => copy(storedVisits),
      set: nextVisits => {
        storedVisits = copy(nextVisits);
      },
    },
  });
  const view = createViewFake();
  const scheduler = createSchedulerFake();
  const visibility = createVisibilityFake();
  const controller = createAnalysisController({
    dataSource,
    view,
    clock,
    scheduler,
    visibility,
  });

  return {
    controller,
    dataSource,
    view,
    repositoryCalls,
    clock,
    scheduler,
    visibility,
  };
}

const NOW = new Date(2026, 7, 31, 12).getTime();
const TODAY = "2026-08-31";
const SITES = [
  { id: "disabled-site", name: "B 站", domain: "bilibili.com", enabled: false, createdAt: 2 },
  { id: "s1", name: "知乎", domain: "zhihu.com", enabled: true, createdAt: 1 },
];

test("selects the earliest-created site and initializes a rolling fourteen-day range", async () => {
  const now = new Date(2026, 8, 1, 12).getTime();
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now,
    sites: SITES,
  });

  await controller.initialize();

  assert.equal(view.lastModel.selectedSiteId, "s1");
  assert.equal("applyDateRange" in controller, false);
  assert.equal(view.lastModel.appliedRange, undefined);
  assert.equal(view.lastModel.rangeError, undefined);
  assert.equal(view.lastModel.todayDateKey, "2026-09-01");
  assert.equal(view.lastModel.selectedDateKey, "2026-09-01");
  assert.equal(view.lastModel.report.days.length, 14);
  assert.deepEqual(repositoryCalls.getReport, [{
    siteId: "s1",
    options: {
      startDateKey: "2026-08-19",
      endDateKey: "2026-09-01",
      selectedDateKey: "2026-09-01",
    },
  }]);
  assert.equal(repositoryCalls.queryVisitsForReport.length, 1);
});

test("recomputes the fixed rolling range after local midnight", async () => {
  const { controller, clock, view, repositoryCalls } = createAnalysisHarness({
    now: new Date(2026, 8, 1, 12).getTime(),
    sites: SITES,
  });
  await controller.initialize();
  await controller.selectDate("2026-08-29");

  clock.set(new Date(2026, 8, 2, 12).getTime());
  await controller.refresh();

  assert.equal(view.lastModel.todayDateKey, "2026-09-02");
  assert.equal(view.lastModel.appliedRange, undefined);
  assert.equal(view.lastModel.rangeError, undefined);
  assert.deepEqual(repositoryCalls.getReport.at(-1), {
    siteId: "s1",
    options: {
      startDateKey: "2026-08-20",
      endDateKey: "2026-09-02",
      selectedDateKey: "2026-08-29",
    },
  });
  assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
});

test("keeps disabled sites selectable and switches detail dates", async () => {
  const { controller, view } = createAnalysisHarness({ now: NOW, sites: SITES });
  await controller.initialize();

  await controller.selectSite("disabled-site");
  await controller.selectDate("2026-08-29");

  assert.equal(view.lastModel.selectedSiteId, "disabled-site");
  assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
  assert.equal(view.lastModel.report.selectedDateKey, "2026-08-29");
});

test("shows a zero state when there are no sites", async () => {
  const { controller, dataSource, view } = createAnalysisHarness({
    now: NOW,
    sites: SITES,
  });
  dataSource.sites = [];

  await controller.initialize();

  assert.equal(view.lastModel.mode, "NO_SITES");
  assert.equal(view.lastModel.report, null);
});

test("keeps an operation error through refresh until the next user action", async () => {
  const { controller, view } = createAnalysisHarness({
    now: NOW,
    sites: SITES,
    commandResponder: async () => ({
      ok: false,
      error: { code: "DUPLICATE_SITE", message: "该网站已经添加" },
    }),
  });
  await controller.initialize();

  await controller.addSite({ name: "知乎", input: "zhihu.com" });
  assert.deepEqual(view.lastModel.error, {
    code: "DUPLICATE_SITE",
    message: "该网站已经添加",
  });

  await controller.refresh();
  assert.deepEqual(view.lastModel.error, {
    code: "DUPLICATE_SITE",
    message: "该网站已经添加",
  });

  await controller.selectDate("2026-08-30");
  assert.equal(view.lastModel.error, null);
});

test("maps unexpected read failures to a generic public error", async () => {
  const view = createViewFake();
  const controller = createAnalysisController({
    dataSource: {
      async listSites() {
        throw new Error("private implementation detail");
      },
      async getReport() {
        throw new Error("unreachable");
      },
    },
    view,
    clock: { now: () => NOW },
  });

  await controller.initialize();

  assert.deepEqual(view.lastModel.error, {
    code: "INTERNAL_ERROR",
    message: "操作失败，请重试",
  });
});

test("refresh preserves a selected disabled site and date while both remain available", async () => {
  const { controller, dataSource, view } = createAnalysisHarness({ now: NOW, sites: SITES });
  await controller.initialize();
  await controller.selectSite("disabled-site");
  await controller.selectDate("2026-08-27");
  dataSource.sites = [
    { ...SITES[1], name: "知乎社区" },
    { ...SITES[0], name: "哔哩哔哩" },
  ];

  await controller.refresh();

  assert.equal(view.lastModel.selectedSiteId, "disabled-site");
  assert.equal(view.lastModel.selectedDateKey, "2026-08-27");
});

test("refresh falls back to the earliest site while preserving an in-range date", async () => {
  const { controller, dataSource, view } = createAnalysisHarness({ now: NOW, sites: SITES });
  await controller.initialize();
  await controller.selectSite("disabled-site");
  await controller.selectDate("2026-08-27");
  dataSource.sites = [{ ...SITES[1], id: "replacement", createdAt: 5 }];

  await controller.refresh();

  assert.equal(view.lastModel.selectedSiteId, "replacement");
  assert.equal(view.lastModel.selectedDateKey, "2026-08-27");
});

test("reloads after adding a site, selects it, and exposes pending state", async () => {
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: [SITES[1]],
  });
  await controller.initialize();

  await controller.addSite({ name: "B 站", input: "bilibili.com" });
  const addedSiteId = view.lastModel.selectedSiteId;
  assert.equal(addedSiteId, "added-1");
  assert.ok(view.models.some(model => model.pending === true));
  assert.deepEqual(repositoryCalls.sendMessage, [
    { type: WEBTRACE_ADD_SITE, name: "B 站", input: "bilibili.com" },
  ]);
  assert.equal("setSiteEnabled" in controller, false);
});

test("requests and cancels deletion without mutation, then deletes only after explicit confirmation", async () => {
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: [SITES[1]],
  });
  await controller.initialize();

  controller.requestDeleteHistory("s1");
  assert.equal(view.lastModel.deleteConfirmationSiteId, "s1");
  assert.equal(repositoryCalls.sendMessage.length, 0);

  controller.cancelDeleteHistory();
  assert.equal(view.lastModel.deleteConfirmationSiteId, null);
  assert.equal(repositoryCalls.sendMessage.length, 0);

  controller.requestDeleteHistory("s1");
  await controller.confirmDeleteHistory();
  assert.deepEqual(repositoryCalls.sendMessage, [
    { type: WEBTRACE_DELETE_SITE_HISTORY, siteId: "s1" },
  ]);
  assert.equal(view.lastModel.deleteConfirmationSiteId, null);
  assert.equal(view.lastModel.selectedSiteId, "s1");
});

test("coalesces a refresh requested during an in-flight refresh without overlap", async () => {
  const first = deferred();
  const second = deferred();
  let listCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const dataSource = {
    async listSites() {
      listCalls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const result = await (listCalls === 1 ? first.promise : second.promise);
      active -= 1;
      return result;
    },
    async getReport() {
      return {
        days: [{ dateKey: TODAY, openCount: 0, activeMs: 0 }],
        totals: { openCount: 0, activeMs: 0 },
        selectedDateKey: TODAY,
        details: [],
      };
    },
  };
  const controller = createAnalysisController({
    dataSource,
    view: createViewFake(),
    clock: { now: () => NOW },
  });

  const initialRefresh = controller.refresh();
  const pendingRefresh = controller.refresh();
  assert.equal(listCalls, 1);
  first.resolve([SITES[1]]);
  for (let index = 0; index < 10 && listCalls < 2; index += 1) {
    await Promise.resolve();
  }
  assert.equal(listCalls, 2);
  second.resolve([SITES[1]]);
  await Promise.all([initialRefresh, pendingRefresh]);

  assert.equal(maximumActive, 1);
  assert.equal(listCalls, 2);
});

test("runs a queued refresh after the in-flight site read rejects", async () => {
  const failedList = deferred();
  const failedListStarted = deferred();
  let listCalls = 0;
  let activeReads = 0;
  let maximumActiveReads = 0;
  const report = {
    siteId: "s1",
    days: [{ dateKey: TODAY, openCount: 0, activeMs: 0 }],
    totals: { openCount: 0, activeMs: 0 },
    selectedDateKey: TODAY,
    details: [],
  };
  const dataSource = {
    async listSites() {
      listCalls += 1;
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      try {
        if (listCalls === 2) {
          failedListStarted.resolve();
          return await failedList.promise;
        }
        return copy(SITES);
      } finally {
        activeReads -= 1;
      }
    },
    async getReport() {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      activeReads -= 1;
      return copy(report);
    },
  };
  const view = createViewFake();
  const controller = createAnalysisController({
    dataSource,
    view,
    clock: { now: () => NOW },
  });
  await controller.initialize();

  const failedRefresh = controller.refresh();
  await failedListStarted.promise;
  const queuedRefresh = controller.refresh();
  failedList.reject(new Error("site read failed"));
  await Promise.all([failedRefresh, queuedRefresh]);

  assert.equal(listCalls, 3);
  assert.equal(maximumActiveReads, 1);
  assert.equal(view.lastModel.report.siteId, "s1");
});

test("runs a queued latest selection after the in-flight report read rejects", async () => {
  const failedReport = deferred();
  const failedReportStarted = deferred();
  let listCalls = 0;
  let reportCalls = 0;
  let activeReads = 0;
  let maximumActiveReads = 0;
  const reportFor = siteId => ({
    siteId,
    days: [{ dateKey: TODAY, openCount: 0, activeMs: 0 }],
    totals: { openCount: 0, activeMs: 0 },
    selectedDateKey: TODAY,
    details: [],
  });
  const dataSource = {
    async listSites() {
      listCalls += 1;
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      activeReads -= 1;
      return copy(SITES);
    },
    async getReport(siteId) {
      reportCalls += 1;
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      try {
        if (reportCalls === 2) {
          failedReportStarted.resolve();
          return await failedReport.promise;
        }
        return reportFor(siteId);
      } finally {
        activeReads -= 1;
      }
    },
  };
  const view = createViewFake();
  const controller = createAnalysisController({
    dataSource,
    view,
    clock: { now: () => NOW },
  });
  await controller.initialize();

  const failedRefresh = controller.refresh();
  await failedReportStarted.promise;
  const latestSelection = controller.selectSite("disabled-site");
  failedReport.reject(new Error("report read failed"));
  await Promise.all([failedRefresh, latestSelection]);

  assert.equal(listCalls, 3);
  assert.equal(reportCalls, 3);
  assert.equal(maximumActiveReads, 1);
  assert.equal(view.lastModel.selectedSiteId, "disabled-site");
  assert.equal(view.lastModel.report.siteId, "disabled-site");
});

test("serializes rapid site selections so a stale report cannot replace the latest site", async () => {
  const disabledReport = deferred();
  const enabledReport = deferred();
  let reportCalls = 0;
  let activeReports = 0;
  let maximumActiveReports = 0;
  const reportFor = siteId => ({
    siteId,
    days: [{ dateKey: TODAY, openCount: 0, activeMs: 0 }],
    totals: { openCount: 0, activeMs: 0 },
    selectedDateKey: TODAY,
    details: [],
  });
  const dataSource = {
    async listSites() {
      return copy(SITES);
    },
    async getReport(siteId) {
      reportCalls += 1;
      if (reportCalls === 1) {
        return reportFor(siteId);
      }
      activeReports += 1;
      maximumActiveReports = Math.max(maximumActiveReports, activeReports);
      const report = await (siteId === "disabled-site"
        ? disabledReport.promise
        : enabledReport.promise);
      activeReports -= 1;
      return report;
    },
  };
  const view = createViewFake();
  const controller = createAnalysisController({
    dataSource,
    view,
    clock: { now: () => NOW },
  });
  await controller.initialize();

  const firstSelection = controller.selectSite("disabled-site");
  const latestSelection = controller.selectSite("s1");
  enabledReport.resolve(reportFor("s1"));
  await Promise.resolve();
  disabledReport.resolve(reportFor("disabled-site"));
  await Promise.all([firstSelection, latestSelection]);

  assert.equal(view.lastModel.selectedSiteId, "s1");
  assert.equal(view.lastModel.report.siteId, "s1");
  assert.equal(maximumActiveReports, 1);
});

test("refreshes every four seconds only while visible and refreshes on return", async () => {
  const { controller, scheduler, visibility, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: [SITES[1]],
  });
  await controller.initialize();
  const stop = controller.startAutoRefresh();

  assert.equal(scheduler.intervals.length, 1);
  assert.equal(scheduler.intervals[0].delay, 4_000);
  visibility.setVisible(false);
  await scheduler.intervals[0].callback();
  assert.equal(repositoryCalls.listSites, 1);

  visibility.setVisible(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(repositoryCalls.listSites, 2);

  await scheduler.intervals[0].callback();
  assert.equal(repositoryCalls.listSites, 3);
  stop();
  assert.equal(scheduler.intervals[0].active, false);
});
