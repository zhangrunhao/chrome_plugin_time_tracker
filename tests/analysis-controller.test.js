import test from "node:test";
import assert from "node:assert/strict";
import {
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
  WEBTRACE_SET_SITE_ENABLED,
} from "../src/shared/protocol.js";
import { createAnalysisDataSource } from "../src/analysis/data-source.js";
import { createAnalysisController } from "../src/analysis/controller.js";
import { createAnalysisView } from "../src/analysis/view.js";

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

class FakeElement {
  constructor(tagName, id = "", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value),
      getPropertyValue: name => this.style.values.get(name) ?? "",
    };
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.required = false;
    this.type = "";
    this.name = "";
    this.value = "";
    this._textContent = "";
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  set innerHTML(_value) {
    throw new Error("The analysis view must not write innerHTML");
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    if (
      this.ownerDocument !== null &&
      (
        this.ownerDocument.activeElement === this ||
        descendants(this).includes(this.ownerDocument.activeElement)
      )
    ) {
      this.ownerDocument.activeElement = null;
    }
    this.children = [];
    this._textContent = "";
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type) {
    const event = {
      currentTarget: this,
      preventDefault() {},
    };
    const results = (this.listeners.get(type) ?? []).map(listener => listener(event));
    await Promise.all(results.filter(result => result instanceof Promise));
  }

  click() {
    return this.dispatch("click");
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  reset() {
    for (const element of descendants(this)) {
      if (element.tagName === "INPUT") {
        element.value = "";
      }
    }
  }

  focus(options) {
    if (this.ownerDocument !== null) {
      this.ownerDocument.activeElement = this;
    }
    this.lastFocusOptions = copy(options);
  }
}

function descendants(root) {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

function byDataset(root, key, value) {
  return descendants(root).filter(element => element.dataset[key] === value);
}

function createDocumentFake() {
  const ids = [
    "site-list",
    "manage-sites",
    "summary",
    "open-chart",
    "duration-chart",
    "visit-details",
    "site-manager",
    "error-banner",
  ];
  const document = {
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, "", document);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    elements: null,
  };
  const elements = new Map(ids.map(id => [
    id,
    new FakeElement(id === "site-manager" ? "dialog" : "div", id, document),
  ]));
  elements.get("manage-sites").tagName = "BUTTON";
  document.elements = elements;
  return document;
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
    if (message.type === WEBTRACE_SET_SITE_ENABLED) {
      storedSites = storedSites.map(site => (
        site.id === message.siteId ? { ...site, enabled: message.enabled } : site
      ));
      return {
        ok: true,
        data: copy(storedSites.find(site => site.id === message.siteId)),
      };
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
  assert.deepEqual(view.lastModel.appliedRange, {
    startDateKey: "2026-08-19",
    endDateKey: "2026-09-01",
    mode: "ROLLING",
  });
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

test("rejects invalid ranges without replacing the applied report", async () => {
  const now = new Date(2026, 8, 1, 12).getTime();
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now,
    sites: SITES,
  });
  await controller.initialize();

  const cases = [
    [{ startDateKey: "", endDateKey: "2026-09-01" }, "INVALID_DATE_RANGE", "请选择有效的起始和终止日期"],
    [{ startDateKey: "2026-02-30", endDateKey: "2026-09-01" }, "INVALID_DATE_RANGE", "请选择有效的起始和终止日期"],
    [{ startDateKey: "2026-09-02", endDateKey: "2026-09-01" }, "START_AFTER_END", "起始日期不能晚于终止日期"],
    [{ startDateKey: "2026-09-01", endDateKey: "2026-09-02" }, "END_AFTER_TODAY", "终止日期不能晚于今天"],
    [{ startDateKey: "2026-08-02", endDateKey: "2026-09-01" }, "RANGE_TOO_LONG", "日期范围最多为 30 天"],
  ];

  for (const [range, code, message] of cases) {
    const before = copy(view.lastModel);
    const callCount = repositoryCalls.getReport.length;

    await controller.applyDateRange(range);

    assert.deepEqual(view.lastModel.appliedRange, before.appliedRange);
    assert.equal(view.lastModel.selectedDateKey, before.selectedDateKey);
    assert.deepEqual(view.lastModel.report, before.report);
    assert.equal(repositoryCalls.getReport.length, callCount);
    assert.deepEqual(view.lastModel.rangeError, { code, message });
  }
});

test("applies custom ranges and preserves their date selection across websites", async () => {
  const { controller, view } = createAnalysisHarness({ now: NOW, sites: SITES });
  await controller.initialize();

  await controller.selectDate("2026-08-29");
  await controller.applyDateRange({
    startDateKey: "2026-08-20",
    endDateKey: "2026-08-31",
  });
  assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
  assert.deepEqual(view.lastModel.appliedRange, {
    startDateKey: "2026-08-20",
    endDateKey: "2026-08-31",
    mode: "CUSTOM",
  });

  await controller.applyDateRange({
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
  });
  assert.equal(view.lastModel.selectedDateKey, "2026-08-02");

  await controller.selectSite("disabled-site");
  assert.equal(view.lastModel.selectedSiteId, "disabled-site");
  assert.deepEqual(view.lastModel.appliedRange, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
    mode: "CUSTOM",
  });
  assert.equal(view.lastModel.selectedDateKey, "2026-08-02");
});

test("advances only a rolling range after local midnight", async () => {
  const { controller, clock, view } = createAnalysisHarness({
    now: new Date(2026, 8, 1, 12).getTime(),
    sites: SITES,
  });
  await controller.initialize();
  await controller.selectDate("2026-08-29");

  clock.set(new Date(2026, 8, 2, 12).getTime());
  await controller.refresh();

  assert.equal(view.lastModel.todayDateKey, "2026-09-02");
  assert.deepEqual(view.lastModel.appliedRange, {
    startDateKey: "2026-08-20",
    endDateKey: "2026-09-02",
    mode: "ROLLING",
  });
  assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
});

test("keeps a custom range fixed while querying the new today after midnight", async () => {
  const { controller, clock, view, repositoryCalls } = createAnalysisHarness({
    now: new Date(2026, 8, 1, 12).getTime(),
    sites: SITES,
  });
  await controller.initialize();
  await controller.applyDateRange({
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
  });

  clock.set(new Date(2026, 8, 2, 12).getTime());
  await controller.refresh();

  assert.equal(view.lastModel.todayDateKey, "2026-09-02");
  assert.deepEqual(view.lastModel.appliedRange, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
    mode: "CUSTOM",
  });
  assert.deepEqual(repositoryCalls.queryVisitsForReport.slice(-2), [
    {
      siteId: "s1",
      rangeStart: new Date(2026, 7, 1).getTime(),
      rangeEnd: new Date(2026, 7, 3).getTime(),
    },
    {
      siteId: "s1",
      rangeStart: new Date(2026, 8, 2).getTime(),
      rangeEnd: new Date(2026, 8, 3).getTime(),
    },
  ]);
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

test("reloads after mutations, keeps the affected site selected, and exposes pending state", async () => {
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: [SITES[1]],
  });
  await controller.initialize();

  await controller.addSite({ name: "B 站", input: "bilibili.com" });
  const addedSiteId = view.lastModel.selectedSiteId;
  assert.equal(addedSiteId, "added-1");
  assert.ok(view.models.some(model => model.pending === true));

  await controller.setSiteEnabled(addedSiteId, false);
  assert.equal(view.lastModel.selectedSiteId, addedSiteId);
  assert.equal(view.lastModel.sites.find(site => site.id === addedSiteId).enabled, false);
  assert.deepEqual(repositoryCalls.sendMessage.slice(0, 2), [
    { type: WEBTRACE_ADD_SITE, name: "B 站", input: "bilibili.com" },
    { type: WEBTRACE_SET_SITE_ENABLED, siteId: addedSiteId, enabled: false },
  ]);
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

test("renders aligned independent charts, full durations, zero days, and newest-first details", async () => {
  const document = createDocumentFake();
  const selectedDates = [];
  const view = createAnalysisView({ document });
  view.bind({
    selectDate(dateKey) {
      selectedDates.push(dateKey);
    },
  });
  const openedAt = new Date(2026, 7, 31, 8, 0, 0).getTime();
  const laterOpenedAt = new Date(2026, 7, 31, 9, 0, 0).getTime();
  const days = [
    { dateKey: "2026-08-25", openCount: 0, activeMs: 0 },
    { dateKey: "2026-08-26", openCount: 2, activeMs: 3_661_000 },
    { dateKey: "2026-08-27", openCount: 1, activeMs: 1_000 },
    { dateKey: "2026-08-28", openCount: 0, activeMs: 0 },
    { dateKey: "2026-08-29", openCount: 0, activeMs: 0 },
    { dateKey: "2026-08-30", openCount: 0, activeMs: 0 },
    { dateKey: TODAY, openCount: 2, activeMs: 7_322_000 },
  ];

  view.render({
    mode: "READY",
    sites: [SITES[1]],
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: {
      days,
      totals: { openCount: 5, activeMs: 10_984_000 },
      selectedDateKey: TODAY,
      details: [
        { id: "older", openedAt, endedAt: openedAt + 1_000, durationMs: 1_000, ongoing: false },
        { id: "newer", openedAt: laterOpenedAt, endedAt: null, durationMs: 7_321_000, ongoing: true },
      ],
    },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  });

  const openChart = document.elements.get("open-chart");
  const durationChart = document.elements.get("duration-chart");
  const openButtons = byDataset(openChart, "dateKey", TODAY);
  const durationButtons = byDataset(durationChart, "dateKey", TODAY);
  assert.equal(descendants(openChart).filter(element => element.dataset.dateKey).length, 7);
  assert.equal(descendants(durationChart).filter(element => element.dataset.dateKey).length, 7);
  assert.deepEqual(
    descendants(openChart).filter(element => element.dataset.dateKey).map(element => element.dataset.dateKey),
    days.map(day => day.dateKey),
  );
  assert.deepEqual(
    descendants(durationChart).filter(element => element.dataset.dateKey).map(element => element.dataset.dateKey),
    days.map(day => day.dateKey),
  );
  assert.match(openButtons[0].getAttribute("aria-label"), /2026-08-31.*2 次/);
  assert.match(durationButtons[0].getAttribute("aria-label"), /2026-08-31.*02:02:02/);
  const zeroOpenButton = byDataset(openChart, "dateKey", "2026-08-25")[0];
  const zeroBar = descendants(zeroOpenButton).find(element => element.className === "chart-bar");
  assert.equal(zeroBar.style.getPropertyValue("--bar-height"), "0%");
  await durationButtons[0].click();
  assert.deepEqual(selectedDates, [TODAY]);

  assert.match(document.elements.get("summary").textContent, /5/);
  assert.match(document.elements.get("summary").textContent, /03:03:04/);
  const detailsText = document.elements.get("visit-details").textContent;
  assert.ok(detailsText.indexOf("09:00:00") < detailsText.indexOf("08:00:00"));
  assert.match(detailsText, /进行中/);
  assert.match(detailsText, /02:02:01/);
});

test("renders the empty detail message without removing zero-value dates", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  view.bind({ selectDate() {} });
  view.render({
    mode: "READY",
    sites: [SITES[1]],
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: {
      days: Array.from({ length: 7 }, (_, index) => ({
        dateKey: `2026-08-${25 + index}`,
        openCount: 0,
        activeMs: 0,
      })),
      totals: { openCount: 0, activeMs: 0 },
      selectedDateKey: TODAY,
      details: [],
    },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  });

  assert.equal(document.elements.get("visit-details").textContent, "当天没有访问记录");
  assert.equal(
    descendants(document.elements.get("open-chart")).filter(element => element.dataset.dateKey).length,
    7,
  );
});

test("renders all sites and requires explicit confirmation before deleting history", async () => {
  const document = createDocumentFake();
  const calls = [];
  const controller = {
    selectSite(siteId) {
      calls.push(["selectSite", siteId]);
    },
    selectDate() {},
    addSite(input) {
      calls.push(["addSite", copy(input)]);
    },
    setSiteEnabled(siteId, enabled) {
      calls.push(["setSiteEnabled", siteId, enabled]);
    },
    requestDeleteHistory(siteId) {
      calls.push(["requestDeleteHistory", siteId]);
    },
    cancelDeleteHistory() {
      calls.push(["cancelDeleteHistory"]);
    },
    confirmDeleteHistory() {
      calls.push(["confirmDeleteHistory"]);
    },
  };
  const view = createAnalysisView({ document });
  view.bind(controller);
  const model = {
    mode: "READY",
    sites: SITES,
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: {
      days: [],
      totals: { openCount: 0, activeMs: 0 },
      selectedDateKey: TODAY,
      details: [],
    },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  };

  view.render(model);
  await document.elements.get("manage-sites").click();
  const dialog = document.elements.get("site-manager");
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /知乎/);
  assert.match(dialog.textContent, /zhihu\.com/);
  assert.match(dialog.textContent, /已停用/);

  await byDataset(dialog, "action", "request-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["requestDeleteHistory", "disabled-site"]);
  assert.equal(calls.some(call => call[0] === "confirmDeleteHistory"), false);

  view.render({ ...model, deleteConfirmationSiteId: "disabled-site" });
  assert.match(dialog.textContent, /B 站/);
  assert.match(dialog.textContent, /这会永久删除该网站的全部访问记录，但保留网站配置；此操作无法撤销。/);
  await byDataset(dialog, "action", "cancel-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["cancelDeleteHistory"]);
  assert.equal(calls.some(call => call[0] === "confirmDeleteHistory"), false);

  view.render({ ...model, deleteConfirmationSiteId: "disabled-site" });
  await byDataset(dialog, "action", "confirm-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["confirmDeleteHistory"]);
});

test("uses required add fields, shows stable errors, and disables operation controls while pending", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  view.bind({
    selectSite() {},
    selectDate() {},
    addSite(input) {
      calls.push(copy(input));
    },
    setSiteEnabled() {},
    requestDeleteHistory() {},
    cancelDeleteHistory() {},
    confirmDeleteHistory() {},
  });
  view.render({
    mode: "READY",
    sites: [SITES[1]],
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: { days: [], totals: { openCount: 0, activeMs: 0 }, details: [] },
    error: { code: "DUPLICATE_SITE", message: "该网站已经添加" },
    pending: true,
    deleteConfirmationSiteId: null,
  });

  const dialog = document.elements.get("site-manager");
  const inputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(input => input.required));
  inputs[0].value = "新站点";
  inputs[1].value = "example.com";
  const form = descendants(dialog).find(element => element.tagName === "FORM");
  await form.dispatch("submit");
  assert.deepEqual(calls, [{ name: "新站点", input: "example.com" }]);
  assert.ok(descendants(dialog).filter(element => element.tagName === "BUTTON").every(button => button.disabled));
  assert.equal(document.elements.get("error-banner").hidden, false);
  assert.equal(document.elements.get("error-banner").textContent, "该网站已经添加");
});

test("keeps an in-progress site form intact across report-only renders", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  view.bind({
    selectSite() {},
    selectDate() {},
    addSite() {},
    setSiteEnabled() {},
    requestDeleteHistory() {},
    cancelDeleteHistory() {},
    confirmDeleteHistory() {},
  });
  const model = {
    mode: "READY",
    sites: [SITES[1]],
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: { days: [], totals: { openCount: 0, activeMs: 0 }, details: [] },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  };
  view.render(model);
  const dialog = document.elements.get("site-manager");
  const originalInputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  originalInputs[0].value = "正在输入的网站";
  originalInputs[1].value = "example.com/path";

  view.render({
    ...model,
    report: { ...model.report, totals: { openCount: 1, activeMs: 1_000 } },
  });

  const currentInputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  assert.equal(currentInputs[0], originalInputs[0]);
  assert.deepEqual(currentInputs.map(input => input.value), [
    "正在输入的网站",
    "example.com/path",
  ]);
});

test("mirrors stable operation errors into an open modal dialog alert", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  view.bind({
    selectSite() {},
    selectDate() {},
    addSite() {},
    setSiteEnabled() {},
    requestDeleteHistory() {},
    cancelDeleteHistory() {},
    confirmDeleteHistory() {},
  });
  const model = {
    mode: "READY",
    sites: [SITES[1]],
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: { days: [], totals: { openCount: 0, activeMs: 0 }, details: [] },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  };
  view.render(model);
  await document.elements.get("manage-sites").click();
  const dialog = document.elements.get("site-manager");

  for (const error of [
    { code: "DUPLICATE_SITE", message: "该网站已经添加" },
    { code: "SITE_STATE_SYNC_FAILED", message: "网站配置已保存，但采集状态同步失败，请重试" },
    { code: "DELETE_HISTORY_FAILED", message: "删除历史失败，请重试" },
  ]) {
    view.render({ ...model, error });
    const dialogAlerts = descendants(dialog).filter(
      element => element.getAttribute("role") === "alert",
    );
    assert.equal(dialogAlerts.length, 1);
    assert.equal(dialogAlerts[0].hidden, false);
    assert.equal(dialogAlerts[0].textContent, error.message);
  }
});

test("restores focus to replaced site and both chart buttons without scrolling", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  view.bind({ selectSite() {}, selectDate() {} });
  const days = Array.from({ length: 7 }, (_, index) => ({
    dateKey: `2026-08-${25 + index}`,
    openCount: index,
    activeMs: index * 1_000,
  }));
  const model = {
    mode: "READY",
    sites: SITES,
    selectedSiteId: "s1",
    selectedDateKey: TODAY,
    report: {
      days,
      totals: { openCount: 21, activeMs: 21_000 },
      selectedDateKey: TODAY,
      details: [],
    },
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  };
  view.render(model);

  const originalSite = byDataset(document.elements.get("site-list"), "siteId", "s1")[0];
  originalSite.focus();
  view.render({ ...model, report: { ...model.report, totals: { openCount: 22, activeMs: 22_000 } } });
  const restoredSite = byDataset(document.elements.get("site-list"), "siteId", "s1")[0];
  assert.notEqual(restoredSite, originalSite);
  assert.equal(document.activeElement, restoredSite);
  assert.deepEqual(restoredSite.lastFocusOptions, { preventScroll: true });

  const originalOpenDate = byDataset(
    document.elements.get("open-chart"),
    "dateKey",
    "2026-08-27",
  )[0];
  originalOpenDate.focus();
  view.render({ ...model, report: { ...model.report, totals: { openCount: 23, activeMs: 23_000 } } });
  const restoredOpenDate = byDataset(
    document.elements.get("open-chart"),
    "dateKey",
    "2026-08-27",
  )[0];
  assert.notEqual(restoredOpenDate, originalOpenDate);
  assert.equal(document.activeElement, restoredOpenDate);
  assert.deepEqual(restoredOpenDate.lastFocusOptions, { preventScroll: true });

  const originalDurationDate = byDataset(
    document.elements.get("duration-chart"),
    "dateKey",
    "2026-08-27",
  )[0];
  originalDurationDate.focus();
  view.render({ ...model, report: { ...model.report, totals: { openCount: 24, activeMs: 24_000 } } });
  const restoredDurationDate = byDataset(
    document.elements.get("duration-chart"),
    "dateKey",
    "2026-08-27",
  )[0];
  assert.notEqual(restoredDurationDate, originalDurationDate);
  assert.equal(document.activeElement, restoredDurationDate);
  assert.deepEqual(restoredDurationDate.lastFocusOptions, { preventScroll: true });
});
