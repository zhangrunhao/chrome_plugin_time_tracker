import {
  SITE_ERROR_MESSAGES,
  WebTraceCommandError,
} from "../shared/protocol.js";
import { normalizeSiteInput } from "../domain/site-domain.js";

function copy(value) {
  return structuredClone(value);
}

function serviceError(code, cause) {
  return new WebTraceCommandError(code, cause === undefined ? {} : { cause });
}

function normalizedDomain(input) {
  try {
    return normalizeSiteInput(input).domain;
  } catch (error) {
    if (SITE_ERROR_MESSAGES[error?.code] !== undefined) {
      throw serviceError(error.code, error);
    }
    throw error;
  }
}

export function createSiteService({ siteRepository, tracker, clock, idFactory }) {
  let operationTail = Promise.resolve();

  function enqueue(operation) {
    const result = operationTail
      .catch(() => {})
      .then(operation);
    operationTail = result.catch(() => {});
    return result;
  }

  async function synchronizeSavedSites(nextSites, at) {
    try {
      await tracker.updateSites(copy(nextSites), { at, allowBackfill: false });
    } catch (error) {
      try {
        await tracker.markSitesDirty(copy(nextSites));
      } catch {
        // The stable command failure remains authoritative even if the in-memory
        // retry marker cannot be installed during a broader tracker failure.
      }
      throw serviceError("SITE_STATE_SYNC_FAILED", error);
    }
  }

  return {
    addSite({ name, input }) {
      return enqueue(async () => {
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (trimmedName === "") {
          throw serviceError("INVALID_NAME");
        }
        const domain = normalizedDomain(input);
        const sites = await siteRepository.list();
        if (sites.some(site => site.domain === domain)) {
          throw serviceError("DUPLICATE_SITE");
        }

        const at = clock.now();
        const site = {
          id: idFactory(),
          name: trimmedName,
          domain,
          enabled: true,
          createdAt: at,
        };
        const nextSites = [...sites, site];
        await siteRepository.replace(copy(nextSites));
        await synchronizeSavedSites(nextSites, at);
        return copy(site);
      });
    },

    setSiteEnabled({ siteId, enabled }) {
      return enqueue(async () => {
        const sites = await siteRepository.list();
        const index = sites.findIndex(site => site.id === siteId);
        if (index === -1) {
          throw serviceError("SITE_NOT_FOUND");
        }
        if (sites[index].enabled === enabled) {
          return copy(sites[index]);
        }

        const at = clock.now();
        const updatedSite = { ...sites[index], enabled };
        const nextSites = sites.map((site, siteIndex) => (
          siteIndex === index ? updatedSite : site
        ));
        await siteRepository.replace(copy(nextSites));
        await synchronizeSavedSites(nextSites, at);
        return copy(updatedSite);
      });
    },

    deleteSiteHistory({ siteId }) {
      return enqueue(async () => {
        const sites = await siteRepository.list();
        const site = sites.find(candidate => candidate.id === siteId);
        if (site === undefined) {
          throw serviceError("SITE_NOT_FOUND");
        }

        try {
          await tracker.deleteSiteHistory(siteId, clock.now());
        } catch (error) {
          throw serviceError("DELETE_HISTORY_FAILED", error);
        }
        return copy(site);
      });
    },
  };
}
