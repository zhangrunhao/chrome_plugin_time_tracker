import { createTracker } from "../../src/background/tracker.js";

const defaultSites = [
  { id: "zhihu", name: "Zhihu", domain: "zhihu.com", enabled: true, createdAt: 1 },
  { id: "bilibili", name: "Bilibili", domain: "bilibili.com", enabled: true, createdAt: 1 },
];

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function runtimeState({
  sessionId = "session-1",
  revision = 0,
  tabs = {},
  activeTabByWindow = {},
  windowStateById = {},
  focusedWindowId = null,
  locked = false,
  activeVisitId = null,
  lastEventAt = 0,
} = {}) {
  return {
    version: 1,
    sessionId,
    revision,
    tabs: copy(tabs),
    activeTabByWindow: copy(activeTabByWindow),
    windowStateById: copy(windowStateById),
    focusedWindowId,
    locked,
    activeVisitId,
    lastEventAt,
  };
}

export function openVisit({
  id = "v1",
  siteId = "zhihu",
  openedAt = 1_000,
  activeIntervals = [],
  lastConfirmedAt = openedAt,
  lastActivityAt = lastConfirmedAt,
} = {}) {
  return {
    id,
    siteId,
    openedAt,
    endedAt: null,
    activeIntervals: copy(activeIntervals),
    lastConfirmedAt,
    lastActivityAt,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTrackingFake({ checkpoint, visits, commitFailures, operationLog }) {
  let persistedCheckpoint = copy(checkpoint);
  let remainingFailures = commitFailures;
  let holdingCommits = false;
  const records = new Map(visits.map(visit => [visit.id, copy(visit)]));
  const heldCommits = [];
  const commitWaiters = [];

  function notifyCommitWaiters(commitCalls) {
    for (let index = commitWaiters.length - 1; index >= 0; index -= 1) {
      if (commitCalls >= commitWaiters[index].count) {
        commitWaiters.splice(index, 1)[0].resolve();
      }
    }
  }

  const repository = {
    commitCalls: 0,
    commits: [],
    successfulCommits: [],
    getVisitCalls: [],
    listOpenVisitsCalls: 0,
    operationLog,

    async getVisit(id) {
      repository.getVisitCalls.push(id);
      return copy(records.get(id));
    },

    async listOpenVisits() {
      repository.listOpenVisitsCalls += 1;
      return [...records.values()].filter(visit => visit.endedAt === null).map(copy);
    },

    async getCheckpoint() {
      return persistedCheckpoint === null ? null : copy(persistedCheckpoint);
    },

    async commit(input) {
      const staged = copy(input);
      repository.commitCalls += 1;
      repository.commits.push(staged);
      operationLog.push(`repository:commit:${staged.checkpoint.revision}`);
      notifyCommitWaiters(repository.commitCalls);

      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("write failed");
      }

      if (holdingCommits) {
        const gate = deferred();
        heldCommits.push(gate);
        await gate.promise;
      }

      const deleted = new Set(staged.deleteSiteIds);
      for (const [id, visit] of records) {
        if (deleted.has(visit.siteId)) {
          records.delete(id);
        }
      }
      for (const visit of staged.putVisits) {
        if (!deleted.has(visit.siteId)) {
          records.set(visit.id, copy(visit));
        }
      }
      persistedCheckpoint = copy(staged.checkpoint);
      repository.successfulCommits.push(staged);
    },

    holdCommits() {
      holdingCommits = true;
    },

    releaseNextCommit() {
      const gate = heldCommits.shift();
      if (gate === undefined) {
        throw new Error("No held commit is waiting");
      }
      gate.resolve();
    },

    waitForCommitCall(count) {
      if (repository.commitCalls >= count) {
        return Promise.resolve();
      }
      const gate = deferred();
      commitWaiters.push({ count, resolve: gate.resolve });
      return gate.promise;
    },

    setCommitFailures(count) {
      remainingFailures = count;
    },

    snapshotCheckpoint() {
      return persistedCheckpoint === null ? null : copy(persistedCheckpoint);
    },

    snapshotVisits() {
      return [...records.values()].map(copy);
    },
  };

  return repository;
}

function createSessionFake({ initialState, sessionFailures, operationLog }) {
  let persistedState = copy(initialState);
  let remainingFailures = sessionFailures;

  return {
    saveCalls: 0,
    saveAttempts: [],
    operationLog,

    async load() {
      return persistedState === null ? null : copy(persistedState);
    },

    async save(state) {
      this.saveCalls += 1;
      this.saveAttempts.push(copy(state));
      operationLog.push(`session:save:${state.revision}`);
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("session write failed");
      }
      persistedState = copy(state);
    },

    async clear() {
      persistedState = null;
    },

    setFailures(count) {
      remainingFailures = count;
    },

    snapshot() {
      return persistedState === null ? null : copy(persistedState);
    },
  };
}

function createBrowserSnapshotFake(initialSnapshot, snapshotDeferred) {
  let snapshot = copy(initialSnapshot);
  const gate = snapshotDeferred ? deferred() : null;
  const callGate = deferred();

  return {
    captureCalls: 0,

    async capture() {
      this.captureCalls += 1;
      callGate.resolve();
      if (gate !== null) {
        await gate.promise;
      }
      return copy(snapshot);
    },

    setSnapshot(nextSnapshot) {
      snapshot = copy(nextSnapshot);
    },

    release() {
      gate?.resolve();
    },

    waitForCapture() {
      return this.captureCalls > 0 ? Promise.resolve() : callGate.promise;
    },
  };
}

export function createTrackerHarness({
  commitFailures = 0,
  sessionFailures = 0,
  sessionState,
  checkpoint,
  openVisits = [],
  browserSnapshot = {
    windows: [],
    tabs: [],
    focusedWindowId: null,
    idleState: "active",
  },
  now = 1_000,
  sites = defaultSites,
  ids = ["generated-1", "generated-2", "generated-3", "generated-4"],
  snapshotDeferred = false,
} = {}) {
  const baseCheckpoint = checkpoint === undefined ? runtimeState() : checkpoint;
  const baseSession = sessionState === undefined ? baseCheckpoint : sessionState;
  const operationLog = [];
  const repository = createTrackingFake({
    checkpoint: baseCheckpoint,
    visits: openVisits,
    commitFailures,
    operationLog,
  });
  const session = createSessionFake({
    initialState: baseSession,
    sessionFailures,
    operationLog,
  });
  const snapshot = createBrowserSnapshotFake(browserSnapshot, snapshotDeferred);
  const errors = [];
  const delays = [];
  const generatedIds = [];
  const remainingIds = [...ids];
  let currentNow = now;
  const clock = {
    now() {
      return currentNow;
    },
    set(value) {
      currentNow = value;
    },
  };
  const siteRepository = {
    async list() {
      return copy(sites);
    },
  };

  const tracker = createTracker({
    trackingRepository: repository,
    siteRepository,
    sessionRepository: session,
    browserSnapshot: snapshot,
    clock,
    idFactory() {
      const id = remainingIds.shift();
      if (id === undefined) {
        throw new Error("deterministic IDs exhausted");
      }
      generatedIds.push(id);
      return id;
    },
    async delay(ms) {
      delays.push(ms);
    },
    reportError(error) {
      errors.push(error);
    },
  });

  repository.generatedIds = generatedIds;
  repository.browserSnapshot = snapshot;

  return { tracker, repository, session, errors, delays, clock };
}

export { defaultSites as trackerSites };
