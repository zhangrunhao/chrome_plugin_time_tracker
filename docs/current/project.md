# 项目当前状态

> 最后核验：2026-09-01（Asia/Shanghai）

当前仓库已实现 WebTrace V1：用户可以配置多个网站，在本机记录有效打开和有效观看时长，并在扩展分析页查看最近 7 天趋势与逐次访问明细。自动验证为 122/122；真实 Chrome 与经用户批准的自动化替代共同覆盖验收范围，但不应表述为 13 个场景全部手工通过。

## 内容边界

本文记录当前仍有效的实现事实、决定、风险和验证证据。已完成的规格与实施过程是历史证据，见[归档规格](../archive/2026-08/2026-08-31-webtrace-v1-spec.md)和[归档计划](../archive/2026-08/2026-08-31-webtrace-v1-plan.md)。涉及运行行为时，以当前代码、测试和当次验证为准。

## 已验证的实现事实

### 扩展与权限

- 扩展名称为 WebTrace，版本 `1.0.0`，采用 Chrome Manifest V3，最低 Chrome 版本为 102。
- 后台入口是模块型 service worker `background.js`；网页侧 `content.js` 只注入 HTTP/HTTPS 页面，不创建浮窗或其他可见 UI。
- 权限为 `idle`、`storage`、`unlimitedStorage` 和 `webNavigation`；主机访问范围为 `http://*/*` 与 `https://*/*`。
- 扩展不申请 `tabs` 权限。工具栏图标打开或聚焦分析页；分析页以 `chrome.storage.session` 中的 `tabId`/`windowId` 注册自身，关闭或导航离开时清除记录。
- `chrome.storage.local` 和 `chrome.storage.session` 在后台初始化时限制为 `TRUSTED_CONTEXTS`。

### 网站配置与匹配

- 用户可以输入网站名称、域名或 HTTP/HTTPS 页面 URL；离线 vendored `tldts@7.4.11` 把输入归一化为可注册主域名。
- 一个配置匹配其主域名和全部子域名，不匹配仅字符串后缀相同的其他域名；无效地址、非 HTTP/HTTPS 地址、不可注册域名和重复域名会被拒绝。
- 新增或重新启用网站时不追溯已打开页面；只有离开后再次进入才产生新访问。
- 停止统计只影响未来采集，历史仍可查询；删除历史需要明确确认，只删除该网站的访问记录并保留配置。

### 打开与有效时长

- 从非目标网站进入目标网站会新建一条 `Visit`；刷新、站内跳转、跨子域名跳转和同站子标签继承不会增加打开次数。
- 只要仍有同一访问关联的目标标签页，访问保持进行中；最后一个关联标签离开或关闭时结束。
- 只有目标标签页是活动标签页、Chrome 窗口前台且未最小化、页面可见、设备未锁屏时才累计时长；普通无输入状态继续计时。
- 任一时刻最多一个 `ActiveInterval` 进行中。内容脚本每 4 秒发送可见页面确认，时间戳由后台产生。
- 打开次数按 `openedAt` 的本地日期归属；有效时长按本机日历午夜拆分。访问明细仍归属打开日，并显示该次访问完整时长。

### 数据、事务与恢复

- 网站配置保存在 `chrome.storage.local` 的 `webtraceSitesV1`；标签页映射和轻量 checkpoint 镜像保存在 `chrome.storage.session`。
- 访问记录保存在 IndexedDB `webtrace` v1 的 `visits` store；索引为 `siteId + openedAt` 和 `siteId + lastActivityAt`。权威 runtime checkpoint 与访问记录在同一事务提交。
- `Visit.activeIntervals` 是打开次数、时长、趋势和逐次明细的唯一事实来源，不写日汇总缓存。
- IndexedDB 权威提交最多尝试 3 次，重试间隔为 50 ms 和 150 ms；失败时不替换内存中的已提交状态。
- service worker 重启时复用同会话 checkpoint，不新增打开；浏览器新会话把旧访问截断在最后确认时间，并为实际恢复的目标页面创建新访问，不累计离线时间。
- 旧版 `chrome.storage.local.stats` 不读取、不写入，也不自动迁移或删除。

### 分析页与本地边界

- 分析页保留启用和停用的网站，默认选择最早创建的网站和今天，固定展示今天及前 6 天。
- 页面分别展示打开次数与有效时长两张对齐日期轴的图表、7 天合计、零值日期和选中日期的逐次明细；进行中记录显示“进行中”。
- 网站添加、停止、恢复和删除历史通过受信任扩展消息交给后台串行处理；网页上下文不能发送管理命令。
- 运行时代码不调用 `fetch`、`XMLHttpRequest`、`WebSocket` 或 `EventSource`，不加载远程资源，不保存完整 URL、路径、查询参数或网页标题。
- 访问记录默认长期保留，直到用户删除对应网站历史或卸载扩展。

## 有效决定

- WebTrace V1 的本地多网站统计、有效打开定义、五项观看条件、最近 7 天报表和本地长期保留契约继续有效；归档 spec/plan 保存确认与实施历史，本文保存当前结论。
- 为实现长期本地保留，继续使用 `unlimitedStorage`；它只服务于扩展 IndexedDB 记录，不用于缓存网页内容。
- 为避免引入隐私范围更大的 `tabs` 权限，分析页复用采用 session 范围的标签注册。修复提交为 `e8fdc2bf0ea56d99fd05fdf3f4e2b801323fe274`。
- 用户于 2026-09-01 批准场景 11、12 使用现有自动化恢复测试替代手工停止 service worker 和退出/重启 Chrome；这两项状态为 `ACCEPTED`，不是手工 `PASS`。

## 当前限制与风险

- 分析范围固定为最近 7 天，不支持自定义范围、历史周翻页、跨网站汇总、导入、导出、分享、提醒、限制、登录或同步。
- HTTP/HTTPS 主机权限覆盖范围较宽；代码只为用户配置的网站生成访问记录，但 Chrome 安装界面仍会展示宽泛访问范围。
- 异常退出最多可能少计约一个 4 秒确认周期；恢复逻辑以最后确认时间截断，目标是只少计而不累计离线时间。
- 记录默认长期保留并依赖用户主动删除；没有自动过期策略。
- session 标签注册防止正常工具栏操作产生重复分析页，但不会主动关闭用户手工创建的既有重复分析页。
- 本次记录的 Chrome `152.0.7977.65` 来自本机应用 bundle，没有从 `chrome://version` 手工读取。
- 场景 4、9 是真实 Chrome 部分证据加自动化补充后 `ACCEPTED`；场景 11、12 仅使用经用户批准的自动化替代，仍缺少对应手工破坏性恢复操作。

## 验证证据

### 自动验证

2026-09-01 在当前代码（含场景 10 修复提交 `e8fdc2b`）运行：

```sh
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

- `npm test`：122/122 通过。
- vendored `tldts` 可重复生成且无差异；全部 JavaScript、入口和 manifest JSON 检查通过。
- 最后两项扫描无匹配；`rg` 因无匹配返回 1，结果符合预期。

### Chrome 验收

- 日期：2026-09-01；浏览器：Google Chrome `152.0.7977.65`，版本来自本机应用 bundle，未通过 `chrome://version` 手工确认。
- 真实 Chrome `PASS`：场景 1、2、3、5、6、7、8、10、13。
- 真实 Chrome 部分证据加自动化补充后 `ACCEPTED`：场景 4、9。
- 经用户批准仅用自动化替代并标记 `ACCEPTED`：场景 11、12；未手工停止 service worker，也未退出/重启 Chrome。
- 场景 10 的首次真实运行发现重复分析页缺陷；提交 `e8fdc2b` 修复后重新加载扩展并重复点击，Chrome 中只保留一个分析页。

## 证据入口

- 扩展声明与权限：[`manifest.json`](../../manifest.json)
- 事件、恢复与计时：[`background.js`](../../background.js)、[`tracker.js`](../../src/background/tracker.js)、[`runtime-machine.js`](../../src/domain/runtime-machine.js)
- 本地数据库：[`webtrace-db.js`](../../src/storage/webtrace-db.js)、[`tracking-repository.js`](../../src/storage/tracking-repository.js)
- 分析页：[`analysis.html`](../../analysis.html)、[`controller.js`](../../src/analysis/controller.js)、[`view.js`](../../src/analysis/view.js)
- 自动验收：[`webtrace-flow.test.js`](../../tests/webtrace-flow.test.js)、[`chrome-events.test.js`](../../tests/chrome-events.test.js)、[`tracker.test.js`](../../tests/tracker.test.js)
