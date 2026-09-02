import {
  createErrorResponse,
  createSuccessResponse,
  WEBTRACE_ADD_SITE,
  WEBTRACE_ANALYSIS_READY,
  WEBTRACE_DELETE_SITE_HISTORY,
  WEBTRACE_PAGE_VISIBILITY,
  WEBTRACE_REORDER_SITES,
} from "../shared/protocol.js";

function ignoreRejection(promise) {
  promise.catch(() => {});
  return promise;
}

const ANALYSIS_TAB_STORAGE_KEY = "webtraceAnalysisTabV1";
const analysisPageTails = new WeakMap();

function analysisTabRecord(tab) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    return null;
  }
  return { tabId: tab.id, windowId: tab.windowId };
}

async function saveAnalysisTab(chrome, tab) {
  const record = analysisTabRecord(tab);
  if (record === null) {
    return;
  }
  await chrome.storage.session.set({ [ANALYSIS_TAB_STORAGE_KEY]: record });
}

async function loadAnalysisTab(chrome) {
  const stored = await chrome.storage.session.get(ANALYSIS_TAB_STORAGE_KEY);
  const record = stored[ANALYSIS_TAB_STORAGE_KEY];
  if (!Number.isInteger(record?.tabId) || !Number.isInteger(record?.windowId)) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(record.tabId);
    return analysisTabRecord(tab) === null
      ? null
      : { ...tab, windowId: tab.windowId ?? record.windowId };
  } catch {
    await chrome.storage.session.remove(ANALYSIS_TAB_STORAGE_KEY);
    return null;
  }
}

async function clearAnalysisTab(chrome, tabId) {
  const stored = await chrome.storage.session.get(ANALYSIS_TAB_STORAGE_KEY);
  if (stored[ANALYSIS_TAB_STORAGE_KEY]?.tabId === tabId) {
    await chrome.storage.session.remove(ANALYSIS_TAB_STORAGE_KEY);
  }
}

async function runAnalysisPageOpen(chrome) {
  const url = chrome.runtime.getURL("analysis.html");
  let existing = await loadAnalysisTab(chrome);
  if (existing === null) {
    [existing] = await chrome.tabs.query({ url });
  }

  if (existing === undefined) {
    const created = await chrome.tabs.create({ url });
    await saveAnalysisTab(chrome, created);
    return;
  }

  await saveAnalysisTab(chrome, existing);

  const window = await chrome.windows.get(existing.windowId);
  if (window?.state === "minimized") {
    await chrome.windows.update(existing.windowId, { state: "normal" });
  }
  await chrome.tabs.update(existing.id, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
}

function enqueueAnalysisPageOperation(chrome, callback) {
  const previous = analysisPageTails.get(chrome) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(callback);
  analysisPageTails.set(chrome, operation);
  operation.then(
    () => {
      if (analysisPageTails.get(chrome) === operation) {
        analysisPageTails.delete(chrome);
      }
    },
    () => {
      if (analysisPageTails.get(chrome) === operation) {
        analysisPageTails.delete(chrome);
      }
    },
  );
  return operation;
}

export function openOrFocusAnalysisPage(chrome) {
  return enqueueAnalysisPageOperation(chrome, () => runAnalysisPageOpen(chrome));
}

function registerAnalysisPage(chrome, tab) {
  return enqueueAnalysisPageOperation(chrome, () => saveAnalysisTab(chrome, tab));
}

function forgetAnalysisPage(chrome, tabId) {
  return enqueueAnalysisPageOperation(chrome, () => clearAnalysisTab(chrome, tabId));
}

function stackWithoutMessage(error) {
  if (typeof error?.stack !== "string") {
    return "";
  }
  return error.stack.split("\n").slice(1).join("\n");
}

function siteCommandFor(message, siteService) {
  switch (message?.type) {
    case WEBTRACE_ADD_SITE:
      return () => siteService.addSite({
        name: message.name,
        input: message.input,
      });
    case WEBTRACE_DELETE_SITE_HISTORY:
      return () => siteService.deleteSiteHistory({
        siteId: message.siteId,
      });
    case WEBTRACE_REORDER_SITES:
      return () => siteService.reorderSites({
        siteIds: message.siteIds,
      });
    default:
      return null;
  }
}

export function registerChromeEvents({
  chrome,
  tracker,
  siteService,
  clock,
  lifecycleReady,
  reportError = () => {},
}) {
  if (
    typeof siteService?.addSite !== "function" ||
    typeof siteService?.deleteSiteHistory !== "function" ||
    typeof siteService?.reorderSites !== "function"
  ) {
    throw new TypeError("A site service is required");
  }

  const readiness = lifecycleReady ?? tracker.ready;
  let lifecycleTail = Promise.resolve();
  const reserveLifecycle = operation => {
    const result = lifecycleTail
      .then(() => readiness)
      .then(operation);
    lifecycleTail = result.catch(() => {});
    return ignoreRejection(result);
  };
  const enqueue = event => reserveLifecycle(() => tracker.dispatch(event));

  chrome.webNavigation.onCommitted.addListener(details => {
    if (
      details.frameId === 0 &&
      details.url !== chrome.runtime.getURL("analysis.html")
    ) {
      ignoreRejection(forgetAnalysisPage(chrome, details.tabId));
    }
    if (details.frameId !== 0) {
      return undefined;
    }
    const at = clock.now();
    return reserveLifecycle(async () => {
      const tab = await chrome.tabs.get(details.tabId);
      return tracker.dispatch({
        type: "NAVIGATION_COMMITTED",
        tabId: details.tabId,
        windowId: tab.windowId,
        url: details.url,
        documentId: details.documentId ?? null,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        at,
      });
    });
  });

  chrome.tabs.onCreated.addListener(tab => enqueue({
    type: "TAB_CREATED",
    tabId: tab.id,
    windowId: tab.windowId,
    openerTabId: tab.openerTabId ?? null,
    candidateUrl: tab.pendingUrl || tab.url || null,
    at: clock.now(),
  }));

  chrome.tabs.onRemoved.addListener(tabId => {
    ignoreRejection(forgetAnalysisPage(chrome, tabId));
    return enqueue({
      type: "TAB_REMOVED",
      tabId,
      at: clock.now(),
    });
  });

  chrome.tabs.onActivated.addListener(activeInfo => enqueue({
    type: "TAB_ACTIVATED",
    tabId: activeInfo.tabId,
    windowId: activeInfo.windowId,
    at: clock.now(),
  }));

  chrome.windows.onFocusChanged.addListener(windowId => enqueue({
    type: "WINDOW_FOCUSED",
    windowId: windowId === chrome.windows.WINDOW_ID_NONE || windowId === null
      ? null
      : windowId,
    at: clock.now(),
  }));

  chrome.windows.onBoundsChanged.addListener(window => enqueue({
    type: "WINDOW_STATE_CHANGED",
    windowId: window.id,
    state: window.state,
    at: clock.now(),
  }));

  chrome.windows.onRemoved.addListener(windowId => enqueue({
    type: "WINDOW_REMOVED",
    windowId,
    at: clock.now(),
  }));

  chrome.idle.onStateChanged.addListener(state => enqueue({
    type: "IDLE_STATE_CHANGED",
    state,
    at: clock.now(),
  }));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const analysisUrl = chrome.runtime.getURL("analysis.html");
    if (
      message?.type === WEBTRACE_ANALYSIS_READY &&
      sender?.url === analysisUrl &&
      Number.isInteger(sender?.tab?.id) &&
      Number.isInteger(sender?.tab?.windowId)
    ) {
      ignoreRejection(registerAnalysisPage(chrome, sender.tab));
      return false;
    }

    if (
      message?.type === WEBTRACE_PAGE_VISIBILITY &&
      Number.isInteger(sender?.tab?.id)
    ) {
      enqueue({
        type: "PAGE_VISIBILITY",
        tabId: sender.tab.id,
        documentId: sender.documentId ?? null,
        visible: message.visible === true,
        at: clock.now(),
      });
      return false;
    }

    const command = siteCommandFor(message, siteService);
    const extensionBaseUrl = chrome.runtime.getURL("");
    if (
      command === null ||
      typeof sender?.url !== "string" ||
      !sender.url.startsWith(extensionBaseUrl)
    ) {
      return false;
    }

    reserveLifecycle(command).then(
      data => sendResponse(createSuccessResponse(data)),
      error => {
        const response = createErrorResponse(error);
        try {
          reportError({
            code: response.error.code,
            stack: stackWithoutMessage(error),
          });
        } catch {
          // Error reporting must not suppress the command response.
        }
        sendResponse(response);
      },
    );
    return true;
  });

  chrome.action.onClicked.addListener(() => (
    reserveLifecycle(() => openOrFocusAnalysisPage(chrome))
  ));
}
