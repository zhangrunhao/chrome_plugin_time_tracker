const DATABASE_VERSION = 1;
const DEFAULT_DATABASE_NAME = "webtrace";

export function openWebTraceDb(factory = globalThis.indexedDB, name = DEFAULT_DATABASE_NAME) {
  if (factory === null || typeof factory?.open !== "function") {
    return Promise.reject(new TypeError("An IndexedDB factory is required"));
  }

  return new Promise((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    let settled = false;

    request.onupgradeneeded = () => {
      const database = request.result;
      const visits = database.createObjectStore("visits", { keyPath: "id" });
      visits.createIndex("bySiteOpenedAt", ["siteId", "openedAt"]);
      visits.createIndex("bySiteLastActivityAt", ["siteId", "lastActivityAt"]);
      database.createObjectStore("runtimeCheckpoint", { keyPath: "key" });
    };

    request.onerror = () => {
      settled = true;
      reject(request.error);
    };

    request.onblocked = () => {
      settled = true;
      reject(new DOMException("The WebTrace database upgrade was blocked", "InvalidStateError"));
    };

    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
}
