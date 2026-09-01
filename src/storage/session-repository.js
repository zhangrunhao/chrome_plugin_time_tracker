const STORAGE_KEY = "webtraceRuntimeV1";

function copy(value) {
  return structuredClone(value);
}

export function createSessionRepository(storageArea = globalThis.chrome?.storage?.session) {
  if (
    storageArea === null ||
    typeof storageArea?.get !== "function" ||
    typeof storageArea?.set !== "function" ||
    typeof storageArea?.remove !== "function"
  ) {
    throw new TypeError("A Chrome session storage area is required");
  }

  return {
    async load() {
      const stored = await storageArea.get(STORAGE_KEY);
      return stored[STORAGE_KEY] === undefined ? null : copy(stored[STORAGE_KEY]);
    },

    async save(runtimeState) {
      await storageArea.set({ [STORAGE_KEY]: copy(runtimeState) });
    },

    async clear() {
      await storageArea.remove(STORAGE_KEY);
    },
  };
}
