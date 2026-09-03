# WebTrace Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 WebTrace 增加采集前隐私确认、统一品牌与商店图片、完整发布资料和可验证的待上传扩展包。

**Architecture:** 保持现有 Manifest V3、本地存储和统计模型不变，只在分析页新增网站表单中加入显著披露和逐次明确确认。品牌素材由一个高分辨率母版派生，商店截图由隔离 Chrome 配置加载真实扩展并注入纯合成本地数据生成；发布字段与操作步骤集中在 current 文档。

**Tech Stack:** Chrome Manifest V3、原生 JavaScript、Node.js 24 `node:test`、IndexedDB、Chrome local/session storage、ImageGen、ImageMagick、Playwright、ZIP CLI。

**Spec:** `docs/changes/2026-09-03-webtrace-store-release-spec.md`

## Global Constraints

- 公开品牌名固定为 `WebTrace`；“网站时间追踪器”只作为中文功能描述。
- 不新增、扩大或改为可选权限，不改变统计、保留、删除或排序语义。
- 不新增网络发送、远程代码、账号、同步、广告、遥测或分析。
- 商店截图只使用隔离 Chrome 配置和纯合成数据，不读取本机现有 Chrome 用户数据。
- 运行图标必须是准确的 16/32/48/128 PNG；商店截图为 1280×800，宣传图为 440×280。
- 两仓库直接在各自 `main` 工作，保留所有无关修改，分别测试、提交和推送。
- 提交信息使用中文，并采用 `feat:`、`fix:`、`docs:`、`style:`、`refactor:`、`test:` 或 `chore:` 前缀。
- 完成前按仓库规则先更新 current，再把本 spec 和 plan 移入 `docs/archive/2026-09/`。

---

### Task 1: 在新增网站前显著披露数据并取得明确确认

**Files:**
- Modify: `tests/analysis-view.test.js`
- Modify: `src/analysis/view.js`
- Modify: `analysis.css`

**Interfaces:**
- Consumes: `controller.addSite({ name, input }): Promise<Site | null>`；返回 `null` 表示失败。
- Produces: 表单内 `input[type="checkbox"][name="privacyConsent"]`、`data-action="add-site"` 提交按钮和 `https://zhangrh.shop/webtrace/privacy` 链接。
- Produces: 视图私有草稿 `{ name: string, input: string, privacyConsent: boolean }`，用于 pending 重绘后保留失败输入。

- [ ] **Step 1: 扩充测试 DOM 对复选框和原生校验的模拟**

在 `FakeElement` 初始化 `checked = false`、`validationMessage = ""` 和 `reportValidityCalls = 0`，并添加：

```js
setCustomValidity(message) {
  this.validationMessage = String(message);
}

reportValidity() {
  this.reportValidityCalls += 1;
  return this.validationMessage === "";
}
```

让 `reset()` 对 checkbox 执行 `element.checked = false`，其他 input 保持 `element.value = ""`。

- [ ] **Step 2: 写失败测试覆盖披露、拒绝、成功重置和失败保留**

在 `tests/analysis-view.test.js` 新增测试，断言：

```js
assert.match(dialog.textContent, /网站名称和主域名、打开时间、结束时间及有效观看时长/);
assert.match(dialog.textContent, /全部仅保存在当前 Chrome 配置文件的本机存储中/);
assert.match(dialog.textContent, /不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie/);
assert.match(dialog.textContent, /不上传、不出售、不用于广告，也不与第三方共享/);

const consent = inputs.find(input => input.name === "privacyConsent");
assert.equal(consent.type, "checkbox");
assert.equal(consent.required, true);
assert.equal(consent.checked, false);
assert.equal(privacyLink.getAttribute("href"), "https://zhangrh.shop/webtrace/privacy");
```

未勾选直接 dispatch submit 时断言 `addSite` 未调用且 `reportValidityCalls === 1`。勾选后让 mock 返回 `{ id: "site-new" }`，断言调用一次、两个文本框清空且复选框恢复 false。另一个测试让 mock 返回 `null`，断言 pending 重绘后草稿和勾选状态仍在。

- [ ] **Step 3: 运行定向测试并确认失败**

Run: `node --test tests/analysis-view.test.js`

Expected: FAIL，原因是隐私披露、`privacyConsent` 和草稿保持尚未实现。

- [ ] **Step 4: 实现披露、确认和草稿保持**

在 `createAnalysisView` 中增加：

```js
let addSiteDraft = { name: "", input: "", privacyConsent: false };
```

`renderManager` 创建 `.privacy-disclosure`，内容按 spec 列出记录、不记录、本地存储、不共享和删除规则，并创建：

```js
const privacyLink = element(document, "a", { text: "查看完整隐私政策" });
privacyLink.setAttribute("href", "https://zhangrh.shop/webtrace/privacy");
privacyLink.setAttribute("target", "_blank");
privacyLink.setAttribute("rel", "noreferrer");

const consentInput = element(document, "input");
consentInput.type = "checkbox";
consentInput.name = "privacyConsent";
consentInput.required = true;
consentInput.checked = addSiteDraft.privacyConsent;
```

提交监听器先把三个字段写入 `addSiteDraft`。未确认时设置“请先确认数据处理说明”、调用 `reportValidity()` 并返回；确认后清空 validity 并调用 controller。仅当结果不为 `null` 时重置草稿和表单。

- [ ] **Step 5: 加入响应式、键盘可读的披露样式**

在 `analysis.css` 为 `.privacy-disclosure`、`.privacy-disclosure ul`、`.privacy-consent` 和 checkbox focus 状态增加与现有 `--accent`、`--accent-soft`、`--line` 一致的样式；不能隐藏正文或依赖 hover。

- [ ] **Step 6: 运行定向与完整回归**

Run: `node --test tests/analysis-view.test.js`

Expected: PASS。

Run: `npm test`

Expected: 全部测试 PASS，既有统计、排序和删除历史测试不回归。

- [ ] **Step 7: 提交隐私确认功能**

```bash
git add tests/analysis-view.test.js src/analysis/view.js analysis.css
git commit -m "feat: 增加网站采集前隐私确认"
```

---

### Task 2: 更新 WebTrace 品牌图标并校验 manifest

**Files:**
- Modify: `tests/manifest.test.js`
- Create: `tests/store-assets.test.js`
- Create: `images/icon_16.png`
- Modify: `images/icon_32.png`
- Create: `images/icon_48.png`
- Modify: `images/icon_128.png`
- Delete: `images/icon_64.png`
- Modify: `manifest.json`
- Create: `store-assets/source/webtrace-brand-master.png`

**Interfaces:**
- Produces: `manifest.icons` 精确映射字符串键 `16`、`32`、`48`、`128`。
- Produces: `readPngDimensions(path): Promise<{ width: number, height: number }>` 测试辅助函数，仅解析 PNG signature 和 IHDR。

- [ ] **Step 1: 写失败测试锁定图标清单和尺寸**

在 `tests/manifest.test.js` 增加：

```js
assert.deepEqual(manifest.icons, {
  "16": "images/icon_16.png",
  "32": "images/icon_32.png",
  "48": "images/icon_48.png",
  "128": "images/icon_128.png",
});
```

在 `tests/store-assets.test.js` 使用 `readFile` 读取 PNG header，断言四个文件分别为 16、32、48、128 正方形，并断言 `images/icon_64.png` 不再存在。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/manifest.test.js tests/store-assets.test.js`

Expected: FAIL，缺少 16/48 图标且 manifest 仍把 48 指向 64 文件。

- [ ] **Step 3: 用 ImageGen 生成品牌母版**

使用 imagegen skill 和以下约束生成无文字、正面视角、透明背景的 1024×1024 候选：

```text
Create a clean app icon master for “WebTrace”, a private local website-time tracker.
Use a bold forest-green rounded-square symbol with a warm-ivory time trail:
one smooth rising path, three clear nodes, and a subtle clock arc.
Flat vector-like geometry, front-facing, no text, no browser logo, no third-party marks,
high contrast, readable at 16 px, transparent outer canvas, centered with generous padding.
```

保存选定母版为 `store-assets/source/webtrace-brand-master.png`，检查其不包含文字、Chrome 标志或微小装饰。

- [ ] **Step 4: 确定性生成四个 PNG 尺寸**

先把母版规范为透明 1024×1024 且主体位于中央 768×768，再执行：

```bash
magick store-assets/source/webtrace-brand-master.png -resize 16x16 images/icon_16.png
magick store-assets/source/webtrace-brand-master.png -resize 32x32 images/icon_32.png
magick store-assets/source/webtrace-brand-master.png -resize 48x48 images/icon_48.png
magick store-assets/source/webtrace-brand-master.png -resize 128x128 images/icon_128.png
```

在浅色和深色 256px 检查板上分别放大预览四个文件；128px 文件需有约 16px 透明边距。

- [ ] **Step 5: 更新 manifest 并移除旧 64px 文件**

把 `manifest.icons` 改为测试中的精确对象；使用 apply_patch 删除 `images/icon_64.png` 的引用，并将旧文件移到系统废纸篓或通过 Git 删除（可由历史恢复）。不改变版本和权限。

- [ ] **Step 6: 运行图标、manifest 和语法检查**

Run: `node --test tests/manifest.test.js tests/store-assets.test.js`

Expected: PASS。

Run: `node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'`

Expected: exit 0。

- [ ] **Step 7: 提交品牌图标**

```bash
git add manifest.json images store-assets/source tests/manifest.test.js tests/store-assets.test.js
git commit -m "feat: 更新 WebTrace 品牌图标"
```

---

### Task 3: 生成真实扩展截图和商店宣传图

**Files:**
- Modify: `tests/store-assets.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/capture-store-screenshots.mjs`
- Create: `store-assets/screenshots/01-dashboard-1280x800.png`
- Create: `store-assets/screenshots/02-add-site-1280x800.png`
- Create: `store-assets/promo/small-promo-440x280.png`
- Create: `store-assets/README.md`

**Interfaces:**
- Produces: `npm run capture:store`，启动隔离 persistent Chromium context、注入合成数据并覆盖生成两张截图。
- Produces: `buildDemoVisits(now): Visit[]`，每条记录包含 `id`、`siteId`、`openedAt`、`endedAt`、`activeIntervals`、`lastConfirmedAt`、`lastActivityAt`。

- [ ] **Step 1: 扩展失败测试锁定商店图片**

在 `tests/store-assets.test.js` 增加尺寸表：

```js
const assets = new Map([
  ["store-assets/screenshots/01-dashboard-1280x800.png", [1280, 800]],
  ["store-assets/screenshots/02-add-site-1280x800.png", [1280, 800]],
  ["store-assets/promo/small-promo-440x280.png", [440, 280]],
]);
```

逐项断言 PNG signature 和 IHDR 尺寸，并读取 `store-assets/README.md` 断言包含“纯合成数据”“隔离 Chrome 配置”和生成日期 `2026-09-03`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/store-assets.test.js`

Expected: FAIL，商店图片和说明尚不存在。

- [ ] **Step 3: 增加 Playwright 截图脚本**

安装锁定的 `playwright` 开发依赖并增加：

```json
"capture:store": "node scripts/capture-store-screenshots.mjs"
```

脚本使用 `mkdtemp` 创建 profile，`chromium.launchPersistentContext` 加载当前仓库为唯一 unpacked extension，等待 service worker 后从 URL 取得 extension ID。打开 `chrome-extension://<id>/analysis.html`，通过页面上下文写入三条合成网站配置和最近 14 天的闭合 Visit，再 reload。

合成网站固定为 `github.com`、`developer.mozilla.org` 和 `wikipedia.org`；所有访问时间由运行日的本地午夜向前生成，ID 以 `demo-` 开头。脚本必须在 `finally` 关闭 context 并删除临时 profile。

- [ ] **Step 4: 捕获两张真实界面截图**

Run: `npm run capture:store`

Expected: 以 1280×800 viewport 生成 dashboard；随后点击 `#manage-sites`，等待隐私披露和未选中的确认框可见，生成 add-site 截图。两张均为 full-bleed viewport screenshot，不包含浏览器工具栏。

- [ ] **Step 5: 用 ImageGen 生成宣传图基础视觉并裁切**

使用与图标一致的视觉语言生成 16:10 横向品牌图：森林绿到深墨绿背景、暖白时间轨迹、三个清晰节点、少量柔和图表结构，无文字、无浏览器或第三方标志、满版。将结果中心裁切并缩放：

```bash
magick generated-promo.png -resize '440x280^' -gravity center -extent 440x280 store-assets/promo/small-promo-440x280.png
```

- [ ] **Step 6: 写素材来源说明并人工检查**

`store-assets/README.md` 记录每个文件的用途、尺寸、生成日期、合成数据名称、截图由当前真实扩展 UI 生成、宣传图使用 ImageGen 基础视觉，以及不得把这些图片解释为商店已上线。

用 `view_image` 分别检查三张图片；确认无真实数据、无虚构控件、无裁切、图标一致、半尺寸仍清楚。

- [ ] **Step 7: 运行素材测试和完整回归**

Run: `node --test tests/store-assets.test.js`

Expected: PASS。

Run: `npm test`

Expected: 全部测试 PASS。

- [ ] **Step 8: 提交商店图片**

```bash
git add package.json package-lock.json scripts/capture-store-screenshots.mjs store-assets tests/store-assets.test.js
git commit -m "feat: 准备 WebTrace 商店图片"
```

---

### Task 4: 编写可复制的商店字段和待上传包

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/current/store-publishing.md`
- Modify: `docs/current/project.md`

**Interfaces:**
- Produces: 本地输出 `release/webtrace-1.1.0.zip`，ZIP 根目录直接包含 `manifest.json`。
- Produces: `docs/current/store-publishing.md`，作为发布字段、URL、权限理由和提交步骤的当前来源。

- [ ] **Step 1: 先写发布文档验收清单**

在文档开头列出状态表，明确区分：代码与素材已准备、官网 URL 是否已验证、Developer Dashboard 尚未提交。商店标题保持 manifest 中的 `WebTrace`，中文功能描述放入摘要，不把标题改成另一个品牌名。文档写入以下可复制文本：

```text
摘要：WebTrace 在本机统计你配置的网站打开次数与有效观看时长，并展示最近 14 天趋势和访问明细。

详细描述：
WebTrace 是一款本地优先的网站时间追踪器，帮助你了解自己每天打开特定网站多少次，以及真正查看了多久。

主要功能：
• 自行添加需要统计的网站名称、域名或 HTTP/HTTPS 页面地址
• 区分新的有效打开与刷新、站内跳转和同站子标签继承
• 仅在目标标签页活动、Chrome 窗口位于前台、页面可见且设备未锁屏时累计有效时长
• 查看今日打开次数和有效使用时长
• 查看固定最近 14 天的打开次数与有效时长趋势
• 查看所选日期的逐次访问明细
• 管理多个网站并通过长按拖动调整顺序
• 按网站永久删除访问历史

隐私边界：
WebTrace 只记录你主动配置的网站名称和主域名、打开与结束时间、有效观看区间和时长。全部数据仅保存在当前 Chrome 配置文件的扩展本地存储中，不会上传给开发者或第三方。WebTrace 不保存完整 URL、路径、查询参数、页面标题、网页内容、输入内容或 Cookie，不出售数据，也不用于广告。

记录默认长期保留。你可以按网站永久删除访问历史；网站配置会保留并继续统计。卸载扩展会移除扩展的本地数据。
```

同时记录分类 `Productivity`、主要语言 `简体中文`、免费、公开、单一用途、五类权限理由、Remote code=`No`、数据类别、Limited Use、主页/支持/隐私 URL 和无需账号凭据的测试说明。单一用途固定为：“在用户设备本地统计其主动配置网站的打开次数和有效观看时长，并提供最近 14 天趋势与访问明细。”

- [ ] **Step 2: 写出精确隐私实践选择**

文档使用以下权限理由：

```text
idle：用于判断设备是否锁屏。WebTrace 只在设备未锁屏时累计有效观看时长；普通无输入状态不会停止计时，也不会保存用户输入行为。

storage：用于在 chrome.storage.local 保存用户配置的网站，并在 chrome.storage.session 保存当前浏览器会话中的标签关联和恢复 checkpoint。数据只保存在本机。

unlimitedStorage：用于让扩展自己的 IndexedDB 长期保存网站访问记录。WebTrace 不设自动过期，需要避免浏览器因普通扩展存储配额删除用户历史；该权限不用于缓存网页内容。

webNavigation：用于识别进入、离开、刷新、站内跳转和跨子域名跳转，从而正确区分一次新的有效打开与同一访问中的导航。

Host access（http://*/* 与 https://*/*）：用于在用户主动配置的网站及其子域名上确认页面可见状态，并把导航与配置域名匹配。WebTrace 不读取或保存网页正文、表单输入、Cookie、完整 URL、路径、查询参数或页面标题，只为用户配置的网站生成记录。
```

文档要求至少勾选 `Web history / browsing activity`。若 Dashboard 显示 `User activity` 且其帮助文本覆盖活动标签页观看时长，则同时勾选；`Website content`、身份、位置、认证、财务、健康、通信和用户内容保持未勾选。说明扩展不传输数据，并逐项列出所有 Limited Use 认证。Remote code 固定选择“No, I am not using remote code.”

Test instructions 使用：

```text
WebTrace 不需要账号、付费或测试凭据。安装后点击工具栏图标，打开“管理网站”，阅读并勾选本地数据处理确认，添加 wikipedia.org。随后从其他网站进入 https://www.wikipedia.org/，再返回 WebTrace，即可查看打开次数、有效时长和访问明细。全部数据保存在本机。
```

- [ ] **Step 3: 写打包和提交顺序**

在 `.gitignore` 增加 `/release/`，创建输出目录后执行：

```bash
zip -FS -r release/webtrace-1.1.0.zip \
  manifest.json background.js content.js analysis.html analysis.css analysis.js \
  src vendor images
```

文档依次说明账号注册和邮箱验证、上传 ZIP、Store Listing、Privacy、Distribution、Test instructions、Submit for Review、自动/延迟发布选择和审核通过后 30 天发布窗口。

- [ ] **Step 4: 生成并审计 ZIP**

Run: 上述 `zip` 命令。

Run: `unzip -Z1 release/webtrace-1.1.0.zip | sort`

Expected: 只有运行文件；无 `.git`、`node_modules`、测试、docs、store-assets、临时 profile 或秘密文件。

解压到 `mktemp -d` 目录，在解压根运行 manifest JSON、`node --check background.js`、`node --check content.js`，并确认所有 manifest 入口存在。

- [ ] **Step 5: 更新 README 和当前项目事实**

README 链接官网、支持、隐私与商店发布手册。`docs/current/project.md` 更新最后核验日期、图标、显著披露、商店素材和发布包事实，但明确商店尚未提交；保留既有统计事实。

- [ ] **Step 6: 运行文档与完整验证**

Run: `npm test`

Run: `find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check`

Run: `node --check background.js && node --check content.js`

Run: `node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'`

Run: `git diff --check`

Expected: 全部 exit 0；网络调用和远程可执行资源扫描无匹配。

- [ ] **Step 7: 提交发布资料**

```bash
git add .gitignore README.md docs/current/store-publishing.md docs/current/project.md
git commit -m "docs: 准备 WebTrace 商店发布资料"
```

---

### Task 5: Chrome 验收、跨仓库收口与 Notion 状态

**Files:**
- Modify: `docs/current/project.md`
- Modify: `docs/current/store-publishing.md`
- Modify: `docs/README.md`
- Move: `docs/changes/2026-09-03-webtrace-store-release-spec.md` to `docs/archive/2026-09/2026-09-03-webtrace-store-release-spec.md`
- Move: `docs/changes/2026-09-03-webtrace-store-release-plan.md` to `docs/archive/2026-09/2026-09-03-webtrace-store-release-plan.md`

**Interfaces:**
- Consumes: zhangrh.shop WebTrace 三个已部署并验证的公开 URL 和该仓库最终 revision。
- Produces: WebTrace 最终 current 状态、归档 Change、推送后的 main revision，以及 Notion 最新状态。

- [ ] **Step 1: 在 Chrome 重新加载并验收扩展**

在 `chrome://extensions` 重新加载当前未打包扩展，记录 Chrome 版本和 `2026-09-03`。验证：打开管理网站；未勾选不能提交；键盘可勾选；隐私链接打开正确 HTTPS 页面；确认后新增合成测试域名；离开再进入后出现记录；删除测试历史。不得把自动截图脚本写成手工验收。

- [ ] **Step 2: 等待并核对 zhangrh.shop 计划完成**

确认另一仓库的 `docs/changes/2026-09-03-webtrace-store-release-plan.md` 已全部执行，三条公网 URL 和资源成功，生产文案与本仓库一致。把该仓库 revision 和验证日期写入发布手册。

- [ ] **Step 3: 更新 current 并归档 Change**

在 `docs/current/project.md` 记录当次自动和 Chrome 验收；在 `docs/current/store-publishing.md` 更新官网为“已验证”，商店仍为“尚未提交”。更新 `docs/README.md` 的当前 Change/最近完成链接，再用 apply_patch 移动 spec 和 plan 到 `docs/archive/2026-09/`。

- [ ] **Step 4: 运行最终验证并检查工作区**

Run: `npm test`

Run: `find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check`

Run: `node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'`

Run: `git diff --check`

Run: `wc -l docs/current/*.md`

Expected: 测试和检查通过，每份 current 不超过 300 行，Git 只含预期收口文档。

- [ ] **Step 5: 提交、推送 WebTrace main**

```bash
git add docs
git commit -m "docs: 更新 WebTrace 发布状态并归档变更"
git push origin main
```

- [ ] **Step 6: 更新 Notion 最新状态**

先使用 Notion search 搜索 `WebTrace` 和 `chrome_plugin_time_tracker`，fetch 最匹配页面确认标题与上下文。读取 Notion enhanced Markdown spec 后，在页面顶部插入 `2026-09-03 发布准备更新`，包含：两个仓库 revision、三个公开 URL、图标/截图/宣传图、隐私确认、ZIP 路径、验证摘要，以及“Chrome Web Store 尚未创建或提交，下一步按发布手册人工填写并提交”。更新后再次 fetch 验证内容。

- [ ] **Step 7: 最终状态核验**

Run: `git status --short --branch`

Expected: `main...origin/main` 且工作区干净。最终报告不得声称商店已经提交或通过审核。
