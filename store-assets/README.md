# WebTrace 商店图片

生成日期：2026-09-03

本目录只包含发布到 Chrome Web Store 所需的公开图片。两张产品截图均来自仓库中的真实扩展页面，数据为纯合成数据；生成脚本每次使用临时的隔离 Chrome 配置，不读取日常浏览器的历史、Cookie、账号或扩展数据。

## 文件

- `screenshots/01-dashboard-1280x800.png`：仪表盘首页，展示三个示例网站、今日概览和 14 天打开次数趋势。
- `screenshots/02-add-site-1280x800.png`：网站管理对话框，展示添加网站前的本地数据处理告知与确认。
- `promo/small-promo-440x280.png`：商店 440×280 小型宣传图。
- `source/webtrace-brand-master.svg`：可审查的平面品牌图形源文件。
- `source/webtrace-brand-master.png`：1024×1024 透明品牌母版。
- `source/small-promo-imagegen-master.png`：宣传图的 ImageGen 原始母版。

## 重现方式

图标需要 ImageMagick：

```sh
npm run render:icons
```

真实扩展截图需要 Playwright 自带的 Chromium：

```sh
npm install
npx playwright install chromium
npm run capture:store
```

截图脚本会创建临时浏览器目录，载入当前仓库中的未打包扩展，写入合成的网站与访问记录，截图后关闭浏览器并删除临时目录。

## 宣传图生成说明

宣传图使用内置 ImageGen 模式生成，随后只做确定性缩放到 440×280。最终提示词为：

```text
Use case: ads-marketing
Asset type: Chrome Web Store small promotional tile, final aspect ratio exactly 11:7 (440×280).
Input images: Image 1 is the exact WebTrace brand mark and must remain visually faithful.
Primary request: Create a calm, premium promotional graphic for WebTrace, a local-only website time tracker.
Scene/backdrop: warm ivory editorial background with a restrained forest-green organic contour or time-trail motif.
Subject: place the WebTrace icon clearly on one side; balance it with the product name and one concise privacy message.
Style/medium: crisp flat graphic design, generous whitespace, strong hierarchy, understated productivity-tool aesthetic.
Color palette: forest green #315F49, warm ivory #FFF4D6, near-black #17211B, with only subtle pale-green accents.
Text (verbatim): "WebTrace" and "仅在本机记录"
Composition/framing: safe margins on all sides; large readable product name; no important detail near the crop edge.
Constraints: preserve the supplied icon design; render both text strings exactly once and exactly as written; no extra words, no tiny text, no fake browser chrome, no Chrome logo, no third-party marks, no screenshots, no gradients, no shadows, no 3D, no watermark.
```
