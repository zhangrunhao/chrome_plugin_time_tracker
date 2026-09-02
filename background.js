import { registerChromeEvents } from "./src/background/chrome-events.js";
import { createSiteService } from "./src/background/site-service.js";
import { createTracker } from "./src/background/tracker.js";
import { createSessionRepository } from "./src/storage/session-repository.js";
import { createSiteRepository } from "./src/storage/site-repository.js";
import { createTrackingRepository } from "./src/storage/tracking-repository.js";
import { openWebTraceDb } from "./src/storage/webtrace-db.js";

const chromeApi = globalThis.chrome;
const trustedContexts = { accessLevel: "TRUSTED_CONTEXTS" };

function reportError({ code, stack }) {
  if (typeof stack === "string" && stack !== "") {
    console.error(code, stack);
    return;
  }
  console.error(code);
}

function restrictStorageAccess() {
  return Promise.all([
    chromeApi.storage.local.setAccessLevel(trustedContexts),
    chromeApi.storage.session.setAccessLevel(trustedContexts),
  ]).catch(error => {
    reportError({ code: "STORAGE_ACCESS_LEVEL_FAILED" });
    throw error;
  });
}

export function createChromeBrowserSnapshot(chrome = chromeApi) {
  return {
    async capture() {
      const [windows, idleState] = await Promise.all([
        chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }),
        new Promise((resolve, reject) => {
          chrome.idle.queryState(60, state => {
            const error = chrome.runtime.lastError;
            if (error !== null && error !== undefined) {
              reject(new Error(error.message));
              return;
            }
            resolve(state);
          });
        }),
      ]);
      const focusedWindow = windows.find(window => window.focused === true);
      return {
        windows,
        tabs: windows.flatMap(window => window.tabs ?? []),
        focusedWindowId: focusedWindow?.id ?? null,
        idleState,
      };
    },
  };
}

function gatedSiteRepository(accessReady, repository) {
  return {
    async list(...args) {
      await accessReady;
      return repository.list(...args);
    },
    async replace(...args) {
      await accessReady;
      return repository.replace(...args);
    },
  };
}

function gatedSessionRepository(accessReady, repository) {
  return {
    async load(...args) {
      await accessReady;
      return repository.load(...args);
    },
    async save(...args) {
      await accessReady;
      return repository.save(...args);
    },
    async clear(...args) {
      await accessReady;
      return repository.clear(...args);
    },
  };
}

function deferredTrackingRepository(repositoryReady) {
  return {
    async getVisit(...args) {
      return (await repositoryReady).getVisit(...args);
    },
    async listOpenVisits(...args) {
      return (await repositoryReady).listOpenVisits(...args);
    },
    async getCheckpoint(...args) {
      return (await repositoryReady).getCheckpoint(...args);
    },
    async queryVisitsForReport(...args) {
      return (await repositoryReady).queryVisitsForReport(...args);
    },
    async commit(...args) {
      return (await repositoryReady).commit(...args);
    },
  };
}

const storageAccessReady = restrictStorageAccess();
const clock = { now: () => Date.now() };
const idFactory = () => crypto.randomUUID();
const siteRepository = gatedSiteRepository(
  storageAccessReady,
  createSiteRepository(chromeApi.storage.local),
);
const sessionRepository = gatedSessionRepository(
  storageAccessReady,
  createSessionRepository(chromeApi.storage.session),
);
const trackingRepositoryReady = storageAccessReady
  .then(() => openWebTraceDb(globalThis.indexedDB))
  .then(createTrackingRepository);

const tracker = createTracker({
  trackingRepository: deferredTrackingRepository(trackingRepositoryReady),
  siteRepository,
  sessionRepository,
  browserSnapshot: createChromeBrowserSnapshot(chromeApi),
  clock,
  idFactory,
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
  reportError,
});

const siteService = createSiteService({
  siteRepository,
  tracker,
  clock,
  idFactory,
});

export const backgroundReady = tracker.ready.then(() => (
  siteService.migrateDisabledSites()
));
backgroundReady.catch(() => {});

registerChromeEvents({
  chrome: chromeApi,
  tracker,
  siteService,
  clock,
  lifecycleReady: backgroundReady,
  reportError,
});
