function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
}

async function readRequest(database, storeName, makeRequest) {
  const transaction = database.transaction(storeName, "readonly");
  const completion = transactionCompletion(transaction);
  const [value] = await Promise.all([
    requestResult(makeRequest(transaction.objectStore(storeName))),
    completion,
  ]);
  return value;
}

function stripCheckpointKey(record) {
  if (record === undefined) {
    return null;
  }
  const { key: _key, ...checkpoint } = record;
  return checkpoint;
}

function queryIndex(index, siteId, rangeStart, rangeEnd) {
  const range = IDBKeyRange.bound(
    [siteId, rangeStart],
    [siteId, rangeEnd],
    false,
    true,
  );
  return requestResult(index.getAll(range));
}

export function createTrackingRepository(database) {
  if (database === null || typeof database?.transaction !== "function") {
    throw new TypeError("An open IndexedDB database is required");
  }

  return {
    getVisit(id) {
      return readRequest(database, "visits", store => store.get(id));
    },

    async listOpenVisits() {
      const visits = await readRequest(database, "visits", store => store.getAll());
      return visits.filter(item => item.endedAt === null);
    },

    async getCheckpoint() {
      const record = await readRequest(
        database,
        "runtimeCheckpoint",
        store => store.get("current"),
      );
      return stripCheckpointKey(record);
    },

    async queryVisitsForReport(siteId, rangeStart, rangeEnd) {
      const transaction = database.transaction("visits", "readonly");
      const completion = transactionCompletion(transaction);
      const visits = transaction.objectStore("visits");
      const [openedInRange, activeInRange] = await Promise.all([
        queryIndex(visits.index("bySiteOpenedAt"), siteId, rangeStart, rangeEnd),
        queryIndex(visits.index("bySiteLastActivityAt"), siteId, rangeStart, rangeEnd),
        completion,
      ]);

      const byId = new Map();
      for (const item of [...openedInRange, ...activeInRange]) {
        byId.set(item.id, item);
      }
      return [...byId.values()];
    },

    commit({ putVisits, deleteSiteIds, checkpoint }) {
      const transaction = database.transaction(
        ["visits", "runtimeCheckpoint"],
        "readwrite",
      );
      const visits = transaction.objectStore("visits");
      const checkpoints = transaction.objectStore("runtimeCheckpoint");
      const deletedSites = new Set(deleteSiteIds);
      let operationError = null;

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => {
          reject(
            operationError ??
              transaction.error ??
              new DOMException("Transaction aborted", "AbortError"),
          );
        };

        function abort(error) {
          operationError = error;
          try {
            transaction.abort();
          } catch (abortError) {
            reject(operationError ?? abortError);
          }
        }

        function stageWrites() {
          try {
            for (const item of putVisits) {
              if (!deletedSites.has(item.siteId)) {
                visits.put(item);
              }
            }
            checkpoints.put({ ...checkpoint, key: "current" });
          } catch (error) {
            abort(error);
          }
        }

        if (deletedSites.size === 0) {
          stageWrites();
          return;
        }

        const cursorRequest = visits.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            stageWrites();
            return;
          }
          if (deletedSites.has(cursor.value.siteId)) {
            cursor.delete();
          }
          cursor.continue();
        };
      });
    },
  };
}
