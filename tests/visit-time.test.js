import test from "node:test";
import assert from "node:assert/strict";
import {
  createVisit,
  startInterval,
  confirmInterval,
  pauseInterval,
  endVisit,
  recoverVisitAfterBrowserExit,
  getVisitDurationMs,
} from "../src/domain/visit-time.js";

test("is idempotent and counts an open interval only through confirmation", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = startInterval(visit, 2_000);
  visit = startInterval(visit, 2_100);
  visit = confirmInterval(visit, 6_000);
  assert.equal(visit.activeIntervals.length, 1);
  assert.equal(getVisitDurationMs(visit, { asOf: 20_000 }), 4_000);
  visit = pauseInterval(visit, 7_000);
  visit = pauseInterval(visit, 8_000);
  assert.equal(getVisitDurationMs(visit, { asOf: 20_000 }), 5_000);
});

test("crash recovery closes at last confirmation and never at restart time", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = confirmInterval(startInterval(visit, 2_000), 6_000);
  visit = recoverVisitAfterBrowserExit(visit);
  assert.equal(visit.activeIntervals[0].endedAt, 6_000);
  assert.equal(visit.endedAt, 6_000);
  assert.equal(getVisitDurationMs(visit, { asOf: 99_000 }), 4_000);
});

test("trusted pause and end events close once without overlapping intervals", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = pauseInterval(startInterval(visit, 2_000), 5_000);
  visit = startInterval(visit, 7_000);
  visit = endVisit(visit, 9_000);
  assert.deepEqual(visit.activeIntervals, [
    { startedAt: 2_000, endedAt: 5_000 },
    { startedAt: 7_000, endedAt: 9_000 },
  ]);
  assert.equal(visit.endedAt, 9_000);
});

test("clamps stale events without mutating prior visit snapshots", () => {
  const created = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  const started = startInterval(created, 5_000);
  const confirmed = confirmInterval(started, 3_000);
  const paused = pauseInterval(confirmed, 4_000);

  assert.notEqual(started, created);
  assert.notEqual(confirmed, started);
  assert.deepEqual(created.activeIntervals, []);
  assert.deepEqual(started.activeIntervals, [{ startedAt: 5_000, endedAt: null }]);
  assert.deepEqual(paused.activeIntervals, [{ startedAt: 5_000, endedAt: 5_000 }]);
  assert.equal(confirmed.lastConfirmedAt, 5_000);
  assert.equal(paused.lastActivityAt, 5_000);
});

test("does not reopen ended visits or change closed intervals on duplicate events", () => {
  const ended = endVisit(
    pauseInterval(startInterval(createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 }), 2_000), 3_000),
    4_000,
  );
  const restarted = startInterval(ended, 9_000);
  const reconfirmed = confirmInterval(ended, 9_000);

  assert.notEqual(restarted, ended);
  assert.notEqual(reconfirmed, ended);
  assert.deepEqual(restarted, ended);
  assert.deepEqual(reconfirmed, ended);
});
