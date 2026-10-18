# WebTrace Privacy Policy / 隐私政策

Effective September 3, 2026 · 生效日期 2026-09-03 · Last updated / 最后更新 2026-09-29

WebTrace is a local-only website time tracker. Its extension data stays in the current Chrome profile on your device and is not sent to the developer, zhangrh.shop, or third parties.

WebTrace 是一个仅在本机处理数据的网站时间追踪器。扩展数据保存在你设备的当前 Chrome 配置文件中，不发送给开发者、zhangrh.shop 或第三方。

## 1. Data processed / 处理的数据

WebTrace processes the website name and registrable domain that you configure; opening time, ending time, active viewing intervals, and duration; random technical identifiers used to associate websites, visits, and the current browser session; and a lightweight recovery checkpoint.

WebTrace 处理你配置的网站名称和可注册主域名；打开时间、结束时间和有效观看时长及其区间；关联网站、访问和当前浏览器会话所需的随机技术标识；以及轻量恢复 checkpoint。

To decide when time is active, WebTrace temporarily handles active-tab association, Chrome window focus and minimized state, page visibility, and device lock state. Chrome supplies navigation URLs to the extension; WebTrace parses the hostname in memory for domain matching and does not persist the full URL, path, query, or page title.

为判断有效时长，WebTrace 会临时处理活动标签页关联、Chrome 窗口前台与最小化状态、页面可见状态和设备锁屏状态。Chrome 会向扩展提供导航 URL；WebTrace 只在内存中解析主机名用于域名匹配，不保存完整 URL、路径、查询参数或网页标题。

## 2. Data not stored or read / 不保存或读取的内容

WebTrace does not store full URLs, paths, query parameters, page titles, website content, form input, passwords, cookies, authentication data, names, email addresses, account identifiers, advertising identifiers, precise location, mouse movement, keystrokes, or ordinary input-idle state. The content script does not read the page DOM.

WebTrace 不保存完整 URL、路径、查询参数、网页标题、网页内容、输入内容或 Cookie，也不读取密码、认证数据、姓名、邮箱、账号标识、广告标识、精确位置、鼠标移动、键盘输入或普通无输入状态。内容脚本不读取页面 DOM。

## 3. Purpose / 用途

The data is used only to show opening counts and active viewing duration for websites you configure, today's summary, historical trends, per-visit details, site ordering, and crash-safe local recovery. Trends show the most recent 14 days by default and let you browse older records one week at a time.

这些数据仅用于展示你配置网站的打开次数和有效观看时长、今日概览、历史趋势、逐次访问明细、网站顺序，以及异常退出后的本地恢复。趋势默认展示最近 14 天，支持按周回看更早记录。

## 4. Local storage / 本地存储

Website configuration is stored in chrome.storage.local. Current-session tab associations and the recovery checkpoint mirror are stored in chrome.storage.session. Visit records are stored in the extension's IndexedDB database. All are stored only in the current Chrome profile on your device.

网站配置保存在 chrome.storage.local；当前会话的标签关联和恢复 checkpoint 镜像保存在 chrome.storage.session；访问记录保存在扩展自己的 IndexedDB。以上内容全部仅保存在你设备的当前 Chrome 配置文件中。

## 5. Retention, deletion, and control / 保留、删除与控制

Visit records are retained indefinitely by default and have no automatic expiration. Trends show the most recent 14 days by default and let you browse older records one week at a time. Moving the displayed window does not delete stored records. You can permanently delete visit history for one configured website from Manage Sites; this cannot be undone, but the website configuration remains and tracking continues. Uninstalling WebTrace removes the extension data that Chrome stores for it.

访问记录默认长期保留，没有自动过期。趋势默认展示最近 14 天，支持按周回看更早记录；切换展示窗口不会删除已保存的数据。你可以在“管理网站”中按网站永久删除访问历史；操作不可撤销，但删除历史会保留网站配置并继续统计。卸载 WebTrace 会移除 Chrome 为该扩展保存的本地数据。

Chrome's extension settings let you disable or uninstall WebTrace and control its site access. Restricting site access can prevent recording on affected websites.

## 6. No transmission, sale, advertising, or sharing / 不传输、不出售、不用于广告、不共享

WebTrace does not upload, sell, use for advertising, or share extension data with the developer or any third party. It has no account system, analytics service, advertising service, developer data server, or cross-device sync. It does not load remotely hosted executable code.

WebTrace 不上传、不出售、不用于广告，也不与第三方共享扩展数据。扩展没有账号系统、分析服务、广告服务、开发者数据服务器或跨设备同步，也不加载远程可执行代码。

## 7. Chrome permissions / Chrome 权限

- idle：只用于判断设备是否锁屏；普通无输入状态不会停止计时，也不会保存输入行为。
- storage：在 chrome.storage.local 和 chrome.storage.session 保存网站配置与当前会话恢复信息。
- unlimitedStorage：让扩展 IndexedDB 长期保存访问历史，不用于缓存网页内容。
- webNavigation：识别进入、离开、刷新、站内和跨子域名导航；完整 URL 只被临时解析，不会持久化。
- HTTP/HTTPS host access：在用户可能主动配置的网站上确认页面可见并匹配主机名；内容脚本不读取 DOM、正文、表单或 Cookie。

## 8. Chrome Web Store Limited Use

WebTrace's use of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only for the disclosed single purpose, is not transferred outside approved use cases, and is not used for advertising, creditworthiness, or lending.

WebTrace 对用户数据的使用遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。数据只用于已经披露的单一用途，不在政策允许范围之外转移，也不用于广告、信用评估或借贷。

## 9. Children's privacy / 儿童隐私

WebTrace is a general-purpose productivity extension, is not directed to children, and does not request age, identity, or contact information.

WebTrace 是通用效率工具，不面向儿童，也不要求年龄、身份或联系信息。

## 10. Changes and contact / 变更与联系

If WebTrace's data practices change, this policy and the in-extension prominent disclosure will be updated before the changed handling is introduced. An update will not retroactively weaken the description of prior behavior.

如果 WebTrace 的数据实践发生变化，开发者会在新处理方式实施前更新本政策和扩展内显著告知；更新不会追溯性淡化此前行为。

Questions / 问题联系：[zhangrhweb@gmail.com](mailto:zhangrhweb@gmail.com)

Product page / 产品主页：[/webtrace/](https://zhangrh.shop/webtrace/)
