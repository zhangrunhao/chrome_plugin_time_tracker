import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  openOrFocusAnalysisPage,
  registerChromeEvents,
} from "../src/background/chrome-events.js";

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
  windows = [],
  trackerReady = Promise.resolve(),
  storageAccessError = null,
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
  const stored = { local: {}, session: {} };
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
        return { id: tabId, windowId: 2 };
      },
      async query(query) {
        calls.tabsQuery.push(structuredClone(query));
        return structuredClone(analysisTabs);
      },
      async create(options) {
        calls.tabsCreate.push(structuredClone(options));
        return { id: 100, windowId: 1, ...options };
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
  const clock = {
    now() {
      return currentNow;
    },
    set(value) {
      currentNow = value;
    },
  };

  return { chrome, tracker, siteService: undefined, clock, events, calls };
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
  assert.equal(harness.tracker.dispatchCalls.length, 0);

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

test("background restricts both storage areas before tracker initialization", async () => {
  const harness = createChromeHarness({ windows: [] });
  const factory = new IDBFactory();
  const originalChrome = globalThis.chrome;
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.chrome = harness.chrome;
  globalThis.indexedDB = factory;

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
    assert.deepEqual(harness.calls.idleQueryState, [60]);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.indexedDB = originalIndexedDb;
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
