# 浏览器网站统计时长

TimeTracker 是一个 Chrome Manifest V3 扩展，用于在网页右上角显示当前域名当天累计的可见时长。统计数据仅保存在浏览器本地，不需要登录。

## 当前能力

- 对匹配网页按完整 hostname 统计时长。
- 页面可见时计时，隐藏时暂停。
- 以 `HH:MM:SS` 浮窗显示当天累计时长。
- 使用 `chrome.storage.local` 按本地日期保存数据。

当前版本为 `1.0.0`。账号同步、可编辑站点配置、超时提醒和分析报表尚未实现。

## 本地使用

1. 打开 Chrome 扩展程序管理页。
2. 启用“开发者模式”。
3. 选择“加载已解压的扩展程序”，并选择本仓库目录。

## 文档

- [项目文档入口](docs/README.md)
- [当前项目状态](docs/current/project.md)
- [Agent 工作指南](AGENTS.md)

代码仓库：[zhangrunhao/chrome_plugin_time_tracker](https://github.com/zhangrunhao/chrome_plugin_time_tracker)
