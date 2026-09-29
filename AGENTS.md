# Agent 工作指南

## 适用范围

- 本文件适用于整个仓库。
- 开始任务时先确认工作区状态，保留用户已有且与当前任务无关的修改。
- 项目文档遵循 `current`、`changes`、`archive` 三类语义；不要按文件所在目录推断其可见性或保密级别。

## 文档读取顺序

1. 阅读本文件。
2. 阅读 `docs/README.md`，了解文档入口和正在进行的 Change。
3. 阅读与任务相关的 `docs/current` 文档；项目整体状态从 `docs/current/project.md` 开始。
4. 检查 `docs/changes` 中是否已有相同主题的 spec 或 plan。
5. 只有在需要历史背景、调查过程或旧设计时才查阅 `docs/archive`。
6. 涉及实现事实时，最终以当前代码、测试、构建和当次运行验证为准。

## 可信度规则

- 判断实现、构建或运行状态时，取证顺序为：当前代码与当次验证 > `docs/current` 中的实现事实 > `docs/changes` > `docs/archive` > 未核验的旧描述。
- 判断已经生效的决定、契约或政策时，以 `docs/current` 中明确记录且仍然有效的决定为规范来源。
- 代码只能证明实现现状，不能自动推翻有效决定。实现与决定冲突时，应在 current 中同时记录决定和实现差距。
- 不得把提议、代码注释、旧路线图或未经用户确认的方案写成有效决定。
- 容易变化的外部状态必须注明最后验证日期；未在当前任务核验时应明确标为未确认。

## 文档治理

### `docs/current`

- 只保存当前仍然有效的事实、决定、风险和限制，并明确区分事实与决定。
- 文件应以当前结论开头，使用稳定、无日期、简短且易懂的文件名。
- 单份 current 文档不得超过 300 行；需要拆分时按主题边界和证据来源拆分，不得压缩段落规避限制。
- 不保留开发流水账、完整讨论、旧行为、原始日志或可以从 Git 历史获得的逐版本记录。

### `docs/changes`

- 尚未结束的变更材料使用扁平目录保存。
- 同一 Change 的 spec 和 plan 使用相同日期与 topic：
  - `YYYY-MM-DD-topic-spec.md`
  - `YYYY-MM-DD-topic-plan.md`
- spec 说明改变什么、为什么、范围和验收标准；plan 说明如何实施和验证。
- 不为没有产生 spec 或 plan 的任务补造空文档。

### `docs/archive`

- 已完成、取消或被替代的变更材料，以及已结束的讨论、调查、验证和旧文档，放入 `docs/archive/YYYY-MM`。
- 文件名使用 `YYYY-MM-DD-topic.md`、`YYYY-MM-DD-topic-spec.md` 或 `YYYY-MM-DD-topic-plan.md`。
- 月份目录必须与文件名日期的前七位一致，只建立一层月份目录。
- archive 不是当前事实来源；仍有效的结论必须先提炼到 current。

## Change 完成流程

1. 运行与风险相称的测试和验证。
2. 先更新受影响的 `docs/current` 文档，区分实现事实、有效决定和实现差距。
3. 再把已有 spec 和 plan 移到与文件名日期对应的 `docs/archive/YYYY-MM`。
4. 修复移动产生的链接，检查文件名、月份目录和 current 行数。
5. 确认工作区只包含预期修改。

Change 取消时，应先在已有变更材料中记录取消结论和原因，更新受影响的 current，再归档材料。

## 项目验证规则

- 本项目是无构建步骤的 Chrome Manifest V3 扩展；不要声称通过了不存在的构建或自动化测试。
- 修改 JavaScript 或 manifest 后，至少运行：

  ```sh
  node --check background.js
  node --check content.js
  node -e 'JSON.parse(require("fs").readFileSync("manifest.json", "utf8"))'
  ```

- 修改计时、可见性、存储或浮窗行为后，还应在 Chrome 的扩展管理页重新加载未打包扩展，并手动验证相关页面行为。
- 手动验证结果必须说明浏览器、验证日期和覆盖的场景；未执行时明确写明未验证。

## 安全与隐私规则

- 不提交密码、Token、密钥、Cookie、真实用户数据或 `.env` 实际值。
- 当前实现把网站配置保存在 `chrome.storage.local`，会话关联与恢复 checkpoint 保存在 `chrome.storage.session`，逐次访问与有效观看区间保存在扩展的 IndexedDB；数据仅存本机，默认长期保留。新增数据采集、远程传输或账号同步前，必须明确记录数据范围、用途、保留方式和用户控制。
- `manifest.json` 当前具有 `http://*/*` 与 `https://*/*` 主机访问范围。新增权限、扩大匹配范围或加入远程服务时，必须说明必要性并采用最小权限。
- 不加载远程可执行代码；扩展运行代码应随仓库一起提供并接受审查。
