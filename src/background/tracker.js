import { matchSiteUrl } from "../domain/site-domain.js";
import {
  createRuntimeState,
  deriveActiveVisitId,
  reduceRuntimeEvent,
} from "../domain/runtime-machine.js";
import {
  confirmInterval,
  createVisit,
  endVisit,
  pauseInterval,
  recoverVisitAfterBrowserExit,
  startInterval,
} from "../domain/visit-time.js";

const RETRY_DELAYS = [50, 150];

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function tabValues(snapshot) {
  if (Array.isArray(snapshot.tabs)) {
    return snapshot.tabs;
  }
  if (snapshot.tabs !== null && typeof snapshot.tabs === "object") {
    return Object.values(snapshot.tabs);
  }
  return (snapshot.windows ?? []).flatMap(window => window.tabs ?? []);
}

function windowValues(snapshot) {
  return (snapshot.windows ?? []).filter(window => window.type === undefined || window.type === "normal");
}

function sanitizeBrowserSnapshot(snapshot, sites) {
  const windows = windowValues(snapshot);
  const allowedWindowIds = new Set(windows.map(window => window.id ?? window.windowId));
  const filtersByWindow = Array.isArray(snapshot.windows);
  const tabs = [];

  for (const rawTab of tabValues(snapshot)) {
    const tabId = rawTab.id ?? rawTab.tabId;
    const windowId = rawTab.windowId;
    if (
      !Number.isInteger(tabId) ||
      !Number.isInteger(windowId) ||
      (filtersByWindow && !allowedWindowIds.has(windowId))
    ) {
      continue;
    }
    const matchedSite = typeof rawTab.url === "string" ? matchSiteUrl(rawTab.url, sites) : null;
    tabs.push({
      tabId,
      windowId,
      openerTabId: rawTab.openerTabId ?? null,
      documentId: rawTab.documentId,
      currentSiteId: rawTab.currentSiteId ?? matchedSite?.id ?? null,
      active: rawTab.active === true,
      visible: rawTab.visible === true,
      visibilityKnown: rawTab.visible !== undefined,
    });
  }

  const activeTabByWindow = { ...(snapshot.activeTabByWindow ?? {}) };
  for (const tab of tabs) {
    if (tab.active) {
      activeTabByWindow[String(tab.windowId)] = tab.tabId;
    }
  }

  const windowStateById = { ...(snapshot.windowStateById ?? {}) };
  for (const window of windows) {
    windowStateById[String(window.id ?? window.windowId)] = window.state ?? "normal";
  }

  const explicitlyFocused = snapshot.focusedWindowId;
  const focusedWindow = windows.find(window => window.focused === true);
  const focusedWindowId = explicitlyFocused !== undefined
    ? explicitlyFocused
    : focusedWindow?.id ?? focusedWindow?.windowId ?? null;

  return {
    tabs,
    activeTabByWindow,
    windowStateById,
    focusedWindowId,
    locked: (snapshot.idleState ?? snapshot.locked) === "locked" || snapshot.locked === true,
  };
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

function transitionEffects(previousState, nextState, sites, at) {
  const previousAssociations = associatedVisitIds(previousState.tabs);
  const nextAssociations = associatedVisitIds(nextState.tabs);
  const endedVisitIds = [...previousAssociations].filter(id => !nextAssociations.has(id));
  const effects = endedVisitIds.map(visitId => ({ type: "END_VISIT", visitId, at }));
  const previousActiveVisitId = deriveActiveVisitId(previousState, sites);
  const nextActiveVisitId = deriveActiveVisitId(nextState, sites);

  if (previousActiveVisitId !== nextActiveVisitId) {
    if (previousActiveVisitId !== null && !endedVisitIds.includes(previousActiveVisitId)) {
      effects.push({ type: "PAUSE_INTERVAL", visitId: previousActiveVisitId, at });
    }
    if (nextActiveVisitId !== null) {
      effects.push({ type: "START_INTERVAL", visitId: nextActiveVisitId, at });
    }
  }
  return effects;
}

function reconcileWorkerState(baseState, snapshot, sites, at) {
  const tabs = {};
  for (const current of snapshot.tabs) {
    const previous = baseState.tabs[String(current.tabId)];
    if (previous === undefined || previous.currentSiteId !== current.currentSiteId) {
      tabs[String(current.tabId)] = {
        tabId: current.tabId,
        windowId: current.windowId,
        openerTabId: current.openerTabId,
        documentId: current.documentId ?? null,
        currentSiteId: null,
        visitId: null,
        pendingInheritance: false,
        visible: current.visibilityKnown ? current.visible : false,
      };
      continue;
    }
    const site = sites.find(item => item.id === current.currentSiteId) ?? null;
    const keepsAssociation = (
      previous.visitId !== null &&
      site?.enabled === true
    );
    tabs[String(current.tabId)] = {
      tabId: current.tabId,
      windowId: current.windowId,
      openerTabId: current.openerTabId,
      documentId: current.documentId === undefined ? previous?.documentId ?? null : current.documentId,
      currentSiteId: current.currentSiteId,
      visitId: keepsAssociation ? previous.visitId : null,
      pendingInheritance: keepsAssociation ? previous.pendingInheritance : false,
      visible: current.visibilityKnown ? current.visible : previous?.visible === true,
    };
  }

  const state = createRuntimeState({
    sessionId: baseState.sessionId,
    sites,
    snapshot: {
      revision: baseState.revision,
      tabs,
      activeTabByWindow: snapshot.activeTabByWindow,
      windowStateById: snapshot.windowStateById,
      focusedWindowId: snapshot.focusedWindowId,
      locked: snapshot.locked,
      lastEventAt: baseState.lastEventAt,
    },
  });
  return {
    state,
    effects: transitionEffects(baseState, state, sites, at),
  };
}

function applyVisitTransition(visit, effect) {
  switch (effect.type) {
    case "END_VISIT":
      return endVisit(visit, effect.at);
    case "PAUSE_INTERVAL":
      return pauseInterval(visit, effect.at);
    case "START_INTERVAL":
      return startInterval(visit, effect.at);
    case "CONFIRM_INTERVAL":
      return confirmInterval(visit, effect.at);
    default:
      return visit;
  }
}

export function createTracker({
  trackingRepository,
  siteRepository,
  sessionRepository,
  browserSnapshot,
  clock,
  idFactory,
  delay,
  reportError = () => {},
}) {
  let state = null;
  let sites = [];
  let mirrorDirty = false;
  let dirtySites = null;

  function logError(code, error) {
    try {
      reportError({ code, message: error?.message ?? String(error), error });
    } catch {
      // Error reporting must never replace an authoritative storage result.
    }
  }

  async function commitWithRetry(input) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await trackingRepository.commit(input);
        return;
      } catch (error) {
        if (attempt === 2) {
          logError("TRACKING_COMMIT_FAILED", error);
          throw error;
        }
        await delay(RETRY_DELAYS[attempt]);
      }
    }
  }

  async function saveMirror(nextState) {
    try {
      await sessionRepository.save(nextState);
      mirrorDirty = false;
    } catch (error) {
      mirrorDirty = true;
      logError("SESSION_MIRROR_FAILED", error);
    }
  }

  async function repairMirror() {
    if (mirrorDirty) {
      await saveMirror(state);
    }
  }

  async function applyEffects(effects) {
    const referencedIds = [];
    const seenIds = new Set();
    for (const effect of effects) {
      if (effect.visitId !== undefined && !seenIds.has(effect.visitId)) {
        seenIds.add(effect.visitId);
        referencedIds.push(effect.visitId);
      }
    }

    const records = new Map();
    for (const id of referencedIds) {
      const visit = await trackingRepository.getVisit(id);
      if (visit !== undefined && visit !== null) {
        records.set(id, visit);
      }
    }

    const changedIds = [];
    const changed = new Set();
    const deleteSiteIds = [];
    const deleted = new Set();

    function markChanged(id) {
      if (!changed.has(id)) {
        changed.add(id);
        changedIds.push(id);
      }
    }

    for (const effect of effects) {
      if (effect.type === "CREATE_VISIT") {
        records.set(effect.visit.id, copy(effect.visit));
        markChanged(effect.visit.id);
        continue;
      }
      if (effect.type === "DELETE_SITE_VISITS") {
        if (!deleted.has(effect.siteId)) {
          deleted.add(effect.siteId);
          deleteSiteIds.push(effect.siteId);
        }
        continue;
      }
      const visit = records.get(effect.visitId);
      if (visit === undefined) {
        throw new Error(`Visit not found: ${effect.visitId}`);
      }
      records.set(effect.visitId, applyVisitTransition(visit, effect));
      markChanged(effect.visitId);
    }

    return {
      putVisits: changedIds.map(id => records.get(id)),
      deleteSiteIds,
    };
  }

  async function commitReduction(reduction) {
    if (reduction.state === state && reduction.effects.length === 0) {
      return false;
    }
    const writes = await applyEffects(reduction.effects);
    const checkpoint = {
      ...reduction.state,
      revision: state.revision + 1,
    };
    await commitWithRetry({ ...writes, checkpoint });
    state = checkpoint;
    await saveMirror(state);
    return true;
  }

  async function captureSnapshot(configuredSites) {
    const rawSnapshot = await browserSnapshot.capture();
    return sanitizeBrowserSnapshot(rawSnapshot, configuredSites);
  }

  async function updateSitePolicy(nextSites, at) {
    const sanitizedSnapshot = await captureSnapshot(nextSites);
    const currentSiteIdsByTab = Object.fromEntries(
      sanitizedSnapshot.tabs.map(tab => [String(tab.tabId), tab.currentSiteId]),
    );
    const reduction = reduceRuntimeEvent(state, {
      type: "SITES_CHANGED",
      currentSiteIdsByTab,
      at,
    }, {
      sites: nextSites,
      idFactory,
    });
    await commitReduction(reduction);
    sites = copy(nextSites);
  }

  async function reconcileDirtySites() {
    if (dirtySites === null) {
      return;
    }
    const desiredSites = dirtySites;
    await updateSitePolicy(desiredSites, clock.now());
    if (dirtySites === desiredSites) {
      dirtySites = null;
    }
  }

  async function initializeBrowserRestart(configuredSites, snapshot) {
    const at = clock.now();
    const sessionId = idFactory();
    const openVisits = await trackingRepository.listOpenVisits();
    const putVisits = openVisits.map(recoverVisitAfterBrowserExit);
    const visitsById = new Map(putVisits.map(visit => [visit.id, visit]));
    const tabs = {};

    for (const current of snapshot.tabs) {
      const site = configuredSites.find(item => item.id === current.currentSiteId) ?? null;
      let visitId = null;
      if (site?.enabled === true) {
        visitId = idFactory();
        const visit = createVisit({ id: visitId, siteId: site.id, openedAt: at });
        visitsById.set(visitId, visit);
        putVisits.push(visit);
      }
      tabs[String(current.tabId)] = {
        tabId: current.tabId,
        windowId: current.windowId,
        openerTabId: current.openerTabId,
        documentId: current.documentId ?? null,
        currentSiteId: current.currentSiteId,
        visitId,
        pendingInheritance: false,
        visible: current.visibilityKnown ? current.visible : false,
      };
    }

    const checkpoint = createRuntimeState({
      sessionId,
      sites: configuredSites,
      snapshot: {
        revision: 0,
        tabs,
        activeTabByWindow: snapshot.activeTabByWindow,
        windowStateById: snapshot.windowStateById,
        focusedWindowId: snapshot.focusedWindowId,
        locked: snapshot.locked,
        lastEventAt: at,
      },
    });
    if (checkpoint.activeVisitId !== null) {
      const activeVisit = visitsById.get(checkpoint.activeVisitId);
      const started = startInterval(activeVisit, at);
      visitsById.set(started.id, started);
      const index = putVisits.findIndex(visit => visit.id === started.id);
      putVisits[index] = started;
    }

    await commitWithRetry({ putVisits, deleteSiteIds: [], checkpoint });
    state = checkpoint;
    await saveMirror(state);
  }

  async function initializeWorkerRestart(configuredSites, mirror, checkpoint, snapshot) {
    const matchingCheckpoint = checkpoint?.sessionId === mirror.sessionId ? checkpoint : null;
    const baseState = (
      matchingCheckpoint !== null && matchingCheckpoint.revision > mirror.revision
        ? matchingCheckpoint
        : mirror
    );
    const reconciled = reconcileWorkerState(baseState, snapshot, configuredSites, clock.now());
    const authoritativeBehind = (
      matchingCheckpoint === null || matchingCheckpoint.revision < baseState.revision
    );
    const needsCommit = (
      authoritativeBehind ||
      !sameValue(reconciled.state, baseState) ||
      reconciled.effects.length > 0
    );

    if (needsCommit) {
      const writes = await applyEffects(reconciled.effects);
      await commitWithRetry({ ...writes, checkpoint: reconciled.state });
    }
    state = reconciled.state;
    if (!sameValue(mirror, state)) {
      await saveMirror(state);
    }
  }

  async function initialize() {
    const [configuredSites, mirror, checkpoint] = await Promise.all([
      siteRepository.list(),
      sessionRepository.load(),
      trackingRepository.getCheckpoint(),
    ]);
    const snapshot = await captureSnapshot(configuredSites);
    sites = copy(configuredSites);
    if (mirror === null) {
      await initializeBrowserRestart(configuredSites, snapshot);
      return;
    }
    await initializeWorkerRestart(configuredSites, mirror, checkpoint, snapshot);
  }

  const ready = initialize();
  let operationTail = Promise.resolve();

  function append(operation, { reconcileSites = true } = {}) {
    const result = operationTail
      .then(() => ready)
      .then(async () => {
        await repairMirror();
        if (reconcileSites) {
          await reconcileDirtySites();
        }
        return operation();
      });
    operationTail = result.catch(() => {});
    return result;
  }

  return {
    ready,

    dispatch(event) {
      return append(async () => {
        const reduction = reduceRuntimeEvent(state, event, { sites, idFactory });
        await commitReduction(reduction);
      });
    },

    updateSites(nextSites, { at, allowBackfill = false }) {
      return append(async () => {
        if (allowBackfill !== false) {
          throw new RangeError("Site backfill is not supported");
        }
        await updateSitePolicy(copy(nextSites), at);
        dirtySites = null;
      });
    },

    markSitesDirty(nextSites) {
      return append(() => {
        dirtySites = copy(nextSites);
      }, { reconcileSites: false });
    },

    deleteSiteHistory(siteId, at) {
      return append(async () => {
        const reduction = reduceRuntimeEvent(state, {
          type: "DELETE_SITE_HISTORY",
          siteId,
          at,
        }, { sites, idFactory });
        await commitReduction(reduction);
      });
    },

    getStateForTest() {
      return state === null ? null : copy(state);
    },
  };
}
