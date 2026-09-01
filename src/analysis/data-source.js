import { aggregateSevenDayReport, getSevenDayWindow } from "../domain/report.js";
import {
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
  WEBTRACE_SET_SITE_ENABLED,
} from "../shared/protocol.js";

const FALLBACK_ERROR = Object.freeze({
  code: "INTERNAL_ERROR",
  message: "操作失败，请重试",
});

export class AnalysisCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AnalysisCommandError";
    this.code = code;
  }
}

function commandError(response) {
  const code = typeof response?.error?.code === "string"
    ? response.error.code
    : FALLBACK_ERROR.code;
  const message = typeof response?.error?.message === "string"
    ? response.error.message
    : FALLBACK_ERROR.message;
  return new AnalysisCommandError(code, message);
}

export function createAnalysisDataSource({
  siteRepository,
  trackingRepository,
  clock,
  sendMessage = message => globalThis.chrome.runtime.sendMessage(message),
}) {
  if (typeof siteRepository?.list !== "function") {
    throw new TypeError("A site repository is required");
  }
  if (typeof trackingRepository?.queryVisitsForReport !== "function") {
    throw new TypeError("A tracking repository is required");
  }
  if (typeof clock?.now !== "function") {
    throw new TypeError("A clock is required");
  }
  if (typeof sendMessage !== "function") {
    throw new TypeError("A command sender is required");
  }

  async function sendCommand(message) {
    const response = await sendMessage(message);
    if (response?.ok !== true) {
      throw commandError(response);
    }
    return response.data;
  }

  return {
    listSites() {
      return siteRepository.list();
    },

    async getReport(siteId, selectedDateKey) {
      const now = clock.now();
      const window = getSevenDayWindow(now);
      const visits = await trackingRepository.queryVisitsForReport(
        siteId,
        window.startAt,
        now + 1,
      );
      return aggregateSevenDayReport(visits, { now, selectedDateKey });
    },

    addSite({ name, input }) {
      return sendCommand({ type: WEBTRACE_ADD_SITE, name, input });
    },

    setSiteEnabled(siteId, enabled) {
      return sendCommand({ type: WEBTRACE_SET_SITE_ENABLED, siteId, enabled });
    },

    deleteSiteHistory(siteId) {
      return sendCommand({ type: WEBTRACE_DELETE_SITE_HISTORY, siteId });
    },
  };
}
