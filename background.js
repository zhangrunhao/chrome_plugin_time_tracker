// 简单工具：本地日期键（按用户时区）
function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 读/写 storage 的 Promise 包装
const store = {
  async get(keys) {
    return await chrome.storage.local.get(keys);
  },
  async set(obj) {
    return await chrome.storage.local.set(obj);
  },
};

// 处理 content 的心跳/汇报
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "TIMETRACKER_TICK") {
      const { domain, deltaSec } = msg; // deltaSec 本次新增秒数
      if (!domain || !deltaSec) return sendResponse({ ok: false });

      const today = dateKey();
      const data = (await store.get(["stats"]))?.stats || {};
      data[today] ??= {};
      data[today][domain] = (data[today][domain] || 0) + deltaSec;

      await store.set({ stats: data });

      sendResponse({
        ok: true,
        today,
        totalSecForDomainToday: data[today][domain],
      });
    }
  })();

  // 异步响应
  return true;
});
