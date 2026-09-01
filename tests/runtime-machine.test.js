import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuntimeState,
  deriveActiveVisitId,
  reduceRuntimeEvent,
} from "../src/domain/runtime-machine.js";
import {
  effectsOf,
  makeRuntimeContext,
  runCrossSiteScenario,
  runLeaveAndReturnScenario,
  runNavigationScenario,
  runSameSiteNavigationScenario,
  sites,
  stateWithPendingChild,
  stateWithTrackedTab,
} from "./helpers/runtime-fixtures.js";

function tabRuntime({
  tabId,
  windowId = 1,
  currentSiteId = null,
  visitId = null,
  visible = true,
  documentId = `doc-${tabId}`,
} = {}) {
  return {
    tabId,
    windowId,
    openerTabId: null,
    documentId,
    currentSiteId,
    visitId,
    pendingInheritance: false,
    visible,
  };
}

test("counts only genuine configured-site boundary entries", () => {
  const cases = [
    ["outside to target", "https://example.org", "https://www.zhihu.com/a", 1],
    ["target refresh", "https://www.zhihu.com/a", "https://www.zhihu.com/a", 0],
    ["same-site subdomain", "https://www.zhihu.com/a", "https://zhuanlan.zhihu.com/p/1", 0],
    ["leave and return", "https://www.zhihu.com/a", "https://example.org", 0],
  ];

  for (const [name, fromUrl, toUrl, expectedCreates] of cases) {
    const result = runNavigationScenario({ fromUrl, toUrl });
    assert.equal(effectsOf(result, "CREATE_VISIT").length, expectedCreates, name);
  }

  const returnResult = runLeaveAndReturnScenario();
  assert.equal(effectsOf(returnResult, "CREATE_VISIT").length, 1);
  assert.equal(effectsOf(runSameSiteNavigationScenario(), "CREATE_VISIT").length, 0);
  assert.equal(effectsOf(runCrossSiteScenario(), "CREATE_VISIT").length, 1);
});

test("ends site A before creating site B on a configured-site boundary", () => {
  const result = runCrossSiteScenario();
  const boundaryEffects = result.effects.filter(effect =>
    ["END_VISIT", "CREATE_VISIT"].includes(effect.type));

  assert.deepEqual(boundaryEffects.map(effect => effect.type), ["END_VISIT", "CREATE_VISIT"]);
  assert.equal(boundaryEffects[0].visitId, "v1");
  assert.equal(boundaryEffects[1].visit.id, "v2");
  assert.equal(boundaryEffects[1].visit.siteId, "bilibili");
  assert.equal(result.state.tabs["1"].currentSiteId, "bilibili");
  assert.equal(result.state.tabs["1"].visitId, "v2");
});

test("creates one visit when an independent blank tab commits a target URL", () => {
  const context = makeRuntimeContext({ sites, ids: ["v1"] });
  const emptyState = createRuntimeState({
    sessionId: "session-1",
    sites,
    snapshot: {
      tabs: {
        "3": tabRuntime({ tabId: 3, visible: false, documentId: null }),
      },
      activeTabByWindow: { "1": 3 },
      windowStateById: { "1": "normal" },
      focusedWindowId: 1,
      locked: false,
      lastEventAt: 1_000,
    },
  });
  const result = reduceRuntimeEvent(emptyState, {
    type: "NAVIGATION_COMMITTED",
    tabId: 3,
    windowId: 1,
    url: "https://www.zhihu.com/a",
    documentId: "doc-3",
    at: 2_000,
  }, context);

  assert.equal(effectsOf(result, "CREATE_VISIT").length, 1);
  assert.equal(result.state.tabs["3"].visitId, "v1");
});

test("activating an associated target tab never creates a visit", () => {
  const state = stateWithTrackedTab();
  state.tabs["2"] = tabRuntime({ tabId: 2 });
  state.activeTabByWindow["1"] = 2;
  state.activeVisitId = null;
  const result = reduceRuntimeEvent(state, {
    type: "TAB_ACTIVATED",
    tabId: 1,
    windowId: 1,
    at: 2_000,
  }, makeRuntimeContext({ sites }));

  assert.equal(effectsOf(result, "CREATE_VISIT").length, 0);
  assert.deepEqual(result.effects.map(effect => effect.type), ["START_INTERVAL"]);
  assert.equal(result.effects[0].visitId, "v1");
});

test("transition metadata never suppresses a genuine boundary entry", () => {
  for (const transitionType of ["link", "typed", "auto_bookmark"]) {
    const result = runNavigationScenario({
      fromUrl: "https://example.org/",
      toUrl: "https://www.zhihu.com/a",
      transitionType,
      transitionQualifiers: ["forward_back"],
    });
    assert.equal(effectsOf(result, "CREATE_VISIT").length, 1, transitionType);
  }
});

test("same-site child reserves and inherits its opener visit", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let state = stateWithTrackedTab({ tabId: 1, siteId: "zhihu", visitId: "v1" });
  let result = reduceRuntimeEvent(state, {
    type: "TAB_CREATED",
    tabId: 2,
    windowId: 1,
    openerTabId: 1,
    candidateUrl: "https://zhuanlan.zhihu.com/p/1",
    at: 2_000,
  }, context);
  assert.equal(result.state.tabs["2"].visitId, "v1");
  assert.equal(result.state.tabs["2"].pendingInheritance, true);

  result = reduceRuntimeEvent(result.state, { type: "TAB_REMOVED", tabId: 1, at: 3_000 }, context);
  assert.equal(result.effects.some(effect => effect.type === "END_VISIT"), false);

  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://zhuanlan.zhihu.com/p/1",
    documentId: "doc-2",
    at: 4_000,
  }, context);
  assert.equal(result.state.tabs["2"].visitId, "v1");
  assert.equal(result.state.tabs["2"].pendingInheritance, false);
  assert.equal(result.effects.some(effect => effect.type === "CREATE_VISIT"), false);
});

test("a child that commits another configured site releases inheritance", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  const state = stateWithPendingChild({ openerVisitId: "v1", childTabId: 2 });
  const result = reduceRuntimeEvent(state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://www.bilibili.com/video/1",
    documentId: "doc-2",
    at: 4_000,
  }, context);
  assert.deepEqual(
    result.effects.filter(effect => ["END_VISIT", "CREATE_VISIT"].includes(effect.type)).map(effect => effect.type),
    ["END_VISIT", "CREATE_VISIT"],
  );
  assert.equal(result.effects.find(effect => effect.type === "END_VISIT").visitId, "v1");
  assert.equal(result.effects.find(effect => effect.type === "CREATE_VISIT").visit.id, "v2");
  assert.equal(result.state.tabs["2"].visitId, "v2");
});

test("a blank child inherits only while its opener association still exists", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "TAB_CREATED",
    tabId: 2,
    windowId: 1,
    openerTabId: 1,
    candidateUrl: "about:blank",
    at: 2_000,
  }, context);

  assert.equal(result.state.tabs["2"].openerTabId, 1);
  assert.equal(result.state.tabs["2"].visitId, null);
  assert.equal(result.state.tabs["2"].pendingInheritance, false);
  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://zhuanlan.zhihu.com/p/1",
    documentId: "doc-2",
    at: 3_000,
  }, context);

  assert.equal(result.state.tabs["2"].visitId, "v1");
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 0);
});

test("an unused blank child cannot keep a closed opener visit alive", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "TAB_CREATED",
    tabId: 2,
    windowId: 1,
    openerTabId: 1,
    candidateUrl: "about:blank",
    at: 2_000,
  }, context);
  result = reduceRuntimeEvent(result.state, { type: "TAB_REMOVED", tabId: 1, at: 3_000 }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["END_VISIT"]);
  assert.equal(result.effects[0].visitId, "v1");

  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://www.zhihu.com/a",
    documentId: "doc-2",
    at: 4_000,
  }, context);
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 1);
  assert.equal(result.state.tabs["2"].visitId, "v2");
});

test("repeated removal cannot end the same visit twice", () => {
  const context = makeRuntimeContext({ sites });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "TAB_REMOVED",
    tabId: 1,
    at: 2_000,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["END_VISIT"]);
  result = reduceRuntimeEvent(result.state, { type: "TAB_REMOVED", tabId: 1, at: 3_000 }, context);
  assert.deepEqual(result.effects, []);
});

test("starts and pauses only across the focused active visible unlocked predicates", () => {
  const context = makeRuntimeContext({ sites });
  let state = stateWithTrackedTab();
  state.tabs["2"] = tabRuntime({ tabId: 2 });
  state.activeTabByWindow["1"] = 2;
  state.activeVisitId = null;

  let result = reduceRuntimeEvent(state, {
    type: "TAB_ACTIVATED",
    tabId: 1,
    windowId: 1,
    at: 1_500,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["START_INTERVAL"]);

  result = reduceRuntimeEvent(result.state, {
    type: "TAB_ACTIVATED",
    tabId: 2,
    windowId: 1,
    at: 2_000,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["PAUSE_INTERVAL"]);
  assert.equal(result.effects[0].visitId, "v1");

  result = reduceRuntimeEvent(result.state, {
    type: "WINDOW_FOCUSED",
    windowId: null,
    at: 3_000,
  }, context);
  assert.deepEqual(result.effects, []);
  result = reduceRuntimeEvent(result.state, {
    type: "TAB_ACTIVATED",
    tabId: 1,
    windowId: 1,
    at: 3_500,
  }, context);
  assert.deepEqual(result.effects, []);
  result = reduceRuntimeEvent(result.state, {
    type: "WINDOW_FOCUSED",
    windowId: 1,
    at: 4_000,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["START_INTERVAL"]);

  result = reduceRuntimeEvent(result.state, {
    type: "WINDOW_STATE_CHANGED",
    windowId: 1,
    state: "minimized",
    at: 5_000,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["PAUSE_INTERVAL"]);
  result = reduceRuntimeEvent(result.state, {
    type: "IDLE_STATE_CHANGED",
    state: "locked",
    at: 6_000,
  }, context);
  assert.deepEqual(result.effects, []);
  result = reduceRuntimeEvent(result.state, {
    type: "IDLE_STATE_CHANGED",
    state: "active",
    at: 7_000,
  }, context);
  assert.deepEqual(result.effects, []);
  result = reduceRuntimeEvent(result.state, {
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: false,
    at: 8_000,
  }, context);
  assert.deepEqual(result.effects, []);
  assert.equal(result.state.activeVisitId, null);
});

test("lock pauses an active visit while ordinary idle does not", () => {
  const context = makeRuntimeContext({ sites });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "IDLE_STATE_CHANGED",
    state: "idle",
    at: 2_000,
  }, context);
  assert.equal(result.state.locked, false);
  assert.equal(result.state.activeVisitId, "v1");
  assert.deepEqual(result.effects, []);

  result = reduceRuntimeEvent(result.state, {
    type: "IDLE_STATE_CHANGED",
    state: "locked",
    at: 3_000,
  }, context);
  assert.equal(result.state.locked, true);
  assert.deepEqual(result.effects.map(effect => effect.type), ["PAUSE_INTERVAL"]);
  result = reduceRuntimeEvent(result.state, {
    type: "IDLE_STATE_CHANGED",
    state: "locked",
    at: 4_000,
  }, context);
  assert.deepEqual(result.effects, []);
});

test("two visible target tabs can never produce more than one active visit", () => {
  const state = stateWithTrackedTab();
  state.tabs["2"] = tabRuntime({
    tabId: 2,
    windowId: 2,
    currentSiteId: "bilibili",
    visitId: "v2",
  });
  state.activeTabByWindow["2"] = 2;
  state.windowStateById["2"] = "normal";
  const context = makeRuntimeContext({ sites });
  const events = [
    { type: "WINDOW_FOCUSED", windowId: 2, at: 2_000 },
    { type: "WINDOW_FOCUSED", windowId: 1, at: 3_000 },
    { type: "WINDOW_STATE_CHANGED", windowId: 1, state: "minimized", at: 4_000 },
    { type: "WINDOW_FOCUSED", windowId: 2, at: 5_000 },
    { type: "IDLE_STATE_CHANGED", state: "locked", at: 6_000 },
    { type: "IDLE_STATE_CHANGED", state: "active", at: 7_000 },
  ];

  let current = state;
  for (const event of events) {
    const result = reduceRuntimeEvent(current, event, context);
    assert.ok(effectsOf(result, "START_INTERVAL").length <= 1, event.type);
    assert.equal(result.state.activeVisitId, deriveActiveVisitId(result.state, sites));
    current = result.state;
  }
});

test("site add and enable mark open matches without retroactive visits", () => {
  const context = makeRuntimeContext({ sites, ids: ["v1"] });
  const state = createRuntimeState({
    sessionId: "session-1",
    sites,
    snapshot: {
      tabs: { "1": tabRuntime({ tabId: 1, currentSiteId: null, visitId: null }) },
      activeTabByWindow: { "1": 1 },
      windowStateById: { "1": "normal" },
      focusedWindowId: 1,
      lastEventAt: 1_000,
    },
  });
  let result = reduceRuntimeEvent(state, {
    type: "SITES_CHANGED",
    currentSiteIdsByTab: { "1": "zhihu" },
    at: 2_000,
  }, context);
  assert.equal(result.state.tabs["1"].currentSiteId, "zhihu");
  assert.equal(result.state.tabs["1"].visitId, null);
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 0);

  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://www.zhihu.com/refreshed",
    documentId: "doc-next",
    at: 3_000,
  }, context);
  assert.equal(result.state.tabs["1"].visitId, null);
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 0);
});

test("disabling a site ends its visit without erasing the inside-site marker", () => {
  const disabledSites = sites.map(site => site.id === "zhihu" ? { ...site, enabled: false } : site);
  const result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "SITES_CHANGED",
    currentSiteIdsByTab: { "1": "zhihu" },
    at: 2_000,
  }, makeRuntimeContext({ sites: disabledSites }));

  assert.deepEqual(result.effects.map(effect => effect.type), ["END_VISIT"]);
  assert.equal(result.effects[0].visitId, "v1");
  assert.equal(result.state.tabs["1"].currentSiteId, "zhihu");
  assert.equal(result.state.tabs["1"].visitId, null);
  assert.equal(result.state.activeVisitId, null);
});

test("deleting history keeps boundary identity until the tab leaves and returns", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "DELETE_SITE_HISTORY",
    siteId: "zhihu",
    at: 2_000,
  }, context);
  assert.deepEqual(result.effects.map(effect => effect.type), ["END_VISIT", "DELETE_SITE_VISITS"]);
  assert.equal(result.state.tabs["1"].currentSiteId, "zhihu");
  assert.equal(result.state.tabs["1"].visitId, null);

  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://www.zhihu.com/refreshed",
    documentId: "doc-refresh",
    at: 3_000,
  }, context);
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 0);
  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://example.org/",
    documentId: "doc-outside",
    at: 4_000,
  }, context);
  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 1,
    windowId: 1,
    url: "https://www.zhihu.com/returned",
    documentId: "doc-return",
    at: 5_000,
  }, context);
  assert.equal(effectsOf(result, "CREATE_VISIT").length, 1);
  assert.equal(result.state.tabs["1"].visitId, "v2");
});

test("ignores a visibility message from a stale document", () => {
  const state = stateWithTrackedTab();
  const result = reduceRuntimeEvent(state, {
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-stale",
    visible: false,
    at: 9_000,
  }, makeRuntimeContext({ sites }));

  assert.equal(result.state, state);
  assert.deepEqual(result.effects, []);
  assert.equal(result.state.tabs["1"].visible, true);
  assert.equal(result.state.lastEventAt, 1_000);
});

test("confirms an unchanged active visit without starting another interval", () => {
  const result = reduceRuntimeEvent(stateWithTrackedTab(), {
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: true,
    at: 2_000,
  }, makeRuntimeContext({ sites }));

  assert.deepEqual(result.effects, [{ type: "CONFIRM_INTERVAL", visitId: "v1", at: 2_000 }]);
  assert.equal(effectsOf(result, "START_INTERVAL").length, 0);
});

test("clamps event time and clones only state branches that change", () => {
  const state = stateWithTrackedTab();
  const result = reduceRuntimeEvent(state, {
    type: "WINDOW_FOCUSED",
    windowId: null,
    at: 500,
  }, makeRuntimeContext({ sites }));

  assert.notEqual(result.state, state);
  assert.equal(result.state.tabs, state.tabs);
  assert.equal(result.state.activeTabByWindow, state.activeTabByWindow);
  assert.equal(result.state.windowStateById, state.windowStateById);
  assert.equal(result.state.lastEventAt, 1_000);
  assert.deepEqual(result.effects, [{ type: "PAUSE_INTERVAL", visitId: "v1", at: 1_000 }]);
});

test("runtime state retains no transient navigation URLs", () => {
  const state = createRuntimeState({
    sessionId: "session-1",
    sites,
    snapshot: {
      tabs: [{
        id: 1,
        windowId: 1,
        active: true,
        visible: true,
        url: "https://www.zhihu.com/private/path?secret=1",
      }],
      windowStateById: { "1": "normal" },
      focusedWindowId: 1,
      locked: false,
      lastEventAt: 1_000,
    },
  });

  assert.equal(state.tabs["1"].currentSiteId, "zhihu");
  assert.equal(state.tabs["1"].visitId, null);
  assert.equal(JSON.stringify(state).includes("https://"), false);
  assert.equal(Object.hasOwn(state.tabs["1"], "url"), false);
});
