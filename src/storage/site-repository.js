const STORAGE_KEY = "webtraceSitesV1";

function copy(value) {
  return structuredClone(value);
}

export function createSiteRepository(storageArea = globalThis.chrome?.storage?.local) {
  if (
    storageArea === null ||
    typeof storageArea?.get !== "function" ||
    typeof storageArea?.set !== "function"
  ) {
    throw new TypeError("A Chrome local storage area is required");
  }

  return {
    async list() {
      const stored = await storageArea.get(STORAGE_KEY);
      const sites = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
      return copy(sites);
    },

    async replace(sites) {
      if (!Array.isArray(sites)) {
        throw new TypeError("sites must be an array");
      }
      await storageArea.set({ [STORAGE_KEY]: copy(sites) });
    },
  };
}
