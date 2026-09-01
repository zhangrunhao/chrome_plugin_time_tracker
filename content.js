const MESSAGE_TYPE = "WEBTRACE_PAGE_VISIBILITY";
const CONFIRMATION_INTERVAL_MS = 4_000;

let timerId = null;

function reportVisibility(visible) {
  try {
    const pending = chrome.runtime.sendMessage({ type: MESSAGE_TYPE, visible });
    if (typeof pending?.catch === "function") {
      pending.catch(() => {});
    }
  } catch {
    // The extension worker may be unavailable while a page is unloading.
  }
}

function clearReporter() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function restartReporter() {
  clearReporter();
  const visible = !document.hidden;
  reportVisibility(visible);
  if (visible) {
    timerId = setInterval(() => {
      if (!document.hidden) {
        reportVisibility(true);
      }
    }, CONFIRMATION_INTERVAL_MS);
  }
}

document.addEventListener("visibilitychange", restartReporter);
window.addEventListener("pagehide", () => {
  clearReporter();
  reportVisibility(false);
});
window.addEventListener("pageshow", event => {
  if (event.persisted) {
    restartReporter();
  }
});

restartReporter();
