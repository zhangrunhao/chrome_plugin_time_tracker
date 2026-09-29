# Chrome Web Store 发布手册

> 最后核验：2026-09-03（Asia/Shanghai）

WebTrace 的扩展代码、隐私确认、商店图片和 `1.1.0` 上传包已经准备，三个 `zhangrh.shop` 页面也已部署并完成公开核验。Chrome Web Store Developer Dashboard 尚未创建条目、上传或提交审核；本文中的“已准备”不表示已经上架。

## 当前状态

| 项目 | 状态 | 当前证据 |
| --- | --- | --- |
| 扩展代码与权限 | 已准备 | `manifest.json` 版本 `1.1.0` |
| 采集前显著告知与确认 | 已准备 | 添加网站表单默认未勾选，未确认不能提交 |
| 16/32/48/128 图标 | 已准备 | `images/` 和 `store-assets/source/` |
| 1280×800 截图与 440×280 宣传图 | 已准备 | `store-assets/`，只含真实界面与合成数据 |
| 待上传 ZIP | 已准备、本机生成 | `release/webtrace-1.1.0.zip`，由 Git 忽略 |
| 主页、支持、隐私 URL | 已部署并公开核验 | 2026-09-03 无登录浏览器检查均为 HTTPS 200；站点实现 revision `0c83897`，文档收口 revision `59c649f` |
| Developer Dashboard | 尚未操作 | 尚未创建、上传或提交审核 |

## Store Listing 可复制字段

- 名称：`WebTrace`（来自 manifest，不改为 TimeTracker）
- 摘要：`WebTrace 在本机统计你配置的网站打开次数与有效观看时长，并展示最近 14 天趋势和访问明细。`
- 分类：`Productivity`
- 主要语言：`Chinese (Simplified) / 中文（简体）`
- 定价：`Free`
- 可见性：`Public`
- 分发区域：全部可用地区
- 成人内容：`No`
- 主页：`https://zhangrh.shop/webtrace/`
- 支持：`https://zhangrh.shop/webtrace/support/`
- 隐私政策：`https://zhangrh.shop/webtrace/privacy/`
- 官方网址：若 `zhangrh.shop` 已在 Search Console 验证，则选择该域名；否则暂留空，不要填写未验证域名。

详细描述：

```text
WebTrace 是一款本地优先的网站时间追踪器，帮助你了解自己每天打开特定网站多少次，以及真正查看了多久。

主要功能：
• 自行添加需要统计的网站名称、域名或 HTTP/HTTPS 页面地址
• 区分新的有效打开与刷新、站内跳转和同站子标签继承
• 仅在目标标签页活动、Chrome 窗口位于前台、页面可见且设备未锁屏时累计有效时长
• 查看今日打开次数和有效使用时长
• 在同一张图查看打开次数与有效时长，每屏 14 天，支持按周回看历史
• 查看所选日期的逐次访问明细
• 管理多个网站并通过长按拖动调整顺序
• 按网站永久删除访问历史

隐私边界：
WebTrace 只记录你主动配置的网站名称和主域名、打开与结束时间、有效观看区间和时长。全部数据仅保存在当前 Chrome 配置文件的扩展本地存储中，不会上传给开发者或第三方。WebTrace 不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie，不出售数据，也不用于广告。

记录默认长期保留。你可以按网站永久删除访问历史；网站配置会保留并继续统计。卸载扩展会移除扩展的本地数据。
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
在用户设备本地统计其主动配置网站的打开次数和有效观看时长，并提供最近 14 天趋势与访问明细。
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
- `User activity`：当前实现不记录点击、鼠标、滚动、键击或输入行为，通常不勾选。提交时再次阅读 Dashboard 当日帮助文本；若其明确把“活动标签页/窗口可见性或停留时长”纳入该类别，则一并勾选，并保持隐私政策描述不变。
- 不勾选：`Website content`，因为不读取或保存 DOM、正文、图片、音视频、表单输入或页面标题。
- 不勾选：身份、认证、个人通信、位置、财务、健康及其他用户内容类别。
- 数据传输：没有。无开发者服务器、分析服务、广告服务、账号同步或第三方接收方。
- 用途：只为扩展核心统计功能；不出售、不用于广告、个性化推荐、信用评估或与第三方共享。

勾选 Dashboard 中全部 Limited Use 认证，确认：

1. 不在政策允许范围之外出售或转移用户数据。
2. 不把用户数据用于与扩展单一用途无关的目的。
3. 不把用户数据用于信用评估或借贷。

公开隐私政策必须与以上选择一致，并覆盖采集范围、用途、本地存储、长期保留、按网站删除、卸载删除和不共享规则。

### Test instructions

```text
WebTrace 不需要账号、付费或测试凭据。安装后点击工具栏图标，打开“管理网站”，阅读并勾选本地数据处理确认，添加 wikipedia.org。随后从其他网站进入 https://www.wikipedia.org/，再返回 WebTrace，即可查看打开次数、有效时长和访问明细。全部数据保存在本机。
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

## 首次提交步骤

1. 登录 Chrome Web Store Developer Dashboard，完成开发者账号注册、联系邮箱验证和当时页面要求的身份/付款步骤。
2. 在提交前，用无登录窗口公开访问主页、支持页和隐私政策，确认都是 HTTPS、无鉴权、无 404，并更新本文状态。
3. 选择 `Add new item`，上传 `release/webtrace-1.1.0.zip`；确认 Dashboard 识别名称 `WebTrace`、版本 `1.1.0` 和权限。
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
- [x] 名称始终为 WebTrace，摘要与 manifest 一致。
- [ ] 128px 图标、两张截图和 440×280 宣传图上传成功。
- [ ] 单一用途、五类权限理由、Remote code 和数据类别填写完成。
- [x] 隐私政策与扩展内显著告知一致。
- [ ] Distribution 与 Test instructions 已保存。
- [ ] 已决定自动发布或延迟发布。
- [ ] 只有在人工复核后才点击 Submit for Review。

## 官方依据

外部要求最后核验于 2026-09-03：

- [Store Listing 字段与图片](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [Privacy practices 填写](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [首次上传、审核与延迟发布](https://developer.chrome.com/docs/webstore/publish)
- [本机数据仍需披露](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
