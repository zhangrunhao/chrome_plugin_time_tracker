# WebTrace V1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持 WebTrace V1 计时、恢复、存储和本地隐私契约不变的前提下，交付今日概览、固定最近 14 个本地日的两张通栏折线图和网站持续统计，并把扩展版本更新为 `1.1.0`。

**Architecture:** 严格本地日期解析、滚动范围和通用日期窗口保留为纯领域模块，报表继续从 `Visit` 与 `ActiveInterval` 现场聚合；分析控制器每次刷新计算滚动 14 日范围，视图不显示日期输入或范围错误。现有后台串行链在 tracker 初始化后执行一次停用网站迁移，并让 Chrome 生命周期事件等待迁移完成；分析视图用随扩展打包的 SVG 折线与原生按钮数据点替换柱状图，不引入运行时依赖或远程资源。

**Tech Stack:** Chrome Manifest V3、原生 ES modules、Chrome `webNavigation`/`tabs`/`windows`/`idle`/`storage` API、IndexedDB、原生 HTML/CSS/SVG/DOM、Node.js 内置测试运行器、`fake-indexeddb@6.2.5`。

**Spec:** [`2026-09-02-webtrace-v1-1-spec.md`](./2026-09-02-webtrace-v1-1-spec.md)

**Status:** 实施中（2026-09-02 用户确认移除自定义日期范围）

## Global Constraints

- 目标版本必须是 `1.1.0`，目标平台继续是 Chrome Manifest V3，最低 Chrome 版本继续是 102。
- 报表必须固定包含今天及此前 13 天，共 14 个本地日；界面不得显示日期选择或超过 14 天的查看入口，更早数据继续保留。
- 日期必须是可往返解析的规范 `YYYY-MM-DD` 本地日；日数和边界必须按本地日历推进，不能用固定 86,400,000 毫秒计算。
- 今日概览始终展示所选网站的本地今天数据，不随明细选中日期变化。
- 打开次数继续按 `openedAt` 的本地日期归属；有效时长继续按本地午夜拆分；明细继续归属打开日并显示完整访问时长。
- `Visit` 与 `ActiveInterval` 继续是报表唯一事实来源；不得新增日汇总缓存、修改 IndexedDB `webtrace` v1 schema、索引或保留期限。
- 网站添加后持续统计；`Site.enabled` 作为兼容字段保留且最终始终为 `true`，用户界面和消息协议不得再提供停止或恢复操作。
- 已有 `enabled: false` 配置迁移时必须保留 ID、名称、域名、创建时间和历史，迁移必须幂等且不得为已经打开的页面回填访问。
- 删除历史必须继续二次确认，只删除目标网站访问记录并保留启用的网站配置；后续有效打开必须能产生新记录。
- V1 已验证的打开、计时、锁屏、窗口、可见性、刷新、站内跳转、同站子标签、恢复和分析页复用语义不得回归。
- `permissions` 必须保持为 `idle`、`storage`、`unlimitedStorage`、`webNavigation`；`host_permissions` 和静态内容脚本范围必须保持 `http://*/*`、`https://*/*`。
- 运行时代码不得调用 `fetch`、`XMLHttpRequest`、`WebSocket` 或 `EventSource`，不得加载远程代码、字体或图表资源，也不得保存完整 URL、路径、查询参数或网页标题。
- 项目没有构建步骤；不得把语法检查、Node 自动测试或浏览器自动化表述成不存在的构建结果或手工 Chrome 通过。

## 2026-09-02 Scope Revision

用户在首次功能确认后撤销 1 至 30 日自定义范围，要求分析页只展示固定最近 14 日。Task 1 至 Task 6 保留已完成的实施记录；其中关于自定义范围、`AppliedDateRange`、`rangeError`、日期表单和 30 日界面验收的内容均由本节与 Task 7 覆盖。底层通用窗口与数据源能力保留，但没有产品入口；Task 8 使用修订后的固定 14 日验收标准完成 Change。

## Data Contracts and Shared Interfaces

后续任务统一使用以下名称，不得为同一概念另建同义接口：

```js
/**
 * @typedef {{
 *   startDateKey: string,
 *   endDateKey: string,
 *   startAt: number,
 *   endAt: number,
 *   dayCount: number,
 *   days: { dateKey: string, startedAt: number, endedAt: number }[]
 * }} DateWindow
 */
/**
 * @typedef {{
 *   range: { startDateKey: string, endDateKey: string },
 *   todaySummary: { openCount: number, activeMs: number },
 *   days: { dateKey: string, openCount: number, activeMs: number }[],
 *   selectedDateKey: string,
 *   details: {
 *     id: string,
 *     openedAt: number,
 *     endedAt: number|null,
 *     durationMs: number,
 *     ongoing: boolean
 *   }[]
 * }} Report
 */
```

领域与分析层接口固定为：

```js
localDateKey(at)
getRollingDateRange(now, dayCount = 14)
resolveDateRange({ startDateKey, endDateKey, todayDateKey })
aggregateReport(
  { rangeVisits, todayVisits },
  { now, rangeWindow, todayWindow, selectedDateKey },
)
trackingRepository.queryVisitsForReport(siteId, rangeStart, rangeEnd)
dataSource.getReport(siteId, { startDateKey, endDateKey, selectedDateKey })
siteService.migrateDisabledSites()
registerChromeEvents({ chrome, tracker, siteService, clock, lifecycleReady, reportError })
```

`resolveDateRange()` 的稳定错误保留为底层领域契约，但分析页不再显示或触发这些错误：

```js
export const DATE_RANGE_ERROR_MESSAGES = Object.freeze({
  INVALID_DATE_RANGE: "请选择有效的起始和终止日期",
  START_AFTER_END: "起始日期不能晚于终止日期",
  END_AFTER_TODAY: "终止日期不能晚于今天",
  RANGE_TOO_LONG: "日期范围最多为 30 天",
});
```

控制器传给视图的日期状态只保留：

```js
{
  todayDateKey: string
}
```

控制器每次报表读取都用 `getRollingDateRange(clock.now())` 生成范围；不提供 `applyDateRange()`，也不保存 `appliedRange` 或 `rangeError`。

## File Map

| Path | Responsibility |
| --- | --- |
| `src/domain/local-date-range.js` | 严格本地日期解析、14 日滚动默认范围、1 至 30 日窗口与稳定验证错误。 |
| `src/domain/report.js` | 从范围访问和今日访问聚合 `Report`，拆分本地午夜并生成明细。 |
| `src/storage/tracking-repository.js` | 通过两个既有复合索引读取与窗口相交的访问并按 ID 去重；schema 不变。 |
| `src/analysis/data-source.js` | 解析查询窗口，范围不含今天时独立查询今日，构造领域报表并发送保留的管理命令。 |
| `src/analysis/controller.js` | 管理网站、滚动 14 日范围、选中日期和串行刷新。 |
| `src/analysis/view.js` | 渲染今日概览、SVG 折线、可键盘操作的数据点、明细与持续统计管理界面。 |
| `analysis.html`, `analysis.css`, `analysis.js` | 无日期表单的分析页稳定区域、通栏布局、折线交互样式和 composition root/fallback model。 |
| `src/background/site-service.js` | 添加网站、幂等迁移旧停用配置、删除历史，并通过 tracker 同步而不回填。 |
| `src/shared/protocol.js` | 只保留添加网站、删除历史、分析页注册和可见性消息。 |
| `src/background/chrome-events.js`, `background.js` | 让生命周期与管理操作等待启动迁移，拒绝已移除命令，同时保持监听器同步注册。 |
| `manifest.json` | 版本更新为 `1.1.0`，权限与 HTTP/HTTPS 内容脚本声明不变。 |
| `tests/local-date-range.test.js` | 严格日期、1/14/30 日、跨月年闰日与 DST 日历推进。 |
| `tests/report.test.js` | 范围聚合、今日概览、零值、午夜拆分和明细归属。 |
| `tests/storage.test.js` | 历史窗口相交查询、未来记录过滤、并集去重与 schema 回归。 |
| `tests/analysis-controller.test.js` | 固定滚动 14 日范围、网站切换、选中日、午夜滚动和刷新串行化。 |
| `tests/analysis-data-source.test.js` | 范围与今日查询策略、命令收缩和稳定错误 envelope。 |
| `tests/analysis-view.test.js` | SVG/DOM 折线、无障碍数据点、14 日标签、无日期表单、管理文案和焦点。 |
| `tests/site-service.test.js`, `tests/chrome-events.test.js` | 迁移幂等性、无回填、协议移除、启动门和真实 background composition。 |
| `tests/helpers/webtrace-harness.js`, `tests/webtrace-flow.test.js` | 使用真实生产模块与 fake IndexedDB 证明 V1.1 跨边界流程且 V1 语义无回归。 |
| `tests/manifest.test.js` | 版本、权限和内容脚本声明。 |
| `README.md`, `docs/README.md`, `docs/current/project.md` | 用户说明、Change 入口、最终事实/决定/风险/验证证据。 |

---

### Task 1: Generalize strict local-date windows and report aggregation

**Files:**
- Create: `src/domain/local-date-range.js`
- Create: `tests/local-date-range.test.js`
- Modify: `src/domain/report.js`
- Modify: `tests/report.test.js`

**Interfaces:**
- Consumes: `Visit`, `ActiveInterval`, injected numeric `now` timestamps.
- Produces: `DateRangeError`, `DATE_RANGE_ERROR_MESSAGES`, `localDateKey`, `getRollingDateRange`, `resolveDateRange`, `aggregateReport`.
- Compatibility during this task: have `report.js` re-export `localDateKey` and keep `getSevenDayWindow()`/`aggregateSevenDayReport()` as thin wrappers so the untouched analysis layer still passes; Task 3 removes them after every consumer uses the generic API.

- [ ] **Step 1: Write failing strict-date and local-calendar tests**

Create `tests/local-date-range.test.js` with concrete assertions for 1, 14 and 30 inclusive days, strict parsing and the four stable errors:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  DATE_RANGE_ERROR_MESSAGES,
  DateRangeError,
  getRollingDateRange,
  resolveDateRange,
} from "../src/domain/local-date-range.js";

const TODAY = "2026-09-02";

test("builds inclusive 1, 14, and 30-day local windows", () => {
  const one = resolveDateRange({
    startDateKey: TODAY,
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });
  const fourteen = resolveDateRange({
    startDateKey: "2026-08-20",
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });
  const thirty = resolveDateRange({
    startDateKey: "2026-08-04",
    endDateKey: TODAY,
    todayDateKey: TODAY,
  });
  assert.deepEqual([one.dayCount, fourteen.dayCount, thirty.dayCount], [1, 14, 30]);
  assert.equal(one.endAt, new Date(2026, 8, 3).getTime());
  assert.deepEqual(getRollingDateRange(new Date(2026, 8, 2, 12).getTime()), {
    startDateKey: "2026-08-20",
    endDateKey: TODAY,
  });
});

test("rejects missing, impossible, reversed, future, and 31-day ranges", () => {
  const cases = [
    [{ startDateKey: "", endDateKey: TODAY }, "INVALID_DATE_RANGE"],
    [{ startDateKey: "2026-02-30", endDateKey: TODAY }, "INVALID_DATE_RANGE"],
    [{ startDateKey: TODAY, endDateKey: "2026-08-31" }, "START_AFTER_END"],
    [{ startDateKey: TODAY, endDateKey: "2026-09-03" }, "END_AFTER_TODAY"],
    [{ startDateKey: "2026-08-03", endDateKey: TODAY }, "RANGE_TOO_LONG"],
  ];
  for (const [range, code] of cases) {
    assert.throws(
      () => resolveDateRange({ ...range, todayDateKey: TODAY }),
      error => error instanceof DateRangeError
        && error.code === code
        && error.message === DATE_RANGE_ERROR_MESSAGES[code],
    );
  }
});

test("crosses month, year, and leap day by local calendar", () => {
  const window = resolveDateRange({
    startDateKey: "2024-02-28",
    endDateKey: "2024-03-01",
    todayDateKey: "2024-03-01",
  });
  assert.deepEqual(window.days.map(day => day.dateKey), [
    "2024-02-28", "2024-02-29", "2024-03-01",
  ]);
});

test("does not treat daylight-saving days as fixed 24-hour periods", () => {
  const moduleUrl = new URL("../src/domain/local-date-range.js", import.meta.url).href;
  const script = `
    import { resolveDateRange } from ${JSON.stringify(moduleUrl)};
    const value = resolveDateRange({
      startDateKey: "2026-03-07",
      endDateKey: "2026-03-09",
      todayDateKey: "2026-03-09",
    });
    process.stdout.write(JSON.stringify(value.days.map(day => day.endedAt - day.startedAt)));
  `;
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(result), [86_400_000, 82_800_000, 86_400_000]);
});
```

- [ ] **Step 2: Write failing generic-report tests**

Extend `tests/report.test.js` with a range that excludes today and separate visit arrays. Assert the range summary and today summary cannot be accidentally interchanged:

```js
function visitAt(id, openedAt, durationMs) {
  const endedAt = openedAt + durationMs;
  return {
    id,
    siteId: "s1",
    openedAt,
    endedAt,
    activeIntervals: [{ startedAt: openedAt, endedAt }],
    lastConfirmedAt: endedAt,
    lastActivityAt: endedAt,
  };
}

test("returns range days and an independent today summary", () => {
  const now = new Date(2026, 8, 2, 12).getTime();
  const rangeWindow = resolveDateRange({
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
    todayDateKey: "2026-09-02",
  });
  const todayWindow = resolveDateRange({
    startDateKey: "2026-09-02",
    endDateKey: "2026-09-02",
    todayDateKey: "2026-09-02",
  });
  const report = aggregateReport({
    rangeVisits: [visitAt("historical", new Date(2026, 7, 1, 9).getTime(), 5_000)],
    todayVisits: [visitAt("today", new Date(2026, 8, 2, 10).getTime(), 7_000)],
  }, {
    now,
    rangeWindow,
    todayWindow,
    selectedDateKey: "2026-08-02",
  });

  assert.deepEqual(report.range, {
    startDateKey: "2026-08-01",
    endDateKey: "2026-08-02",
  });
  assert.deepEqual(report.todaySummary, { openCount: 1, activeMs: 7_000 });
  assert.deepEqual(report.days.map(day => day.openCount), [1, 0]);
  assert.deepEqual(report.details, []);
  assert.equal("totals" in report, false);
});
```

Keep and adapt the existing assertions that a cross-midnight interval splits by local day, a visit opened before the window contributes overlapping duration but not an open, open intervals stop at `lastConfirmedAt`, details are newest first, and all-zero windows retain every day.

- [ ] **Step 3: Run the focused tests and confirm the new module/API is absent**

Run:

```bash
node --test tests/local-date-range.test.js tests/report.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `local-date-range.js` or a missing `aggregateReport` export.

- [ ] **Step 4: Implement strict local date parsing and calendar iteration**

Use a field round-trip, not permissive `Date` string parsing. The core must follow this shape:

```js
export function localDateKey(at) {
  const date = new Date(at);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey) {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function nextLocalMidnight(at) {
  const date = new Date(at);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime();
}

export class DateRangeError extends RangeError {
  constructor(code) {
    super(DATE_RANGE_ERROR_MESSAGES[code]);
    this.name = "DateRangeError";
    this.code = code;
  }
}

export function resolveDateRange({ startDateKey, endDateKey, todayDateKey }) {
  const startAt = parseLocalDateKey(startDateKey);
  const endStartedAt = parseLocalDateKey(endDateKey);
  const todayAt = parseLocalDateKey(todayDateKey);
  if (startAt === null || endStartedAt === null || todayAt === null) {
    throw new DateRangeError("INVALID_DATE_RANGE");
  }
  if (startAt > endStartedAt) {
    throw new DateRangeError("START_AFTER_END");
  }
  if (endStartedAt > todayAt) {
    throw new DateRangeError("END_AFTER_TODAY");
  }

  const days = [];
  let startedAt = startAt;
  while (startedAt <= endStartedAt && days.length <= 30) {
    const endedAt = nextLocalMidnight(startedAt);
    days.push({ dateKey: localDateKey(startedAt), startedAt, endedAt });
    startedAt = endedAt;
  }
  if (days.length > 30 || startedAt <= endStartedAt) {
    throw new DateRangeError("RANGE_TOO_LONG");
  }
  return {
    startDateKey,
    endDateKey,
    startAt,
    endAt: days.at(-1).endedAt,
    dayCount: days.length,
    days,
  };
}

export function getRollingDateRange(now, dayCount = 14) {
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 30) {
    throw new RangeError("dayCount must be an integer from 1 through 30");
  }
  const today = new Date(now);
  const startedAt = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - dayCount + 1,
  ).getTime();
  return {
    startDateKey: localDateKey(startedAt),
    endDateKey: localDateKey(now),
  };
}
```

- [ ] **Step 5: Implement generic aggregation and thin V1 compatibility wrappers**

Refactor the existing daily accumulation into one helper that accepts a `DateWindow`. Call it once for `rangeVisits/rangeWindow` and once for `todayVisits/todayWindow`, then construct only the V1.1 result fields:

```js
export function aggregateReport(
  { rangeVisits, todayVisits },
  { now, rangeWindow, todayWindow, selectedDateKey },
) {
  const days = aggregateDays(rangeVisits, rangeWindow, now);
  const [today] = aggregateDays(todayVisits, todayWindow, now);
  return {
    range: {
      startDateKey: rangeWindow.startDateKey,
      endDateKey: rangeWindow.endDateKey,
    },
    todaySummary: { openCount: today.openCount, activeMs: today.activeMs },
    days,
    selectedDateKey,
    details: selectedDetails(rangeVisits, selectedDateKey, now),
  };
}
```

`aggregateDays(visits, window, now)` must initialize every window day to zero, count `openedAt` only when its key exists, clip each effective interval to `[window.startAt, window.endAt)`, split it with `splitIntervalByLocalDay()` and add each part to its matching day. `selectedDetails(visits, selectedDateKey, now)` must filter by the opened-day key, sort `openedAt` descending and map the existing detail fields.

The temporary `aggregateSevenDayReport()` wrapper must call `getRollingDateRange(now, 7)`, resolve that window, pass the same visits as range/today input, and return its legacy result with `totals` computed by reducing the seven returned days. No new consumer may use the wrapper.

During this task only, `src/domain/report.js` must contain `export { localDateKey } from "./local-date-range.js";` for existing imports. New/updated tests import date functions directly from `local-date-range.js`.

- [ ] **Step 6: Run focused and full regression tests**

Run:

```bash
node --test tests/local-date-range.test.js tests/report.test.js
npm test
```

Expected: all date/report tests and the unchanged V1 suite PASS.

- [ ] **Step 7: Commit the pure date/report boundary**

```bash
git add src/domain/local-date-range.js src/domain/report.js tests/local-date-range.test.js tests/report.test.js
git commit -m "feat: 泛化本地日期范围与报表聚合"
```

### Task 2: Query every visit that can intersect a historical window

**Files:**
- Modify: `src/storage/tracking-repository.js`
- Modify: `tests/storage.test.js`

**Interfaces:**
- Consumes: unchanged IndexedDB `visits` indexes `bySiteOpenedAt` and `bySiteLastActivityAt`.
- Produces: unchanged `queryVisitsForReport(siteId, rangeStart, rangeEnd)` signature with complete overlap semantics and ID de-duplication.

- [ ] **Step 1: Add failing spanning and future-only query cases**

Replace the existing range-union fixture with records that distinguish `lastActivityAt` inside the window from a visit spanning beyond it:

```js
test("queries every possible window overlap and excludes future-only visits", async () => {
  const repository = await makeTrackingRepository();
  const records = [
    visitWith("opened-inside", { openedAt: 200, lastActivityAt: 300 }),
    visitWith("active-inside", { openedAt: 100, lastActivityAt: 400 }),
    visitWith("spans-beyond", { openedAt: 100, lastActivityAt: 800 }),
    visitWith("ended-before", { openedAt: 100, lastActivityAt: 199 }),
    visitWith("future-only", { openedAt: 500, lastActivityAt: 800 }),
    visitWith("other-site", { siteId: "s2", openedAt: 300, lastActivityAt: 400 }),
  ];
  await repository.commit({ putVisits: records, deleteSiteIds: [], checkpoint });

  const result = await repository.queryVisitsForReport("s1", 200, 500);

  assert.deepEqual(result.map(item => item.id).sort(), [
    "active-inside", "opened-inside", "spans-beyond",
  ]);
  assert.equal(new Set(result.map(item => item.id)).size, result.length);
});
```

This assertion protects visits opened before `rangeStart` whose `lastActivityAt` is after `rangeEnd`; aggregators later clip their actual intervals to the selected window.

- [ ] **Step 2: Run the storage test and verify the spanning record is missing**

Run: `node --test tests/storage.test.js`

Expected: FAIL because the current bounded `bySiteLastActivityAt` query omits `spans-beyond`.

- [ ] **Step 3: Widen only the last-activity index scan and filter future opens**

Keep the opened-at query bounded to `[rangeStart, rangeEnd)`. Query `bySiteLastActivityAt` from `rangeStart` through `Number.MAX_SAFE_INTEGER`, then discard candidates whose `openedAt >= rangeEnd` before de-duplicating:

```js
const [openedInRange, activeAfterStart] = await Promise.all([
  queryIndex(visits.index("bySiteOpenedAt"), siteId, rangeStart, rangeEnd),
  queryIndex(
    visits.index("bySiteLastActivityAt"),
    siteId,
    rangeStart,
    Number.MAX_SAFE_INTEGER,
  ),
  completion,
]);

for (const item of [
  ...openedInRange,
  ...activeAfterStart.filter(visit => visit.openedAt < rangeEnd),
]) {
  byId.set(item.id, item);
}
```

Do not alter `openWebTraceDb`, the database version, store names, key paths or indexes.

- [ ] **Step 4: Run storage and full tests**

Run:

```bash
node --test tests/storage.test.js
npm test
```

Expected: overlap, upper-bound, other-site, schema, transaction and full regression tests PASS.

- [ ] **Step 5: Commit the repository query fix**

```bash
git add src/storage/tracking-repository.js tests/storage.test.js
git commit -m "fix: 完整查询历史日期窗口相交访问"
```

### Task 3: Add range-aware analysis queries and controller state

**Files:**
- Modify: `src/analysis/data-source.js`
- Modify: `src/analysis/controller.js`
- Modify: `tests/analysis-controller.test.js`
- Create: `tests/analysis-data-source.test.js`
- Modify: `src/domain/report.js`
- Modify: `tests/helpers/webtrace-harness.js`

**Interfaces:**
- Consumes: `getRollingDateRange`, `localDateKey`, `resolveDateRange`, `aggregateReport`, complete repository overlap query.
- Produces: `dataSource.getReport(siteId, { startDateKey, endDateKey, selectedDateKey })`, controller `applyDateRange`, `AppliedDateRange`, separate `rangeError`.
- Removes: the `localDateKey` re-export plus `getSevenDayWindow` and `aggregateSevenDayReport` compatibility exports after all production consumers migrate.

- [ ] **Step 1: Write data-source tests for one-query reuse and two-window history**

Create `tests/analysis-data-source.test.js` with small recording repositories. The first test proves that a range containing today reuses one visit result:

```js
test("reuses the selected query when its range contains today", async () => {
  const harness = createDataSourceHarness({ now: new Date(2026, 8, 2, 12).getTime() });
  const report = await harness.dataSource.getReport("s1", {
    startDateKey: "2026-08-20",
    endDateKey: "2026-09-02",
    selectedDateKey: "2026-09-02",
  });
  assert.deepEqual(harness.queryCalls, [{
    siteId: "s1",
    rangeStart: new Date(2026, 7, 20).getTime(),
    rangeEnd: new Date(2026, 8, 3).getTime(),
  }]);
  assert.equal(report.days.length, 14);
});
```

The second test proves an old two-day range and today are queried independently, with no single window spanning the gap:

```js
test("queries an excluded today as its own one-day window", async () => {
  const harness = createDataSourceHarness({ now: new Date(2026, 8, 2, 12).getTime() });
  const report = await harness.dataSource.getReport("s1", {
    startDateKey: "2026-01-01",
    endDateKey: "2026-01-02",
    selectedDateKey: "2026-01-02",
  });
  assert.deepEqual(harness.queryCalls, [
    {
      siteId: "s1",
      rangeStart: new Date(2026, 0, 1).getTime(),
      rangeEnd: new Date(2026, 0, 3).getTime(),
    },
    {
      siteId: "s1",
      rangeStart: new Date(2026, 8, 2).getTime(),
      rangeEnd: new Date(2026, 8, 3).getTime(),
    },
  ]);
  assert.deepEqual(report.range, {
    startDateKey: "2026-01-01",
    endDateKey: "2026-01-02",
  });
});
```

Move the current command-envelope assertions into this file unchanged, including the temporary set-enabled case, so Task 3 remains independently green. Task 4 removes that case together with the production constant and method.

- [ ] **Step 2: Write controller tests for default, valid, and invalid ranges**

Update the controller harness so `getReport()` records the complete options object. Freeze the local clock at `new Date(2026, 8, 1, 12).getTime()` and assert initialization yields the rolling 14-day state:

```js
await controller.initialize();
assert.deepEqual(view.lastModel.appliedRange, {
  startDateKey: "2026-08-19",
  endDateKey: "2026-09-01",
  mode: "ROLLING",
});
assert.equal(view.lastModel.todayDateKey, "2026-09-01");
assert.equal(view.lastModel.selectedDateKey, "2026-09-01");
assert.equal(view.lastModel.report.days.length, 14);
```

For each stable invalid case, snapshot the applied range, selected date, report and report-call count, submit the invalid input, then assert they are unchanged:

```js
const before = structuredClone(view.lastModel);
const callCount = reportCalls.length;
await controller.applyDateRange({
  startDateKey: "2026-09-02",
  endDateKey: "2026-09-01",
});
assert.deepEqual(view.lastModel.appliedRange, before.appliedRange);
assert.equal(view.lastModel.selectedDateKey, before.selectedDateKey);
assert.deepEqual(view.lastModel.report, before.report);
assert.equal(reportCalls.length, callCount);
assert.equal(view.lastModel.rangeError.message, "起始日期不能晚于终止日期");
```

Repeat with missing/impossible dates, a future end date and 31 days, asserting the exact messages from the shared contract.

- [ ] **Step 3: Write controller tests for selection, site comparison, and midnight**

Cover these state transitions explicitly:

```js
// Applying a range that retains the selected day.
await controller.selectDate("2026-08-29");
await controller.applyDateRange({
  startDateKey: "2026-08-20",
  endDateKey: "2026-08-31",
});
assert.equal(view.lastModel.selectedDateKey, "2026-08-29");
assert.equal(view.lastModel.appliedRange.mode, "CUSTOM");

// Applying a range that excludes it selects the new end.
await controller.applyDateRange({
  startDateKey: "2026-08-01",
  endDateKey: "2026-08-02",
});
assert.equal(view.lastModel.selectedDateKey, "2026-08-02");

// Switching sites preserves both the range and selected day.
await controller.selectSite("site-2");
assert.deepEqual(view.lastModel.appliedRange, {
  startDateKey: "2026-08-01",
  endDateKey: "2026-08-02",
  mode: "CUSTOM",
});
assert.equal(view.lastModel.selectedDateKey, "2026-08-02");
```

Use a mutable clock to cross local midnight. For a rolling range, the next refresh must advance both ends by one calendar day and retain a selected day still inside it. After any successful custom application, the same refresh must leave both ends fixed while `todaySummary` is queried for the new today.

Keep the existing tests that refreshes do not overlap, a queued refresh survives an earlier read rejection, rapid site selections cannot install stale reports, errors remain stable until a user action, and auto-refresh runs only while visible.

- [ ] **Step 4: Run the focused tests and observe the old signatures/state**

Run:

```bash
node --test tests/analysis-data-source.test.js tests/analysis-controller.test.js
```

Expected: FAIL because the data source accepts only `selectedDateKey`, the controller lacks `appliedRange/rangeError/applyDateRange`, and reports still use seven days.

- [ ] **Step 5: Implement exact range-aware data-source queries**

Resolve both windows before touching IndexedDB. When the selected window includes today, pass the same array as `rangeVisits` and `todayVisits`; otherwise launch the two non-contiguous queries together:

```js
async getReport(siteId, { startDateKey, endDateKey, selectedDateKey }) {
  const now = clock.now();
  const todayDateKey = localDateKey(now);
  const rangeWindow = resolveDateRange({ startDateKey, endDateKey, todayDateKey });
  const todayWindow = resolveDateRange({
    startDateKey: todayDateKey,
    endDateKey: todayDateKey,
    todayDateKey,
  });
  const rangePromise = trackingRepository.queryVisitsForReport(
    siteId,
    rangeWindow.startAt,
    rangeWindow.endAt,
  );
  const containsToday = rangeWindow.days.some(day => day.dateKey === todayDateKey);
  const [rangeVisits, todayVisits] = containsToday
    ? await rangePromise.then(visits => [visits, visits])
    : await Promise.all([
        rangePromise,
        trackingRepository.queryVisitsForReport(siteId, todayWindow.startAt, todayWindow.endAt),
      ]);
  return aggregateReport(
    { rangeVisits, todayVisits },
    { now, rangeWindow, todayWindow, selectedDateKey },
  );
}
```

Do not query one combined interval from a historical `startDateKey` through today.

- [ ] **Step 6: Implement applied-range controller transitions**

Initialize date state before the first site read. At the beginning of each refresh, set `state.todayDateKey = localDateKey(clock.now())`, then recompute only a `ROLLING` range if that key differs from its current end date. Use canonical report days, not string guesses, to validate `selectedDateKey` membership.

`applyDateRange()` must have this transaction order:

```js
function publicDateRangeError(error) {
  if (
    typeof error?.code === "string"
    && DATE_RANGE_ERROR_MESSAGES[error.code] === error.message
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "INVALID_DATE_RANGE",
    message: DATE_RANGE_ERROR_MESSAGES.INVALID_DATE_RANGE,
  };
}

async function applyDateRange({ startDateKey, endDateKey }) {
  beginUserAction();
  let window;
  try {
    window = resolveDateRange({
      startDateKey,
      endDateKey,
      todayDateKey: localDateKey(clock.now()),
    });
  } catch (error) {
    state.rangeError = publicDateRangeError(error);
    render();
    return null;
  }
  state.rangeError = null;
  state.appliedRange = { startDateKey, endDateKey, mode: "CUSTOM" };
  if (!window.days.some(day => day.dateKey === state.selectedDateKey)) {
    state.selectedDateKey = endDateKey;
  }
  render();
  await refresh();
  return state.report;
}
```

Changing websites must no longer reset `selectedDateKey` to today. It may fall back only when the date is outside the applied range. A report read failure must leave the last complete report in state, expose the existing stable page error and allow `refresh()` to retry.

- [ ] **Step 7: Remove V1 report compatibility and update harness calls**

Update `src/analysis/controller.js` and `tests/helpers/webtrace-harness.js` to import `localDateKey/getRollingDateRange` from `src/domain/local-date-range.js`. Delete the `report.js` date re-export, `getSevenDayWindow()` and `aggregateSevenDayReport()` only after `src/analysis/data-source.js`, controller tests and the harness use the generic interfaces. Change the harness method to:

```js
getReport(siteId, {
  startDateKey = getRollingDateRange(clock.now()).startDateKey,
  endDateKey = localDateKey(clock.now()),
  selectedDateKey = endDateKey,
} = {}) {
  return dataSource.getReport(siteId, { startDateKey, endDateKey, selectedDateKey });
}
```

- [ ] **Step 8: Run focused and full tests**

Run:

```bash
node --test tests/local-date-range.test.js tests/report.test.js tests/storage.test.js tests/analysis-data-source.test.js tests/analysis-controller.test.js
npm test
```

Expected: the generic interface, date state, independent today query and all unchanged tracker/storage tests PASS.

- [ ] **Step 9: Commit analysis state and query behavior**

```bash
git add src/domain/report.js src/analysis/data-source.js src/analysis/controller.js tests/analysis-data-source.test.js tests/analysis-controller.test.js tests/helpers/webtrace-harness.js
git commit -m "feat: 添加自定义日期范围与今日概览状态"
```

### Task 4: Migrate every site to continuous tracking and remove pause/resume protocol

**Files:**
- Modify: `src/background/site-service.js`
- Modify: `src/shared/protocol.js`
- Modify: `src/background/chrome-events.js`
- Modify: `background.js`
- Modify: `src/analysis/data-source.js`
- Modify: `src/analysis/controller.js`
- Modify: `tests/site-service.test.js`
- Modify: `tests/chrome-events.test.js`
- Modify: `tests/analysis-data-source.test.js`
- Modify: `tests/analysis-controller.test.js`
- Modify: `tests/helpers/webtrace-harness.js`

**Interfaces:**
- Consumes: site repository, tracker `ready/updateSites/markSitesDirty/deleteSiteHistory`, existing serialized site-service queue.
- Produces: `migrateDisabledSites()` and a `lifecycleReady` gate shared by background events.
- Removes: `WEBTRACE_SET_SITE_ENABLED`, `setSiteEnabled()` in service/data source/controller/harness, and all trusted-command routing for it.

- [ ] **Step 1: Replace stop/resume service tests with idempotent migration tests**

Use one enabled and one disabled record. The first migration must preserve every non-`enabled` field, write once, and synchronize with no backfill; the second must do nothing:

```js
test("migrates disabled sites once without changing identity or backfilling", async () => {
  const disabled = {
    id: "site-1",
    name: "知乎",
    domain: "zhihu.com",
    enabled: false,
    createdAt: 100,
  };
  const { service, repository, tracker } = createHarness({ sites: [disabled] });

  const first = await service.migrateDisabledSites();
  const second = await service.migrateDisabledSites();

  assert.deepEqual(first, [{ ...disabled, enabled: true }]);
  assert.deepEqual(second, first);
  assert.deepEqual(repository.replaceCalls, [[{ ...disabled, enabled: true }]]);
  assert.deepEqual(tracker.deleteSiteHistoryCalls, []);
  assert.deepEqual(tracker.updateSitesCalls, [{
    sites: [{ ...disabled, enabled: true }],
    options: { at: 1_000, allowBackfill: false },
  }]);
});
```

Keep the add-site, duplicate, serialization, saved-config-authority, delete-only-history and stable-error tests. Update the delete test to assert the returned configuration is `enabled: true` and remains so after later visits.

- [ ] **Step 2: Write protocol-removal and lifecycle-gate tests**

In `tests/chrome-events.test.js`, remove the successful set-enabled command case and assert a legacy message is now unknown:

```js
const [listenerReturn] = await harness.events.runtimeOnMessage.emit(
  { type: "WEBTRACE_SET_SITE_ENABLED", siteId: "site-1", enabled: false },
  { url: "chrome-extension://test/analysis.html" },
  response => responses.push(response),
);
assert.equal(listenerReturn, false);
assert.deepEqual(responses, []);
```

Inject a deferred `lifecycleReady`, emit a visibility event, a navigation and a trusted delete command, and assert tracker/service calls remain empty until the gate resolves. Listener registration itself must remain synchronous.

- [ ] **Step 3: Write a real background migration/no-backfill test**

Extend the existing dynamic `background.js` test with local storage containing a disabled site and a normal Chrome window whose current tab is already on that site. After `backgroundReady`:

```js
assert.equal(storageState.local.webtraceSitesV1[0].enabled, true);
const database = await openWebTraceDb(factory);
const records = createTrackingRepository(database);
assert.deepEqual(
  await records.queryVisitsForReport("site-1", 0, Number.MAX_SAFE_INTEGER),
  [],
);
```

Emit a same-site commit and assert it still does not create a visit. Then emit a commit to `https://example.org/` followed by a commit back to the configured domain and assert exactly one new visit. This proves the actual composition, not only a mocked `allowBackfill` argument.

- [ ] **Step 4: Run focused tests and confirm old APIs still exist**

Run:

```bash
node --test tests/site-service.test.js tests/chrome-events.test.js tests/analysis-data-source.test.js tests/analysis-controller.test.js
```

Expected: FAIL because migration and `lifecycleReady` are absent and the old command is still accepted.

- [ ] **Step 5: Implement migration inside the existing serialized site service**

Use the same operation queue and synchronization function as `addSite()`:

```js
migrateDisabledSites() {
  return enqueue(async () => {
    const sites = await siteRepository.list();
    if (sites.every(site => site.enabled === true)) {
      return copy(sites);
    }
    const nextSites = sites.map(site => ({ ...site, enabled: true }));
    const at = clock.now();
    await siteRepository.replace(copy(nextSites));
    await synchronizeSavedSites(nextSites, at);
    return copy(nextSites);
  });
}
```

If tracker synchronization fails after persistence, preserve the existing `SITE_STATE_SYNC_FAILED` and `markSitesDirty(nextSites)` behavior; the next service-worker start sees the already-enabled authoritative configuration.

- [ ] **Step 6: Gate background lifecycle on migration without delaying listener registration**

Create the tracker and site service synchronously, then form the exported gate:

```js
const tracker = createTracker(/* existing dependencies */);
const siteService = createSiteService(/* existing dependencies */);
export const backgroundReady = tracker.ready.then(() => siteService.migrateDisabledSites());

registerChromeEvents({
  chrome: chromeApi,
  tracker,
  siteService,
  clock,
  lifecycleReady: backgroundReady,
  reportError,
});
```

`registerChromeEvents()` must still attach every listener immediately. Its internal `reserveLifecycle()` waits `lifecycleReady ?? tracker.ready`. Route toolbar opening through the same reservation so the normal analysis-page entry cannot race the migration; analysis-page registration may remain a lightweight session operation.

- [ ] **Step 7: Remove the command from every production boundary**

Delete the protocol constant, `siteCommandFor` branch, service method, data-source method and controller method. Remove it from constructor validation and all fake service call logs. Do not remove `Site.enabled`, enabled checks in tracker/runtime, or the migration input path; they remain compatibility safeguards.

- [ ] **Step 8: Run focused, full, and static protocol checks**

Run:

```bash
node --test tests/site-service.test.js tests/chrome-events.test.js tests/analysis-data-source.test.js tests/analysis-controller.test.js
npm test
rg -n "WEBTRACE_SET_SITE_ENABLED|setSiteEnabled" background.js analysis.js src
```

Expected: tests PASS and `rg` returns no production match.

- [ ] **Step 9: Commit continuous-tracking migration**

```bash
git add background.js src/background/site-service.js src/background/chrome-events.js src/shared/protocol.js src/analysis/data-source.js src/analysis/controller.js tests/site-service.test.js tests/chrome-events.test.js tests/analysis-data-source.test.js tests/analysis-controller.test.js tests/helpers/webtrace-harness.js
git commit -m "feat: 迁移网站为持续统计并移除暂停协议"
```

### Task 5: Replace the analysis UI with date controls and accessible SVG line charts

**Files:**
- Modify: `analysis.html`
- Modify: `analysis.css`
- Modify: `analysis.js`
- Modify: `src/analysis/view.js`
- Modify: `tests/analysis-controller.test.js`
- Create: `tests/analysis-view.test.js`

**Interfaces:**
- Consumes: controller `applyDateRange/selectDate`, V1.1 view model and `Report`.
- Produces: a stable `date-range` region, two SVG/DOM line charts, native button data points, today-summary cards and continuous-tracking management copy.
- Test organization: move the existing fake-DOM and view-only cases out of `tests/analysis-controller.test.js` into `tests/analysis-view.test.js`; leave controller behavior tests in the original file.

- [ ] **Step 1: Write failing page-structure and date-form tests**

In `tests/analysis-view.test.js`, read `analysis.html` and assert stable order:

```js
const html = await readFile("analysis.html", "utf8");
const ids = ["summary", "date-range", "open-chart", "duration-chart", "visit-details"];
assert.deepEqual(
  [...ids].sort((left, right) => html.indexOf(`id="${left}"`) - html.indexOf(`id="${right}"`)),
  ids,
);
assert.match(html, /id="summary"[^>]+aria-label="今日概览"/);
assert.match(html, /id="date-range"[^>]+aria-label="日期范围"/);
```

Extend the fake document IDs with `date-range` and give it `createElementNS(namespace, tagName)`. Bind `applyDateRange`, edit both `input[type=date]` values, and assert input alone makes no call while form submission makes exactly one call with both keys. Render a `rangeError` and assert the nearby node has `role="alert"` and the exact stable message.

- [ ] **Step 2: Write failing line-chart, zero, 14-day and 30-day tests**

Render a 14-day report and assert each chart contains one SVG polyline and 14 native button data points in identical date order:

```js
const openPoints = byDataset(openChart, "dateKey");
const durationPoints = byDataset(durationChart, "dateKey");
assert.equal(openPoints.length, 14);
assert.equal(durationPoints.length, 14);
assert.ok(openPoints.every(point => point.tagName === "BUTTON"));
assert.deepEqual(openPoints.map(point => point.dataset.dateKey), days.map(day => day.dateKey));
assert.match(openPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*2 次/);
assert.match(durationPoints.at(-1).getAttribute("aria-label"), /2026-09-02.*02:02:02/);
assert.equal(openPoints.at(-1).getAttribute("aria-pressed"), "true");
```

For an all-zero range, assert the SVG `points` all share the baseline y-coordinate and the complete date sequence remains. For 30 days, inspect `data-label-visible`: first, last and selected must be `true`, visible labels must be fewer than 30, and every data-point button/accessible name must remain.

Click a point in either chart and assert the bound controller receives its date. Native `<button type="button">` is the keyboard activation contract; do not replace points with focusable SVG circles requiring custom key handling.

- [ ] **Step 3: Write failing summary and continuous-management tests**

Render a report whose sum across `days` differs from `todaySummary`. Assert the summary says `今日概览` and displays only today's count/duration. Assert sidebars and manager rows contain name/domain but none of `统计中`, `已停用`, `停止统计` or `恢复统计`.

Open deletion confirmation and assert the complete warning:

```text
现有访问记录会永久删除且无法撤销。网站配置会保留；删除后网站仍会持续统计，新访问会再次产生记录。
```

Keep the explicit cancel/confirm behavior, dialog error mirroring, pending-control disabling, form preservation and focus restoration cases from the V1 view tests.

- [ ] **Step 4: Run view and controller tests and confirm old markup**

Run:

```bash
node --test tests/analysis-view.test.js tests/analysis-controller.test.js
```

Expected: FAIL because the page has no date region, summary reads range totals, charts render bars and management still exposes enabled state.

- [ ] **Step 5: Add stable date and vertical chart regions**

Change the relevant HTML body to this order:

```html
<section id="summary" class="panel" aria-label="今日概览"></section>
<section id="date-range" class="panel" aria-label="日期范围"></section>
<div class="trend-stack">
  <section id="open-chart" class="panel" aria-label="每日打开次数"></section>
  <section id="duration-chart" class="panel" aria-label="每日有效使用时长"></section>
</div>
```

The view constructs one date form with `startDateKey`, `endDateKey` and submit button. Track the last rendered applied-range key; update input values only on first render or when the applied range changes. This preserves unsubmitted edits across 4-second report refreshes. Always set both inputs' `max` to `model.todayDateKey`, and update pending state and the range-error alert.

- [ ] **Step 6: Render line geometry with packaged SVG plus DOM buttons**

Use `createElementNS("http://www.w3.org/2000/svg", ...)` only for a decorative baseline and polyline. Put interactive points in a DOM overlay:

```js
function pointPosition(index, count, value, maximum) {
  const x = count === 1 ? 50 : (index / (count - 1)) * 100;
  const y = maximum === 0 ? 84 : 84 - (value / maximum) * 68;
  return { x, y };
}

const button = element(document, "button", { className: "chart-point" });
button.type = "button";
button.dataset.dateKey = day.dateKey;
button.dataset.labelVisible = String(labelIndexes.has(index));
button.style.setProperty("--point-x", String(x));
button.style.setProperty("--point-y", String(y));
button.setAttribute("aria-pressed", String(day.dateKey === model.selectedDateKey));
button.setAttribute("aria-label", `${day.dateKey}，${formattedValue}${unit}`);
button.addEventListener("click", () => controller?.selectDate(day.dateKey));
```

For 1–14 days, `labelIndexes` contains every index. For 15–30 days, include index 0, the last index, the selected index and every `Math.ceil(dayCount / 10)`th index. Each button contains a tooltip with full date/value; CSS reveals it on `:hover`, `:focus-visible` and `[aria-pressed="true"]`.

The two charts compute y scales independently but receive identical dates and selected state. Zero values remain on the baseline. The SVG is `aria-hidden="true"`; buttons provide the accessible names.

- [ ] **Step 7: Update summary, manager and responsive styles**

Read cards from `model.report?.todaySummary ?? { openCount: 0, activeMs: 0 }`. Remove status badges and toggle buttons. Add the exact manager hint `网站添加后将持续统计` and the new deletion warning.

Replace `.chart-grid`, `.trend-chart`, `.chart-day`, `.chart-track`, `.chart-bar` and `--bar-height` rules with `.trend-stack`, `.line-chart`, `.trend-line`, `.chart-points`, `.chart-point`, `.chart-tooltip` and label rules. `.trend-stack` is one column at every viewport width; keep the existing desktop sidebar and small-screen collapse. Selected points and keyboard focus must have shape/outline/text cues, not color alone.

- [ ] **Step 8: Update fallback composition and preserve safe DOM construction**

Add `todayDateKey: null`, `appliedRange: null` and `rangeError: null` to the `analysis.js` fatal-load fallback model. View functions must continue using `textContent`, `setAttribute` and node construction; no user-derived value may enter `innerHTML` or SVG markup strings.

- [ ] **Step 9: Run focused, full, and static UI checks**

Run:

```bash
node --test tests/analysis-view.test.js tests/analysis-controller.test.js
npm test
rg -n "chart-bar|--bar-height|停止统计|恢复统计|最近 7 天合计" analysis.html analysis.css analysis.js src/analysis
rg -n "(src|href)=['\"]https?://" analysis.html
```

Expected: tests PASS and both scans return no obsolete production UI or remote resource reference.

- [ ] **Step 10: Commit the analysis UI**

```bash
git add analysis.html analysis.css analysis.js src/analysis/view.js tests/analysis-view.test.js tests/analysis-controller.test.js
git commit -m "feat: 添加日期控件与无障碍折线图"
```

### Task 6: Prove the integrated V1.1 flow and update the extension version

**Files:**
- Modify: `manifest.json`
- Modify: `tests/manifest.test.js`
- Modify: `tests/helpers/webtrace-harness.js`
- Modify: `tests/webtrace-flow.test.js`

**Interfaces:**
- Consumes: all production modules from Tasks 1–5.
- Produces: manifest `1.1.0`, unchanged permission assertions and an end-to-end deterministic V1.1 flow.

- [ ] **Step 1: Strengthen the manifest regression test before changing the version**

Add the exact version assertion while retaining every existing permission/content-script assertion:

```js
assert.equal(manifest.version, "1.1.0");
assert.deepEqual([...manifest.permissions].sort(), [
  "idle", "storage", "unlimitedStorage", "webNavigation",
]);
assert.deepEqual([...manifest.host_permissions].sort(), ["http://*/*", "https://*/*"]);
assert.deepEqual([...manifest.content_scripts[0].matches].sort(), [
  "http://*/*", "https://*/*",
]);
```

- [ ] **Step 2: Replace V1 pause/resume flow steps with V1.1 range and continuous-history steps**

Keep the real fake-Chrome → event bridge → tracker → fake IndexedDB → data-source path. Preserve assertions for add/no-backfill, leave/return opening, refresh/inside-site/subdomain no-extra-open, child inheritance, non-overlapping time, midnight split, end/re-entry, visibility, non-HTTP departure and deletion.

Replace stop/resume calls with these V1.1 assertions:

```js
const reportNow = new Date(2026, 7, 31, 12).getTime();
await harness.advanceTo(reportNow);
const defaultReport = await harness.getReport(site.id);
assert.equal(defaultReport.days.length, 14);
assert.deepEqual(defaultReport.range, {
  startDateKey: getRollingDateRange(reportNow).startDateKey,
  endDateKey: localDateKey(reportNow),
});

const historical = await harness.getReport(site.id, {
  startDateKey: "2026-08-01",
  endDateKey: "2026-08-30",
  selectedDateKey: "2026-08-30",
});
assert.equal(historical.days.length, 30);
assert.deepEqual(historical.todaySummary, defaultReport.todaySummary);

await harness.deleteHistory(site.id);
assert.deepEqual((await harness.listSites()), [{ ...site, enabled: true }]);
assert.ok((await harness.getReport(site.id)).days.every(
  day => day.openCount === 0 && day.activeMs === 0,
));
await harness.navigate(1, "https://example.org/");
await harness.navigate(1, "https://www.zhihu.com/");
assert.equal((await harness.getVisits(site.id)).length, 1);
```

Assert after each transition rather than only at test end.

- [ ] **Step 3: Run the focused tests and observe the old version/flow**

Run:

```bash
node --test tests/manifest.test.js tests/webtrace-flow.test.js
```

Expected: FAIL on manifest `1.0.0` or obsolete harness methods until the fixture is migrated.

- [ ] **Step 4: Set the extension version and complete harness migration**

Change only `manifest.json` version to `1.1.0`; do not change `minimum_chrome_version`, permissions, host permissions, content scripts, background or action declarations. Remove `setSiteEnabled()` from the end-to-end harness and expose the range-aware `getReport()` contract defined in Task 3.

- [ ] **Step 5: Run integration and full regression suites**

Run:

```bash
node --test tests/manifest.test.js tests/webtrace-flow.test.js tests/chrome-events.test.js
npm test
```

Expected: integrated V1.1 flow and every unchanged V1 opening/timing/recovery/storage test PASS.

- [ ] **Step 6: Commit version and integrated acceptance coverage**

```bash
git add manifest.json tests/manifest.test.js tests/helpers/webtrace-harness.js tests/webtrace-flow.test.js
git commit -m "test: 覆盖 WebTrace V1.1 集成流程"
```

### Task 7: Remove custom date selection and fix the analysis page to rolling 14 days

**Files:**
- Modify: `analysis.html`
- Modify: `analysis.css`
- Modify: `analysis.js`
- Modify: `src/analysis/controller.js`
- Modify: `src/analysis/view.js`
- Modify: `tests/analysis-controller.test.js`
- Modify: `tests/analysis-view.test.js`
- Modify: `tests/webtrace-flow.test.js`

**Interfaces:**
- Consumes: `getRollingDateRange(clock.now())`, range-aware `dataSource.getReport()` and the existing `Report`/line-chart interfaces.
- Produces: a controller that always queries the current rolling 14 local days and a view with no date inputs, submit action or range-error state.

- [ ] **Step 1: Write focused failing controller and view tests**

Update the controller test harness so initialization, site switching and post-midnight refresh assert literal rolling 14-day query options. Add these consumer-visible assertions:

```js
assert.equal("applyDateRange" in controller, false);
assert.equal(view.lastModel.appliedRange, undefined);
assert.equal(view.lastModel.rangeError, undefined);
assert.deepEqual(reportCalls.at(-1).options, {
  startDateKey: "2026-08-20",
  endDateKey: "2026-09-02",
  selectedDateKey: "2026-09-02",
});
```

Update the view test's required region list to omit `date-range`; assert the real `analysis.html` has no date region or `input[type=date]`, and render a normal report without `appliedRange`, `rangeError` or `applyDateRange`. Keep the real SVG point click/keyboard and synchronized selection assertions.

Update the integrated flow so its user-facing acceptance asserts only the default report has exactly 14 days ending today; remove the historical 30-day product-flow assertion while retaining lower-level range coverage in domain and data-source tests.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/analysis-controller.test.js tests/analysis-view.test.js tests/webtrace-flow.test.js
```

Expected: FAIL because the controller still exposes custom-range state/action and the page still requires/renders the date form.

- [ ] **Step 3: Implement the fixed 14-day product flow**

In `src/analysis/controller.js`, remove `DATE_RANGE_ERROR_MESSAGES`, `resolveDateRange`, `publicDateRangeError`, `appliedRange`, `rangeError` and `applyDateRange`. In every `loadReport()` call compute:

```js
const range = getRollingDateRange(clock.now());
await dataSource.getReport(state.selectedSiteId, {
  ...range,
  selectedDateKey: state.selectedDateKey,
});
```

Keep `selectedDateKey` when it remains in the returned 14 days; otherwise select the returned range end. Continue updating `todayDateKey` on refresh.

Remove the `date-range` section from `analysis.html`, its selectors and responsive rules from `analysis.css`, the fatal fallback fields from `analysis.js`, and all date-form construction/rendering from `src/analysis/view.js`. Do not change the range-aware domain/data-source contracts, storage retention, line-chart selection or accessibility.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test tests/analysis-controller.test.js tests/analysis-view.test.js tests/webtrace-flow.test.js
```

Expected: every focused controller, view and integration test PASS.

- [ ] **Step 5: Run full regression and removed-UI checks**

Run:

```bash
npm test
node --check analysis.js
rg -n "date-range|applyDateRange|appliedRange|rangeError|起始日期|终止日期|日期范围最多" analysis.html analysis.css analysis.js src/analysis
git diff --check
```

Expected: every automated test passes, syntax and whitespace checks pass, and the removed-UI scan returns no production match.

- [ ] **Step 6: Commit the confirmed product adjustment**

```bash
git add analysis.html analysis.css analysis.js src/analysis/controller.js src/analysis/view.js tests/analysis-controller.test.js tests/analysis-view.test.js tests/webtrace-flow.test.js
git commit -m "feat: 固定展示最近十四天趋势"
```

### Task 8: Run real Chrome acceptance, update current facts, and archive the Change

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/current/project.md`
- Move: `docs/changes/2026-09-02-webtrace-v1-1-spec.md` → `docs/archive/2026-09/2026-09-02-webtrace-v1-1-spec.md`
- Move: `docs/changes/2026-09-02-webtrace-v1-1-plan.md` → `docs/archive/2026-09/2026-09-02-webtrace-v1-1-plan.md`

**Interfaces:**
- Consumes: complete V1.1 implementation, spec acceptance criteria and repository documentation rules.
- Produces: reproducible automated evidence, dated real-Chrome evidence, accurate current documentation and an archived completed Change.

- [ ] **Step 1: Run dependency, full-test, syntax and manifest verification**

Run from the repository root:

```bash
npm ci
npm run vendor:tldts
git diff --exit-code -- vendor/tldts/index.esm.min.js vendor/tldts/LICENSE
npm test
find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check
node --check background.js
node --check content.js
node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'
```

Expected: vendored files have no diff, every automated test passes, every JavaScript file parses, and manifest JSON parses. Record the actual test count; do not copy V1's historical 123/123 count.

- [ ] **Step 2: Run privacy, permission and removed-feature static checks**

Run:

```bash
rg -n "fetch\(|XMLHttpRequest|WebSocket|EventSource" . --glob '*.js' --glob '!node_modules/**' --glob '!vendor/**'
rg -n "(src|href)=['\"]https?://" analysis.html
rg -n "WEBTRACE_SET_SITE_ENABLED|setSiteEnabled|停止统计|恢复统计|最近 7 天合计|chart-bar|--bar-height|date-range|applyDateRange|appliedRange|rangeError" background.js analysis.html analysis.css analysis.js src/analysis src/background src/shared
node --test tests/manifest.test.js
```

Expected: the three `rg` scans return no production match and the manifest test proves version `1.1.0` with the exact V1 permission/content-script scope.

- [ ] **Step 3: Reload the unpacked extension and perform real Chrome acceptance**

Use the current stable Google Chrome, reload this repository at `chrome://extensions`, and record the date, exact version from `chrome://version`, and PASS/FAIL/NOT RUN for every scenario:

1. First open shows today's overview and exactly the rolling 14 local dates for the selected site.
2. Both line charts are full-width and vertically stacked in a desktop window and a narrow window; all-zero dates remain visible.
3. The page has no date inputs, apply button or route to data older than the rolling 14 days.
4. Mouse click, Tab focus and Enter/Space activation on a point synchronize selection in both charts and update details; hover/focus/selected states expose full date/value.
5. Site management has no stop/resume/status control, says sites continue tracking, and a newly added site records only after leaving and returning.
6. A previously disabled V1 site becomes enabled after upgrade, retains history, does not backfill an already-open page, and records after leave/return.
7. History deletion requires the new confirmation, preserves the site, clears old report data, and a later leave/return creates a fresh visit.
8. Refresh, inside-site navigation, same-site child tabs, switching tabs/apps, minimize/restore, lock/unlock, service-worker restart, browser restart and repeated toolbar clicks retain the V1 opening/timing/recovery/reuse semantics.
9. Chrome's extension details show no permission increase compared with V1.

If a scenario fails, do not archive the Change. Add a focused automated regression in the owning task, fix it, rerun the complete automated verification, reload the extension and repeat the affected manual scenarios. If Chrome execution is unavailable, mark scenarios `NOT RUN`, leave the Change active and state that manual acceptance remains incomplete.

- [ ] **Step 4: Update README and current facts only from verified behavior**

Update root `README.md` to say fixed rolling 14 days, no date selector, today's overview, vertically stacked line charts and continuous tracking; remove the stop/resume, custom-range and fixed-seven-day wording.

Update `docs/current/project.md` with separate sections for:

- Implemented facts: V1.1 version, fixed rolling 14-day window, older retained data having no current UI entry, line-chart interaction/accessibility, persistent site enablement and unchanged storage/permission/privacy contracts.
- Effective decisions: current full HTTP/HTTPS permission and `webNavigation` remain accepted; narrower per-site permission work only begins after an actual store-review failure.
- Limits/risks: no view for dates older than 14 days, no cross-site/weekly/monthly report, broad host permission risk, long retention and any browser caveat observed in Step 3.
- Verification: exact commands, actual automated count, Chrome version/date and per-scenario PASS/FAIL/NOT RUN without presenting automation as hand verification.

Keep `docs/current/project.md` at or below 300 lines and update its `最后核验` date only when evidence was collected.

- [ ] **Step 5: Archive the completed Change and repair all links**

Only after every required completion condition is met, change the spec and plan status to completed, create `docs/archive/2026-09/`, move both files, change this plan's Spec link to the archive-relative path, update `docs/README.md` current/recent sections, and repair `docs/current/project.md` links.

Run:

```bash
test ! -e docs/changes/2026-09-02-webtrace-v1-1-spec.md
test ! -e docs/changes/2026-09-02-webtrace-v1-1-plan.md
test -e docs/archive/2026-09/2026-09-02-webtrace-v1-1-spec.md
test -e docs/archive/2026-09/2026-09-02-webtrace-v1-1-plan.md
rg -n "docs/changes/2026-09-02-webtrace-v1-1|changes/2026-09-02-webtrace-v1-1" README.md docs --glob '!docs/archive/**'
test "$(wc -l < docs/current/project.md)" -le 300
```

Expected: all path checks pass, the stale-link scan has no result and the current document stays within its line limit.

- [ ] **Step 6: Confirm the final worktree contains only intended V1.1 changes**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only files enumerated by this plan are changed; whitespace validation prints nothing; no password, token, key, cookie, real browsing record, `.env` value or generated local database is present.

- [ ] **Step 7: Commit verified documentation and Change archival**

```bash
git add README.md docs
git commit -m "docs: 更新 WebTrace V1.1 状态并归档变更"
```
