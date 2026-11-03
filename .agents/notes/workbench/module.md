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
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/41a64d3c-2811-4dc8-a1ab-2c5c541ec123"},
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
  "updated": "2026-11-03T17:48:02Z",
  "moduleState": "partial"
}
---

# 工作台与产物界面

## Responsibility

组织 Island、右侧工具栏、产物预览与共享编辑器的交互和视觉。RightDock 负责工具承载与布局，ProductWorkspacePanel 负责生成文件的预览，JanusIsland 负责工作状态及通知入口。文件事实由既有读取服务提供，会话耐久、Agent 执行与工程 Note 事务分别由对应模块负责。

## Design

[主题机制](./theme-system.md)集中维护经典黑、石板色与纯白的配色，应用、终端、Monaco 和三个官方插件共用生成来源。组件绘制颜色读取语义令牌；主题审计覆盖宿主与官方插件，固定色仅保留有明确用途的例外。新增主题不需要逐组件添加颜色分支。

工作区及任务盘切换时，文件、Git、会话的内容区统一通过[毛玻璃失焦与加载反馈](./file-tree-reveal-race.md)交接上下文：120ms 进入、按可见面板真实数据等待、220ms 恢复清晰。导航保持可操作，后台刷新不重播动效，失败显露当前错误并允许重试。

对话视觉使用开放正文与清楚的标题层级：空态标题、引擎身份和输入区左边缘对齐，用户气泡收紧间距，连续工具行以细线组织，状态颜色沿用主题语义。输入区独立底色、底部控制分隔及主题色焦点反馈；Markdown 对话变体由 pane 控制正文排版，其他文档渲染维持共享默认。实际组件的深浅主题、390px 窄窗与空态示例截图位于 `artifacts/conversation-design/`，不代表真实模型运行内容。Claude 的过程折叠外持续展示实际工具与目标，正文按原生步骤完成并与工具交错；取消边界及验证范围见[执行过程专题](./terminal-dialog-dual-mode.md#claude-执行过程摘要与阶段回复)。

OpenCode 2.1.4 对话输入框已接入原生会话模型和 variant 选择：按工作目录读取可用模型，保留 provider/model 身份，强度选项使用原生目录及默认值。空闲时修改当前会话并读回确认；终端后续发送沿用同一设置，终端设置变化由轮询同步到对话。模型选择不改全局配置、不产生提示词请求；Pi、DSH 的设置能力仍独立声明。原生 CLI 与界面测试边界见[双模式专题](./terminal-dialog-dual-mode.md)。

[终端与对话双显示模式](./terminal-dialog-dual-mode.md)记录 Codeg、ZCode 调研及各 CLI 的接入边界。新建本地 Codex、Claude、OpenCode、Pi、DSH 默认具备终端与对话两种形态，启动入口不再提供独立“对话模式”开关。设置 → 通用 → 会话启动习惯只选择新会话先显示终端或对话，默认终端，已有会话不受偏好修改影响。同一会话、同一 pane 可随时切换，任一时刻只显示一种，切换不重启。公共 AgentSessionPane/AgentComposer、显示契约及 controller 注册表按引擎选择 adapter；模型、停止及审批入口依据实际能力显示。远端、恢复和未接入引擎不据此宣称支持双形态。

Claude adapter 使用 daemon 原生 worker、真实 attach 与进程内 Mods，兼容性以实际协议握手判定。空启动无模型请求，对话发送有 commandId 去重和原生 turn 确认；有序事件缓冲短暂重连，未知送达或事件缺口停用对话控制。原生 Esc 后可继续显式发送；停止等待 Bash 后台化结果并调用 TaskStop，后台自然完成清除运行状态。Write/Edit/Bash 审批提供允许一次/拒绝，原生批准使旧审批过期；AskUserQuestion 支持对话内单选、多选和文字回答，回执精确关联当前原生问题。模型与强度选择读取原生能力目录，空闲时修改本会话后续主对话请求，终端输入沿用；原生设置命令可重新接管。原生默认模型标签保留，终端另显示会话覆盖值。插件/settings 为会话私有附加资产，不改用户全局设置，关闭只停止所属 job。首次登录/目录信任先在普通终端完成；旧会话、远端、子代理停止和持久恢复未接入。真实 CLI、共享 daemon 双 worker 隔离和 Electron 三轮切换均以 localhost 模型验证通过，范围与证据见专题。

五引擎共用独立问答卡片与请求生命周期，显示 y/n、原生单选／多选和 Type something 输入；回答消费当前请求，普通草稿与发送队列保留。版本和选项校验拒绝过期／重复回答，阻塞问题暂停聊天派发，确认未知时禁用重试。Codex 保留审批范围，OpenCode 使用权限／表单 API，Pi 和 DSH 使用各自扩展回调。任意自定义 TUI、原生已打开弹窗及未适配请求仍在终端处理，具体边界和五引擎真实验证见[问答专题](./terminal-dialog-dual-mode.md#对话内审批选项和文字回答)。

原生 Codex TUI 连接由主进程转发，对话呈现流式正文、工具摘要、文件 diff、审批和文件窗口入口，保留各自草稿与阅读状态。模式入口使用滑动指示块，切换等待显示轻量加载提示，目标内容短暂淡入；过渡后恢复焦点，失败可重试，并适配减少动态效果。正文采用折叠工具行、自适应圆角输入区与返回最新入口；工作区仅由既有外壳表达，输入区提供模型快捷入口、横向强度阶梯 effort 选择及紧凑斜杠指令预览，预览无外圈阴影。effort 中文显示低／中／高／极高／max／ultra，按实际支持能力提供，移除说明，左右预览时底板滑动、柱形亮起，确认后提交。设置使用真实模型能力与 thread 更新协议，下一轮生效，并与终端同步；未适配指令提示去终端，不作为普通消息发送。0.166.0 的本地模型集成验证了往返输入、设置的实际请求传值、Hook 归属与审批；浏览器与桌面验证边界见专题。普通 CLI 路径保留，已有终端不迁移；真实供应商、跨平台、历史分页、自动恢复和独立产物体系待续。

Codex 对话优先启动保持聊天布局，登录、目录信任以及新增／修改 Hook 的确认在输入框上方内联显示，不弹窗、不遮罩、不展开终端，等待期间可继续编辑草稿。确认后由原生协议写入并读回状态，取消暂停启动且保留草稿；启动完成前锁定该会话的显示切换。Hook 来源和命令可展开审阅，API 密钥入口默认折叠。对话输入和消息编辑支持 Ctrl+J 换行并关闭拼写检查，选中与焦点使用中性色。协议边界与验证归[双模式专题](./terminal-dialog-dual-mode.md)。

五引擎的普通发送立即显示消息并清空输入框。Codex、Claude、OpenCode 工作中直接提交给原生输入接口，Pi、DSH 按当前适配器能力等待空闲；输入区不显示投递方式选择器。审批、必答问题和在途提交仍暂停派发，原生何时消费已接收消息由各引擎决定。输入区支持附件、截图粘贴、文件拖入及 @ 文件/目录引用；历史差异可选行或划选加入反馈草稿，不直接发送。运行期队列跨 pane remount 保留，失败保留文字并暂停，不自动重发；线程或控制代次变化不把旧队列转发到新会话。Codex 支持空闲时 `/new`，由原生 TUI 创建并确认新 thread，终端与对话保持一致。队列限制、失败恢复和真实 CLI 验证见[双模式专题](./terminal-dialog-dual-mode.md)。

公共对话输入支持跨会话历史回填与原草稿恢复；Claude/Codex 本机原生输入历史只读导入，范围、限额及远端边界见[双模式专题](./terminal-dialog-dual-mode.md)。

对话图片结果共用有界本地缓存与图片卡片，支持放大、另存和加入参考图；接入 Codex 图片事件、Pi 结构化工具图片及已完成结果中的显式本地 Markdown 图片。生成仍由原生工具/skill 提供，未新增独立生图服务；各家支持与验证边界见[图片产物专题段落](./terminal-dialog-dual-mode.md#图片产物预览与参考图复用)。

斜杠菜单已接入动态目录、类型图标和参数补全；Codex/OpenCode 使用结构化技能输入，OpenCode/Pi 保留各自命令与模板语义。三条 conversation 后端路径的状态发布、控制权和提交去重已组合收敛到公共 ConversationSession，目录版本与接受回执由 ConversationCatalog 维护。Claude 展示原生目录并明确降级到同一终端；其 daemon reply 不展开技能，不能宣称对话 skill 可执行。实现边界、真实 CLI 验证和未接入项见[双模式专题](./terminal-dialog-dual-mode.md#公共控制与命令系统落地)。

Codex、OpenCode 支持原消息位置编辑：编辑卡片独立保存文字，底部草稿保留，提交真实替换该回合起的后续对话并重新回答，工作区文件保留。编辑与提交期间锁定模式切换；不明确的原生结果停用控制且保留编辑文字，不自动重试。截断及含附件等非纯文本消息不提供编辑；Claude、Pi、DSH 尚未接入历史编辑。协议及本地真实 CLI 验证见[双模式专题](./terminal-dialog-dual-mode.md)。

Codex 的原生执行计划与 Claude 的 TaskCreate／TaskUpdate／TodoWrite 共用输入框上方的只读任务面板，显示确认后的完成数、当前步骤和历史版本。Claude 通过原生 TaskList 或 TodoWrite 保存结果同步，读取失败显示最后确认的进度；轮次结束不自动勾选未完成项。工具可用不保证模型每轮规划，具体协议、版本与验证边界归双模式专题。

终端和对话的文件预览统一由用户点击入口后打开，包括生成的 HTML；生成完成、后续修改及模式切换只更新文件提示，不自动弹出或抢焦点。已打开预览的内容刷新与主动唤出分开处理，关闭后须再次点击才能打开；统一发现和版本刷新边界见双模式专题。

旧独立产物工作区已删除：退出其面板、本地文件 stage、发现与尺寸工具、Zustand store、专用动画和测试夹具。文件查看统一使用现用文件窗口，保留文件类型映射、Office 后端与预览 frame、共享 HTML／图片／Markdown viewer；旧方案由[产物记录](product-workspace.md)保留历史证据。

[文件预览与编辑](./file-editor-experience.md)以当前文件阅读、轻量修改和文件内搜索为边界，保留语法高亮与显式差异对比，移除 clangd 语言服务及定义／引用／符号导航。

PDF 已接入共享文件窗口的只读预览，支持分页阅读、缩放、文字选择、密码解锁及内嵌／浮窗阅读状态迁移；离线资源、16 MiB 文件上限与验证边界见[PDF 阅读预览](./file-editor-experience.md#pdf-阅读预览)。

[顶栏运行控件](./run-orb-budding.md)与收起的工具箱入口保持普通标题栏层级，展开 Island 覆盖其重叠区域；仅打开的工具菜单抬高层级。运行状态与控件实例不会随 Island 展开而清除。

运行条详情使用主题化中性底色和暗色投影，顶部显示项目与运行摘要，分支内排列进程信息，内容区独立滚动，底部操作固定可见。停止确认在进程下方单独展示，单进程分支不重复提供整组停止；关闭详情不停止任务。

[辅助面板收起、上下文底栏与预览控件精简](./requirements/auxiliary-panels-preview-controls.md)已实现：工具箱与文件窗口在右侧固定入口栏独立收起／恢复，自动收起保留手动偏好及会话；用量底栏按实际项目区宽度精简。HTML／Markdown 使用支持键盘的图标模式组，标题与文件操作分层，低频动作收入更多，重复标题带已移除。布局、内容与原生网页遮挡的验证及边界归该需求。

[应用启动与独立编辑窗口首屏主题](./standalone-editor-initial-theme.md)在创建窗口和挂载界面前读取当前主题，原生窗口底色与页面首漆一致，避免黑色主题启动应用或打开文件时先闪浅色。

[首次入门与再次学习](./first-run-learning.md)通过选择项目、启动终端、拖拽分屏和查看文件四步帮助用户开始使用。仅在首次无项目时自动介绍，学习中心由空页面和设置侧栏底部常驻入口进入；设置菜单独立滚动，学习入口保持可见。按真实操作验证、单独记录跳过，退出或重启后可继续，重学保留历史完成记录。独立编辑器通过成功读取事件确认文件步骤，特色功能独立课程尚未实施。

[全局工具与跨工作区分屏](./global-tool-layout.md)采用独立项目区与全局工具区。浏览器、Markdown、CPA 跨项目保留实例和工具分屏，目标项目完整恢复内部布局；窄窗收起工具并保留展开入口。Markdown 显式选择文稿归属，顶栏已打开条目仍可定位工具。

[长时间使用性能分析](./long-session-performance.md)记录既有刷新与账本修复、现场进程采样和可重复性能检测。当前源码已加入 Codex event 历史分块投影、工具区订阅隔离、Monaco 按编辑意图加载，保持统计口径并通过功能回归。终端对话与 JanusChat 现共用虚拟历史列表，最新内容保留正常流，折叠工具/diff 按需构建；已验证长历史节点数量受限、输入隔离和阅读锚点。内存治理 2A 已实现 Chat 日志流式恢复，以及每 renderer 估算 16 MiB/128 项、单项 2 MiB 的编辑器磁盘快照 LRU，打开和未保存内容不随淘汰丢失；79 项相关回归和实际 Electron 编辑保存检查通过，隔离基准确认历史恢复峰值下降、文件批量开关后的保留堆趋稳。会话正文按需读取、工作区索引释放、多终端总预算、累计模式解析/数据库线程隔离与现场长会话性能仍待后续测量，合成基准不代表现场停顿已消除。

生成文件面板统一显示“预览”，本地 Markdown／文本及应用状态界面跟随主题，HTML／Office 文档保留自身配色。[预览实现与主题检查](./product-workspace.md)记录统一扫描入口、历史迁移预算和固定色例外；新增主题可集中定位遗留项，verify 拒绝新增扫描问题。

[统一文件窗口与内嵌／浮窗路由](./unified-file-window.md)为已确认、待实施方向：移除顶部 Island 的产出提醒与产物跳转，OfficeCLI 与普通文件预览／编辑共用文件窗口。终端右侧 Island 和文件树默认打开内嵌区，后续打开跟随当前工作区的内嵌／浮窗模式；切换迁移全部标签与草稿，内嵌隐藏窗口控件。当前产物列与独立编辑器仍按各自已实现记录运行。

[预览编辑窗口显示风格与外壳 UI 对齐方向](./preview-editor-display-style.md)记录 opencode 文件编辑显示调研：diff 与普通编辑显示同批向“行号色带 + 超淡行底色 + 不变区折叠”收敛（正常显示同批适配），与无色块设计语言同构。外壳 UI 对齐（滑动指示块 tab、文字 + 2px 强调条选中态、MonacoViewer 令牌化）与 A–D（正文薄纱/gutter 色带/词强调 1:4、行高 24/tab 2、不变区折叠、行号染色、同源 +N/−N 徽标）已落地，竖条与缩进参考线经视觉复核撤除/禁用、tab 关闭钮可见性与悬浮反馈补齐；文件树红绿 git 状态色保持独立。

文件差异默认随容器宽度在合并／并排之间选择，手动选择持久保存；合并视图只显示一列行号，删除行显示旧行号，当前行显示当前行号，工具栏提供前后变更导航。具体布局、原生删除行边栏适配及浏览器回归见[单列 diff 行号](../terminal/monaco-diff-single-line-number.md)。

右侧[工具区](./right-dock.md)由竖排图标统一控制，移除顶部工具 Tab、独立折叠按钮和未选中工具的小圆点。收起时悬停显示可操作的临时卡片，点击则转为常驻面板，再点当前图标收起。两种展示复用同一个工具实例：临时预览覆盖中部内容；点击后中部向左让位，卡片的圆角、间距、边框与阴影同步在 240ms 内退去，转为上下贴边的面板，避免遮挡终端右侧的 island；收起后布局只保留 48px 工具栏。

通用设置的[主题选择](./settings-layout.md)以预览小卡片替代下拉框。每张缩略界面读取对应主题令牌，点击即保存应用；原生单选支持键盘切换，选中状态以轻描边与勾标记表达。说明与卡片根据设置区域实际宽度重排，保存失败保留原主题并显示错误。

[本机 Skills 与 MCP 管理](./local-skills-mcp.md)由设置和本机工作区右键进入，按客户端与用户级／工作区范围扫描原生来源，提供搜索、详情、新建、编辑、安全删除和 MCP 显式连接检测；客户端显示品牌图标，技能移入回收站，MCP 先备份再局部删除。工作区包含继承资源；Janus 插件技能只读并跳转插件管理。来源状态与本次检测结果分开表达，保存检查外部改动；远端、市场、同步和 OAuth 编排尚未接入。

插件可通过[应用设置页面契约](./plugin-contract-v1.md)贡献独立设置页，入口随安装出现、随卸载移除，未启用时仅显示宿主管理提示；启用后在弹窗内承载隔离原生页面，并处理动画及叠加遮挡。蓝图已使用该通用入口，退出创新功能开关和内置设置；生产目录与完整迁移状态见[官方插件专项](../planning/blueprint-official-plugin.md)。

插件启用后默认用于全部现有及未来注册工作区，设置不再要求逐项目授权。入口与快捷键按命令分组，采用正向显示开关；隐藏工具箱入口不会生成同一工作台的替代入口。访问范围、能力边界和兼容规则归[插件契约](./plugin-contract-v1.md#工作区默认访问范围)。

[设置布局](./settings-layout.md)以平铺分区、按需展开和一致的操作区组织配置。宿主、蓝图与 CPA 共同消费公共 `@janusx/ui`，统一中性按钮、输入框、下拉框、右对齐开关、设置行与保存栏；插件独立构建只依赖公共包，页面不再复制控件 CSS。通用页管理偏好与开发环境，关于页集中版本、更新与 GitHub 求赞入口；通知关闭时收起关联字段，通知与 Agent 权限显示未保存状态；模型测试与保存位于底部。外部 CLI 参考 MCP 接入采用品牌、状态与操作组成的通栏列表，保留安装、检测及入口显隐语义。

分屏落点与 Tab 插入占位统一使用灰色半透明底色和弱灰描边；侧栏原生拖入与 Tab 指针拖动共用预览及圆角提示样式，避免拖动时出现大面积强调色。浮动 Tab 保留清晰的主题底色，排序和分屏在松手后提交。

无工作区时，左侧提示、标题和操作图标，以及中央开始页的图标、文字与选择文件夹按钮均读取主题令牌，不叠加整体透明度。空状态沿用工作台网格：主行可收缩，侧栏标题固定高度、列表独立滚动；中央内容按可用区域居中、换行，矮窗中在自身区域滚动，侧栏折叠后随中央列重新排布。选择文件夹按钮的背景、边框、悬浮与键盘焦点采用主题中的中性色，不使用红色强调。2026-10-15 使用真实 App 与浏览器 IPC fallback 检查纸面／深色主题的 1280×720、800×480、800×240 六种组合，覆盖按钮边界、焦点、侧栏不透明与折叠后的重新排布。

文件夹选择对话框绑定发起操作的窗口。Windows 原生对话框没有 Electron 位置参数，由 `src/main/windows/center-native-dialog.ts` 启动隐藏的临时 PowerShell 进程，仅识别该父窗口拥有的原生对话框，按当前父窗口中心定位一次，并限制在所在显示器的可用区域，不改变窗口尺寸或焦点。对话框结束即清理，查找最多 10 秒、进程最多 15 秒；启动失败仍保留系统原生选择行为。代价是每次打开目录选择器增加一个短期系统进程，首次定位可能在对话框显示后发生。其它平台保留系统定位。独立 Electron 验证先将真实目录对话框移到 (10,10)，再运行生产定位函数，确认它回到父窗口中心 (223,163)，取消后正常关闭；未验证多显示器实机组合。

左侧“工作区”标题行不保留下方横线，40px 高度与中央 Tab 栏对齐，通过标题和列表留白区分导航层级；侧栏与内容之间的竖向边界保留。[底部用量栏](./runtime-drawer-cards-resize.md)收起时无贯穿横线，整行为支持键盘的展开按钮，圆角反馈集中到“用量”入口。展开时保留弱分隔与高度调整，卡片以浅底色和当前终端标记分组，避免重复描边；摘要布局按中部实际宽度收拢。

侧栏项目与终端选中态使用中性底色，分支与终端采用单行名称，路径和启动类型移入悬浮提示；[终端分组与导航](../terminal/terminal-sidebar-states.md)拥有终端点击定位、跨项目恢复和 worktree 归属规则。项目[悬浮操作](../sessions/workspace-row-hover-reveal.md)预留固定按钮位，以淡入显示保持名称宽度和菜单锚点稳定。

右侧[工具区](./right-dock.md)使用中性选中态，工具入口位置固定；文件与会话搜索统一高度和间距。会话采用标题优先的轻量列表，短提示去重，展开后才抬升详情底色；Git 采用[变更／历史双视图](./git-workbench.md)，固定仓库栏与提交区，支持文件目录树、真实父提交图、分页和独立详情；文件显示红绿增删行数，悬浮或键盘聚焦可预览对应暂存层／历史提交的差异片段。大量改动不会推走历史入口。各工具宽度偏好与业务操作保留。展开和收起保留淡入淡出及滑动效果，退出时内容及当前卡片／面板外观保留至 320ms 动画结束，但立即禁用交互。常驻面板支持拖拽调整宽度，中部同步让位；减少动态效果偏好关闭动画。

最右侧竖排功能控件的中性选中底板以 160ms 滑向目标，用 100ms 窗口合并快速连点，只激活最后一个面板；等待期间保留当前内容。反向点击、收起卡片或目标失效取消待执行切换；直接再点当前竖排工具仍可折叠／展开。未变化的隐藏工具跳过父层切换引起的重复渲染。终端等 pane 标签也采用滑动底板，内容选择保持即时，拖动时隐藏底板。内容固定使用目标宽度，隐藏圆桌停止布局轮询，Git 文件分组跳过屏外布局并复用未变化的行，避免后台状态刷新触发整表重渲染。此调度不打断已经执行的同步渲染，也不缩短 IPC 耗时，取舍和真实工作区 600 次切换验证归[工具区](./right-dock.md)与[工作区标签](./pane-tab-reorder.md)。

跨 CLI 对话框架为已确认约束：滚动/阅读位置、流式内容、输入区、工具/文件/产物展示和模式切换由公共层统一维护，CLI 仅适配事件、命令与真实能力。公共契约、IPC 和 AgentSessionPane/AgentComposer 已抽取，当前只有 Codex adapter；下一 CLI 需补足审批/提问、命令回执和细分能力，启动分支也须按引擎选择 adapter，不复制组件。已加载内容可上下滚动并在流式时保持阅读位置，更早历史分页尚未实现。边界与步骤归[双显示模式](./terminal-dialog-dual-mode.md)。

启动开场编排（设计已敲定、未实现）：窗口按横带装配——island 休眠充能→CRT 热身裂眼自检（第一幕），再顶部（字标+工具组）→底部（状态栏）→终端类型卡片逐个弹起→左展开→右展开，island 视线随动；右轨常驻右缘，任意输入跳到终态，终点尊重用户折叠偏好。时序数据与验收归[开场编排](./requirements/entrance-choreography.md)。

负责布局、预览、导航及可达交互，不承诺所有插件、主题或预览提案均已交付。下面保留历史阅读链，Note 工具的界面承载在本模块，文档身份和蓝图解析见 [Note 与蓝图](../blueprint/module.md)。

中央工作区以 pane 树统一承载终端、浏览器与 Markdown 内容；[工作区标签拖拽与布局](./pane-tab-reorder.md)负责排序、跨 pane 合并与分屏。工作区直角铺满，不保留外侧留缝、双层描边与阴影；圆角和轻底色集中到标签，分屏焦点由当前标签表达。每个 pane 的标签区独立横向滚动，右侧操作区固定，纯浏览器工作区也可分屏。分屏边界为 1px 细线、9px 拖动命中区，支持键盘调整和双击平分；底部监控条弱化分隔并移除身份、模型和其它终端摘要的胶囊边框。

已有终端标签切换复用 xterm 与历史缓冲，同尺寸只请求一次绘制；尺寸变化与工作区返回仍走稳定帧后的完整适配。标签、终端和变更浮岛跳过未变化的父层渲染，应用根布局只订阅 pane 是否存在，保留各实例自身的输出与状态订阅。20 终端基准的 12 次切换从 24 次适配／刷新降为零适配、12 次刷新；实测边界与回归归[工作区标签](./pane-tab-reorder.md)，不代表后台持续输出或真实桌面长任务已消除。

备忘录与圆桌羊皮纸、角色结果及问题池已共用 components/island/islandMotion.ts 的开合生命周期、可见内容编排、220ms 动效参数及最终几何展示，components/island/islandLayout.ts 按左右方向求解主附岛布局。memo 与 useAuxiliaryIslandLayout 分别适配宿主；业务状态和材质仍由原模块负责，关闭后恢复所占样式、inert 和焦点。旧独立展示清理定时及固定偏移已移除。羊皮纸快速关开、窄窗两岛边界和关闭恢复通过浏览器检查；其它两种附岛完整业务仍未单独端到端验收，取舍及证据见[里程碑设计评审](../knowledge/milestone-design-review.md)。

Chat 会话删除确认框虽通过 portal 挂到 body，仍属于 island 的交互范围。JanusChat 在确认框及遮罩外层标记 data-island-companion，并阻止指针和键盘事件继续向宿主传播；因此确认／取消不会被判为岛外点击，Esc 只关闭确认框。删除非当前会话保留当前回复；删除当前会话中止其回复并选择剩余会话，删完最后一条则创建空会话，均保持 island 展开。弹窗消失后正常的岛外点击收起仍有效。

2026-10-14 回归：修复前真实组件测试复现点击删除确认后 data-stage 变为 collapsed；修复后 `npx playwright test tests/e2e/chat-conversation-delete.spec.ts --project=island --workers=1 --output=artifacts/chat-delete/verified` 5 项通过，覆盖置顶／未置顶、取消／Esc／遮罩、Enter 删除末会话、删除进行中回复与保留另一会话回复。使用真实组件和会话控制器，持久化与流式 IPC 为测试替身；未另跑桌面删除持久化。`npm run typecheck` 与 `npm run build:app` 通过；JanusChat 范围 ESLint 为 0 错误、4 条既有中文字符串警告。

槽位演进链（非重复，保留先后）：[island-slots](./requirements/island-rightdock-slots.md)、[right-dock](./right-dock.md)、[empty-collapse](./right-rail-toggle-motion.md)、[toggle-motion](./right-rail-toggle-motion.md)、[drawer-resize](./runtime-drawer-cards-resize.md)、[run-orb](./run-orb-budding.md)、[hifi-alignment](./island-hifi-optimized-alignment.md)、[capsule](./island-hifi-optimized-alignment.md)；turn 双件[island](./turn-change-island.md)与[card](./turn-change-card-external-cli.md)同属本域。

多智能体展示与 CLI 监控复用（方向已确认、未实现）：先开发非 CLI 对话框版本，再形成公共多智能体视图，随后用一个 CLI 验证并复用到监控界面；完整独立监控暂缓，其它引擎按需扩展。共用树、状态、任务与详情阅读，运行事件和 CLI 会话记录分别适配，控制操作按实际能力提供；CLI 接入与状态可信度仍需独立验证。后续监控保留当前终端归属及右侧辅助 Island 详情目标。开发顺序、复用边界和保留验收归[监控与右侧详情方案](./cli-subagent-monitoring.md)，历史样本归[子智能体会话结构实测](../sessions/records/session-subagent-structures.md)。

Island 下滑展开通知（2026-10-27）：胶囊向下拖动 ≥60px 后松手打开既有通知面，已展开时再次下滑保持展开；未达阈值、反向拉回与取消不触发。单击、Esc 与点空白处收起，保留看过即焚。副黑板组件、中央列让位、板高状态与持久化、板缘拖拽、插件列表入口均已删除；蓝图继续使用插件声明的工作台入口。取舍与历史见[副黑板退役与通知手势](./island-blackboard.md)。

眼睛行为与通知系统：折叠胶囊由注意力行为驱动凝视、摸头与事件原语；通知采用串行传话、左上角灰字计数和整体纵向展开的通知中心。通知可经下滑、岛体单击、灰字计数或传话条打开；peek 下滑先返回胶囊再展开通知，expanded 仍禁用复杂手势。单击开合、双击控制台及运行按钮维持现有语义。参数与历史验收归[行为系统移植任务](./tasks/island-behavior-system.md)，设计原型在 `_design/janus-eye-behavior-lab/`。

产物语义：[workspace 重构](./product-workspace.md)、[notice-matrix](./product-workspace.md)、[peek-race](./product-workspace.md)、[preview-p0](./product-workspace.md)、[tour](./product-tour.md)、[landing](../desktop/landing-page.md)。

Note 工具链三件各司其职：[drawer-toolbar](./note-drawer-markdown-toolbar.md)、[mechanical-gates](../blueprint/documents/note-mechanical-checks.md)、[rename-draftcard](./notecard-rename-draft-card.md)；[Markdown 独立 pane 与顶栏工具分组](./markdown-pane-entry.md)记录移出底部的已确定方向，以及终端解耦、保存与迁移建议，尚未实现。工作便签归属：[own-namespace implemented](../blueprint/documents/history/own-notes-namespace.md)与[own-namespace proposed](../blueprint/documents/history/own-notes-namespace-proposal.md)为生命周期对，成对保留。

配套：[github-maintenance](../desktop/github-maintenance.md)、[markdown-assets](./markdown-preview-local-assets.md)、[experimental-preview](./experimental-preview-features.md)、[file-glyph](./note-drawer-markdown-toolbar.md)、[reveal-race](./file-tree-reveal-race.md)、[share-import](../blueprint/workspaces/share-import.md)、[plugin-forms](./requirements/plugin-architecture-forms.md)、[plugin-debug](./requirements/plugin-import-debug.md)、[entry-nav](./entry-switch-navigation.md)、[f12-nav](./f12-navigation.md)。

外部工作流工具：[Grok Bot 衔接](./grok-bot-workflow-integration.md)仍在讨论；[Docker 官方插件与工具箱入口](./docker-management-entry.md)已实现 `plugins/docker/` 独立包、应用级工具箱单实例、七项本机容器管理能力和宿主 PTY／浏览器联动。页面采用容器列表加概览／日志／终端详情区，沿用 JanusX 主题和简约细分隔布局，无项目也可使用。Windows 可选择已有本机 Docker、已有 WSL2 Ubuntu 或专用 Linux 环境；已有 Ubuntu 缺少 Docker 时明确确认后安装，专用路径显示进度、失败重试和重启待续，无需 Docker Desktop。目标跨页面关闭和插件重启保存，每次管理一个引擎；跨环境切换回收旧显示、终端和快照，保留引擎／容器运行。同一目标下切容器、切项目和关闭面板保留后台及存活终端，隐藏时停止轮询与日志采集，停用回收自有终端与采集而不停止引擎／容器。263 项相关单测与两项合成安装器／真实 Electron 桌面流程通过，公开 SDK 仓库外构建及本地签名入口已接通；真实 WSL 安装、UAC／重启、apt、已有 Ubuntu 服务启动、引擎退出存活及其它平台尚未验收，生产签名和目录未发布。配套的[HTTP 请求工具](./http-request-pane.md)独立规划，承载方式待定，不作为 Docker 首版依赖。

服务集成：[CPA 账号管理复用与 Figma 接入](./service-integrations.md)维护入口、托管和服务边界。CPA 已迁入可独立构建的 `official.cpa` 官方插件，安装并启用后提供跨项目工具箱入口和插件设置；未安装时不加载 CPA 业务。保留本地托管、已有实例、组件校验更新、密钥加密及复制、共享代理和 OAuth 手动回调。页面关闭保留后台；停用／卸载或退出停止自有进程，外部实例不受影响。迁移复制旧配置、组件、账号及密钥并保留原件，登录沿用原 origin 分区。公开 SDK 外部构建和定向单测通过，生产签名／目录发布及真实供应商额度仍未交付。文件树、Git、会话继续使用内置视图；Figma 仍待实施。

Docker 环境选择不跟随代码工作区。独立发行版隔离文件、依赖和 Docker 数据，CPU／内存仍共享，不能据此解决主机资源耗尽；代码挂载路径由引擎所在环境决定。已有环境不套用专用环境配置，WSL1 和非 Ubuntu 不自动转换或安装，详见 Docker owning Note。

专用 Docker 环境使用隐藏的 Windows 启动器保留引擎，并在有应用代理时为 apt／新启动 daemon 提供认证 NAT 网关转接，不修改全局 WSL 网络。转接随插件运行，退出后保留引擎／容器，但依赖该转接的镜像下载需要应用运行。用户为重测要求移除刚创建的 `JanusX-Docker`，已验证归属并注销，已有 `NewAPI-WSL` 保留；修复后的真实重建和镜像下载待用户复测，详见 owning Note。

插件交付按[分阶段计划](../planning/plugin-platform-roadmap.md)保留已交付的 S1–S3。P0 的[首版契约](./plugin-contract-v1.md)与 P1 SDK／严格校验、仓库外脚手架、命令／入口及旧 launcher 适配已落地；P2 已实现目录登记、授权、独立离线原生页面、只读桥、私有 KV、管理及调试。P3 增加工作台根页面、返回原界面、宿主绘制的 Island 状态／进度／徽标／动作／文本预览和隔离展开工具区，外部模板以同一 SDK 联动四区域。状态绑定发布页面，撤销清理；审批遮挡时外壳和原生页同时让位。P4 首片提供嵌入文件编辑器的只读 viewer、默认打开／恢复、失效回退和按文档绑定的隔离实例；未保存文件保留内置编辑；后续片已接通版本化草稿交接、宿主审阅保存、关闭保护及写前冲突检查。持续宿主草稿、人工差异审阅、精确目录查询和通用工作区多实例已补齐；跨进程强事务、自动文件订阅和代表内置查看器迁移仍待续。新增 P4a 已交付声明式参数配置、应用默认与项目／worktree 覆盖、恢复默认、读取订阅及升级诊断；已支持隔离自定义设置页及宿主审阅配置建议，P5 已采用宿主声明式任务接通后台监督、受限网络／凭证及事件／公开服务。阶段计划保留实际门禁证据和平台限制，未测平台不记为完成。P6 首片已接通内置 Agent／公开服务、显式授权、取消与结果归属，已补齐受限文本模型代发、按需读取的技能资源与受监督的顺序服务工作流，固定文件文档上下文已补齐，P6／M3 按 Windows 开发构建的声明式代表范围完成；P7 已接通独立窗口的授权、单实例／关闭清理、几何恢复和宿主遮挡；声明式调色板与既有配置隔离已接通，角色资源、对话局部贡献与 P8 分发待续；版本尚未指定。工作台需求维护验收，规划模块维护阶段及证据。

[插件平台与全产品扩展架构](./plugin-platform-design.md)维护以命令、入口、视图、工作台和领域能力组合完整功能的目标，并明确实例、上下文、数据与任务归属。普通第三方使用隔离页面与宿主代理，可信内置视图保留现有方式；显式开发模式只允许授权的未签名隔离页面。[蓝图可下载插件专项](../planning/blueprint-official-plugin.md)已增加官方签名来源、目录和安装更新、管理页以及受信 native 服务；后者具有用户 OS 权限，要求固定 signer allowlist 与单独授权。生产目录／密钥未上线，完整蓝图迁移和主包瘦身仍未验收，不能以本地测试包可运行代替发布完成。

[PI-Desktop 插件调研与功能插件化探索](./ideas/plugin-platform-and-feature-modularization.md)保留固定源码基线、运行边界、开发闭环及功能适配矩阵，为架构提供研究依据。文件树、Git、会话保留内置视图注册，CPA 改用官方独立包；其它功能迁移及提供者仍待实施，全部官方功能拆包不作为首版前置。

[Janus 自有功能形象与宠物交互探索](./ideas/janus-functional-character.md)记录 DSH 社区鲸鱼的像素动画与状态适配参考，以及未来 Janus 原创角色表达任务、等待、成功／失败和轻量互动的可能方向。造型、位置、与现有眼睛的关系及桌宠模式均未确定，尚未实施或排期。

运行与测试目标探索：[按当前 worktree 运行与测试项目](./worktree-run-test-target.md)记录现有快捷启动使用工作区根目录的限制，以及目标跟随、进程归属和测试结果标识的建议，作为 0.9.2 候选，尚未实现。

渲染与编辑器：[emphasis](./markdown-emphasis-orange-text.md)（强调色去填充块）、[standalone-refresh](./standalone-editor-auto-refresh.md)（独立编辑器外部变更自刷新）。[文件编辑窗口与预览体验](./file-editor-experience.md)记录普通编辑默认、按需 HEAD 对比、自定义关闭确认、Markdown 单向同步滚动与安全 HTML 图片预览，以及 HTML 虚拟视口、缩放和工作区只读资源服务。

## Acceptance criteria

以下为 2026-09-26 整理的历史验收，原编号、条文与勾选状态保留给已有 Task。篇数与迁移样例记录不代表当前范围。

- [x] AC-1: 本域 31 篇直接子全部携带有效 parent。
- [ ] AC-2: own-namespace 生命周期对保留两篇，不判重复删除。
- [ ] AC-3: 历史迁移样例已清理（2026-09-27 随鹈鹕骑行 Note 一并移除），不再保留隔离样例。

默认外观为经典黑，石板色保留为可选主题；应用 Logo 使用黑底白橙 X。[主题与 Logo 决定](./slate-logo-redesign.md)记录当前配置及历史设计。
