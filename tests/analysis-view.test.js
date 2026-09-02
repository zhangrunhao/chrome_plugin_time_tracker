import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAnalysisView } from "../src/analysis/view.js";
import { localDateKey } from "../src/domain/local-date-range.js";

function copy(value) {
  return structuredClone(value);
}

class FakeElement {
  constructor(tagName, id = "", ownerDocument = null, namespaceURI = null) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.namespaceURI = namespaceURI;
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
    this.max = "";
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
      this.ownerDocument !== null
      && (
        this.ownerDocument.activeElement === this
        || descendants(this).includes(this.ownerDocument.activeElement)
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
      target: this,
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
  return descendants(root).filter(element => (
    element.dataset[key] !== undefined
    && (value === undefined || element.dataset[key] === value)
  ));
}

function byRole(root, role) {
  return descendants(root).filter(element => element.getAttribute("role") === role);
}

function createDocumentFake() {
  const ids = [
    "site-list",
    "manage-sites",
    "summary",
    "date-range",
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
    createElementNS(namespaceURI, tagName) {
      return new FakeElement(tagName, "", document, namespaceURI);
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

function dateKeys(startAt, count) {
  const start = new Date(startAt);
  return Array.from({ length: count }, (_, index) => localDateKey(new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + index,
  ).getTime()));
}

const TODAY = "2026-09-02";
const SITES = [
  { id: "site-2", name: "B 站", domain: "bilibili.com", enabled: false, createdAt: 2 },
  { id: "site-1", name: "知乎", domain: "zhihu.com", enabled: true, createdAt: 1 },
];

function reportDays(count = 14) {
  const keys = dateKeys(new Date(2026, 7, count === 14 ? 20 : 4).getTime(), count);
  return keys.map((dateKey, index) => ({
    dateKey,
    openCount: index === count - 1 ? 2 : index % 3,
    activeMs: index === count - 1 ? 7_322_000 : index * 1_000,
  }));
}

function viewModel(overrides = {}) {
  const days = overrides.days ?? reportDays();
  const report = {
    range: {
      startDateKey: days[0]?.dateKey ?? "2026-08-20",
      endDateKey: days.at(-1)?.dateKey ?? TODAY,
    },
    todaySummary: { openCount: 2, activeMs: 7_322_000 },
    days,
    selectedDateKey: overrides.selectedDateKey ?? TODAY,
    details: [],
    ...overrides.report,
  };
  return {
    mode: "READY",
    sites: copy(SITES),
    selectedSiteId: "site-1",
    todayDateKey: TODAY,
    appliedRange: {
      startDateKey: report.range.startDateKey,
      endDateKey: report.range.endDateKey,
      mode: "ROLLING",
    },
    selectedDateKey: overrides.selectedDateKey ?? TODAY,
    report,
    error: null,
    rangeError: null,
    pending: false,
    deleteConfirmationSiteId: null,
    ...overrides.model,
  };
}

function bindNoopController(view, overrides = {}) {
  view.bind({
    selectSite() {},
    selectDate() {},
    applyDateRange() {},
    addSite() {},
    requestDeleteHistory() {},
    cancelDeleteHistory() {},
    confirmDeleteHistory() {},
    ...overrides,
  });
}

test("keeps the summary, date range, trends, and details in stable order", async () => {
  const html = await readFile(new URL("../analysis.html", import.meta.url), "utf8");
  const ids = ["summary", "date-range", "open-chart", "duration-chart", "visit-details"];

  assert.deepEqual(
    [...ids].sort((left, right) => (
      html.indexOf(`id="${left}"`) - html.indexOf(`id="${right}"`)
    )),
    ids,
  );
  assert.match(html, /id="summary"[^>]+aria-label="今日概览"/);
  assert.match(html, /id="date-range"[^>]+aria-label="日期范围"/);
});

test("submits date edits explicitly and preserves them across report refreshes", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    applyDateRange(range) {
      calls.push(copy(range));
    },
  });
  const model = viewModel();
  view.render(model);

  const region = document.elements.get("date-range");
  const inputs = descendants(region).filter(element => element.tagName === "INPUT");
  assert.deepEqual(inputs.map(input => [input.type, input.name, input.value, input.max]), [
    ["date", "startDateKey", "2026-08-20", TODAY],
    ["date", "endDateKey", TODAY, TODAY],
  ]);
  inputs[0].value = "2026-08-10";
  inputs[1].value = "2026-08-31";
  await inputs[0].dispatch("input");
  await inputs[1].dispatch("input");
  assert.deepEqual(calls, []);

  view.render(viewModel({
    report: { todaySummary: { openCount: 3, activeMs: 1_000 } },
  }));
  const preservedInputs = descendants(region).filter(element => element.tagName === "INPUT");
  assert.deepEqual(preservedInputs.map(input => input.value), ["2026-08-10", "2026-08-31"]);

  const form = descendants(region).find(element => element.tagName === "FORM");
  await form.dispatch("submit");
  assert.deepEqual(calls, [{
    startDateKey: "2026-08-10",
    endDateKey: "2026-08-31",
  }]);

  view.render(viewModel({
    model: {
      appliedRange: {
        startDateKey: "2026-08-01",
        endDateKey: "2026-08-02",
        mode: "CUSTOM",
      },
      rangeError: {
        code: "START_AFTER_END",
        message: "起始日期不能晚于终止日期",
      },
    },
  }));
  const updatedInputs = descendants(region).filter(element => element.tagName === "INPUT");
  assert.deepEqual(updatedInputs.map(input => input.value), ["2026-08-01", "2026-08-02"]);
  assert.equal(byRole(region, "alert")[0].textContent, "起始日期不能晚于终止日期");
});

test("renders aligned fourteen-day SVG lines with native button points", async () => {
  const document = createDocumentFake();
  const selectedDates = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    selectDate(dateKey) {
      selectedDates.push(dateKey);
    },
  });
  const openedAt = new Date(2026, 8, 2, 8).getTime();
  const laterOpenedAt = new Date(2026, 8, 2, 9).getTime();
  const days = reportDays(14);
  view.render(viewModel({
    days,
    report: {
      details: [
        { id: "older", openedAt, endedAt: openedAt + 1_000, durationMs: 1_000, ongoing: false },
        { id: "newer", openedAt: laterOpenedAt, endedAt: null, durationMs: 7_321_000, ongoing: true },
      ],
    },
  }));

  const openChart = document.elements.get("open-chart");
  const durationChart = document.elements.get("duration-chart");
  const openPoints = byDataset(openChart, "dateKey");
  const durationPoints = byDataset(durationChart, "dateKey");
  assert.equal(openPoints.length, 14);
  assert.equal(durationPoints.length, 14);
  assert.ok(openPoints.every(point => point.tagName === "BUTTON" && point.type === "button"));
  assert.deepEqual(openPoints.map(point => point.dataset.dateKey), days.map(day => day.dateKey));
  assert.deepEqual(durationPoints.map(point => point.dataset.dateKey), days.map(day => day.dateKey));
  assert.equal(descendants(openChart).filter(element => element.tagName === "POLYLINE").length, 1);
  assert.equal(descendants(durationChart).filter(element => element.tagName === "POLYLINE").length, 1);
  assert.equal(descendants(openChart).find(element => element.tagName === "SVG").getAttribute("aria-hidden"), "true");
  assert.match(openPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*2 次/);
  assert.match(durationPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*02:02:02/);
  assert.equal(openPoints.at(-1).getAttribute("aria-pressed"), "true");
  assert.ok(openPoints.every(point => point.dataset.labelVisible === "true"));

  await openPoints[3].click();
  await durationPoints[5].click();
  assert.deepEqual(selectedDates, [days[3].dateKey, days[5].dateKey]);

  const detailsText = document.elements.get("visit-details").textContent;
  assert.ok(detailsText.indexOf("09:00:00") < detailsText.indexOf("08:00:00"));
  assert.match(detailsText, /进行中/);
  assert.match(detailsText, /02:02:01/);
});

test("keeps every zero-value date on one SVG baseline", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const days = reportDays(14).map(day => ({ ...day, openCount: 0, activeMs: 0 }));
  view.render(viewModel({ days }));

  for (const chartId of ["open-chart", "duration-chart"]) {
    const chart = document.elements.get(chartId);
    const polyline = descendants(chart).find(element => element.tagName === "POLYLINE");
    const yCoordinates = polyline.getAttribute("points")
      .trim()
      .split(/\s+/)
      .map(point => Number(point.split(",")[1]));
    assert.deepEqual(new Set(yCoordinates), new Set([84]));
    assert.deepEqual(
      byDataset(chart, "dateKey").map(point => point.dataset.dateKey),
      days.map(day => day.dateKey),
    );
  }
  assert.equal(document.elements.get("visit-details").textContent, "当天没有访问记录");
});

test("samples visible labels across thirty days without hiding accessible points", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const days = reportDays(30);
  const selectedDateKey = days[13].dateKey;
  view.render(viewModel({ days, selectedDateKey }));

  for (const chartId of ["open-chart", "duration-chart"]) {
    const points = byDataset(document.elements.get(chartId), "dateKey");
    const visible = points.filter(point => point.dataset.labelVisible === "true");
    assert.equal(points.length, 30);
    assert.ok(visible.length < 30);
    assert.equal(points[0].dataset.labelVisible, "true");
    assert.equal(points.at(-1).dataset.labelVisible, "true");
    assert.equal(points[13].dataset.labelVisible, "true");
    assert.ok(points.every(point => point.getAttribute("aria-label")?.includes(point.dataset.dateKey)));
  }
});

test("renders only today's summary and continuous-tracking management copy", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const days = reportDays(14).map(day => ({ ...day, openCount: 9, activeMs: 9_999_000 }));
  view.render(viewModel({
    days,
    report: { todaySummary: { openCount: 3, activeMs: 3_661_000 } },
  }));

  const summaryText = document.elements.get("summary").textContent;
  assert.match(summaryText, /今日概览/);
  assert.match(summaryText, /3/);
  assert.match(summaryText, /01:01:01/);
  assert.doesNotMatch(summaryText, /126/);
  assert.doesNotMatch(summaryText, /38:53:06/);

  await document.elements.get("manage-sites").click();
  const combinedText = [
    document.elements.get("site-list").textContent,
    document.elements.get("site-manager").textContent,
  ].join(" ");
  assert.match(combinedText, /知乎/);
  assert.match(combinedText, /zhihu\.com/);
  assert.match(combinedText, /网站添加后将持续统计/);
  for (const obsolete of ["统计中", "已停用", "停止统计", "恢复统计"]) {
    assert.equal(combinedText.includes(obsolete), false, obsolete);
  }
});

test("requires explicit confirmation with the continuous-history warning", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    requestDeleteHistory(siteId) {
      calls.push(["requestDeleteHistory", siteId]);
    },
    cancelDeleteHistory() {
      calls.push(["cancelDeleteHistory"]);
    },
    confirmDeleteHistory() {
      calls.push(["confirmDeleteHistory"]);
    },
  });
  const model = viewModel();

  view.render(model);
  await document.elements.get("manage-sites").click();
  const dialog = document.elements.get("site-manager");
  await byDataset(dialog, "action", "request-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["requestDeleteHistory", "site-2"]);
  assert.equal(calls.some(call => call[0] === "confirmDeleteHistory"), false);

  view.render({ ...model, deleteConfirmationSiteId: "site-2" });
  assert.match(dialog.textContent, /B 站/);
  assert.match(
    dialog.textContent,
    /现有访问记录会永久删除且无法撤销。网站配置会保留；删除后网站仍会持续统计，新访问会再次产生记录。/,
  );
  await byDataset(dialog, "action", "cancel-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["cancelDeleteHistory"]);

  view.render({ ...model, deleteConfirmationSiteId: "site-2" });
  await byDataset(dialog, "action", "confirm-delete")[0].click();
  assert.deepEqual(calls.at(-1), ["confirmDeleteHistory"]);
});

test("keeps add fields required, reports errors, and disables pending controls", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    addSite(input) {
      calls.push(copy(input));
    },
  });
  view.render(viewModel({
    model: {
      error: { code: "DUPLICATE_SITE", message: "该网站已经添加" },
      pending: true,
    },
  }));

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

test("keeps an in-progress site form intact across report-only renders", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);
  const dialog = document.elements.get("site-manager");
  const originalInputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  originalInputs[0].value = "正在输入的网站";
  originalInputs[1].value = "example.com/path";

  view.render(viewModel({
    report: { todaySummary: { openCount: 9, activeMs: 9_000 } },
  }));

  const currentInputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  assert.equal(currentInputs[0], originalInputs[0]);
  assert.deepEqual(currentInputs.map(input => input.value), [
    "正在输入的网站",
    "example.com/path",
  ]);
});

test("mirrors stable operation errors into an open manager alert", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);
  await document.elements.get("manage-sites").click();
  const dialog = document.elements.get("site-manager");

  for (const error of [
    { code: "DUPLICATE_SITE", message: "该网站已经添加" },
    { code: "SITE_STATE_SYNC_FAILED", message: "网站配置已保存，但采集状态同步失败，请重试" },
    { code: "DELETE_HISTORY_FAILED", message: "删除历史失败，请重试" },
  ]) {
    view.render({ ...model, error });
    const dialogAlerts = byRole(dialog, "alert");
    assert.equal(dialogAlerts.length, 1);
    assert.equal(dialogAlerts[0].hidden, false);
    assert.equal(dialogAlerts[0].textContent, error.message);
  }
});

test("restores focus to replaced site and both chart points without scrolling", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);

  const originalSite = byDataset(document.elements.get("site-list"), "siteId", "site-1")[0];
  originalSite.focus();
  view.render(viewModel({ report: { todaySummary: { openCount: 3, activeMs: 3_000 } } }));
  const restoredSite = byDataset(document.elements.get("site-list"), "siteId", "site-1")[0];
  assert.notEqual(restoredSite, originalSite);
  assert.equal(document.activeElement, restoredSite);
  assert.deepEqual(restoredSite.lastFocusOptions, { preventScroll: true });

  for (const chartId of ["open-chart", "duration-chart"]) {
    const originalPoint = byDataset(document.elements.get(chartId), "dateKey")[3];
    originalPoint.focus();
    view.render(viewModel({ report: { todaySummary: { openCount: 4, activeMs: 4_000 } } }));
    const restoredPoint = byDataset(document.elements.get(chartId), "dateKey")[3];
    assert.notEqual(restoredPoint, originalPoint);
    assert.equal(document.activeElement, restoredPoint);
    assert.deepEqual(restoredPoint.lastFocusOptions, { preventScroll: true });
  }
});
