import { matchSiteUrl } from "./site-domain.js";
import { createVisit } from "./visit-time.js";

function siteById(sites, siteId) {
  return siteId === null ? null : sites.find(site => site.id === siteId) ?? null;
}

function normalizeWindowState(state) {
  return ["normal", "minimized", "maximized", "fullscreen"].includes(state)
    ? state
    : "normal";
}

function snapshotTabs(snapshot) {
  if (Array.isArray(snapshot.tabs)) {
    return snapshot.tabs;
  }
  return Object.values(snapshot.tabs ?? {});
}

function sanitizeTabRuntime(tab, sites) {
  const tabId = tab.tabId ?? tab.id;
  const matchedSite = tab.currentSiteId === undefined && typeof tab.url === "string"
    ? matchSiteUrl(tab.url, sites)
    : null;
  const currentSiteId = tab.currentSiteId === undefined
    ? matchedSite?.id ?? null
    : tab.currentSiteId;

  return {
    tabId,
    windowId: tab.windowId,
    openerTabId: tab.openerTabId ?? null,
    documentId: tab.documentId ?? null,
    currentSiteId,
    visitId: tab.visitId ?? null,
    pendingInheritance: tab.pendingInheritance === true,
    visible: tab.visible === true,
  };
}

function activeTabsFromSnapshot(snapshot, tabs) {
  if (snapshot.activeTabByWindow !== undefined) {
    return { ...snapshot.activeTabByWindow };
  }

  const result = {};
  for (const rawTab of snapshotTabs(snapshot)) {
    const tabId = rawTab.tabId ?? rawTab.id;
    if (rawTab.active === true && tabs[String(tabId)] !== undefined) {
      result[String(rawTab.windowId)] = tabId;
    }
  }
  return result;
}

function windowStatesFromSnapshot(snapshot, tabs) {
  const result = { ...(snapshot.windowStateById ?? {}) };
  for (const window of snapshot.windows ?? []) {
    result[String(window.windowId ?? window.id)] = normalizeWindowState(window.state);
  }
  for (const tab of Object.values(tabs)) {
    const key = String(tab.windowId);
    if (result[key] === undefined) {
      result[key] = "normal";
    }
  }
  return result;
}

export function createRuntimeState({ sessionId, snapshot = {}, sites = [] }) {
  const tabs = {};
  for (const rawTab of snapshotTabs(snapshot)) {
    const tab = sanitizeTabRuntime(rawTab, sites);
    if (Number.isInteger(tab.tabId) && Number.isInteger(tab.windowId)) {
      tabs[String(tab.tabId)] = tab;
    }
  }

  const activeTabByWindow = activeTabsFromSnapshot(snapshot, tabs);
  const state = {
    version: 1,
    sessionId,
    revision: snapshot.revision ?? 0,
    tabs,
    activeTabByWindow,
    windowStateById: windowStatesFromSnapshot(snapshot, tabs),
    focusedWindowId: snapshot.focusedWindowId ?? null,
    locked: snapshot.locked === true,
    activeVisitId: null,
    lastEventAt: snapshot.lastEventAt ?? 0,
  };
  state.activeVisitId = deriveActiveVisitId(state, sites);
  return state;
}

export function deriveActiveVisitId(state, sites) {
  if (state.locked || state.focusedWindowId === null) {
    return null;
  }

  const windowKey = String(state.focusedWindowId);
  if (state.windowStateById[windowKey] === "minimized") {
    return null;
  }

  const tabId = state.activeTabByWindow[windowKey];
  const tab = tabId === undefined ? null : state.tabs[String(tabId)];
  if (
    tab === null ||
    tab.windowId !== state.focusedWindowId ||
    tab.visible !== true ||
    tab.pendingInheritance === true ||
    tab.currentSiteId === null ||
    tab.visitId === null
  ) {
    return null;
  }

  const site = siteById(sites, tab.currentSiteId);
  return site?.enabled === true ? tab.visitId : null;
}

function sameTab(left, right) {
  return (
    left.tabId === right.tabId &&
    left.windowId === right.windowId &&
    left.openerTabId === right.openerTabId &&
    left.documentId === right.documentId &&
    left.currentSiteId === right.currentSiteId &&
    left.visitId === right.visitId &&
    left.pendingInheritance === right.pendingInheritance &&
    left.visible === right.visible
  );
}

function associatedVisitIds(tabs) {
  const result = new Set();
  for (const tab of Object.values(tabs)) {
    if (tab.visitId !== null) {
      result.add(tab.visitId);
    }
  }
  return result;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function reduceRuntimeEvent(state, event, { sites, idFactory }) {
  if (event.type === "PAGE_VISIBILITY") {
    const tab = state.tabs[String(event.tabId)];
    if (tab === undefined) {
      return { state, effects: [] };
    }
    if (
      event.documentId !== null &&
      event.documentId !== undefined &&
      tab.documentId !== null &&
      event.documentId !== tab.documentId
    ) {
      return { state, effects: [] };
    }
  }

  const at = Math.max(event.at ?? state.lastEventAt, state.lastEventAt);
  const previousActiveVisitId = deriveActiveVisitId(state, sites);
  const previouslyAssociated = associatedVisitIds(state.tabs);
  let tabs = state.tabs;
  let activeTabByWindow = state.activeTabByWindow;
  let windowStateById = state.windowStateById;
  let focusedWindowId = state.focusedWindowId;
  let locked = state.locked;
  const createEffects = [];
  const trailingEffects = [];

  function setTab(tab) {
    const key = String(tab.tabId);
    const previous = tabs[key];
    if (previous !== undefined && sameTab(previous, tab)) {
      return;
    }
    if (tabs === state.tabs) {
      tabs = { ...tabs };
    }
    tabs[key] = tab;
  }

  function removeTab(tabId) {
    const key = String(tabId);
    if (tabs[key] === undefined) {
      return;
    }
    if (tabs === state.tabs) {
      tabs = { ...tabs };
    }
    delete tabs[key];
  }

  function setActiveTab(windowId, tabId) {
    const key = String(windowId);
    if (activeTabByWindow[key] === tabId) {
      return;
    }
    if (activeTabByWindow === state.activeTabByWindow) {
      activeTabByWindow = { ...activeTabByWindow };
    }
    activeTabByWindow[key] = tabId;
  }

  function removeActiveWindow(windowId) {
    const key = String(windowId);
    if (!own(activeTabByWindow, key)) {
      return;
    }
    if (activeTabByWindow === state.activeTabByWindow) {
      activeTabByWindow = { ...activeTabByWindow };
    }
    delete activeTabByWindow[key];
  }

  function setWindowState(windowId, windowState) {
    const key = String(windowId);
    if (windowStateById[key] === windowState) {
      return;
    }
    if (windowStateById === state.windowStateById) {
      windowStateById = { ...windowStateById };
    }
    windowStateById[key] = windowState;
  }

  function removeWindowState(windowId) {
    const key = String(windowId);
    if (!own(windowStateById, key)) {
      return;
    }
    if (windowStateById === state.windowStateById) {
      windowStateById = { ...windowStateById };
    }
    delete windowStateById[key];
  }

  switch (event.type) {
    case "TAB_CREATED": {
      const opener = event.openerTabId === null || event.openerTabId === undefined
        ? null
        : tabs[String(event.openerTabId)] ?? null;
      const candidateSite = typeof event.candidateUrl === "string"
        ? matchSiteUrl(event.candidateUrl, sites)
        : null;
      const reservesOpener = (
        opener !== null &&
        opener.visitId !== null &&
        candidateSite?.enabled === true &&
        candidateSite.id === opener.currentSiteId
      );
      setTab({
        tabId: event.tabId,
        windowId: event.windowId,
        openerTabId: event.openerTabId ?? null,
        documentId: null,
        currentSiteId: reservesOpener ? opener.currentSiteId : null,
        visitId: reservesOpener ? opener.visitId : null,
        pendingInheritance: reservesOpener,
        visible: false,
      });
      break;
    }

    case "TAB_REMOVED": {
      const tab = tabs[String(event.tabId)];
      removeTab(event.tabId);
      if (tab !== undefined && activeTabByWindow[String(tab.windowId)] === event.tabId) {
        removeActiveWindow(tab.windowId);
      }
      break;
    }

    case "TAB_ACTIVATED":
      setActiveTab(event.windowId, event.tabId);
      break;

    case "WINDOW_FOCUSED":
      focusedWindowId = event.windowId ?? null;
      break;

    case "WINDOW_STATE_CHANGED":
      setWindowState(event.windowId, normalizeWindowState(event.state));
      break;

    case "WINDOW_REMOVED":
      for (const tab of Object.values(tabs)) {
        if (tab.windowId === event.windowId) {
          removeTab(tab.tabId);
        }
      }
      removeActiveWindow(event.windowId);
      removeWindowState(event.windowId);
      if (focusedWindowId === event.windowId) {
        focusedWindowId = null;
      }
      break;

    case "IDLE_STATE_CHANGED":
      locked = event.state === "locked";
      break;

    case "PAGE_VISIBILITY": {
      const tab = tabs[String(event.tabId)];
      setTab({ ...tab, visible: event.visible === true });
      break;
    }

    case "NAVIGATION_COMMITTED": {
      const key = String(event.tabId);
      const previous = tabs[key] ?? {
        tabId: event.tabId,
        windowId: event.windowId,
        openerTabId: null,
        documentId: null,
        currentSiteId: null,
        visitId: null,
        pendingInheritance: false,
        visible: false,
      };
      const targetSite = matchSiteUrl(event.url, sites);
      const targetSiteId = targetSite?.id ?? null;
      let visitId = null;

      if (targetSiteId === previous.currentSiteId) {
        visitId = targetSite?.enabled === true ? previous.visitId : null;
      } else if (targetSite?.enabled === true) {
        const opener = previous.openerTabId === null
          ? null
          : tabs[String(previous.openerTabId)] ?? null;
        if (
          opener !== null &&
          opener.currentSiteId === targetSiteId &&
          opener.visitId !== null
        ) {
          visitId = opener.visitId;
        } else {
          visitId = idFactory();
          createEffects.push({
            type: "CREATE_VISIT",
            visit: createVisit({ id: visitId, siteId: targetSiteId, openedAt: at }),
          });
        }
      }

      setTab({
        tabId: event.tabId,
        windowId: event.windowId,
        openerTabId: previous.openerTabId,
        documentId: event.documentId ?? null,
        currentSiteId: targetSiteId,
        visitId,
        pendingInheritance: false,
        visible: previous.documentId === (event.documentId ?? null) ? previous.visible : false,
      });
      break;
    }

    case "SITES_CHANGED":
      for (const tab of Object.values(tabs)) {
        const key = String(tab.tabId);
        const currentSiteId = own(event.currentSiteIdsByTab, key)
          ? event.currentSiteIdsByTab[key]
          : tab.currentSiteId;
        const enabled = siteById(sites, currentSiteId)?.enabled === true;
        const keepsVisit = (
          tab.visitId !== null &&
          currentSiteId === tab.currentSiteId &&
          enabled
        );
        setTab({
          ...tab,
          currentSiteId,
          visitId: keepsVisit ? tab.visitId : null,
          pendingInheritance: keepsVisit ? tab.pendingInheritance : false,
        });
      }
      break;

    case "DELETE_SITE_HISTORY":
      for (const tab of Object.values(tabs)) {
        if (tab.currentSiteId === event.siteId) {
          setTab({ ...tab, visitId: null, pendingInheritance: false });
        }
      }
      trailingEffects.push({ type: "DELETE_SITE_VISITS", siteId: event.siteId });
      break;

    default:
      return { state, effects: [] };
  }

  const partiallyUpdatedState = {
    ...state,
    tabs,
    activeTabByWindow,
    windowStateById,
    focusedWindowId,
    locked,
    lastEventAt: at,
  };
  const nextActiveVisitId = deriveActiveVisitId(partiallyUpdatedState, sites);
  const currentlyAssociated = associatedVisitIds(tabs);
  const endedVisitIds = [...previouslyAssociated].filter(visitId => !currentlyAssociated.has(visitId));
  const effects = endedVisitIds.map(visitId => ({ type: "END_VISIT", visitId, at }));
  effects.push(...createEffects, ...trailingEffects);

  if (previousActiveVisitId !== nextActiveVisitId) {
    if (previousActiveVisitId !== null && !endedVisitIds.includes(previousActiveVisitId)) {
      effects.push({ type: "PAUSE_INTERVAL", visitId: previousActiveVisitId, at });
    }
    if (nextActiveVisitId !== null) {
      effects.push({ type: "START_INTERVAL", visitId: nextActiveVisitId, at });
    }
  }

  if (
    event.type === "PAGE_VISIBILITY" &&
    event.visible === true &&
    previousActiveVisitId !== null &&
    previousActiveVisitId === nextActiveVisitId
  ) {
    effects.push({ type: "CONFIRM_INTERVAL", visitId: nextActiveVisitId, at });
  }

  const stateChanged = (
    tabs !== state.tabs ||
    activeTabByWindow !== state.activeTabByWindow ||
    windowStateById !== state.windowStateById ||
    focusedWindowId !== state.focusedWindowId ||
    locked !== state.locked ||
    at !== state.lastEventAt ||
    nextActiveVisitId !== state.activeVisitId
  );
  const nextState = stateChanged
    ? { ...partiallyUpdatedState, activeVisitId: nextActiveVisitId }
    : state;
  return { state: nextState, effects };
}
