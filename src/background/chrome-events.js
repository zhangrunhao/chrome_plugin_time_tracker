import {
  createErrorResponse,
  createSuccessResponse,
  WEBTRACE_ADD_SITE,
  WEBTRACE_DELETE_SITE_HISTORY,
  WEBTRACE_PAGE_VISIBILITY,
  WEBTRACE_SET_SITE_ENABLED,
} from "../shared/protocol.js";

function isHttpUrl(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function ignoreRejection(promise) {
  promise.catch(() => {});
  return promise;
}

const analysisPageTails = new WeakMap();

async function runAnalysisPageOpen(chrome) {
  const url = chrome.runtime.getURL("analysis.html");
  const [existing] = await chrome.tabs.query({ url });

  if (existing === undefined) {
    await chrome.tabs.create({ url });
    return;
  }

  const window = await chrome.windows.get(existing.windowId);
  if (window?.state === "minimized") {
    await chrome.windows.update(existing.windowId, { state: "normal" });
  }
  await chrome.tabs.update(existing.id, { active: true });
  await chrome.windows.update(existing.windowId, { focused: true });
}

export function openOrFocusAnalysisPage(chrome) {
  const previous = analysisPageTails.get(chrome) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => runAnalysisPageOpen(chrome));
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

function stackWithoutMessage(error) {
  if (typeof error?.stack !== "string") {
    return "";
  }
  return error.stack.split("\n").slice(1).join("\n");
}

export function registerChromeEvents({
  chrome,
  tracker,
  siteService,
  clock,
  reportError = () => {},
}) {
  if (
    typeof siteService?.addSite !== "function" ||
    typeof siteService?.setSiteEnabled !== "function" ||
    typeof siteService?.deleteSiteHistory !== "function"
  ) {
    throw new TypeError("A site service is required");
  }

  let lifecycleTail = Promise.resolve();
  const reserveLifecycle = operation => {
    const result = lifecycleTail
      .then(() => tracker.ready)
      .then(operation);
    lifecycleTail = result.catch(() => {});
    return ignoreRejection(result);
  };
  const enqueue = event => reserveLifecycle(() => tracker.dispatch(event));

  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0 || !isHttpUrl(details.url)) {
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

  chrome.tabs.onRemoved.addListener(tabId => enqueue({
    type: "TAB_REMOVED",
    tabId,
    at: clock.now(),
  }));

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

    const command = {
      [WEBTRACE_ADD_SITE]: () => siteService.addSite({
        name: message.name,
        input: message.input,
      }),
      [WEBTRACE_SET_SITE_ENABLED]: () => siteService.setSiteEnabled({
        siteId: message.siteId,
        enabled: message.enabled,
      }),
      [WEBTRACE_DELETE_SITE_HISTORY]: () => siteService.deleteSiteHistory({
        siteId: message.siteId,
      }),
    }[message?.type];
    const extensionBaseUrl = chrome.runtime.getURL("");
    if (
      command === undefined ||
      typeof sender?.url !== "string" ||
      !sender.url.startsWith(extensionBaseUrl)
    ) {
      return false;
    }

    Promise.resolve()
      .then(command)
      .then(
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

  chrome.action.onClicked.addListener(() => ignoreRejection(openOrFocusAnalysisPage(chrome)));
}
