---
{
  "schema": "harness-note/2",
  "id": "d7b38ec9-0d23-4691-9cca-abd965854143",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-05",
  "updated": "2026-11-06T01:53:58Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/ff1fd0c5-c997-4c70-8824-ba13a76d0087"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/48db2e15-9318-5068-b300-b1913abf5463"}
  ],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/browser/devtools-runtime.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/browser/control-broker.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/browser/chat-tools.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/browser/terminal-host.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/browser/terminal-clients.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/ControlSettingsPanel.tsx","role":"implementation"}
  ]
}
---

# Chrome DevTools MCP 内置浏览器控制

## Problem

用户选定 Chrome DevTools MCP，并要求内置浏览器适配、实测及独立配置入口。此前上游直连 Electron 的测试证明页面操作可复用，但 `Target.createTarget` 不受支持，MCP 选页也不激活 JanusX 的原生标签。因此宿主需要管理标签和授权，页面操作继续交给社区实现。历史比较及原始结果见[浏览器与桌面应用控制](./browser-computer-use.md)。

## Decision

生产依赖固定 `chrome-devtools-mcp@1.12.0`，在 Electron 主进程中创建上游 MCP server，以 SDK InMemoryTransport 连接客户端。无需另装 Node 或独立 Chrome。上游内部 `McpServer`、配置与 Puppeteer 导出集中封装在 `devtools-runtime.ts`；加载时校验版本，升级必须重新验证。

普通启动在 loopback 地址启用 Chromium 随机调试端口，显式端口参数保留。随机端口从 `app.getPath('sessionData')/DevToolsActivePort` 读取；JanusX 的 Chromium 会话目录与 userData 根目录不同。检测入口同时检查实际 CDP 端点与 MCP 工具清单。

宿主服务通过 `BrowserSurfaceManager` 新建、显示、切换和关闭普通浏览器标签，复用零标签的既有面板；内嵌面板通过事件在全局工具区展开，独立窗口直接显示和聚焦。CPA 等带私有 partition 或受限选项的服务页面不进入工具清单，主应用壳也不是控制目标。页面必须是 HTTP(S) 或空白页；新建和显式 URL 导航只接受无凭据的 HTTP(S)。

对每个目标原生 WebContents 建立限定连接，用 `webContents.fromDevToolsTargetId` 精确匹配 target，切换目标时重建上游上下文。目标定位不依赖 URL；两个相同 URL 的标签仍保持独立。会话只看见未归属标签和自己的标签，已有用户标签需先 `select_page` 才能读取。页面 ID 由宿主返回并转换成该 MCP 连接的 ID，快照与元素动作仍使用上游实现；导航后的旧引用按上游错误返回。

普通 Janus 聊天在模型支持工具、非压缩轮次且设置开启时，通过 `ChatTurnPorts.localTools` 提供 `browser_` 前缀的工具。工具清单采用上游 schema，宿主仅替换标签管理参数并移除可任意指定的输出路径。快照、输入、点击、拖拽、对话框、等待、截图、console/network 检查等复用上游；不提供任意 JavaScript 执行或性能采集。外部终端通过下述受控桥接复用相同 Broker。

浏览器动作全局排队，会话归属和轮次租约由 broker 管理。读取不单独询问，变更动作遵循关联 workspace 中最严格的 Agent 权限模式，无关联时采用全局模式：plan 拒绝动作，per-action 复用现有提问审批，无审批 UI 或拒绝时不执行，auto-run 直接执行。审批不展示输入框值。取消、超时、设置关闭和手动停止会断开当前连接，停止后拒绝该轮次的后续与排队调用；重新开始的轮次才可恢复。轮次结束清除控制指示并释放闲置连接，标签与登录会话保留。

终端接入覆盖 Claude Code、Codex、OpenCode、Janus CLI、Pi 与 DSH 的用户级配置。Pi 使用原生扩展，其余使用独立 stdio MCP 入口 browser-mcp.js；入口由应用自带 Electron 的 Node 模式执行，无需用户安装 Node。Pi 扩展构建为无第三方运行时依赖的独立文件，复制到 userData 后加入 Pi 的 extensions，使用 janusx_browser_ 工具名。

终端桥接仅监听 127.0.0.1 随机端口，连接凭据写入 userData/janusx/browser-control/connection.json；每次应用启动更新。请求校验凭据并拒绝网页 Origin，限制请求大小、连接数和本机目录。stdio 入口从启动 cwd 绑定上传工作区，每个连接拥有独立身份和 Broker 租约，心跳过期、移除配置或连接退出释放标签归属。JanusX 必须保持打开；停止控制会撤销当前连接的后续调用，恢复需要用户重新连接 MCP。外部终端动作按 JanusX 全局审批模式执行：plan 拒绝动作，per-action 使用原生确认框，auto-run 直接执行；不声称同步外部 CLI 的内部轮次和权限模式。终端取消通过请求中止传递，超时后结果仍需重新检查。

浏览器设置列出六种终端的真实配置路径和已配置／未接入／冲突／不可读取状态，提供接入、更新、检测和带确认的移除；变更立即生效，与页面底部的运行设置保存独立。MCP 名称固定为 janusx-browser，遇到非本应用持有的同名配置拒绝覆盖。Claude、Codex、OpenCode、Janus CLI 复用“技能与 MCP”的同一服务和写队列；在那里修改或移除浏览器项也会断开对应连接。Pi 仅增删自身扩展路径，DSH 仅维护独立标记块，保留其它扩展、MCP、Skill 和原生配置；已有配置移除前保留备份，内容版本变化拒绝写入。Pi、DSH 的浏览器接入由本页管理，没有扩展通用 Skill/MCP 页的客户端范围。连接检测只验证服务握手和工具清单，不等于某个已经运行的终端会话加载成功。

设置沿用公共 SettingsSurface、SettingsRow、Input、Button 和品牌图标。检测与还原使用有边框的次级按钮，停止和移除使用危险操作按钮，默认状态即可辨认；小宽度时终端操作换行。其它设置页的全局控件样式与插件 UI 包未改动。

截图强制写入 userData 下 `janusx/browser-control/artifacts`，工具返回文本和文件路径。共享聊天工具目前返回字符串，尚未新增模型图像消息接线。上传必须存在已关联工作区，并经过共享 `resolveWorkspaceTarget` 校验为其内部普通文件；不依赖上游对系统临时目录的默认信任。

设置中心新增“自动化控制”分组和两个独立栏目，复用现有设置组件、主题与双语机制。浏览器栏管理开关、3–60 秒超时、检测与立即停止；电脑栏保存候选 Cua Driver 的 executable 路径，显式检测仅执行 `--version`，有超时和输出上限。电脑控制未接入，没有桌面操作工具，也不宣称已经支持三个平台。两栏按局部补丁进入既有配置写队列，互不覆盖，持久化于 config.json 的 `controlSettings`。

## Alternatives considered

- 直接使用上游 stdio 服务：页面能力相同，但无法自行创建 Electron 原生标签，也不能管理 JanusX 会话归属；内嵌上游服务允许限定连接，同时减少外部运行时需求。
- Playwright MCP：已有代表操作通过记录，保留为备选；用户已选择 Chrome DevTools MCP，后者显式 pageId 更贴合当前宿主控制。两者比较不能解释为 Playwright 不兼容。
- 自建 CDP 快照、元素动作或平台驱动：会重复维护社区能力，当前缺口只需要宿主适配，因此不采用。
- 直接让工具连接整个浏览器：接线较少，但可能暴露应用壳、服务页和其他会话目标，无法满足归属边界。

## Consequences

上游内部导出没有稳定 SDK 承诺，固定版本是当前维护成本；未来升级需重跑目标限定和真实 Electron 测试。loopback CDP socket 是应用进程的调试入口，关闭产品工具不会在运行中关闭 Chromium socket；broker 的限制是产品工具边界，不是抵御同机程序连接 CDP 的安全隔离。普通浏览器保留现有 partition，产品用户与 Agent 共享相同页面实例和登录态。

本次验证覆盖 Windows 开发构建和真实 Electron 原生网页。安装器产物、macOS/Linux、真实站点与 SSO、个人 Chrome/Edge profile 复用、重启登录连续性、跨站 OOPIF 和真实模型自主成功率尚未验证。电脑驱动只实测缺失提示，未安装或验证 Cua Driver。终端桥接与设置管理已有接线；各 CLI 的真实模型调用、全部原生版本兼容矩阵、安装包分发、视觉结果消费及三平台电脑控制仍需验证。

## Verification

2026-11-06 终端接入增量验证：`npx vitest run` 的 `browser-terminal-clients`、`browser-terminal-host`、`browser-control`、`browser-chat-tools`、`local-integrations`、`control-settings`、`local-integrations-ipc`、`local-integrations-probe`、`feishu-settings-ipc`、`knowledge-ipc-contract` 共 62 项通过。覆盖六种终端的配置增删和其它配置保留、共享管理入口可见性、同名冲突、过期版本拒绝、HTTP 鉴权、审批拒绝和连接释放；测试只写隔离临时目录。

`npx playwright test --config playwright.desktop.config.ts tests/e2e/browser-control-desktop.spec.ts --workers=1` 两项通过。新增用例通过设置 UI 为六种终端写入接入配置并逐项检测，五种 stdio 配置均握手并发现 21 个工具，Pi 通过同一宿主连接检测发现 21 个工具；随后独立 MCP 进程创建真实内嵌 HTTP 页面、读取其快照，并验证设置移除后已有连接被撤销。另一项为原有聊天控制综合回归。没有启动六种原生 CLI 分别请求模型；不把这些证据记为所有客户端版本的实际调用验收。首轮发现分包目录下错误解析 MCP 入口，已改为从应用主入口目录定位后重测；测试夹具也改用正常 HTTP 页面并重载宿主后操作设置，最终两项通过。

本轮 `npm run typecheck:strict-unused`、修改范围 ESLint、`npm run i18n:check`、`npx electron-vite build --outDir artifacts/build-check`、`npm run check:package-boundary`、`npm run exclusions:check` 与 `npm run check:notes` 通过。截图位于 `test-results/browser-control-desktop-*`，终端列表深色页面已人工检查；原有用例同时保留中英文、深浅主题截图。Notes 检查仍有 17 条既有外部链接诊断，未解析这些跨仓引用。未打包安装器，未在 macOS/Linux 实测。

单元检查分两组运行，共 78 项通过：`npx vitest run` 的 `tests/unit/` 下 `browser-control.test.ts`、`browser-chat-tools.test.ts`、`control-settings.test.ts`、`browser-surface-manager.test.ts`、`browser-ipc-contract.test.ts` 共 53 项；`llm/janus-agent-ports.test.ts` 与 `browser-occlusion.test.ts` 共 25 项。覆盖宿主标签生命周期、同 URL 与会话隔离、服务页排除、工作区上传、审批、取消/停止、配置并发写入及 IPC 事件。

`npx playwright test --config playwright.desktop.config.ts tests/e2e/browser-control-desktop.spec.ts --workers=1` 最终通过 1 项真实桌面综合用例；它通过生产聊天适配器调用真实上游 MCP，没有产品测试后门。直接调用工具而非请求远程模型，验证原生标签显示、点击、填写、上传、截图、旧引用失败、停止与新轮次、禁用，以及两栏的持久化和中英文深浅主题。增加填写场景时，测试曾误取同名 StaticText 的 uid，已改为按角色取 textbox/button，并重跑通过。

同一构建的 `desktop-smoke.spec.ts` 中 `Browser start page` 和 `Browser load failure` 两项回归通过，覆盖独立窗口、失败重试、弹窗遮挡和释放原生视图。截图已人工检查，保存在 `artifacts/browser-control-validation`。`npm run typecheck:strict-unused`、新增与修改源文件的 scoped ESLint、`npm run i18n:check`、`npx electron-vite build --outDir artifacts/build-check`、`npm run check:package-boundary` 和 `npm run exclusions:check` 均通过；此前已运行完整 `npm run build:check`。`npm run check:notes` 通过，327 篇 harness Notes、0 错误，另列出既有的 17 条跨仓库链接诊断，未在本次改动中解析这些外部引用。本次未打包安装器。
