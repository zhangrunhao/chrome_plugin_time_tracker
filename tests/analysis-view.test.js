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
    this.checked = false;
    this.validationMessage = "";
    this.reportValidityCalls = 0;
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
      if (child.parentNode !== null) {
        const previousIndex = child.parentNode.children.indexOf(child);
        if (previousIndex !== -1) {
          child.parentNode.children.splice(previousIndex, 1);
        }
      }
      child.parentNode = this;
      this.children.push(child);
    }
  }

  insertBefore(child, reference) {
    if (reference === null) {
      this.append(child);
      return child;
    }
    if (child.parentNode !== null) {
      const previousIndex = child.parentNode.children.indexOf(child);
      if (previousIndex !== -1) {
        child.parentNode.children.splice(previousIndex, 1);
      }
    }
    const referenceIndex = this.children.indexOf(reference);
    if (referenceIndex === -1) {
      throw new Error("Reference element is not a child");
    }
    child.parentNode = this;
    this.children.splice(referenceIndex, 0, child);
    return child;
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
    for (const child of this.children) {
      child.parentNode = null;
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

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, init = {}) {
    const event = {
      ...init,
      currentTarget: this,
      target: init.target ?? this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
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
        if (element.type === "checkbox") {
          element.checked = false;
        } else {
          element.value = "";
        }
      }
    }
  }

  setCustomValidity(message) {
    this.validationMessage = String(message);
  }

  reportValidity() {
    this.reportValidityCalls += 1;
    return this.validationMessage === "";
  }

  focus(options) {
    if (this.ownerDocument !== null) {
      this.ownerDocument.activeElement = this;
    }
    this.lastFocusOptions = copy(options);
  }

  getBoundingClientRect() {
    return this.boundingClientRect ?? {
      top: 0,
      right: 100,
      bottom: 40,
      left: 0,
      width: 100,
      height: 40,
    };
  }

  setPointerCapture(pointerId) {
    this.capturedPointerId = pointerId;
  }

  releasePointerCapture(pointerId) {
    if (this.capturedPointerId === pointerId) {
      this.capturedPointerId = null;
    }
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
    "trend-chart",
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

function createTimeoutScheduler() {
  const tasks = [];
  return {
    tasks,
    setTimeout(callback, delay) {
      const task = { callback, delay, active: true };
      tasks.push(task);
      return task;
    },
    clearTimeout(task) {
      task.active = false;
    },
    runNext() {
      const task = tasks.find(candidate => candidate.active);
      assert.ok(task, "expected a pending timeout");
      task.active = false;
      task.callback();
      return task;
    },
  };
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
    selectedDateKey: overrides.selectedDateKey ?? TODAY,
    report,
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
    ...overrides.model,
  };
}

function bindNoopController(view, overrides = {}) {
  view.bind({
    selectSite() {},
    selectDate() {},
    addSite() {},
    requestDeleteHistory() {},
    cancelDeleteHistory() {},
    confirmDeleteHistory() {},
    ...overrides,
  });
}

test("keeps the summary, combined trend, and details in stable order", async () => {
  const html = await readFile(new URL("../analysis.html", import.meta.url), "utf8");
  const ids = ["summary", "trend-chart", "visit-details"];

  assert.deepEqual(
    [...ids].sort((left, right) => (
      html.indexOf(`id="${left}"`) - html.indexOf(`id="${right}"`)
    )),
    ids,
  );
  assert.ok(ids.every(id => html.includes(`id="${id}"`)));
  assert.match(html, /id="summary"[^>]+aria-label="今日概览"/);
  assert.doesNotMatch(html, /id="date-range"/);
  assert.doesNotMatch(html, /type=["']date["']/);
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

  const chart = document.elements.get("trend-chart");
  const openPoints = byDataset(chart, "dateKey").filter(point => point.dataset.metric === "openCount");
  const durationPoints = byDataset(chart, "dateKey").filter(point => point.dataset.metric === "activeMs");
  assert.equal(openPoints.length, 14);
  assert.equal(durationPoints.length, 14);
  assert.ok(openPoints.every(point => point.tagName === "BUTTON" && point.type === "button"));
  assert.deepEqual(openPoints.map(point => point.dataset.dateKey), days.map(day => day.dateKey));
  assert.deepEqual(durationPoints.map(point => point.dataset.dateKey), days.map(day => day.dateKey));
  assert.equal(descendants(chart).filter(element => element.tagName === "POLYLINE").length, 2);
  assert.equal(descendants(chart).filter(element => element.tagName === "SVG").length, 1);
  assert.match(openPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*2 次/);
  assert.match(durationPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*02:02:02/);
  assert.equal(openPoints.at(-1).getAttribute("aria-pressed"), "true");
  assert.equal(byRole(chart, "tooltip")[0].textContent, "2026-09-02");

  await openPoints[3].click();
  await durationPoints[5].click();
  assert.deepEqual(selectedDates, [days[3].dateKey, days[5].dateKey]);

  const detailsText = document.elements.get("visit-details").textContent;
  assert.ok(detailsText.indexOf("09:00:00") < detailsText.indexOf("08:00:00"));
  assert.match(detailsText, /进行中/);
  assert.match(detailsText, /02:02:01/);
});

test("enables forward and latest controls only while viewing history", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  const actions = [];
  bindNoopController(view, {
    previousWeek: () => actions.push("previous"),
    nextWeek: () => actions.push("next"),
    goToLatest: () => actions.push("latest"),
  });
  const chart = document.elements.get("trend-chart");
  const control = key => byDataset(chart, "chartControl", key)[0];
  view.render(viewModel());
  assert.equal(control("previous-week").disabled, false);
  assert.equal(control("next-week").disabled, true);
  assert.equal(control("latest").disabled, true);
  await control("previous-week").click();
  const keys = dateKeys(new Date(2026, 7, 13).getTime(), 14);
  const days = keys.map(dateKey => ({ dateKey, openCount: 0, activeMs: 0 }));
  view.render(viewModel({ days, selectedDateKey: "2026-08-26" }));
  assert.equal(control("next-week").disabled, false);
  assert.equal(control("latest").disabled, false);
  await control("next-week").click();
  await control("latest").click();
  assert.deepEqual(actions, ["previous", "next", "latest"]);
});

test("highlights a whole metric from its line or keyboard focus and floats only the date", async () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);
  const chart = document.elements.get("trend-chart");
  const hit = descendants(chart).find(node => node.tagName === "PATH" && node.dataset.metric === "openCount");
  await hit.dispatch("pointerenter");
  assert.equal(chart.dataset.activeMetric, "openCount");
  const values = descendants(chart).filter(node => node.className === "chart-point-value");
  assert.equal(values.length, 28);
  assert.equal(values[13].textContent, "2 次");
  assert.equal(values[27].textContent, "02:02:02");

  const point = byDataset(chart, "dateKey").find(node => (
    node.dataset.metric === "activeMs" && node.dataset.dateKey === "2026-08-23"
  ));
  point.focus();
  await point.dispatch("focus");
  assert.equal(chart.dataset.activeMetric, "activeMs");
  assert.equal(byRole(chart, "tooltip")[0].textContent, "2026-08-23");
  view.render(viewModel({ days: model.report.days.map(day => ({ ...day, activeMs: day.activeMs + 1000 })) }));
  assert.equal(chart.dataset.activeMetric, "activeMs");
  assert.equal(document.activeElement.dataset.dateKey, "2026-08-23");
});

test("preserves horizontal chart scrolling across date and live data changes", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  view.render(viewModel());
  const chart = document.elements.get("trend-chart");
  const scroller = () => descendants(chart).find(node => node.className === "chart-scroll");
  scroller().scrollLeft = 480;
  view.render(viewModel({ selectedDateKey: "2026-09-01" }));
  assert.equal(scroller().scrollLeft, 480);
  view.render(viewModel({ days: reportDays().map(day => ({ ...day, activeMs: day.activeMs + 1000 })) }));
  assert.equal(scroller().scrollLeft, 480);
});

test("keeps keyboard focus on navigation when returning to the newest window", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const keys = dateKeys(new Date(2026, 7, 13).getTime(), 14);
  view.render(viewModel({ days: keys.map(dateKey => ({ dateKey, openCount: 0, activeMs: 0 })) }));
  const chart = document.elements.get("trend-chart");
  byDataset(chart, "chartControl", "latest")[0].focus();
  view.render(viewModel());
  assert.equal(document.activeElement.disabled, false);
  assert.equal(document.activeElement.dataset.chartControl, "previous-week");
});

test("long-press drag reorders site buttons once without selecting the dragged site", async () => {
  const document = createDocumentFake();
  const scheduler = createTimeoutScheduler();
  const selectedSites = [];
  const savedOrders = [];
  const view = createAnalysisView({ document, scheduler });
  bindNoopController(view, {
    selectSite(siteId) {
      selectedSites.push(siteId);
    },
    reorderSites(siteIds) {
      savedOrders.push(copy(siteIds));
    },
  });
  view.render(viewModel());
  const siteList = document.elements.get("site-list");
  const [first, second] = byDataset(siteList, "siteId");
  first.boundingClientRect = {
    top: 0, right: 200, bottom: 40, left: 0, width: 200, height: 40,
  };
  second.boundingClientRect = {
    top: 50, right: 200, bottom: 90, left: 0, width: 200, height: 40,
  };

  await second.dispatch("pointerdown", {
    pointerId: 7,
    pointerType: "mouse",
    button: 0,
    isPrimary: true,
    clientX: 20,
    clientY: 70,
  });
  scheduler.runNext();
  assert.equal(second.dataset.dragging, "true");

  await second.dispatch("pointermove", {
    pointerId: 7,
    pointerType: "mouse",
    clientX: 20,
    clientY: 10,
  });
  assert.deepEqual(
    byDataset(siteList, "siteId").map(button => button.dataset.siteId),
    ["site-1", "site-2"],
  );

  await second.dispatch("pointerup", { pointerId: 7, pointerType: "mouse" });
  assert.deepEqual(savedOrders, [["site-1", "site-2"]]);
  assert.equal(second.dataset.dragging, undefined);
  assert.equal(second.capturedPointerId, null);

  await second.click();
  assert.deepEqual(selectedSites, []);
  await second.click();
  assert.deepEqual(selectedSites, ["site-1"]);
});

test("keeps touch scrolling on the site body and reorders horizontally from its handle", async () => {
  const css = await readFile(new URL("../analysis.css", import.meta.url), "utf8");
  const siteOptionRule = css.match(/\.site-option\s*\{([^}]*)\}/)?.[1] ?? "";
  const handleRule = css.match(/\.site-drag-handle\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(siteOptionRule, /touch-action\s*:\s*none/);
  assert.match(handleRule, /touch-action\s*:\s*none/);

  const document = createDocumentFake();
  const scheduler = createTimeoutScheduler();
  const savedOrders = [];
  const view = createAnalysisView({ document, scheduler });
  bindNoopController(view, {
    reorderSites(siteIds) {
      savedOrders.push(copy(siteIds));
    },
  });
  view.render(viewModel());
  const siteList = document.elements.get("site-list");
  const [first, second] = byDataset(siteList, "siteId");
  first.boundingClientRect = {
    top: 0, right: 200, bottom: 40, left: 0, width: 200, height: 40,
  };
  second.boundingClientRect = {
    top: 0, right: 410, bottom: 40, left: 210, width: 200, height: 40,
  };

  await second.dispatch("pointerdown", {
    pointerId: 9,
    pointerType: "touch",
    target: second,
    button: 0,
    isPrimary: true,
  });
  assert.equal(scheduler.tasks.filter(task => task.active).length, 0);
  assert.equal(second.capturedPointerId, undefined);

  const [handle] = byDataset(second, "dragHandle", "true");
  assert.ok(handle);
  await second.dispatch("pointerdown", {
    pointerId: 10,
    pointerType: "touch",
    target: handle,
    button: 0,
    isPrimary: true,
  });
  assert.equal(scheduler.tasks.filter(task => task.active).length, 1);
  scheduler.runNext();
  await second.dispatch("pointermove", {
    pointerId: 10,
    pointerType: "touch",
    target: handle,
    clientX: 10,
    clientY: 20,
  });
  await second.dispatch("pointerup", {
    pointerId: 10,
    pointerType: "touch",
    target: handle,
  });

  assert.deepEqual(savedOrders, [["site-1", "site-2"]]);
});

test("a cancelled long-press drag restores the visible order without saving", async () => {
  const document = createDocumentFake();
  const scheduler = createTimeoutScheduler();
  const savedOrders = [];
  const view = createAnalysisView({ document, scheduler });
  bindNoopController(view, {
    reorderSites(siteIds) {
      savedOrders.push(copy(siteIds));
    },
  });
  view.render(viewModel());
  const siteList = document.elements.get("site-list");
  const [first, second] = byDataset(siteList, "siteId");
  first.boundingClientRect = {
    top: 0, right: 200, bottom: 40, left: 0, width: 200, height: 40,
  };
  second.boundingClientRect = {
    top: 50, right: 200, bottom: 90, left: 0, width: 200, height: 40,
  };

  await second.dispatch("pointerdown", {
    pointerId: 8,
    button: 0,
    isPrimary: true,
    clientX: 20,
    clientY: 70,
  });
  scheduler.runNext();
  await second.dispatch("pointermove", {
    pointerId: 8,
    clientX: 20,
    clientY: 10,
  });
  await second.dispatch("pointercancel", { pointerId: 8 });

  assert.deepEqual(
    byDataset(siteList, "siteId").map(button => button.dataset.siteId),
    ["site-2", "site-1"],
  );
  assert.deepEqual(savedOrders, []);
  assert.equal(second.dataset.dragging, undefined);
  assert.equal(second.capturedPointerId, null);
});

test("keeps every zero-value date on one SVG baseline", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const days = reportDays(14).map(day => ({ ...day, openCount: 0, activeMs: 0 }));
  view.render(viewModel({ days }));

  const chart = document.elements.get("trend-chart");
  for (const metric of ["openCount", "activeMs"]) {
    const polyline = descendants(chart).find(element => element.tagName === "POLYLINE" && element.dataset.metric === metric);
    const yCoordinates = polyline.getAttribute("points")
      .trim()
      .split(/\s+/)
      .map(point => Number(point.split(",")[1]));
    assert.deepEqual(new Set(yCoordinates), new Set([84]));
    assert.deepEqual(
      byDataset(chart, "dateKey").filter(point => point.dataset.metric === metric).map(point => point.dataset.dateKey),
      days.map(day => day.dateKey),
    );
  }
  assert.equal(document.elements.get("visit-details").textContent, "当天没有访问记录");
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
  const textInputs = inputs.filter(input => input.type === "text");
  const consent = inputs.find(input => input.name === "privacyConsent");
  assert.equal(textInputs.length, 2);
  assert.ok(consent);
  assert.ok(inputs.every(input => input.required));
  textInputs[0].value = "新站点";
  textInputs[1].value = "example.com";
  consent.checked = true;
  const form = descendants(dialog).find(element => element.tagName === "FORM");
  await form.dispatch("submit");
  assert.deepEqual(calls, [{ name: "新站点", input: "example.com" }]);
  assert.ok(descendants(dialog).filter(element => element.tagName === "BUTTON").every(button => button.disabled));
  assert.equal(document.elements.get("error-banner").hidden, false);
  assert.equal(document.elements.get("error-banner").textContent, "该网站已经添加");
});

test("renders a required local-only privacy confirmation before adding a site", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  view.render(viewModel());

  const dialog = document.elements.get("site-manager");
  const inputs = descendants(dialog).filter(element => element.tagName === "INPUT");
  const consent = inputs.find(input => input.name === "privacyConsent");
  const privacyLink = descendants(dialog).find(element => (
    element.tagName === "A" && element.textContent === "查看完整隐私政策"
  ));

  assert.ok(consent);
  assert.equal(consent.type, "checkbox");
  assert.equal(consent.required, true);
  assert.equal(consent.checked, false);
  assert.ok(privacyLink);
  assert.equal(
    privacyLink.getAttribute("href"),
    "https://zhangrh.shop/webtrace/privacy",
  );
  assert.match(
    dialog.textContent,
    /网站名称和主域名、打开时间、结束时间及有效观看时长/,
  );
  assert.match(
    dialog.textContent,
    /全部仅保存在当前 Chrome 配置文件的本机存储中/,
  );
  assert.match(
    dialog.textContent,
    /不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie/,
  );
  assert.match(
    dialog.textContent,
    /不上传、不出售、不用于广告，也不与第三方共享/,
  );
});

test("blocks an unconfirmed site and resets consent only after a successful add", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    addSite(input) {
      calls.push(copy(input));
      return { id: "site-new" };
    },
  });
  view.render(viewModel());

  const dialog = document.elements.get("site-manager");
  const form = descendants(dialog).find(element => element.tagName === "FORM");
  const inputs = descendants(form).filter(element => element.tagName === "INPUT");
  const textInputs = inputs.filter(input => input.type === "text");
  const consent = inputs.find(input => input.name === "privacyConsent");
  assert.ok(consent);
  textInputs[0].value = "示例站点";
  textInputs[1].value = "example.com";

  await form.dispatch("submit");
  assert.deepEqual(calls, []);
  assert.equal(consent.reportValidityCalls, 1);
  assert.match(consent.validationMessage, /请先确认/);

  consent.checked = true;
  await consent.dispatch("change");
  await form.dispatch("submit");
  assert.deepEqual(calls, [{ name: "示例站点", input: "example.com" }]);
  assert.deepEqual(textInputs.map(input => input.value), ["", ""]);
  assert.equal(consent.checked, false);
});

test("keeps the site draft and consent when adding the site fails", async () => {
  const document = createDocumentFake();
  const calls = [];
  const view = createAnalysisView({ document });
  bindNoopController(view, {
    addSite(input) {
      calls.push(copy(input));
      view.render(viewModel({ model: { pending: true } }));
      view.render(viewModel({ model: { pending: false } }));
      return null;
    },
  });
  view.render(viewModel());

  const initialDialog = document.elements.get("site-manager");
  const form = descendants(initialDialog).find(element => element.tagName === "FORM");
  const inputs = descendants(form).filter(element => element.tagName === "INPUT");
  const textInputs = inputs.filter(input => input.type === "text");
  const consent = inputs.find(input => input.name === "privacyConsent");
  assert.ok(consent);
  textInputs[0].value = "失败站点";
  textInputs[1].value = "example.com/path";
  consent.checked = true;

  await form.dispatch("submit");

  const currentInputs = descendants(document.elements.get("site-manager"))
    .filter(element => element.tagName === "INPUT");
  const currentTextInputs = currentInputs.filter(input => input.type === "text");
  const currentConsent = currentInputs.find(input => input.name === "privacyConsent");
  assert.deepEqual(calls, [{ name: "失败站点", input: "example.com/path" }]);
  assert.deepEqual(currentTextInputs.map(input => input.value), [
    "失败站点",
    "example.com/path",
  ]);
  assert.equal(currentConsent?.checked, true);
});

test("keeps an in-progress site form intact across report-only renders", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);
  const dialog = document.elements.get("site-manager");
  const originalInputs = descendants(dialog).filter(element => (
    element.tagName === "INPUT" && element.type === "text"
  ));
  originalInputs[0].value = "正在输入的网站";
  originalInputs[1].value = "example.com/path";

  view.render(viewModel({
    report: { todaySummary: { openCount: 9, activeMs: 9_000 } },
  }));

  const currentInputs = descendants(dialog).filter(element => (
    element.tagName === "INPUT" && element.type === "text"
  ));
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

test("keeps focused site controls stable across report refreshes and restores chart focus", () => {
  const document = createDocumentFake();
  const view = createAnalysisView({ document });
  bindNoopController(view);
  const model = viewModel();
  view.render(model);

  const originalSite = byDataset(document.elements.get("site-list"), "siteId", "site-1")[0];
  originalSite.focus();
  view.render(viewModel({ report: { todaySummary: { openCount: 3, activeMs: 3_000 } } }));
  const restoredSite = byDataset(document.elements.get("site-list"), "siteId", "site-1")[0];
  assert.equal(restoredSite, originalSite);
  assert.equal(document.activeElement, restoredSite);

  const chart = document.elements.get("trend-chart");
  for (const metric of ["openCount", "activeMs"]) {
    const originalPoint = byDataset(chart, "dateKey").filter(point => point.dataset.metric === metric)[3];
    originalPoint.focus();
    view.render(viewModel({ selectedDateKey: originalPoint.dataset.dateKey }));
    const restoredPoint = byDataset(chart, "dateKey").filter(point => point.dataset.metric === metric)[3];
    assert.equal(document.activeElement, restoredPoint);
    assert.deepEqual(restoredPoint.lastFocusOptions, { preventScroll: true });
  }
});
