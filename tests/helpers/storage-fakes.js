import { openWebTraceDb } from "../../src/storage/webtrace-db.js";
import { createTrackingRepository } from "../../src/storage/tracking-repository.js";

let nextDatabaseId = 0;

export function uniqueDbName() {
  nextDatabaseId += 1;
  return `webtrace-test-${process.pid}-${nextDatabaseId}`;
}

export async function makeTrackingRepository() {
  const db = await openWebTraceDb(indexedDB, uniqueDbName());
  return createTrackingRepository(db);
}

export function createStorageAreaFake(initialValue = {}) {
  const values = structuredClone(initialValue);
  const calls = [];

  return {
    calls,
    async get(keys) {
      calls.push({ method: "get", keys: structuredClone(keys) });
      if (typeof keys === "string") {
        return Object.hasOwn(values, keys) ? { [keys]: structuredClone(values[keys]) } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter(key => Object.hasOwn(values, key)).map(key => [key, structuredClone(values[key])]),
        );
      }
      if (keys === null || keys === undefined) {
        return structuredClone(values);
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [
          key,
          Object.hasOwn(values, key) ? structuredClone(values[key]) : structuredClone(fallback),
        ]),
      );
    },
    async set(items) {
      calls.push({ method: "set", items: structuredClone(items) });
      for (const [key, value] of Object.entries(items)) {
        values[key] = structuredClone(value);
      }
    },
    async remove(keys) {
      calls.push({ method: "remove", keys: structuredClone(keys) });
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    },
    async clear() {
      calls.push({ method: "clear" });
      for (const key of Object.keys(values)) {
        delete values[key];
      }
    },
    snapshot() {
      return structuredClone(values);
    },
  };
}
