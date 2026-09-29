# Chrome Web Store 发布手册

> 最后更新：2026-09-29（Asia/Shanghai，最终候选包、商店草稿和提交阻塞）；外部要求核验日期见文末。

WebTrace `1.1.0` 已上传到既有 TimeTracker 条目，商店资料、图片、隐私披露和测试说明已保存。2026-09-29 Google 后台因主页、支持页和隐私政策连接超时而禁用提交按钮，尚未提交审核；线上仍是 TimeTracker `1.0.0`。用户已明确选择更新现有条目并授权提交，保留扩展 ID `efpighgeknabppbmfjpkfmebmnmckpgj`。

## 当前状态

| 项目 | 状态 | 当前证据 |
| --- | --- | --- |
| 扩展代码与权限 | 已准备 | `manifest.json` 版本 `1.1.0` |
| 采集前显著告知与确认 | 已准备 | 添加网站表单默认未勾选，未确认不能提交 |
| 16/32/48/128 图标 | 已准备 | `images/` 和 `store-assets/source/` |
| 1280×800 截图与 440×280 宣传图 | 已上传保存 | 两张截图于 2026-09-29 更新为当前双线图和隐私告知，宣传图沿用；只含真实界面与合成数据 |
| 日常 Chrome 人工验收 | 用户已确认五项通过 | 2026-09-29；具体范围与版本边界见下文 |
| 上传 ZIP | 已上传并审计 | `release/webtrace-1.1.0.zip`，逐字节匹配提交 `f2bcd90` 的运行文件 |
| 主页、支持、隐私 URL | 已发布并验证 | 2026-09-29 新文案、中英隐私政策和截图已上线；三个页面及资源正常，桌面与手机宽度的隔离浏览器检查通过 |
| Developer Dashboard | 草稿已保存，提交受阻 | 2026-09-29 登录核验；草稿 `1.1.0`，线上 `1.0.0`，三个公开 URL 连接超时 |

### 商店条目与提交阻塞

- [现有条目](https://chromewebstore.google.com/detail/efpighgeknabppbmfjpkfmebmnmckpgj)的扩展 ID 为 `efpighgeknabppbmfjpkfmebmnmckpgj`；本次作为更新发布，不创建新条目。
- 已在独立 Chrome for Testing 中逐页回读草稿：描述、分类、语言、四张图片、权限理由、Remote code、数据类别、Limited Use 认证和隐私政策一致；审核说明已保存。定价、可见性和地区仍为免费、公开、全部地区。
- Package 页显示线上 `1.0.0` 使用 `storage` 和主机权限；草稿 `1.1.0` 还包含 `idle`、`unlimitedStorage`、`webNavigation`，已逐项填写本地统计用途。
- `Why can't I submit?` 明确列出 Homepage、Support、Privacy policy URL 均为 `Timeout while connecting`；尚未进入提交确认弹窗或审核队列。
- 当日从本机读取三个最终 URL 均为 HTTP 200，HTTPS 校验通过，Google/Cloudflare 公共 DNS 解析一致且无 AAAA 记录。上述验证不代表 Google 商店校验节点可达，安全组与外部网络连通性仍待确认。
- 链接问题解除后，重新保存并回读草稿，确认提交按钮可用，再完成提交确认并记录审核状态；不得把旧版的 `Published - public` 状态当成新版本已经通过审核。

### 人工验收与最终候选

- 2026-09-29，用户在日常 Google Chrome 中逐项确认：重新加载、隐私政策确认、网站新增、实际计时测试、隐私政策页面均没有问题。
- 这是用户人工验收证据；Agent 当次未能连接日常 Chrome，未独立核验加载目录或验收会话的浏览器版本。本机 Chrome bundle 为 `154.0.8037.58`，供环境参考。
- 最终 ZIP 于同日从提交 `f2bcd90` 的已跟踪运行文件生成，共 30 个文件、101,723 字节，SHA-256 为 `a50fa052c4dcf26149ccf2b656de392b4b37843040ce3aaee860b93b83c62cf4`。完整性、允许清单、解压后全部 JavaScript 语法和文件逐字节一致性均通过，已上传此包。
- 使用最终包的实际解压目录，在隔离 Chromium `151.0.7922.34` 验证启动、隐私告知、确认框默认未勾选且必填、新增 `wikipedia.org`、周切换、历史导航按钮、回到最新和宽屏无溢出。这是自动化验证；用户此前五项人工确认仍未绑定具体包校验值，未将其扩大为时间轴专项人工验收。

## Store Listing 可复制字段

- 名称：`WebTrace`（来自 manifest，不改为 TimeTracker）
- 摘要：`WebTrace 在本机统计你配置的网站打开次数与有效观看时长，提供可按周回看的 14 天双线趋势和访问明细。`
- 分类：`Productivity / Workflow & Planning`（Dashboard 选项为 `Workflow & Planning`）
- 主要语言：`Chinese (China)`（简体中文）
- 定价：`Free`
- 可见性：`Public`
- 分发区域：全部可用地区
- 成人内容：`No`
- 主页：`https://zhangrh.shop/webtrace/`
- 支持：`https://zhangrh.shop/webtrace/support/`
- 隐私政策：`https://zhangrh.shop/webtrace/privacy/`
- 官方网址：当前留空。2026-09-29 Dashboard 下拉列表仅提供 `None`，未选择未经该账号验证的域名。

详细描述：

```text
WebTrace 是一款本地优先的网站时间追踪器，帮助你了解自己每天打开特定网站多少次，以及真正查看了多久。

主要功能：
• 自行添加需要统计的网站名称、域名或 HTTP/HTTPS 页面地址
• 区分新的有效打开与刷新、站内跳转和同站子标签继承
• 仅在目标标签页活动、Chrome 窗口位于前台、页面可见且设备未锁屏时累计有效时长
• 查看今日打开次数和有效使用时长
• 在同一张图查看打开次数与有效时长，默认展示最近 14 天，支持按周回看更早记录和一键回到最新
• 悬停折线或图例，突出对应指标及每日数值；日期浮层显示完整日期
• 查看所选日期的逐次访问明细
• 管理多个网站并通过长按拖动调整顺序
• 按网站永久删除访问历史

隐私边界：
WebTrace 只记录你主动配置的网站名称和主域名、打开与结束时间、有效观看区间和时长。全部数据仅保存在当前 Chrome 配置文件的扩展本地存储中，不会上传给开发者或第三方。WebTrace 不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie，不出售数据，也不用于广告。

记录默认长期保留。你可以按网站永久删除访问历史；网站配置会保留并继续统计。卸载扩展会移除扩展的本地数据。

从 TimeTracker 1.0.0 升级：旧版汇总记录不会自动迁移到新分析页。升级后请在“管理网站”中配置需要统计的网站。
```

### 图片上传顺序

1. 商店图标：`images/icon_128.png`
2. 本地统计仪表盘：`store-assets/screenshots/01-dashboard-1280x800.png`
3. 采集前隐私告知：`store-assets/screenshots/02-add-site-1280x800.png`
4. Small promo tile：`store-assets/promo/small-promo-440x280.png`
5. Promotional video 和 Marquee promo tile：当前留空。

## Privacy practices 可复制字段

### 单一用途

```text
在用户设备本地统计其主动配置网站的打开次数和有效观看时长，并提供双线趋势与访问明细。趋势默认展示最近 14 天，支持按周回看更早记录。
```

### 权限理由

`idle`

```text
用于判断设备是否锁屏。WebTrace 只在设备未锁屏时累计有效观看时长；普通无输入状态不会停止计时，也不会保存用户输入行为。
```

`storage`

```text
用于在 chrome.storage.local 保存用户配置的网站，并在 chrome.storage.session 保存当前浏览器会话中的标签关联和恢复 checkpoint。数据只保存在本机。
```

`unlimitedStorage`

```text
用于让扩展自己的 IndexedDB 长期保存网站访问记录。WebTrace 不设自动过期，需要避免浏览器因普通扩展存储配额删除用户历史；该权限不用于缓存网页内容。
```

`webNavigation`

```text
用于识别进入、离开、刷新、站内跳转和跨子域名跳转，从而正确区分一次新的有效打开与同一访问中的导航。Chrome 提供的导航 URL 只在内存中用于解析和匹配主机名；WebTrace 不保存完整 URL、路径、查询参数或页面标题。
```

`Host access: http://*/* and https://*/*`

```text
用户可以主动配置任意 HTTP/HTTPS 网站，因此 WebTrace 需要在这些页面确认可见状态，并把当前页面主机名与配置域名及其子域名匹配。内容脚本不读取 DOM、网页正文、表单输入或 Cookie；完整 URL 仅被临时解析，持久化记录不包含路径、查询参数或页面标题。只有用户配置的网站会生成访问记录。
```

### Remote code

选择：`No, I am not using remote code.`

扩展不加载远程 JavaScript、WebAssembly、字体或其他可执行资源；运行代码均包含在 ZIP 中。

### 数据类别与使用

- 必须勾选：`Web history / browsing activity`。主域名、打开/结束时间与观看时长属于网站浏览活动；即使仅存本机也必须披露。
- `User activity`：当前未勾选。2026-09-29 已阅读 Dashboard 帮助文本，其列举网络监控、点击、鼠标位置、滚动、键击等行为，未明确把活动窗口状态或停留时长纳入该项；当前实现不保存上述输入行为。将来提交时若分类定义改变，应重新核对。
- 不勾选：`Website content`，因为不读取或保存 DOM、正文、图片、音视频、表单输入或页面标题。
- 不勾选：身份、认证、个人通信、位置、财务、健康及其他用户内容类别。
- 数据传输：没有。无开发者服务器、分析服务、广告服务、账号同步或第三方接收方。
- 用途：只为扩展核心统计功能；不出售、不用于广告、个性化推荐、信用评估或与第三方共享。

勾选 Dashboard 中全部 Limited Use 认证，确认：

1. 不在政策允许范围之外出售或转移用户数据。
2. 不把用户数据用于与扩展单一用途无关的目的。
3. 不把用户数据用于信用评估或借贷。

公开隐私政策必须与以上选择一致，并覆盖采集范围、用途、本地存储、长期保留、按网站删除、卸载删除和不共享规则。

2026-09-29 文案对齐只将趋势展示说明更新为“默认展示最近 14 天，支持按周回看更早记录”；采集范围、权限、保存期限、删除与不共享规则不变。官网中英隐私政策的用途和保留章节已同步、发布并在线核对，最后更新日期为 2026-09-29，与扩展内显著告知一致。

### Test instructions

```text
WebTrace 不需要账号、付费或测试凭据。No login or test credentials required.
安装后点击工具栏图标，打开“管理网站”，阅读并勾选本地数据处理确认，添加网站名称 Wikipedia、域名 wikipedia.org。
从其他网站进入 https://www.wikipedia.org/，保持标签页在前台约 10 秒，再返回 WebTrace，查看今日打开次数、有效时长和访问明细。
点击“前一周”回看，再用“后一周”或“回到最新”返回；悬停折线或图例可高亮指标及每日数值，日期浮层只显示完整日期。全部数据仅存本机。
从 TimeTracker 1.0.0 升级后，请重新配置需要统计的网站；旧版汇总不会自动导入新分析页。
```

## 打包与审计

在仓库根目录生成包：

```sh
mkdir -p release
zip -FS -r release/webtrace-1.1.0.zip \
  manifest.json background.js content.js analysis.html analysis.css analysis.js \
  src vendor images
```

ZIP 根目录必须直接包含 `manifest.json`。上传前执行：

```sh
unzip -Z1 release/webtrace-1.1.0.zip | sort
```

允许的顶层内容只有六个入口文件和 `src/`、`vendor/`、`images/`；不得出现 `.git`、`.env`、`node_modules`、`tests`、`docs`、`store-assets`、`release` 或浏览器 profile。

## 提交与更新步骤

1. 登录 Chrome Web Store Developer Dashboard，完成开发者账号注册、联系邮箱验证和当时页面要求的身份/付款步骤。
2. 在提交前，用无登录窗口公开访问主页、支持页和隐私政策，确认都是 HTTPS、无鉴权、无 404，并更新本文状态。
3. 打开现有条目，在 `Package` 选择 `Upload new package` 并上传 `release/webtrace-1.1.0.zip`；确认草稿名称 `WebTrace`、版本 `1.1.0` 和权限。只有明确决定创建独立产品时才使用 `Add new item`。
4. 在 `Store Listing` 填写本文字段并按顺序上传图片；保存后预览，确认中文无截断且截图是实际体验。
5. 在 `Privacy practices` 填单一用途、逐项权限理由、Remote code、数据类别、Limited Use 认证和隐私政策 URL。
6. 在 `Distribution` 选择 Free、Public 和全部可用地区；不启用成人内容。
7. 在 `Test instructions` 粘贴无需凭据的测试步骤。
8. 逐页检查没有未保存字段或红色警告，再点击 `Submit for Review`。这是外部提交动作，执行后应记录时间和 item ID。
9. 若希望审核通过后自动公开，保留自动发布；若要先验收商店页，则选择 deferred publishing。延迟发布获批后必须在 30 天内人工发布，否则会退回草稿。
10. 审核期间不要声称已经上架；若发现问题，取消审核、修复、提高 manifest 版本并重新上传。

## 提交前最终清单

- [x] 三个公开 URL 已在无登录窗口验证。
- [x] ZIP 清单和解压后语法检查通过。
- [x] 2026-09-29 用户确认日常 Chrome 重新加载、隐私确认、网站新增、实际计时与隐私页面五项通过。
- [x] 最终上传包匹配已提交运行代码，已记录提交、大小和校验值；实际解压目录的隔离浏览器验证通过，人工验收版本边界另行注明。
- [x] 新草稿名称为 WebTrace，摘要与 manifest 一致。
- [x] 128px 图标、两张截图和 440×280 宣传图上传成功，回读时全部可加载。
- [x] 单一用途、五类权限理由、Remote code、数据类别和三项 Limited Use 认证填写保存完成。
- [x] 2026-09-29 官网更新已发布，公开隐私政策与扩展内显著告知一致，趋势展示说明已同步。
- [x] Distribution 已核对，Test instructions 已保存并回读一致；不需要账号凭据。
- [x] 用户授权更新现有条目并提交，Agent 已逐页复核资料。
- [ ] Google 商店能够访问三个公开 URL，提交按钮可用。
- [ ] 已决定自动发布或延迟发布。
- [ ] 完成 `Submit for Review` 并记录后台实际审核状态。

## 官方依据

外部要求最后核验于 2026-09-29：

- [Store Listing 字段与图片](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy practices 填写](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [首次上传、审核与延迟发布](https://developer.chrome.com/docs/webstore/publish)
- [本机数据仍需披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
