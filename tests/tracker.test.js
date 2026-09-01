import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrackerHarness,
  openVisit,
  runtimeState,
  trackerSites,
} from "./helpers/tracker-fakes.js";

const navigationEvent = {
  type: "NAVIGATION_COMMITTED",
  tabId: 1,
  windowId: 1,
  url: "https://www.zhihu.com/",
  documentId: "doc-1",
  at: 1_000,
};

function trackedTab({
  tabId = 1,
  windowId = 1,
  siteId = "zhihu",
  visitId = "v1",
  visible = true,
  documentId = "doc-1",
} = {}) {
  return {
    tabId,
    windowId,
    openerTabId: null,
    documentId,
    currentSiteId: siteId,
    visitId,
    pendingInheritance: false,
    visible,
  };
}

function stateWithTrackedTab({ revision = 0, visible = true } = {}) {
  return runtimeState({
    revision,
    tabs: { "1": trackedTab({ visible }) },
    activeTabByWindow: { "1": 1 },
    windowStateById: { "1": "normal" },
    focusedWindowId: 1,
    activeVisitId: visible ? "v1" : null,
    lastEventAt: 1_000,
  });
}

function browserTab({
  id = 1,
  windowId = 1,
  url = "https://www.zhihu.com/",
  active = true,
  visible = true,
} = {}) {
  return { id, windowId, url, active, visible, title: "must not persist" };
}

function normalBrowserSnapshot(tabs = [browserTab()]) {
  return {
    windows: [{ id: 1, state: "normal", focused: true }],
    tabs,
    focusedWindowId: 1,
    idleState: "active",
  };
}

test("waits for initialization before reducing an event", async () => {
  const harness = createTrackerHarness({ snapshotDeferred: true });
  await harness.repository.browserSnapshot.waitForCapture();

  const dispatch = harness.tracker.dispatch(navigationEvent);
  await Promise.resolve();
  assert.equal(harness.repository.commitCalls, 0);

  harness.repository.browserSnapshot.release();
  await Promise.all([harness.tracker.ready, dispatch]);
  assert.equal(harness.tracker.getStateForTest().revision, 1);
});

test("serializes concurrent public calls behind the authoritative commit", async () => {
  const harness = createTrackerHarness();
  await harness.tracker.ready;
  harness.repository.holdCommits();

  const first = harness.tracker.dispatch(navigationEvent);
  const second = harness.tracker.dispatch({
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: true,
    at: 2_000,
  });
  await harness.repository.waitForCommitCall(1);
  assert.equal(harness.repository.commitCalls, 1);
  assert.equal(harness.tracker.getStateForTest().revision, 0);

  harness.repository.releaseNextCommit();
  await first;
  await harness.repository.waitForCommitCall(2);
  assert.equal(harness.repository.commits[0].checkpoint.revision, 1);
  assert.equal(harness.repository.commits[1].checkpoint.revision, 2);

  harness.repository.releaseNextCommit();
  await second;
  assert.equal(harness.tracker.getStateForTest().revision, 2);
});

test("retries an authoritative commit twice with the exact injected delays", async () => {
  const harness = createTrackerHarness({ commitFailures: 2, now: 1_000 });
  await harness.tracker.ready;

  await harness.tracker.dispatch(navigationEvent);

  assert.equal(harness.repository.commitCalls, 3);
  assert.equal(harness.tracker.getStateForTest().revision, 1);
  assert.deepEqual(harness.delays, [50, 150]);
});

test("keeps committed memory unchanged when all three commit attempts fail", async () => {
  const harness = createTrackerHarness({ commitFailures: 3, now: 1_000 });
  await harness.tracker.ready;
  const before = harness.tracker.getStateForTest();

  await assert.rejects(harness.tracker.dispatch(navigationEvent), /write failed/);

  assert.deepEqual(harness.tracker.getStateForTest(), before);
  assert.equal(harness.tracker.getStateForTest().revision, 0);
  assert.equal(harness.repository.snapshotCheckpoint().revision, 0);
  assert.equal(harness.errors[0].code, "TRACKING_COMMIT_FAILED");
  assert.deepEqual(harness.delays, [50, 150]);
});

test("loads only effect visit IDs and applies effects in array order", async () => {
  const checkpoint = stateWithTrackedTab();
  const v1 = openVisit({
    id: "v1",
    activeIntervals: [{ startedAt: 1_000, endedAt: null }],
    lastConfirmedAt: 1_000,
    lastActivityAt: 1_000,
  });
  const unrelated = openVisit({ id: "unrelated" });
  const harness = createTrackerHarness({
    checkpoint,
    sessionState: checkpoint,
    openVisits: [v1, unrelated],
    browserSnapshot: normalBrowserSnapshot(),
    ids: ["v2"],
  });
  await harness.tracker.ready;
  harness.repository.getVisitCalls.length = 0;

  await harness.tracker.dispatch({
    ...navigationEvent,
    url: "https://www.bilibili.com/video/1",
    documentId: "doc-2",
    at: 2_000,
  });

  assert.deepEqual(harness.repository.getVisitCalls, ["v1"]);
  const commit = harness.repository.successfulCommits.at(-1);
  assert.deepEqual(commit.putVisits.map(visit => visit.id), ["v1", "v2"]);
  assert.equal(commit.putVisits[0].endedAt, 2_000);
  assert.equal(commit.putVisits[1].openedAt, 2_000);
  assert.equal(unrelated.endedAt, null);
});

test("restores a matching worker session without creating another visit", async () => {
  const checkpoint = stateWithTrackedTab({ revision: 2, visible: true });
  const visit = openVisit({
    activeIntervals: [{ startedAt: 1_000, endedAt: null }],
    lastConfirmedAt: 5_000,
    lastActivityAt: 5_000,
  });
  const harness = createTrackerHarness({
    checkpoint,
    sessionState: checkpoint,
    openVisits: [visit],
    browserSnapshot: normalBrowserSnapshot(),
    now: 6_000,
  });

  await harness.tracker.ready;

  assert.equal(harness.tracker.getStateForTest().revision, 2);
  assert.deepEqual(harness.repository.generatedIds, []);
  assert.equal(harness.repository.commitCalls, 0);

  await harness.tracker.dispatch({
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: true,
    at: 6_000,
  });
  assert.equal(harness.repository.snapshotVisits()[0].id, "v1");
  assert.equal(harness.repository.snapshotVisits()[0].lastConfirmedAt, 6_000);
  assert.equal(harness.repository.snapshotVisits().length, 1);
});

test("does not let a mismatched startup snapshot suppress its queued navigation", async () => {
  const checkpoint = runtimeState({
    tabs: { "1": trackedTab({ siteId: "bilibili", visitId: "old", visible: false }) },
    activeTabByWindow: { "1": 1 },
    windowStateById: { "1": "normal" },
    focusedWindowId: 1,
    lastEventAt: 1_000,
  });
  const harness = createTrackerHarness({
    checkpoint,
    sessionState: checkpoint,
    openVisits: [openVisit({ id: "old", siteId: "bilibili" })],
    browserSnapshot: normalBrowserSnapshot([
      browserTab({ url: "https://www.zhihu.com/", visible: false }),
    ]),
    now: 1_500,
    ids: ["new-visit"],
  });

  await harness.tracker.dispatch({ ...navigationEvent, at: 2_000 });

  const visits = Object.fromEntries(
    harness.repository.snapshotVisits().map(visit => [visit.id, visit]),
  );
  assert.equal(visits.old.endedAt, 1_500);
  assert.equal(visits["new-visit"].openedAt, 2_000);
  assert.equal(harness.tracker.getStateForTest().tabs["1"].visitId, "new-visit");
});

test("chooses a newer same-session IDB checkpoint and repairs the mirror", async () => {
  const mirror = runtimeState({ revision: 2, lastEventAt: 2_000 });
  const checkpoint = runtimeState({ revision: 3, lastEventAt: 3_000 });
  const harness = createTrackerHarness({ checkpoint, sessionState: mirror });

  await harness.tracker.ready;

  assert.equal(harness.tracker.getStateForTest().revision, 3);
  assert.equal(harness.session.saveCalls, 1);
  assert.deepEqual(harness.session.snapshot(), checkpoint);
  assert.equal(harness.repository.commitCalls, 0);
});

test("treats a missing session mirror as a browser restart and truncates old visits", async () => {
  const oldVisit = openVisit({
    id: "old",
    activeIntervals: [{ startedAt: 1_000, endedAt: null }],
    lastConfirmedAt: 5_000,
    lastActivityAt: 5_000,
  });
  const harness = createTrackerHarness({
    sessionState: null,
    checkpoint: runtimeState({ sessionId: "old-session", revision: 9 }),
    openVisits: [oldVisit],
    browserSnapshot: normalBrowserSnapshot([
      browserTab({ id: 1, active: true, visible: true }),
      browserTab({ id: 2, active: false, visible: false }),
    ]),
    now: 20_000,
    ids: ["new-session", "foreground", "background"],
  });

  await harness.tracker.ready;

  const visits = Object.fromEntries(
    harness.repository.snapshotVisits().map(visit => [visit.id, visit]),
  );
  assert.equal(visits.old.endedAt, 5_000);
  assert.deepEqual(visits.old.activeIntervals, [{ startedAt: 1_000, endedAt: 5_000 }]);
  assert.equal(visits.foreground.openedAt, 20_000);
  assert.deepEqual(visits.foreground.activeIntervals, [{ startedAt: 20_000, endedAt: null }]);
  assert.equal(visits.background.openedAt, 20_000);
  assert.deepEqual(visits.background.activeIntervals, []);
  assert.equal(harness.tracker.getStateForTest().tabs["1"].visitId, "foreground");
  assert.equal(harness.tracker.getStateForTest().tabs["2"].visitId, "background");
  assert.equal(harness.tracker.getStateForTest().revision, 0);

  const serialized = JSON.stringify(harness.repository.snapshotCheckpoint());
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("must not persist"), false);

  await harness.tracker.dispatch({ type: "TAB_ACTIVATED", tabId: 2, windowId: 1, at: 21_000 });
  assert.deepEqual(
    harness.repository.snapshotVisits().find(visit => visit.id === "background").activeIntervals,
    [],
  );
  await harness.tracker.dispatch({
    type: "PAGE_VISIBILITY",
    tabId: 2,
    documentId: null,
    visible: true,
    at: 22_000,
  });
  assert.deepEqual(
    harness.repository.snapshotVisits().find(visit => visit.id === "background").activeIntervals,
    [{ startedAt: 22_000, endedAt: null }],
  );
});

test("ignores tabs from non-normal browser windows during restart recovery", async () => {
  const harness = createTrackerHarness({
    sessionState: null,
    checkpoint: null,
    browserSnapshot: {
      windows: [{ id: 9, type: "popup", state: "normal", focused: true }],
      tabs: [browserTab({ id: 9, windowId: 9 })],
      focusedWindowId: 9,
      idleState: "active",
    },
    ids: ["new-session", "must-not-be-used"],
  });

  await harness.tracker.ready;

  assert.deepEqual(harness.tracker.getStateForTest().tabs, {});
  assert.deepEqual(harness.repository.snapshotVisits(), []);
  assert.deepEqual(harness.repository.generatedIds, ["new-session"]);
});

test("repairs a failed session mirror before the next event without replaying effects", async () => {
  const harness = createTrackerHarness({ sessionFailures: 1 });
  await harness.tracker.ready;

  await harness.tracker.dispatch(navigationEvent);

  assert.equal(harness.tracker.getStateForTest().revision, 1);
  assert.equal(harness.repository.snapshotCheckpoint().revision, 1);
  assert.equal(harness.session.snapshot().revision, 0);
  assert.equal(harness.errors[0].code, "SESSION_MIRROR_FAILED");
  assert.equal(harness.repository.snapshotVisits().length, 1);

  const logStart = harness.repository.operationLog.length;
  await harness.tracker.dispatch({
    type: "PAGE_VISIBILITY",
    tabId: 1,
    documentId: "doc-1",
    visible: false,
    at: 2_000,
  });

  assert.deepEqual(harness.repository.operationLog.slice(logStart, logStart + 2), [
    "session:save:1",
    "repository:commit:2",
  ]);
  assert.equal(harness.repository.snapshotVisits().length, 1);
  assert.deepEqual(harness.repository.successfulCommits[1].putVisits, []);
  assert.equal(harness.session.snapshot().revision, 2);
});

test("does not checkpoint a stale visibility message", async () => {
  const harness = createTrackerHarness();
  await harness.tracker.ready;

  await harness.tracker.dispatch({
    type: "PAGE_VISIBILITY",
    tabId: 99,
    documentId: "stale-document",
    visible: true,
    at: 9_000,
  });

  assert.equal(harness.repository.commitCalls, 0);
  assert.equal(harness.session.saveCalls, 0);
  assert.equal(harness.tracker.getStateForTest().revision, 0);
});

test("updates site policy from a fresh sanitized snapshot without backfill", async () => {
  const checkpoint = stateWithTrackedTab();
  const visit = openVisit({
    activeIntervals: [{ startedAt: 1_000, endedAt: null }],
    lastConfirmedAt: 1_000,
  });
  const harness = createTrackerHarness({
    checkpoint,
    sessionState: checkpoint,
    openVisits: [visit],
    browserSnapshot: normalBrowserSnapshot(),
  });
  await harness.tracker.ready;
  const disabledSites = trackerSites.map(site =>
    site.id === "zhihu" ? { ...site, enabled: false } : site,
  );

  await harness.tracker.updateSites(disabledSites, { at: 2_000, allowBackfill: false });

  assert.equal(harness.repository.browserSnapshot.captureCalls, 2);
  assert.equal(harness.repository.snapshotVisits()[0].endedAt, 2_000);
  assert.equal(harness.tracker.getStateForTest().tabs["1"].currentSiteId, "zhihu");
  assert.equal(harness.tracker.getStateForTest().tabs["1"].visitId, null);
  assert.equal(JSON.stringify(harness.repository.snapshotCheckpoint()).includes("https://"), false);
});

test("deletes one site's history through the same serialized transaction", async () => {
  const checkpoint = stateWithTrackedTab();
  const harness = createTrackerHarness({
    checkpoint,
    sessionState: checkpoint,
    openVisits: [openVisit()],
    browserSnapshot: normalBrowserSnapshot(),
  });
  await harness.tracker.ready;

  await harness.tracker.deleteSiteHistory("zhihu", 2_000);

  const commit = harness.repository.successfulCommits.at(-1);
  assert.deepEqual(commit.deleteSiteIds, ["zhihu"]);
  assert.deepEqual(harness.repository.snapshotVisits(), []);
  assert.equal(harness.tracker.getStateForTest().tabs["1"].currentSiteId, "zhihu");
  assert.equal(harness.tracker.getStateForTest().tabs["1"].visitId, null);
});
