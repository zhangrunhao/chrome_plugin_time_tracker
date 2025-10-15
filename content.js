// ====== 可配置（v1.1 会做成可编辑）======
const WHITELIST = []; 
// 空数组=全部网站统计；想先只测知乎/B站：["zhihu.com","bilibili.com"]

// ====== 域名与白名单判断 ======
const hostname = location.hostname;
const domain = hostname; // v1.2 可做主域合并（如 m.xx.com -> xx.com）
const inWhitelist = WHITELIST.length === 0 || WHITELIST.some(d => domain.endsWith(d));

// ====== 浮窗 ======
const box = document.createElement("div");
box.id = "timetracker-badge";
box.textContent = "00:00:00";
document.documentElement.appendChild(box);

// ====== 计时器（仅在可见时累加）======
let visible = !document.hidden;
let lastTick = null;
let accMs = 0; // 本次前端累计（用于更丝滑地更新 UI）

function fmt(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function onVisibilityChange() {
  visible = !document.hidden;
  if (visible) lastTick = performance.now();
  else lastTick = null;
}
document.addEventListener("visibilitychange", onVisibilityChange);

// 有些站点用 iframe/单页应用，保持简单：1s 心跳
const interval = setInterval(async () => {
  if (!inWhitelist) return;
  if (!visible) return;

  const now = performance.now();
  if (lastTick == null) { lastTick = now; return; }

  const deltaSec = Math.max(0, Math.round((now - lastTick) / 1000));
  if (deltaSec <= 0) return;
  lastTick = now;
  accMs += deltaSec * 1000;

  // 通知后台累加“今天-当前域名”的秒数
  try {
    const res = await chrome.runtime.sendMessage({
      type: "TIMETRACKER_TICK",
      domain,
      deltaSec
    });
    if (res?.ok) {
      // 用后台返回的“今日总秒数”渲染，防止多标签误差
      box.textContent = fmt(res.totalSecForDomainToday);
    }
  } catch (e) {
    // 忽略处理，避免控制台噪音
  }
}, 1000);

// 页面卸载清理
window.addEventListener("unload", () => clearInterval(interval));
