import {
  getRollingDateRange,
  localDateKey,
} from "../domain/local-date-range.js";

const FALLBACK_ERROR = Object.freeze({
  code: "INTERNAL_ERROR",
  message: "操作失败，请重试",
});

function copy(value) {
  return structuredClone(value);
}

function publicError(error) {
  const hasStableEnvelope = typeof error?.code === "string"
    && typeof error?.message === "string"
    && error.message !== "";
  if (!hasStableEnvelope) {
    return { ...FALLBACK_ERROR };
  }
  return {
    code: error.code,
    message: error.message,
  };
}

function defaultScheduler() {
  return {
    setInterval(callback, delay) {
      return globalThis.setInterval(callback, delay);
    },
    clearInterval(handle) {
      globalThis.clearInterval(handle);
    },
  };
}

function defaultVisibility() {
  const page = globalThis.document;
  if (page === undefined) {
    return {
      isVisible: () => true,
      subscribe: () => () => {},
    };
  }
  return {
    isVisible: () => page.visibilityState === "visible",
    subscribe(listener) {
      page.addEventListener("visibilitychange", listener);
      return () => page.removeEventListener("visibilitychange", listener);
    },
  };
}

export function createAnalysisController({
  dataSource,
  view,
  clock,
  scheduler = defaultScheduler(),
  visibility = defaultVisibility(),
}) {
  if (
    typeof dataSource?.listSites !== "function" ||
    typeof dataSource?.getReport !== "function"
  ) {
    throw new TypeError("An analysis data source is required");
  }
  if (typeof view?.render !== "function") {
    throw new TypeError("An analysis view is required");
  }
  if (typeof clock?.now !== "function") {
    throw new TypeError("A clock is required");
  }

  const initialNow = clock.now();
  const initialTodayDateKey = localDateKey(initialNow);
  const initialRange = getRollingDateRange(initialNow);
  const state = {
    mode: "LOADING",
    sites: [],
    selectedSiteId: null,
    todayDateKey: initialTodayDateKey,
    selectedDateKey: initialRange.endDateKey,
    report: null,
    error: null,
    pending: false,
    deleteConfirmationSiteId: null,
  };
  let refreshPromise = null;
  let refreshPending = false;
  let preferredSiteId = null;
  let stopAutoRefresh = null;

  function render() {
    view.render(copy(state));
  }

  function beginUserAction() {
    state.error = null;
  }

  function updateDateState() {
    const now = clock.now();
    state.todayDateKey = localDateKey(now);
    return getRollingDateRange(now);
  }

  async function loadReport() {
    if (state.selectedSiteId === null) {
      state.report = null;
      return;
    }
    const range = updateDateState();
    state.report = await dataSource.getReport(state.selectedSiteId, {
      ...range,
      selectedDateKey: state.selectedDateKey,
    });
  }

  async function loadOnce(nextPreferredSiteId) {
    updateDateState();
    const previousSiteId = state.selectedSiteId;
    const sites = await dataSource.listSites();
    state.sites = sites;

    if (sites.length === 0) {
      state.mode = "NO_SITES";
      state.selectedSiteId = null;
      state.report = null;
      state.deleteConfirmationSiteId = null;
      render();
      return;
    }

    const requestedSiteId = nextPreferredSiteId ?? previousSiteId;
    const selectedSite = sites.find(site => site.id === requestedSiteId) ?? sites[0];
    state.selectedSiteId = selectedSite.id;

    await loadReport();
    const availableDates = new Set(state.report.days.map(day => day.dateKey));
    if (!availableDates.has(state.selectedDateKey)) {
      state.selectedDateKey = availableDates.has(state.report.range.endDateKey)
        ? state.report.range.endDateKey
        : state.report.days.at(-1)?.dateKey ?? null;
      await loadReport();
    }
    state.mode = "READY";
    if (!sites.some(site => site.id === state.deleteConfirmationSiteId)) {
      state.deleteConfirmationSiteId = null;
    }
    render();
  }

  function refresh({ selectSiteId = null } = {}) {
    if (selectSiteId !== null) {
      preferredSiteId = selectSiteId;
    }
    if (refreshPromise !== null) {
      refreshPending = true;
      return refreshPromise;
    }

    refreshPromise = (async () => {
      do {
        refreshPending = false;
        const nextPreferredSiteId = preferredSiteId;
        preferredSiteId = null;
        try {
          await loadOnce(nextPreferredSiteId);
        } catch (error) {
          if (state.error === null) {
            state.error = publicError(error);
          }
          render();
        }
      } while (refreshPending);
    })().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  function selectSite(siteId) {
    beginUserAction();
    if (!state.sites.some(site => site.id === siteId)) {
      render();
      return Promise.resolve();
    }
    state.selectedSiteId = siteId;
    render();
    return refresh({ selectSiteId: siteId });
  }

  function selectDate(dateKey) {
    beginUserAction();
    if (!state.report?.days.some(day => day.dateKey === dateKey)) {
      render();
      return Promise.resolve();
    }
    state.selectedDateKey = dateKey;
    render();
    return refresh();
  }

  async function mutate(operation, affectedSiteId) {
    beginUserAction();
    state.pending = true;
    render();
    try {
      const result = await operation();
      const siteId = affectedSiteId ?? result?.id ?? null;
      state.deleteConfirmationSiteId = null;
      await refresh({ selectSiteId: siteId });
      return result;
    } catch (error) {
      state.error = publicError(error);
      return null;
    } finally {
      state.pending = false;
      render();
    }
  }

  const controller = {
    initialize() {
      render();
      return refresh();
    },

    refresh,
    selectSite,
    selectDate,

    addSite(input) {
      return mutate(() => dataSource.addSite(input), null);
    },

    async reorderSites(siteIds) {
      beginUserAction();
      const previousSites = state.sites;
      const sitesById = new Map(previousSites.map(site => [site.id, site]));
      state.sites = siteIds.map(siteId => sitesById.get(siteId));
      state.pending = true;
      render();
      try {
        const result = await dataSource.reorderSites(siteIds);
        await refresh({ selectSiteId: state.selectedSiteId });
        return result;
      } catch (error) {
        state.sites = previousSites;
        state.error = publicError(error);
        await refresh({ selectSiteId: state.selectedSiteId });
        return null;
      } finally {
        state.pending = false;
        render();
      }
    },

    requestDeleteHistory(siteId) {
      beginUserAction();
      state.deleteConfirmationSiteId = state.sites.some(site => site.id === siteId)
        ? siteId
        : null;
      render();
    },

    cancelDeleteHistory() {
      beginUserAction();
      state.deleteConfirmationSiteId = null;
      render();
    },

    confirmDeleteHistory() {
      beginUserAction();
      const siteId = state.deleteConfirmationSiteId;
      if (siteId === null) {
        render();
        return Promise.resolve(null);
      }
      return mutate(() => dataSource.deleteSiteHistory(siteId), siteId);
    },

    startAutoRefresh() {
      if (stopAutoRefresh !== null) {
        return stopAutoRefresh;
      }
      const interval = scheduler.setInterval(() => (
        visibility.isVisible() ? refresh() : Promise.resolve()
      ), 4_000);
      const unsubscribe = visibility.subscribe(() => {
        if (visibility.isVisible()) {
          void refresh();
        }
      });
      stopAutoRefresh = () => {
        scheduler.clearInterval(interval);
        unsubscribe();
        stopAutoRefresh = null;
      };
      return stopAutoRefresh;
    },
  };

  return controller;
}
