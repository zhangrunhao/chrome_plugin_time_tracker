import "fake-indexeddb/auto";
import { createAnalysisDataSource } from "../../src/analysis/data-source.js";
import { registerChromeEvents } from "../../src/background/chrome-events.js";
import { createSiteService } from "../../src/background/site-service.js";
import { createTracker } from "../../src/background/tracker.js";
import {
  getRollingDateRange,
  localDateKey,
} from "../../src/domain/local-date-range.js";
import { createSessionRepository } from "../../src/storage/session-repository.js";
import { createSiteRepository } from "../../src/storage/site-repository.js";
import { createTrackingRepository } from "../../src/storage/tracking-repository.js";
import { openWebTraceDb } from "../../src/storage/webtrace-db.js";
import { createStorageAreaFake, uniqueDbName } from "./storage-fakes.js";

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFakeEvent() {
  const listeners = [];

  return {
    addListener(listener) {
      listeners.push(listener);
    },

    dispatch(...args) {
      return listeners.map(listener => listener(...args));
    },

    async emit(...args) {
      const returned = this.dispatch(...args);
      await Promise.all(returned.filter(value => typeof value?.then === "function"));
      return returned;
    },
  };
}

function createFakeChromeBoundary() {
  const extensionBaseUrl = "chrome-extension://webtrace-test/";
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
  const tabs = new Map([
    [1, {
      id: 1,
      windowId: 1,
      openerTabId: null,
      url: "https://www.zhihu.com/question/already-open",
      active: true,
      visible: false,
      documentId: "document-1-1",
    }],
  ]);
  const windows = new Map([
    [1, { id: 1, type: "normal", state: "normal", focused: true }],
  ]);
  let focusedWindowId = 1;
  let idleState = "active";
  let nextDocumentId = 2;

  function requireTab(tabId) {
    const tab = tabs.get(tabId);
    if (tab === undefined) {
      throw new RangeError(`Unknown fake tab: ${tabId}`);
    }
    return tab;
  }

  function tabForChrome(tab) {
    return {
      id: tab.id,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId,
      url: tab.url,
      active: tab.active,
    };
  }

  function windowForChrome(window) {
    return {
      ...window,
      tabs: [...tabs.values()]
        .filter(tab => tab.windowId === window.id)
        .map(tabForChrome),
    };
  }

  function dispatchRuntimeMessage(message, sender) {
    return new Promise((resolve, reject) => {
      let responded = false;
      const sendResponse = response => {
        if (!responded) {
          responded = true;
          resolve(copy(response));
        }
      };

      let returned;
      try {
        returned = events.runtimeOnMessage.dispatch(message, sender, sendResponse);
      } catch (error) {
        reject(error);
        return;
      }

      const keepsChannelOpen = returned.some(value => value === true);
      if (!keepsChannelOpen && !responded) {
        resolve(undefined);
      }
    });
  }

  const chrome = {
    webNavigation: { onCommitted: events.webNavigationOnCommitted },
    tabs: {
      onCreated: events.tabsOnCreated,
      onRemoved: events.tabsOnRemoved,
      onActivated: events.tabsOnActivated,
      async get(tabId) {
        return copy(tabForChrome(requireTab(tabId)));
      },
      async query() {
        return [];
      },
      async create(options) {
        return { id: 99, windowId: 1, ...copy(options) };
      },
      async update(tabId, update) {
        return { id: tabId, ...copy(update) };
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: events.windowsOnFocusChanged,
      onBoundsChanged: events.windowsOnBoundsChanged,
      onRemoved: events.windowsOnRemoved,
      async get(windowId) {
        return copy(windowForChrome(windows.get(windowId)));
      },
      async getAll() {
        return [...windows.values()].map(window => copy(windowForChrome(window)));
      },
      async update(windowId, update) {
        const current = windows.get(windowId) ?? {
          id: windowId,
          type: "normal",
          state: "normal",
          focused: false,
        };
        const next = { ...current, ...copy(update) };
        windows.set(windowId, next);
        return copy(windowForChrome(next));
      },
    },
    idle: {
      onStateChanged: events.idleOnStateChanged,
      queryState(_seconds, callback) {
        callback(idleState);
      },
    },
    runtime: {
      onMessage: events.runtimeOnMessage,
      lastError: null,
      getURL(path = "") {
        return `${extensionBaseUrl}${path}`;
      },
      sendMessage(message) {
        return dispatchRuntimeMessage(message, {
          url: `${extensionBaseUrl}analysis.html`,
        });
      },
    },
    action: { onClicked: events.actionOnClicked },
  };

  const browserSnapshot = {
    async capture() {
      return {
        windows: [...windows.values()].map(window => copy(windowForChrome(window))),
        focusedWindowId,
        idleState,
      };
    },
  };

  async function drainLifecycle() {
    await events.windowsOnFocusChanged.emit(focusedWindowId ?? chrome.windows.WINDOW_ID_NONE);
  }

  return {
    chrome,
    browserSnapshot,

    async navigate(tabId, url) {
      const tab = requireTab(tabId);
      tab.url = url;
      tab.visible = false;
      tab.documentId = `document-${tabId}-${nextDocumentId}`;
      nextDocumentId += 1;
      await events.webNavigationOnCommitted.emit({
        tabId,
        frameId: 0,
        url,
        documentId: tab.documentId,
        transitionType: "link",
        transitionQualifiers: [],
      });
    },

    async createTab({ tabId, windowId = 1, openerTabId = null, url, active = false }) {
      if (tabs.has(tabId)) {
        throw new RangeError(`Duplicate fake tab: ${tabId}`);
      }
      if (!windows.has(windowId)) {
        windows.set(windowId, {
          id: windowId,
          type: "normal",
          state: "normal",
          focused: false,
        });
      }
      const tab = {
        id: tabId,
        windowId,
        openerTabId,
        url,
        active: false,
        visible: false,
        documentId: `document-${tabId}-${nextDocumentId}`,
      };
      nextDocumentId += 1;
      tabs.set(tabId, tab);
      await events.tabsOnCreated.emit({
        id: tabId,
        windowId,
        openerTabId,
        pendingUrl: url,
        url: "about:blank",
        active: false,
      });
      await events.webNavigationOnCommitted.emit({
        tabId,
        frameId: 0,
        url,
        documentId: tab.documentId,
        transitionType: "link",
        transitionQualifiers: [],
      });
      if (active) {
        await this.activateTab(tabId);
      }
    },

    async activateTab(tabId) {
      const tab = requireTab(tabId);
      for (const candidate of tabs.values()) {
        if (candidate.windowId === tab.windowId) {
          candidate.active = candidate.id === tabId;
        }
      }
      await events.tabsOnActivated.emit({ tabId, windowId: tab.windowId });
    },

    async focusWindow(windowId) {
      if (!windows.has(windowId)) {
        throw new RangeError(`Unknown fake window: ${windowId}`);
      }
      focusedWindowId = windowId;
      for (const window of windows.values()) {
        window.focused = window.id === windowId;
      }
      await events.windowsOnFocusChanged.emit(windowId);
    },

    async setVisible(tabId, visible) {
      const tab = requireTab(tabId);
      tab.visible = visible === true;
      await events.runtimeOnMessage.emit(
        { type: "WEBTRACE_PAGE_VISIBILITY", visible: visible === true },
        {
          tab: { id: tab.id, windowId: tab.windowId },
          documentId: tab.documentId,
          url: tab.url,
        },
      );
      await drainLifecycle();
    },

    confirm(tabId) {
      return this.setVisible(tabId, true);
    },
  };
}

export async function createWebTraceHarness({ now }) {
  let currentNow = now;
  const clock = {
    now() {
      return currentNow;
    },
  };
  const chromeBoundary = createFakeChromeBoundary();
  const localStorage = createStorageAreaFake();
  const sessionStorage = createStorageAreaFake();
  const database = await openWebTraceDb(indexedDB, uniqueDbName());
  const trackingRepository = createTrackingRepository(database);
  const siteRepository = createSiteRepository(localStorage);
  const sessionRepository = createSessionRepository(sessionStorage);
  let nextTrackerId = 0;
  let nextSiteId = 0;
  const tracker = createTracker({
    trackingRepository,
    siteRepository,
    sessionRepository,
    browserSnapshot: chromeBoundary.browserSnapshot,
    clock,
    idFactory() {
      nextTrackerId += 1;
      return nextTrackerId === 1 ? "session-1" : `visit-${nextTrackerId - 1}`;
    },
    delay: () => Promise.resolve(),
  });
  const siteService = createSiteService({
    siteRepository,
    tracker,
    clock,
    idFactory() {
      nextSiteId += 1;
      return `site-${nextSiteId}`;
    },
  });

  registerChromeEvents({
    chrome: chromeBoundary.chrome,
    tracker,
    siteService,
    clock,
  });
  await tracker.ready;

  const dataSource = createAnalysisDataSource({
    siteRepository,
    trackingRepository,
    clock,
    sendMessage: message => chromeBoundary.chrome.runtime.sendMessage(message),
  });

  return {
    addSite(input) {
      return dataSource.addSite(input);
    },

    listSites() {
      return dataSource.listSites();
    },

    navigate(tabId, url) {
      return chromeBoundary.navigate(tabId, url);
    },

    createTab(input) {
      return chromeBoundary.createTab(input);
    },

    activateTab(tabId) {
      return chromeBoundary.activateTab(tabId);
    },

    focusWindow(windowId) {
      return chromeBoundary.focusWindow(windowId);
    },

    setVisible(tabId, visible) {
      return chromeBoundary.setVisible(tabId, visible);
    },

    confirm(tabId) {
      return chromeBoundary.confirm(tabId);
    },

    deleteHistory(siteId) {
      return dataSource.deleteSiteHistory(siteId);
    },

    advanceTo(nextNow) {
      if (!Number.isFinite(nextNow) || nextNow < currentNow) {
        throw new RangeError("The fake clock must advance monotonically");
      }
      currentNow = nextNow;
    },

    async getVisits(siteId) {
      const visits = await trackingRepository.queryVisitsForReport(
        siteId,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return visits.sort((left, right) => (
        left.openedAt - right.openedAt || left.id.localeCompare(right.id)
      ));
    },

    getReport(siteId, {
      startDateKey = getRollingDateRange(clock.now()).startDateKey,
      endDateKey = localDateKey(clock.now()),
      selectedDateKey = endDateKey,
    } = {}) {
      return dataSource.getReport(siteId, {
        startDateKey,
        endDateKey,
        selectedDateKey,
      });
    },

    close() {
      database.close();
    },
  };
}
