---
{
  "schema": "harness-note/2",
  "id": "19cd1394-b2cb-4819-8fde-5f12de16574c",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": ["product","surface"],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/93151b7b-6a33-5e5d-bf83-f2109fc85389"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b1978fa7-4732-553a-83c3-12aefd34c248"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/671574ba-c6e4-54ab-8fee-8d762e72f622"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/48db2e15-9318-5068-b300-b1913abf5463"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b32f92b5-0256-5402-8a15-d19e9fa4db73"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/5c873080-4f76-597f-9fbd-0bdcc59a02a3"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8688b5ab-1f7f-5ff9-ba1b-ef75b7fd5917"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/c0b4743b-71be-462a-97da-27e40bc5d67a"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/a162efb4-23a7-4468-95e6-7163fe7efdc0"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/7b4800da-0ea0-4f63-9f15-7ce60e721bd7"}
  ],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/right-tools/RightDock.tsx",
      "symbol": "RightDock",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/product-workspace/ProductWorkspacePanel.tsx",
      "symbol": "ProductWorkspacePanel",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/janus/JanusIsland.tsx",
      "symbol": "JanusIsland",
      "role": "implementation"
    }
  ],
  "updated": "2026-10-23T05:05:29Z",
  "moduleState": "partial"
}
---

# 工作台与产物界面

## Responsibility

组织 Island、右侧工具栏、产物预览与共享编辑器的交互和视觉。RightDock 负责工具承载与布局，ProductWorkspacePanel 负责生成文件的预览，JanusIsland 负责工作状态及通知入口。文件事实由既有读取服务提供，会话耐久、Agent 执行与工程 Note 事务分别由对应模块负责。

## Design

[应用启动与独立编辑窗口首屏主题](./standalone-editor-initial-theme.md)在创建窗口和挂载界面前读取当前主题，原生窗口底色与页面首漆一致，避免黑色主题启动应用或打开文件时先闪浅色。

[首次入门与再次学习](./first-run-learning.md)通过选择项目、启动终端、拖拽分屏和查看文件四步帮助用户开始使用。仅在首次无项目时自动介绍，学习中心由顶栏、空页面和设置常驻入口进入；按真实操作验证、单独记录跳过，退出或重启后可继续，重学保留历史完成记录。独立编辑器通过成功读取事件确认文件步骤，特色功能独立课程尚未实施。

[全局工具与跨工作区分屏](./global-tool-layout.md)采用独立项目区与全局工具区。浏览器、Markdown、CPA 跨项目保留实例和工具分屏，目标项目完整恢复内部布局；窄窗收起工具并保留展开入口。Markdown 显式选择文稿归属，顶栏已打开条目仍可定位工具。

[长时间使用性能分析](./long-session-performance.md)记录既有刷新与账本修复、现场进程采样和可重复性能检测。当前源码已加入 Codex event 历史分块投影、工具区订阅隔离、Monaco 按编辑意图加载，保持统计口径并通过功能回归。内存治理 2A 已实现 Chat 日志流式恢复，以及每 renderer 估算 16 MiB/128 项、单项 2 MiB 的编辑器磁盘快照 LRU，打开和未保存内容不随淘汰丢失；79 项相关回归和实际 Electron 编辑保存检查通过，隔离基准确认历史恢复峰值下降、文件批量开关后的保留堆趋稳。会话正文按需读取、工作区索引释放、多终端总预算、累计模式解析/数据库线程隔离与现场长会话卡顿仍待后续处理，合成基准不代表现场停顿已消除。

生成文件面板统一显示“预览”，本地 Markdown／文本及应用状态界面跟随主题，HTML／Office 文档保留自身配色。[预览实现与主题检查](./product-workspace.md)记录统一扫描入口、历史迁移预算和固定色例外；新增主题可集中定位遗留项，verify 拒绝新增扫描问题。

[统一文件窗口与内嵌／浮窗路由](./unified-file-window.md)为已确认、待实施方向：移除顶部 Island 的产出提醒与产物跳转，OfficeCLI 与普通文件预览／编辑共用文件窗口。终端右侧 Island 和文件树默认打开内嵌区，后续打开跟随当前工作区的内嵌／浮窗模式；切换迁移全部标签与草稿，内嵌隐藏窗口控件。当前产物列与独立编辑器仍按各自已实现记录运行。

[预览编辑窗口显示风格与外壳 UI 对齐方向](./preview-editor-display-style.md)记录 opencode 文件编辑显示调研：diff 与普通编辑显示同批向“行号色带 + 超淡行底色 + 不变区折叠”收敛（正常显示同批适配），与无色块设计语言同构。外壳 UI 对齐（滑动指示块 tab、文字 + 2px 强调条选中态、MonacoViewer 令牌化）与 A–D（正文薄纱/gutter 色带/词强调 1:4、行高 24/tab 2、不变区折叠、行号染色、同源 +N/−N 徽标）已落地，竖条与缩进参考线经视觉复核撤除/禁用、tab 关闭钮可见性与悬浮反馈补齐；文件树红绿 git 状态色保持独立。

文件差异默认随容器宽度在合并／并排之间选择，手动选择持久保存；合并视图只显示一列行号，删除行显示旧行号，当前行显示当前行号，工具栏提供前后变更导航。具体布局、原生删除行边栏适配及浏览器回归见[单列 diff 行号](../terminal/monaco-diff-single-line-number.md)。

右侧[工具区](./right-dock.md)由竖排图标统一控制，移除顶部工具 Tab、独立折叠按钮和未选中工具的小圆点。收起时悬停显示可操作的临时卡片，点击则转为常驻面板，再点当前图标收起。两种展示复用同一个工具实例：临时预览覆盖中部内容；点击后中部向左让位，卡片的圆角、间距、边框与阴影同步在 240ms 内退去，转为上下贴边的面板，避免遮挡终端右侧的 island；收起后布局只保留 48px 工具栏。

通用设置的[主题选择](./settings-layout.md)以预览小卡片替代下拉框。每张缩略界面读取对应主题令牌，点击即保存应用；原生单选支持键盘切换，选中状态以轻描边与勾标记表达。说明与卡片根据设置区域实际宽度重排，保存失败保留原主题并显示错误。

[设置布局](./settings-layout.md)以平铺分区、按需展开和一致的操作区组织配置。通用页管理偏好与开发环境，关于页集中版本、更新与 GitHub 求赞入口；通知关闭时收起关联字段，通知与 Agent 权限显示未保存状态；模型测试与保存位于底部。外部 CLI 参考 MCP 接入采用品牌、状态与操作组成的通栏列表，保留安装、检测及入口显隐语义。

分屏落点与 Tab 插入占位统一使用灰色半透明底色和弱灰描边；侧栏原生拖入与 Tab 指针拖动共用预览及圆角提示样式，避免拖动时出现大面积强调色。浮动 Tab 保留清晰的主题底色，排序和分屏在松手后提交。

无工作区时，左侧提示、标题和操作图标，以及中央开始页的图标、文字与选择文件夹按钮均读取主题令牌，不叠加整体透明度。空状态沿用工作台网格：主行可收缩，侧栏标题固定高度、列表独立滚动；中央内容按可用区域居中、换行，矮窗中在自身区域滚动，侧栏折叠后随中央列重新排布。选择文件夹按钮的背景、边框、悬浮与键盘焦点采用主题中的中性色，不使用红色强调。2026-10-15 使用真实 App 与浏览器 IPC fallback 检查纸面／深色主题的 1280×720、800×480、800×240 六种组合，覆盖按钮边界、焦点、侧栏不透明与折叠后的重新排布。

文件夹选择对话框绑定发起操作的窗口。Windows 原生对话框没有 Electron 位置参数，由 `src/main/windows/center-native-dialog.ts` 启动隐藏的临时 PowerShell 进程，仅识别该父窗口拥有的原生对话框，按当前父窗口中心定位一次，并限制在所在显示器的可用区域，不改变窗口尺寸或焦点。对话框结束即清理，查找最多 10 秒、进程最多 15 秒；启动失败仍保留系统原生选择行为。代价是每次打开目录选择器增加一个短期系统进程，首次定位可能在对话框显示后发生。其它平台保留系统定位。独立 Electron 验证先将真实目录对话框移到 (10,10)，再运行生产定位函数，确认它回到父窗口中心 (223,163)，取消后正常关闭；未验证多显示器实机组合。

左侧“工作区”标题行不保留下方横线，40px 高度与中央 Tab 栏对齐，通过标题和列表留白区分导航层级；侧栏与内容之间的竖向边界保留。[底部用量栏](./runtime-drawer-cards-resize.md)收起时无贯穿横线，整行为支持键盘的展开按钮，圆角反馈集中到“用量”入口。展开时保留弱分隔与高度调整，卡片以浅底色和当前终端标记分组，避免重复描边；摘要布局按中部实际宽度收拢。

侧栏项目与终端选中态使用中性底色，分支与终端采用单行名称，路径和启动类型移入悬浮提示；[终端分组与导航](../terminal/terminal-sidebar-states.md)拥有终端点击定位、跨项目恢复和 worktree 归属规则。项目[悬浮操作](../sessions/workspace-row-hover-reveal.md)预留固定按钮位，以淡入显示保持名称宽度和菜单锚点稳定。

右侧[工具区](./right-dock.md)使用中性选中态，工具入口位置固定；文件与会话搜索统一高度和间距。会话采用标题优先的轻量列表，短提示去重，展开后才抬升详情底色；Git 只显示非零变更统计，分组标题减少底色和小字。各工具宽度偏好与业务操作保留。展开和收起保留淡入淡出及滑动效果，退出时内容及当前卡片／面板外观保留至 320ms 动画结束，但立即禁用交互。常驻面板支持拖拽调整宽度，中部同步让位；减少动态效果偏好关闭动画。

最右侧竖排功能控件的中性选中底板以 160ms 滑向目标，用 100ms 窗口合并快速连点，只激活最后一个面板；等待期间保留当前内容。反向点击、收起卡片或目标失效取消待执行切换；直接再点当前竖排工具仍可折叠／展开。未变化的隐藏工具跳过父层切换引起的重复渲染。终端等 pane 标签也采用滑动底板，内容选择保持即时，拖动时隐藏底板。此调度不打断已经执行的同步渲染，也不缩短 IPC 耗时，取舍和验证归[工具区](./right-dock.md)与[工作区标签](./pane-tab-reorder.md)。

负责布局、预览、导航及可达交互，不承诺所有插件、主题或预览提案均已交付。下面保留历史阅读链，Note 工具的界面承载在本模块，文档身份和蓝图解析见 [Note 与蓝图](../blueprint/module.md)。

中央工作区以 pane 树统一承载终端、浏览器与 Markdown 内容；[工作区标签拖拽与布局](./pane-tab-reorder.md)负责排序、跨 pane 合并与分屏。工作区直角铺满，不保留外侧留缝、双层描边与阴影；圆角和轻底色集中到标签，分屏焦点由当前标签表达。每个 pane 的标签区独立横向滚动，右侧操作区固定，纯浏览器工作区也可分屏。分屏边界为 1px 细线、9px 拖动命中区，支持键盘调整和双击平分；底部监控条弱化分隔并移除身份、模型和其它终端摘要的胶囊边框。

已有终端标签切换复用 xterm 与历史缓冲，同尺寸只请求一次绘制；尺寸变化与工作区返回仍走稳定帧后的完整适配。标签、终端和变更浮岛跳过未变化的父层渲染，应用根布局只订阅 pane 是否存在，保留各实例自身的输出与状态订阅。20 终端基准的 12 次切换从 24 次适配／刷新降为零适配、12 次刷新；实测边界与回归归[工作区标签](./pane-tab-reorder.md)，不代表后台持续输出或真实桌面长任务已消除。

备忘录与圆桌羊皮纸、角色结果及问题池已共用 components/island/islandMotion.ts 的开合生命周期、可见内容编排、220ms 动效参数及最终几何展示，components/island/islandLayout.ts 按左右方向求解主附岛布局。memo 与 useAuxiliaryIslandLayout 分别适配宿主；业务状态和材质仍由原模块负责，关闭后恢复所占样式、inert 和焦点。旧独立展示清理定时及固定偏移已移除。羊皮纸快速关开、窄窗两岛边界和关闭恢复通过浏览器检查；其它两种附岛完整业务仍未单独端到端验收，取舍及证据见[里程碑设计评审](../knowledge/milestone-design-review.md)。

Chat 会话删除确认框虽通过 portal 挂到 body，仍属于 island 的交互范围。JanusChat 在确认框及遮罩外层标记 data-island-companion，并阻止指针和键盘事件继续向宿主传播；因此确认／取消不会被判为岛外点击，Esc 只关闭确认框。删除非当前会话保留当前回复；删除当前会话中止其回复并选择剩余会话，删完最后一条则创建空会话，均保持 island 展开。弹窗消失后正常的岛外点击收起仍有效。

2026-10-14 回归：修复前真实组件测试复现点击删除确认后 data-stage 变为 collapsed；修复后 `npx playwright test tests/e2e/chat-conversation-delete.spec.ts --project=island --workers=1 --output=artifacts/chat-delete/verified` 5 项通过，覆盖置顶／未置顶、取消／Esc／遮罩、Enter 删除末会话、删除进行中回复与保留另一会话回复。使用真实组件和会话控制器，持久化与流式 IPC 为测试替身；未另跑桌面删除持久化。`npm run typecheck` 与 `npm run build:app` 通过；JanusChat 范围 ESLint 为 0 错误、4 条既有中文字符串警告。

槽位演进链（非重复，保留先后）：[island-slots](./requirements/island-rightdock-slots.md)、[right-dock](./right-dock.md)、[empty-collapse](./right-rail-toggle-motion.md)、[toggle-motion](./right-rail-toggle-motion.md)、[drawer-resize](./runtime-drawer-cards-resize.md)、[run-orb](./run-orb-budding.md)、[hifi-alignment](./island-hifi-optimized-alignment.md)、[capsule](./island-hifi-optimized-alignment.md)；turn 双件[island](./turn-change-island.md)与[card](./turn-change-card-external-cli.md)同属本域。

下拉副黑板（演示切片已落地）：岛胶囊下拉 ≥60px 让中部工作区下滑让位，副黑板在中央列上带长出，下拉手势 toggle（再下拉自动回收，另有图标收起控件）；中断代价判据与投影/借调分类见[下拉副黑板决策](./island-blackboard.md)。整窗宽覆盖与蓝图翻牌（`blueprintMode`）已否决并退役，蓝图入口只留工作台切换器；板面复用蓝图界面（画布交互 + 左详情槽，无右侧对话），文件钉已移除，下缘拖高收板保留；借调钉与多槽未做。

产物语义：[workspace 重构](./product-workspace.md)、[notice-matrix](./product-workspace.md)、[peek-race](./product-workspace.md)、[preview-p0](./product-workspace.md)、[tour](./product-tour.md)、[landing](../desktop/landing-page.md)。

Note 工具链三件各司其职：[drawer-toolbar](./note-drawer-markdown-toolbar.md)、[mechanical-gates](../blueprint/documents/note-mechanical-checks.md)、[rename-draftcard](./notecard-rename-draft-card.md)；[Markdown 独立 pane 与顶栏工具分组](./markdown-pane-entry.md)记录移出底部的已确定方向，以及终端解耦、保存与迁移建议，尚未实现。工作便签归属：[own-namespace implemented](../blueprint/documents/history/own-notes-namespace.md)与[own-namespace proposed](../blueprint/documents/history/own-notes-namespace-proposal.md)为生命周期对，成对保留。

配套：[github-maintenance](../desktop/github-maintenance.md)、[markdown-assets](./markdown-preview-local-assets.md)、[experimental-preview](./experimental-preview-features.md)、[file-glyph](./note-drawer-markdown-toolbar.md)、[reveal-race](./file-tree-reveal-race.md)、[share-import](../blueprint/workspaces/share-import.md)、[plugin-forms](./requirements/plugin-architecture-forms.md)、[plugin-debug](./requirements/plugin-import-debug.md)、[entry-nav](./entry-switch-navigation.md)、[f12-nav](./f12-navigation.md)。

外部工作流工具探索：[Grok Bot 衔接](./grok-bot-workflow-integration.md)仍在讨论；[Docker 面板入口](./docker-management-entry.md)于 2026-10-14 放弃 Portainer 接入、改为自研首版七项基本能力（连接状态、容器列表与启停、实时日志、容器终端、访问服务、Compose 分组），承载为新的 pane 内容类型；配套的[HTTP 请求 pane](./http-request-pane.md)同批设计。两者均未实现。

服务集成：[CPA 账号管理复用与 Figma 接入](./service-integrations.md)维护中部与右侧扩展入口及服务边界。S1 提供可信注册与两处宿主，S2 将文件树、Git、会话管理迁移为内置扩展并保留原偏好及服务。S3 内嵌原版 CPA 管理页并跨项目复用；“设置 → 服务集成”现支持已有实例与本地托管，首次启用下载、自定义回环端口、启停／重启、自定义或随机管理密钥及加密保存、密钥复制、日志和自动更新，关闭页面保持服务，退出应用停止自有实例。托管 OAuth 为 Codex、Claude、Antigravity 增加回调端口预检，不可用时复用原页手动回调，提示随对应会话完成／失败／取消／超时清除，授权端点交给系统浏览器。CPA 的显式全局代理及环境统一指向随服务启停的本地认证转发入口，额度、订阅、重置操作、授权与组件下载共用 JanusX 出口及本地直连规则，上游代理认证不落盘；管理页和本地控制请求强制直连，不提供独立网络设置。真实 Windows 管理登录及 OAuth 回调兜底已验证，真实供应商额度和其他平台托管未验收。公开类型、内置定义及双区域示例位于 `src/renderer/src/extensions/`；第三方本地导入见插件平台条目；市场与 Figma 接入仍待实施。

插件交付按[分阶段计划](../planning/plugin-platform-roadmap.md)保留已交付的 S1–S3。P0 的[首版契约](./plugin-contract-v1.md)与 P1 SDK／严格校验、仓库外脚手架、命令／入口及旧 launcher 适配已落地；P2 已实现目录登记、授权、独立离线原生页面、只读桥、私有 KV、管理及调试。P3 增加工作台根页面、返回原界面、宿主绘制的 Island 状态／进度／徽标／动作／文本预览和隔离展开工具区，外部模板以同一 SDK 联动四区域。状态绑定发布页面，撤销清理；审批遮挡时外壳和原生页同时让位。P4 首片提供嵌入文件编辑器的只读 viewer、默认打开／恢复、失效回退和按文档绑定的隔离实例；未保存文件保留内置编辑；后续片已接通版本化草稿交接、宿主审阅保存、关闭保护及写前冲突检查。持续插件编辑、完整文档事务／合并和目录查询仍待续。新增 P4a 已交付声明式参数配置、应用默认与项目／worktree 覆盖、恢复默认、读取订阅及升级诊断；复杂设置页和凭证引用待续。阶段计划保留实际门禁证据和平台限制，未测平台不记为完成。后续再扩展后台／事件、Agent／提供者、窗口和分发；版本尚未指定。工作台需求维护验收，规划模块维护阶段及证据。

[插件平台与全产品扩展架构](./plugin-platform-design.md)维护用户已认可的目标方向：以命令、入口、视图、工作台和领域能力组合完整功能，覆盖中部、工具箱、右侧、Island 及独立界面，并明确实例、上下文、数据与任务归属。普通第三方使用隔离页面与宿主代理，可信内置视图保留现有运行方式；显式本地开发模式只允许授权的未签名隔离页面，正式分发另定来源规则。目标设计仍待分阶段实现，首版只读目录范围不隐含开放执行、网络、模型或完整宿主桥。

[PI-Desktop 插件调研与功能插件化探索](./ideas/plugin-platform-and-feature-modularization.md)保留固定源码基线、运行边界、开发闭环及功能适配矩阵，为架构提供研究依据。文件树、Git、会话及 CPA 已有内置视图注册，通用工作台／Island 按 P3 接入，其它功能迁移及提供者仍待实施；示例业务和全部官方功能拆包不作为首版前置。

[Janus 自有功能形象与宠物交互探索](./ideas/janus-functional-character.md)记录 DSH 社区鲸鱼的像素动画与状态适配参考，以及未来 Janus 原创角色表达任务、等待、成功／失败和轻量互动的可能方向。造型、位置、与现有眼睛的关系及桌宠模式均未确定，尚未实施或排期。

运行与测试目标探索：[按当前 worktree 运行与测试项目](./worktree-run-test-target.md)记录现有快捷启动使用工作区根目录的限制，以及目标跟随、进程归属和测试结果标识的建议，作为 0.9.2 候选，尚未实现。

渲染与编辑器：[emphasis](./markdown-emphasis-orange-text.md)（强调色去填充块）、[standalone-refresh](./standalone-editor-auto-refresh.md)（独立编辑器外部变更自刷新）。[文件编辑窗口与预览体验](./file-editor-experience.md)记录普通编辑默认、按需 HEAD 对比、自定义关闭确认、Markdown 单向同步滚动与安全 HTML 图片预览，以及 HTML 虚拟视口、缩放和工作区只读资源服务。

## Acceptance criteria

以下为 2026-09-26 整理的历史验收，原编号、条文与勾选状态保留给已有 Task。篇数与迁移样例记录不代表当前范围。

- [x] AC-1: 本域 31 篇直接子全部携带有效 parent。
- [ ] AC-2: own-namespace 生命周期对保留两篇，不判重复删除。
- [ ] AC-3: 历史迁移样例已清理（2026-09-27 随鹈鹕骑行 Note 一并移除），不再保留隔离样例。
