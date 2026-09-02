import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  openOrFocusAnalysisPage,
  registerChromeEvents,
} from "../src/background/chrome-events.js";
import { createSiteService } from "../src/background/site-service.js";
import {
  SITE_ERROR_MESSAGES,
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
  WEBTRACE_REORDER_SITES,
} from "../src/shared/protocol.js";
import { createTrackingRepository } from "../src/storage/tracking-repository.js";
import { openWebTraceDb } from "../src/storage/webtrace-db.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeEvent() {
  const listeners = [];
  return {
    get listenerCount() {
      return listeners.length;
    },
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      const returned = listeners.map(listener => listener(...args));
      await Promise.all(returned.filter(value => value instanceof Promise));
      await Promise.resolve();
      await Promise.resolve();
      return returned;
    },
  };
}

function createChromeHarness({
  now = 8_000,
  analysisTabs = [],
  queryCanSeeAnalysisTabs = true,
  windows = [],
  trackerReady = Promise.resolve(),
  lifecycleReady,
  storageAccessError = null,
  tabsGetReady = Promise.resolve(),
  tabsCreateStarted = null,
  tabsCreateReady = Promise.resolve(),
  storageState = { local: {}, session: {} },
  siteService: injectedSiteService,
} = {}) {
  const events = {
    webNavigationOnCommitted: createFakeEvent(),
    tabsOnCreated: createFakeEvent(),
    tabsOnRemoved: createFakeEvent(),
    tabsOnActivated: createFakeEvent(),
    windowsOnFocusChanged: createFakeEvent(),
    windowsOnBoundsChanged: createFakeEvent(),
    windowsOnRemoved: createFakeEvent(),
    idleOnStateChanged: createFakeEvent(),
    runtimeOnMessage: createFakeEvent(),
    actionOnClicked: createFakeEvent(),
  };
  const calls = {
    tabsGet: [],
    tabsQuery: [],
    tabsCreate: [],
    tabsUpdate: [],
    windowsGet: [],
    windowsGetAll: [],
    windowsUpdate: [],
    idleQueryState: [],
    storageAccess: [],
    storageOperations: [],
  };
  const stored = storageState;
  const analysisTabRecords = analysisTabs.map(tab => structuredClone(tab));
  const windowRecords = new Map(windows.map(window => [window.id, structuredClone(window)]));
  let currentNow = now;

  function storageArea(name) {
    return {
      async setAccessLevel(options) {
        calls.storageAccess.push({ area: name, options: structuredClone(options) });
        calls.storageOperations.push(`${name}:access`);
        if (storageAccessError !== null) {
          throw storageAccessError;
        }
      },
      async get(key) {
        calls.storageOperations.push(`${name}:get`);
        if (typeof key === "string") {
          return Object.hasOwn(stored[name], key) ? { [key]: structuredClone(stored[name][key]) } : {};
        }
        return structuredClone(stored[name]);
      },
      async set(value) {
        calls.storageOperations.push(`${name}:set`);
        Object.assign(stored[name], structuredClone(value));
      },
      async remove(key) {
        calls.storageOperations.push(`${name}:remove`);
        delete stored[name][key];
      },
    };
  }

  const chrome = {
    webNavigation: { onCommitted: events.webNavigationOnCommitted },
    tabs: {
      onCreated: events.tabsOnCreated,
      onRemoved: events.tabsOnRemoved,
      onActivated: events.tabsOnActivated,
      async get(tabId) {
        calls.tabsGet.push(tabId);
        await tabsGetReady;
        const analysisTab = analysisTabRecords.find(tab => tab.id === tabId);
        const browserTab = windows
          .flatMap(window => window.tabs ?? [])
          .find(tab => tab.id === tabId);
        return structuredClone(analysisTab ?? browserTab ?? { id: tabId, windowId: 2 });
      },
      async query(query) {
        calls.tabsQuery.push(structuredClone(query));
        return queryCanSeeAnalysisTabs ? structuredClone(analysisTabRecords) : [];
      },
      async create(options) {
        calls.tabsCreate.push(structuredClone(options));
        tabsCreateStarted?.resolve();
        await tabsCreateReady;
        const tab = { id: 99 + calls.tabsCreate.length, windowId: 1, ...options };
        analysisTabRecords.push(tab);
        return structuredClone(tab);
      },
      async update(tabId, update) {
        calls.tabsUpdate.push({ tabId, update: structuredClone(update) });
        return { id: tabId, ...update };
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowsOnFocusChanged,
      onBoundsChanged: events.windowsOnBoundsChanged,
      onRemoved: events.windowsOnRemoved,
      async get(windowId) {
        calls.windowsGet.push(windowId);
        return structuredClone(windowRecords.get(windowId));
      },
      async getAll(options) {
        calls.windowsGetAll.push(structuredClone(options));
        return structuredClone(windows);
      },
      async update(windowId, update) {
        calls.windowsUpdate.push({ windowId, update: structuredClone(update) });
        const current = windowRecords.get(windowId) ?? { id: windowId };
        const next = { ...current, ...structuredClone(update) };
        windowRecords.set(windowId, next);
        return structuredClone(next);
      },
    },
    idle: {
      onStateChanged: events.idleOnStateChanged,
      queryState(seconds, callback) {
        calls.idleQueryState.push(seconds);
        assert.equal(typeof callback, "function", "idle.queryState must use its callback form");
        callback("active");
      },
    },
    runtime: {
      onMessage: events.runtimeOnMessage,
      lastError: null,
      getURL(path = "") {
        return `chrome-extension://test/${path}`;
      },
    },
    action: { onClicked: events.actionOnClicked },
    storage: {
      local: storageArea("local"),
      session: storageArea("session"),
    },
  };
  const tracker = {
    ready: trackerReady,
    dispatchCalls: [],
    async dispatch(event) {
      tracker.dispatchCalls.push(structuredClone(event));
    },
  };
  const siteService = injectedSiteService ?? {
    addSiteCalls: [],
    deleteSiteHistoryCalls: [],
    reorderSitesCalls: [],
    async addSite(input) {
      this.addSiteCalls.push(structuredClone(input));
      return { id: "site-1", ...structuredClone(input) };
    },
    async deleteSiteHistory(input) {
      this.deleteSiteHistoryCalls.push(structuredClone(input));
      return structuredClone(input);
    },
    async reorderSites(input) {
      this.reorderSitesCalls.push(structuredClone(input));
      return structuredClone(input);
    },
  };
  const reportedErrors = [];
  const reportError = error => reportedErrors.push(structuredClone(error));
  const clock = {
    now() {
      return currentNow;
    },
    set(value) {
      currentNow = value;
    },
  };

  return {
    chrome,
    tracker,
    siteService,
    clock,
    events,
    calls,
    reportError,
    reportedErrors,
    lifecycleReady,
  };
}

test("registers every Chrome listener synchronously", () => {
  const harness = createChromeHarness();

  registerChromeEvents(harness);

  assert.equal(harness.events.webNavigationOnCommitted.listenerCount, 1);
  assert.equal(harness.events.tabsOnCreated.listenerCount, 1);
  assert.equal(harness.events.tabsOnRemoved.listenerCount, 1);
  assert.equal(harness.events.tabsOnActivated.listenerCount, 1);
  assert.equal(harness.events.windowsOnFocusChanged.listenerCount, 1);
  assert.equal(harness.events.windowsOnBoundsChanged.listenerCount, 1);
  assert.equal(harness.events.windowsOnRemoved.listenerCount, 1);
  assert.equal(harness.events.idleOnStateChanged.listenerCount, 1);
  assert.equal(harness.events.runtimeOnMessage.listenerCount, 1);
  assert.equal(harness.events.actionOnClicked.listenerCount, 1);
});

test("requires a complete site command service before registering listeners", () => {
  const harness = createChromeHarness();
  delete harness.siteService.reorderSites;

  assert.throws(() => registerChromeEvents(harness), /site service/i);
  assert.equal(harness.events.runtimeOnMessage.listenerCount, 0);
});

test("forwards filtered browser events with only injected-clock timestamps", async () => {
  const harness = createChromeHarness({ now: 8_000 });
  registerChromeEvents(harness);

  await harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 2,
    url: "https://www.zhihu.com/iframe",
    timeStamp: 123,
  });
  await harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 0,
    url: "chrome://extensions",
    timeStamp: 123,
  });
  assert.deepEqual(harness.tracker.dispatchCalls, [
    {
      type: "NAVIGATION_COMMITTED",
      tabId: 1,
      windowId: 2,
      url: "chrome://extensions",
      documentId: null,
      transitionType: undefined,
      transitionQualifiers: undefined,
      at: 8_000,
    },
  ]);

  await harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 0,
    url: "https://www.zhihu.com/question/1",
    documentId: "doc-1",
    transitionType: "link",
    transitionQualifiers: ["forward_back"],
    timeStamp: 123,
  });
  await harness.events.tabsOnCreated.emit({
    id: 3,
    windowId: 4,
    openerTabId: 1,
    pendingUrl: "https://www.zhihu.com/private/path",
    url: "about:blank",
  });
  await harness.events.tabsOnRemoved.emit(3, { windowId: 4, isWindowClosing: false });
  await harness.events.tabsOnActivated.emit({ tabId: 5, windowId: 4 });
  await harness.events.windowsOnFocusChanged.emit(-1);
  await harness.events.windowsOnBoundsChanged.emit({ id: 4, state: "minimized" });
  await harness.events.windowsOnRemoved.emit(4);
  await harness.events.idleOnStateChanged.emit("idle");
  await harness.events.idleOnStateChanged.emit("locked");

  assert.deepEqual(harness.tracker.dispatchCalls, [
    {
      type: "NAVIGATION_COMMITTED",
      tabId: 1,
      windowId: 2,
      url: "chrome://extensions",
      documentId: null,
      transitionType: undefined,
      transitionQualifiers: undefined,
      at: 8_000,
    },
    {
      type: "NAVIGATION_COMMITTED",
      tabId: 1,
      windowId: 2,
      url: "https://www.zhihu.com/question/1",
      documentId: "doc-1",
      transitionType: "link",
      transitionQualifiers: ["forward_back"],
      at: 8_000,
    },
    {
      type: "TAB_CREATED",
      tabId: 3,
      windowId: 4,
      openerTabId: 1,
      candidateUrl: "https://www.zhihu.com/private/path",
      at: 8_000,
    },
    { type: "TAB_REMOVED", tabId: 3, at: 8_000 },
    { type: "TAB_ACTIVATED", tabId: 5, windowId: 4, at: 8_000 },
    { type: "WINDOW_FOCUSED", windowId: null, at: 8_000 },
    { type: "WINDOW_STATE_CHANGED", windowId: 4, state: "minimized", at: 8_000 },
    { type: "WINDOW_REMOVED", windowId: 4, at: 8_000 },
    { type: "IDLE_STATE_CHANGED", state: "idle", at: 8_000 },
    { type: "IDLE_STATE_CHANGED", state: "locked", at: 8_000 },
  ]);
});

test("accepts visibility only from a tab sender and ignores page timestamps", async () => {
  const harness = createChromeHarness({ now: 8_000 });
  registerChromeEvents(harness);

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_PAGE_VISIBILITY", visible: true, confirmedAt: 1 },
    { url: "https://www.zhihu.com/" },
  );
  await harness.events.runtimeOnMessage.emit(
    { type: "NOT_WEBTRACE", visible: true },
    { tab: { id: 1, windowId: 2 }, documentId: "doc-1" },
  );
  assert.equal(harness.tracker.dispatchCalls.length, 0);

  const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_PAGE_VISIBILITY", visible: true, confirmedAt: 1 },
    {
      tab: { id: 1, windowId: 2 },
      documentId: "doc-1",
      url: "https://www.zhihu.com/private/path",
    },
  );

  assert.equal(listenerReturn, false);
  assert.deepEqual(harness.tracker.dispatchCalls[0], {
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: true,
    at: 8_000,
  });
  assert.equal(JSON.stringify(harness.tracker.dispatchCalls[0]).includes("private/path"), false);
});

test("handles each trusted analysis command with one successful response envelope", async () => {
  const harness = createChromeHarness();
  registerChromeEvents(harness);
  const sender = { url: "chrome-extension://test/analysis.html" };
  const commands = [
    {
      message: { type: WEBTRACE_ADD_SITE, name: "知乎", input: "zhihu.com" },
      expectedCall: ["addSiteCalls", { name: "知乎", input: "zhihu.com" }],
      expectedData: { id: "site-1", name: "知乎", input: "zhihu.com" },
    },
    {
      message: { type: WEBTRACE_DELETE_SITE_HISTORY, siteId: "site-1" },
      expectedCall: ["deleteSiteHistoryCalls", { siteId: "site-1" }],
      expectedData: { siteId: "site-1" },
    },
  ];

  for (const command of commands) {
    const responses = [];
    const responseReady = deferred();
    const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
      command.message,
      sender,
      response => {
        responses.push(structuredClone(response));
        responseReady.resolve();
      },
    );
    await responseReady.promise;

    assert.equal(listenerReturn, true);
    assert.deepEqual(
      harness.siteService[command.expectedCall[0]].at(-1),
      command.expectedCall[1],
    );
    assert.deepEqual(responses, [{ ok: true, data: command.expectedData }]);
  }
});

test("forwards a trusted complete site order to the site service", async () => {
  const harness = createChromeHarness();
  registerChromeEvents(harness);
  const responses = [];
  const responseReady = deferred();

  const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_REORDER_SITES, siteIds: ["site-2", "site-1"] },
    { url: "chrome-extension://test/analysis.html" },
    response => {
      responses.push(structuredClone(response));
      responseReady.resolve();
    },
  );

  assert.equal(listenerReturn, true);
  await responseReady.promise;
  assert.deepEqual(harness.siteService.reorderSitesCalls, [{
    siteIds: ["site-2", "site-1"],
  }]);
  assert.deepEqual(responses, [{
    ok: true,
    data: { siteIds: ["site-2", "site-1"] },
  }]);
});

test("reserves a site command before later lifecycle events until persistence and sync finish", async () => {
  const replaceStarted = deferred();
  const replaceReady = deferred();
  const updateStarted = deferred();
  const updateReady = deferred();
  const site = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 8_000,
  };
  let storedSites = [];
  const siteRepository = {
    async list() {
      return structuredClone(storedSites);
    },
    async replace(nextSites) {
      replaceStarted.resolve();
      await replaceReady.promise;
      storedSites = structuredClone(nextSites);
    },
  };
  const siteTracker = {
    async updateSites() {
      updateStarted.resolve();
      await updateReady.promise;
    },
    async markSitesDirty() {},
    async deleteSiteHistory() {},
  };
  const siteService = createSiteService({
    siteRepository,
    tracker: siteTracker,
    clock: { now: () => 8_000 },
    idFactory: () => "site-1",
  });
  const harness = createChromeHarness({ siteService });
  registerChromeEvents(harness);
  const responses = [];
  const responseReady = deferred();

  await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_ADD_SITE, name: "知乎", input: "zhihu.com" },
    { url: "chrome-extension://test/analysis.html" },
    response => {
      responses.push(structuredClone(response));
      responseReady.resolve();
    },
  );
  await replaceStarted.promise;

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_PAGE_VISIBILITY", visible: true },
    { tab: { id: 1 }, documentId: "doc-1", url: "https://www.zhihu.com/" },
  );
  const navigation = harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 0,
    url: "https://www.zhihu.com/question/1",
    documentId: "doc-1",
  });
  await Promise.resolve();
  assert.deepEqual(harness.tracker.dispatchCalls, []);

  replaceReady.resolve();
  await updateStarted.promise;
  await Promise.resolve();
  assert.deepEqual(harness.tracker.dispatchCalls, []);

  updateReady.resolve();
  await Promise.all([navigation, responseReady.promise]);
  assert.deepEqual(responses, [{
    ok: true,
    data: site,
  }]);
  assert.deepEqual(
    harness.tracker.dispatchCalls.map(event => event.type),
    ["PAGE_VISIBILITY", "NAVIGATION_COMMITTED"],
  );
});

test("finishes dirty-site marking after sync failure before dispatching later events", async () => {
  const updateStarted = deferred();
  const updateReady = deferred();
  const markStarted = deferred();
  const markReady = deferred();
  const operationLog = [];
  let storedSites = [];
  const siteService = createSiteService({
    siteRepository: {
      async list() {
        return structuredClone(storedSites);
      },
      async replace(nextSites) {
        storedSites = structuredClone(nextSites);
      },
    },
    tracker: {
      async updateSites() {
        operationLog.push("update:start");
        updateStarted.resolve();
        await updateReady.promise;
      },
      async markSitesDirty() {
        operationLog.push("mark:start");
        markStarted.resolve();
        await markReady.promise;
        operationLog.push("mark:end");
      },
      async deleteSiteHistory() {},
    },
    clock: { now: () => 8_000 },
    idFactory: () => "site-1",
  });
  const harness = createChromeHarness({ siteService });
  const originalDispatch = harness.tracker.dispatch.bind(harness.tracker);
  harness.tracker.dispatch = async event => {
    operationLog.push(`dispatch:${event.type}`);
    return originalDispatch(event);
  };
  registerChromeEvents(harness);
  const responses = [];
  const responseReady = deferred();

  await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_ADD_SITE, name: "知乎", input: "zhihu.com" },
    { url: "chrome-extension://test/analysis.html" },
    response => {
      responses.push(structuredClone(response));
      responseReady.resolve();
    },
  );
  await updateStarted.promise;
  const activation = harness.events.tabsOnActivated.emit({ tabId: 1, windowId: 2 });
  await Promise.resolve();
  assert.deepEqual(harness.tracker.dispatchCalls, []);

  updateReady.reject(new Error("sync failed"));
  await markStarted.promise;
  await Promise.resolve();
  assert.deepEqual(harness.tracker.dispatchCalls, []);
  assert.deepEqual(responses, []);

  markReady.resolve();
  await Promise.all([activation, responseReady.promise]);
  assert.deepEqual(responses, [{
    ok: false,
    error: {
      code: "SITE_STATE_SYNC_FAILED",
      message: SITE_ERROR_MESSAGES.SITE_STATE_SYNC_FAILED,
    },
  }]);
  assert.deepEqual(operationLog, [
    "update:start",
    "mark:start",
    "mark:end",
    "dispatch:TAB_ACTIVATED",
  ]);
});

test("returns one stable error envelope and reports only code and stack", async () => {
  const failure = Object.assign(new Error(SITE_ERROR_MESSAGES.DUPLICATE_SITE), {
    code: "DUPLICATE_SITE",
  });
  const siteService = {
    async addSite() {
      throw failure;
    },
    async deleteSiteHistory() {},
    async reorderSites() {},
  };
  const harness = createChromeHarness({ siteService });
  registerChromeEvents(harness);
  const responses = [];
  const responseReady = deferred();

  const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_ADD_SITE, name: "知乎", input: "zhihu.com" },
    { url: "chrome-extension://test/analysis.html" },
    response => {
      responses.push(structuredClone(response));
      responseReady.resolve();
    },
  );
  await responseReady.promise;

  assert.equal(listenerReturn, true);
  assert.deepEqual(responses, [{
    ok: false,
    error: {
      code: "DUPLICATE_SITE",
      message: SITE_ERROR_MESSAGES.DUPLICATE_SITE,
    },
  }]);
  assert.equal(harness.reportedErrors.length, 1);
  assert.deepEqual(Object.keys(harness.reportedErrors[0]).sort(), ["code", "stack"]);
  assert.equal(harness.reportedErrors[0].code, "DUPLICATE_SITE");
  assert.equal(typeof harness.reportedErrors[0].stack, "string");
});

test("rejects management commands from web pages and unknown message types synchronously", async () => {
  const harness = createChromeHarness();
  registerChromeEvents(harness);
  const responses = [];

  const [untrustedReturn] = await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_ADD_SITE, name: "知乎", input: "zhihu.com" },
    { url: "https://www.zhihu.com/" },
    response => responses.push(response),
  );
  const [unknownReturn] = await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_UNKNOWN" },
    { url: "chrome-extension://test/analysis.html" },
    response => responses.push(response),
  );
  const [legacyReturn] = await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_SET_SITE_ENABLED", siteId: "site-1", enabled: false },
    { url: "chrome-extension://test/analysis.html" },
    response => responses.push(response),
  );

  assert.equal(untrustedReturn, false);
  assert.equal(unknownReturn, false);
  assert.equal(legacyReturn, false);
  assert.deepEqual(responses, []);
  assert.deepEqual(harness.siteService.addSiteCalls, []);
});

test("queues lifecycle work and analysis opening behind the injected readiness gate", async () => {
  const ready = deferred();
  const harness = createChromeHarness({ lifecycleReady: ready.promise });
  registerChromeEvents(harness);
  const responses = [];
  const responseReady = deferred();

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_PAGE_VISIBILITY", visible: true },
    { tab: { id: 1 }, documentId: "doc-1", url: "https://www.zhihu.com/" },
  );
  const navigation = harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 0,
    url: "https://www.zhihu.com/question/1",
    documentId: "doc-1",
  });
  const [commandReturn] = await harness.events.runtimeOnMessage.emit(
    { type: WEBTRACE_DELETE_SITE_HISTORY, siteId: "site-1" },
    { url: "chrome-extension://test/analysis.html" },
    response => {
      responses.push(structuredClone(response));
      responseReady.resolve();
    },
  );
  const opening = harness.events.actionOnClicked.emit();
  await Promise.resolve();

  assert.equal(commandReturn, true);
  assert.deepEqual(harness.tracker.dispatchCalls, []);
  assert.deepEqual(harness.siteService.deleteSiteHistoryCalls, []);
  assert.deepEqual(harness.calls.tabsQuery, []);
  assert.deepEqual(harness.calls.tabsCreate, []);
  assert.deepEqual(responses, []);

  ready.resolve();
  await Promise.all([navigation, opening, responseReady.promise]);

  assert.deepEqual(
    harness.tracker.dispatchCalls.map(event => event.type),
    ["PAGE_VISIBILITY", "NAVIGATION_COMMITTED"],
  );
  assert.deepEqual(harness.siteService.deleteSiteHistoryCalls, [{ siteId: "site-1" }]);
  assert.deepEqual(responses, [{
    ok: true,
    data: { siteId: "site-1" },
  }]);
  assert.deepEqual(harness.calls.tabsCreate, [{
    url: "chrome-extension://test/analysis.html",
  }]);
});

test("rejects inherited object property names as unknown commands synchronously", async () => {
  const harness = createChromeHarness();
  registerChromeEvents(harness);
  const responses = [];

  for (const type of ["toString", "__proto__"]) {
    const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
      { type },
      { url: "chrome-extension://test/analysis.html" },
      response => responses.push(response),
    );
    assert.equal(listenerReturn, false);
  }

  await Promise.resolve();
  assert.deepEqual(responses, []);
  assert.deepEqual(harness.siteService.addSiteCalls, []);
  assert.deepEqual(harness.siteService.deleteSiteHistoryCalls, []);
});

test("queues browser events behind tracker readiness", async () => {
  const ready = deferred();
  const harness = createChromeHarness({ trackerReady: ready.promise });
  registerChromeEvents(harness);

  const emitted = harness.events.tabsOnActivated.emit({ tabId: 1, windowId: 2 });
  await Promise.resolve();
  assert.equal(harness.tracker.dispatchCalls.length, 0);

  ready.resolve();
  await emitted;
  assert.deepEqual(harness.tracker.dispatchCalls, [
    { type: "TAB_ACTIVATED", tabId: 1, windowId: 2, at: 8_000 },
  ]);
});

test("preserves navigation before a later tab removal while tab lookup is pending", async () => {
  const tabsGet = deferred();
  const harness = createChromeHarness({ tabsGetReady: tabsGet.promise });
  registerChromeEvents(harness);

  const navigation = harness.events.webNavigationOnCommitted.emit({
    tabId: 1,
    frameId: 0,
    url: "https://www.zhihu.com/question/1",
    documentId: "doc-1",
  });
  await Promise.resolve();
  const removal = harness.events.tabsOnRemoved.emit(1, {
    windowId: 2,
    isWindowClosing: false,
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(harness.tracker.dispatchCalls, []);

  tabsGet.resolve();
  await Promise.all([navigation, removal]);
  assert.deepEqual(
    harness.tracker.dispatchCalls.map(event => event.type),
    ["NAVIGATION_COMMITTED", "TAB_REMOVED"],
  );
});

test("opens the analysis page once and focuses an existing minimized window", async () => {
  const emptyHarness = createChromeHarness({ analysisTabs: [] });
  await openOrFocusAnalysisPage(emptyHarness.chrome);
  assert.deepEqual(emptyHarness.calls.tabsCreate, [
    { url: "chrome-extension://test/analysis.html" },
  ]);

  const existingHarness = createChromeHarness({
    analysisTabs: [{ id: 9, windowId: 3 }],
    windows: [{ id: 3, state: "minimized" }],
  });
  await openOrFocusAnalysisPage(existingHarness.chrome);
  assert.deepEqual(existingHarness.calls.tabsUpdate, [
    { tabId: 9, update: { active: true } },
  ]);
  assert.deepEqual(existingHarness.calls.windowsUpdate, [
    { windowId: 3, update: { state: "normal" } },
    { windowId: 3, update: { focused: true } },
  ]);
  assert.deepEqual(existingHarness.calls.tabsCreate, []);
});

test("serializes concurrent analysis-page opens and reuses the created tab", async () => {
  const createStarted = deferred();
  const createReady = deferred();
  const harness = createChromeHarness({
    analysisTabs: [],
    tabsCreateStarted: createStarted,
    tabsCreateReady: createReady.promise,
  });

  const first = openOrFocusAnalysisPage(harness.chrome);
  const second = openOrFocusAnalysisPage(harness.chrome);
  await createStarted.promise;

  assert.equal(harness.calls.tabsCreate.length, 1);

  createReady.resolve();
  await Promise.all([first, second]);
  await openOrFocusAnalysisPage(harness.chrome);

  assert.equal(harness.calls.tabsCreate.length, 1);
  assert.equal(harness.calls.tabsQuery.length, 1);
  assert.deepEqual(harness.calls.tabsGet, [100, 100]);
  assert.deepEqual(harness.calls.tabsUpdate, [
    { tabId: 100, update: { active: true } },
    { tabId: 100, update: { active: true } },
  ]);
});

test("reuses the created analysis tab after a service-worker restart without URL access", async () => {
  const storageState = { local: {}, session: {} };
  const firstWorker = createChromeHarness({
    analysisTabs: [],
    queryCanSeeAnalysisTabs: false,
    storageState,
  });

  await openOrFocusAnalysisPage(firstWorker.chrome);
  assert.equal(firstWorker.calls.tabsCreate.length, 1);

  const secondWorker = createChromeHarness({
    analysisTabs: [{ id: 100, windowId: 1 }],
    queryCanSeeAnalysisTabs: false,
    windows: [{ id: 1, state: "normal" }],
    storageState,
  });
  await openOrFocusAnalysisPage(secondWorker.chrome);

  assert.deepEqual(secondWorker.calls.tabsCreate, []);
  assert.deepEqual(secondWorker.calls.tabsUpdate, [
    { tabId: 100, update: { active: true } },
  ]);
});

test("focuses a registered analysis page when Chrome hides its extension URL", async () => {
  const harness = createChromeHarness({
    analysisTabs: [{ id: 9, windowId: 3 }],
    queryCanSeeAnalysisTabs: false,
    windows: [{ id: 3, state: "normal" }],
  });
  registerChromeEvents(harness);

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_ANALYSIS_READY" },
    {
      url: "chrome-extension://test/analysis.html",
      tab: { id: 9, windowId: 3 },
    },
  );
  await harness.events.actionOnClicked.emit();
  await harness.events.actionOnClicked.emit();

  assert.deepEqual(harness.calls.tabsCreate, []);
  assert.deepEqual(harness.calls.tabsUpdate, [
    { tabId: 9, update: { active: true } },
    { tabId: 9, update: { active: true } },
  ]);
});

test("does not accept an analysis-page registration from a web page", async () => {
  const harness = createChromeHarness({
    analysisTabs: [{ id: 9, windowId: 3 }],
    queryCanSeeAnalysisTabs: false,
    windows: [{ id: 3, state: "normal" }],
  });
  registerChromeEvents(harness);

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_ANALYSIS_READY" },
    {
      url: "https://www.zhihu.com/",
      tab: { id: 9, windowId: 3 },
    },
  );
  await harness.events.actionOnClicked.emit();

  assert.deepEqual(harness.calls.tabsCreate, [
    { url: "chrome-extension://test/analysis.html" },
  ]);
  assert.deepEqual(harness.calls.tabsUpdate, []);
});

test("forgets a registered analysis page when its tab closes", async () => {
  const harness = createChromeHarness({
    analysisTabs: [{ id: 9, windowId: 3 }],
    queryCanSeeAnalysisTabs: false,
    windows: [{ id: 3, state: "normal" }],
  });
  registerChromeEvents(harness);

  await harness.events.runtimeOnMessage.emit(
    { type: "WEBTRACE_ANALYSIS_READY" },
    {
      url: "chrome-extension://test/analysis.html",
      tab: { id: 9, windowId: 3 },
    },
  );
  await harness.events.tabsOnRemoved.emit(9, {
    windowId: 3,
    isWindowClosing: false,
  });
  await harness.events.actionOnClicked.emit();

  assert.deepEqual(harness.calls.tabsCreate, [
    { url: "chrome-extension://test/analysis.html" },
  ]);
  assert.deepEqual(harness.calls.tabsUpdate, []);
});

test("the content script reports silently, uses one 4-second timer, and resumes bfcache pages", async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const messages = [];
  const timers = new Map();
  const clearedTimers = [];
  let nextTimerId = 1;
  const originalGlobals = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    console: globalThis.console,
  };

  globalThis.document = {
    hidden: false,
    createElement() {
      throw new Error("content script must not create DOM nodes");
    },
    documentElement: {
      appendChild() {
        throw new Error("content script must not modify the DOM");
      },
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
  };
  globalThis.window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };
  globalThis.chrome = {
    runtime: {
      sendMessage(message) {
        messages.push(structuredClone(message));
        return Promise.reject(new Error("worker unavailable"));
      },
    },
  };
  globalThis.setInterval = (callback, delay) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearInterval = id => {
    clearedTimers.push(id);
    timers.delete(id);
  };
  globalThis.console = {
    ...originalGlobals.console,
    log() {
      throw new Error("content script must remain silent");
    },
    warn() {
      throw new Error("content script must remain silent");
    },
    error() {
      throw new Error("content script must remain silent");
    },
  };

  try {
    await import(`../content.js?test=${Date.now()}`);
    await Promise.resolve();
    assert.deepEqual(messages, [{ type: "WEBTRACE_PAGE_VISIBILITY", visible: true }]);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 4_000);

    [...timers.values()][0].callback();
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), { type: "WEBTRACE_PAGE_VISIBILITY", visible: true });

    globalThis.document.hidden = true;
    documentListeners.get("visibilitychange")();
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), { type: "WEBTRACE_PAGE_VISIBILITY", visible: false });
    assert.equal(timers.size, 0);

    globalThis.document.hidden = false;
    documentListeners.get("visibilitychange")();
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), { type: "WEBTRACE_PAGE_VISIBILITY", visible: true });
    assert.equal(timers.size, 1);

    windowListeners.get("pagehide")();
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), { type: "WEBTRACE_PAGE_VISIBILITY", visible: false });
    assert.equal(timers.size, 0);

    windowListeners.get("pageshow")({ persisted: false });
    assert.equal(timers.size, 0);
    windowListeners.get("pageshow")({ persisted: true });
    await Promise.resolve();
    assert.deepEqual(messages.at(-1), { type: "WEBTRACE_PAGE_VISIBILITY", visible: true });
    assert.equal(timers.size, 1);
    assert.equal(clearedTimers.length, 2);
  } finally {
    Object.assign(globalThis, originalGlobals);
  }
});

test("background migrates disabled sites without backfill after restricting storage", async () => {
  const disabledSite = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: false,
    createdAt: 100,
  };
  const storageState = {
    local: { webtraceSitesV1: [disabledSite] },
    session: {},
  };
  const harness = createChromeHarness({
    storageState,
    windows: [{
      id: 1,
      type: "normal",
      state: "normal",
      focused: true,
      tabs: [{
        id: 1,
        windowId: 1,
        url: "https://www.zhihu.com/question/already-open",
        active: true,
      }],
    }],
  });
  const factory = new IDBFactory();
  const originalChrome = globalThis.chrome;
  const originalIndexedDb = globalThis.indexedDB;
  const originalIdbKeyRange = globalThis.IDBKeyRange;
  let database;
  globalThis.chrome = harness.chrome;
  globalThis.indexedDB = factory;
  globalThis.IDBKeyRange = IDBKeyRange;

  try {
    const background = await import(`../background.js?success=${Date.now()}`);
    assert.equal(harness.events.runtimeOnMessage.listenerCount, 1);
    assert.deepEqual(harness.calls.storageAccess, [
      { area: "local", options: { accessLevel: "TRUSTED_CONTEXTS" } },
      { area: "session", options: { accessLevel: "TRUSTED_CONTEXTS" } },
    ]);

    await background.backgroundReady;
    const firstStorageRead = harness.calls.storageOperations.findIndex(item => item.endsWith(":get"));
    assert.ok(firstStorageRead > harness.calls.storageOperations.indexOf("local:access"));
    assert.ok(firstStorageRead > harness.calls.storageOperations.indexOf("session:access"));
    assert.deepEqual(harness.calls.idleQueryState, [60, 60]);
    assert.equal(storageState.local.webtraceSitesV1[0].enabled, true);
    assert.deepEqual(
      harness.calls.storageOperations.filter(item => item === "local:set").length,
      1,
    );

    database = await openWebTraceDb(factory);
    const records = createTrackingRepository(database);
    const visits = () => records.queryVisitsForReport(
      "site-1",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    assert.deepEqual(await visits(), []);

    await harness.events.webNavigationOnCommitted.emit({
      tabId: 1,
      frameId: 0,
      url: "https://www.zhihu.com/question/same-site",
      documentId: "doc-same",
      transitionType: "link",
      transitionQualifiers: [],
    });
    assert.deepEqual(await visits(), []);

    await harness.events.webNavigationOnCommitted.emit({
      tabId: 1,
      frameId: 0,
      url: "https://example.org/",
      documentId: "doc-away",
      transitionType: "link",
      transitionQualifiers: [],
    });
    await harness.events.webNavigationOnCommitted.emit({
      tabId: 1,
      frameId: 0,
      url: "https://www.zhihu.com/question/returned",
      documentId: "doc-returned",
      transitionType: "link",
      transitionQualifiers: [],
    });
    assert.equal((await visits()).length, 1);
  } finally {
    database?.close();
    globalThis.chrome = originalChrome;
    globalThis.indexedDB = originalIndexedDb;
    globalThis.IDBKeyRange = originalIdbKeyRange;
  }
});

test("storage access failure logs its stable code and keeps content messages closed", async () => {
  const harness = createChromeHarness({
    windows: [],
    storageAccessError: new Error("denied"),
  });
  const factory = new IDBFactory();
  let databaseOpenCalls = 0;
  const indexedDB = {
    open(...args) {
      databaseOpenCalls += 1;
      return factory.open(...args);
    },
  };
  const errors = [];
  const originalChrome = globalThis.chrome;
  const originalIndexedDb = globalThis.indexedDB;
  const originalConsoleError = console.error;
  globalThis.chrome = harness.chrome;
  globalThis.indexedDB = indexedDB;
  console.error = (...args) => errors.push(args);

  try {
    const background = await import(`../background.js?failure=${Date.now()}`);
    await assert.rejects(background.backgroundReady, /denied/);
    assert.equal(harness.events.runtimeOnMessage.listenerCount, 1);
    assert.equal(errors[0][0], "STORAGE_ACCESS_LEVEL_FAILED");
    assert.equal(databaseOpenCalls, 0);

    await harness.events.runtimeOnMessage.emit(
      { type: "WEBTRACE_PAGE_VISIBILITY", visible: true },
      { tab: { id: 1, windowId: 2 }, documentId: "doc-1" },
    );
    assert.equal(databaseOpenCalls, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.indexedDB = originalIndexedDb;
    console.error = originalConsoleError;
  }
});
