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
  constructor(tagName, id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
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
  const elements = new Map(ids.map(id => [
    id,
    new FakeElement(id === "site-manager" ? "dialog" : "div", id),
  ]));
  elements.get("manage-sites").tagName = "BUTTON";
  return {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    elements,
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

test("selects the earliest-created site and today, then loads one seven-day report", async () => {
  const { controller, view, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: SITES,
  });

  await controller.initialize();

  assert.equal(view.lastModel.selectedSiteId, "s1");
  assert.equal(view.lastModel.selectedDateKey, TODAY);
  assert.equal(view.lastModel.report.days.length, 7);
  assert.equal(repositoryCalls.queryVisitsForReport.length, 1);
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

test("refresh falls back to the earliest site and today when prior selections disappear", async () => {
  const { controller, dataSource, view } = createAnalysisHarness({ now: NOW, sites: SITES });
  await controller.initialize();
  await controller.selectSite("disabled-site");
  await controller.selectDate("2026-08-27");
  dataSource.sites = [{ ...SITES[1], id: "replacement", createdAt: 5 }];

  await controller.refresh();

  assert.equal(view.lastModel.selectedSiteId, "replacement");
  assert.equal(view.lastModel.selectedDateKey, TODAY);
});

test("queries the local seven-day union through now plus one millisecond", async () => {
  const visit = {
    id: "v1",
    siteId: "s1",
    openedAt: NOW,
    endedAt: null,
    activeIntervals: [],
    lastConfirmedAt: NOW,
    lastActivityAt: NOW,
  };
  const { dataSource, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    sites: [SITES[1]],
    visits: [visit],
  });

  const report = await dataSource.getReport("s1", TODAY);

  assert.deepEqual(repositoryCalls.queryVisitsForReport[0], {
    siteId: "s1",
    rangeStart: new Date(2026, 7, 25, 0).getTime(),
    rangeEnd: NOW + 1,
  });
  assert.equal(report.days.length, 7);
  assert.equal(report.selectedDateKey, TODAY);
  assert.equal(report.details[0].ongoing, true);
});

test("sends exact management commands and rejects a stable background error", async () => {
  const responses = [
    { ok: true, data: { id: "s2" } },
    { ok: true, data: { id: "s1", enabled: false } },
    { ok: false, error: { code: "DELETE_HISTORY_FAILED", message: "删除历史失败，请重试" } },
  ];
  const { dataSource, repositoryCalls } = createAnalysisHarness({
    now: NOW,
    commandResponder: async () => responses.shift(),
  });

  await dataSource.addSite({ name: "B 站", input: "bilibili.com" });
  await dataSource.setSiteEnabled("s1", false);
  await assert.rejects(dataSource.deleteSiteHistory("s1"), error => {
    assert.equal(error.code, "DELETE_HISTORY_FAILED");
    assert.equal(error.message, "删除历史失败，请重试");
    return true;
  });
  assert.deepEqual(repositoryCalls.sendMessage, [
    { type: WEBTRACE_ADD_SITE, name: "B 站", input: "bilibili.com" },
    { type: WEBTRACE_SET_SITE_ENABLED, siteId: "s1", enabled: false },
    { type: WEBTRACE_DELETE_SITE_HISTORY, siteId: "s1" },
  ]);
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
