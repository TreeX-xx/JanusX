---
{
  "schema": "harness-note/2",
  "id": "144067d8-ab32-445a-bef0-d5e0c2075cc3",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-10-22",
  "updated": "2026-10-22T16:29:52Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/43efa5a7-e16c-4cc7-846b-f271f8366260" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/96a2f5cd-166e-4982-a444-7640858f0a5f" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/80e8b427-d263-42f4-b7cd-8313548c9e2a" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/607e1d4b-8bf4-43c7-af1f-97da9ae9e30b" }
  ]
}
---

# 首版本地插件契约

## 状态与适用范围

本文维护首版协议基线及实现边界。`packages/plugin-sdk/` 提供类型、严格清单／调用策略校验、MessagePort 客户端和独立脚手架；命令与入口通过可信适配接入现有视图宿主。P2 已实现目录登记、授权、隔离资源、通信桥、私有 KV 与管理调试界面，实际验收及未覆盖项归阶段计划。schema／API 的 `1` 是插件协议版本，不是 JanusX 版本。后续如修改本基线，先记录兼容影响并同步样例和需求。

目标架构归[插件平台设计](plugin-platform-design.md)，验收归[架构需求](requirements/plugin-architecture-forms.md)和[导入需求](requirements/plugin-import-debug.md)，顺序及实施证据归[阶段计划](../planning/plugin-platform-roadmap.md)。全部未来能力不塞进首版 schema；示例只验证契约关系，不指定要交付哪项示范产品。

首版支持中部／右侧隔离页面、声明式打开视图命令、工具箱／中部添加菜单／应用内快捷键、项目上下文、指定文件只读、插件 KV、提示和私有存储变更订阅。视图只支持每作用域单实例，多个 view 可组成双区域功能。工作台、Island、文件写入、目录遍历、任意后台 JS、网络、模型、任意宿主命令、跨插件服务、全局快捷键和多实例暂不支持，传入这些贡献或权限明确拒绝。多实例在 P4 引入前需要修订 pane 与存储契约，不能仅扩大类型枚举。

## 现有消费者与兼容改造

下表保留 P0 的消费者基线；P1 与 P2 的实际实现边界见末节和阶段计划，表内未来语义不替代执行证据。

| 消费者 | 当前事实 | P1／P2 改造与保留 |
|---|---|---|
| [定义](../../../src/renderer/src/extensions/types.ts)、[注册表](../../../src/renderer/src/extensions/registry.ts) | 组件、图标组件和同步 activate；注册即 enable，disable／unregister 发布视图变更 | 可信 API 保留；新增可序列化清单和主进程安装记录；先授权再由可信适配器注册壳组件，不能把异步激活放入同步函数 |
| [启动](../../../src/renderer/src/main.tsx)、[内置定义](../../../src/renderer/src/extensions/builtins.tsx)、[右侧注册表](../../../src/renderer/src/right-tools/registry.ts)、[CPA](../../../src/renderer/src/extensions/cpa.tsx) | CPA 在 renderer 入口注册，内置面板通过右侧元数据模块先注册，包含懒加载和兼容 ID | 保持初始化先后与按需组件加载，不能引入 registry→store→组件循环；保留 `janusx.*`、旧 files／git／sessions ID 和 CPA 停用清理 |
| [视图宿主](../../../src/renderer/src/extensions/ExtensionViewHost.tsx)、[右侧宿主](../../../src/renderer/src/components/right-tools/RightToolHost.tsx)、[终端区](../../../src/renderer/src/components/TerminalArea.tsx) | 可信组件按 active 和 scope 渲染，项目级重挂载，使用现有局部错误边界 | 隔离壳接收实例与上下文，只使用插件桥；普通组件错误与隔离页面超时分别处理，关闭页面不结束宿主 PTY |
| [工具箱](../../../src/renderer/src/components/TitlebarToolGroup.tsx)、[打开路由](../../../src/renderer/src/extensions/workbench.ts) | 工具箱筛选 `launcher: tool-menu`，打开路由直接写两个 store | P1 增加命令与入口 registry；旧 launcher 转为内部命令适配，最终仍走现有打开与 reveal 语义，不出现重复入口 |
| [pane 模型](../../../src/renderer/src/lib/workspace-pane.ts)、[工作区](../../../src/renderer/src/stores/workspace.ts)、[全局工具](../../../src/renderer/src/stores/global-tools.ts) | pane ID 含 view／project，两个 store 订阅 registry，停用时清理活动树与历史项目快照；布局目前为内存状态 | 保留旧 ID，外部实例另加不透明 root／代次映射；P2 只持久化插件设置和私有数据，不把全工作区布局磁盘化捆入首版 |
| [右侧状态](../../../src/renderer/src/stores/right-tools.ts) | 持久化宽度等偏好，启动强制 rail-only，不恢复打开集合 | 保留此策略；插件启用恢复与面板自动打开分开，不因恢复启用而展开右栏 |
| [工作台切换](../../../src/renderer/src/components/WorkbenchSwitcher.tsx)、[应用状态](../../../src/renderer/src/stores/app.ts)、[Island 类型](../../../src/renderer/src/components/janus/janusIslandTypes.ts) | 蓝图／知识库、monitor／chat／roundtable 为固定分支 | P0 记录 P3 替换点，P1／P2 不更改这些分支或自称支持新贡献 |
| [主进程 IPC](../../../src/main/ipc/register.ts)、[preload](../../../src/preload/index.ts)、[文件 handler](../../../src/main/ipc/file-handlers.ts) | 分领域注册，preload 暴露广泛 `window.electron`，文件接口供可信 renderer 使用 | 新建受限插件 broker，禁止通用 IPC 透传及借用可信 renderer 的调用权限；复用底层服务时仍先作插件级校验 |
| [主窗口](../../../src/main/windows/main-window.ts)、[CSP](../../../src/main/bootstrap/session.ts)、[浏览器 guest](../../../src/main/browser/surface-manager.ts) | 主窗口 preload 且 sandbox=false，生产主文档 CSP 限制 frame；浏览器 guest 有独立分区、无 preload 且可联网 | 不把主窗口或浏览器 guest 当作已满足插件隔离；P2 验证专用资源协议／frame／网络限制，保留 Office iframe、CPA 和普通浏览器 |
| [配置服务](../../../src/main/config/service.ts)、[worktree 状态](../../../src/renderer/src/stores/worktree.ts) | 配置位于 userData／janusx，使用串行原子写；活动 worktree 路径是 renderer 状态 | 插件登记／KV 由主进程独立拥有并复用原子写工具；文件根由主进程验证，不能信任页面或 renderer 自报任意路径 |

P1 已新增 `packages/plugin-sdk/`（公开类型、清单／调用校验、模板和工具）、`extensions/commands.ts` 及 `extensions/manifest.ts`。后者只把清单适配为可信组件描述，不安装或执行包资源；P2 先授权再提供隔离壳。`src/main/plugins/`、`src/shared/ipc/plugins.ts` 及 renderer 隔离壳负责登记、资源、桥和布局。管理 preload 接口只给已验证主窗口顶层 frame；插件页面仅接收专用 MessagePort，不能取得 IPC、完整宿主 API 或 `window.electron`。

## 清单字段与合法样例

插件包仅包含 `manifest.json` 和构建后静态资源，不执行 npm、TS 编译、安装脚本或插件 main。首版清单使用严格对象：未知字段、未知权限／贡献、重复 ID 或悬空引用均拒绝，不静默忽略拼写错误。版本字段使用 SemVer；`schemaVersion` 必须为 1，`engines.pluginApi` 按宿主公开 API 版本检查，使用现成 SemVer 实现，不手写版本比较。插件包版本与 API 版本分别处理。

```json
{
  "schemaVersion": 1,
  "id": "example.project-reference",
  "name": "Project reference",
  "version": "0.1.0",
  "engines": { "pluginApi": "^1.0.0" },
  "capabilities": { "required": ["views.workspace", "views.right", "commands.openView", "storage.watch"], "optional": [] },
  "permissions": [
    { "name": "workspace.context.read" },
    { "name": "workspace.files.read", "paths": ["README.md", "package.json"] },
    { "name": "plugin.storage" },
    { "name": "ui.views.open" },
    { "name": "ui.toast" }
  ],
  "contributes": {
    "views": [
      { "id": "details", "title": "Reference", "entry": "dist/index.html", "location": "workspace", "scope": "project", "instancePolicy": "single", "icon": "book", "order": 100 },
      { "id": "summary", "title": "Summary", "entry": "dist/summary.html", "location": "right", "scope": "project", "instancePolicy": "single", "icon": "list", "order": 100 }
    ],
    "commands": [
      { "id": "open-details", "title": "Open project reference", "action": { "type": "openView", "view": "details" } },
      { "id": "open-summary", "title": "Open reference summary", "action": { "type": "openView", "view": "summary" } }
    ],
    "menus": [
      { "location": "toolbox", "command": "open-details", "when": "projectOpen", "order": 100 },
      { "location": "workspace-add", "command": "open-details", "when": "projectOpen", "order": 100 }
    ],
    "keybindings": [
      { "command": "open-details", "key": "Ctrl+Alt+Shift+R", "mac": "Meta+Alt+Shift+R", "when": "projectOpen" }
    ]
  }
}
```

`id` 为 3–128 字符，局部贡献 ID 为 1–64 字符，均匹配 `^[a-z][a-z0-9.-]*$`，禁止末尾点及连续点；第三方不能使用 `janusx.` 前缀。`name`／`title` 为 1–80 非空字符；`description` 为可选、最多 1000 字符。贡献列表可省略为空，但首版至少一个视图，最多 16 个视图、64 条命令、128 个菜单入口、32 条快捷键。局部 ID 在各自贡献类别内唯一；命令引用本插件视图，菜单和快捷键引用本插件命令。不得覆盖内置 ID。`icon` 可省略，首版只支持 `puzzle|book|list|chart|file|code|clock`，缺省为 puzzle；`order` 可省略为 100，取 -1000–1000 整数。排序按用户设置、order、完整贡献 ID，保证稳定。

`location` 仅 `workspace|right`，`scope` 仅 `application|project`，`instancePolicy` 首版仅 `single`。菜单 `location` 仅 `toolbox|workspace-add`。右侧视图自动取得 rail 入口，不需要在菜单中再声明。`when` 可省略为 `always`，仅 `always|projectOpen` 两个数据枚举，不允许 JS 或自定义表达式。项目视图即使声明 always，缺少项目时仍不可执行；工具箱可以显示为禁用项，workspace-add 无项目时不显示。隐藏某一入口不禁用命令或其它入口。

快捷键为应用内单段组合，不使用 Electron globalShortcut；至少一个 Ctrl／Meta／Alt 修饰键，不使用裸键、Escape、Tab 或宿主保留组合。宿主保留组合优先，用户重绑定其次，插件默认组合最后；同级冲突使这些默认组合都不生效并在管理页报告 `KEYBINDING_CONFLICT`，菜单仍可用。输入框、Monaco、终端及隔离插件页面获得焦点时默认不抢键。首版仅保证宿主非编辑区域焦点下触发，跨隔离页面快捷键转发后置，不监听插件键盘内容。插件不能通过配置覆盖终端快捷键。

`capabilities.required`／`optional` 为无重复短字符串列表。必需能力不支持则 `INCOMPATIBLE_API`；不认识的可选能力可以报告 unsupported，但它不使未知贡献／方法合法。使用某能力的贡献仍需宿主认识。首版宿主公开能力集为 `views.workspace`、`views.right`、`commands.openView`、`menus.toolbox`、`menus.workspace-add`、`keybindings.local`、`context.project`、`files.readText`、`storage.kv`、`storage.watch`、`ui.toast`。permissions 首版全部为必需，拒绝任一权限就不激活；可选权限留给后续版本。

## 身份与上下文

| 身份 | 格式及来源 | 生命周期 |
|---|---|---|
| pluginId | 清单 ID，经主进程校验 | 安装和数据所有者，不由页面请求选择 |
| viewId／commandId | `extension:<pluginId>/<localId>`／`command:<pluginId>/<localId>` | 稳定贡献身份，兼容现有 view ID |
| projectId | 已登记 workspace 的 ID，作为不透明字符串 | 项目删除后失效，重建项目不自动继承旧授权 |
| rootId | 主进程按 projectId＋已验证真实根目录登记的 UUID | 主目录和每个 worktree 分开，路径不作为公开权限参数 |
| instanceId | 主进程创建的 UUID，逻辑键为 plugin＋view＋scope（应用或 projectId/rootId） | 同一作用域重复打开定位原实例；关页再开得到新 UUID |
| generation | 每次加载生成的不可预测运行代次 | reload、context 切换、disable、来源变化全部撤销旧代次 |
| contextRevision | 每次上下文生命周期变更增加的整数 | 请求捕获 revision，返回时再次检查 |

project 视图绑定创建时的 projectId/rootId，主进程验证根属于当前登记项目或已确认 worktree。切项目或切 worktree 时暂停旧上下文，关闭旧桥、取消未完成请求，切回才重新加载并取得新 generation；首次可以直接重挂载，不承诺保留页面局部状态。存储按 projectId/rootId 区分，避免 worktree 串数据。P2 不改变内置面板现有应用级外壳行为。

application 视图始终得到 `project: null`，不能通过文件读取方法窥探当前项目，也不能向 project 视图伪造 rootId。首版 application→project 打开返回 `CONTEXT_UNAVAILABLE`，由用户宿主命令选定项目后打开；project→application 可以打开，但目标仍没有项目能力。上下文只交付 ID、项目名、主题令牌、语言和 active；文件 API 不接收绝对路径、项目 ID 或 rootId，由绑定上下文决定根。插件安装登记不得只信任 renderer 中的 activePaths。

## SDK 方法与权限

插件通过公开 SDK 的 `await connectPlugin()` 获取受限消息客户端；SDK 不创建 `window.janusPlugin` 全局对象，也不注入完整 preload。这是对 P0 尚无消费者的全局注入草案的实现修订，模板已同步采用显式连接。公开异步方法返回 Promise，成功解包结果，失败抛含 `code` 的 PluginError；所有方法支持可选 `{signal: AbortSignal}`，取消不序列化 signal。下表参数是业务参数，不接受 pluginId、generation、磁盘根或任意 IPC channel。

| 方法 | 参数 → 结果 | 必需权限及行为 |
|---|---|---|
| `app.getInfo()` | `{}` → `{pluginApiVersion, capabilities, locale, theme:{id,tokens}}` | 基础握手信息，无项目或机密；tokens 为宿主公开令牌子集 |
| `workspace.getContext()` | `{}` → `{project:null|{projectId,rootId,name}, revision, active}` | `workspace.context.read`；权限拒绝不泄露项目名 |
| `workspace.readText()` | `{path}` → `{text, bytes}` | `workspace.files.read` 且 path 在声明与授权的精确路径交集；project 作用域，UTF-8 文本最多 1 MiB，二进制／无效编码拒绝，不悄然截断 |
| `views.open()` | `{view}` → `{instanceId}` | `ui.views.open`；仅本插件已声明 local view，不允许其它插件、任意 location 或 project 参数 |
| `ui.showToast()` | `{message,level?:info|warning|error}` → `{shown}` | `ui.toast`，消息最多 500 字，显示插件来源，不渲染 HTML；速率限制时明确报错 |
| `storage.get()` | `{key}` → `{found,value?,revision}` | `plugin.storage`，本插件和当前视图作用域的 KV |
| `storage.set()` | `{key,value,expectedRevision?}` → `{revision}` | `plugin.storage`，只存 JSON；缺少 expectedRevision 为串行最后写入，有值时作 CAS，冲突拒绝 |
| `storage.delete()` | `{key,expectedRevision?}` → `{revision}` | `plugin.storage`，删除不存在项幂等，保留单调修订避免 ABA |
| `storage.watch()` | `{keys}` → 初始快照和带 revision 的变更事件，返回 unsubscribe | `plugin.storage`；仅本插件同 scope，1–32 个显式 key，不是公共总线；SDK 注册监听后再返回原子快照／订阅序列，不丢初始化间隙事件 |
| `context.subscribe()` | 监听 active／locale／theme／上下文失效，返回 unsubscribe | 基础事件只含非项目元数据；项目字段需要 context.read；撤销先阻断旧操作，事件只是通知 |

清单里的 `openView` 命令由宿主处理，只定位声明的自有视图，不需要插件页面先运行，也不会调用任意用户 JS。命令以用户宿主入口触发时无需 ui.views.open 权限；页面主动打开视图仍需该权限。首版不实现任意 commands.execute 或 renderer callback。

权限枚举为 `workspace.context.read`、`workspace.files.read`、`plugin.storage`、`ui.views.open`、`ui.toast`。仅 files.read 带 `paths`：1–64 个精确、规范化的相对文件路径，无 glob、目录前缀或符号链接授权；其它权限只允许 name。所有资源权限受用户选择项目范围和当前策略再次约束。宿主按安装记录绑定来源、权限指纹及批准项目；资源另绑定内容摘要和实例代次。开发资源内容变化允许重新校验后热重载，权限指纹变化先阻断并重新确认，不把内容重建误作新授权。

KV key 为 1–128 字符的普通字符串，拒绝空、NUL 及 `__proto__|prototype|constructor`；value 为 JSON 值，单值序列化 UTF-8 最多 64 KiB，每插件每 scope 最多 1 MiB、1024 key。存储失败不发送成功事件，revision 在主进程序列化写中产生，卸载默认保留。project 页不能选择 application 存储；同插件 application／不同 root 的数据不默认共享。多页的摘要／详情可通过同 scope 的 storage.watch 联动。

## 资源、路径和预算

| 项目 | 首版限制 |
|---|---|
| 清单 | UTF-8 JSON，无 BOM 依赖，最多 64 KiB；重复 JSON 键拒绝，不能依赖 JSON.parse 的覆盖行为 |
| 静态包 | 最多 2000 个文件、合计 50 MiB；单 HTML／JS／CSS 资源最多 5 MiB，图片最多 10 MiB；其它类型拒绝，超限不部分安装 |
| 静态类型 | `.html|.js|.mjs|.css|.json|.png|.jpg|.jpeg|.webp|.gif|.ico`；不允许 native／wasm／脚本安装器或 SVG 主动内容 |
| 页面 | 每插件每窗口最多 8 个同时挂载的隔离页面，按需创建；跨 root 的旧页暂停，不保证后台保活 |
| 请求 | 单实例最多 16 个在途、每秒 30 次、封包上限 2 MiB；读文件 10 秒，其它请求 5 秒，宿主上限不可由插件延长 |
| 事件与提示 | KV 事件最多每秒 30 条，允许按 key 合并，带最新 revision；toast 每插件每 10 秒 3 条，最大排队 3 条 |
| 挂载与故障 | 首次 ready 超时 10 秒；连续 3 次加载失败／握手超时／renderer 崩溃自动禁用；握手后仍有就绪页面且连续 30 秒无新故障才清零，关闭最后就绪页或撤销取消恢复计时；拒权／文件不存在不算崩溃 |

插件内部资源路径与 workspace.readText 路径均采用 `/` 分隔相对路径：拒绝空段、`.`、`..`、反斜线、绝对／UNC／盘符、NUL、控制字符、查询／片段及 Windows ADS `:`；拒绝 `%` 编码入口以避免双解码。主进程在读取／安装及每次实际打开前检查真实根、父链、最终文件，不跟随符号链接、junction 或其它 reparse 越界。大小使用有界读而非先 stat 后无限读。Windows 保留设备名和尾随点／空格拒绝；文件列表中大小写碰撞拒绝，避免跨平台不同包语义。

权限路径可位于明确批准的项目范围，但拒绝 `.git` 内部、`.env` 及 `.env.*`、SSH／凭证私有文件和宿主数据目录；若确有读取秘密文件的产品需求，另开敏感文件权限契约，不由普通只读开关放行。硬链接不得成为跟随链接绕过，文件在读前后变更时返回 `RESOURCE_CHANGED`，文件系统并发攻击的强隔离证据需 P2 平台验证，不能靠字符串前缀检查宣称完成。

安装主进程原子登记到 userData／janusx／plugins，独立保存 registry、grants、私有 KV 和来源记录；不让插件改写 config.json。复制包先在 staging 完成校验再提交，失败保留已有安装，重复 pluginId 返回错误而非覆盖。链接开发目录也先构建经校验的只读资源快照；内容变化撤销旧资源代次，重新校验并重载，不直接读取任意正在变动的开发树。

## 桥、资源协议与信任

本地开发模式默认关闭，用户明确选择目录后只安装登记；确认所有首版权限并启用才注册入口，页面按用户打开动作懒加载。开发来源含真实目录引用、链接／复制类型及资源摘要，复制不会升级成正式来源。开发开关与 enabled 意图可持久化，启动时重验来源及权限指纹；关闭开发模式立即撤销当前运行。重新打开模式不自动恢复之前被该动作关闭的启用意图。正常重启仅恢复已允许的入口，默认不重新打开页面。

资源 URL 为 `janusx-plugin://<mountToken>/g/<generation>/<relativePath>`。mountToken 为每实例随机资源能力，由主进程绑定不可由清单选择；仅提供本代次经验证的包静态资源，失效即拒绝。插件间不共用 URL 或目录映射，URL 不暴露项目路径。协议命名与旧草案 `plugin://` 对齐为此专用名称，不直接加载 file／http／https 页面。

P2 载体修订为每页面一个 sandboxed WebContentsView，每插件一个内存 Session，与主窗口、浏览器及 CPA 网络会话隔离。主进程为该 Session 配置 offline、无直连绕过且由宿主持有的拒绝代理、WebRTC `disable_non_proxied_udp`、拒绝全部权限／设备及下载；页面及资源附加不可放宽的 CSP `sandbox allow-scripts`，保持 opaque origin。禁止 connect、远程图片／样式／脚本、frame、worker、object、form 与 base 替换，只允许本 mount 的必要静态资源及受限 data 图片。内联样式可用，脚本不开放 unsafe-eval／inline，SDK 随包构建，无 CDN。

修订原因是 Electron 35／Windows 实测：旧主窗口 iframe 虽拦住 HTTP／图片／导航，WebRTC STUN 仍到达本地 UDP 监听器，3 个包的失败证据见 `artifacts/plugin-p2/network-probe.log`。因此不继续共用主窗口 Session，也不改变主窗口 Office CSP。原生页面的 module 加载仍使用专用协议 CORS 和 MIME；CORS 仅用于实例静态包，不用于项目文件或宿主数据。改动增加原生视图布局与遮挡成本，宿主通过 bounds 控制，菜单／对话框／拖拽／工作台遮挡时 detach。平台升级必须重测 HTTP、WebSocket、STUN／TURN、导航和死循环回收；本轮证据及未覆盖面归阶段计划，不把单个网络样例当作所有通道的证明。

首次原生页面 load 后由主进程向已持有且 URL 匹配的 WebContents 转移专用 MessagePortMain；最小 sandbox preload 只把一次性的 port 转给页面，不暴露 IPC 或宿主对象。SDK 检查消息来自当前自身窗口并完成握手；opaque origin 下不单凭 `event.origin === "null"` 判定身份。页面请求及订阅直接经过该 port 到主进程，可信 renderer 只发管理及布局请求，不转发插件数据。绑定映射 plugin／instance／generation／root／grants；其它窗口及 frame 的管理 IPC 拒绝，消息内自报 pluginId 或 rootId 不参与授权。

链接来源登记时保存 canonical root，恢复、启用和重载在读取清单前再次比较，根被 junction／symlink 指向其它目录时拒绝；首次用户选择目录仍允许解析为其真实根。文件内读另检查链接、句柄身份及前后变化。这些检查不构成所有并发操作系统置换的穷尽证明。

Windows 验收补充真实 worktree 页面撤销及根身份／KV 隔离、经桥读取 junction／hardlink 的拒绝，以及原生文件系统在路径验证后、open 前置换父目录的确定性检查点测试。另以真实打开的文件句柄延迟读取，验证旧读取在新根实例建立后完成仍返回 `INSTANCE_CLOSED`。这些证据分别覆盖桌面桥和文件系统检查点，不表示对所有 OS 并发时序或跨平台已经完成验证。

页面再次 load、进程故障、项目切换、重载或停用时先注销绑定并关闭 port，随后才销毁／重挂载原生页。所有请求在接收和回包前均检查有效绑定与 revision，KV 在 staging 写入后、提交 rename 前最后检查。已开始原子提交的 KV 写不回滚，尚未提交写取消；迟到成功事件不能派到新 scope。

下列是形状样例，requestId 在同一 port 内唯一；SDK 将 AbortSignal 转为同一 port 的 cancel。宿主只取消该 port 所有的 ID，重复 ID 返回 `INVALID_REQUEST`，取消／超时后的响应丢弃。错误消息不含绝对路径、秘密或内部 stack，详细日志归宿主并脱敏。

```json
{
  "protocol": 1,
  "requestId": "read-1",
  "type": "request",
  "method": "workspace.readText",
  "params": { "path": "README.md" },
  "contextRevision": 3
}
```

```json
{
  "protocol": 1,
  "requestId": "read-1",
  "type": "response",
  "ok": false,
  "error": { "code": "STALE_CONTEXT", "message": "The project context has changed." }
}
```

成功 response 为 `{protocol,requestId,type:"response",ok:true,result}`；取消为 `{protocol,type:"cancel",requestId}`；事件为 `{protocol,type:"event",subscriptionId,event,contextRevision,payload}`。订阅建立用请求返回 subscriptionId／快照／游标，SDK 按游标去重与排序；退订由同 port 的 subscriptionId 完成，关 port 时宿主全部释放。context.subscribe 的基础主题／语言事件可在原实例持续，root 变更先发失效通知且旧 port 立即撤销，不等待插件确认。

所有桥方法未知字段拒绝。错误码分为安装校验、权限／范围、上下文、资源和运行五类；稳定 code 用于作者分支处理，message 由宿主本地化。

| 错误组 | 必须支持的 code |
|---|---|
| 包校验（导入 AC-2 的六种坏包） | `MANIFEST_INVALID`、`INCOMPATIBLE_API`、`UNSUPPORTED_PERMISSION`、`INVALID_PACKAGE_PATH`、`PACKAGE_LIMIT_EXCEEDED`、`ENTRY_NOT_FOUND` |
| 安装／来源 | `DUPLICATE_PLUGIN`、`DEVELOPMENT_MODE_REQUIRED`、`SOURCE_UNAVAILABLE`、`RESOURCE_CHANGED`、`PERMISSION_RECONFIRM_REQUIRED` |
| 运行授权 | `PERMISSION_DENIED`、`PATH_NOT_GRANTED`、`SENSITIVE_PATH_DENIED`、`INVALID_SENDER`、`UNKNOWN_METHOD`、`INVALID_REQUEST` |
| 上下文／资源 | `CONTEXT_UNAVAILABLE`、`STALE_CONTEXT`、`INSTANCE_CLOSED`、`PLUGIN_DISABLED`、`FILE_NOT_FOUND`、`NOT_TEXT`、`FILE_TOO_LARGE`、`STORAGE_CONFLICT`、`STORAGE_QUOTA_EXCEEDED`、`STORAGE_UNAVAILABLE` |
| 宿主与交互 | `RATE_LIMITED`、`TIMEOUT`、`CANCELLED`、`VIEW_LOAD_FAILED`、`KEYBINDING_CONFLICT`、`INTERNAL_ERROR` |

## 生命周期与时序

安装状态与运行状态分开：安装记录为 installed／invalid／uninstalled，启用意图为 enabled／disabled，当前运行状态为 blocked／ready／loading／active／error。已登记不意味着已授权，ready 表示入口可用但尚无页面。普通本地静态插件没有必需的外部“连接”状态，管理页显示不适用，不能伪造连接成功。

| 事件 | 状态与资源结果 |
|---|---|
| import | 校验快照后 installed＋disabled，完全不执行 JS；失败不产生半安装记录 |
| authorize／enable | 先验证来源、开发开关、兼容与 grants，成功 ready 并发布贡献；任一权限拒绝保持 disabled |
| open／close | ready→loading→active；单 view 失败提供重试，close 关该实例 port，最后页面关闭回 ready，入口仍在 |
| hide／project change | 同 context 的 hide 只发 active=false，宿主可回收；切根立即撤销旧通道，旧 pane 描述可保留待恢复 |
| disable／development off | 先撤销所有绑定，再取消／释放自有资源、注销贡献、清理活动及历史快照，写 enabled=false；宿主会话／宽度偏好／KV 保留 |
| reload | 验证新快照，撤销旧 generation 后换代；失败 error，不执行半校验内容；权限增加进入 blocked，不带旧授权继续运行 |
| repeated load failure | 连续 3 次失败设置 disabled，记录 reason；用户手动 retryEnable 可清计数重新验证，其它插件继续可用；JS OOM／死循环的可终止性必须另测，不以 React boundary 代替 |
| uninstall | 先 disable，再移除静态包与登记，保留命名空间 KV；删除数据需独立明确操作；重装重新授权，保留数据不继承来源信任 |

```mermaid
sequenceDiagram
    actor U as 用户
    participant H as 可信宿主界面
    participant M as 主进程插件服务
    participant P as 隔离页面
    U->>H: 开启开发模式并选择目录
    H->>M: 请求校验与登记
    M-->>H: 清单、来源、权限（未执行页面）
    U->>H: 确认权限并启用
    H->>M: 保存授权与启用意图
    M-->>H: 发布 ready 贡献
    U->>H: 从工具箱打开视图
    H->>M: 为绑定上下文分配实例和资源代次
    H->>P: 加载隔离资源，转移专用 port
    P->>M: 经宿主转发的 readText 请求
    M-->>P: 授权和上下文双重检查后的结果
```

```mermaid
sequenceDiagram
    participant P as 项目 A 页面
    participant H as 可信宿主
    participant M as 主进程插件服务
    P->>M: revision 3 读取文件
    H->>M: 切换项目／root
    M->>M: 撤销旧绑定，取消请求，增加 revision
    H->>H: 挂载项目 B 新实例
    M--xP: 丢弃旧成功结果，拒绝旧 port
    Note over H,M: 旧提交之前重新检查作用域；已提交写仍只属于 A
```

## 场景推演与 P1／P2 测试输入

此表是 P0 的规格推演，预期结果是未来实现的验收 oracle。除末节明确运行的现有测试外，不称这些场景已在运行时通过。

| 编号 | 输入／触发 | 预期及追踪 |
|---|---|---|
| C01 | 合法双区域样例，开发模式关闭 | 导入可校验登记，enable 拒绝 DEVELOPMENT_MODE_REQUIRED，无贡献或页面；架构 AC-2 |
| C02 | 用户开启开发模式，选择相同目录并确认全部权限 | ready，打开两个视图，引用完整 ID 稳定，关闭一个不关闭另一个；AC-8 |
| C03 | 两个视图相同 project/root，详情 set，摘要 watch | 已持久化后事件与 revision 一致，重载后 get 保留；AC-10 |
| C04 | A 中发起 read 后切 B／worktree | 旧绑定失效，旧成功不送 B；storage 始终按 A root；AC-10 |
| C05 | application view 调 read 或打开 project view | CONTEXT_UNAVAILABLE，不借用全局活动项目；AC-10 |
| C06 | 同 view 重复打开，再关闭重开 | 重复定位同实例，重开换 instance/generation，旧回包无效 |
| C07 | 隐藏 view，随后宿主回收或切回 | active=false；可重挂载恢复 KV，不承诺局部状态或计时器持续 |
| C08 | 停用、关开发模式、卸载 | 先拒绝请求再清视图／快照，PTY 和用户 KV 保留，重启不自动重启页面；AC-18 |
| C09 | 开发链接清单增加 paths／权限或资源被替换 | 新快照重新校验；权限扩大 blocked＋PERMISSION_RECONFIRM_REQUIRED，旧 token 无效 |
| C10 | 清单 JSON 重复键、额外未知字段或悬空命令 | MANIFEST_INVALID；P1 校验器必须覆盖，不是静默覆盖 |
| C11 | 引擎不匹配／声明未来工作台贡献 | INCOMPATIBLE_API／MANIFEST_INVALID；可选能力未知不激活未知贡献 |
| C12 | 请求 net.fetch 或权限列表含网络／写入 | UNKNOWN_METHOD／UNSUPPORTED_PERMISSION，无出站或部分激活 |
| C13 | 静态 entry 为 ../、盘符、%2e、符号链接或 junction | INVALID_PACKAGE_PATH，实际打开时也检查；导入 AC-6 |
| C14 | 清单超限、包超限、缺少页面 | PACKAGE_LIMIT_EXCEEDED／ENTRY_NOT_FOUND，旧安装保留 |
| C15 | read 未声明路径、秘密路径、根外或二进制 | PATH_NOT_GRANTED／SENSITIVE_PATH_DENIED／INVALID_PACKAGE_PATH／NOT_TEXT，无正文泄漏 |
| C16 | 伪造 pluginId、其它 frame 管理 IPC、旧端口 | INVALID_REQUEST／INVALID_SENDER 或关闭通道，无借权 |
| C17 | 页面 fetch、图片探测、自导航、popup、下载、worker | 原生网络／导航层实际拒绝，不能只观察 JS 报错；P2 Electron 必测 |
| C18 | 新加载协议的 module／CSS／字体外链及主界面 Office frame | 包内支持的 JS／CSS 可载入；字体及远程资源拒绝；既有 Office／CPA／浏览器回归通过 |
| C19 | 文件不存在、读取超限或超时、客户端取消 | 对应错误码；取消只作用于本 port，迟到结果丢弃，崩溃计数不增加 |
| C20 | 两页面同时 CAS 写、磁盘写失败／配额超限 | 一个 CAS 成功，一个 STORAGE_CONFLICT；失败无成功事件，KV 不损坏 |
| C21 | watch 注册和初始快照之间发生写入、重载后旧订阅收到事件 | 通过游标交付恰当顺序、去重；旧订阅已撤销，不收到新数据 |
| C22 | 插件快捷键与宿主／他插件冲突，焦点在终端或隔离页面 | 不抢输入；冲突有诊断，菜单仍能触发 |
| C23 | 连续 3 次 ready 超时，另一个插件正常 | 只自动禁用故障插件；手动重试重新验证，CPU 阻塞／进程故障能力另测 |
| C24 | 复制开发来源、重启、原目录消失、重复 ID | 不提升来源；复制快照无需原目录，链接来源失效 SOURCE_UNAVAILABLE；重复 ID 不覆盖 |

## P0 验证与交接

P0 产出为清单／API 规格、源码消费者表、上下文及生命周期规则、两份时序和 C01–C24 推演。P1 已将样例及相应负例转为 SDK 校验测试；P2 将身份／网络／生命周期场景转为真实 Electron 测试。C01–C24 不因规格或纯策略测试通过而成为运行时证据。

P1 按纯数据类型和严格清单校验 → 命令／入口 registry 与旧 launcher 适配 → 工具箱／应用内快捷键 → 仓库外可构建脚手架 → 校验门禁及兼容回归实施。P2 的专用协议、opaque origin 模块、CSP／导航和发送者绑定已作 Electron 载体试验，并据 STUN 失败修订为独立离线原生页面；实现验证及未覆盖项统一归阶段计划。

P0 静态盘点已覆盖本文列出的消费者，现有可信注册、内置 ID、右侧状态和 pane 逻辑以 `npx vitest run tests/unit/extensions.test.ts tests/unit/builtin-extensions.test.ts tests/unit/right-tool-state.test.ts tests/unit/workspace-pane.test.ts` 验证：4 份、92 项通过。该结果只是兼容基础的现状证据，不证明新桥、持久化或隔离已完成。Notes 与样例机械检查结果在实施计划的 P0 交付记录维护。

## P1 实现与限制

SDK 的 `parsePluginManifest` 使用严格 JSON、重复键检查、Zod 和 SemVer，拒绝未知字段、权限、贡献、非法路径、保留 ID、悬空引用及不兼容必需能力。`validatePluginCall` 校验已声明权限、精确文件路径、自有视图和参数；它是可复用的纯策略，未建立真实发送者、用户 grants、上下文或文件系统边界。`PLUGIN_CAPABILITIES` 同时供兼容校验与已实现的首版 broker 握手；新增 capability 必须先实现对应分派及验收。

可信 `ExtensionDefinition` 可分别声明 commands、menus 和 keybindings。旧 workspace launcher 自动适配为内部打开命令，已有 ID、视图生命周期及右侧入口不变；公开清单没有菜单时不生成隐含 launcher。工具箱与中部添加菜单消费命令入口，快捷键只在宿主非编辑焦点下触发；保留 Ctrl／Meta 常用单键及 Shift 变体、Alt+F4、F1／F5／F11／F12 组合。相同优先级冲突均不执行并返回 `KEYBINDING_CONFLICT` 诊断；用户重绑定优先于插件默认，宿主保留组合始终不可覆盖。

`extensionCommands.setMenuPreference` 和 `setKeybinding` 提供入口显隐／排序及快捷键覆盖，使用独立 localStorage 键持久化，容忍未知 ID 和损坏记录；写入失败不改变当前偏好。P2 管理页已提供这些操作及冲突诊断，隐藏设置与排序按字段合并，恢复默认快捷键清除覆盖。关闭视图不注销命令，停用／注销立即移除命令和入口。

第三方管理页区分登记／启用意图与实时运行：每次快照从当前实例计算页面数、桥已连接数及 SDK 已就绪数；bind、握手与关闭均发布变化。插件主动关闭 port 时将不可用页面记为一次加载故障并撤销；宿主正常关闭先移除 carrier，再关 port，不额外计故障。连接仅指本地专用桥，首版没有外部服务连接。内置工具及必要宿主功能不列入第三方停用列表，共享会话仍由宿主管理；停用插件或清理其 KV 不授予结束宿主会话的权限。

脚手架由已打包 SDK tarball 生成到新目录，不覆盖既有文件，也不要求公开 npm 版本已发布。仓库外项目仅引用公开包；构建生成两页及本地资源，未接桥时显示独立预览状态。`janusx-plugin check` 只检查 manifest 与 dist 静态交付树，不执行页面，不构成安装器或并发文件系统安全证明。实际命令、测试数量和证据归[阶段计划](../planning/plugin-platform-roadmap.md)。
