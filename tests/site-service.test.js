import test from "node:test";
import assert from "node:assert/strict";
import {
  SITE_ERROR_MESSAGES,
} from "../src/shared/protocol.js";
import { createSiteService } from "../src/background/site-service.js";

function copy(value) {
  return structuredClone(value);
}

function createHarness({
  sites = [],
  now = 1_000,
  updateSitesFailures = 0,
  deleteHistoryFailures = 0,
} = {}) {
  let storedSites = copy(sites);
  let currentNow = now;
  let nextId = 1;
  let remainingUpdateFailures = updateSitesFailures;
  let remainingDeleteFailures = deleteHistoryFailures;

  const repository = {
    listCalls: 0,
    replaceCalls: [],
    async list() {
      this.listCalls += 1;
      return copy(storedSites);
    },
    async replace(nextSites) {
      this.replaceCalls.push(copy(nextSites));
      storedSites = copy(nextSites);
    },
    snapshot() {
      return copy(storedSites);
    },
  };

  const tracker = {
    updateSitesCalls: [],
    markSitesDirtyCalls: [],
    deleteSiteHistoryCalls: [],
    async updateSites(nextSites, options) {
      this.updateSitesCalls.push({ sites: copy(nextSites), options: copy(options) });
      if (remainingUpdateFailures > 0) {
        remainingUpdateFailures -= 1;
        throw new Error("tracker update failed");
      }
    },
    async markSitesDirty(nextSites) {
      this.markSitesDirtyCalls.push(copy(nextSites));
    },
    async deleteSiteHistory(siteId, at) {
      this.deleteSiteHistoryCalls.push({ siteId, at });
      if (remainingDeleteFailures > 0) {
        remainingDeleteFailures -= 1;
        throw new Error("tracker delete failed");
      }
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

  const service = createSiteService({
    siteRepository: repository,
    tracker,
    clock,
    idFactory() {
      const id = `site-${nextId}`;
      nextId += 1;
      return id;
    },
  });

  return { service, repository, tracker, clock };
}

async function expectServiceError(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    assert.equal(error.message, SITE_ERROR_MESSAGES[code]);
    return true;
  });
}

test("adds one normalized site without backfilling open tabs", async () => {
  const { service, repository, tracker } = createHarness();

  const result = await service.addSite({
    name: "  知乎  ",
    input: "https://www.zhihu.com/question/1",
  });

  assert.deepEqual(result, {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 1_000,
  });
  assert.deepEqual(repository.snapshot(), [result]);
  assert.deepEqual(tracker.updateSitesCalls, [{
    sites: [result],
    options: { at: 1_000, allowBackfill: false },
  }]);
});

test("maps validation and domain errors to stable Chinese messages", async () => {
  const { service } = createHarness();
  const cases = [
    [{ name: "   ", input: "zhihu.com" }, "INVALID_NAME"],
    [{ name: "知乎", input: "https://[" }, "INVALID_URL"],
    [{ name: "知乎", input: "ftp://zhihu.com/file" }, "UNSUPPORTED_PROTOCOL"],
    [{ name: "本机", input: "http://localhost" }, "UNREGISTRABLE_DOMAIN"],
  ];

  for (const [input, code] of cases) {
    await expectServiceError(service.addSite(input), code);
  }
});

test("rejects duplicate normalized domains even when the stored site is disabled", async () => {
  const existing = {
    id: "existing",
    name: "知乎",
    domain: "zhihu.com",
    enabled: false,
    createdAt: 10,
  };
  const { service } = createHarness({ sites: [existing] });

  await expectServiceError(
    service.addSite({ name: "知乎专栏", input: "https://zhuanlan.zhihu.com" }),
    "DUPLICATE_SITE",
  );
});

test("serializes simultaneous additions so normalized duplicates cannot pass together", async () => {
  const { service, repository, tracker } = createHarness();

  const [first, second] = await Promise.allSettled([
    service.addSite({ name: "知乎", input: "zhihu.com" }),
    service.addSite({ name: "知乎专栏", input: "https://zhuanlan.zhihu.com" }),
  ]);

  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.equal(second.reason.code, "DUPLICATE_SITE");
  assert.equal(repository.snapshot().length, 1);
  assert.equal(tracker.updateSitesCalls.length, 1);
});

test("disables and re-enables a site without changing its identity or deleting history", async () => {
  const site = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 100,
  };
  const { service, repository, tracker, clock } = createHarness({ sites: [site] });

  clock.set(2_000);
  const disabled = await service.setSiteEnabled({ siteId: site.id, enabled: false });
  clock.set(3_000);
  const enabled = await service.setSiteEnabled({ siteId: site.id, enabled: true });

  assert.deepEqual(disabled, { ...site, enabled: false });
  assert.deepEqual(enabled, site);
  assert.deepEqual(repository.snapshot(), [site]);
  assert.deepEqual(tracker.updateSitesCalls, [
    {
      sites: [{ ...site, enabled: false }],
      options: { at: 2_000, allowBackfill: false },
    },
    {
      sites: [site],
      options: { at: 3_000, allowBackfill: false },
    },
  ]);
  assert.deepEqual(tracker.deleteSiteHistoryCalls, []);
});

test("does not persist or synchronize an already stored enabled state", async () => {
  const site = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 100,
  };
  const { service, repository, tracker } = createHarness({ sites: [site] });

  assert.deepEqual(
    await service.setSiteEnabled({ siteId: site.id, enabled: true }),
    site,
  );
  assert.deepEqual(repository.replaceCalls, []);
  assert.deepEqual(tracker.updateSitesCalls, []);
});

test("keeps saved configuration authoritative and marks it dirty when tracker sync fails", async () => {
  const { service, repository, tracker } = createHarness({ updateSitesFailures: 1 });

  await expectServiceError(
    service.addSite({ name: "知乎", input: "zhihu.com" }),
    "SITE_STATE_SYNC_FAILED",
  );

  const [savedSite] = repository.snapshot();
  assert.deepEqual(savedSite, {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 1_000,
  });
  assert.deepEqual(tracker.markSitesDirtyCalls, [[savedSite]]);
});

test("continues serialized operations after a site synchronization failure", async () => {
  const { service, repository, tracker } = createHarness({ updateSitesFailures: 1 });

  await expectServiceError(
    service.addSite({ name: "知乎", input: "zhihu.com" }),
    "SITE_STATE_SYNC_FAILED",
  );
  const second = await service.addSite({ name: "B 站", input: "bilibili.com" });

  assert.equal(second.domain, "bilibili.com");
  assert.deepEqual(
    repository.snapshot().map(site => site.domain),
    ["zhihu.com", "bilibili.com"],
  );
  assert.equal(tracker.updateSitesCalls.length, 2);
});

test("deletes only visit history and leaves site configuration byte-for-byte unchanged", async () => {
  const site = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 100,
  };
  const { service, repository, tracker } = createHarness({ sites: [site], now: 4_000 });
  const before = repository.snapshot();

  const result = await service.deleteSiteHistory({ siteId: site.id });

  assert.deepEqual(result, site);
  assert.deepEqual(tracker.deleteSiteHistoryCalls, [{ siteId: site.id, at: 4_000 }]);
  assert.deepEqual(repository.snapshot(), before);
  assert.deepEqual(repository.replaceCalls, []);
});

test("does not claim history deletion succeeded when tracker deletion fails", async () => {
  const site = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 100,
  };
  const { service, repository } = createHarness({
    sites: [site],
    deleteHistoryFailures: 1,
  });

  await expectServiceError(
    service.deleteSiteHistory({ siteId: site.id }),
    "DELETE_HISTORY_FAILED",
  );
  assert.deepEqual(repository.snapshot(), [site]);
});

test("reports missing site configuration for state and deletion commands", async () => {
  const { service } = createHarness();

  await expectServiceError(
    service.setSiteEnabled({ siteId: "missing", enabled: false }),
    "SITE_NOT_FOUND",
  );
  await expectServiceError(
    service.deleteSiteHistory({ siteId: "missing" }),
    "SITE_NOT_FOUND",
  );
});
