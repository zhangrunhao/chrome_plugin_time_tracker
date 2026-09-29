# 项目当前状态

> 最后更新：2026-09-29（Asia/Shanghai，时间轴交互与验证）；发布资料基线核验于 2026-09-03。

当前 WebTrace 支持配置多个网站，在本机记录有效打开和有效观看时长；分析页显示今日概览、每屏 14 个本地日的双线趋势和选中日期的逐次访问明细。时间轴支持每次前后移动一周和回到最新；悬停某条线会突出该指标及每天数值，浮层只显示完整日期。左侧网站列表支持长按排序，添加网站前显著披露本地数据处理并要求主动确认。2026-09-29 当前代码自动测试为 158/158，通过隔离 Chromium 专项验证；本次时间轴改动尚未经日常 Chrome 人工验收。

## 内容边界

本文只记录当前仍有效的实现事实、决定、风险和验证证据。已完成规格与实施过程见 [V1.1 归档规格](../archive/2026-09/2026-09-02-webtrace-v1-1-spec.md)、[V1.1 归档计划](../archive/2026-09/2026-09-02-webtrace-v1-1-plan.md)、[商店发布归档规格](../archive/2026-09/2026-09-03-webtrace-store-release-spec.md) 和 [商店发布归档计划](../archive/2026-09/2026-09-03-webtrace-store-release-plan.md)。涉及运行行为时，以当前代码、测试和当次验证为准。

## 已验证的实现事实

### 扩展与权限

- 扩展名称为 WebTrace，版本 `1.1.0`，采用 Chrome Manifest V3，最低 Chrome 版本为 102。
- 后台入口是模块型 service worker `background.js`；网页侧 `content.js` 只注入 HTTP/HTTPS 页面，不创建浮窗或其他可见 UI。
- 权限为 `idle`、`storage`、`unlimitedStorage` 和 `webNavigation`；主机访问范围为 `http://*/*` 与 `https://*/*`，与 V1 相同。
- manifest 提供 16、32、48、128 四种森林绿与暖象牙色品牌图标；128px 图标四周保留约 16px 透明边距。
- 扩展不申请 `tabs` 权限。工具栏图标打开或聚焦分析页；分析页用 `chrome.storage.session` 注册自身，关闭或导航离开时清除记录。
- `chrome.storage.local` 和 `chrome.storage.session` 在后台初始化时限制为 `TRUSTED_CONTEXTS`。

### 网站配置与持续统计

- 用户可以输入网站名称、域名或 HTTP/HTTPS 页面 URL；随扩展提供的 `tldts@7.4.11` 把输入离线归一化为可注册主域名。
- 添加网站表单显著说明记录的网站名称、主域名、打开/结束时间与有效观看区间，明确本地存储、用途、长期保留、删除方式和不上传/不共享规则，并链接公开隐私政策。确认框默认未选中；未确认时不会调用后台添加命令，成功添加后才清空表单。
- 一个配置匹配其主域名和全部子域名，不匹配仅字符串后缀相同的其他域名；无效地址、非 HTTP/HTTPS 地址、不可注册域名和重复域名会被拒绝。
- 左侧列表直接采用 `webtraceSitesV1` 数组顺序。鼠标可长按网站后拖动；触摸或笔输入从右侧把手长按拖动，以保留窄屏列表正文的原生横向滚动。
- 释放发生顺序变化的拖动后，分析页乐观更新并向受信任后台发送完整网站 ID 顺序。后台串行校验它是当前配置的精确排列后替换原数组，不改变网站字段和采集状态；取消或保存失败时重新采用权威存储顺序。
- 网站添加后持续统计，界面和消息协议不再提供停止、恢复或启用状态修改。`Site.enabled` 仅作为兼容字段保留且最终为 `true`。
- V1 中 `enabled: false` 的网站在后台启动时幂等迁移为 `true`；ID、名称、域名、创建时间和历史记录不变。
- 新增或迁移网站都不追溯已经打开的页面；只有离开后再次进入才产生新访问。
- 删除历史需要明确确认，只删除目标网站的访问记录并保留持续统计的网站配置。

### 打开与有效时长

- 从非目标网站进入目标网站会新建一条 `Visit`；刷新、站内跳转、跨子域名跳转和同站子标签继承不会增加打开次数。
- 只要仍有同一访问关联的目标标签页，访问保持进行中；最后一个关联标签离开或关闭时结束。
- 只有目标标签页是活动标签页、Chrome 窗口前台且未最小化、页面可见、设备未锁屏时才累计时长；普通无输入状态继续计时。
- 任一时刻最多一个 `ActiveInterval` 进行中。内容脚本每 4 秒发送可见页面确认，时间戳由后台产生。
- 打开次数按 `openedAt` 的本地日期归属；有效时长按本机日历午夜拆分。访问明细归属打开日并显示该次访问完整时长。

### 数据、事务与恢复

- 网站配置保存在 `chrome.storage.local` 的 `webtraceSitesV1`；标签页映射和轻量 checkpoint 镜像保存在 `chrome.storage.session`。
- 访问记录保存在 IndexedDB `webtrace` v1 的 `visits` store；索引为 `siteId + openedAt` 和 `siteId + lastActivityAt`。schema 和数据库版本未因 V1.1 改变。
- `Visit` 与 `ActiveInterval` 是打开次数、时长、趋势和明细的唯一事实来源；不写日汇总缓存。
- 报表窗口查询合并在窗口内打开的访问和在窗口前打开、但活动区间与窗口相交的访问，并按访问 ID 去重。
- IndexedDB 权威提交最多尝试 3 次，重试间隔为 50 ms 和 150 ms；失败时不替换内存中的已提交状态。
- service worker 重启时复用同会话 checkpoint，不新增打开；浏览器新会话截断旧访问并为实际恢复的目标页面创建新访问，不累计离线时间。
- 旧版 `chrome.storage.local.stats` 不读取、不写入，也不自动迁移或删除。

### 分析页与本地边界

- 分析页默认选择保存顺序中的第一个网站和今天；“今日概览”始终展示所选网站今天的打开次数和有效使用时长。
- 一张 SVG 图显示打开次数（绿色实线、左轴）和有效时长（棕色虚线、右轴）；两种指标独立缩放，默认展示今天及此前 13 个本地日，零值日期仍保留。
- “前一周”和“后一周”每次按本地日历移动 7 天；历史位置启用“后一周”和“回到最新”，到达今天后禁用这两个按钮，不能前进到未来。
- 历史窗口在自动刷新、跨午夜和切换网站时保持；最新窗口随本地日期滚动。翻页后仍在窗口内的选中日期保留，否则选中窗口末日；“回到最新”选中今天。
- 悬停折线、数据点或图例会突出整条指标和全部每日数值，另一指标淡化；图例和数据点可键盘聚焦。日期浮层只显示 `YYYY-MM-DD`，完整指标值保留在数据点的无障碍名称中。
- 每个折线数据点是可聚焦的原生按钮；鼠标或键盘触发后，两条线的选中日期同步并更新访问明细。右侧留白完整容纳时长刻度，宽屏无额外横向滚动条；窄屏在图内横向滚动，选点和数据刷新保留滚动位置。
- 连续翻周忽略过期读取结果；查询失败时保留已显示的窗口，报表和选中日期在全部读取成功后一起替换。
- 访问明细按图表选中的打开日期展示，记录按打开时间从新到旧排列；进行中记录显示“进行中”。
- 网站添加、排序和删除历史通过受信任扩展消息交给后台串行处理；网页上下文不能发送管理命令。
- 运行时代码不调用 `fetch`、`XMLHttpRequest`、`WebSocket` 或 `EventSource`，不加载远程资源，不保存完整 URL、路径、查询参数或网页标题。
- 访问记录默认长期保留，当前分析页可按周查询和展示最近 14 天以前的数据。

### 商店发布材料

- `store-assets/` 包含两张由真实扩展页面生成的 1280×800 截图和一张 440×280 宣传图；截图只使用 `github.com`、`developer.mozilla.org`、`wikipedia.org` 等合成配置与合成访问时间。
- `npm run capture:store` 使用 Playwright 自带 Chromium 和临时隔离 profile 重现截图，结束后删除 profile；不读取日常 Chrome 数据。
- `npm run render:icons` 从可审查的平面母版重现四种图标；宣传图母版由内置 ImageGen 生成，最终素材保存在仓库。
- [`store-publishing.md`](store-publishing.md) 是商店标题、摘要、详细描述、分类、语言、单一用途、权限理由、隐私实践、URL、测试说明和提交步骤的当前来源。
- 本机已生成 `release/webtrace-1.1.0.zip`，大小约 100 KiB，SHA-256 为 `a754b84f989382b6e28de0df0c2054427335bc648db86cb5b7e50b8dbb247e74`。包只含运行入口、`src`、`vendor` 和四种图标，`release/` 由 Git 忽略。
- `zhangrh.shop` 已公开部署[主页](https://zhangrh.shop/webtrace/)、[支持页](https://zhangrh.shop/webtrace/support/)和[隐私政策](https://zhangrh.shop/webtrace/privacy/)；2026-09-03 在桌面与 390px 视口核验三页、资源和内部链接，无鉴权、404、横向溢出或控制台错误。站点实现 revision 为 `0c83897`，文档收口 revision 为 `59c649f`。

## 有效决定

- 时间轴每屏沿用 14 个本地日，支持按周前后回看和回到最新，不提供任意日期范围输入；次数与时长合并展示，并支持整条指标高亮和完整日期浮层。
- 网站添加后持续统计，不再向用户提供停止或恢复状态。
- 当前 HTTP/HTTPS 全主机权限和 `webNavigation` 继续使用并接受相应商店审核风险；只有实际 Chrome Web Store 审核因此失败时，才建立独立 Change 设计按网站授权或更小权限方案。
- 为实现长期本地保留，继续使用 `unlimitedStorage`；它只服务于扩展 IndexedDB 记录，不用于缓存网页内容。
- 为避免引入隐私范围更大的 `tabs` 权限，分析页继续使用 session 范围的标签注册实现复用。
- 产品名称继续使用 `WebTrace`；`TimeTracker` 不作为商店名称、官网路径或素材品牌。
- Chrome Web Store 的创建、上传和 `Submit for Review` 保留为人工外部操作；准备材料或部署官网不能表述为已经上架。

## 当前限制与风险

- 不支持自定义范围、按周/月聚合报表、跨网站汇总、导入、导出、分享、提醒、限制、登录或同步。
- HTTP/HTTPS 主机权限覆盖范围较宽；代码只为用户配置的网站生成访问记录，但 Chrome 安装界面仍会展示宽泛访问范围。
- 异常退出最多可能少计约一个 4 秒确认周期；恢复逻辑以最后确认时间截断，目标是只少计而不累计离线时间。
- 记录默认长期保留并依赖用户主动删除，没有自动过期策略。
- session 标签注册防止正常工具栏操作产生重复分析页，但不会主动关闭用户手工创建的既有重复分析页。
- 网站排序目前只支持鼠标、触摸或笔等指针操作，没有键盘排序入口；拖动靠近窄屏横向列表边缘时不会自动滚动，需先滚到目标区间再排序。
- 已收到的顶层非 HTTP/HTTPS 导航会被视为离开统计网站；Chrome 未向当前权限组合暴露的受限内部页导航仍属于平台边界。
- Developer Dashboard 尚未创建条目、上传 ZIP 或提交审核；商店后台当日显示的数据分类帮助文本和 `zhangrh.shop` Search Console 验证状态仍需人工确认。
- 本次 Chrome 版本来自本机应用 bundle，而不是从 `chrome://version` 页面读取。
- 2026-09-03 当前隐私确认改动尚未在用户日常 Google Chrome 中人工重新加载验收；浏览器控制的安全策略禁止自动操作 `chrome://extensions/`，当前覆盖来自隔离 Chromium 和自动测试。

## 验证证据

### 自动验证

2026-09-29 在当前代码运行：

```sh
npm test
node --check background.js
node --check content.js
node --check src/analysis/controller.js
node --check src/analysis/view.js
node --check src/analysis/trend-chart.js
node --check src/domain/local-date-range.js
node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'
git diff --check
```

- `npm test`：158/158 通过；覆盖历史翻周、最新边界、跨午夜/切换网站保持窗口、历史明细与独立今日概览、快速请求和读取失败的一致性、双线高亮、完整日期浮层、滚动与焦点保留，以及跨年、闰日和夏令时日期计算。
- 后台/内容入口、改动的 JavaScript 和 manifest JSON 检查通过，`git diff --check` 通过。
- manifest 测试确认版本 `1.1.0`，权限和 HTTP/HTTPS 内容脚本范围与 V1 相同。
- 2026-09-29 使用 Playwright CLI 与隔离 Chromium `151.0.7922.34` 加载真实扩展，使用合成网站/访问数据验证：连续前后翻周、回到最新和禁用状态、历史数据点键盘选择、今日概览保持、两条真实线段悬停后各显示 14 个数值、峰值数值与日期浮层不重叠、全零数据的图例聚焦，以及 390px 页面不溢出和选点/实时刷新保留横向滚动。此为自动化浏览器验证，不记作日常 Chrome 人工验收。
- 同日同版本隔离 Chromium 检查横向滚动边界：1280、1440、1920px 视口下，两种指标高亮时图表的 `scrollWidth` 与 `clientWidth` 均相等，右轴刻度未超出画布；390px 下图内滚动保留，选点前后滚动位置一致，页面不溢出。
- 商店素材与既有 ZIP 的验证基线仍为 2026-09-03：隔离 Chromium 截图和隐私确认流程、ZIP 解压后清单与语法检查通过；本次未重新生成商店截图或上传包，它们尚不包含时间轴的新界面。

### Chrome 验收

- 日期：2026-09-02；浏览器：Google Chrome `152.0.7977.65`，版本来自本机应用 bundle。
- 用户在 `chrome://extensions` 重新加载未打包扩展并打开 WebTrace 分析页后确认通过。
- 用户确认覆盖：日期选择已移除、趋势固定为最近 14 天、今日概览正常、图表点选择正常、访问明细按选中日期展示。
- 该次 V1.1 改动后，Agent 在同一 Chrome 中重新加载既有未打包扩展并打开分析页，确认页面可显示已有网站列表、今日概览、趋势和访问明细。
- 2026-09-03 的浏览器控制安全策略拒绝操作 `chrome://extensions/` 与 `chrome-extension://` 页面，因此未把当前隐私确认或长按排序写成人工 Chrome 通过；这些场景由 148 项自动测试和隔离 Chromium 验证覆盖。
- V1 打开、计时、恢复、分析页复用和权限范围由既有 Chrome 证据与当次自动回归共同覆盖。
- 本次时间轴专项：2026-09-29 日常 Chrome 控制连接两次超时，未完成扩展管理页重新加载及人工场景验证；覆盖来自上述隔离 Chromium 验证。

## 证据入口

- 扩展声明与权限：[`manifest.json`](../../manifest.json)
- 事件、恢复与计时：[`background.js`](../../background.js)、[`tracker.js`](../../src/background/tracker.js)、[`runtime-machine.js`](../../src/domain/runtime-machine.js)
- 本地数据库：[`webtrace-db.js`](../../src/storage/webtrace-db.js)、[`tracking-repository.js`](../../src/storage/tracking-repository.js)
- 分析页：[`analysis.html`](../../analysis.html)、[`controller.js`](../../src/analysis/controller.js)、[`view.js`](../../src/analysis/view.js)、[`trend-chart.js`](../../src/analysis/trend-chart.js)、[`site-reorder.js`](../../src/analysis/site-reorder.js)
- 自动验收：[`webtrace-flow.test.js`](../../tests/webtrace-flow.test.js)、[`chrome-events.test.js`](../../tests/chrome-events.test.js)、[`analysis-view.test.js`](../../tests/analysis-view.test.js)
- 商店资料与素材：[`store-publishing.md`](store-publishing.md)、[`store-assets/README.md`](../../store-assets/README.md)、[`store-assets.test.js`](../../tests/store-assets.test.js)
