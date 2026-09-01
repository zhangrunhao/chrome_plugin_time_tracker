import { matchSiteUrl } from "../../src/domain/site-domain.js";
import { reduceRuntimeEvent } from "../../src/domain/runtime-machine.js";

export const sites = [
  { id: "zhihu", name: "Zhihu", domain: "zhihu.com", enabled: true, createdAt: 1 },
  { id: "bilibili", name: "Bilibili", domain: "bilibili.com", enabled: true, createdAt: 1 },
];

export function makeRuntimeContext({ sites: configuredSites = sites, ids = ["v1", "v2", "v3"] } = {}) {
  const remainingIds = [...ids];
  return {
    sites: configuredSites,
    idFactory() {
      const id = remainingIds.shift();
      if (id === undefined) {
        throw new Error("deterministic visit IDs exhausted");
      }
      return id;
    },
  };
}

function baseState({ tabs, activeTabByWindow, focusedWindowId = 1, lastEventAt = 1_000 }) {
  const state = {
    version: 1,
    sessionId: "session-1",
    revision: 0,
    tabs,
    activeTabByWindow,
    windowStateById: Object.fromEntries(
      [...new Set(Object.values(tabs).map(tab => tab.windowId))].map(windowId => [String(windowId), "normal"]),
    ),
    focusedWindowId,
    locked: false,
    activeVisitId: null,
    lastEventAt,
  };
  const activeTabId = focusedWindowId === null ? null : activeTabByWindow[String(focusedWindowId)];
  const activeTab = activeTabId === undefined ? null : tabs[String(activeTabId)];
  state.activeVisitId = activeTab?.visible && !activeTab.pendingInheritance ? activeTab.visitId : null;
  return state;
}

export function stateWithTrackedTab({
  tabId = 1,
  windowId = 1,
  siteId = "zhihu",
  visitId = "v1",
} = {}) {
  return baseState({
    tabs: {
      [String(tabId)]: {
        tabId,
        windowId,
        openerTabId: null,
        documentId: `doc-${tabId}`,
        currentSiteId: siteId,
        visitId,
        pendingInheritance: false,
        visible: true,
      },
    },
    activeTabByWindow: { [String(windowId)]: tabId },
    focusedWindowId: windowId,
  });
}

export function stateWithPendingChild({ openerVisitId = "v1", childTabId = 2 } = {}) {
  return baseState({
    tabs: {
      [String(childTabId)]: {
        tabId: childTabId,
        windowId: 1,
        openerTabId: 1,
        documentId: null,
        currentSiteId: "zhihu",
        visitId: openerVisitId,
        pendingInheritance: true,
        visible: false,
      },
    },
    activeTabByWindow: { "1": childTabId },
  });
}

function navigationState(fromUrl, configuredSites) {
  const matchedSite = matchSiteUrl(fromUrl, configuredSites);
  const visitId = matchedSite?.enabled ? "v1" : null;
  return baseState({
    tabs: {
      "1": {
        tabId: 1,
        windowId: 1,
        openerTabId: null,
        documentId: "doc-from",
        currentSiteId: matchedSite?.id ?? null,
        visitId,
        pendingInheritance: false,
        visible: true,
      },
    },
    activeTabByWindow: { "1": 1 },
  });
}

export function runNavigationScenario({
  fromUrl,
  toUrl,
  transitionType,
  transitionQualifiers,
  sites: configuredSites = sites,
} = {}) {
  const state = navigationState(fromUrl, configuredSites);
  const context = makeRuntimeContext({
    sites: configuredSites,
    ids: state.tabs["1"].visitId ? ["v2", "v3"] : ["v1", "v2", "v3"],
  });
  return reduceRuntimeEvent(state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: toUrl,
    documentId: "doc-to",
    transitionType,
    transitionQualifiers,
    at: 2_000,
  }, context);
}

export function runLeaveAndReturnScenario() {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://example.org/",
    documentId: "doc-outside",
    at: 2_000,
  }, context);
  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://www.zhihu.com/return",
    documentId: "doc-return",
    at: 3_000,
  }, context);
  return result;
}

export function runSameSiteNavigationScenario() {
  return runNavigationScenario({
    fromUrl: "https://www.zhihu.com/a",
    toUrl: "https://zhuanlan.zhihu.com/p/1",
  });
}

export function runCrossSiteScenario() {
  return runNavigationScenario({
    fromUrl: "https://www.zhihu.com/a",
    toUrl: "https://www.bilibili.com/video/1",
  });
}

export function effectsOf(result, type) {
  return result.effects.filter(effect => effect.type === type);
}
