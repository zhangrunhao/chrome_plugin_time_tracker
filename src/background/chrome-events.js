import { WEBTRACE_PAGE_VISIBILITY } from "../shared/protocol.js";

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

export async function openOrFocusAnalysisPage(chrome) {
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

export function registerChromeEvents({ chrome, tracker, siteService: _siteService, clock }) {
  const enqueue = event => ignoreRejection(
    Promise.resolve(tracker.ready).then(() => tracker.dispatch(event)),
  );

  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0 || !isHttpUrl(details.url)) {
      return undefined;
    }
    const at = clock.now();
    return ignoreRejection(
      chrome.tabs.get(details.tabId).then(tab => enqueue({
        type: "NAVIGATION_COMMITTED",
        tabId: details.tabId,
        windowId: tab.windowId,
        url: details.url,
        documentId: details.documentId ?? null,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        at,
      })),
    );
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

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      message?.type !== WEBTRACE_PAGE_VISIBILITY ||
      !Number.isInteger(sender?.tab?.id)
    ) {
      return false;
    }

    enqueue({
      type: "PAGE_VISIBILITY",
      tabId: sender.tab.id,
      documentId: sender.documentId ?? null,
      visible: message.visible === true,
      at: clock.now(),
    });
    return false;
  });

  chrome.action.onClicked.addListener(() => ignoreRejection(openOrFocusAnalysisPage(chrome)));
}
