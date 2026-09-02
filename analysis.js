import { createAnalysisController } from "./src/analysis/controller.js";
import { createAnalysisDataSource } from "./src/analysis/data-source.js";
import { createAnalysisView } from "./src/analysis/view.js";
import { WEBTRACE_ANALYSIS_READY } from "./src/shared/protocol.js";
import { createSiteRepository } from "./src/storage/site-repository.js";
import { createTrackingRepository } from "./src/storage/tracking-repository.js";
import { openWebTraceDb } from "./src/storage/webtrace-db.js";

const clock = { now: () => Date.now() };
const view = createAnalysisView({ document });
const registration = chrome.runtime.sendMessage({ type: WEBTRACE_ANALYSIS_READY });
if (typeof registration?.catch === "function") {
  registration.catch(() => {});
}

try {
  const database = await openWebTraceDb(globalThis.indexedDB);
  const dataSource = createAnalysisDataSource({
    siteRepository: createSiteRepository(chrome.storage.local),
    trackingRepository: createTrackingRepository(database),
    clock,
  });
  const controller = createAnalysisController({ dataSource, view, clock });
  view.bind(controller);
  await controller.initialize();
  controller.startAutoRefresh();
} catch {
  view.render({
    mode: "NO_SITES",
    sites: [],
    selectedSiteId: null,
    todayDateKey: null,
    appliedRange: null,
    selectedDateKey: null,
    report: null,
    error: { code: "INTERNAL_ERROR", message: "分析页加载失败，请重试" },
    rangeError: null,
    pending: false,
    deleteConfirmationSiteId: null,
  });
}
