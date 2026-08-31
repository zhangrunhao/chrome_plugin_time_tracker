# 项目当前状态

> 最后静态核验：2026-08-31

当前仓库实现的是 Chrome Manifest V3 扩展 TimeTracker 1.0.0：它在所有匹配网页上显示当前域名当天累计的可见时长，并把统计数据保存在浏览器本地。账号同步、可编辑站点配置、超时提醒和分析报表尚未实现。

## 内容边界

本文持续回答项目当前具备什么功能、数据如何流动、有哪些限制以及这些事实如何验证。未来方案、详细实施计划和历史路线图不属于本文；相关历史材料见 [`archive`](../archive/)。

## 已验证的实现事实

### 扩展与权限

- `manifest.json` 声明 Manifest V3、版本 `1.0.0`，后台入口为 `background.js`。
- `content.js` 和 `content.css` 通过 `<all_urls>` 注入，运行时点为 `document_idle`。
- 扩展声明 `storage` 权限和 `<all_urls>` host permission。
- 当前没有 popup、options 页面、账号登录或远程服务配置。

### 计时与展示

- `content.js` 以 `location.hostname` 作为统计域名，不合并主域名和子域名。
- 代码内的白名单为空，因此当前统计所有匹配网站；白名单尚无用户可编辑界面。
- 页面文档可见时，内容脚本按约一秒间隔向后台发送新增秒数；文档隐藏时暂停累加。
- 后台返回当前域名的当天总秒数，内容脚本将其格式化为 `HH:MM:SS`。
- 浮窗固定在页面右上角，不接收鼠标事件。

### 数据

- `background.js` 按用户本地日期生成 `YYYY-MM-DD` 日期键。
- 数据保存在 `chrome.storage.local` 的 `stats` 对象中，结构为“日期 → 完整 hostname → 累计秒数”。
- 当前代码没有上传、账号同步、导出、清理或保留期限逻辑。

## 有效决定

- 项目文档采用 `current`、`changes`、`archive` 生命周期，并以根目录 `AGENTS.md` 作为 Agent 工作入口。
- 旧 README 中的 v1.1–v1.3 条目没有足够证据表明仍是已确认的进行中变更，因此不作为当前产品决定；它们仅作为历史路线图归档。
- WebTrace V1 已确认采用本地多网站统计、最近 7 天趋势分析和逐次打开记录；完整规格见 [`2026-08-31-webtrace-v1-spec.md`](../changes/2026-08-31-webtrace-v1-spec.md)。该决定尚未实现，当前代码仍保持上文描述的 TimeTracker 1.0.0 行为。

## 当前限制与风险

- 仓库没有自动化测试、构建脚本或包管理配置。
- 本次只完成了代码和 manifest 的静态核验，尚未在 Chrome 中重新执行运行时验证。
- `<all_urls>` 是较宽的访问范围；涉及权限的后续变更需要重新评估最小权限。
- 多个同时可见的页面可以分别发送计时消息，后台会把它们共同累加到对应域名。
- 消息发送失败会被内容脚本忽略，当前没有面向用户的错误提示。

## 证据入口

- 扩展声明与权限：[`manifest.json`](../../manifest.json)
- 本地日期和统计存储：[`background.js`](../../background.js)
- 可见性、心跳和浮窗更新：[`content.js`](../../content.js)
- 浮窗样式：[`content.css`](../../content.css)
- 初始路线图历史：[`2025-10-15-initial-roadmap.md`](../archive/2025-10/2025-10-15-initial-roadmap.md)
