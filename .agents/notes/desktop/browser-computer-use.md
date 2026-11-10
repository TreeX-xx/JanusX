---
{
  "schema": "harness-note/2",
  "id": "ff1fd0c5-c997-4c70-8824-ba13a76d0087",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-27",
  "updated": "2026-11-06T03:26:58Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/48db2e15-9318-5068-b300-b1913abf5463"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/bd7fd0c6-48d1-4d1c-8c6b-b675d7e489bd"}
  ]
}
---

# 浏览器与桌面应用控制

## Intent

研究如何让 JanusX 内置 Agent 和外部终端 Agent 操作网页与桌面应用，并把运行时分发、工具发现、登录态、权限引导和故障恢复做成开箱即用的体验。用户已根据比较选择 Chrome DevTools MCP；[内置浏览器控制](./browser-control.md)已接入普通 Janus 聊天，并新增浏览器控制和电脑控制两个设置栏。电脑栏目前仅保存候选驱动路径和检测版本，实际电脑控制尚未接入。用户已确认电脑控制采用三平台架构、Windows 优先实施与验证，随后接入 macOS、Linux；不再要求三平台同一期交付。具体系统版本、架构和 Linux 桌面环境仍待支持矩阵明确。

产品约束是优先复用社区工具，避免重复造轮子。先评估现成 MCP、CLI 或 SDK，复用快照、元素定位、输入和平台驱动；JanusX 负责宿主接入与产品体验。只有确认现成工具存在具体缺口，才讨论补充实现，不默认自建浏览器自动化引擎或各平台助手。浏览器候选收敛为 Chrome DevTools MCP 与 Playwright MCP，结合用户对前者社区覆盖的关注，优先验证 Chrome DevTools MCP；本轮未进行同口径使用量统计，不记录二者的使用量排名。

用户已明确电脑控制必须支持人机同时操作：Agent 工作时，用户仍能独立使用鼠标键盘。代表验收场景是用户在一个应用持续输入和移动鼠标，Agent 同时完成另一个目标应用的操作；需观测真实指针、键盘焦点和输入落点，不能只凭工具调用成功判断。此要求进入驱动选型条件，不能默认以轮流占用前台替代。首批目标应用、用户与 Agent 是否需要操作同一窗口、必须使用前台时是否允许显式请求临时接管，以及是否接受隔离桌面或虚拟机，尚未确定。

用户进一步明确以通用电脑控制为目标，尽量适配各种应用。代表应用列表用于验证覆盖率，不作为产品的应用白名单；尚未确定的测试样本不能解释为收缩到少数专用应用。用户要求同时参考 codeg 与 Orca 的实现和人机同时操作能力。

首个目标流程是：用户安装 JanusX、配置模型后，说“打开项目网页，检查登录表单”，Agent 能打开用户可见的页面、操作并检查结果，返回截图或错误依据。模型服务配置仍是前提；视觉坐标操作还需要模型具备图像理解能力。

## 当前基础与边界

[内嵌浏览器](./browser-surface.md)提供每标签页独立的 WebContentsView、持久 partition、内嵌与独立窗口切换、导航和加载状态。[控制适配](./browser-control.md)复用上游 MCP 操作普通网页，并让宿主负责目标归属、原生标签显示、审批和取消；服务页和应用壳不进入目标清单。不开放任意 Agent 页面脚本或网页到主进程的控制桥。

[选元素→AI 按元素改](./requirements/element-picker-ai-edit.md)是用户主动点选、把元素上下文送入聊天的独立需求，不等同 Agent 自主控制页面。本探索若进入实施，需要单独明确页面操作协议和授权边界，不隐式放宽该需求的注入限制、HTML 预览沙箱或宿主接口暴露限制。

[agentX 复用边界](../blueprint/agentx-harness-inheritance.md)已有共享工具注册、MCP 与审批接线。通用协议、工具描述和客户端适配可评估放入共享层；Electron 页面实例、窗口生命周期和系统权限引导由 JanusX 宿主持有，具体包归属待定。终端浏览器桥接及六种终端的接入管理现由[浏览器控制](./browser-control.md)维护，原生 CLI 的版本兼容与实际调用仍需单独验证。

## 社区工具调研与复用判断

2026-11-05 搜索并阅读上游 README、官方文档与发布页，2026-11-06 按三平台范围复核 Chrome DevTools MCP 与 Cua 官方文档。本表归纳上游声明；后续对两个浏览器 MCP 的固定版本实测另见下节，其他候选未运行。优先级为结合 JanusX 需求的判断，不代表已经完成选型。来源含当前 main 和滚动文档，产品接入前仍需固定来源修订。

| 工具 | 已有能力与接入方式 | 对 JanusX 的适用性及待验证项 |
|---|---|---|
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 提供 MCP 与 CLI，基于 Puppeteer 操作；已有页面快照、点击、表单、截图、网络、控制台及性能分析，可指定 `--browser-url` / `--ws-endpoint` 连接已有实例 | 浏览器优先候选，直接复用工具层。官方只保证 Chrome / Chrome for Testing；本机对独立 Chrome、Edge 和 Electron 内嵌页已有代表实测，范围及宿主集成缺口见下文 |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) / [Playwright CLI](https://github.com/microsoft/playwright-cli) | 结构化可访问性快照、元素操作、截图及浏览器工具；MCP 可指定 CDP endpoint，CLI 提供 `attach --cdp`；Chrome/Edge 扩展可复用现有登录页 | 浏览器对照与备选，可复用完整工具层。本轮已通过内嵌页代表操作；独立浏览器连接对启动/调度条件敏感，具体结果见下文。系统扩展接入与内嵌页适配分别维护 |
| [Vercel agent-browser](https://github.com/vercel-labs/agent-browser) | 原生 Rust CLI，提供 snapshot、元素引用、click、fill 等操作；daemon 通过 CDP 控制浏览器，支持连接已有实例 | 保留为终端 CLI 与分发对照；本轮浏览器主比较范围已收敛为两个 MCP。目标应是显式连接 JanusX 现有页面，连接能力仍需实测 |
| [Cua Driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) | 原生跨平台桌面驱动，提供 MCP、CLI、Python/TypeScript SDK；支持可访问性与像素操作，也有 Chromium/Electron 页面 CDP 工具 | 三平台桌面优先候选，也值得验证一套工具覆盖两端。官方支持 macOS、Windows 和 Linux，Linux 按 X11 / Wayland compositor 分级；后台输入与应用覆盖存在边界，详见下表 |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | 面向 Windows 的现成 MCP 服务，读取窗口/UI 状态、控制应用并执行键鼠操作，视觉模型可选；已有 PyPI 与 MCP Registry 分发入口 | 仅保留为 Windows 能力对照或已确认缺口的备选，不能独立满足三平台目标。当前 README 要求 Python 3.14+ 和 uv，满足开箱即用需要 JanusX 管理运行时，不能把安装任务交给用户 |

成熟度判断分层：浏览器有 Playwright 等成熟自动化底座和现成 Agent 工具；桌面已有可接入的驱动与 MCP，但应用、控件、权限和前后台兼容性仍需实测。所读发布页显示 Playwright MCP、agent-browser、Windows-MCP 都有连续版本；这证明有分发和维护活动，不等于 JanusX 的需求已通过验收。Cua 仓库同时发布 Driver、Spaces 与 nightly，不能把仓库的通用 Latest 标签直接当成 Driver 固定版本。

[Browser Use](https://github.com/browser-use/browser-use) 和 [UI-TARS Desktop / Agent TARS](https://github.com/bytedance/UI-TARS-desktop) 也提供完整 Agent 能力。JanusX 已有 Agent 编排，当前优先比较可独立接入的工具与驱动；若继续评估 Browser Use，应查看其 README 列出的独立 Browser Harness，区分浏览器工具与整套 Agent 循环。[pywinauto](https://github.com/pywinauto/pywinauto) 已封装 Win32 / UI Automation，可作为已确认缺口时的底层备选，但仍需补 Agent 工具协议，因此不排在现成 MCP 之前。

直接影响集成的来源与限制：

- [Playwright CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)明确说明 CDP 连接的保真度低于 Playwright 协议；能连接 Chromium 不等于所有高级能力可用。[Playwright 扩展](https://github.com/microsoft/playwright/tree/main/packages/extension)解决的是现有 Chrome/Edge 页面的接入。
- [agent-browser CDP 模式](https://agent-browser.dev/cdp-mode)可显式连接已有实例，连接丢失后报错而非悄悄启动本地新浏览器；其 session 机制仍不能替代 JanusX 对共享标签页的会话授权。
- [Cua 平台矩阵](https://cua.ai/docs/cua-driver/concepts/platform-support)、[浏览器工具](https://cua.ai/docs/cua-driver/guides/browsers)及 [SDK](https://cua.ai/docs/cua-driver/guides/use-the-sdk)分别记录平台边界、窗口/页面绑定与宿主嵌入方式。其浏览器引用已有快照失效规则，应先验证复用，不重做一份。
- [Cua Driver README](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)区分 MIT 核心与显式安装的视觉扩展；扩展包含 AGPL-3.0-only 的 OmniParser 图标检测器，不能按核心 MIT 一并认定整个分发包的许可。
- 维护证据：[Playwright MCP 发布页](https://github.com/microsoft/playwright-mcp/releases)、[agent-browser 发布页](https://github.com/vercel-labs/agent-browser/releases)、[Windows-MCP 发布页](https://github.com/CursorTouch/Windows-MCP/releases)、[Cua 发布页](https://github.com/trycua/cua/releases)。

### 三平台电脑控制的交付边界

三平台架构统一，实施顺序为 Windows 优先，macOS、Linux 后续接入。选型需满足统一 MCP/SDK 接入、按平台提供运行时、权限检测和恢复路径。Cua Driver 仍是优先验证的通用候选，Windows 专用工具可作为首个平台的实现或对照，但不能成为上层协议的隐含依赖。以下是 [Cua 平台矩阵](https://cua.ai/docs/cua-driver/concepts/platform-support)与[快速开始](https://cua.ai/docs/cua-driver/quickstart)的上游声明，尚不是 JanusX 的实测支持表。

| 平台 | 上游声明与集成条件 | JanusX 需验证的边界 |
|---|---|---|
| macOS | 快速开始要求 macOS 14+；依赖辅助功能与屏幕录制授权，平台矩阵列出原生控件和多种应用框架覆盖 | 首次权限引导、签名/分发归属、授权后的恢复；部分后台滚动和拖拽仍受限 |
| Windows | 快速开始列出 Windows 10/11；平台矩阵使用 Win32、UI Automation、原生输入及窗口消息 | 控件与应用覆盖、部分后台 Chromium 手势、高权限目标、前台接管及多显示器 |
| Linux X11 / XWayland | 使用 X11、XTest、AT-SPI；XWayland 路线要求目标实际为 X11 窗口 | 可访问性服务、桌面会话、工具包兼容性及前后台输入 |
| Linux 原生 Wayland | 按 compositor 分级；Sway、niri、GNOME 有受限支持，KDE/KWin、Hyprland 部分路线仍为实验性；原生 Wayland 为显式启用 | GNOME helper/portal 引导、窗口发现与截图、遮挡窗口输入，以及各 compositor 的具体缺口；不能以 XWayland 测试代替原生 Wayland 验证 |

三平台应使用同一组代表流程验证窗口发现、状态读取、点击输入、截图、结果确认和停止恢复；先在 Windows 跑通并固定通用验收方法，后续平台复用。Linux 支持矩阵需列明桌面环境、显示协议、版本和架构，并覆盖主流原生 Wayland 的实际需求；只有 X11 或单一 compositor 通过时，不得宣称 Linux 全面兼容。macOS、Linux 在设计中保留独立适配位置，未经实现和验证的能力显示尚未接入，不以 Windows 通过代替其它平台验收。

## JanusX 内嵌浏览器实测

2026-11-06 在本机 Windows 上先运行 Chrome DevTools MCP `1.12.0`，再运行 `@playwright/mcp` `0.0.84`，两者通过真实 stdio MCP 客户端连接同一次构建的 JanusX Electron 内嵌 WebContentsView，未启动独立 Chrome。环境为 Node `24.15.0`、Electron `35.7.5`、Chromium `134.0.6998.205`；Playwright MCP 握手报告底层版本 `1.65.0-alpha-2026-10-30`。每个提供方使用独立 profile、知识目录和 MCP 输出目录，相同 HTTP fixture 内容使用不同临时端口，iframe 使用第二个端口形成跨源，不是跨站/OOPIF 全覆盖验证。

构建命令为 `npm run build:check`。来源 HEAD 为 `592cc2a8ce9a94955f50615314cb4d14199866d5`，包含当时工作区已有的编辑器等未提交修改，并非干净发布 checkout；原始报告保存 dirty 路径清单与入口 SHA-256 `eb21c5f58f44bca6decff80c3260b425be19f55c5926972f321b08023eb24c6a`。未改变应用依赖或产品接线。测试程序通过 MCP 执行页面操作，独立观察器只负责宿主准备、读取页面/服务端结果和核对文件，不用浏览器库代替 MCP 完成被测动作。

| 相同测试场景 | Chrome DevTools MCP | Playwright MCP |
|---|---|---|
| 发现并控制已有 WebContentsView | 通过 | 通过 |
| 读取快照、填写登录表单并验证单次提交 | 通过 | 通过 |
| 按快照引用点击、操作开放 Shadow DOM、跨源 iframe | 通过 | 通过 |
| 获取 console 错误与 HTTP 503 请求 | 通过 | 通过 |
| 截图、上传、下载并核对文件内容 | 通过 | 通过 |
| 原生 confirm 弹窗 | 通过 | 通过 |
| 导航后拒绝旧引用，未误点新页面 | 通过 | 通过 |
| 登录 cookie 跨页面重载、用户和 MCP 交替操作同一页面 | 通过 | 通过 |
| MCP 断开重连、DevTools 共存 | 通过 | 通过 |
| 控制连接后由宿主创建并激活的第二标签页，及重连后再操作 | 通过 | 通过；发现新页允许 5 秒事件同步窗口 |
| MCP 自身切页同步 JanusX 当前原生标签 | 未通过 | 未通过 |
| MCP 自身新建页并纳入 JanusX surface | 未通过 | 未通过 |

每个提供方最终为 19 个检查中 17 个通过、2 个宿主集成检查未通过，命令以 exit 1 报告缺口，不视为全绿。主要区别及结论：

- Chrome DevTools MCP 的被测动作显式携带 `pageId`，较便于让宿主绑定会话目标；Playwright MCP 的被测动作依赖先选择的当前页，调用协调需同时保护“选页→动作”序列。本轮未验证多 Agent 并发隔离。
- 本轮连接后的工具清单分别为 32 / 25 个，序列化清单为 28,928 / 21,070 字符；同一初始页快照为 928 / 1,346 字符。Chrome 的快照较紧凑，Playwright 输出附带标签、URL、标题和结构层次。这是当前默认配置与单个 fixture 的字符数，不是模型 token 账单或普遍性能基准。
- 两者直接新建页都返回 `Protocol error (Target.createTarget): Not supported`。已有 JanusX `BrowserAPI.openTab` 创建的页面可以由两者控制；应复用宿主创建能力，再交给上游操作。
- 两者 MCP 选页均不会更新 `BrowserSurfaceManager.activeTabId`；JanusX 仍显示原来激活的 WebContentsView。接入需要由宿主激活目标并更新布局，再执行 MCP 动作。调试轮次也观察到对已摘除原生视图的隐藏页点击超时，因此不能把 MCP 页选择当作原生视图激活。
- 原始目标清单还能发现 JanusX 自身的 `file://` shell 页面；本轮只操作 fixture，产品接入仍需限定允许的目标，不能直接把整个应用 CDP 目标集当作用户网页集合。

本轮结果支持优先接入 Chrome DevTools MCP，Playwright MCP 保留备选。两者都能复用页面操作，Chrome 的显式页面参数适合 JanusX 的会话目标管理；结论不是 Playwright 功能不可用。表中保留上游直连时的原始失败，后续[宿主适配](./browser-control.md)已补齐标签创建/激活、目标限定和审批/取消接线，不需要自建 DOM 快照、点击或输入引擎。

复现程序为 [browser-mcp-comparison.mjs](../../../scripts/browser-mcp-comparison.mjs)。隔离安装命令：`npm install --prefix artifacts/browser-mcp-comparison/runtime --workspaces=false --no-audit --no-fund --package-lock=false --save-exact chrome-devtools-mcp@1.12.0 @playwright/mcp@0.0.84`。构建后运行 `node scripts/browser-mcp-comparison.mjs`，默认严格先 Chrome、再 Playwright；也可指定 `--provider=chrome` 或 `--provider=playwright`。

最终证据目录为 `artifacts/browser-mcp-comparison/runs/2026-11-05T16-33-09-290Z/`，每端保存 `report.json`、工具 schema、逐次 MCP 请求/结果、stderr、下载文件和截图。此前目录为调试证据，不作为最终通过数；初版测试观察器会自动关闭弹窗，且下载最初仅记录点击，均已修正后重跑。未验证真实网站/SSO、封闭 Shadow DOM、canvas 坐标、完整跨站 iframe、应用重启后的登录持久性、断线时非幂等动作恢复、停止后的队列取消、多会话授权、macOS/Linux、安装包分发或真实模型自主完成率。电脑控制未测试。

## 独立 Edge / Chrome 实测

2026-11-06 补测本机安装的 Edge `156.0.4314.58` 与 Chrome `156.0.8078.80`。MCP 仍固定 Chrome DevTools MCP `1.12.0`、`@playwright/mcp` `0.0.84`。每个浏览器先测 Chrome DevTools MCP，再测 Playwright MCP；另对 Playwright 做启动参数诊断。浏览器使用可见窗口和每次独立的 `--user-data-dir`，通过 loopback CDP 接入，未读取或复用用户日常 profile，未修改 JanusX 产品接线。

共用内嵌测试的 HTTP fixture，每组 17 项检查：已有页面、表单提交、点击结果、开放 Shadow DOM、跨源 iframe、console/HTTP 错误、截图、上传、真实下载、confirm、旧引用失效、cookie 重载、用户/MCP 交替操作、MCP 重连、新建标签、切换目标后操作正确页面及关闭标签。下载验证保留浏览器 CDP 会话直到 `completed` 事件，并核对实际文件内容；设置下载目录是测试准备，不代表 MCP 自带完整下载管理。

| 外部浏览器 | Chrome DevTools MCP：普通启动 | Playwright MCP：普通启动 | Playwright MCP：加后台调度参数 |
|---|---|---|---|
| Edge | 17/17 通过 | 最终连续轮次 5/17 通过，存在点击等待稳定超时 | 17/17 通过 |
| Chrome | 17/17 通过 | 最终连续轮次 5/17 通过，存在点击等待稳定超时 | 17/17 通过 |

Playwright 的普通启动结果并不稳定：较早单独/连续轮次也跑通过主要操作，最终连续轮次在两个浏览器上均复现 `waiting for element to be visible, enabled and stable` 超时；登录未提交导致后面的 cookie、重连等检查连带失败，12 个失败检查不等于 12 类独立缺陷。诊断只额外加入 `--disable-backgrounding-occluded-windows`、`--disable-renderer-backgrounding`、`--disable-background-timer-throttling` 后，同样两组均通过。它们也出现在本地 Playwright 的自动化启动参数中。本机现象支持“受后台/遮挡窗口调度条件影响”的推断，但尚未逐个开关消融或定位上游根因，不应宣称 Playwright 无条件稳定，亦不能据此宣称 Edge/Chrome 不兼容。

独立浏览器可以直接使用两者的新建和关闭标签工具，未出现 Electron 的 `Target.createTarget: Not supported`。切换目标后的点击由两个页面各自的计数变化验证，证明 MCP 操作落到正确页面。上游工具会模拟页面焦点；早期用 `document.visibilityState` 断言原生前台标签的方法不可靠，最终不以此证明操作系统前台窗口/标签焦点。前台 UI 焦点与 MCP 目标选择应区分，前者未独立验收。

普通配置的最终证据为 `artifacts/browser-mcp-comparison/runs/2026-11-05T16-52-06-104Z/`，四组原始结果均保留；Playwright 参数诊断的证据为 `artifacts/browser-mcp-comparison/runs/2026-11-05T16-55-50-520Z/`，两组为 exit 0。较早目录保留调试记录，包括下载 CDP 会话过早摘除和完成事件先后顺序的测试问题，不替代最终结果。已抽查 Edge/Chrome 的 MCP 截图。

复现命令：`node scripts/browser-mcp-comparison.mjs --browser=external-all`。仅测某浏览器可用 `--browser=edge` / `--browser=chrome`；参数诊断使用 `--browser=external-all --provider=playwright --unthrottled`。脚本默认仍为原来的 JanusX 内嵌测试，不必重新构建 JanusX 即可运行外部模式。浏览器进程只关闭本次隔离 profile 的实例。

对独立浏览器优先推荐 Chrome DevTools MCP；Playwright 的代表功能也可复用，但需记录并验证实际启动/窗口调度条件。该轮只测试独立浏览器，后续产品实施由[内置浏览器控制](./browser-control.md)维护；真实网站/SSO、已有个人登录 profile、重启登录保留、macOS/Linux 和模型自主完成率仍未验证，电脑控制继续置后。

## 宿主产品参考观察

2026-11-06 按用户要求复核 codeg，固定源码提交为 `e3171d69d208bdf37697b15e8b14f8c9b70825bf`，仅阅读源码，未运行产品。其[驱动定义](https://github.com/spacering-net/codeg/blob/e3171d69d208bdf37697b15e8b14f8c9b70825bf/src-tauri/src/computer/driver.rs)固定下载和验证 Cua Driver 0.36.0；[模块入口](https://github.com/spacering-net/codeg/blob/e3171d69d208bdf37697b15e8b14f8c9b70825bf/src-tauri/src/computer/mod.rs)把窗口授权、辅助进程、状态指示、停止机制和驱动生命周期放在宿主层。其[动作实现](https://github.com/spacering-net/codeg/blob/e3171d69d208bdf37697b15e8b14f8c9b70825bf/src-tauri/src/computer/helper/act.rs)构造固定的驱动调用，并自行补充 macOS／Windows 的后台窗口恢复等操作；不是完全自行实现底层电脑自动化，也不是没有宿主开发的原样转发。

codeg 默认按后台投递动作，允许前台时由用户设置控制。[Agent 工具协议](https://github.com/spacering-net/codeg/blob/e3171d69d208bdf37697b15e8b14f8c9b70825bf/src-tauri/src/acp/computer_tools.rs)明确提供 `computer_background_unavailable` 和 `computer_foreground_not_allowed`；全屏坐标动作也明确按前台执行并会移动用户指针。因此可参考它通过通用驱动扩大覆盖、由宿主补齐具体缺口的分工，但源码不能证明所有应用都支持不干扰用户的后台操作。JanusX 的前台回退策略尚待用户确定。

同日复核 Orca，固定源码提交为 `f4afb9cca1b3a58294a2913069167816b26a48ec`，仅阅读源码，未安装、运行或比较成功率。Orca 自行维护分平台电脑控制助手：[macOS Swift 原生程序](https://github.com/stablyai/orca/blob/f4afb9cca1b3a58294a2913069167816b26a48ec/native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift)、[Windows PowerShell／UI Automation／Win32 运行时](https://github.com/stablyai/orca/blob/f4afb9cca1b3a58294a2913069167816b26a48ec/native/computer-use-windows/runtime.ps1)、[Linux Python／AT-SPI 运行时](https://github.com/stablyai/orca/blob/f4afb9cca1b3a58294a2913069167816b26a48ec/native/computer-use-linux/runtime.py)。对外通过 `orca computer` CLI 和配套 Skill 提供观察、动作与再观察流程，不能把其内置浏览器使用的社区驱动等同于桌面助手的实现。

Orca 的后台能力存在平台差异。macOS 的 [BackgroundInputTransport](https://github.com/stablyai/orca/blob/f4afb9cca1b3a58294a2913069167816b26a48ec/native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/BackgroundInputTransport.swift)使用目标进程／窗口事件和私有系统符号，目标是不激活应用、不移动真实指针；缺失符号、活跃应用的目标窗口不匹配以及部分菜单／拖拽场景存在拒绝或限制。Windows 的 `Invoke-OrcaPrimaryAction`、`Set-OrcaElementValue` 使用控件语义接口；点击的合成回退及滚动、拖拽路径使用真实鼠标，文本／按键路径包含焦点要求和前台输入。Linux 使用 AT-SPI 语义动作，原始输入路径仍有焦点要求，其截图函数在 Wayland 下不提供该截图路线。这些代码不能证明三平台任意应用均能在用户继续输入时无干扰执行。

Orca 的[电脑控制基准说明](https://github.com/stablyai/orca/blob/f4afb9cca1b3a58294a2913069167816b26a48ec/config/benchmarks/computer-use/README.md)明确对比其 Linux／Windows 直接实现与 Cua Driver，Cua 只作为测试对照，不被装入 Orca 的此实现。测试使用独立目标窗口和前台 sentinel，观察焦点、指针、剪贴板及独立业务状态；部分点击／滚动探针同时向 sentinel 输入字符。基准绕过公共 CLI 和模型，只覆盖指定 GTK／WinForms／Electron 夹具，并明确排除推导任意应用支持或完整人机并发成功率。JanusX 可采用此测试方法；本轮没有运行这些基准，也不据此给出两个项目或驱动的性能／兼容性排名。

2026-10-27 阅读 codeg、Orca 的公开源码与文档；未运行它们的安装包。以下是所读实现的观察，不代表跨平台实测结果。链接指向上游 main，后续实现时需固定来源修订并重新核对许可。

| 方面 | codeg | Orca | 对 JanusX 的启发 |
|---|---|---|---|
| 浏览器感知与操作 | 在页面隔离世界运行脚本，复用 Playwright ARIA 树，提供 snapshot、元素引用和 act | 内嵌 Chromium，通过 CDP 和 agent-browser 桥接自动化，CLI 提供 snapshot、click、fill 等操作 | 控制用户正在看的同一页面，统一语义快照与操作 |
| 桌面控制 | 固定版本 cua-driver，配合 helper、窗口共享授权和停止机制 | 分平台助手；Windows 使用 UI Automation、PowerShell 与系统接口 | 比较复用驱动与维护平台助手的成本 |
| 运行时交付 | 自动获取固定版本驱动，并校验归档、可执行文件摘要；macOS 另有签名检查 | 浏览器桥接优先寻找随包的平台二进制；桌面文档说明分平台原生助手 | 不让用户手装开发运行时，运行时版本由产品管理 |
| Agent 接入 | 通过 Agent 工具体系提供浏览器与桌面能力 | CLI 与技能暴露同一能力给终端 Agent | 内置工具、CLI、MCP 共用宿主服务 |
| 状态可靠性 | 页面快照带 generation，旧引用在导航等条件下失效；宿主参与导航 epoch 管理 | 强调 snapshot→act→snapshot，元素索引属于最新快照 | 操作基于明确状态，执行后验证结果 |

codeg 的 browser-agent 明确将 JavaScript 派发事件标为 synthetic fidelity：合成点击、按键不能完全替代真实用户输入，弹窗用户激活、真实 hover 等存在限制。JanusX 不应把成功派发事件当成业务动作成功，应按动作选择 CDP 输入、语义操作或视觉兜底，并读取后续状态验证。

参考来源：

- [codeg browser-agent：隔离世界、ARIA 快照、引用失效与合成操作限制](https://github.com/spacering-net/codeg/tree/main/browser-agent)
- [codeg 浏览器工具协议与错误分类](https://github.com/spacering-net/codeg/blob/main/src-tauri/src/acp/browser_tools.rs)
- [codeg cua-driver 分发、版本与完整性校验](https://github.com/spacering-net/codeg/blob/main/src-tauri/src/computer/driver.rs)
- [Orca 浏览器：同页自动化、登录 profile 与远程网络归属](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/browser/overview.mdx)
- [Orca Computer Use：能力检查、快照、操作和截图](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/computer-use.mdx)
- [Orca 随包 agent-browser 二进制解析](https://github.com/stablyai/orca/blob/main/src/main/browser/agent-browser-bridge-process.ts)
- [Orca Windows UI Automation 实现](https://github.com/stablyai/orca/blob/main/native/computer-use-windows/runtime.ps1)

## 已确认的架构方向

用户已接受以下方案：整体分工参考 codeg，以现成通用驱动承担主要电脑操作，JanusX 负责 Agent 接入、目标归属、权限、设置和停止；参考 Orca 的后台输入实现，对实际验证出的缺口补充平台适配，并优先考虑上游修复。通用应用覆盖与人机同时操作均保留为目标，验收同时检查业务结果以及用户鼠标、键盘焦点和剪贴板是否受干扰。当前确认的是架构方向与 Windows 优先的实施顺序，不代表已经选定具体驱动版本或完成兼容验证。

上层共享电脑控制服务，对内置 Agent 与外部终端提供一致的工具语义和错误结果；平台适配负责驱动启动、系统权限、应用／窗口发现、快照与截图、输入执行及取消。Windows、macOS、Linux 使用统一的目标身份、快照引用、会话归属和停止协议，由各平台报告实际能力与后台／前台执行方式。Windows 的 HWND、UI Automation、PowerShell 等实现细节留在适配内部；工具参数、设置模型与通用调度不绑定这些细节。macOS、Linux 后续通过同一接口接入，驱动文件、安装和权限检测按平台分开。

优先由内置 Agent 接入现成 MCP，外部终端 Agent 使用上游 CLI/技能或同一受控 MCP 接入。若宿主集成确需 SDK，再做薄适配；不要求把上游工具重新实现成 JanusX 自有工具。JanusX 宿主统一会话身份、目标归属、能力发现、取消和操作记录，保持页面元素引用和桌面窗口引用的类型边界。已有工具若能同时覆盖两类目标，可共用提供方，不强制拆成两套驱动。

浏览器当前采用 Chrome DevTools MCP `1.12.0` 的页面工具，标签创建和激活由宿主负责，具体清单和限制由[实现决策](./browser-control.md)维护。Playwright MCP 保留备选，Cua 浏览器工具随电脑控制另行评估。原先直接使用 `webContents.debugger` 自建快照与动作的路线仅在确认具体缺口后再考虑；复杂页面覆盖、安装包分发与包体仍需后续验证。

桌面能力先在 Windows 实现和验证，通用接口覆盖窗口发现、状态读取、点击输入、截图、按键、滚动及停止恢复；拖拽的具体形态与覆盖待支持矩阵明确。优先操作可访问性元素，画布或自绘控件再以截图坐标兜底；坐标输入也需声明是否会影响用户输入，不能静默转为前台操作。先验证 Cua Driver 在 Windows 的实际覆盖、人机输入干扰与分发成本，同时核对后续平台的适配条件；Windows-MCP 保留为 Windows 对照。存在明确缺口时，优先上游修复或现成工具补齐，不默认维护完整的自有平台驱动。

针对人机同时操作的要求，2026-11-06 复核 [Cua 官方平台矩阵](https://cua.ai/docs/cua-driver/concepts/platform-support)：其后台动作能力仍按平台、应用和动作受限，标准 Wayland 通常不能向失焦且被遮挡的窗口发送原始输入。现有证据不支持承诺三平台任意应用均可独立后台操作；选型需分别验证语义动作与坐标／键盘输入的实际干扰。上述为上游声明，JanusX 尚未实测。后台能力不足时的产品行为仍待讨论，不在本轮默认启用前台回退。

快照引用至少绑定会话、目标标签页或窗口，以及快照版本。页面导航、目标销毁或其他使引用无效的变化应返回明确失效错误，让 Agent 重新获取快照，不能把旧编号解析到新元素。动作执行后读取状态验证；请求已经发出而响应丢失时，先检查结果，避免重复提交。

## 开箱即用的交付条件

- 运行时由应用负责：浏览器复用 Electron；桌面 helper 随包分发或自动下载固定版本并验证完整性。若要求首次离线可用，所需 helper 必须随包携带；不依赖用户另装 Node、Python 或 Playwright。
- 三平台架构、分阶段交付：先完成 Windows 的运行时、系统权限检测、工具发现及恢复，macOS、Linux 经相同接口后续接入。具体系统版本、架构与 Linux 显示协议按各自已验证支持矩阵声明；未接入平台如实显示状态。
- 工具自动可发现：内置 Agent 启动时注册能力；终端通过浏览器设置注册受控 MCP（Pi 为原生扩展），不默认改动 Skill 或其它 MCP；接入后验证实际连通性，不只写入配置文件。
- 登录态连续：用户和 Agent 使用 JanusX 中同一网页实例和浏览器会话。复用系统 Chrome/Edge 的既有登录态另行设计扩展或显式连接，不视为内嵌浏览器已有能力。
- 可停止和接管：显示页面或窗口的控制状态；取消后阻止排队中的后续动作。桌面前台输入串行，浏览器按页面协调控制，避免多个会话争抢同一目标；单例全局浏览器不代表所有会话都获准操作全部标签页。
- 故障可恢复：区分驱动缺失、系统权限不足、窗口关闭、引用失效和页面超时，给出相应恢复路径。系统权限可能需要用户首次授予，应用负责检测与引导。
- 按能力匹配模型：语义树操作与视觉坐标操作分别声明所需能力，工具不可用时明确说明，不将视觉能力缺失伪装为页面失败。

## 推进顺序与候选验证

以下为建议阶段与验证场景，未创建 Task，也不是已签收的验收清单。

| 阶段 | 建议交付 | 代表验证场景 |
|---|---|---|
| 一 | 内置 Agent 控制现有内嵌浏览器 | 打开本地网页，填写表单、点击并验证页面结果 |
| 二 | CLI/MCP 复用浏览器服务 | 外部终端 Agent 操作同一标签页，保持会话和目标归属；当前桥接与管理已有实现，实际 CLI 兼容矩阵需继续验收 |
| 三 | 三平台公共协议与 Windows 电脑控制 | Windows 完成指定窗口发现、读取控件、输入点击、截图、结果验证与停止恢复；用户在另一窗口持续输入和移动鼠标时观测干扰；通用层不依赖 Windows 原生标识 |
| 三后续 | 接入 macOS、Linux 平台适配 | 复用公共服务和代表流程，分别验收系统权限、驱动分发、后台输入与故障恢复；Linux 单列 X11 与原生 Wayland，两个平台的先后顺序与交付时间未定 |
| 四 | 完整流程与恢复 | 登录、上传下载、弹窗、重启和异常恢复 |

首阶段应在干净安装环境检查无额外开发依赖、重启后登录态保留、导航后拒绝旧引用、两个会话不串页，以及用户停止后不再执行后续动作。驱动完整性与权限不足路径、前台输入竞争及动作结果未知时的恢复，应随对应后端加入实物验证。单元测试和源码接线不能替代安装包及真实应用验证。

## Open questions

1. 优先候选 Chrome DevTools MCP 对现有 Electron 页面、跨域 iframe、Shadow DOM、canvas 和 DevTools 共存的覆盖是否满足需求；与 Playwright MCP 相比有哪些具体差异？
2. Cua Driver 的 macOS、Linux、Windows 实际兼容性、性能、许可、包体及运行时分发是否满足统一交付；尤其原生 Wayland 的桌面环境与架构支持矩阵如何界定和补齐？
3. 会话对标签页和应用窗口的授权粒度、控制租约、撤销与记录范围如何与现有审批体系组合？
4. 外部终端 Agent 的 CLI 路径、会话凭据和 MCP 接入如何做到自动发现、隔离、过期与清理；不同 Agent 的图片结果如何消费？
5. 自动下载与随包分发如何取舍，是否要求首次离线可用；远程终端调用时页面、应用和网络分别属于哪台机器？
6. 源码只读调研之后，应固定哪些上游修订，并用哪些真实网站、三平台应用、桌面环境和模型建立兼容矩阵？
