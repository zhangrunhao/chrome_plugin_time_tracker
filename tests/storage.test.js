import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createRuntimeState } from "../src/domain/runtime-machine.js";
import { openWebTraceDb } from "../src/storage/webtrace-db.js";
import { createTrackingRepository } from "../src/storage/tracking-repository.js";
import { createSiteRepository } from "../src/storage/site-repository.js";
import { createSessionRepository } from "../src/storage/session-repository.js";
import {
  createStorageAreaFake,
  makeTrackingRepository,
  uniqueDbName,
} from "./helpers/storage-fakes.js";

const visit = {
  id: "v1",
  siteId: "s1",
  openedAt: 1_000,
  endedAt: 2_000,
  activeIntervals: [],
  lastConfirmedAt: 1_000,
  lastActivityAt: 2_000,
};

const checkpoint = {
  version: 1,
  sessionId: "session-1",
  revision: 1,
  tabs: {},
  activeTabByWindow: {},
  windowStateById: {},
  focusedWindowId: null,
  locked: false,
  activeVisitId: null,
  lastEventAt: 0,
};

function visitWith(id, overrides = {}) {
  return {
    ...visit,
    id,
    ...overrides,
    activeIntervals: overrides.activeIntervals ?? [],
  };
}

test("creates the required stores and compound visit indexes", async () => {
  const db = await openWebTraceDb(indexedDB, uniqueDbName());
  const tx = db.transaction(["visits", "runtimeCheckpoint"], "readonly");
  const visits = tx.objectStore("visits");

  assert.deepEqual([...db.objectStoreNames], ["runtimeCheckpoint", "visits"]);
  assert.equal(visits.keyPath, "id");
  assert.deepEqual(visits.index("bySiteOpenedAt").keyPath, ["siteId", "openedAt"]);
  assert.deepEqual(visits.index("bySiteLastActivityAt").keyPath, ["siteId", "lastActivityAt"]);
  assert.equal(tx.objectStore("runtimeCheckpoint").keyPath, "key");
  db.close();
});

test("commits visits and runtime checkpoint atomically", async () => {
  const repository = await makeTrackingRepository();

  await repository.commit({ putVisits: [visit], deleteSiteIds: [], checkpoint });

  assert.deepEqual(await repository.getVisit("v1"), visit);
  assert.deepEqual(await repository.getCheckpoint(), checkpoint);
});

test("aborts the whole commit when a staged visit raises DataError", async () => {
  const repository = await makeTrackingRepository();
  await repository.commit({
    putVisits: [visitWith("existing")],
    deleteSiteIds: [],
    checkpoint,
  });
  const nextCheckpoint = { ...checkpoint, revision: 2 };

  await assert.rejects(
    repository.commit({
      putVisits: [visitWith("staged"), { ...visit, id: undefined }],
      deleteSiteIds: [],
      checkpoint: nextCheckpoint,
    }),
    error => error instanceof DOMException && error.name === "DataError",
  );

  assert.equal(await repository.getVisit("staged"), undefined);
  assert.deepEqual(await repository.getCheckpoint(), checkpoint);
  assert.ok(await repository.getVisit("existing"));
});

test("lists only visits whose endedAt is null", async () => {
  const repository = await makeTrackingRepository();
  const openVisit = visitWith("open", { endedAt: null });
  await repository.commit({
    putVisits: [openVisit, visitWith("ended")],
    deleteSiteIds: [],
    checkpoint,
  });

  assert.deepEqual(await repository.listOpenVisits(), [openVisit]);
});

test("queries every possible window overlap and excludes future-only visits", async () => {
  const repository = await makeTrackingRepository();
  const records = [
    visitWith("opened-inside", { openedAt: 200, lastActivityAt: 300 }),
    visitWith("active-inside", { openedAt: 100, lastActivityAt: 400 }),
    visitWith("spans-beyond", { openedAt: 100, lastActivityAt: 800 }),
    visitWith("ended-before", { openedAt: 100, lastActivityAt: 199 }),
    visitWith("future-only", { openedAt: 500, lastActivityAt: 800 }),
    visitWith("other-site", { siteId: "s2", openedAt: 300, lastActivityAt: 400 }),
  ];
  await repository.commit({ putVisits: records, deleteSiteIds: [], checkpoint });

  const result = await repository.queryVisitsForReport("s1", 200, 500);

  assert.deepEqual(result.map(item => item.id).sort(), [
    "active-inside",
    "opened-inside",
    "spans-beyond",
  ]);
  assert.equal(new Set(result.map(item => item.id)).size, result.length);
});

test("deletes one site's rows without deleting other sites", async () => {
  const repository = await makeTrackingRepository();
  const otherSite = visitWith("other-site", { siteId: "s2" });
  await repository.commit({
    putVisits: [visit, otherSite],
    deleteSiteIds: [],
    checkpoint,
  });
  const nextCheckpoint = { ...checkpoint, revision: 2 };

  await repository.commit({ putVisits: [], deleteSiteIds: ["s1"], checkpoint: nextCheckpoint });

  assert.deepEqual(
    await repository.queryVisitsForReport("s1", 0, Number.MAX_SAFE_INTEGER),
    [],
  );
  assert.ok(await repository.getVisit("other-site"));
  assert.deepEqual(await repository.getCheckpoint(), nextCheckpoint);
});

test("does not reinsert visits for a site deleted in the same commit", async () => {
  const repository = await makeTrackingRepository();
  await repository.commit({ putVisits: [visit], deleteSiteIds: [], checkpoint });

  await repository.commit({
    putVisits: [visitWith("current", { siteId: "s1", endedAt: null })],
    deleteSiteIds: ["s1"],
    checkpoint: { ...checkpoint, revision: 2 },
  });

  assert.equal(await repository.getVisit("v1"), undefined);
  assert.equal(await repository.getVisit("current"), undefined);
});

test("site repository uses only webtraceSitesV1 and returns defensive copies", async () => {
  const legacyStats = { "2026-08-31": { "example.com": 10 } };
  const area = createStorageAreaFake({ stats: legacyStats, unrelated: "keep" });
  const sites = createSiteRepository(area);
  const site = { id: "s1", name: "Example", domain: "example.com", enabled: true, createdAt: 1 };

  assert.deepEqual(await sites.list(), []);
  await sites.replace([site]);
  site.name = "mutated input";
  const firstRead = await sites.list();
  assert.equal(firstRead[0].name, "Example");
  firstRead[0].name = "mutated result";
  assert.equal((await sites.list())[0].name, "Example");
  assert.deepEqual(area.snapshot(), {
    stats: legacyStats,
    unrelated: "keep",
    webtraceSitesV1: [{
      id: "s1",
      name: "Example",
      domain: "example.com",
      enabled: true,
      createdAt: 1,
    }],
  });
  assert.equal(area.calls.some(call => call.method === "clear"), false);
  assert.equal(area.calls.some(call => call.keys === "stats"), false);
});

test("session repository saves, loads and removes only webtraceRuntimeV1", async () => {
  const area = createStorageAreaFake({ unrelated: { keep: true }, stats: "legacy" });
  const session = createSessionRepository(area);
  const state = structuredClone(checkpoint);

  assert.equal(await session.load(), null);
  await session.save(state);
  state.revision = 99;
  const firstRead = await session.load();
  assert.deepEqual(firstRead, checkpoint);
  firstRead.tabs.extra = { tabId: 99 };
  assert.deepEqual(await session.load(), checkpoint);
  await session.clear();
  assert.equal(await session.load(), null);
  assert.deepEqual(area.snapshot(), { unrelated: { keep: true }, stats: "legacy" });
  assert.equal(area.calls.some(call => call.method === "clear"), false);
  assert.equal(area.calls.some(call => call.keys === "stats"), false);
});

test("serialized runtime state omits unconfigured-tab URL metadata", async () => {
  const secretUrl = "https://private.example/private/path?token=secret";
  const state = createRuntimeState({
    sessionId: "session-private",
    sites: [],
    snapshot: {
      tabs: [{
        id: 7,
        windowId: 1,
        url: secretUrl,
        title: "Private Tab Title",
        hostname: "private.example",
        active: true,
        visible: true,
      }],
      windows: [{ id: 1, state: "normal" }],
      focusedWindowId: 1,
    },
  });
  const area = createStorageAreaFake();
  const session = createSessionRepository(area);

  await session.save(state);

  const serialized = JSON.stringify(area.snapshot().webtraceRuntimeV1);
  for (const privateFragment of [
    "http://",
    "https://",
    "/private/path",
    "token=secret",
    "Private Tab Title",
    "private.example",
  ]) {
    assert.equal(serialized.includes(privateFragment), false, privateFragment);
  }
});

test("opening an existing newer database rejects with the original VersionError", async () => {
  const name = uniqueDbName();
  const request = indexedDB.open(name, 2);
  const newerDatabase = await new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  newerDatabase.close();

  await assert.rejects(
    openWebTraceDb(indexedDB, name),
    error => error instanceof DOMException && error.name === "VersionError",
  );
});

test("createTrackingRepository rejects objects that are not open IndexedDB databases", () => {
  assert.throws(() => createTrackingRepository(null), TypeError);
});
