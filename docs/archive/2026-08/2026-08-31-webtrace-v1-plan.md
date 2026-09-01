# WebTrace V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 TimeTracker 单站浮窗计时器替换为 WebTrace V1：用户可配置多个网站，并在本地分析页查看最近 7 天的有效打开、有效观看时长和逐次访问明细。

**Architecture:** 将域名归一化、访问时段、打开状态机和 7 天聚合实现为不依赖 Chrome API 的 ES 模块；后台服务工作线程把 Chrome 导航、标签页、窗口、锁屏和页面可见性事件串行转换为领域事件，并通过 IndexedDB 事务持久化访问记录。分析页直接读取本地配置与访问记录、现场聚合报表；配置变更和删除历史通过后台命令执行，避免分析页直接修改进行中的访问状态。

**Tech Stack:** Chrome Manifest V3、原生 ES modules、Chrome `webNavigation`/`tabs`/`windows`/`idle`/`storage` API、IndexedDB、原生 HTML/CSS、Node.js 内置测试运行器、`fake-indexeddb@6.2.5`、随扩展打包的 `tldts@7.4.11` ESM bundle。

**Spec:** [归档规格：`2026-08-31-webtrace-v1-spec.md`](./2026-08-31-webtrace-v1-spec.md)

**Status:** 已完成（2026-09-01）

## Global Constraints

- 目标平台是 Chrome Manifest V3 扩展。
- 首版只接受 HTTP/HTTPS 网站，不统计浏览器内部页面和扩展页面。
- 用户配置的可注册主域名匹配其全部子域名，但不能匹配仅字符串后缀相同的其他域名。
- 每次符合规格定义的有效打开只生成一条 `Visit`；刷新、站内跳转和同站新标签页继承不得增加打开次数。
- 只有活动标签页、前台且未最小化的 Chrome 窗口、可见页面和未锁屏同时成立时才累计时长；普通无输入状态继续计时。
- 任一时刻最多只有一个未结束的 `ActiveInterval`。
- `Visit.activeIntervals` 是打开次数、逐次明细和时长统计的唯一事实来源，不写日汇总缓存。
- 趋势固定为今天和前 6 天；打开次数按 `openedAt` 的本地日期归属，时长按本机日历午夜拆分。
- 异常退出误差目标不超过 5 秒，只允许少计，不能累计浏览器关闭后的时间。
- 配置和记录只保存在扩展本机空间，不发送网络请求，不加载远程可执行代码。
- 访问记录默认长期保留；只有用户确认删除某个网站历史或卸载扩展时清除。
- 停用网站只停止未来采集，历史仍可查看；删除历史不删除网站配置。
- 新增或重新启用网站时不追溯当前已打开页面，必须等下一次符合定义的有效打开。
- 分析页不提供自定义时间范围、历史周翻页、跨网站汇总、导入、导出、分享、提醒、限制、登录或同步。
- 网页中不得保留浮窗或其他可见的内容脚本 UI。

## Implementation Baselines

- 外部依赖版本最后核验于 2026-08-31：`tldts@7.4.11`（MIT，完整公共后缀规则随 bundle 打包）和 `fake-indexeddb@6.2.5`（仅开发测试）。
- 运行时代码不依赖 `node_modules`；`scripts/vendor-tldts.mjs` 从锁定依赖复制 ESM bundle 与许可证到 `vendor/tldts/`，复制结果提交到仓库。
- 使用 `new URL()` 验证并提取 hostname，再调用 `tldts.parse(hostname, { allowPrivateDomains: true, extractHostname: false, detectSpecialUse: true })`；只有 `domain` 存在且 `isIcann === true || isPrivate === true` 时才接受。这样既拒绝未知/特殊用途后缀，又不会把私有后缀（例如 `github.io`）的不同租户合并到同一个网站。
- `chrome.storage.local` 保留现有 `stats` 键但 V1 不再读取或写入它；旧日汇总无法无损还原为逐次访问，因此本 Change 不自动迁移或删除旧数据。
- `Site`、`Visit`、runtime checkpoint 和 session 镜像都不保存完整 URL、路径、查询参数或标题；导航 URL 只在单次事件匹配时存在于内存，持久运行时仅保存匹配后的 `currentSiteId`。
- 后台初始化时把 `chrome.storage.local` 和 `chrome.storage.session` 的访问级别设置为 `TRUSTED_CONTEXTS`；静默内容脚本只发送可见性消息，不能直接读取站点配置或 runtime 镜像。
- `chrome.storage.session` 需要 Chrome 102，因此 `manifest.json` 写入 `"minimum_chrome_version": "102"`。
- 为满足“直到用户删除或卸载”的长期保留契约，请求 `unlimitedStorage`，使扩展 IndexedDB 不受普通配额和存储压力清理；这是唯一超出现有权限的持久化权限，不得用于缓存网页内容。
- 使用 `chrome.tabs` 的创建、查询、激活和事件 API，但不申请 `tabs` 权限；`http://*/*` 与 `https://*/*` 主机权限已经允许读取范围内 URL，浏览器内部页一律映射为未配置网站。
- 内容脚本每 4 秒发送一次可见页面确认；所有消息时间都由后台 `Date.now()` 产生，不信任网页侧时间戳。
- IndexedDB 中的访问记录和带浏览器会话 ID 的运行时 checkpoint 在同一事务提交；标签页映射同时镜像到 `chrome.storage.session`。浏览器新会话没有 session ID 时忽略旧 checkpoint、在 `lastConfirmedAt` 截断旧记录，再为实际恢复出的目标页面创建新记录。
- 对 IndexedDB 的权威提交最多尝试 3 次，间隔 50 ms 和 150 ms；三次都失败时记录结构化错误且不替换内存中的已提交状态。session 镜像失败时标记为待修复，并在下一事件或服务工作线程恢复时用同会话 checkpoint 修复。

## Data Contracts and Shared Interfaces

实现任务必须使用以下字段名，后续任务不得另起同义接口：

```js
/** @typedef {{ id: string, name: string, domain: string, enabled: boolean, createdAt: number }} Site */
/** @typedef {{ startedAt: number, endedAt: number|null }} ActiveInterval */
/**
 * @typedef {{
 *   id: string,
 *   siteId: string,
 *   openedAt: number,
 *   endedAt: number|null,
 *   activeIntervals: ActiveInterval[],
 *   lastConfirmedAt: number,
 *   lastActivityAt: number
 * }} Visit
 */
/**
 * @typedef {{
 *   tabId: number,
 *   windowId: number,
 *   openerTabId: number|null,
 *   documentId: string|null,
 *   currentSiteId: string|null,
 *   visitId: string|null,
 *   pendingInheritance: boolean,
 *   visible: boolean
 * }} TabRuntime
 */
/**
 * @typedef {{
 *   version: 1,
 *   sessionId: string,
 *   revision: number,
 *   tabs: Record<string, TabRuntime>,
 *   activeTabByWindow: Record<string, number>,
 *   windowStateById: Record<string, 'normal'|'minimized'|'maximized'|'fullscreen'>,
 *   focusedWindowId: number|null,
 *   locked: boolean,
 *   activeVisitId: string|null,
 *   lastEventAt: number
 * }} RuntimeState
 */
```

领域状态机统一输出以下 effect；后台协调器按数组顺序在一个权威事务中应用：

```js
{ type: "CREATE_VISIT", visit }
{ type: "START_INTERVAL", visitId, at }
{ type: "CONFIRM_INTERVAL", visitId, at }
{ type: "PAUSE_INTERVAL", visitId, at }
{ type: "END_VISIT", visitId, at }
{ type: "DELETE_SITE_VISITS", siteId }
```

分析页与后台统一使用以下消息返回格式：

```js
{ ok: true, data }
{ ok: false, error: { code, message } }
```

## File Map

| Path | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Node 内置测试命令和锁定的开发依赖；不增加扩展构建步骤。 |
| `.gitignore` | 忽略本地 `node_modules/`，不忽略已提交的 vendor bundle。 |
| `scripts/vendor-tldts.mjs` | 可重复地复制锁定的离线域名解析 bundle 与许可证。 |
| `vendor/tldts/index.esm.min.js`, `vendor/tldts/LICENSE` | 扩展运行时使用的公共后缀规则实现和许可证。 |
| `src/domain/site-domain.js` | 输入 URL 校验、已知公共后缀下的可注册主域名归一化和精确子域名匹配。 |
| `src/domain/visit-time.js` | `Visit` 创建、开始、确认、暂停、结束、异常截断和总时长。 |
| `src/domain/report.js` | 本地日期边界、跨午夜拆分和最近 7 天报表。 |
| `src/domain/runtime-machine.js` | 打开状态机、标签页关联和全局唯一活动访问判定。 |
| `src/storage/webtrace-db.js` | IndexedDB `webtrace` v1 schema 和事务辅助函数。 |
| `src/storage/tracking-repository.js` | 访问记录、runtime checkpoint、范围并集查询和按站删除。 |
| `src/storage/site-repository.js` | `chrome.storage.local` 中 `webtraceSitesV1` 的配置读写。 |
| `src/storage/session-repository.js` | `chrome.storage.session` 中 `webtraceRuntimeV1` 的会话镜像。 |
| `src/shared/protocol.js` | 后台与分析页命令名、错误码和响应构造器。 |
| `src/background/tracker.js` | 串行事件队列、effect 应用、事务、重试和恢复。 |
| `src/background/site-service.js` | 添加、停用、恢复和删除历史的应用服务。 |
| `src/background/chrome-events.js` | 同步注册 Chrome 事件并把事件转换为 tracker 调用。 |
| `background.js` | 创建仓储、tracker、site service 并启动事件桥接。 |
| `content.js` | 无 UI 的页面可见性变化和 4 秒存活确认。 |
| `analysis.html`, `analysis.css`, `analysis.js` | 分析页文档、样式和 composition root。 |
| `src/analysis/data-source.js` | 读取站点、查询访问记录、构造报表和发送配置命令。 |
| `src/analysis/controller.js` | 选中网站/日期、刷新、错误与操作状态。 |
| `src/analysis/view.js` | 网站列表、两个独立趋势图、合计、明细和管理界面渲染。 |
| `tests/*.test.js`, `tests/helpers/*.js` | 领域、存储、协调器、配置服务和静态 manifest 自动测试。 |
| `content.css` | 删除；V1 不再向网页注入可见组件。 |

---

### Task 1: Establish the test harness and offline registrable-domain boundary

**Files:**
- Modify: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `scripts/vendor-tldts.mjs`
- Create: `vendor/tldts/index.esm.min.js`
- Create: `vendor/tldts/LICENSE`
- Create: `src/domain/site-domain.js`
- Create: `tests/site-domain.test.js`

**Interfaces:**
- Consumes: browser-standard `URL`; vendored `parse()` from `vendor/tldts/index.esm.min.js`.
- Produces: `SiteInputError`, `normalizeSiteInput(input)`, `hostnameMatchesDomain(hostname, domain)`, `matchSiteUrl(url, sites, options)`.

- [ ] **Step 1: Write the failing domain tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  SiteInputError,
  normalizeSiteInput,
  hostnameMatchesDomain,
  matchSiteUrl,
} from "../src/domain/site-domain.js";

test("normalizes URLs and private-suffix tenants to registrable domains", () => {
  assert.deepEqual(normalizeSiteInput("https://www.zhihu.com/question/1?x=1"), {
    domain: "zhihu.com",
    normalizedUrl: "https://www.zhihu.com/question/1?x=1",
  });
  assert.equal(normalizeSiteInput("zhuanlan.zhihu.com:443/a").domain, "zhihu.com");
  assert.equal(normalizeSiteInput("https://team.github.io/docs").domain, "team.github.io");
  assert.equal(normalizeSiteInput("https://食狮.com.cn/").domain, "xn--85x722f.com.cn");
});

test("rejects unsupported and non-registrable inputs with stable codes", () => {
  for (const [input, code] of [
    ["", "INVALID_URL"],
    ["chrome://extensions", "UNSUPPORTED_PROTOCOL"],
    ["ftp://example.com/file", "UNSUPPORTED_PROTOCOL"],
    ["http://localhost:3000", "UNREGISTRABLE_DOMAIN"],
    ["https://127.0.0.1", "UNREGISTRABLE_DOMAIN"],
    ["https://com", "UNREGISTRABLE_DOMAIN"],
    ["https://example.unknown", "UNREGISTRABLE_DOMAIN"],
  ]) {
    assert.throws(
      () => normalizeSiteInput(input),
      error => error instanceof SiteInputError && error.code === code,
    );
  }
});

test("matches exact domains and subdomains without suffix spoofing", () => {
  const sites = [{ id: "zhihu", domain: "zhihu.com", enabled: true }];
  assert.equal(hostnameMatchesDomain("www.zhihu.com", "zhihu.com"), true);
  assert.equal(hostnameMatchesDomain("fakezhihu.com", "zhihu.com"), false);
  assert.equal(matchSiteUrl("https://zhuanlan.zhihu.com/p/1", sites).id, "zhihu");
  assert.equal(matchSiteUrl("https://fakezhihu.com", sites), null);
  assert.equal(matchSiteUrl("chrome://extensions", sites), null);
  assert.equal(matchSiteUrl("https://zhihu.com", sites, { enabledOnly: true }).id, "zhihu");
  assert.equal(
    matchSiteUrl("https://zhihu.com", [{ ...sites[0], enabled: false }], { enabledOnly: true }),
    null,
  );
});
```

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `node --test tests/site-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/domain/site-domain.js`.

- [ ] **Step 3: Add the dependency lock and reproducible vendor script**

`package.json` must contain exactly these scripts and dependency roles:

```json
{
  "name": "webtrace-extension",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "vendor:tldts": "node scripts/vendor-tldts.mjs"
  },
  "devDependencies": {
    "fake-indexeddb": "6.2.5",
    "tldts": "7.4.11"
  }
}
```

`scripts/vendor-tldts.mjs` must copy, never download at extension runtime:

```js
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("vendor/tldts", { recursive: true });
await Promise.all([
  copyFile("node_modules/tldts/dist/index.esm.min.js", "vendor/tldts/index.esm.min.js"),
  copyFile("node_modules/tldts/LICENSE", "vendor/tldts/LICENSE"),
]);
```

Add `/node_modules/` to `.gitignore`, then run: `npm install && npm run vendor:tldts`

Expected: `package-lock.json`, the vendored ESM file, and the MIT license are present; the extension still has no build command.

- [ ] **Step 4: Implement strict URL parsing and matching**

`normalizeSiteInput()` must trim input, prepend `https://` only when no URI scheme exists, reject all non-HTTP(S) schemes, parse through `new URL()`, and return the platform-normalized URL plus the registrable domain. `matchSiteUrl()` must parse the candidate URL once and compare `hostname === domain || hostname.endsWith('.' + domain)`; it must not use bare `endsWith(domain)`.

```js
import { parse } from "../../vendor/tldts/index.esm.min.js";

export class SiteInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SiteInputError";
    this.code = code;
  }
}

export function hostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`);
}
```

After `new URL()` extracts the hostname, accept only a parse result whose `domain` is non-null, `isSpecialUse !== true`, and either `isIcann === true` or `isPrivate === true`. Use these exact error codes: `INVALID_URL`, `UNSUPPORTED_PROTOCOL`, `UNREGISTRABLE_DOMAIN`.

- [ ] **Step 5: Run the focused and full tests**

Run: `node --test tests/site-domain.test.js && npm test`

Expected: all domain tests PASS; `npm test` exits 0.

- [ ] **Step 6: Commit the independent domain boundary**

```bash
git add .gitignore package.json package-lock.json scripts/vendor-tldts.mjs vendor/tldts src/domain/site-domain.js tests/site-domain.test.js
git commit -m "feat: 添加离线域名归一化基础"
```

### Task 2: Implement visit timing and seven-day aggregation

**Files:**
- Create: `src/domain/visit-time.js`
- Create: `src/domain/report.js`
- Create: `tests/visit-time.test.js`
- Create: `tests/report.test.js`

**Interfaces:**
- Consumes: the `Visit` and `ActiveInterval` contracts from this plan.
- Produces: `createVisit`, `startInterval`, `confirmInterval`, `pauseInterval`, `endVisit`, `recoverVisitAfterBrowserExit`, `getVisitDurationMs`, `localDateKey`, `getSevenDayWindow`, `splitIntervalByLocalDay`, `aggregateSevenDayReport`.

- [ ] **Step 1: Write failing tests for conservative intervals**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createVisit,
  startInterval,
  confirmInterval,
  pauseInterval,
  endVisit,
  recoverVisitAfterBrowserExit,
  getVisitDurationMs,
} from "../src/domain/visit-time.js";

test("is idempotent and counts an open interval only through confirmation", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = startInterval(visit, 2_000);
  visit = startInterval(visit, 2_100);
  visit = confirmInterval(visit, 6_000);
  assert.equal(visit.activeIntervals.length, 1);
  assert.equal(getVisitDurationMs(visit, { asOf: 20_000 }), 4_000);
  visit = pauseInterval(visit, 7_000);
  visit = pauseInterval(visit, 8_000);
  assert.equal(getVisitDurationMs(visit, { asOf: 20_000 }), 5_000);
});

test("crash recovery closes at last confirmation and never at restart time", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = confirmInterval(startInterval(visit, 2_000), 6_000);
  visit = recoverVisitAfterBrowserExit(visit);
  assert.equal(visit.activeIntervals[0].endedAt, 6_000);
  assert.equal(visit.endedAt, 6_000);
  assert.equal(getVisitDurationMs(visit, { asOf: 99_000 }), 4_000);
});

test("trusted pause and end events close once without overlapping intervals", () => {
  let visit = createVisit({ id: "v1", siteId: "s1", openedAt: 1_000 });
  visit = pauseInterval(startInterval(visit, 2_000), 5_000);
  visit = startInterval(visit, 7_000);
  visit = endVisit(visit, 9_000);
  assert.deepEqual(visit.activeIntervals, [
    { startedAt: 2_000, endedAt: 5_000 },
    { startedAt: 7_000, endedAt: 9_000 },
  ]);
  assert.equal(visit.endedAt, 9_000);
});
```

Use `new Date(year, monthIndex, day, hour, minute, second).getTime()` in date tests so assertions exercise whatever local timezone runs Chrome and Node.

- [ ] **Step 2: Write failing report tests for midnight, totals, union semantics, and detail ownership**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSevenDayReport, localDateKey } from "../src/domain/report.js";

test("splits duration at local midnight but keeps the open on openedAt day", () => {
  const openedAt = new Date(2026, 7, 30, 23, 59, 50).getTime();
  const endedAt = new Date(2026, 7, 31, 0, 0, 10).getTime();
  const visit = {
    id: "v1",
    siteId: "s1",
    openedAt,
    endedAt,
    activeIntervals: [{ startedAt: openedAt, endedAt }],
    lastConfirmedAt: endedAt,
    lastActivityAt: endedAt,
  };
  const report = aggregateSevenDayReport([visit], {
    now: new Date(2026, 7, 31, 12).getTime(),
    selectedDateKey: localDateKey(openedAt),
  });
  const first = report.days.find(day => day.dateKey === localDateKey(openedAt));
  const second = report.days.find(day => day.dateKey === localDateKey(endedAt));
  assert.deepEqual([first.openCount, first.activeMs], [1, 10_000]);
  assert.deepEqual([second.openCount, second.activeMs], [0, 10_000]);
  assert.equal(report.details[0].durationMs, 20_000);
});

test("returns seven ordered zero-filled days and newest-first selected-day details", () => {
  const now = new Date(2026, 7, 31, 12).getTime();
  const report = aggregateSevenDayReport([], {
    now,
    selectedDateKey: localDateKey(now),
  });
  assert.equal(report.days.length, 7);
  assert.deepEqual(report.totals, { openCount: 0, activeMs: 0 });
  assert.deepEqual(report.details, []);
  assert.ok(report.days.every(day => day.openCount === 0 && day.activeMs === 0));
});
```

Add a third fixture whose `openedAt` is before the 7-day window but whose interval crosses into the first day; assert `openCount === 0` and the overlapping duration is present.

- [ ] **Step 3: Run both tests and confirm imports fail**

Run: `node --test tests/visit-time.test.js tests/report.test.js`

Expected: FAIL with missing `visit-time.js` and `report.js` modules.

- [ ] **Step 4: Implement immutable visit transitions**

Every exported transition must return a new visit object and must clamp `at` to at least the previous `lastActivityAt`. `confirmInterval()` only changes a visit when its last interval is open. `startInterval()` does nothing when already open or when `endedAt` is non-null. `pauseInterval()` and `endVisit()` close an open interval at `max(startedAt, at)`.

`recoverVisitAfterBrowserExit()` must use `lastConfirmedAt` for both the final interval end and `endedAt`, never the recovery wall-clock time.

- [ ] **Step 5: Implement local-calendar aggregation**

`splitIntervalByLocalDay(startedAt, endedAt)` must advance with `new Date(y, m, d + 1).getTime()` rather than adding 86,400,000 ms, so daylight-saving boundaries remain correct. `aggregateSevenDayReport()` must return this exact shape:

```js
{
  days: [{ dateKey, openCount, activeMs }], // oldest to newest, always 7 entries
  totals: { openCount, activeMs },
  selectedDateKey,
  details: [{ id, openedAt, endedAt, durationMs, ongoing }], // newest openedAt first
}
```

For an open interval use `Math.min(now, visit.lastConfirmedAt)` as the effective end. Details are selected only by `localDateKey(visit.openedAt)` and use the full visit duration, even when intervals fall outside the selected day.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/visit-time.test.js tests/report.test.js && npm test`

Expected: all timing and report tests PASS.

- [ ] **Step 7: Commit timing and reporting**

```bash
git add src/domain/visit-time.js src/domain/report.js tests/visit-time.test.js tests/report.test.js
git commit -m "feat: 实现访问时段与七天聚合"
```

### Task 3: Implement the pure opening and activity state machine

**Files:**
- Create: `src/domain/runtime-machine.js`
- Create: `tests/runtime-machine.test.js`
- Create: `tests/helpers/runtime-fixtures.js`

**Interfaces:**
- Consumes: `matchSiteUrl()`, `Site[]`, `RuntimeState`, and a deterministic `idFactory()` supplied by tests or background.
- Produces: `createRuntimeState({ sessionId, snapshot, sites })`, `reduceRuntimeEvent(state, event, { sites, idFactory }) -> { state, effects }`, `deriveActiveVisitId(state, sites)`.
- Test helpers: `makeRuntimeContext({ sites, ids })`, `runNavigationScenario({ fromUrl, toUrl, transitionType, transitionQualifiers })`, `runLeaveAndReturnScenario()`, `runSameSiteNavigationScenario()`, `runCrossSiteScenario()`, `stateWithTrackedTab({ tabId, siteId, visitId })`, `stateWithPendingChild({ openerVisitId, childTabId })`, and `effectsOf(result, type)`.

- [ ] **Step 1: Write the failing opening-rule table tests**

Create a fixture that starts with one focused normal window, tab 1 active, unlocked state, and deterministic IDs `v1`, `v2`, `v3`. Drive `reduceRuntimeEvent()` with top-level `NAVIGATION_COMMITTED` events and assert:

```js
const cases = [
  ["outside to target", "https://example.org", "https://www.zhihu.com/a", 1],
  ["target refresh", "https://www.zhihu.com/a", "https://www.zhihu.com/a", 0],
  ["same-site subdomain", "https://www.zhihu.com/a", "https://zhuanlan.zhihu.com/p/1", 0],
  ["leave and return", "https://www.zhihu.com/a", "https://example.org", 0],
];
```

For the last row, send the return navigation as a second event and assert exactly one new `CREATE_VISIT`. Implement the table assertion as:

```js
for (const [name, fromUrl, toUrl, expectedCreates] of cases) {
  const result = runNavigationScenario({ fromUrl, toUrl });
  assert.equal(effectsOf(result, "CREATE_VISIT").length, expectedCreates, name);
}

const returnResult = runLeaveAndReturnScenario();
assert.equal(effectsOf(returnResult, "CREATE_VISIT").length, 1);
assert.equal(effectsOf(runSameSiteNavigationScenario(), "CREATE_VISIT").length, 0);
assert.equal(effectsOf(runCrossSiteScenario(), "CREATE_VISIT").length, 1);
```

The cross-site test must also assert an `END_VISIT` for A before `CREATE_VISIT` for B.

Add a blank tab with no `openerTabId`, commit an enabled target URL, and assert exactly one new visit. Activate an already-associated target tab without navigating and assert no new visit.

Repeat independent outside-to-target entry with `transitionType` values `link`, `typed`, `auto_bookmark` and `transitionQualifiers: ["forward_back"]`; each must create exactly one visit. The reducer must not use transition metadata to suppress a genuine cross-boundary entry.

- [ ] **Step 2: Write failing tests for opener inheritance and reference lifetime**

```js
test("same-site child reserves and inherits its opener visit", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let state = stateWithTrackedTab({ tabId: 1, siteId: "zhihu", visitId: "v1" });
  let result = reduceRuntimeEvent(state, {
    type: "TAB_CREATED",
    tabId: 2,
    windowId: 1,
    openerTabId: 1,
    candidateUrl: "https://zhuanlan.zhihu.com/p/1",
    at: 2_000,
  }, context);
  assert.equal(result.state.tabs["2"].visitId, "v1");
  assert.equal(result.state.tabs["2"].pendingInheritance, true);

  result = reduceRuntimeEvent(result.state, { type: "TAB_REMOVED", tabId: 1, at: 3_000 }, context);
  assert.equal(result.effects.some(effect => effect.type === "END_VISIT"), false);

  result = reduceRuntimeEvent(result.state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://zhuanlan.zhihu.com/p/1",
    documentId: "doc-2",
    at: 4_000,
  }, context);
  assert.equal(result.state.tabs["2"].visitId, "v1");
  assert.equal(result.state.tabs["2"].pendingInheritance, false);
  assert.equal(result.effects.some(effect => effect.type === "CREATE_VISIT"), false);
});

test("a child that commits another configured site releases inheritance", () => {
  const context = makeRuntimeContext({ sites, ids: ["v2"] });
  let state = stateWithPendingChild({ openerVisitId: "v1", childTabId: 2 });
  const result = reduceRuntimeEvent(state, {
    type: "NAVIGATION_COMMITTED",
    tabId: 2,
    windowId: 1,
    url: "https://www.bilibili.com/video/1",
    documentId: "doc-2",
    at: 4_000,
  }, context);
  assert.deepEqual(
    result.effects.filter(effect => ["END_VISIT", "CREATE_VISIT"].includes(effect.type)).map(effect => effect.type),
    ["END_VISIT", "CREATE_VISIT"],
  );
  assert.equal(result.effects.find(effect => effect.type === "END_VISIT").visitId, "v1");
  assert.equal(result.effects.find(effect => effect.type === "CREATE_VISIT").visit.id, "v2");
  assert.equal(result.state.tabs["2"].visitId, "v2");
});
```

Use concrete assertions on `state.tabs["2"].visitId`, `pendingInheritance`, effect order, and visit IDs; do not only assert effect counts.

Add a child whose `candidateUrl` is `about:blank`: assert it stores `openerTabId` but does not reserve a visit. If the opener is still associated when the child later commits a same-site URL, it inherits then; if the opener has already closed, the committed target creates one independent visit. This prevents an unused blank child tab from keeping a visit open forever.

- [ ] **Step 3: Write failing tests for the five viewing predicates and global uniqueness**

For one visible target tab, assert `START_INTERVAL` appears only after it is active in the focused, non-minimized window and the device is not locked. Then send each event below and assert the exact transition:

```js
{ type: "TAB_ACTIVATED", tabId: 2, windowId: 1, at: 2_000 }       // PAUSE v1
{ type: "WINDOW_FOCUSED", windowId: null, at: 3_000 }             // no duplicate pause
{ type: "WINDOW_FOCUSED", windowId: 1, at: 4_000 }                // START active target
{ type: "WINDOW_STATE_CHANGED", windowId: 1, state: "minimized", at: 5_000 }
{ type: "IDLE_STATE_CHANGED", state: "locked", at: 6_000 }
{ type: "IDLE_STATE_CHANGED", state: "active", at: 7_000 }
{ type: "PAGE_VISIBILITY", tabId: 1, documentId: "doc-1", visible: false, at: 8_000 }
```

Add two visible target tabs in different windows and assert `effects.filter(e => e.type === "START_INTERVAL").length <= 1` after every event. Send `{ type: "IDLE_STATE_CHANGED", state: "idle" }` and assert it does not pause; only `state: "locked"` sets `locked: true`.

- [ ] **Step 4: Write failing tests for add, enable, disable, delete, and stale document messages**

Assert all of these behaviors:

- `SITES_CHANGED` receives a transient `currentSiteIdsByTab` map produced from a fresh Chrome tab query; after adding or enabling a site it sets `currentSiteId` on already-open matching tabs but leaves `visitId: null` and emits no `CREATE_VISIT`.
- Disabling a site emits `PAUSE_INTERVAL`/`END_VISIT` as applicable, preserves `currentSiteId`, and clears `visitId`.
- `DELETE_SITE_HISTORY` emits `DELETE_SITE_VISITS`, clears visit associations, and keeps matching tabs marked inside the site so refresh does not create a visit; leaving and returning does.
- A `PAGE_VISIBILITY` message with a different non-null `documentId` from the tab runtime is ignored.
- A visible confirmation for the currently active visit emits one `CONFIRM_INTERVAL` and never another `START_INTERVAL`.

- [ ] **Step 5: Run the state-machine test and confirm it fails**

Run: `node --test tests/runtime-machine.test.js`

Expected: FAIL because `src/domain/runtime-machine.js` does not exist.

- [ ] **Step 6: Implement deterministic reduction and effect ordering**

`reduceRuntimeEvent()` must clone only changed state branches, clamp event time to `Math.max(event.at, state.lastEventAt)`, update tab associations first, emit `END_VISIT` only after the final association disappears, then compare old and new `deriveActiveVisitId()` values:

```js
if (previousActiveVisitId !== nextActiveVisitId) {
  if (previousActiveVisitId) effects.push({ type: "PAUSE_INTERVAL", visitId: previousActiveVisitId, at });
  if (nextActiveVisitId) effects.push({ type: "START_INTERVAL", visitId: nextActiveVisitId, at });
}
```

On `TAB_CREATED`, retain `openerTabId` but reserve the opener visit only when the transient `candidateUrl` (`pendingUrl || url`) already matches the opener's site. On commit, a non-reserved child may still inherit if its opener currently owns the same-site visit. Before pushing `END_VISIT`, omit a preceding duplicate `PAUSE_INTERVAL` for the same visit by allowing `endVisit()` to close the interval. On `PAGE_VISIBILITY` for an unchanged active visit, emit `CONFIRM_INTERVAL` after state validation. A tab is eligible only when its last committed navigation mapped to `currentSiteId`, that site is enabled, it owns a `visitId`, it is the active tab of the focused non-minimized window, it is visible, and the device is not locked.

- [ ] **Step 7: Run the state-machine and full suites**

Run: `node --test tests/runtime-machine.test.js && npm test`

Expected: every opening, association, visibility, focus, minimize, lock and policy test PASS.

- [ ] **Step 8: Commit the state machine**

```bash
git add src/domain/runtime-machine.js tests/runtime-machine.test.js tests/helpers/runtime-fixtures.js
git commit -m "feat: 实现网站打开与活动状态机"
```

### Task 4: Add transactional IndexedDB and Chrome storage repositories

**Files:**
- Create: `src/storage/webtrace-db.js`
- Create: `src/storage/tracking-repository.js`
- Create: `src/storage/site-repository.js`
- Create: `src/storage/session-repository.js`
- Create: `tests/storage.test.js`
- Create: `tests/helpers/storage-fakes.js`

**Interfaces:**
- Consumes: `indexedDB`, `chrome.storage.local`, `chrome.storage.session`, `Visit`, `RuntimeState`.
- Produces: `openWebTraceDb()`, `createTrackingRepository()`, `createSiteRepository()`, `createSessionRepository()`.
- Test helpers: `uniqueDbName()`, `makeTrackingRepository()`, and `createStorageAreaFake(initialValue)`.

- [ ] **Step 1: Write failing schema and transaction tests with fake IndexedDB**

```js
import "fake-indexeddb/auto";

const visit = {
  id: "v1",
  siteId: "s1",
  openedAt: 1_000,
  endedAt: 2_000,
  activeIntervals: [],
  lastConfirmedAt: 1_000,
  lastActivityAt: 2_000,
};
const checkpoint = {
  version: 1,
  sessionId: "session-1",
  revision: 1,
  tabs: {},
  activeTabByWindow: {},
  windowStateById: {},
  focusedWindowId: null,
  locked: false,
  activeVisitId: null,
  lastEventAt: 0,
};

test("creates the required stores and compound visit indexes", async () => {
  const db = await openWebTraceDb(indexedDB, uniqueDbName());
  const tx = db.transaction(["visits", "runtimeCheckpoint"], "readonly");
  const visits = tx.objectStore("visits");
  assert.deepEqual(visits.index("bySiteOpenedAt").keyPath, ["siteId", "openedAt"]);
  assert.deepEqual(visits.index("bySiteLastActivityAt").keyPath, ["siteId", "lastActivityAt"]);
});

test("commits visits and runtime checkpoint atomically", async () => {
  const repository = await makeTrackingRepository();
  await repository.commit({ putVisits: [visit], deleteSiteIds: [], checkpoint });
  assert.deepEqual(await repository.getVisit("v1"), visit);
  assert.deepEqual(await repository.getCheckpoint(), checkpoint);
});
```

Call `commit()` with one valid visit followed by a visit that has no `id`; the second `put()` must raise `DataError` and abort the transaction. Assert neither the valid staged visit nor the new checkpoint revision is visible.

- [ ] **Step 2: Write failing range-union and deletion tests**

Seed four visits: opened inside the range, opened before but active inside, active outside, and another site. Assert:

```js
const result = await repository.queryVisitsForReport("s1", rangeStart, rangeEnd);
assert.deepEqual(result.map(v => v.id).sort(), ["active-inside", "opened-inside"]);
assert.equal(new Set(result.map(v => v.id)).size, result.length);
await repository.commit({ putVisits: [], deleteSiteIds: ["s1"], checkpoint: nextCheckpoint });
assert.deepEqual(await repository.queryVisitsForReport("s1", 0, Number.MAX_SAFE_INTEGER), []);
assert.ok(await repository.getVisit("other-site"));
```

The query must take the union of `bySiteOpenedAt` and `bySiteLastActivityAt`, de-duplicate by visit ID, and use inclusive lower/exclusive upper time bounds.

- [ ] **Step 3: Write failing site and session repository tests**

Use in-memory fake storage areas and assert:

```js
assert.deepEqual(await sites.list(), []);
await sites.replace([site]);
assert.deepEqual(await sites.list(), [site]);
await session.save(runtimeState);
assert.deepEqual(await session.load(), runtimeState);
await session.clear();
assert.equal(await session.load(), null);
```

Also assert returned objects are defensive copies so a caller cannot mutate the repository cache by reference.

- [ ] **Step 4: Run storage tests and confirm missing modules**

Run: `node --test tests/storage.test.js`

Expected: FAIL with missing storage module imports.

- [ ] **Step 5: Implement `webtrace` database version 1**

Create object store `visits` with `keyPath: "id"`, indexes `bySiteOpenedAt` and `bySiteLastActivityAt` with the exact compound key paths above, and a single-record object store `runtimeCheckpoint` with `keyPath: "key"`. Store the current checkpoint as `{ key: "current", ...runtimeState }`, and strip `key` when returning it. This overwrites the prior browser-session checkpoint instead of accumulating stale sessions. Expose Promise wrappers that reject on request error, transaction abort, or blocked upgrade; never swallow `DOMException`.

- [ ] **Step 6: Implement repository operations and session keys**

`createTrackingRepository(db)` must expose:

```js
{
  getVisit(id),
  listOpenVisits(),
  getCheckpoint(),
  queryVisitsForReport(siteId, rangeStart, rangeEnd),
  commit({ putVisits, deleteSiteIds, checkpoint }),
}
```

`commit()` opens one readwrite transaction spanning both stores, removes from `putVisits` every record whose `siteId` appears in `deleteSiteIds`, deletes all existing rows for those sites, writes the remaining visits, writes the checkpoint last, and resolves only on `transaction.oncomplete`. This guarantees that ending a current visit and deleting the same site's history in one event cannot reinsert that visit.

Use keys `webtraceSitesV1` in local storage and `webtraceRuntimeV1` in session storage. The repositories must not call `clear()` on either Chrome storage area, must never touch legacy `stats`, and must not implement age-based pruning. Serialize a runtime state in the test and assert it contains no `http://`, `https://`, path, query, title or hostname from an unconfigured tab.

- [ ] **Step 7: Run focused and full suites**

Run: `node --test tests/storage.test.js && npm test`

Expected: schema, rollback, union query, de-duplication, site deletion, local config and session mirror tests PASS.

- [ ] **Step 8: Commit the storage boundary**

```bash
git add src/storage tests/storage.test.js tests/helpers/storage-fakes.js
git commit -m "feat: 添加访问记录事务存储"
```

### Task 5: Build the serialized tracker, retries, and recovery

**Files:**
- Create: `src/background/tracker.js`
- Create: `tests/tracker.test.js`
- Create: `tests/helpers/tracker-fakes.js`

**Interfaces:**
- Consumes: `reduceRuntimeEvent()`, visit-time transitions, tracking/site/session repositories, browser snapshot adapter, `clock.now()`, `idFactory()`.
- Produces: `createTracker(dependencies)` with `ready`, `dispatch(event)`, `updateSites(sites, { at, allowBackfill: false })`, `markSitesDirty(sites)`, `deleteSiteHistory(siteId, at)`, `getStateForTest()`.
- Test helper: `createTrackerHarness({ commitFailures, sessionFailures, sessionState, checkpoint, openVisits, browserSnapshot, now })` returning `{ tracker, repository, session, errors, delays, clock }`.

- [ ] **Step 1: Write failing tests for serial commits and retry semantics**

Use deferred repository promises to dispatch two events concurrently and assert revision 1 commits before revision 2. Then configure `commit()` to fail twice and succeed on attempt 3:

```js
const navigationEvent = {
  type: "NAVIGATION_COMMITTED",
  tabId: 1,
  windowId: 1,
  url: "https://www.zhihu.com/",
  documentId: "doc-1",
  at: 1_000,
};
const harness = createTrackerHarness({ commitFailures: 2, now: 1_000 });
await harness.tracker.ready;
await harness.tracker.dispatch(navigationEvent);
assert.equal(harness.repository.commitCalls, 3);
assert.equal(harness.tracker.getStateForTest().revision, 1);
assert.deepEqual(harness.delays, [50, 150]);
```

Configure all three attempts to fail and assert:

```js
const navigationEvent = {
  type: "NAVIGATION_COMMITTED",
  tabId: 1,
  windowId: 1,
  url: "https://www.zhihu.com/",
  documentId: "doc-1",
  at: 1_000,
};
const harness = createTrackerHarness({ commitFailures: 3, now: 1_000 });
await harness.tracker.ready;
await assert.rejects(harness.tracker.dispatch(navigationEvent), /write failed/);
assert.equal(harness.tracker.getStateForTest().revision, 0);
assert.equal(harness.errors[0].code, "TRACKING_COMMIT_FAILED");
```

Use the injected `delay(ms)` fake shown above; tests must not sleep.

- [ ] **Step 2: Write failing service-worker restart recovery tests**

Seed matching session state and IDB checkpoint containing tab 1 → visit `v1`, plus a browser snapshot where tab 1 is still on the same configured site. After `await tracker.ready`, assert no `CREATE_VISIT`/new ID, revision does not count an open, and a later visible confirmation updates `v1`.

Seed a session mirror at revision 2 and a same-session IDB checkpoint at revision 3; assert the tracker chooses revision 3 and rewrites the session mirror.

- [ ] **Step 3: Write failing browser-restart and abnormal-exit tests**

With no `webtraceRuntimeV1` session value, seed an open visit whose interval starts at 1,000 and `lastConfirmedAt` is 5,000, while tracker initialization occurs at 20,000. Assert the old visit ends at 5,000. Include one restored target tab in the browser snapshot and assert it gets a different visit with `openedAt === 20_000`; a restored background tab creates an open record but no active interval until activated and visible.

- [ ] **Step 4: Write failing session-mirror repair test**

Make the authoritative IndexedDB transaction succeed and `session.save()` fail. Assert the committed in-memory revision and IDB checkpoint remain revision 1, the error is logged as `SESSION_MIRROR_FAILED`, and the next successful dispatch first repairs the mirror without replaying `CREATE_VISIT`.

- [ ] **Step 5: Run tracker tests and confirm the module is absent**

Run: `node --test tests/tracker.test.js`

Expected: FAIL with missing `src/background/tracker.js`.

- [ ] **Step 6: Implement the queue and effect application**

Each public operation must append to a single Promise chain. For one event: reduce from the last committed state, load only visit IDs named by effects, apply effects immutably in order, create a checkpoint with `revision + 1`, run the authoritative commit with the exact retry schedule, then replace in-memory state. Convert effects with the Task 2 functions; `DELETE_SITE_VISITS` must delete before any new puts in the same commit.

Do not write a new checkpoint for stale visibility messages that produce neither state changes nor effects.

- [ ] **Step 7: Implement startup reconciliation**

Initialization must finish before queued Chrome events execute:

1. Load site configuration and session mirror.
2. Query current normal Chrome windows, their tabs, active tab IDs, focus/minimize state, and `chrome.idle.queryState(60)` through its callback form (compatible with Chrome 102); map only `locked` to `locked: true`. Convert each tab URL immediately to a configured `siteId|null` and discard the URL before building runtime state.
3. When session exists, use the IDB checkpoint only when its `sessionId` matches, choose the higher revision from it and the mirror, remove mappings for missing/mismatched tabs, and end only visits whose final association disappeared. Do not create visits for already mapped same-site tabs.
4. When session is absent, recover every open visit at `lastConfirmedAt`, create a new `sessionId`, seed current tabs, and create one new visit for each actually restored enabled-site page without opener inheritance.
5. Persist the reconciled checkpoint and mirror before resolving `ready`.

- [ ] **Step 8: Run focused and full suites**

Run: `node --test tests/tracker.test.js && npm test`

Expected: ordering, retry, worker restart, browser restart, crash truncation and mirror repair tests PASS.

- [ ] **Step 9: Commit the tracker**

```bash
git add src/background/tracker.js tests/tracker.test.js tests/helpers/tracker-fakes.js
git commit -m "feat: 实现事件事务与异常恢复"
```

### Task 6: Wire Chrome events, silent page confirmations, and the analysis-page action

**Files:**
- Create: `src/shared/protocol.js`
- Create: `src/background/chrome-events.js`
- Modify: `background.js`
- Modify: `content.js`
- Delete: `content.css`
- Modify: `manifest.json`
- Create: `tests/manifest.test.js`
- Create: `tests/chrome-events.test.js`

**Interfaces:**
- Consumes: tracker methods, Chrome events, `WEBTRACE_PAGE_VISIBILITY` messages.
- Produces: `registerChromeEvents({ chrome, tracker, siteService, clock })` and `openOrFocusAnalysisPage(chrome)`.
- Test helper: `createChromeHarness({ now, analysisTabs, windows })` returning fake event objects with `listenerCount`/`emit`, a call-recording tracker, a fake site service, and a deterministic clock.

- [ ] **Step 1: Write failing manifest assertions**

```js
test("declares only the runtime permissions and HTTP(S) content injection", async () => {
  const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(manifest.name, "WebTrace");
  assert.equal(manifest.minimum_chrome_version, "102");
  assert.deepEqual(manifest.permissions.sort(), ["idle", "storage", "unlimitedStorage", "webNavigation"]);
  assert.deepEqual(manifest.host_permissions.sort(), ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches.sort(), ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
  assert.equal("css" in manifest.content_scripts[0], false);
  assert.deepEqual(manifest.background, { service_worker: "background.js", type: "module" });
  assert.equal("default_popup" in manifest.action, false);
});
```

- [ ] **Step 2: Write failing event-adapter tests**

Provide fake Chrome event objects and assert listeners are attached synchronously for:

- `webNavigation.onCommitted` (ignore `frameId !== 0` and non-HTTP(S)).
- `tabs.onCreated`, `tabs.onRemoved`, `tabs.onActivated`.
- `windows.onFocusChanged`, `windows.onBoundsChanged`, `windows.onRemoved`.
- `idle.onStateChanged` (`idle` stays unlocked; `locked` pauses).
- `runtime.onMessage` and `action.onClicked`.

Assert a content message is accepted only when `sender.tab.id` exists, its optional `sender.documentId` is forwarded, and the event timestamp comes from the injected clock rather than the message body.

```js
const harness = createChromeHarness({ now: 8_000 });
registerChromeEvents(harness);
assert.equal(harness.events.webNavigationOnCommitted.listenerCount, 1);
assert.equal(harness.events.tabsOnCreated.listenerCount, 1);
assert.equal(harness.events.tabsOnRemoved.listenerCount, 1);
assert.equal(harness.events.tabsOnActivated.listenerCount, 1);
assert.equal(harness.events.windowsOnFocusChanged.listenerCount, 1);
assert.equal(harness.events.windowsOnBoundsChanged.listenerCount, 1);
assert.equal(harness.events.windowsOnRemoved.listenerCount, 1);
assert.equal(harness.events.idleOnStateChanged.listenerCount, 1);
assert.equal(harness.events.runtimeOnMessage.listenerCount, 1);
assert.equal(harness.events.actionOnClicked.listenerCount, 1);

await harness.events.webNavigationOnCommitted.emit({
  tabId: 1,
  frameId: 2,
  url: "https://www.zhihu.com/iframe",
  timeStamp: 123,
});
assert.equal(harness.tracker.dispatchCalls.length, 0);

await harness.events.runtimeOnMessage.emit(
  { type: "WEBTRACE_PAGE_VISIBILITY", visible: true, confirmedAt: 1 },
  { tab: { id: 1, windowId: 2 }, documentId: "doc-1", url: "https://www.zhihu.com/" },
);
assert.equal(harness.tracker.dispatchCalls[0].at, 8_000);
assert.equal(harness.tracker.dispatchCalls[0].documentId, "doc-1");
```

Assert background initialization calls both storage areas' `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` before `tracker.ready` resolves.

- [ ] **Step 3: Write failing action focus tests**

Assert the first click calls `tabs.create({ url: chrome.runtime.getURL("analysis.html") })`. When an analysis tab already exists, assert a minimized window is restored, its tab becomes active, and its window becomes focused without creating a duplicate tab.

```js
const emptyHarness = createChromeHarness({ analysisTabs: [] });
await openOrFocusAnalysisPage(emptyHarness.chrome);
assert.deepEqual(emptyHarness.calls.tabsCreate, [{ url: "chrome-extension://test/analysis.html" }]);

const existingHarness = createChromeHarness({
  analysisTabs: [{ id: 9, windowId: 3 }],
  windows: [{ id: 3, state: "minimized" }],
});
await openOrFocusAnalysisPage(existingHarness.chrome);
assert.deepEqual(existingHarness.calls.tabsUpdate, [{ tabId: 9, update: { active: true } }]);
assert.deepEqual(existingHarness.calls.windowsUpdate, [
  { windowId: 3, update: { state: "normal" } },
  { windowId: 3, update: { focused: true } },
]);
assert.deepEqual(existingHarness.calls.tabsCreate, []);
```

- [ ] **Step 4: Run adapter tests and confirm failures**

Run: `node --test tests/manifest.test.js tests/chrome-events.test.js`

Expected: FAIL because the manifest still describes TimeTracker and the event module is missing.

- [ ] **Step 5: Replace the content script with a silent 4-second reporter**

Use the exact message type `WEBTRACE_PAGE_VISIBILITY`. Send `{ type, visible }` at initialization, every 4,000 ms while visible, immediately on `visibilitychange`, and with `visible: false` on `pagehide`. Restart reporting on persisted `pageshow`; clear timers before creating another. Catch rejected `sendMessage()` Promises without logging user browsing data. Do not create or modify any DOM node.

- [ ] **Step 6: Update the manifest and delete the badge stylesheet**

Set name/title/description to WebTrace, use the permissions and match patterns asserted in Step 1, declare the background as a module, and remove the CSS entry. Document `unlimitedStorage` next to the storage design as required for the confirmed retention policy. Keep the existing local icon files. Delete `content.css` because no manifest or page may reference it.

- [ ] **Step 7: Register all Chrome listeners at module evaluation time**

`background.js` must construct the tracker and call `registerChromeEvents()` without awaiting initialization; every listener must immediately enqueue behind `tracker.ready`. Do not register listeners inside an async callback because Chrome can terminate the service worker before delayed registration.

Start the tracker initialization Promise by restricting both Chrome storage areas to trusted extension contexts. If access-level setup rejects, log `STORAGE_ACCESS_LEVEL_FAILED` and do not process content messages until initialization is retried; never fall back to exposing configuration data to content scripts.

For `tabs.onCreated`, forward `candidateUrl: tab.pendingUrl || tab.url || null` only as event input; runtime state must not persist it. For a committed navigation forward `tabId`, `url`, `documentId ?? null`, and the current tab `windowId`. For `tabs.onRemoved` and `windows.onRemoved`, end associations through tracker events. Treat `chrome.windows.WINDOW_ID_NONE` as `focusedWindowId: null` and `window.state === "minimized"` as ineligible.

- [ ] **Step 8: Run static checks and tests**

Run:

```bash
node --check background.js
node --check content.js
node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'
node --test tests/manifest.test.js tests/chrome-events.test.js
npm test
```

Expected: every command exits 0; manifest tests prove the floating UI and `<all_urls>` are gone.

- [ ] **Step 9: Commit Chrome integration**

```bash
git add manifest.json background.js content.js src/shared/protocol.js src/background/chrome-events.js tests/manifest.test.js tests/chrome-events.test.js
git add -u content.css
git commit -m "feat: 接入浏览器事件与静默页面确认"
```

### Task 7: Implement site configuration commands and destructive-history safeguards

**Files:**
- Create: `src/background/site-service.js`
- Modify: `src/shared/protocol.js`
- Modify: `src/background/chrome-events.js`
- Modify: `background.js`
- Create: `tests/site-service.test.js`

**Interfaces:**
- Consumes: `normalizeSiteInput()`, site repository, tracker, `clock.now()`, `idFactory()`.
- Produces: `addSite({ name, input })`, `setSiteEnabled({ siteId, enabled })`, `deleteSiteHistory({ siteId })`; messages `WEBTRACE_ADD_SITE`, `WEBTRACE_SET_SITE_ENABLED`, `WEBTRACE_DELETE_SITE_HISTORY`.

- [ ] **Step 1: Write failing add and duplicate tests**

```js
test("adds one normalized site without backfilling open tabs", async () => {
  const result = await service.addSite({ name: "知乎", input: "https://www.zhihu.com/question/1" });
  assert.deepEqual(result, {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: true,
    createdAt: 1_000,
  });
  assert.deepEqual(tracker.updateSitesCalls[0].sites, [result]);
  assert.deepEqual(tracker.updateSitesCalls[0].options, { at: 1_000, allowBackfill: false });
});

test("rejects duplicate normalized domains", async () => {
  await service.addSite({ name: "知乎", input: "zhihu.com" });
  await assert.rejects(
    service.addSite({ name: "知乎专栏", input: "https://zhuanlan.zhihu.com" }),
    error => error.code === "DUPLICATE_SITE",
  );
});
```

Also assert a blank name returns `INVALID_NAME`, and map Task 1 domain codes to these exact Chinese messages:

```js
{
  INVALID_NAME: "请输入网站名称",
  INVALID_URL: "请输入有效的网站地址",
  UNSUPPORTED_PROTOCOL: "仅支持 HTTP 或 HTTPS 网站",
  UNREGISTRABLE_DOMAIN: "请输入可注册的主域名",
  DUPLICATE_SITE: "该网站已经添加",
  SITE_NOT_FOUND: "找不到该网站配置",
  SITE_STATE_SYNC_FAILED: "网站配置已保存，但采集状态同步失败，请重试",
  DELETE_HISTORY_FAILED: "删除历史失败，请重试",
}
```

- [ ] **Step 2: Write failing stop/resume/delete tests**

Assert disabling and enabling preserve the same `Site.id`, name, domain, creation time and all records. Assert both call `tracker.updateSites(sites, { at, allowBackfill: false })` so an already-open page remains untracked.

For deletion, assert `tracker.deleteSiteHistory(siteId, at)` is called while the site configuration remains byte-for-byte unchanged. Configure tracker deletion to reject and assert the command returns `DELETE_HISTORY_FAILED` without claiming success.

Configure `tracker.updateSites()` to fail after local configuration succeeds. Assert the service returns `SITE_STATE_SYNC_FAILED`, keeps the new configuration as the authoritative user choice, and calls `tracker.markSitesDirty(nextSites)` so the next tracker event reconciles policy before processing navigation or time.

- [ ] **Step 3: Write failing protocol tests**

Call the message listener with each command and assert exactly one `sendResponse()` using `{ ok: true, data }` or `{ ok: false, error }`. Unknown messages must return `false` synchronously; known async commands must return `true`.

- [ ] **Step 4: Run tests and confirm the service is missing**

Run: `node --test tests/site-service.test.js tests/chrome-events.test.js`

Expected: FAIL with missing `src/background/site-service.js` or missing message constants.

- [ ] **Step 5: Implement serialized configuration operations**

Give `site-service` its own Promise queue so two simultaneous additions cannot pass duplicate checks. Trim the name, normalize the input, check `domain` uniqueness across enabled and disabled sites, persist the complete array as the configuration source of truth, then call the tracker. Generate IDs with injected `idFactory()` and times with injected `clock.now()`.

`tracker.updateSites()` must query a fresh browser snapshot, reduce every current tab URL to `currentSiteId|null`, discard the URLs, and commit `SITES_CHANGED` with `allowBackfill: false`. If that commit fails, `markSitesDirty(nextSites)` stores only the desired `Site[]` in memory; before any later tracker event, the serialized queue retries this reconciliation. This prevents a failed disable from continuing to count and prevents a failed add/enable sync from turning an internal navigation into a false opening.

`setSiteEnabled()` must no-op when the requested value is already stored. `deleteSiteHistory()` must never remove the `Site`; it delegates to the tracker so active intervals end, all associations clear, the site visit rows delete in one IndexedDB transaction, and matching tabs remain marked inside the site.

- [ ] **Step 6: Wire commands through the background response envelope**

Do not accept configuration messages from web pages. Require `sender.url` to start with `chrome.runtime.getURL("")` for the three analysis commands; content-script visibility remains the only allowed command from HTTP(S) senders. Convert thrown service errors to the stable response envelope and log only error code/stack, never URL or record payloads.

- [ ] **Step 7: Run focused and full suites**

Run: `node --test tests/site-service.test.js tests/chrome-events.test.js && npm test`

Expected: add, duplicate, stop, resume, deletion, authorization and response-envelope tests PASS.

- [ ] **Step 8: Commit site management services**

```bash
git add src/background/site-service.js src/shared/protocol.js src/background/chrome-events.js background.js tests/site-service.test.js tests/chrome-events.test.js
git commit -m "feat: 添加网站配置与历史删除命令"
```

### Task 8: Build the analysis and site-management page

**Files:**
- Create: `analysis.html`
- Create: `analysis.css`
- Create: `analysis.js`
- Create: `src/analysis/data-source.js`
- Create: `src/analysis/controller.js`
- Create: `src/analysis/view.js`
- Create: `tests/analysis-controller.test.js`

**Interfaces:**
- Consumes: site repository, tracking repository, `aggregateSevenDayReport()`, background command protocol.
- Produces: `createAnalysisDataSource()`, `createAnalysisController()`, `createAnalysisView()`.
- Test helper: `createAnalysisHarness({ now, sites, visits })` returning `{ controller, dataSource, view, repositoryCalls }`.

- [ ] **Step 1: Write failing controller tests for defaults and selection**

```js
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

let controller;
let dataSource;
let view;

beforeEach(() => {
  ({ controller, dataSource, view } = createAnalysisHarness({
    now: new Date(2026, 7, 31, 12).getTime(),
    sites: [
      { id: "s1", name: "知乎", domain: "zhihu.com", enabled: true, createdAt: 1 },
      { id: "disabled-site", name: "B 站", domain: "bilibili.com", enabled: false, createdAt: 2 },
    ],
    visits: [],
  }));
});

test("selects the first site and today, then loads one seven-day report", async () => {
  await controller.initialize();
  assert.equal(view.lastModel.selectedSiteId, "s1");
  assert.equal(view.lastModel.selectedDateKey, "2026-08-31");
  assert.equal(view.lastModel.report.days.length, 7);
});

test("keeps disabled sites selectable and switches detail dates", async () => {
  await controller.initialize();
  await controller.selectSite("disabled-site");
  controller.selectDate("2026-08-29");
  assert.equal(view.lastModel.selectedSiteId, "disabled-site");
  assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
});

test("shows zero state when there are no sites", async () => {
  dataSource.sites = [];
  await controller.initialize();
  assert.equal(view.lastModel.mode, "NO_SITES");
});
```

Add tests that an operation error remains visible until the next user action and that refresh preserves selected site/date when both still exist.

- [ ] **Step 2: Write failing data-source tests for query boundaries**

Freeze the clock at local 2026-08-31 12:00. Assert `getReport("s1", "2026-08-31")` calls `queryVisitsForReport()` from local 2026-08-25 00:00 through `now + 1 ms` and passes the result to `aggregateSevenDayReport()`; the extra millisecond includes a record confirmed exactly at `now` while keeping the repository upper bound exclusive.

```js
const now = new Date(2026, 7, 31, 12).getTime();
const site = { id: "s1", name: "知乎", domain: "zhihu.com", enabled: true, createdAt: 1 };
const visit = {
  id: "v1",
  siteId: "s1",
  openedAt: now,
  endedAt: null,
  activeIntervals: [],
  lastConfirmedAt: now,
  lastActivityAt: now,
};
const harness = createAnalysisHarness({ now, sites: [site], visits: [visit] });
const report = await harness.dataSource.getReport("s1", "2026-08-31");
assert.deepEqual(harness.repositoryCalls.queryVisitsForReport[0], {
  siteId: "s1",
  rangeStart: new Date(2026, 7, 25, 0).getTime(),
  rangeEnd: now + 1,
});
assert.equal(report.days.length, 7);
assert.equal(report.selectedDateKey, "2026-08-31");
```

- [ ] **Step 3: Run controller tests and confirm modules are missing**

Run: `node --test tests/analysis-controller.test.js`

Expected: FAIL with missing analysis modules.

- [ ] **Step 4: Create an extension-only page skeleton**

`analysis.html` must load only `analysis.css` and `<script type="module" src="analysis.js"></script>` from the extension package. Include these stable regions and accessible labels:

```html
<aside id="site-list" aria-label="统计网站"></aside>
<main>
  <header><h1>WebTrace</h1><button id="manage-sites">管理网站</button></header>
  <section id="summary" aria-label="最近 7 天合计"></section>
  <section id="open-chart" aria-label="每日打开次数"></section>
  <section id="duration-chart" aria-label="每日有效使用时长"></section>
  <section aria-labelledby="visit-details-title">
    <h2 id="visit-details-title">访问明细</h2>
    <p>明细按打开日期归属；跨午夜时长会拆分到趋势对应日期。</p>
    <div id="visit-details"></div>
  </section>
</main>
<dialog id="site-manager"></dialog>
<div id="error-banner" role="alert" hidden></div>
```

- [ ] **Step 5: Implement the data source and controller**

The data source opens the same `webtrace` database, reads all sites including disabled ones, queries the union range, and sends mutations with `chrome.runtime.sendMessage()`. Reject any response with `ok !== true` using its stable code/message.

The controller defaults to the earliest `createdAt` site and `localDateKey(clock.now())`, exposes `selectSite`, `selectDate`, `addSite`, `setSiteEnabled`, `requestDeleteHistory`, and `confirmDeleteHistory`, and refreshes while the page is visible every 4 seconds. Starting a new refresh must not create overlapping requests; if one is running, set a `refreshPending` flag and run once more after completion.

- [ ] **Step 6: Render two separate aligned trend charts and complete details**

Render the same seven date buttons in `open-chart` and `duration-chart`. Scale each chart against its own maximum, use zero-height bars for zero values, and use identical date labels/order. Each bar must have an `aria-label` containing date and formatted value and call `selectDate(dateKey)`.

Render totals as integer opens and `HH:MM:SS`. Render details newest first with local open time, local end time or `进行中`, and full visit duration. When the selected date has no visits, render `当天没有访问记录`; do not remove the zero day from either chart.

- [ ] **Step 7: Implement management UI and confirmation**

The manager must show name/domain/status for every site, a required name field, a required URL/domain field, and stop/resume buttons. The delete-history button opens a second confirmation state containing the site name and exact warning `这会永久删除该网站的全部访问记录，但保留网站配置；此操作无法撤销。` Only the explicit confirm button may send `WEBTRACE_DELETE_SITE_HISTORY`; cancel closes without mutation.

Create every user-derived label, error and detail cell with `textContent`; do not interpolate site names or domains into `innerHTML`.

After add, stop, resume, or delete succeeds, reload sites/report and keep the affected site selected. Disable operation buttons while their command is pending to prevent duplicate submissions.

- [ ] **Step 8: Add responsive, local-only styling**

Use a two-column desktop layout and a single-column layout below 800 px. Status, selected date, errors and chart values must not rely on color alone. Do not reference remote fonts, images, scripts, style sheets or analytics.

- [ ] **Step 9: Run focused, full, and static network checks**

Run:

```bash
node --test tests/analysis-controller.test.js
npm test
rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource" analysis.js src/analysis src/background content.js
rg -n "(src|href)=['\"]https?://" analysis.html
```

Expected: tests PASS and both `rg` commands return no runtime network call or remote asset reference. Domain fixture strings may exist only under `tests/` and are excluded from this check.

- [ ] **Step 10: Commit the analysis page**

```bash
git add analysis.html analysis.css analysis.js src/analysis tests/analysis-controller.test.js
git commit -m "feat: 添加七天趋势与网站管理页面"
```

### Task 9: Prove the complete V1 flow, update current facts, and archive the Change

**Files:**
- Create: `tests/webtrace-flow.test.js`
- Create: `tests/helpers/webtrace-harness.js`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/current/project.md`
- Move: `docs/changes/2026-08-31-webtrace-v1-spec.md` → `docs/archive/2026-08/2026-08-31-webtrace-v1-spec.md`
- Move: `docs/changes/2026-08-31-webtrace-v1-plan.md` → `docs/archive/2026-08/2026-08-31-webtrace-v1-plan.md`

**Interfaces:**
- Consumes: all production modules and the spec acceptance criteria.
- Produces: one end-to-end deterministic test, recorded Chrome evidence, accurate current documentation, and an archived completed Change.
- Test helper: `createWebTraceHarness({ now })` exposing `addSite`, `listSites`, `navigate`, `createTab`, `activateTab`, `focusWindow`, `setVisible`, `confirm`, `setSiteEnabled`, `deleteHistory`, `advanceTo`, `getVisits`, and `getReport` over fake Chrome plus fake IndexedDB.

- [ ] **Step 1: Write an end-to-end deterministic flow test**

Use fake Chrome adapters, real domain/runtime/timing/report modules, and fake IndexedDB. Drive this exact sequence with a fake local clock:

1. Add `zhihu.com`; an already-open Zhihu tab produces zero visits.
2. Navigate that tab to `example.org`, then to `https://www.zhihu.com`; one visit opens.
3. Make the tab active, window focused, page visible; advance two confirmations and accumulate time.
4. Refresh and navigate to `zhuanlan.zhihu.com`; open count remains one.
5. Create a same-site child tab from the opener; it inherits the visit.
6. Switch to another tab and back; one visit contains two non-overlapping intervals.
7. Cross local midnight; report duration splits across two days while open count/detail stay on the opening day.
8. Leave all associated tabs; the visit ends.
9. Enter Zhihu again; a second visit opens.
10. Disable the site; the second visit ends and history stays queryable.
11. Re-enable while a Zhihu page is open; no third visit appears.
12. Leave and return; a third visit appears.
13. Delete history; report returns seven zero-filled days, site configuration remains enabled, and refresh does not recreate a visit.
14. Leave and return after deletion; one fresh visit is recorded while the deleted history stays absent.

Assert after each numbered step, not only at the end.

```js
const harness = await createWebTraceHarness({
  now: new Date(2026, 7, 30, 23, 59, 40).getTime(),
});
const site = await harness.addSite({ name: "知乎", input: "https://www.zhihu.com/question/1" });
assert.equal((await harness.getVisits(site.id)).length, 0);

await harness.navigate(1, "https://example.org/");
await harness.navigate(1, "https://www.zhihu.com/");
assert.equal((await harness.getVisits(site.id)).length, 1);

await harness.activateTab(1);
await harness.focusWindow(1);
await harness.setVisible(1, true);
await harness.confirm(1);
assert.equal((await harness.getReport(site.id)).totals.openCount, 1);

await harness.deleteHistory(site.id);
assert.deepEqual((await harness.getReport(site.id)).totals, { openCount: 0, activeMs: 0 });
assert.equal((await harness.listSites()).find(item => item.id === site.id).enabled, true);
```

- [ ] **Step 2: Run the new test and repair only integration defects**

Run: `node --test tests/webtrace-flow.test.js`

Expected: PASS when the preceding tasks are integrated correctly. If it fails, fix the owning module with a focused regression assertion in its unit-test file, then rerun until this test passes.

- [ ] **Step 3: Run the complete automated and static verification**

Run:

```bash
npm ci
npm run vendor:tldts
git diff --exit-code -- vendor/tldts/index.esm.min.js vendor/tldts/LICENSE
npm test
find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check
node --check background.js
node --check content.js
node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'
rg -n "timetracker-badge|TIMETRACKER_TICK|<all_urls>|default_popup" manifest.json background.js content.js analysis.html analysis.js src
rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource" . --glob '*.js' --glob '!node_modules/**' --glob '!vendor/**'
```

Expected: dependency reproduction has no diff; every test and syntax/JSON check exits 0; both final `rg` checks return no matches outside archived documentation.

- [ ] **Step 4: Commit the automated acceptance test**

```bash
git add tests/webtrace-flow.test.js tests/helpers/webtrace-harness.js
git commit -m "test: 添加 WebTrace 全流程验收测试"
```

- [ ] **Step 5: Perform the real Chrome acceptance run**

Reload the unpacked extension from this repository in the current stable Chrome. Record the Chrome version from `chrome://version`, the local verification date, and PASS/FAIL for every scenario below:

1. Add 知乎 using a full question URL; confirm it normalizes to `zhihu.com` and does not backfill the already-open page.
2. From a non-target page enter Zhihu; confirm one opening and correct local time.
3. Refresh, navigate inside Zhihu, and open same-site content in a child tab; confirm no extra opening.
4. Open the target in a background tab; confirm opening increments but duration remains zero until that tab is active/visible.
5. Switch tabs, switch applications, minimize Chrome, and lock/unlock the device; confirm all away periods pause and return resumes.
6. Leave a visible Zhihu page untouched for more than 30 seconds; confirm duration continues.
7. Keep multiple Zhihu tabs open and switch among them; confirm no overlapping/double time.
8. Leave/close every Zhihu tab and enter again; confirm a second record.
9. Stop, resume, and delete history; confirm history visibility, no backfill, explicit confirmation, preserved config, zeroed report, and a fresh record only after leaving and returning.
10. Click the toolbar icon twice; confirm the existing analysis page focuses instead of opening a duplicate.
11. In DevTools stop/restart the extension service worker; confirm no duplicate opening and the current visit resumes.
12. Quit and restart Chrome with Zhihu restored; confirm the old visit stops no later than its last confirmation and the restored page creates a new visit without offline time.
13. Inspect both aligned 7-day charts, totals, zero days, selected-day detail, `进行中`, and the cross-midnight explanatory copy.

If any scenario fails, do not update current facts or archive the Change. Add a focused automated regression where possible, fix the owning task, and repeat the complete verification.

- [ ] **Step 6: Update user and current-state documentation from verified facts**

Rewrite root `README.md` to describe WebTrace, local-only storage, configuration, analysis-page entry and unpacked loading. Update `docs/current/project.md` so it starts with the completed current conclusion and separately records:

- Implemented facts: permissions, configuration, domain matching, open rules, activity predicates, IndexedDB schema, session recovery, analysis behavior, retention and no network.
- Effective decisions: the V1 contract remains authoritative and its completed spec/plan are historical evidence.
- Remaining limits/risks: fixed 7-day range, no sync/export, host access scope, heartbeat undercount bound, and any browser-specific caveat observed in the manual run.
- Verification evidence: exact automated commands, Chrome version, verification date and the 13 covered scenarios; never claim an unexecuted scenario.

Keep `docs/current/project.md` at or below 300 lines.

- [ ] **Step 7: Archive the completed Change and repair links**

Create `docs/archive/2026-08/` if absent, move both same-date Change files there, change their status to completed only after Step 5 passes, change this plan's `Spec` link label/path to its archive location, update links from `docs/README.md` and `docs/current/project.md`, and state in `docs/README.md` that no Change is currently active.

Run:

```bash
test ! -e docs/changes/2026-08-31-webtrace-v1-spec.md
test ! -e docs/changes/2026-08-31-webtrace-v1-plan.md
test -e docs/archive/2026-08/2026-08-31-webtrace-v1-spec.md
test -e docs/archive/2026-08/2026-08-31-webtrace-v1-plan.md
rg -n "docs/changes/2026-08-31-webtrace-v1|changes/2026-08-31-webtrace-v1" README.md docs --glob '!docs/archive/**'
test "$(wc -l < docs/current/project.md)" -le 300
```

Expected: the four path assertions pass, the link search returns no stale Change link, and the current document line check exits 0.

- [ ] **Step 8: Confirm the final worktree contains only intended V1 changes**

Run: `git status --short && git diff --check && git diff --stat`

Expected: only the files enumerated by this plan are changed or created, `git diff --check` prints nothing, and no credentials, cookies, tokens, real browsing records or generated local database files are present.

- [ ] **Step 9: Commit verification and documentation**

```bash
git add README.md docs
git commit -m "docs: 更新 WebTrace V1 状态并归档变更"
```
