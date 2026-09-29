# 项目当前状态

> 最后更新：2026-09-29（Asia/Shanghai，商店提交阻塞与 Google 问题反馈）；外部状态见各项核验日期。

当前 WebTrace 支持配置多个网站，在本机记录有效打开和有效观看时长；分析页显示今日概览、每屏 14 个本地日的双线趋势和选中日期的逐次访问明细。时间轴支持每次前后移动一周和回到最新；悬停某条线会突出该指标及每天数值，浮层只显示完整日期。左侧网站列表支持长按排序，添加网站前显著披露本地数据处理并要求主动确认。2026-09-29 当前代码自动测试为 158/158，通过隔离 Chromium 专项验证；本次时间轴改动尚未经日常 Chrome 人工验收。

2026-09-29 已从提交 `f2bcd90` 生成并审计最终 ZIP，上传到既有 TimeTracker 条目，商店草稿为 WebTrace `1.1.0`；商店资料、图片、隐私披露和测试说明已保存。Google 后台报告主页、支持页和隐私政策连接超时，提交按钮不可用，尚未进入审核；线上仍为 TimeTracker `1.0.0`。同日 16:54 已通过后台 Give Feedback 发送排查结果和后台截图，并收到发送成功提示；正式支持工单未能创建，没有工单号。用户此前确认的五项日常 Chrome 人工验收未绑定具体包校验值，最终包另经隔离 Chromium 冒烟验证。

## 内容边界

本文只记录当前仍有效的实现事实、决定、风险和验证证据。已完成规格与实施过程见 [V1.1 归档规格](../archive/2026-09/2026-09-02-webtrace-v1-1-spec.md)、[V1.1 归档计划](../archive/2026-09/2026-09-02-webtrace-v1-1-plan.md)、[商店发布归档规格](../archive/2026-09/2026-09-03-webtrace-store-release-spec.md) 和 [商店发布归档计划](../archive/2026-09/2026-09-03-webtrace-store-release-plan.md)。涉及运行行为时，以当前代码、测试和当次验证为准。

## 已验证的实现事实

### 扩展与权限

- 扩展名称为 WebTrace，版本 `1.1.0`，采用 Chrome Manifest V3，最低 Chrome 版本为 102。
- 后台入口是模块型 service worker `background.js`；网页侧 `content.js` 只注入 HTTP/HTTPS 页面，不创建浮窗或其他可见 UI。
- 权限为 `idle`、`storage`、`unlimitedStorage` 和 `webNavigation`；主机访问范围为 `http://*/*` 与 `https://*/*`，与 WebTrace V1 开发基线相同。相较商店线上旧 TimeTracker `1.0.0` 的 `storage` 和主机权限，本次更新新增 `idle`、`unlimitedStorage`、`webNavigation`，已填写对应理由。
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
- 扩展摘要、添加网站前的告知和商店文案已对齐为默认展示最近 14 天、支持按周回看更早记录；此次只更新展示说明，没有改变采集范围、权限、保留、删除或数据传输规则。

### 商店发布材料

- `store-assets/` 包含两张由真实扩展页面生成的 1280×800 截图和一张 440×280 宣传图；截图只使用 `github.com`、`developer.mozilla.org`、`wikipedia.org` 等合成配置与合成访问时间。
- `npm run capture:store` 使用 Playwright 自带 Chromium 和临时隔离 profile 重现截图，结束后删除 profile；不读取日常 Chrome 数据。
- `npm run render:icons` 从可审查的平面母版重现四种图标；宣传图母版由内置 ImageGen 生成，最终素材保存在仓库。
- [`store-publishing.md`](store-publishing.md) 是商店标题、摘要、详细描述、分类、语言、单一用途、权限理由、隐私实践、URL、测试说明和提交步骤的当前来源。
- 最终包为 `release/webtrace-1.1.0.zip`，30 个文件、101,723 字节，SHA-256 为 `a50fa052c4dcf26149ccf2b656de392b4b37843040ce3aaee860b93b83c62cf4`（2026-09-29）。全部文件逐字节匹配提交 `f2bcd90` 中的运行文件，包含当前时间轴实现和文案；只含六个入口文件、`src`、`vendor` 和四种图标，`release/` 由 Git 忽略。
- 2026-09-29 在已登录的 Chrome for Testing 中核验既有[商店条目](https://chromewebstore.google.com/detail/efpighgeknabppbmfjpkfmebmnmckpgj)：线上 TimeTracker `1.0.0`，草稿 WebTrace `1.1.0`。新包、图标、两张截图、宣传图、描述、权限理由、隐私披露和测试说明均已上传保存；分发为免费、公开、全部地区。详细状态以 [`store-publishing.md`](store-publishing.md) 为准。
- `zhangrh.shop` 已公开部署[主页](https://zhangrh.shop/webtrace/)、[支持页](https://zhangrh.shop/webtrace/support/)和[隐私政策](https://zhangrh.shop/webtrace/privacy/)；2026-09-29 发布后，隔离 Chromium `151.0.7922.34` 在 1280×800 与 390×844 视口核验新文案、政策日期和截图，无鉴权、404、横向溢出、图片加载失败或控制台错误、警告。公网 HTML 与静态资源内容和本地发布产物一致。
- 同日官网首页、支持、中英隐私政策、Hub 作品卡及合成截图均已上线；文案说明默认最近 14 天与按周回看，数据处理范围不变。官网内容和发布验证的权威来源为 `zhangrh.shop` 仓库的 `docs/current/project.md` 与 `docs/current/deployment.md`。

## 有效决定

- 时间轴每屏沿用 14 个本地日，支持按周前后回看和回到最新，不提供任意日期范围输入；次数与时长合并展示，并支持整条指标高亮和完整日期浮层。
- 网站添加后持续统计，不再向用户提供停止或恢复状态。
- 当前 HTTP/HTTPS 全主机权限和 `webNavigation` 继续使用并接受相应商店审核风险；只有实际 Chrome Web Store 审核因此失败时，才建立独立 Change 设计按网站授权或更小权限方案。
- 为实现长期本地保留，继续使用 `unlimitedStorage`；它只服务于扩展 IndexedDB 记录，不用于缓存网页内容。
- 为避免引入隐私范围更大的 `tabs` 权限，分析页继续使用 session 范围的标签注册实现复用。
- 产品名称继续使用 `WebTrace`；旧商店条目和升级兼容性说明可以使用原名称 `TimeTracker`。
- 2026-09-29 用户明确选择更新既有 TimeTracker 条目，保留扩展 ID `efpighgeknabppbmfjpkfmebmnmckpgj`，并授权 Agent 上传和提交市场。此授权替代此前仅由人工执行商店操作的约定；准备材料、上传草稿或部署官网都不能表述为已经上架新版本。

## 当前限制与风险

- 不支持自定义范围、按周/月聚合报表、跨网站汇总、导入、导出、分享、提醒、限制、登录或同步。
- HTTP/HTTPS 主机权限覆盖范围较宽；代码只为用户配置的网站生成访问记录，但 Chrome 安装界面仍会展示宽泛访问范围。
- 异常退出最多可能少计约一个 4 秒确认周期；恢复逻辑以最后确认时间截断，目标是只少计而不累计离线时间。
- 记录默认长期保留并依赖用户主动删除，没有自动过期策略。
- session 标签注册防止正常工具栏操作产生重复分析页，但不会主动关闭用户手工创建的既有重复分析页。
- 网站排序目前只支持鼠标、触摸或笔等指针操作，没有键盘排序入口；拖动靠近窄屏横向列表边缘时不会自动滚动，需先滚到目标区间再排序。
- 已收到的顶层非 HTTP/HTTPS 导航会被视为离开统计网站；Chrome 未向当前权限组合暴露的受限内部页导航仍属于平台边界。
- 2026-09-29 Developer Dashboard 因三个公开 URL 连接超时而阻止提交。本机 GET/HEAD 均返回 HTTP 200，公共 DNS 解析一致，但这些结果不能证明 Google 校验节点可达；云安全组和外部网络连通性仍待确认。
- 商店 `Official URL` 下拉列表只有 `None`，已留空；这不能证明域名在所有 Search Console 账号中的验证状态。当前数据分类选择 `Web history`，当日 `User activity` 帮助文本列举点击、鼠标、滚动和键击等，未勾选该项。
- 2026-09-29 人工验收以用户逐项确认为依据。Agent 的日常 Chrome 控制连接超时，未独立读取验收会话的 `chrome://version` 或加载目录；本机已安装 Chrome 的 bundle 版本为 `154.0.8037.58`。
- 人工确认仅覆盖本次列出的五项，尚未证明历史周切换等分析页改动全部经过日常 Chrome 人工验收，也未证明最终 ZIP 与用户当时加载的版本一致；最终包与已提交代码的一致性及隔离浏览器验证已另行完成。
- TimeTracker `1.0.0` 的旧汇总记录不会自动导入新分析页，升级后需重新配置统计网站；商店描述和审核测试说明已明确告知此限制。

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
- manifest 测试确认版本 `1.1.0`，权限和 HTTP/HTTPS 内容脚本范围与 WebTrace V1 开发基线相同。
- 2026-09-29 使用 Playwright CLI 与隔离 Chromium `151.0.7922.34` 加载真实扩展，使用合成网站/访问数据验证：连续前后翻周、回到最新和禁用状态、历史数据点键盘选择、今日概览保持、两条真实线段悬停后各显示 14 个数值、峰值数值与日期浮层不重叠、全零数据的图例聚焦，以及 390px 页面不溢出和选点/实时刷新保留横向滚动。此为自动化浏览器验证，不记作日常 Chrome 人工验收。
- 同日同版本隔离 Chromium 检查横向滚动边界：1280、1440、1920px 视口下，两种指标高亮时图表的 `scrollWidth` 与 `clientWidth` 均相等，右轴刻度未超出画布；390px 下图内滚动保留，选点前后滚动位置一致，页面不溢出。
- 2026-09-29 通过 `npm run capture:store` 在隔离 Chromium 中重新生成两张 1280×800 产品截图，并检查双线图、周切换按钮和更新后的隐私告知；只使用合成网站与访问数据，截图过程无浏览器错误。
- 2026-09-29 最终 ZIP 完整性、30 个文件的允许清单、与提交 `f2bcd90` 的逐字节一致性、全部解压后 JavaScript 的语法检查通过。使用实际解压目录和隔离 Chromium `151.0.7922.34` 验证启动、更新后的隐私告知、默认未勾选且必填的确认框、新增 `wikipedia.org`、前一周、历史导航按钮启用、回到最新和宽屏无横向溢出；此为自动化验证，不记作日常 Chrome 人工验收。

### Chrome 验收

- 日期：2026-09-29（Asia/Shanghai）；浏览器：用户日常 Google Chrome；证据来源：用户在本次对话中的逐项人工确认。
- 重新加载：用户确认没有问题。
- 隐私政策确认：用户确认没有问题。
- 网站新增：用户确认没有问题。
- 实际计时：用户明确表示已经测试、没有问题。
- 隐私政策页面：用户确认没有问题。
- 验收边界：未独立核验用户加载的目录、提交或包校验值；未将本次确认扩大为排序、删除、锁屏、重启或新增历史周切换的专项验收。
- 本次时间轴专项：2026-09-29 日常 Chrome 控制连接两次超时，未完成扩展管理页重新加载及人工场景验证；覆盖来自上述隔离 Chromium 验证。
- 既有 V1.1 分析页验收仍有效：2026-09-02，Google Chrome `152.0.7977.65`（当时 bundle 版本），用户确认固定 14 天趋势、今日概览、图表选择和访问明细通过。

## 证据入口

- 扩展声明与权限：[`manifest.json`](../../manifest.json)
- 事件、恢复与计时：[`background.js`](../../background.js)、[`tracker.js`](../../src/background/tracker.js)、[`runtime-machine.js`](../../src/domain/runtime-machine.js)
- 本地数据库：[`webtrace-db.js`](../../src/storage/webtrace-db.js)、[`tracking-repository.js`](../../src/storage/tracking-repository.js)
- 分析页：[`analysis.html`](../../analysis.html)、[`controller.js`](../../src/analysis/controller.js)、[`view.js`](../../src/analysis/view.js)、[`trend-chart.js`](../../src/analysis/trend-chart.js)、[`site-reorder.js`](../../src/analysis/site-reorder.js)
- 自动验收：[`webtrace-flow.test.js`](../../tests/webtrace-flow.test.js)、[`chrome-events.test.js`](../../tests/chrome-events.test.js)、[`analysis-view.test.js`](../../tests/analysis-view.test.js)
- 商店资料与素材：[`store-publishing.md`](store-publishing.md)、[`store-assets/README.md`](../../store-assets/README.md)、[`store-assets.test.js`](../../tests/store-assets.test.js)
