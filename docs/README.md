# 项目文档

这里是面向开发者和 Agent 的文档入口。根目录的 [README](../README.md) 提供项目简介；本目录负责当前事实、进行中变更和历史上下文。

## 目录

- [`current`](current/)：当前仍然有效的事实、决定、风险和限制。
  - [`project.md`](current/project.md)：当前功能、实现结构、数据行为、限制与验证状态；不包含未来方案和历史过程。
- [`changes`](changes/)：尚未结束的 spec 和 plan，使用扁平目录。
- [`archive`](archive/)：已结束或被替代的材料，按文件名日期放入 `YYYY-MM` 月份目录。

## 当前 Change

- [`2026-09-03-webtrace-store-release-spec.md`](changes/2026-09-03-webtrace-store-release-spec.md)：WebTrace 商店发布准备、公开页面、隐私披露与品牌素材规格。
- [`2026-09-03-webtrace-store-release-plan.md`](changes/2026-09-03-webtrace-store-release-plan.md)：WebTrace 扩展、品牌素材、发布资料、打包与验证计划。

## 最近完成

- [`2026-09-02-webtrace-v1-1-spec.md`](archive/2026-09/2026-09-02-webtrace-v1-1-spec.md)：已完成的 WebTrace V1.1 固定 14 日分析页、折线图与持续统计规格。
- [`2026-09-02-webtrace-v1-1-plan.md`](archive/2026-09/2026-09-02-webtrace-v1-1-plan.md)：已执行并归档的 WebTrace V1.1 实施与验证计划。
- [`2026-08-31-webtrace-v1-spec.md`](archive/2026-08/2026-08-31-webtrace-v1-spec.md)：已完成的 WebTrace V1 网站使用统计规格。
- [`2026-08-31-webtrace-v1-plan.md`](archive/2026-08/2026-08-31-webtrace-v1-plan.md)：已执行并归档的 WebTrace V1 实施与验证计划。

## 命名规则

- Change：`YYYY-MM-DD-topic-spec.md`、`YYYY-MM-DD-topic-plan.md`
- 其他历史记录：`YYYY-MM-DD-topic.md`
- topic 使用简短、可检索的 kebab-case。
- 同一 Change 的 spec 和 plan 使用相同日期与 topic。
- 归档目录必须与文件名日期的前七位一致，例如 `2026-08-31-example.md` 放入 `archive/2026-08/`。

## 维护流程

1. 开始任务前阅读 [`AGENTS.md`](../AGENTS.md)、本页和相关 current 文档，并检查 changes 中是否已有同主题材料。
2. 任务产生的未结束 spec 或 plan 保存在 changes。
3. 变更完成后先用代码和当次验证更新 current，再将已有变更材料移入对应月份的 archive。
4. 调查或讨论结束后，把过程放入 archive；只有仍然有效的简洁结论进入 current。
5. 修复内部链接，并检查 current 单文件不超过 300 行。
