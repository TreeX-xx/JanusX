---
{
  "schema": "harness-note/2",
  "id": "0cb67585-99d2-49a1-975e-e88fe85e7ed6",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-30",
  "updated": "2026-11-04T08:21:59Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "tags": ["terminal", "conversation", "agent", "dual-mode"],
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935" }
  ]
}
---

# 终端与对话双显示模式：Codeg、ZCode 调研及 JanusX 融合方案

## 原生指令执行与会话切换

受管本地 Claude、Codex、OpenCode、Pi、DSH 共用指令执行入口。已适配的结构化命令保持原生接口调用；需要 TUI 的命令通过所属 PTY 执行，自动切换终端并保留参数，不再要求用户重新输入。目录外的明确斜杠指令提供同一入口，不作为普通聊天消息送给模型。普通绝对路径继续按文本处理。应用的模型／强度选择和 Codex 新建会话入口保留；`/help` 交给原生帮助，OpenCode 的 `/terminal` 保留原生命令语义。

| 引擎 | 本轮接入与会话同步 |
| --- | --- |
| Claude 2.1.318 | `/clear` 在同一 worker 用 Mods `command.run` 执行，读取真实 session ID 变化后清空投影并更新绑定，随后可直接继续对话。其余指令自动提交给终端。原生 clear/resume/branch 不保证发出 session.start，桥在交换前读取真实 ID，通过带认证的会话切换握手同步 |
| Codex 0.166.0 | 既有结构化 skill、设置和 `/new` 保持；其他原生命令走终端。`/new` 等待原生 thread 创建，`/status` 的终端输出与当前 thread 一致 |
| OpenCode 2.2.5 | API command/skill 保持结构化执行；TUI 指令交给终端。`/new` 与 `/clear` 先进入原生首页，首条原生消息才创建新 session；此期间禁止对话回到旧会话，成功 create/view 并读回后恢复 |
| Pi 0.85.1 | 合并安装包 BUILTIN_SLASH_COMMANDS 与运行中扩展／skill／模板目录；内置命令交给 TUI。终端新会话允许新扩展实例握手，旧实例退休后拒绝回流，待确认调用不重放 |
| DSH / dsh-tui 0.12.0 | 合并原生 LOCAL_COMMANDS 与运行中 command registry，交给 TUI。新根 Agent 可能先创建、旧根后释放；旧根释放后只绑定唯一存活根，多个候选时保留终端处理，不猜前台身份 |

公共提交校验空闲状态、controlEpoch、问题／审批和 commandId。终端路径拒绝换行与控制字符，清除原生未提交输入，再以 bracketed paste 写入完整指令，间隔 150ms 提交回车；操作会替换终端输入框中未发送的草稿。回执 handedOff 只表示已交给终端，不表示原生命令成功或交互完成；异常标为 unknown，不自动重试。新会话重置旧消息、问题、计划和目录版本，旧控制不能继续操作。Claude 无法确认重置时停止对话控制。

选择 TUI 交接是因为各家的登录、帮助、插件和交互命令并不都暴露在服务 API 中。成本是部分指令仍需在终端完成后续交互；原生接口提供同会话调用及结果确认时，可逐项升级为对话内执行。命令是否存在、参数和权限要求以安装的 CLI 为准，不为原生不存在的指令伪造成功。已有会话的完整历史重建、DSH 多根前台切换、远端与其他版本未在本轮验收。安装包目录模块为可选发现能力，布局变化不会使整个扩展启动失败。

验证使用 Windows 实际安装 CLI 和隔离配置／localhost 模型：Claude `/clear` 后继续问答与终端模型指令；Codex `/new`、`/status`；OpenCode 自定义 command/skill、新建首页到新会话后继续对话；Pi 扩展命令／问答与 `/new`；DSH 问答与 `/new`。复现文件为 `tests/unit/{claude,codex,opencode,pi,dsh}-conversation-cli.test.ts`，需设置对应 JANUSX_TEST_*_BIN；未设置时跳过，不能作为真实 CLI 通过证据。原生规范见 [Claude Mods API](https://code.claude.com/docs/en/mods-api-reference) 与 [OpenCode TUI](https://docs.opencode.ai/docs/tui/)。

本轮验收：9 个相关单元文件 95 项通过；命令、设置和输入历史浏览器用例共 25 项分轮通过；上述 5 个真实 CLI 文件中 6 个代表性集成用例通过。Claude 完整流程 86.8 秒通过，额外覆盖终端模型指令、审批、原生 Esc、Bash 停止和 worker 隔离；其既有连续输入测试改为等待目标回复完成，避免把上一轮结束误当作后续投影已就绪。类型检查、相关 ESLint、双语键检查、diff 空白检查通过；Notes 校验 324 篇、0 errors、17 条既有外部链接诊断。主 Agent 自检，没有独立子 Agent 审阅。未逐条执行登录／登出、删除或发布类命令，不宣称所有参数、账户服务、CLI 版本均已验收。

## 对话内审批、选项和文字回答

对话模式用独立请求卡片承载确认、单选、多选和 Type something 文字输入；一批问题完整提交，保留原生问题与选项身份。答案直接回应当前原生请求，不作为下一条聊天消息、不进入普通输入历史或待发队列。原生 CLI 仍可把已提交答案写入自己的工具结果与会话记录。底部草稿独立保留，阻塞问题未处理时暂停聊天发送与队列派发；不预选授权、不自动提交。

| 引擎 | 当前对话内处理范围 | 原生答复路径 |
| --- | --- | --- |
| Codex | 命令／文件审批的允许一次、会话允许、拒绝、拒绝并停止；原生提议的命令／网络持久规则；request_user_input 多题、单选、Other、无选项文字及密码遮罩 | JSON-RPC request ID；文字按原生 user_note 前缀编码 |
| Claude | Write／Edit／Bash 允许一次或拒绝；AskUserQuestion 多题、单选、多选及自定义文字 | Mods API 长轮询等待人工回答，原生工具完成确认；PermissionRequest 只消费问题内容和答案都相符的唯一待答回执 |
| OpenCode | 权限 once／always／reject；简单字符串、单选、多选、自定义文字、布尔和数值表单 | 原生 session permission/form reply；表单取消使用 DELETE，选项值与标签分开保存 |
| Pi | 扩展 UI confirm、select、input、editor | 原 ExtensionUIContext 回调的布尔值、选项文字、输入文字或取消值 |
| DSH | 当前根 Agent 的 approval/request 和无计时 user-questions/request；多选可附加自定义文字 | 原生 approval 结果词汇及结构化 selected/custom 答案 |

公共 ConversationQuestions 管理请求版本和 pending／submitting／unknown 状态。主进程在消费回调前校验问题集合、选项、单多选约束、必填与原生表单范围；旧版本、已处理请求和重复点击均拒绝。原生解决通知、工具完成、会话切换会清除对应请求；传输失败按确认未知处理，禁用再次回答并保留终端核查入口，不自动重试。提交期间禁止模式切换。界面使用原生 radio／checkbox、中文输入法组合态保护及独立取消按钮，授权范围可换行，适配深浅主题与窄 pane。

Claude／Pi／DSH 的新请求按已同步的显示模式选择一个回答方；切回终端或桥失联会把尚未回答的请求交给原生 UI，避免两个未能取消的原生对话框同时消费答案。已经在终端打开的这些原生弹窗仍在终端完成。Codex／OpenCode 使用可同步的原生请求身份，切换后继续以原生待处理状态为准。

尚未通用化任意 TUI：Claude 的计划模式确认和并发匹配歧义、Pi custom UI、DSH 带 claim／超时续答的 timed questions、OpenCode 条件／隐藏／外部表单及带 pattern／format 的字段，以及 Codex 未识别的请求仍提示原生处理。普通 shell 及未接入的 CLI 不通过解析 ANSI 猜测问题。此范围只针对受管本地双模式会话；没有改用户全局权限规则，也没有给各家增加原生不存在的多选能力。

协议依据为本机 Codex generate-json-schema、OpenCode /openapi.json、Pi／DSH 已安装扩展类型，以及 [Codex 原生回答编码](https://github.com/openai/codex/blob/main/codex-rs/app-server-test-client/src/request_user_input.rs)。Claude 的真实测试确认 PermissionRequest 会调整 JSON 对象键顺序，因此按结构比较问题与答案，不能按 JSON 字符串顺序关联。

验证（2026-11-03）：11 个相关单测文件共 89 项通过，覆盖校验、过期、重复、未知回执、桥模式交接、队列门禁及既有编辑／命令控制。tests/unit/{codex,claude,opencode,pi,dsh}-conversation-cli.test.ts 中本次问答用例均以已安装 Windows CLI、隔离配置与本地模型／服务跑通：实际工具结果包含所选标签和中文文字；Claude 无需附加终端即可恢复工具，OpenCode 表单保存并清除待处理，Pi 返回原 UI 回调值，DSH 原生审批与问答结果一致。Codex 测试仅在隔离配置开启 default_mode_request_user_input，产品不替用户开启该实验功能。

浏览器测试 conversation-questions、codex-conversation、conversation-work-disclosure 共 24 个不同用例通过；包含批量回答、IME、取消／过期、模式切换保留输入、普通草稿不变、多种授权范围与窄窗换行。已查看 artifacts/conversation-interactions/questions-{dark,light}.png，提交按钮与底部输入区不重叠。复现入口为 npx vitest run 加上述测试文件、按引擎设置 JANUSX_TEST_*_BIN；界面使用 JANUS_E2E_PORT 指定独立端口后运行 npx playwright test tests/e2e/conversation-questions.spec.ts tests/e2e/codex-conversation.spec.ts tests/e2e/conversation-work-disclosure.spec.ts --project=island --workers=1 --timeout=60000。本轮未覆盖真实供应商账户、跨平台、任意上游版本或长时间故障恢复。

静态验证：本次生产文件定向 ESLint、i18n 检查与 Notes 校验通过。以 e7108583 加本次改动建立临时检出，npm run typecheck:strict-unused 和 npm run build:app 均通过；验证隔离于工作区同时进行的文件树、Git 与切换界面改动。构建仍有既有 theme 模块同时静态／动态导入提示，Notes 校验保留 17 项既有外部链接诊断、无错误。

### 长时间等待与原生提交确认

Claude Code 2.1.318 的旧实现已实测复现：问题出现后等待 12 秒再提交，触发 `HooksError: janusx-conversation: next() after it settled`；原生仍在等待，而卡片已清除、终端提示也被错误复位。原因是 tool.call 内等待本地 Promise 消耗 Hook 的 10 秒执行预算。该证据不证明问题由 2.1.318 首次引入。

当前 Claude 通过 `$.http.fetch` 调用会话私有、token 校验的 `/question-wait`；每 20 秒续期，单次低于原生 HTTP 的 30 秒限制。人工等待没有闲置超时。依据官方 [Mods 等待规则](https://code.claude.com/docs/en/plugins/mods/events.md#hold-a-tool-call-until-the-user-decides)与[限制](https://code.claude.com/docs/en/plugins/mods/reference.md#limits)，Mods API 内等待不计入 Hook 自身预算，本地 Promise 和 clock.sleep 则计入。控制回执唤醒长轮询；已经消费的答案在等待连接失败时仍继续处理一次。next.signal 取消后不再调用失效 next；失联或切回终端时撤销对话卡并交还原生。原生错误保留终端入口，不伪造工具结果。

公共层区分原生接口回调确认与异步事件确认。Claude 等待 tool.complete，Codex 等待 serverRequest/resolved，Pi／DSH 等待原生问答路由的 question-resolved；OpenCode 仍以原生 HTTP reply 成功作为确认并同步待处理列表。单纯桥 ack／socket.send 不再清卡。事件确认路径在投递后等待 15 秒，缺少确认或提交中断线则保留 unknown、禁止重发并允许切终端；该时限不作用于用户阅读时间。迟到的原生确认仍可清除对应请求。Pi／DSH 保留调用方显式 signal／timeout 语义，DSH timed questions 仍在原生处理。

验证（2026-11-04）：五引擎已安装 Windows CLI、隔离配置和 localhost fixture 的问答用例通过。Claude 等待 25 秒跨过一次续期后正确收到单选、多选、中文文字，另验证等待中停止、切回终端与旧卡片拒绝；Codex、OpenCode、Pi、DSH 各等待 12 秒后答复通过。入口为 tests/unit/{claude,codex,opencode,pi,dsh}-conversation-cli.test.ts，使用 JANUSX_TEST_*_BIN，Claude 选择 `answers native questions` 用例。公共及原生路由用假时钟验证 8 小时无操作、确认超时、断线、迟到确认和重复提交；Mods 单测验证 API 续期、取消及等待连接失败时不丢已消费答案。真实数小时闲置、系统休眠恢复、真实供应商与跨平台仍未验收；进程退出或原生请求取消不会被当作可继续的旧问题。

本轮 11 个相关单测文件共 90 项通过；TypeScript（含 strict-unused）、生产文件定向 ESLint 与 Notes 校验通过。Notes 保留 17 项既有外部引用诊断、无错误。验证不包含打包发布；新的会话私有 Mod 随新建终端加载，已运行 worker 不热替换。

## 对话直接启动的加载反馈

直接进入对话且原生会话尚未就绪时，显示现有 Agent 图标、细加载环和三条呼吸轮廓，替代单行等待文字与提前出现的欢迎标题。加载期间保留草稿输入，就绪后移除占位；错误、登录、信任与 Hook 确认优先显示实际操作。动画不表达百分比，不设置虚假完成计时；隐藏 pane 暂停动画，减少动画偏好下保留静态占位。沿用 shell 主题变量适配深浅色与窄窗。

加载与欢迎界面共用固定位置的 Agent 图标和自适应网格空间，标题字号与行高一致；两层内容以 220ms 交叉淡化切换，输入框不随占位移除跳动。非活动层立即从无障碍树隐藏，淡出后不可见；减少动画模式直接切换，不延迟真实可发送状态。

验证：6 项启动流程 Playwright 用例通过，含加载到就绪后输入框纵向位移小于 2px、草稿与焦点保留、减少动画及错误退出。深色就绪页及 390px 浅色截图已检查（artifacts/codex-startup/conversation-*.png）。

## Codex 快速模式

JanusX 新建 Codex 主会话明确传 serviceTier=default，默认关闭 fast，不继承用户原生配置的快速档位；不修改全局配置。恢复已有会话保留其选择，后续手动切换正常透传。默认关闭及恢复／切换保留由真实 WebSocket 转发测试覆盖，Codex 单元测试共 18 项通过。

对话输入区在模型旁提供纯闪电图标按钮，不显示常驻“快速”文字；开启后实心点亮，悬停与无障碍标签说明状态及更高用量。模型目录的 serviceTiers（旧协议回退 additionalSpeedTiers）决定 fast／priority 可用性；未回传状态与不支持模型禁用入口。只通过 thread/settings/update 修改当前会话 serviceTier，关闭传 null；不改模型、推理强度或用户全局配置。状态来自原生会话响应及 thread/settings/updated，原生终端改动同步投影；请求失败保留已确认状态，切换会话清除未知旧状态。此标识表示会话请求档位，不承诺每次请求实际服务速度。

验证：本机 Codex 生成的协议 schema 确认设置、通知与模型目录字段；Codex 单元测试 17 项及纯图标／失败保留状态的 Playwright 测试 1 项通过，类型检查通过。未验证真实付费服务的加速或账号可用性；旧协议未报告档位时保持不可用。

## OpenCode 原生会话切换


JanusX 管理的双模式 OpenCode 使用外层终端标签承载多个运行实例；原生 TUI 通过进程级 `OPENCODE_CLI_CONFIG_CONTENT` 覆盖 `tabs.mode=off` 与 `tabs.enabled=false`，不恢复或写入共享的内层 tab 列表。仍可打开 New session、主动新建或切换历史会话。覆盖合并已有 JSONC 环境配置，保留主题、快捷键及其他字段，不修改全局配置和原生历史；配置格式无效时在启动服务前明确失败。这样避免同目录的旧空会话在新 pane 中再次出现，以及窄窗内多层标签标题互相挤压；代价是双模式实例不提供 OpenCode 内层标签栏，需要多实例时使用 JanusX 的终端标签。

验证（2026-11-02）：`vitest run tests/unit/opencode-terminal-config.test.ts tests/unit/opencode-tabs-cli.test.ts tests/unit/opencode-session-startup.test.ts tests/unit/opencode-conversation-cli.test.ts` 共 11 项通过，类型检查与适配器 ESLint 通过。真实 Windows OpenCode 2.2.5 的对照复现两个保存 tab 加新会话显示三个 New session；修复后 80／45 列终端不加载旧 tab、不追加新 tab、不额外创建会话，保存文件字节不变，双向对话／新建／切换回归通过。画面证据取真实 PTY 输出与 xterm buffer；窗口捕获工具初始化失败，未验收用户 dev 窗口整体是否另有裁切问题。测试清理仍有既有 ConPTY 警告。若后续需要保留内层多标签，应引入按 pane 隔离的 tab 状态及单独布局验收，不能直接恢复共享 tab 列表。

OpenCode 代理不再把其他会话的历史读取或尚未成功的新建请求判为会话损坏。原生 TUI 成功新建会话或发送 `POST /api/session/{id}/view` 后，适配器回读身份与工作目录再绑定；清空旧会话投影、撤销旧控制代次，并通过既有回调同步原生会话归属。读取历史不改变绑定，失败请求保留原会话；切换期间暂停轮询与对话控制，旧轮询的迟到消息和错误不能污染新会话。

对话视图、发送或设置更新占用输入时，原生新建／切换返回 409。回读失败、响应丢失或切换交叠只暂停对话控制，保留终端操作；重新选择原生会话并确认后可恢复，不永久断开、不自动重发提示词。仍只管理当前服务与工作目录，其他引擎的身份保护不变。接口变化应更新选择信号适配，不能恢复“读历史即切换”的猜测。

验证（2026-11-02）：`vitest run tests/unit/opencode-session-selection.test.ts tests/unit/opencode-conversation.test.ts tests/unit/native-conversation.test.ts` 共 19 项通过，覆盖旧控制失效、同会话保留历史、未知结果恢复、迟到读回及旧轮询消息／失败隔离。Windows 真实 OpenCode 2.2.5 的 `opencode-session-startup.test.ts` 与 `opencode-conversation-cli.test.ts` 各 1 项通过，使用隔离目录和 localhost 模型夹具，覆盖启动、历史预览、失败新建、原生 `/new`、双向发送、返回旧会话、模型设置及取消。测试通过不代表所有上游版本或生产模型均已验收；强制回收 TUI 时仍有既有 ConPTY `AttachConsole failed` 警告。

## CLI 版本兼容策略

Claude、Codex、OpenCode、Pi 与 DSH 的双模式启动不再以 CLI 或 DSH TUI 包版本号作为准入条件。启动前不运行仅用于门禁的 --version，也不读取 Pi／DSH 包清单做精确版本比较；升级后会直接进入既有后端启动或扩展桥准备流程。已验证版本只描述历史测试环境，不构成产品允许列表。诊断探针中的固定版本条件用于复现已有实验，不参与产品启动。

实际可执行文件解析、平台限制、DSH 的 dsh-tui profile、登录／目录信任、原生服务响应、桥认证、会话身份、事件序号及控制权校验仍保留。移除门禁不代表承诺任意上游版本兼容；协议或扩展 API 变化时按实际启动、握手或请求失败报错，不伪造就绪、不自动重发。这样消除每次 CLI 升级都需改允许列表的维护成本；出现真实接口变化时再适配该接口，而非恢复精确版本锁。

验证（2026-11-02）：conversation-launch-version 新增 6 项行为测试，验证 Codex／OpenCode 直接进入后端启动、Claude 进入实际启动操作、Pi／DSH 无包版本清单时仍可准备桥且保持 starting、DSH 错误 profile 仍拒绝。连同 codex-conversation、claude-conversation、opencode-conversation 与 native-conversation 共 45 项单测通过；类型检查与四个适配器 ESLint 通过。Note 校验 321 篇、0 errors，保留 17 条既有外部链接诊断。启动测试使用子进程替身或本地扩展桥，不调用供应商；该轮未实测 OpenCode 2.2.5，后续真实 CLI 验证及边界见上方原生会话切换小节。


对话首屏空态与助手回复身份复用 TerminalPresetIcon，按会话 engine 显示对应类型图标；快照尚未返回时沿用终端 preset，Codex 深色主题反色以保持可读。

输入框在空态中部与历史底部之间复用同一个表单，首次发送与 /new 清空返回均以 420ms 位移动画衔接，不等待动画再处理命令；减少动画设置下直接切换，隐藏或切换视图时取消动画。

## 对话正文与工作过程

CLI 对话与 JanusX 的普通 Chat、项目对话、运行配置助手共用相邻活动分组和“工作过程”折叠组件。助手公开正文（包括 commentary）和最终回答直接显示；连续工具／公开推理从执行中起默认收起。正文、用户消息及图片结果中断分组，过程不跨轮次；不依赖 final_answer 或文本猜测，因此 Codex、Claude、OpenCode、Pi、DSH 使用相同规则。

摘要显示活动数、执行／等待／完成状态及失败、中断、记录不完整提示。展开先查看活动列表，再展开参数、输出或 diff。新事件和完成不重置用户选择。CLI 对话的 Thinking 行与整轮耗时保持显示，工具运行、步骤更新及展开／收起工作过程均不卸载计时组件；审批、提问或必须回终端处理时仍由对应提示接管。审批、提问、阻断错误、图片、文件变更汇总以及 JanusX 的 Note／配置业务结果继续直接可见。状态保存与业务结果边界见 [Chat 工作时间线](../agent/requirements/chat-work-timeline.md)。

正文沿用共享 Markdown 排版。原生阶段、工具事件和模型上下文保持原协议语义；本节的展示规则更新下文旧版“公开推理完成后始终直接展开”的描述。

2026-11-03 计时闪烁回归：`npx playwright test tests/e2e/conversation-work-disclosure.spec.ts --project=island --workers=1 --output artifacts/thinking-duration-check` 共 10 项通过，覆盖 Codex、Claude、OpenCode、Pi、DSH 的步骤运行／间歇切换、展开／收起后同一计时节点持续递增及轮次结束移除，同时回归默认折叠、失败提示和审批入口。`npm run typecheck` 与 `npx eslint src/renderer/src/components/AgentSessionPane.tsx` 通过；本轮为浏览器夹具验证，未重新打包或进行真实桌面会话验收。

## 对话上下文、发送意图与差异反馈

长对话输入隔离：`AgentComposer` 单独订阅草稿并负责输入框高度调整；`AgentSessionPane` 仅浅比较订阅工作区、路径、进程、初始视图和阅读位置，不订阅整个终端对象。逐字输入不再触发历史消息分组、diff 统计或节点构建。草稿仍同步写回原 store，发送与队列恢复直接读取最新值，保持重建恢复和连续发送语义。历史 DOM 常驻开销进一步由共用 `VirtualHistory`、最新轮次正常流和折叠内容按需渲染处理；机制、测试与剩余边界见[长对话显示与滚动](./long-session-performance.md)。

验证：`conversation-typing-isolation.spec.ts` 使用 100 轮、400 条含工具与 diff 的合成记录，通过夹具 getter 统计历史正文读取。相同 31 字符逐字输入，修复前读取 62,000 次，修复后为 0；同时验证草稿重建恢复和发送。计数来自开发模式 StrictMode 浏览器夹具，不是现场输入延迟或整应用加速比。

输入框快捷面板共用上沿锚点、背景、边框、阴影及列表行；模型与文件列表宽度上限 360px，添加上下文一级菜单为 280px，窄窗随输入框收缩。斜杠与工具栏模型入口均提供搜索；无查询时定位当前模型，勾选表示已应用，行背景表示待选择。斜杠模型页支持返回指令列表，提交失败保留原选择。

“+ → 引用文件”在原弹层内搜索当前目录、进入子目录或引用整个目录，在正文光标处插入引用；直接输入 `@` 复用文件列表，选定后替换查询并回到正文。上下文菜单与模型／强度面板互斥，弹层不占正文布局。验证入口为 `tests/e2e/conversation-composer-layout.spec.ts`、`conversation-context.spec.ts` 和 `conversation-commands.spec.ts`。

工程对话提供附件入口、截图粘贴、文件拖入和 `@` 文件/目录选择。“+”固定在输入区底部工具栏最左侧，与模型、强度及发送操作同排；添加菜单向上浮出，不占正文布局。文件与图片引用作为不可拆分的小标签嵌入正文，不再挂在正文上方；右侧文件拖入按鼠标落点插入，可拖动到其他文字之间。图片提供内联缩略图与预览，加载失败仍可删除。菜单支持 Esc 返回触发按钮、点击外部或焦点离开时关闭，选择引用后聚焦输入框。草稿及引用跨 pane 重建保留，发送失败可显式恢复。每条消息最多 8 个引用，单附件不超过 10 MB，合成提示词上限 32000 字符。附件由主进程保存至 userData/conversation-attachments 的独立 UUID 目录，不覆盖工作区文件。引用按正文顺序展开路径与选区内容，Codex 图片另按首次出现顺序以原生 localImage 输入发送；其他引擎按文件引用处理，是否能查看图片取决于引擎工具能力。附件为历史引用保留在本机，尚未自动清理；长期磁盘增长需要后续存储管理接入。

内联编辑器由浏览器保存选区与原生撤销栈；草稿仅存文本及引用标记，不存 HTML。引用元数据在草稿生命周期内保留以支持撤销，发送只采用正文仍存在的引用；全选覆盖或删除不会附带隐藏附件。同一编辑器复制／剪切粘贴保留已知引用，跨会话粘贴回退为可读路径文本。普通富文本粘贴只接收纯文本。Ctrl+J／Shift+Enter 使用原生换行操作，一次按键即将光标移入下一行；序列化忽略空行占位，草稿恢复保留首尾空行。IME、撤销／重做、输入历史、失败恢复与 pane 重建保持原有交互。

占位提示按整个编辑器序列化后的内容是否为空判断，包含文字、引用和输入法尚未提交的组合文本；键入、删除、撤销与草稿恢复同步更新显示。CSS 的 `:only-child` 只统计元素节点，文字后仅剩一个换行元素时仍会命中，因此不再按这一 DOM 形状判空。编辑器仅剩浏览器维持光标的空占位时显示提示；实际换行和空格继续作为草稿内容保留。

占位提示回归（2026-11-04）：新增多行粘贴后逐字删除用例在修复前复现误显示。`npx playwright test tests/e2e/conversation-input-editing.spec.ts tests/e2e/conversation-input-history.spec.ts tests/e2e/conversation-inline-reference.spec.ts tests/e2e/codex-conversation.spec.ts --project=island --workers=1 --timeout=30000` 共 28 项通过，覆盖键入／粘贴、删空第二行、清空、撤销、重建、发送及组合输入期间的提示；日志位于 `artifacts/release-11-4/placeholder-verified.log`。类型、组件 ESLint 与 Notes 检查通过；组合输入仍使用合成事件，不替代真实系统输入法验收。

验证（2026-11-03）：17 项上下文、队列及输入历史单元测试通过；3 项内联编辑专项浏览器测试覆盖落点、退格／按钮删除与撤销、重排、重挂载、纯文本粘贴、合成输入事件和图片原生发送。既有附件预览／缺失图片、失败恢复、命令、历史编辑、启动、设置、输入历史及窄窗布局相关回归通过，类型检查与变更组件 ESLint 通过。截图见 artifacts/conversation-inline-reference/editor.png。浏览器夹具不代表真实供应商对引用内容的理解效果；真实中文输入法仍需用户实际使用确认。

输入区默认使用原生输入行为，Enter 和发送按钮不再固定指定 queue。Codex、Claude、OpenCode 在工作中直接提交给原生接口，无须等当前轮结束；未声明 liveInput 的 Pi、DSH 仍等空闲后派发。输入区统一不显示排队／纠偏选择器，审批、必答问题、设置更新及在途提交仍暂停派发；原生接收后的消费时机由各引擎决定。协议保留显式 queue／steer，并拒绝过期纠偏及排队消息撞上新轮次的竞态。未发送消息可编辑或删除；结果未知的发送不自动重试，恢复草稿前应核查原生历史。

每轮文件变更卡片提供文件反馈、补丁行反馈及鼠标划选反馈。点击只将文件、历史轮次和差异加入输入区，不覆盖草稿或直接执行修改；单次选区上限 8000 字符。补丁行号是补丁内位置，不是当前源码行号。对话目录与当前项目根目录一致时，卡片提供现有 Git 面板入口，继续使用其暂存、撤销和提交操作；worktree 或其他目录不误跳到项目根目录。历史补丁不作为当前 Git diff，也不直接用于撤销。实现入口为 AgentComposer、ConversationContext、ConversationFileChanges、conversation-outbox 与 conversation-context。

验证：`vitest run` 针对 conversation-context、conversation-outbox、codex-conversation、native-conversation、claude-conversation 和 conversation-file-changes 共 47 项单元测试通过。Playwright 的 codex-conversation、conversation-context、conversation-file-changes 和 conversation-attachment-recovery 共 42 个不同用例经分轮复验通过，覆盖截图粘贴、拖入引用、附件失败恢复、排队/纠偏、历史差异反馈、Git 入口目录匹配及窄屏。冷启动首轮加载超时及旧控件定位/发送语义断言已单独复验。类型检查、改动组件 ESLint 与双语键校验通过。2026-11-02 附件控件重排后，conversation-composer-layout、conversation-context、conversation-attachment-recovery 共 7 个不同浏览器用例分轮通过，包含 380px 底部对齐、弹出菜单不改变输入框位置、文件选择、引用焦点、粘贴／拖拽恢复及 Claude／OpenCode 工作中立即入队。布局用例首轮点击输入框中心被弹层遮挡，修正为点击弹层外的输入区域后通过；主 Agent 查看了窄窗截图 artifacts/conversation-composer/context-menu-narrow.png。类型检查与组件 ESLint 通过。以上为协议和浏览器夹具证据，未验证真实供应商模型读取附件或采纳纠偏的效果。

## Intent

轮次结束后，回答下方保留独立的文件变更汇总，不受工作过程折叠影响。汇总仅取该轮已完成的 `fileChange` 事件，同一路径合并一个入口。展开汇总先显示默认折叠的文件名和增删数，点击或按 Enter 展开某个文件后才显示该文件按事件顺序保留的补丁及“打开文件”入口；各文件独立折叠，快照更新或收起再展开汇总不重置已有文件的展开状态。统一 diff 的增删数按各次补丁累计，不代表工作区净差异；无法解析或截断时隐藏不可靠计数，无编辑记录不生成空卡片。失败轮次中已完成的编辑仍可回看，失败或待批准的编辑不计入已修改文件。历史卡片随会话快照显示，不读取当前 Git diff 冒充历史；快照截断时注明记录不完整。实现入口为 `ConversationFileChanges` 与 `conversationFileChanges`，不改变终端浮岛。

用户希望保留 JanusX 的原生终端体验，同时提供现代 Agent 对话界面，展示流式回答、工作过程、工具调用、文件修改和产物。用户已明确：不需要并排；同一会话在同一内容区域随时切换“终端／对话”，任一时刻只显示一种。两种模式在产品中共存，不要求同时显示。用户在完成技术探针后授权实施；已接入 Codex 和 Claude 的最小实验版本。本篇保留跨引擎目标方案，“Claude 当前实现”与“P1 当前实现”界定实际交付范围；未建立执行 Task。

建议采用“会话拥有运行实例，视图订阅会话”的设计。会话标题条只提供“终端／对话”二选一，同一会话只有一个执行所有者，切换展示不启动第二个 Agent。对话与终端共用一个工作区 pane，不做阻塞整个应用的模态弹窗，也不创建第二个会话标签。

完整目标是：用户在终端发送请求，执行中切到对话查看过程和结果，再在对话继续提问，随后切回终端仍是同一会话。显示切换与输入适配需要分别实现；只读历史切换只是过渡能力，不能算完成上述目标。原生 CLI 没有结构化控制能力时必须标明限制，不能用“把终端文字套进气泡”承诺双向交互。

## 研究范围与证据

2026-10-30 读取以下固定版本的公开源码与 README，结论来自静态分析，未安装或运行上游应用，未验证真实模型调用与跨端恢复。完整 clone／压缩包下载未完成，实际证据来自 GitHub 目录 API 与固定提交的原始源码；不能据此宣称审查过整个仓库。

| 对象 | 分析基线 | 主要职责 |
| --- | --- | --- |
| [Codeg](https://github.com/spacering-net/codeg/tree/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5) | `ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5` | Tauri/Rust 宿主、多 Agent 适配、React 对话工作台 |
| [ZCode](https://github.com/zai-org/ZCode/tree/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1) | `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` | 自有 Agent/CLI/TUI、共享协议、Electron/Web 与共享 React UI |
| JanusX | `4f1ed94250abd57ceb766f2616f2381fb069a4f2` | 当前 checkout 的终端、会话记录、内置 Chat、pane 和文件预览 |

上游根许可证均为 Apache-2.0；本次学习架构并原创记录设计，没有复制上游实现。以后若复用代码或素材，应针对实际文件保留适用的版权、许可证与 NOTICE。它们不是既有 [MIT-only ADE 调研](../desktop/desktop-ade-mit-survey.md)的 MIT 条目；本篇是用户指定的独立调研，不改写旧调研的选型范围。

本机没有可用的共享 wiki reader，本次按模块及明确依赖读取原始 Notes，并以有界路径检索核对源码。新方案不依赖旧调研中未核实的外部 wiki 路径或旧市场统计。

## Codeg：把多种 Agent 转成统一交互

Codeg 的重点是 Agent 协议适配，而不是把既有终端屏幕翻译成聊天。其 [agent_process.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/agent_process.rs)启动外部 ACP 子进程并通过 stdio 通信；[connection.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/connection.rs)处理初始化、会话加载、prompt、取消、工具、文件系统与权限请求。适配器和各提供方差异仍然存在，ACP 并不使所有功能天然等价。

它的对话模型分开处理已持久化、乐观提交和流式中的轮次。[conversation-runtime-store.ts](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/stores/conversation-runtime-store.ts)按 conversation 分区订阅，避免一个会话的 token 刷新全部 UI；后台转录补充记录带 watermark，持久化读取追上同一转录的字节位置后才移除临时覆盖。已经落盘不等于执行完成，旁观端仍须依据 in-flight 状态展示运行中。

[event_stream.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/event_stream.rs)给事件添加序号，采用有界近期事件缓冲。订阅在同一状态锁下取得快照、水位和 receiver，避免快照与增量之间漏事件；游标超出缓冲范围或存在缺口时回退快照。这里最值得学习的是恢复语义，JanusX 不需要照抄 Rust 实现或缓冲参数。

UI 将“回答”和“工作过程”组合为同一条阅读流。[content-parts-renderer.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/message/content-parts-renderer.tsx)把工具过程交给 ActivityTimeline，再在相应位置绘制说明、计划、图片、错误和专属结果卡；工具不是统一的 JSON 大框。[edit-row.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/message/activity/rows/edit-row.tsx)默认折叠文件修改，保留路径和真实增删统计，失败或等待时展开；大 diff 有独立预览上限。

[conversation-shell.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/chat/conversation-shell.tsx)组合输入、状态条、问题与计划审批等区域。[permission-dialog.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/chat/permission-dialog.tsx)保留提供方的 requestId、optionId 和授权范围，显示待处理队列数量；前端不能自行把所有选项简化为永久允许。

产物展示同时支持显式引用和文件路径发现：明确的 visualize／preview 引用原位展示，一般 HTML 引用在回答停止流式后显示按需预览入口。这适合作为补充发现，但“提到某路径”不能证明文件确实由该轮生成。

**对 JanusX 的启发：**引入能力驱动的 Agent 适配边界、紧凑工具活动行、稳定调用身份、流式到历史的无重复交接。不要复制其整套 Tauri 后端，也不要把“ACP 对话 + 工具终端”理解为外部原生 TUI 的双向镜像。

### Claude 专项：Codeg 如何实现，哪些能力不能直接推定

用户要求先学习 Codeg 的 Claude 实现，再决定 JanusX 接入路线。本次继续核对上述固定提交，并下载其实际固定的 [Claude ACP 0.99.1 发布包](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp/v/0.99.1)做静态分析，没有安装到项目依赖、启动 Codeg 或调用真实供应商。发布元数据的 gitHead 为 `0f78dbbdd089e5c64fc908173e8656aa9cc757fb`，依赖官方 `@anthropic-ai/claude-agent-sdk@0.3.312` 和 ACP SDK 2.1.0，要求 Node >=22。证据缓存在忽略目录 `artifacts/codeg-research/`，可由固定提交与 npm 版本重新获取。

调用链为：Codeg React 对话 → Rust ACP client → stdio 子进程 `claude-agent-acp` → 官方 Claude Agent SDK `query()` → SDK 管理的 Claude Code 子进程。它没有从 xterm 屏幕提取聊天正文。[registry.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/registry.rs#L364)明确区分原生 `claude` 与第三方 ACP 适配器，并记录共用 `~/.claude` 配置/凭据；同文件 L2958 固定适配器版本。[agent_process.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/agent_process.rs#L433)将三个标准流设为 pipe，用于协议传输。

| 能力 | 实际机制 | JanusX 可借鉴部分 |
| --- | --- | --- |
| 流式正文与公开思考 | 发布包 `dist/acp-agent.js` L9061 开启 `includePartialMessages`；L10612 将 text_delta 映射到 agent_message_chunk，L10636 仅将实际非空 thinking 映射到 agent_thought_chunk | adapter 归一化内容，公共 UI 增量显示；不补造未返回的推理文本 |
| 工具、文件与输出 | tool_use/tool_result 以调用身份映射 tool_call/tool_call_update；renderer 保留结构化状态、diff 和 terminal 输出元数据 | 用稳定 callId 更新活动卡，文件进入现有 viewer，不将所有结果塞进正文 |
| 权限与提问 | `canUseTool` 转为 ACP permission/elicitation；Codeg 的 connection 保留 optionId、允许一次/持久范围及拒绝语义，UI 回传选择 | 扩展通用审批契约，不能拿当前 Codex accept/decline 二选一直接覆盖 Claude 所有交互 |
| 模型、参数与指令 | ACP 会话配置/可用指令更新，适配器调用 SDK 的真实控制方法（如 setModel） | UI 复用，选项从 adapter 提供；Claude 不继承 Codex 六档 effort 或全部原生命令 |
| 历史与继续 | `loadSession` 回放转录，缺少内存 session 时建立 SDK 会话；恢复可传原 sessionId | 保留历史上下文，但恢复不证明仍使用原来的操作系统进程 |
| 命令终端 | Codeg `terminal_runtime.rs::create_terminal` 按请求另建命令子进程；适配器也提供命令执行结果的 terminal 展示信息 | 工具运行区可复用；这不是原生 Claude TUI 的 attach 通道 |

适配器发布包 `dist/index.js` L9–43 的 `--cli` 分支确实能启动原生 Claude，使用继承 stdio；但它与后面的 `serveAcp` 分支互斥，不提供一个进程同时服务 ACP 和原生 TUI 的证据。因此，“有 CLI 入口”“共用登录”“按 sessionId 恢复”均不能证明原生终端与对话能在同一执行实例任意切换。当前核对的 Codeg 路径解决了完整的 Claude 对话交互，尚未找到它解决 JanusX 所要求的原生 TUI 同实例切换的源码证据。

ACP adapter 是 Claude 完整结构化对话的一条候选路线，复用公共 UI，但不能据此承诺原生 TUI 同实例切换。用户进一步要求实际测试原生切换，下面记录本机原生 daemon 路线的新证据；不把只读版、另起 SDK 进程或伪终端作为同实例验收替代。

### Claude 原生 daemon 基线：同实例基础可行，该通道缺少结构化流式

2026-10-30T17:42:17Z 完成本地 Windows ConPTY 探针，CLI 为 `2.1.314`，原生二进制 SHA-256 为 `66e00df32e6981f686a91f67287fcc86e6e1b80ba4973a7b7c4aa43c59986cfa`。可重复执行 `node scripts/claude-dual-mode/probe.mjs`，说明在 `scripts/claude-dual-mode/README.md`。探针使用临时 home/config/workspace、假 key、localhost Messages SSE，显式 manual 权限模式且禁用全部工具；不复制用户凭据、不调用真实模型、不安装系统服务。本轮只新增探针和文档，没有接入产品 Claude adapter。

该基线的结论是：**原生后台执行实例与另一输入界面的往返可行；daemon subscribe 本身不提供结构化流式正文。** 后续 2.1.316 Mods 探针已找到另一条公开结构化事件来源，见下一节；不能再把 daemon 通道的限制推广为原生 CLI 整体的限制。后台往返来自 Claude 自己的 daemon，而不是 Codeg 的 ACP 适配器。

| 验证项 | 实测结果 | 含义 |
| --- | --- | --- |
| 普通原生 TUI + stream-json | ConPTY 下返回 `--input-format=stream-json requires --print` | 不能给现有 TUI 直接加 SDK 流式输出参数 |
| 本地 SDK URL / attach-serve | localhost SDK URL 被原生端拒绝；本地 UUID 被拒绝，cse_ 形式也要求启用 headless cloud client | 这些入口不是已验证的本地原生 attach；未测试真实账号的 Remote Control/cloud |
| SDK 基线 | 真 CLI 返回 7 个 stream_event 且 result 成功 | 本地模型和结构化流式夹具本身可用，后续缺口不是夹具不能输出 token |
| 同 sessionId 另起 SDK | 新 SDK PID 读取原生历史，但原生进程第三轮请求缺少 SDK 第二轮输入 | sessionId 相同不等于共享内存执行状态；此方案不能用于同步双模式 |
| 原生 `--bg` | 未完成信任时明确拒绝；接受本测试目录的原生信任后成功创建后台 session | 不能把初次信任前的报错当作后台模式不可用 |
| attach → 语义输入 → attach 输入 | daemon 的认证 `reply(nextTurn:true)` 进入同一原生会话；原生第三轮实际模型请求包含语义第二轮 | 同实例基本双向输入通过，没有为对话启动第二个推理进程 |
| Ctrl+Z 脱离 → 语义输入 → 重新 attach | 脱离后仍能执行，重连后原生 TUI 显示该轮；执行 PID 与 sessionId 均未变化 | 视图客户端可与原生执行生命周期分离，不必恢复或重启 Agent |
| daemon subscribe | 收到 snapshot/stream/state；stream.line 含原始 ANSI，没有 text_delta / stream_event | JSON 封装的终端字节不是富对话结构化事件，不用它解析聊天正文 |
| 转录中的流式正文 | 将同一回答的两个 SSE 增量间隔延长至 1600ms，期间轮询未见部分正文，完成后可读到完整正文 | 此版本和此场景下，转录可承接完成内容，不能据此宣称 token 级流式已解决 |
| 退出回收 | 停止本探针 daemon 成功，后台原生执行 PID 消失 | 未遗留测试后台执行实例 |

最后一次探针约 28 秒，退出码 0，报告状态 `completed-with-limitations`。后台执行 PID `46656`、sessionId `0a30eafb-caf2-4c5f-b6b2-7a1be4f7d12e` 在终端/语义输入往返和脱离/重连后保持不变；原生 attach 客户端本身可以更换。SDK resume 的反例使用存活的原生 PID `51244` 与另起 PID `48164`，实际请求确认上下文分歧。原始结果位于忽略目录 `artifacts/claude-dual-mode/probe-report.json`、`probe-runs.json`、`probe-requests.json`、`probe-background-events.json`；稳定的脚本与本篇结论保存在仓库，可重新生成证据。最终运行的退出回收无 ConPTY 警告；较早探针的强制终止曾触发 AttachConsole helper 警告，已改为原生退出/脱离后再回收。

`reply/subscribe` 属于 **2.1.314 的内部 daemon 协议，不是已承诺兼容的公开 SDK**。探针从自己临时目录读取 control key，使用 supervisor 控制通道，未直接占用 worker 的单连接 rendezvous socket；`nextTurn:true` 走语义排队，避免普通 reply 的 PTY 粘贴回退。本轮没有验证 requestId 去重、迟到命令、重复重试、输入草稿、停止、审批、文件编辑、模型/effort 切换、并行工具或长会话恢复；内部 `permission-response` 返回成功也不能证明真实审批已经实现。

该基线曾提出 `ClaudeNativeDaemonAdapter` 候选。后续公开 Mods bridge 解决了结构化事件来源，而两者组合又通过原生 Esc 后的语义恢复实测，当前接入候选见下文。既有普通前台 Claude 不自动迁移，启动仍需保留原生信任流程，不批量接受用户目录。不把 ANSI 文本变成气泡，也不把 ACP 与另一个原生进程的输出拼接成同一执行事实。

### Claude Mods 实测：同实例流式已通，任意状态切换仍有边界

2026-10-31 在 Windows 上运行实际 `2.1.316 (Claude Code)`，二进制 SHA-256 为 `e896a9d8da519353a49bf69ca4a695ba7e09067752687c675b3969041e632d52`。审查当前 daemon 分支后重跑旧基线，结果位于 `artifacts/claude-dual-mode/2.1.316/probe-report.json`：同实例往返仍通过，subscribe 仍只有 ANSI，另起 SDK 仍不能同步原生内存。supervisor 的 `permission-response` 仍只确认，不转发真实审批；`nextTurn:true` 跳过斜杠命令，不能据此推导设置或提问能力。

新的主要证据来自官方 [Mods](https://code.claude.com/docs/en/plugins/mods/overview.md)、[事件](https://code.claude.com/docs/en/plugins/mods/events.md)及 [API](https://code.claude.com/docs/en/plugins/mods/api.md)。原创 `scripts/claude-dual-mode/probe-plugin.js` 经 `--plugin-dir` 加载进普通原生 TUI；`mods-probe.mjs` 用隔离 home/config/workspace、假 key 和 localhost SSE 运行真实 CLI 与 Write/Bash 工具。流式观察使用 `turn.step` async generator，并原样传递所有 chunk 与返回值；没有解析终端正文、截取真实模型网络流或另起推理实例。构建实际生成的类型比公开仓库类型更新，按本机生成的声明核对 API。

**公开 Mods bridge 已证明同实例结构化流式及主要交互可行；后续 daemon + Mods 组合解决了测试中的 Esc 后语义恢复，TaskStop 解决了测试中的 Bash 残留。** 本节是产品实施前的探针证据，当前 adapter 与桌面验证见下一节；任意状态下的完整兼容矩阵仍未验收。

| 验证项 | 实测结果 | 产品含义 |
| --- | --- | --- |
| 原生 → 对话 → 原生 | 同一存活 PID/sessionId，第三轮实际模型请求包含前两轮输入；`prompt.submit({text, asUser:true})` 保留 plugin 来源 | 对话输入进入原生执行内存，无需第二个 SDK |
| 实时正文与工具 | 两个无换行文本增量间隔 1400ms，首段在回答完成前到达；工具 chunk.id 与 tool.call 的 tool_use_id 对应，真实 tool.call/check 可观察 | 原生 token 流来源已解决；多 block、子代理、恢复仍需验收 |
| 空会话与归属 | 空会话无模型调用；同 cwd 的 A/B 获得各自 terminalId/sessionId，模型历史不串线；关闭 A 后 B 可继续 | 普通 TUI 每会话启动注入可用；不是已有 daemon 的多 worker 环境验收 |
| 草稿与排队 | 原生未发送草稿在对话发送后保持；运行中提交在当前轮结束后执行一次 | 视图切换不应提交/清空草稿；提交回执与轮次完成应分开 |
| 对话取消 | `turn.abort({turnId})` 终止当前回答、保留进程，可继续插件发送；旧 turnId 被拒绝 | 取消要校验当前轮身份 |
| 原生 Esc | 后续插件发送返回 `{drop: 'the session was stopped and nobody has sent input since'}`，无模型请求；明确的原生新输入后恢复。后续 daemon + Mods 专项验证语义输入也可恢复，见下节 | 普通 TUI + Mods 单独仍受限；daemon 组合可接收显式用户发送，不能把 HTTP/调用成功显示为发送成功 |
| 真实写入审批 | HTTP PermissionRequest 的 allow 写入实际文件，deny 不写；原生审批界面可同时接受 Enter | Hook 可以完成基本审批；并发相同工具、问题、计划确认未验证 |
| 迟到审批 | 原生批准完成后，HTTP Hook 连接仍未关闭 | 不能用连接断开判断审批过期，需依执行事实关闭旧请求 |
| 取消与副作用 | 真 Bash 子进程在回答 aborted 后仍活着，随后完成延迟写文件；后续按原生 task_id 调用 TaskStop 的专项能停止它并阻止延迟文件 | 停止回答与停止工具需组合；归属映射和完成确认不可省略 |
| 模型设置 | config.set 接受 haiku 别名，之后对话与原生请求都变为 claude-haiku-5-5；临时 settings.json 持久化 model=haiku | 该 API 是持久默认值修改，不能包装成仅当前会话设置；完整模型 ID 被拒绝，effort 未验证 |
| 斜杠命令控制 | command.run 的 model 探针无原生键盘活动时超时，ui.invalidate 未解决 | 暂不暴露为可靠设置控制，不能把排队当生效 |

最终完整矩阵为 `artifacts/claude-dual-mode/2.1.316/mods-1793421659933/`；Esc 拒绝及恢复为 `mods-1793421623859/`，运行中排队为 `mods-1793421640895/`。各目录保留 report/events/requests/runs，均退出码 0、状态 `completed-with-limitations`，原生测试 PID 已回收。先前完整矩阵 `mods-1793421208032/` 与设置专项 `mods-1793421338750/` 留作对照。证据覆盖 Windows 真 CLI 加本地模型夹具，不是实际供应商、跨平台或 JanusX 桌面验收。运行方式与全部限制见 `scripts/claude-dual-mode/README.md`。

### Claude 当前实现

2026-10-31 接入 `src/main/terminal/claude-conversation.ts` 与原始 Mods 源码 `claude-mod.js`。新建本地 Claude 默认使用 AgentSessionPane 和 AgentComposer，以无提示词 `--bg` 创建一个原生 worker，终端通过真实 `attach` 接入，对话显式发送使用认证 daemon `reply(nextTurn:true)`，Mods 提供结构化正文、工具、取消及原生任务停止。启动不触发模型请求，切换不重建 worker。Windows 原生 2.1.316 精确门控；旧终端、恢复会话、远端和带自定义 extraArgs 的入口不迁移。第一次使用的原生登录与目录信任仍需先完成，可在普通 Shell 中运行 Claude 初始化；产品不代替用户确认信任。

主进程按 terminalId、原生 sessionId、daemon job/PID 和每会话随机 token 绑定事件流。插件与附加 settings 位于 userData 下的临时会话目录，保留既有启动 Hook，并将身份环境与 HTTP PermissionRequest Hook 注入当前 worker；不改用户全局 settings 或插件安装。关闭只执行自有 job 的 `claude stop <id>`，不停止共享 daemon；启动中关闭会等待在途 dispatch 后再清理。原生停止失败会报告未关闭并保留资产，不声称后台任务已退出。

历史恢复需要独立设计。`session.messages()` 最多返回最近 4096 行，缺少稳定消息 ID；`session.turns()` 是计数，不是逐轮账本。Mods turnId 与经典 MessageDisplay 的 turnId 不可直接等同，不能按正文相同去重。建议主进程保留带启动代次、seq、turnId、step 和 tool_use_id 的事件日志，在原生 JSONL 有可验证身份时做显式映射。断线、进程重启、compaction 与完整行游标都需验收；现有 `transcript-kernel.ts` 的正文搜索职责保持，不充当完整工具时间线。

产品 Bridge 在取消 Hook 之外定时发送有序批次，按 seq 确认与去重；传输失败只重发事件，不重发模型请求。缓冲上限 4000 事件／约 200 万字符，溢出、序号缺口或会话变更即关闭对话控制并提示使用终端。短暂失联可恢复同一事件流，进程重启与持久重放未实现。发送按 commandId 去重，除 daemon ack 外必须观察到新原生 turn；未知送达锁住再次发送，保留终端核查入口。显示最多 500 项，单项文本约 32000 字符；尚无长会话性能验收。

Write/Edit/Bash 的 HTTP 审批只在能唯一关联当前工具时展示“允许一次／拒绝”；AskUserQuestion 已接入[对话内问答](#对话内审批选项和文字回答)，并发歧义及计划模式确认仍交还原生终端。原生批准或工具结束会使旧审批失效。模型与强度已接入公共选择器和 `/model`、`/effort` 预览，修改当前会话后续主对话请求；其它未适配指令仍提示去终端。设置只在空闲时提交，等待原生事件更新显示；提交期间阻止新发送及终端输入，失败保留原选择，超时标记结果未知并关闭对话控制。

#### Claude 执行过程摘要与阶段回复

Claude 的工作过程保持默认折叠，折叠外增加当前工具及目标的单行摘要，例如 `Read · src/main.ts`、`Bash · Run tests`。摘要来自原生工具名称和明确的描述、路径、搜索词或命令字段，压缩空白并限制为 240 字符，独立于持续增长的工具输出；不复制完整参数或子代理 prompt。优先显示组内仍运行的最近活动，并从本地接收时间计时；全部结束后保留最后一项摘要，撤下计时。用户展开选择保持，失败、审批、中断等提示仍使用原有状态统计。老快照及未提供摘要的其它引擎沿用原展示。

正文按原生 turn／step／block 身份追加，在工具分组外直接显示；后续正文自然中断连续工具分组。Mods 仅在步骤生成器返回非空 `stopReason` 时发出 `step.complete`，主进程完成该步骤的正文，不等待整个 turn。真实 2.1.317 的取消会让生成器正常返回但 `stopReason:null`，因此不能把 `done:true` 单独作为正文完成证据；未完成段留给 `turn.complete` 标为中断或失败，早先完成段保持完成。首版不改模型交流指令、不额外生成过程说明；Agent 工具可展示父调用描述，子代理内部事件与公开 thinking 尚未接入。

2026-11-04（北京时间），定向 Vitest 五个文件共 43 项通过：claude-conversation、claude-mod-plans、claude-task-completion、conversation-output、conversation-turns。`npm run typecheck`、相关实现 ESLint 通过。Windows Claude Code 2.1.317 的原生专项 `npx vitest run tests/unit/claude-conversation-cli.test.ts -t 'streams interleaved commentary' --maxWorkers=1` 通过（设置 `JANUSX_TEST_CLAUDE_BIN` 指向该版本）；使用隔离配置、假 key 与 localhost 模型，确认三段正文各自在结束前流式到达、两次真实 Read 的顺序及目标投影、阶段结束状态、取消半段与同 session 后续恢复。新增取消断言曾暴露误标完成，按上述 stopReason 约束修复后复测通过。原始快照保存在忽略目录 `artifacts/claude-progress/native.json`。

浏览器运行 `npx playwright test tests/e2e/claude-progress.spec.ts tests/e2e/conversation-work-disclosure.spec.ts --project=island --workers=1`，设置 `JANUSX_TEST_CLAUDE_PROGRESS=artifacts/claude-progress/native.json`，共 13 项通过，包含真实原生快照回放、深浅主题、380px 窄窗、摘要切换与计时停止、正文交错、展开选择及五引擎折叠回归。主 Agent 检查 `activity-dark.png`／`activity-light.png` 截图，长目标省略、计时不挤出容器。原生进程与浏览器回放分开验证，不等同于真实供应商或打包 Electron 端到端验收；其它原生 CLI 集成用例本轮未运行，不把专项结果推广为完整版本兼容矩阵。

#### Claude 会话模型与强度

模型目录来自独立原生 `--print --input-format stream-json --output-format stream-json` 进程的 initialize 控制响应，不发送提示词，不创建第二个执行会话。`claude-models.ts` 读取 resolvedModel、displayName、disabled、supportsEffort 和 supportedEffortLevels，仅提供原生声明的能力，不复制 Codex 的 ultra。辅助进程使用同一 provider 环境和附加 settings，另设 disableAllHooks、空 tools、strict MCP 与 no-session-persistence，防止目录探测重复触发用户生命周期 Hook；响应后退出，超时或关闭会话时取消。未知／自定义当前模型仍显示原值，不猜测其强度能力；目录失败可重试。

`config.set(model)` 与原生 `/model`、`/effort` 会保存默认值，因此产品使用公开 Mods `turn.step` 改写主对话 model/effort，并通过 `$.env.set` 设置当前 worker 的 CLAUDE_CODE_EFFORT_LEVEL。只改 turn.step 时，若所选 effort 等于输入事件的值，原生可能把它视为未改动并退回新模型默认；worker 局部环境补足这一边界。空 effort 恢复启动时的环境并沿用原生推导，不承诺各模型固定默认强度。设置变更不产生模型请求、不重启 worker、不改用户 settings；主对话的终端输入同样使用所选值。模型锁定及 settings 各层的 maxEffortLevel／modelSettings 上限在应用前检查，原生仍拥有最终策略约束。

原生默认模型页脚不因 turn.step 改写而同步；终端 AbovePrompt 增加 `JanusX session` 行显示会话覆盖值。用户执行原生 `/model`、`/effort` 或 `/config` 时，恢复原有 effort 环境并撤销覆盖，将控制交回原生；其命令本身仍可能保存默认值。原生设置确认未结束时，对话提示回终端并禁止新发送。代价是保留两种设置语义，不能把原生默认标签宣称为当前请求模型。

验证探针为 `node scripts/claude-dual-mode/mods-probe.mjs --hybrid-settings --hybrid-empty --env-effort`，首次证据在 `artifacts/claude-dual-mode/2.1.316/mods-1793451370717/`，补强逐项 effort 断言后的复验为 `mods-1793452562246/`。Haiku/low、Sonnet/high、Opus/max、重复切换和原生输入均核对实际请求；`mods-1793451370722/` 的 `--flag-settings` 负对照证实运行中改附加 settings 文件不生效。动态目录证据为版本目录下的 `settings-catalog.json`。产品真实 CLI 回归进一步断言三组模型／强度传值、零额外请求、用户 settings 不变、原生命令接管和另一个 worker 的 high 上限拒绝 max。

该路径按 Windows 2.1.316 验证。模型目录不保证真实账户有调用权限，复杂第三方别名／策略组合未全覆盖；局部 env 会被后续子进程继承，虽然 turn.step 的模型改写排除子代理，仍不能承诺子代理强度完全不受影响。子代理、真实 provider 与长期资源测试是后续验证项；原生版本改变必须复验目录协议、Mods 行为和 env 优先级。

#### 停止与产品验证

停止先阻止该轮新增工具、取消回答，再等待所选工具的结构化结果，用原 tool_use_id 找 backgroundTaskId 并执行 TaskStop。真实集成发现 abort 返回早于 Bash 后台化结果，现有界等待结果到达，缺失或停止失败保留未知状态。停止范围为当前轮；空闲时选仍有活动任务的最近轮，避免结束无关旧服务。后台自然完成从原生 `prompt.submit` 的 `origin.kind=task-notification` 读取固定版本的 task-notification 信封，仅接受任务 ID 和 completed／failed／killed 状态；普通用户输入不参与解析。公开 `UserMessage.task` 保留为补充来源，两条路径去重，完成通知早于工具结果也不会恢复活动状态。原生 meta prompt 不当成用户气泡。

已知结束的任务跳过 TaskStop；停止时原生返回或抛出与所选 ID 完全匹配的 `No task found with ID`，视为任务已不在原生注册表中，按 missing 收尾，而非宣称成功杀死进程或正常执行完成。对话工具项暂显 interrupted，后续明确完成通知可以补正结果。权限拒绝、其它 ID 的错误和未知终止仍报错；逐个发布已确认的停止结果，避免后续任务失败使前面的成功丢失。控制器回执保留 completed／failed 结果，不统一覆盖为 interrupted。停止不回滚已完成写入，子代理、任意进程树和远端停止仍不在当前保证范围。前端在接受新消息及重绑终端时清除旧的本地操作错误；连接错误仍由当前快照展示。Tab 的 Hook 状态与对话工作状态仍各自投影，真实后台任务保留停止入口，不用 Tab 空闲直接清空任务。

2026-11-02 修复验证：`npx vitest run tests/unit/claude-task-completion.test.ts tests/unit/claude-conversation.test.ts tests/unit/claude-mod-plans.test.ts` 共 27 项通过，覆盖无 UI 通知、乱序、重复、任务消失、真实拒绝、部分停止及后续轮隔离。设置 `JANUSX_TEST_CLAUDE_BIN` 为本机固定 2.1.316 二进制后，`npx vitest run tests/unit/claude-conversation-cli.test.ts -t 'settles real background'` 通过：隔离配置与 localhost 模型夹具中，worker 无 attach 完成真实后台 Bash，另验证前台 Bash 经中断转后台后被实际停止，子进程退出且超过写入期限仍无副作用文件，随后在同一 session 继续下一轮（33.9 秒）。原始专项快照位于忽略目录 `artifacts/claude-completion-fix/native.json`。完整 CLI 旧用例两次停在连续输入 `CC_LIVE_FIRST／CC_LIVE_SECOND` 回显断言，未执行后续矩阵，不能据此宣称完整集成通过；专项初次因登录后的 setup TUI 未退出而失败，改为关闭自有 setup 进程后通过。浏览器 `codex-conversation.spec.ts` 与 `claude-completion-recovery.spec.ts` 共 37 项通过，覆盖新发送清除旧中断错误、后台结束撤下 thinking／停止按钮和恢复发送。类型检查与实现文件 ESLint 通过；Notes 校验 321 篇、0 errors、17 条既有外部链接诊断。以上不包含生产供应商请求或已打包 Electron 验证。

验证使用临时 home/config/workspace、假 key 与 localhost Messages SSE，不调用用户供应商账户。`JANUSX_TEST_CLAUDE_BIN` 指向上述原生二进制后，`npx vitest run tests/unit/claude-conversation-cli.test.ts --maxWorkers=1` 通过：空启动零请求、真实流式、终端与对话往返、重复发送去重、原生 Esc 后恢复、Write 允许/拒绝、原生 Enter 批准后旧审批失效、Bash 子进程停止且超过 9 秒写入期限仍无文件、后台自然完成，以及共享 daemon 中关闭一个 worker 后另一个仍可发送且上下文隔离。证据为 `artifacts/claude-dual-mode/managed-last.json`。

`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 九项通过（24.5s），覆盖 Claude 原生能力筛选、模型／强度选择、不提供 ultra、运行中设置禁用、后台停止与原 Codex 交互回归。`npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-claude-conversation.spec.ts` 最新真实 Electron 一项通过（52.5s），走实际启动开关、preload/IPC/PTY、原生信任和三轮同 session 切换。界面选择 Sonnet/high 后，对话第二轮、终端第三轮的实际请求均带所选模型与强度；选择操作无额外模型请求。测试明确等待原生假 key 确认落盘和异步设置提交完成。主 Agent 已查看 `artifacts/claude-dual-mode/desktop-model-picker.png` 与 `desktop-effort.png`。后续重点是私有 daemon 协议升级兼容、真实供应商、复杂并发工具/审批、compaction、长期运行及持久恢复；本次不宣称这些已完成。

定向回归为 `npx vitest run tests/unit/claude-conversation-cli.test.ts tests/unit/claude-conversation.test.ts tests/unit/codex-conversation.test.ts tests/unit/terminal-launch.test.ts tests/unit/terminal-officecli-path.test.ts --maxWorkers=1`，显式设置原生二进制后 30 项通过，其中真实 CLI 一项为 72.2s。包含设置权威事件、失败保留、更新中发送阻断、原生确认等待、启动中关闭、原生停止失败不报已关闭、事件去重、未知发送锁定与旧轮后台任务停止；后补原生确认门控断言的 Claude 八项单测单独通过。严格 unused 类型检查、相关源码 ESLint、双语键校验与 `npm run build:app` 通过；Notes 为 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，无独立子 Agent 审阅。

### 原生停止与工具停止：候选方案的运行验证

2026-10-31 用户授权继续验证后，新增三个隔离专项并实测通过，CLI 仍为上述 2.1.316 二进制。命令为 `node scripts/claude-dual-mode/mods-probe.mjs` 加 `--hybrid-only`、`--stop-tool-only` 或 `--stop-foreground-only`。全部为原生 CLI、原生工具及 localhost 模型，未接入 JanusX 产品 UI。

**Esc 后的语义恢复通过。**临时原生会话完成目录信任后退出，后台新建 worker 加载同一个探针插件并接受真实 attach。原生输入运行中按 Esc，Mods 直接发送仍返回 drop 且没有模型请求；随后通过认证 daemon `reply(nextTurn:true)` 提交一次恢复消息，原生执行接收且 Mods 在响应完成前收到两段文本。继续插件发送及终端发送均通过，末轮模型上下文包含此前各轮。worker PID `2160`、sessionId `97b39500-d46d-4de0-af36-b0922781332c` 全程不变；恢复消息没有经 PTY 输入，daemon ack 之外还有模型请求与 Mods turn/chunk 证据。报告为 `artifacts/claude-dual-mode/2.1.316/mods-1793423446150/`。初次探针过早断言 listing 必须已有 PID 而失败；初始 job 已有 sessionId 但 worker 尚未就绪，改为等 Mods 启动轮后再核验，未改动原生逻辑。

**后台与取消转后台的 Bash 均能停止。**显式后台 Bash 的结果直接提供 backgroundTaskId；取消前台 Bash 时，实时 tool.complete 可能缺失，经典 Stop Hook 本场景也未出现，但 `session.messages()` 的 toolUses 按原 tool_use_id 返回结构化 `result.backgroundTaskId`，并有 `backgroundedByTurnAbort:true`。这揭示了之前的残留是被原生转到后台，可通过公开工具入口控制。调用 `$.tool.call({tool:'TaskStop', task_id})` 后，实际 Node 子进程退出；等待超过启动后的 14 秒写入期限，目标文件仍不存在，原生会话可继续发送。后台专项报告 `mods-1793423359932/`；前台转后台最终报告 `mods-1793423494225/`，子进程 PID `48096`，任务 `b177y702r`，原生会话 `1db12e11-ba99-41c0-83d3-7ec44c04f128`。初次前台探针只从 live completion 读取 ID 而失败；检查公开历史发现稳定的 tool_use_id 关联，修正读取路径后通过，没有解析终端文本或猜测 PID 对应的任务 ID。操作系统兜底清理在上述断言后才执行，不用于制造停止成功。

产品应建立 turnId/tool_use_id → native task_id 映射，停止时阻止该轮新增执行、取消回答、停止属于该轮的任务，再确认终态；不能停止其它会话或用户明确保留的长期服务。TaskStop 两项只覆盖单个本地 Bash 子进程，不保证任意进程树、并行工具、子代理或远端任务；任务结果迟到、历史截断、重复停止和完成竞态还需测试。若原生停止超时，保持“仍有任务运行”，提供单独的结束会话操作。自有进程树回收只能作为结束会话的兜底，不能冒充保留同实例的停止回答；停止也不会回滚已完成的写入或外部操作。

这两处已从“候选未验证”推进到“固定版本与场景下可行”。三个专项及原完整矩阵回归均退出码 0，回归报告为 `mods-1793423533458/`；记录的原生进程、daemon worker 及 TaskStop 子进程均已核实退出。daemon 私有协议仍需实际握手与响应校验，公开 Mods 直接发送的停止屏障没有被修改；必须保留显式用户发送与后台插件工作的区别，不自动重试旧请求、伪造来源或全局截获 Esc。后续已接入产品，当前实现及新增证据见上节。

## ZCode：把执行事实、传输和界面分层

ZCode 的 [README](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/README.md)明确区分 CLI/TUI、Web、Electron、services、shared 和 ui。统一 `zcode` 命令可以按参数进入 TUI 或 Web；这证明共享运行基础和多种入口，不证明两个进程可以同时无冲突地控制一个原生终端会话。

[rows.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/rows.ts)把显示内容定义为自包含行：turnHeader、userInput、assistantText、reasoning、toolCall、subagent、artifact 等。row 有稳定身份、轮次归属、状态和可用动作；文本增长用 delta，结构变化用整行更新。轮次边界和真实耗时由运行侧给出，UI 不从文字或时间间隔猜测。

[transport.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/transport.ts)定义握手、能力与带 `logEpoch + seq` 的订阅基线；[apply.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/apply.ts)给出 delta 的纯归约语义。[command.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/command.ts)包含 commandId、部分操作的 revision/epoch 校验，以及 accepted/rejected/stale/duplicate/noop/failed 回执；accepted 本身不承诺跨 CLI 进程存活。这比“点击发送后立即显示成功”严谨。

[agentConversationTransport.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/agentConversationTransport.ts)以 transport 接口连接宿主服务，使 UI 数据层不绑定 Electron；[WorkbenchPane.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/WorkbenchPane.tsx)负责 pane 焦点、会话绑定和恢复校验。视图位置与会话身份分离，适合 JanusX 现有分屏树。

[ConversationTimeline.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationTimeline.tsx)使用虚拟滚动、历史分页、阅读锚点与滚动记忆；[ConversationRowView.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationRowView.tsx)按类型分派渲染。这里的价值是长会话可持续阅读，而非无限追加 DOM。

[ConversationFileSummaryPanel.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationFileSummaryPanel.tsx)从轮次聚合值按需读取文件明细，打开 patch，并把文件撤回预览作为独立动作。[conversation-preview-artifacts.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/conversation-preview-artifacts.ts)识别 Markdown、HTML、Office、PDF 和音视频引用；Markdown/HTML 候选还结合文件变化，而非仅看扩展名。

[SidePaneTerminalPane.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/SidePaneTerminalPane.tsx)通过稳定 persistentKey 管理 xterm/PTY，组件卸载只 detach，workspace 关闭才按归属回收。这个终端是独立 shell 能力；不能仅凭它的存在宣称 Agent 对话与原生 TUI 使用同一个执行实例。

**对 JanusX 的启发：**稳定的显示实体、明确命令回执、可恢复订阅、pane 与运行生命周期分离、文件摘要与重型预览分层。无需为了双模式迁移整个 monorepo 或同步建设 Web/mobile。

## JanusX 已有基础与真正缺口

“纯终端”准确描述外部 CLI 的主要工作入口；整个应用已经有内置结构化 Chat。应复用这些能力，而不是另造一套聊天系统。

| 已有基础 | 核对入口 | 融合方式与限制 |
| --- | --- | --- |
| node-pty、xterm、PTY IPC 与状态 | `src/main/terminal/manager.ts`、`src/shared/ipc/terminal.ts`、`TerminalArea.tsx` | 保留原生 TUI、输入与重放；PTY 字节和 seq 不等于语义事件与轮次 |
| pane 树与跨 pane 布局 | `src/renderer/src/lib/workspace-pane.ts`、`stores/workspace.ts` | 在一个会话宿主中保存 displayMode 并切换内容；现有终端 Tab 关闭会走 kill，切换模式不能复用关闭逻辑 |
| Chat 有序时间线 | `src/shared/chat-timeline.ts`、`components/janus/ChatTimeline.tsx`、`useJanusChat.ts` | 已有文本/公开推理/工具、callId、终态收敛、容量约束；可共享 renderer 和 reducer，不直接给所有外部 CLI 套用内置 Chat controller |
| 会话注册与转录 | `src/main/sessions/session-registry.ts`、`transcript-kernel.ts`、`transcript-reader.ts` | 延用身份与读取来源；当前内核有意排除 thinking/tool 内容，现有正文接口不能承载完整工作时间线 |
| 外部 CLI Hook 能力表 | `src/main/notifications/agent-engine-capabilities.ts` | 是状态/历史来源表，不是结构化发送、取消、审批或实时 token 能力保证 |
| 本轮文件变化 | `src/main/terminal/turn-change-tracker.ts`、`stores/turn-changes.ts` | 共享同一变化记录；tracker 的 turnId 不应假定等于 recorder/provider turnId，需要明确映射 |
| 文件与产物查看 | `FileViewerContent.tsx`、`viewers/MonacoViewer.tsx`、`HtmlViewer.tsx`、`office/OfficeFileViewer.tsx` | 继续走现有文件窗口和类型分发，不复活已删除的独立产物工作区 |
| Agent 执行与审批 | `src/main/llm/chat-orchestrator.ts`、`src/main/harness/execution-adapter.ts` | 继续使用 Janus/agentX 契约；普通对话不强制创建 WorkflowX Task |

已有 [Chat 工作时间线](../agent/requirements/chat-work-timeline.md)维护流式顺序、公开推理、工具结果与恢复边界；[引擎能力](../sessions/records/session-engine-capabilities.md)维护各 CLI 的实际历史/恢复差异。Pi 的实时身份绑定、Janus CLI 原生恢复映射和 DSH 会话信号不能被本方案当成已解决。

[终端原生滚动](../terminal/terminal-scrollback-navigation.md)曾明确移除会话阅读面板。本次新请求允许重新设计 Agent 对话入口，但不撤销原生滚动、全屏 TUI 和快捷翻页约定。新入口是独立会话视图，不占用原滚动按钮或伪造终端历史轨道。

[统一文件窗口](./unified-file-window.md)包含已确认方向与分项实施状态；本方案遵循它的单一打开路由，不宣称所有跨宿主能力已完成。与 [长会话性能](./long-session-performance.md)共用预算与测试原则。

## 双模式的产品契约

### 运行方式与显示方式分开

| 会话运行方式 | 终端显示 | 对话显示 | 切换后交互的边界 |
| --- | --- | --- | --- |
| 原生 CLI + PTY | 原生 TUI，完整保留 | 从明确绑定的 Hook/原生转录投影；标记“实时”“轮后同步”或“记录不完整” | 初期终端独占输入，对话只读；有正式可验证控制协议后再开放 |
| Janus 或结构化协议托管 Agent | 工具命令输出、关联 shell；只有真实 TUI attach 能力才显示“Agent 终端” | 完整流式、工具、审批和输入 | 对话控制执行；关联 shell 是另一进程，不能当成同一 Agent 输入端 |
| 明确支持同实例多前端的运行时 | 真实 attach 的 TUI | 同实例事件投影 | 新建本地 Codex 双模式已实现当前可见视图取得输入控制权；不以版本号拦截启动，历史实际验收版本为 0.166.0 |

创建时选择 Agent 和默认显示模式，之后在同一会话内切换。支持的会话可以在空闲、输出中、执行工具、等待审批、完成或失败时切换，无需等当前轮结束。若当前引擎没有可用正文源，解释暂不支持，而不是显示看似完整的空对话；只有只读投影时标注“对话只读”，不能标为完整双向切换。

协议托管会话没有真实 TUI 时，不提供冒充原生 Agent 终端的切换项；关联“命令终端”保留为独立工具入口，不计入双模式验收。若用户需要换运行方式，使用显式“在新会话中继续”，标明是原生 resume、分支还是摘要交接；这不是显示切换，不能静默启动第二个同 provider session 写入者。

### 随时切换的具体语义

显示状态只有 `terminal` 和 `conversation`，保存在会话级，与 executionId、连接状态和执行状态分离。切换只变更显示状态，不创建、resume、取消或重发运行。当前可见视图负责键盘输入；隐藏视图保持必要的数据状态，不接收快捷键或自动抢焦点。

| 切换时机 | 应有行为 |
| --- | --- |
| 正在流式输出或执行工具 | Agent 继续运行；目标视图先读取当前快照，再接连续增量，不从头播放或重复执行 |
| 等待审批或用户回答 | 待处理请求保留；支持协议时在当前界面处理同一 requestId，否则给出“切回终端处理”入口；不擅自批准或取消 |
| 已有未发送输入 | 两种视图各自保留原草稿；只有宿主统一管理输入时才共享草稿，原生 TUI 草稿不可读取时不承诺自动迁移 |
| 正在阅读历史 | 分别保存终端滚动位置与对话阅读锚点，回来恢复原位置；新输出通过提示到达，不强制跳到底部 |
| 快速连续切换 | 只落实最后一次显示意图；旧挂载回调和焦点恢复失效；输入交接期间短暂禁用发送，不重复提交 |
| 目标数据未就绪或读取失败 | 目标显示同步中/明确错误并可立即切回；原运行继续，不能为修复显示而重启 Agent |

对 Janus 自有运行时，完整双向切换可通过共享 session controller、结构化事件，以及可重附着的终端前端实现。当前桌面 Chat 和 Janus CLI 仍不能直接视为同一个实例；这一运行时接缝需在 janus-agentX 验证或建设。外部 Agent 只有在同实例控制和事件能力得到验证后，才声明支持完整切换。若使用自有终端 renderer 呈现协议事件，须明确这是 JanusX 终端界面，不冒充提供方原生 TUI。

### 布局与视觉

同一会话标题条展示名称、Agent、项目/worktree、运行状态，以及能力允许的“终端 / 对话”。左侧导航和 pane 标签只保留一条会话身份，切换时标题与状态位置固定，仅中央内容替换。移动整个会话 pane 不改变显示偏好、历史、草稿和运行身份。

两种模式均使用当前 pane 的完整可用区域。对话正文建议最大阅读宽度 800–900px；工具摘要使用紧凑行，详情按需展开。窄窗调整正文、输入和工具条，不新增分栏。切换动画只做短淡入或直接替换，遵循减少动态效果设置；恢复终端时按稳定后的实际尺寸 fit，避免隐藏期间错误 resize 破坏 TUI。

概念布局如下，尺寸仅用于讨论：

```text
项目 / 会话       会话 A · Agent · worktree       [终端 | 对话]
                 ┌───────────────────────────────────────────┐
                 │ 当前模式占用整个内容区域                  │
                 │ 终端：原生 TUI                            │
                 │ 或                                        │
                 │ 对话：请求 → 工作过程 → 回答 → 文件/产物  │
                 │       输入框 / 只读能力提示               │
                 └───────────────────────────────────────────┘
                 文件窗口按需打开，与显示模式独立
```

沿用 JanusX 的中性色、主题令牌、细分隔和标签选中语言。Agent 回答以可阅读正文为主，不把每段输出包成重色大气泡；用户输入可用轻底色形成边界。错误、审批和当前工作有语义强调，普通工具不抢正文层级。现有公开推理默认展开的规则保持，用户可折叠；没有公开内容就不补造。

产物卡只给缩略预览、类型、名称、来源轮次和打开动作。详细文件进入统一文件窗口，切换终端/对话不关闭文件预览或丢失编辑草稿。空间不足时按既有辅助面板规则收起，禁止抢焦点或覆盖未保存草稿。Island 继续作为状态/变更入口，不能另存一份结果数据。

### 输入、审批和生命周期

1. **原生终端优先。**第一阶段对话 composer 只显示草稿/控制状态，不自动向 PTY 发自然语言。用户在终端审批时，对话只提示“请在终端处理”，不把“允许”按钮映射成猜测的 y/Enter。
2. **结构化提交。**支持协议的会话由主进程 controller 接收 commandId、sessionId、executionId 和目标版本；区分排队、送达、运行中、失败。重复提交返回同一回执。连接中断后的未知提交先查询，不自动重发；PTY write 成功也不等于 Agent 接受。
3. **控制权切换。**完整支持的会话在用户切换模式时，由主进程原子地把输入控制权交给当前视图，不额外要求点击“接管”。带 generation 的控制租约拒绝隐藏视图的迟到输入；切换不提交任何草稿。原生 CLI 只能读取时，对话仍只读并提供切回入口，不伪造接管。普通 shell 独立输入不占 Agent 租约。
4. **运行中输入。**默认保存为可编辑的下一条草稿，只有已实现可靠队列时才提供排队；steer/中途补充必须由 adapter 单独声明。Enter/Shift+Enter 与 IME 遵循现有 composer，不能在中文候选确认时发送。
5. **审批与提问。**区分授权请求、用户问题、计划确认和终端等待。请求有独立 ID 与待处理状态，主进程原子消费；切换后读取最新处理结果。保留真实选项、对象和范围；超时或旧 generation 的按钮不可再生效。
6. **停止。**取消当前轮、停止工具子进程、终止 Agent 是不同动作。无法确认停止时显示“等待停止确认”；关闭视图不代表取消，停止也不回滚文件。
7. **关闭与恢复。**切换模式不关闭 PTY 或会话 controller；独立终端的既有关闭/kill 保留明确语义。新增会话入口把“关闭会话页面”和“结束运行”分开，关闭页面后后台仍可从侧栏找到。重启恢复历史、布局和显示偏好；没有重附着凭据的旧运行标记中断，不自动重发上一轮或伪称进程仍活着。

## 内容如何显示

### Codeg 式结构化呈现

用户进一步明确希望对话模式具有 Codeg 那样的呈现效果，不要求输出终端的全部内容。采用面向阅读与操作的结构化对话：助手正文流式显示，工具过程用紧凑活动行，文件变化用差异入口，产物用可打开的卡片。终端与对话共享执行事实，但可以采用不同的信息密度和排版；切换无需两边逐行对应。

默认展示用户请求、助手公开说明与回答、当前工作状态、工具摘要、文件/产物入口，以及需要处理的审批或错误。终端启动横幅、ANSI 控制符、光标重绘、重复状态刷新不进入对话时间线。工具完整参数、长命令输出和大 diff 默认折叠，用户主动展开或打开日志查看；容量截断需要明示，不假称保存了完整输出。等待授权、执行失败、取消和记录不完整必须可见，不能为界面简洁而隐藏。

例如一次修复任务的对话可以显示：“我先检查登录逻辑” → “读取 auth.ts” → “修改 auth.ts · +12 −4（查看差异）” → “运行 npm test · 退出码 0（展开输出）” → 最终回答 → “变更文件 / 报告预览”。路径、统计和退出码都来自真实事件；仅凭退出码不能虚构通过的测试数量。过程顺序保留，重复输出可在同一调用中折叠，不把过程全移到回答末尾。

实现依赖结构化事件和有类型的历史记录，再由 renderer 决定展示方式；不依赖实时让另一个模型总结终端全文。只有 PTY 字节时，无法可靠恢复工具、审批和产物语义，应降低展示能力并明确说明，不能猜测出看似完整的 Codeg 式时间线。这一 UI 方向与完整双向切换是两个验收维度，视觉成立不代表输入控制已经打通。

### 各类内容规则

| 内容 | 显示规则 | 事实来源 |
| --- | --- | --- |
| 用户输入 | 文本、文件/选区引用、附件、发送状态 | 本地草稿 + 命令回执 + 提供方确认；不会展示两次同一提交 |
| 流式回答 | 同一 block 原位追加 Markdown；正文/代码可复制；向上阅读时不拉回底部 | 真实 text delta；仅有轮后转录时不做假打字动画 |
| 工作说明/公开推理 | 按事件顺序插入，与工具交错；每段独立开始/结束 | 公开事件；无此能力时省略 |
| 工具调用 | 名称、目标、状态、耗时；展开参数与截断输出；未知工具有通用卡片 | callId + 实际工具事件；相同名称不能代替身份 |
| Shell 输出 | 默认紧凑显示命令和状态，结束后显示退出码；展开查看 cwd 与有界 stdout/stderr，长日志按需读取 | 工具/PTY 证据；命令输出不是最终回答 |
| 最终结果 | 正文 + 已知验证结果 + 文件/产物入口 | 最终消息及已关联结果；工具完成不等于任务完成 |
| 文件变化 | 每轮路径列表、增删统计、状态与 diff 入口 | 已有快照/工具证据；标记“工作区在本轮期间变化”或“工具直接写入” |
| 产物 | 类型卡、预览/源码/打开所在位置；保存中、可用、已修改、缺失分别呈现 | 显式产物事件优先，其次有路径的成功工具结果，最后才是受限文件发现 |
| 子 Agent | 主时间线中的紧凑状态与结果，点开独立过程 | 父子运行身份；不把子输出混入主助手正文 |

文件修改、产物和模型说法分开：`report.html` 是交付对象，`src/app.ts` 的修改是变更记录，两者可以相关但不等价。Markdown 代码块默认只是文本，不能因为包含 HTML 就自动执行。普通路径引用只能给“打开文件”候选，不足以标为本轮已生成。

快照比较可能包含用户、格式化器或其他 Agent 的同期写入；多个 Agent 使用同一 checkout 时尤其不能声称独占归属。多写者优先使用既有 worktree 隔离。历史 diff 必须指向保留的版本/patch；历史文件入口打开当前文件时要明确提示。没有历史 blob 就显示不可用，不用当前内容冒充当时产物。

终端和对话统一采用用户主动打开预览：文件生成或修改时只更新变更提示与文件入口，用户点击文件或预览入口后才唤出既有文件窗口。HTML 也遵循此规则，首次生成、轮次结束及模式切换均不自动弹出或抢焦点；用户关闭后，后续更新仍须点击才能重新打开。这是已确认的交互约束，不将自动弹出列为待补功能。

产物引用建议包含 `artifactId + sessionId + turnId + workspaceRuntimeId + worktree + path/resourceId + mime + contentHash/version + origin`。对于用户已打开的预览，文件稳定落盘或收到 finalized 后再刷新内容；保留上一次完整版本，避免半写 HTML/Office 闪烁。统一文件发现、变更归属与版本刷新仍属后续建设范围，不能据交互约束宣称已经实现。

HTML/Markdown/Office 继续使用现有隔离 viewer；生成 HTML 不获得 Node、preload 或任意 IPC。资源路径在实际运行宿主验证，远端路径不能拼成本机路径；符号链接、项目外引用和外链沿用已有访问边界。声明式工具卡由宿主注册，模型输出不能注册 React 代码或新增工具权限。

## 实现架构建议

### 一份事实，多种投影

数据流为“提供方事件/原生转录 → adapter → 主进程会话 controller → 有界事件/快照 → 对话、状态和变更投影”。原始 PTY 字节继续走终端专用通道；不将大量 ANSI 塞进语义事件日志，也不从清屏、光标移动和颜色猜工具语义。

主进程 controller 管执行身份、发送、取消、审批和订阅恢复；renderer 只投影与发命令。会话 registry 仍拥有身份和索引，provider transcript/现有 Chat 历史仍是其对应正文权威来源；新增展示 journal 保存规范化事件及出处，不复制一个竞争的会话数据库。重放、展开、换视图和恢复历史永远不触发业务写入。

建议新增的显示契约概念如下，名称和路径在实施时收敛，不是当前已存在 API：

```ts
type DisplayEnvelope = {
  schemaVersion: number
  sessionId: string
  executionId: string
  epoch: string
  seq: number
  eventId: string
  source: 'native-agent' | 'protocol-agent' | 'transcript' | 'hook'
  sourceRef?: string
  turnId?: string
  blockId?: string
  callId?: string
  payload: DisplayEvent
}
```

`DisplayEvent` 覆盖 turn 生命周期、text/reasoning 增量、工具开始/更新/结束、approval/question、file-change、artifact 和错误。单独保存连接状态、执行状态与读取完整性；断线不等于运行失败，缺日志不等于没有执行。PTY seq、provider seq 和规范化 seq 各有命名空间，不能直接互相比大小。

持久/重放身份稳定，流式与转录重合依据 sourceRef、原生 message/call identity 或可靠映射替换；禁止用文本相同、时间接近或 cwd 相同去重。来源无稳定映射时保留“补充历史/无法关联”，不强行合并。现有不同 turnId 在主进程建立映射，无法证明时文件卡保持独立。

订阅返回 `(snapshot, epoch, lastSeq)` 并保证后续增量连续；主进程用同一串行事务完成取快照与注册订阅。重复事件忽略，缺口请求重同步，epoch 变化切换新基线，旧 execution 的迟到事件隔离。按事件数与字节限制缓冲，大图片和大日志用资源引用。文件转录读取保留完整行游标，处理半行、截断和轮转，不按 token 全量重读文件。

### 适配器按能力开放

适配层声明 `readHistory / liveText / liveTools / submit / cancel / approvals / questions / resume / attachNativeTui / artifacts`，并记录探测版本与缺失原因。能力以实际连接握手和版本测试为准，不能只按引擎名称写 true。MCP 是工具协议，不能替代会话、流式与控制协议。

优先级是 Janus 自有事件、外部正式结构化协议、原生转录加 Hook、最后仅终端。ACP 可作为一种 adapter，不要求为了兼容一个 CLI 把 JanusX 内部所有事件强行改成 ACP。Janus CLI 与桌面若需同实例 attach，属于 janus-agentX 的协同契约，本篇不替该仓库承诺已经具备。

第一版不做泛用的“给任意 PTY 填 prompt 并按 Enter”。这种行为可能落入 shell、登录流程、菜单或审批界面，而且无法可靠获知原生草稿。必须保留它作为受限的显式用户动作时，也应显示未确认送达，不能成为完整双模式的验收替代。

### UI 分层与拟议落点

用户明确要求对话能力作为跨 CLI 的公共底层框架，各 CLI 只做适配。当前已将 UI 抽取为 `AgentSessionPane` / `AgentComposer`，公共快照、命令、模型和能力在 `src/shared/conversation-display.ts`，主进程以 `ConversationController` 注册表连接 adapter。Codex 已改用此边界，原生 app-server/remote 协议保持在 Codex adapter 内；滚动、草稿、切换动效及输入预览由同一 UI 负责。尚只有 Codex 一个实际 adapter，审批契约仍是命令/文件的二选一，完整原生指令目录和更细能力需要第二个 adapter 验证，不能宣称公共框架已覆盖所有 CLI。

公共层负责同 pane 模式切换与动效、焦点/输入互斥、消息/工具/文件/产物的展示组件、流式阅读、返回最新、草稿/阅读位置、通用指令预览及模型设置控件。滚动状态按稳定会话身份隔离；底部追随、向上阅读不抢滚动及返回最新应作为公共行为测试，CLI adapter 不实现自己的滚动。公共事件/快照使用规范化身份、内容与能力，公共 UI 不直接引用某 CLI 的协议类型、RPC 方法或 Codex 专用 IPC。

adapter 负责实际进程/连接与原生 TUI attach、会话/轮次/调用身份映射、事件转译、历史读取、发送/取消/审批/设置命令及真实能力声明。通用输入框消费 adapter 提供的指令目录和模型/参数描述：支持的共享动作复用同一控件，CLI 专属动作通过声明扩展；不将 Codex 的六档 effort、审批选项或斜杠指令全集硬编码成所有 CLI 的能力。不支持某项能力时隐藏入口或清楚降级。不同授权范围保留真实 optionId/语义，不能都压成 accept/decline。

现有公共对话区支持已加载内容的虚拟滚动、流式时保持历史位置、返回最新及视图切换时保存位置，源码在 `AgentSessionPane` 与共用 `VirtualHistory`，行为回归在 `tests/e2e/codex-conversation.spec.ts` 和 `conversation-virtual-history.spec.ts`。当前投影仍有 500 项/文本预算，原生历史分页未实现，不能称为完整历史无限回看；须区分已加载内容滚动与按需读取更早历史。

| 层 | 复用/拟议落点 | 职责 |
| --- | --- | --- |
| 会话控制 | `src/main/sessions/`，拟增 controller/adapter 模块 | 身份映射、能力、命令仲裁、投影恢复；调用现有终端/Chat 服务 |
| 共享契约 | 已有 `src/shared/conversation-display.ts` 与对应 IPC | 当前为快照、命令及能力；分页、扩展审批待实现，不承载密钥 |
| 展示状态 | 拟增按 session 分区的 conversation store | rows、运行状态、快照水位；不持有子进程或审批副作用 |
| 工作区宿主 | `workspace-pane.ts`、`TerminalArea.tsx`、workspace store | 单会话 pane、displayMode、内容替换、焦点恢复与关闭/销毁区分 |
| 内容组件 | 复用 `ChatTimeline`、`ToolCallCard`、Markdown 与 ThinkingRegion | 增加文件/产物/请求槽；专属 renderer 注册在宿主边界 |
| 文件与产物 | turn-changes、既有文件打开服务与 viewers | 一份变更记录、一条打开路由、版本与来源说明 |
| Agent 运行 | 既有 Chat/harness 与 janus-agentX 端口 | 工具与权限事实；本次不新建第二套 Agent loop |

显示快照不自动进入模型上下文。选择“引用结果/文件”才通过已有上下文构造进入请求；脱敏摘要与业务原始载荷分开。一个会话宿主共用 store 和数据订阅，切换不重复启动 watcher、历史扫描或 usage 统计。隐藏终端保留 PTY/xterm 状态，隐藏对话保留投影与阅读状态；隐藏 UI 不持续参与重型渲染。

前台 token 可按帧合并绘制，生命周期/审批即时更新；后台暂停动画和重型 Markdown/diff 渲染，但继续接收必要状态。长列表按稳定 rowId 虚拟化并分页，插入旧历史保持阅读锚点；终端继续既有 buffer/resize 管理，只有实际可见尺寸变化才 fit。应测量而不是预先承诺双视图零性能代价。

## 交付顺序与验收建议

### P0 实测：Codex 同实例双前端

2026-10-30 执行 `node scripts/codex-dual-mode/probe.mjs`，Windows / Codex CLI 0.166.0 全部断言通过。脚本及使用说明位于 `scripts/codex-dual-mode/`；本次完整报告留存在 `artifacts/codex-dual-mode/report.json`（本地忽略目录），原始事件与请求位于报告中的临时根目录。以下持久摘要与可重跑探针一起构成证据，不依赖临时文件永久保存。

验证结构为一个真实 `codex app-server --listen ws://127.0.0.1:PORT`、一个真实 ConPTY `codex --remote … resume threadId` 原生 TUI，以及一个 JSON-RPC 客户端模拟未来对话 controller。模型输出来自本地确定性 Responses 服务，配置、环境和工作区独立，未使用用户账户、真实模型或现有会话。模拟服务只发出固定指令；命令、补丁、审批与会话执行由真实 Codex 完成。

| 已执行检查 | 结果及边界 |
| --- | --- |
| 终端 → 对话 → 终端继续输入 | 原生 TUI 发起第一轮，协议客户端发起下一轮并出现在 TUI，再由 TUI 发起后续轮；七条测试用户输入在主 thread 历史中各出现一次，模型请求包含前文 |
| 流式与重连取消 | 收到 `item/agentMessage/delta`；流式未完成时断开结构化客户端，重新连接并 resume 同一 thread，再 interrupt，收到 interrupted 完成状态；未验证丢失增量的完整重放 |
| 工具命令 | 收到 `item/commandExecution/requestApproval`，协议接受后收到请求解决事件、commandExecution 成功结果、退出码 0 和真实标记输出 |
| 文件与产物 | 收到 `item/fileChange/requestApproval`、请求解决事件、fileChange 路径/diff/完成状态；临时工作区 `result.html` 内容与预期一致；未实现产物卡或预览 UI |
| 身份与进程 | 主 thread 为 `01a18d04-e69b-7580-88d2-f4064a08a646`，后端 PID 13220、TUI PID 53004 在检查期间存活；未启动第二个用户对话执行后端 |

原生 TUI 会创建 `ephemeral: true / threadSource: thread_title` 的标题生成线程。本次剩余一个已加载辅助线程，已核对其类型。未来 adapter 必须按主 threadId 绑定用户内容，并过滤标题辅助事件；不能把全部线程都拼进对话，也不能将“全局线程数必须为 1”作为同会话验收。

本地模拟模型的 fallback 元数据未提供独立 apply_patch 工具，探针使用 Codex 可识别的 exec_command 内 apply_patch 形式进入原生补丁处理，确实得到 fileChange 与对应审批。该事实验证了协议事件链，不代表真实供应商工具选择已经验收。临时 CODEX_HOME 无法创建 PATH helper aliases 的警告未阻断上述路径。

另一个实测边界是：刚执行 thread/start、没有持久历史的空线程无法被原生 TUI resume，返回 no rollout found。P0 探针先执行一轮 BOOTSTRAP 才接入 TUI。P1 已改为转发原生 TUI 的连接，直接绑定原生创建的空线程，不向模型发送初始化提示。

### P1 当前实现：Codex 实验双模式

空工作区的终端选择器与 pane 新建菜单均不再提供“对话模式”开关。公共 launchTerminalPreset 对新建本地 Codex、Claude、OpenCode、Pi、DSH 默认创建具备终端和对话两种形态的会话；设置 → 通用 → 会话启动习惯只选择“新会话默认视图”，默认终端，也可选择对话。偏好即时保存，只作用于之后新建的会话，不迁移或切换正在运行的会话；旧开关无论开启或关闭均迁移为终端优先。远端、attach-only、Shell、Janus 及既有原生恢复入口继续按实际能力运行，不伪造双形态支持。

初始视图随单次创建请求传入，主进程在 adapter 启动前确定控制权，renderer 的启动占位沿用同一选择。失败重试保留该会话创建时的选择；重挂载以运行快照为准，不重新套用全局偏好。带初始提示词的启动在对话优先时填入对话草稿，终端优先时沿用 PTY 预填，两者均不自动发送。用户点击普通 Codex 卡片即创建一个终端身份，由 `src/main/terminal/codex-conversation.ts` 管理独立 loopback app-server 与本地 WebSocket 转发连接，真实原生 TUI 以 `--remote` 接入。`AgentSessionPane` 在原终端区域提供终端／对话切换，任一时刻只显示一种。Claude 使用上文独立 adapter；以下协议与模型控制细节仅指 Codex。

早期开关阶段的历史验证：`codex-conversation.test.ts` 与 `terminal-officecli-path.test.ts` 共 14 项、`terminal-launch.test.ts` 与 `terminal-launch-program.test.ts` 共 11 项通过；公共 UI 浏览器回归 8 项通过。真实 Electron 使用当时的新开关启动普通 Codex，终端→对话→终端三轮保持同一 thread，模型/effort 实际传值和关闭回收仍通过（1 项，27.5s，localhost 模型）。严格 unused 类型检查、定向 ESLint、双语键、主题检查通过，生产构建通过；末尾补充本地/非 attach 启动范围过滤后，启动单元回归及类型检查通过，未单独验证开启开关时的远端/attach 场景，也未再重建桌面。Notes 检查 321 篇、0 错误、17 条既有外链诊断。此处只验证当时 Codex 与公共层，不代表 Claude adapter 通过；默认双形态的最新验证见下节。

采用转发连接是为了保留原生创建、信任审阅、订阅与完整 TUI 语义，同时解决空线程无法 resume 的限制。controller 只根据原生 thread/start、thread/resume 请求的响应选择主 thread，不根据全局 thread/started 广播猜测归属，标题线程和子 Agent 不改变当前对话。主进程使用独立请求 ID 前缀发送对话操作，只拦截自己的响应，原生响应与通知继续交给 TUI；该转发器随会话运行，不随 React 视图挂载变化。

Codex 原生 remote 传输会读取代理环境变量，127.0.0.1 也可能被送往 HTTP 代理。用户启动报 connection lost 时，现场环境有 HTTP_PROXY／HTTPS_PROXY 而无 NO_PROXY；先前 CLI 夹具自带本机绕过，未覆盖该条件。新增隔离代理回归在修复前捕获 `CONNECT 127.0.0.1:<bridge-port>`，TUI 报 `Proxy connection failed: HTTP CONNECT failed with status 502`；修复后本地连接直接建立。adapter 现在为后端及原生 TUI 合并 NO_PROXY／no_proxy，保留用户既有排除项并加入 127.0.0.1、localhost、::1，保留 HTTP_PROXY／HTTPS_PROXY／ALL_PROXY，不改用户全局配置。主进程把 adapter 返回的环境补丁用于同一 PTY，避免只修后端而遗漏 TUI。桌面回归进一步发现宿主 ProxyManager 的全局 HTTP hook 也会代理本机 WebSocket；后端就绪探测与正式连接均显式传入 agent:false，防止该内部通道被全局代理接管。

传输关闭不再用笼统错误覆盖已有具体故障，也不在尚未建立 thread 的启动阶段保证历史已保存。断线仍不自动重发请求或重建会话。新增环境与错误保留单测后 `codex-conversation.test.ts` 十一项通过；真实 CLI 两项通过（代理隔离约 4.87s、双会话控制回归约 35.1s），仅 HTTP_PROXY／HTTPS_PROXY 的现场同类条件单独复测通过（4.61s）。测试确认外部代理配置保留、本机地址不再进入代理。真实 Electron 代理回归通过（28.1s）：原生 TUI 启动、终端与对话切换、同一 thread 三轮交流以及模型／强度设置均正常。生产构建、严格 unused 类型检查与定向 ESLint 通过；测试使用隔离 profile 与本地模型服务，未重启用户正在运行的应用或重发失败请求。

2026-11-01 现场定位启动期 `Max payload size exceeded`：原生 TUI 的 `plugin/list` 单条响应为 26,304,472 字节（约 25.09 MiB），其中 `openai-curated-remote` 返回 10,689 条目录记录。旧桥接两端的 16 MiB 限额在接收后端响应时断开连接；以该限额直接请求接口复现 `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`。两端现统一为有限的 100 MiB，与 `ws` 默认值及独立探针一致，原生报文完整转发，不受对话展示裁剪影响。代价是单次接收、字符串转换和 JSON 解析可占用更多内存；若目录继续增长接近上限，应重新评估上游分页和转发成本。`npx vitest run tests/unit/codex-conversation.test.ts --project=unit` 十二项通过，新增真实 loopback WebSocket 回归发送超过 25 MiB 的插件目录，验证原文转发、后续轮次事件与连接存活；该用例在旧限额下失败。本轮未重跑完整 Electron 交互回归。

新路径把现有 inline Hook 配置、terminal/workspace 身份环境、工作目录及 Office 环境传入自有 app-server，移除该后端命令中不适用的 --no-daemon。原 Hook manager 的默认参数未更改，不连接用户共享 daemon，不复制用户登录或原生 home。Hook 准备失败时新双模式启动失败并显示错误，避免悄悄运行无归属会话；原生信任仍在 TUI 由用户审阅。不再设置版本门控，此处历史实测版本为 0.166.0；Windows npm shim 会解析到原生 codex.exe，不能以 shell 字符串拼接 Hook TOML。仅接受新建本地 Codex，会话恢复参数与远程路径明确拒绝。

显示切换不创建/取消/resume 轮次，原生 PTY/xterm 保持挂载；隐藏视图设为 inert，主进程同时拒绝隐藏终端的普通输入、原生主线程发送/中断与审批回复。显示控制代次让切换前的迟到对话操作失效。对话发送使用 commandId 去重，超时/断线不自动重发，运行中禁止再开一轮；原生终端继续保留它自己的补充输入语义。正文完成并不意味着轮结束，停止与忙碌状态以 turn 事件为准。对话草稿和阅读位置放在已有终端状态，终端草稿由原生 TUI 保留，两边不自动互拷。

对话正文复用现有 Markdown renderer；工具活动默认收拢，命令卡显示结构化输出，文件卡显示路径和 diff。命令／文件审批保留原生授权范围，request_user_input 以独立问答卡片处理，边界见[对话内问答](#对话内审批选项和文字回答)。点击文件使用现有 openEditor 路由，HTML 等预览由既有文件窗口承担；预览按已确认规则由用户点击打开，不自动弹出。尚无独立产物目录、版本化产物卡或撤销。终端 Island 保留在终端视图；对话文件卡使用协议补丁记录，尚未与 checkpoint Island 合并为单一变更记录。

显示投影按 turnId/itemId 更新，最多 500 项、总文本约 100 万字符，单项文本或 diff 预算 32000 字符，截断会显示提示，不修改原生记录。流式快照最多约 32ms 推送一次，后台工作区保留最新快照但暂停对话渲染。历史现已按轮次虚拟化并复用未变轮次的分组/文件统计；原生历史分页未实现，全量快照仍有传输成本，浏览器合成测试不代表 Electron 长时性能已验收。

切换模式、标签或工作区不结束运行。显式关闭终端标签沿用现有“结束会话”语义，PTY 退出、同 ID 替换、创建失败及应用退出均回收自有后端；killAll 等待后端进程树回收。关闭标签后后台保活、应用重启恢复、协议自动重连和断线增量重放未实现，不能把 P0 的重连探针记作产品恢复能力。

[官方 app-server 文档](https://developers.openai.com/codex/app-server/)与 [CLI 参考](https://developers.openai.com/codex/cli/reference/)给出了 remote TUI 连接方式，但明确将 app-server/WebSocket 标为实验性且不支持生产负载。产品入口默认具备双形态，底层保留协议校验与后端回收，不再设置版本门控；启动失败显示错误，不静默重启或迁移。入口文案不改变协议的固定版本验证边界。

可重复验证：`tests/unit/codex-conversation.test.ts` 八项覆盖 thread 过滤、稳定身份、去重、控制代次、审批失效、预算、初始化期间切换及模型/指令控制；`terminal-officecli-path.test.ts` 补充 shutdown 等待自有后端回收。真实集成 `tests/unit/codex-conversation-cli.test.ts` 使用生成的 Hook、原生审阅、两套后端/TUI 和 localhost 模型，覆盖空会话、往返输入、模型/effort 同步、两会话 Hook 归属、真实命令审批、执行输出与退出后进程消失。设置 `JANUSX_TEST_CODEX_BIN` 为原生 CLI 绝对路径后运行 `npx vitest run tests/unit/codex-conversation-cli.test.ts --project=integration`，默认跳过不能记通过。UI 五项 `tests/e2e/codex-conversation.spec.ts` 使用真实组件和 IPC 替身，覆盖流式切换、不重建终端、草稿、工作区往返、重挂载、IME、审批、文件窗口路由、断线、历史阅读不抢滚动、键盘返回最新、输入框自适应与命令选择器；暗色/纸面/窄窗截图在本地 `artifacts/codex-dual-mode/`。协议/P0 真实文件写入和 P1 文件 UI 属不同层证据，不能合称 P1 真实文件编辑全链路通过。

本步骤未验证真实供应商账户、其它平台、Janus 自有运行时、复杂并行工具、极端审批抢答、完整崩溃恢复或长时间资源曲线；其它 CLI 以各 adapter 的独立验证为准。支持范围内的新会话默认具备双形态；未发布安装包。

Windows 真实 Electron 验收 `tests/e2e/desktop-codex-conversation.spec.ts` 一项通过：从新入口启动、原生 Hook 审阅、终端第一轮→对话第二轮→终端第三轮，同一个主 thread 的三条用户输入完整保留，关闭后 controller 消失；全链路使用真实 preload/IPC/PTY/CLI 与 localhost 模型。桌面截图在 `artifacts/codex-dual-mode/desktop.png`。本轮构建、严格 unused 类型检查、定向 ESLint、双语键检查通过；Notes 检查 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，未调用独立审阅者。

### 默认双形态与启动视图验收

启动路径单测 `terminal-launch.test.ts`、`terminal-launch-program.test.ts`、`terminal-officecli-path.test.ts` 共 19 项通过，覆盖五种已接入 CLI 默认双形态、非支持入口不启用、对话草稿不写隐藏 PTY、偏好修改后失败重试仍保留原选择。设置与对话浏览器测试共 26 项通过（设置七项、对话十九项），覆盖偏好持久化、旧开关迁移、窄窗、首次聚焦及重挂载保留运行视图。真实 Electron 的 Codex 默认终端启动通过（28.9s）；Claude 从设置选择对话后创建、自动聚焦、往返切换与任务面板回归通过（约 1.1 分钟）。首次 Claude 桌面测试发现输入框晚于占位视图挂载而漏掉聚焦，修复为提交能力到达时补充聚焦，并通过新增浏览器测试及最终构建后的桌面复测。两条桌面测试均使用真实 CLI 和本地模型夹具，不涉及真实供应商账户。

最终生产构建、严格 unused 类型检查、定向 ESLint、双语键检查通过，Notes 校验 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 查看 `artifacts/codex-dual-mode/startup-preference.png` 的 380px 设置布局。仅修改新会话的创建策略和首个视图，不迁移旧运行或扩展未支持的版本、远端、Janus 接缝；主 Agent 自检，无独立子 Agent 审阅。

### P1 界面优化：以 Codex 桌面端为视觉参考

2026-11-01 按用户要求进行首版视觉精修：空态在居中内容列中左对齐，引擎身份、标题和输入区共用阅读轴；正文标题按 25/21/17/15px 区分，正文 14px，强调以字重表达。共享 Markdown 组件原有内联样式会覆盖 pane CSS，新增仅供对话使用的排版变体，保留代码、链接和资产处理，其他预览不变。用户气泡改为较紧凑的不对称圆角；工具摘要保持逐项展开，以连续细线和语义状态颜色组织。输入区提升底色区分、增加底部控制分隔，聚焦使用主题强调色，发送/停止改为圆角方形。没有改变会话控制和工具事件归属。深浅主题及 390px 宽度截图经主 Agent 查看，无横向溢出，示例内容由测试夹具提供，位于 `artifacts/conversation-design/`。这版保留长对话滚动、草稿与 reduced-motion 行为。

用户要求切换与对话设计更现代、简约。2026-10-30 读取 [OpenAI 官方 Codex 应用页面](https://developers.openai.com/codex/app/)并查看其 proactive-teammate-v2 演示封面：采用留白、居中任务起点、圆角输入区和圆形发送按钮作为参考。这里提炼视觉原则，组件仍由 JanusX 实现并读取既有主题令牌，正文继续使用共享 Markdown renderer；没有复制官方图片作为产品资产，也没有添加尚无能力支撑的模型、附件或权限选择器。

当前 `AgentSessionPane` 使用右上角紧凑分段按钮表达终端/对话，左侧不再显示就绪等常驻运行状态，取消全宽工具栏分隔线。两种模式位置固定，当前项有明确选中态；再次点击当前模式不发送切换请求。采用可见的两个标签是为了让视图切换保持一步可达。切换不触发会话重建，隐藏视图仍为 inert。

空会话将任务标题与输入框放在内容区中央的阅读列中，文字左对齐；有内容后使用最大 744px 正文内宽和底部输入区。用户消息用轻底色气泡，Agent 正文保持开放排版并标明引擎。工具过程是默认收起的摘要行，显示类型、首行或文件名及状态，展开后显示输出、文件路径和着色 diff；失败/拒绝状态保留文字提示。审批改为中性描边卡片，允许一次是高对比主操作。文件名打开现有文件窗口，完整路径仍可通过悬停及无障碍标签读取。

输入区使用整体主题色焦点边框，不在 textarea 内部增加强调色矩形；文本随输入和 pane 宽度增高，最大 200px 后内部滚动。底部为模型/推理强度快捷入口与圆角方形发送/停止按钮；工作区由左栏表达，不重复显示工作目录标签。键盘提示仅在输入区获得焦点时显现，窄 pane 隐藏辅助文字。布局按 pane 宽度使用容器查询，适应应用内分屏；系统减少动态效果偏好会关闭状态呼吸与过渡。

阅读历史时保持用户位置并显示“回到最新”，点击或键盘激活后恢复追随；流式增量不抢走正在阅读的历史。界面验证命令为 `npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1`，包含此行为的五项回归通过。主 Agent 查看暗色空态/正文、640px 纸面审批和 380px 窄窗截图，确认输入框、工具内容和模式入口无横向溢出。截图中的 Other workspace/Remount 是测试夹具控件，不是产品界面。现阶段未增加切换快捷键、工具分组时间线或独立产物目录。

上一轮纯视觉优化的 `npm run build:app`、`npm run typecheck:strict-unused`、组件定向 ESLint、`npm run theme:check`、`npm run i18n:check` 均通过；主题扫描无新增问题。构建后真实 Electron 验收一项通过（32.1s），完整桌面截图确认原生终端/对话三轮往返仍保持同一 thread。Notes 校验为 321 篇、0 错误、17 条既有外部链接诊断。以下指令与模型控制改变了后端边界，采用单独的当前验证记录。

### 对话阅读层级

对话正文沿用 Codex 风格参考中的开放阅读流，用户消息使用轻底色圆角气泡，轮次之间增加留白。回答正文统一 14px 字号与 1.8 行高，标题收敛至 16px，通过字重和段落间距建立层级。工具过程使用紧凑摘要行和悬停反馈，保留展开输出、文件与审批入口。代码块保留原始换行和缩进，横向滚动且不限制正文代码块高度；工具原始输出仍保留高度上限。所有调整仅作用于 AgentSessionPane，使用现有主题令牌。

本轮查阅 https://developers.openai.com/codex/app/ 时已重定向至 https://learn.chatgpt.com/docs/app ，具体排版数值为 JanusX 自身设计，不宣称与当前官方应用像素一致。

用户消息下方在悬停或键盘焦点进入时显示复制、重新编辑及时间，触屏常显。Codex、OpenCode 的重新编辑在原消息位置展开编辑卡片，提供取消和保存并重新发送，独立保留底部草稿。Enter 换行，Ctrl/Cmd+Enter 提交，Esc 取消并将焦点还给原消息编辑按钮；编辑期间锁定模式切换，提交即显示等待并防止重复提交。回答结束后下方常显复制及时间，复制失败明确提示。发送与执行期间在阅读流左侧显示 Thinking，审批或原生接管时让位于对应提示；完成后移除。消息时间由主进程记录首次接收时刻，跨快照更新保持稳定，旧消息没有时间时不补造。

原位编辑真实替换该消息起的会话历史，再从这里生成回答，不撤销工作区文件。Codex 0.166.0 使用本机生成 schema 确认的 `thread/revert {threadId,beforeTurnId}`，原生 TUI 同步接收 `thread/reverted`；旧 `thread/rollback` 已移除。OpenCode 2.1.4 使用 `revert/stage {messageID,files:false}`、`revert/commit` 并读回消息确认，轮询代次隔离编辑前的在途响应。确认后才移除本地后续项，Codex 同时移除对应计划，再发送修改后的文本。空闲、控制代次、消息身份、截断与非纯文本内容均有门禁；原生操作结果不明时禁用对话控制，不自动重试，编辑文字仍可选取复制。Claude、Pi、DSH 尚未接入可靠历史编辑，隐藏编辑入口，不能以追加提示词代替。

验证：`tests/unit/conversation-edit-cli.test.ts` 两项真实本地模型测试通过，覆盖三个回合后编辑中间回合、重复 commandId、模型实际上下文不含旧后续、会话身份保持、工作区文件保留及切回原生终端续聊。设置 `JANUSX_TEST_CODEX_BIN` / `JANUSX_TEST_OPENCODE_BIN` 后运行 `npx vitest run tests/unit/conversation-edit-cli.test.ts --project=integration --maxWorkers=1`；未配置时跳过不算通过。相关 unit 28 项通过；`codex-conversation.spec.ts` 与 `conversation-edit.spec.ts` 浏览器 35 项通过，包含取消、失败前后历史状态、底部草稿、重复提交与深浅色/窄窗。截图在 `artifacts/conversation-design/inline-edit-{dark,light,narrow}.png`。以上真实 CLI 是本地确定性模型证据，不代表真实供应商或桌面完整端到端验收。

运行时长由主进程在轮次开始、结束事件间记录墙钟耗时，包含该轮等待审批的时间。Thinking 旁每秒更新分钟:秒；结束后回答工具栏显示固定耗时。视图切换不重置计时，缺少开始事件的历史轮次不补造耗时，后台工具任务不计入已完成的回答耗时。

### Codex 原生执行计划

2026-11-01 本机 Codex 0.166.0 验证可用。默认隔离配置没有向模型提供 update_plan；启用 tools.update_plan.enabled=true 后，真实工具调用产生 turn/plan/updated，包含 threadId、turnId、explanation 和 pending/inProgress/completed 步骤状态。探针使用原生 app-server、TUI 与本地确定性模型服务，不调用真实供应商。成功证据为临时目录 janusx-codex-dual-q5H70M/report.json，可通过 node scripts/codex-dual-mode/probe.mjs 重建。

JanusX 只在受管 Codex 双模式后端与原生 TUI 的进程参数中启用此工具，不写入全局配置。工具可用不保证 Agent 每轮使用；无原生计划时不显示面板，不解析回答文字生成 todo。Claude 任务投影复用此面板，原生状态来源与验证范围见下一节。

输入框上方显示可折叠执行计划、当前步骤和完成条目数。首次计划默认展开，用户收起后后续版本不强制展开；默认展开的计划全部完成后自动收起。每次非重复通知创建新版本，旧版本进入阅读流的计划历史。回答结束仅记录轮次结果，绝不自动完成步骤；中断、失败保留进度，断线显示最后已知计划并停止旋转。第一版只读，不提供用户直接勾选。

主进程按当前 threadId/turnId 校验消息，拒绝其它会话、迟到旧轮及无效状态；每版最多 100 步、每步 2000 字、说明 4000 字，保留最近 100 个计划版本。版本与步骤保留在当前 runtime 的快照中，切换视图和 renderer 重挂载可恢复；进程退出后的持久恢复、断线期间漏失版本补齐尚未实现。历史版本记录已接收的计划，不冒充完整原生账本，也不据完成勾选宣称测试或审阅通过。

本轮验证：原生协议探针通过；受管 Codex CLI 集成一项通过（34.1s），覆盖原生工具计划投影与已有双会话/Hook/审批路径；投影单测九项通过，界面全量十三项通过，补充完成/中断与计划专项两项通过。严格 unused 类型检查、定向 ESLint、双语键校验与 Notes 校验通过（321 篇，0 错误，17 条既有跨仓链接诊断）。已查看 380px 浅色计划面板截图；未做本轮真实 Electron 桌面验收。

### Claude 原生任务与旧式 TodoWrite

Windows Claude Code 2.1.316 已验证并接入同会话任务投影。Mods 在主 Agent 的 TaskCreate／TaskUpdate 成功后调用原生 TaskList 读取实际清单，直接执行的 TaskList 也可提供快照；旧式 TodoWrite 使用成功结果中的 newTodos。任务输入、工具输出文字及模型回答均不作为完成依据，失败、拒绝和子 Agent 工具调用不改主计划。pending／in_progress／completed 映射到共享三态，删除后的空清单创建明确版本。任务工具与停止后台进程的 TaskStop 属于不同用途。

现代任务来源被识别后，每轮开始重新读取清单；旧式 TodoWrite 延续本 worker 最后确认的未完成项，直到原生工具更新或清空。读取失败保留最后确认的状态并标记同步失败，停止旋转；下一次有效快照恢复。读取串行化，主进程校验当前 turn、过滤重复和迟到事件，沿用 100 步、每步 2000 字及最近 100 版本的限制。轮次正常结束、中断或失败只改变运行结果，不补勾未完成项。界面只读，折叠偏好、历史版本及双视图切换复用现有计划组件。

[Claude 官方工具说明](https://code.claude.com/docs/en/tools-reference#task-tool-availability)区分新版任务工具与 CLAUDE_CODE_ENABLE_TASKS=0 的 TodoWrite，也说明模型及后台会话的可用性差异。产品沿用原生后台 worker 的工具策略，不额外改全局环境、不注入强制规划提示词，也不绕过用户工具禁用或审批设置。模型没有实际使用任务工具时不显示虚构计划；是否主动使用由模型与原生设置决定。首版不监听其它 Agent／外部进程对共享任务文件的持续修改，也不恢复 JanusX 进程退出前的计划历史；下一主轮或任务工具调用会重新读取现代任务状态。

可行性探针 `node scripts/claude-dual-mode/mods-probe.mjs --tasks-only` 与 `--todos-only` 均通过，原始报告分别位于 `artifacts/claude-dual-mode/2.1.316/mods-1793468135670/mods-report.json` 和 `mods-1793468158480/mods-report.json`。使用真实原生 CLI 与隔离 localhost 模型服务，验证现代任务待办→进行中→完成→删除，以及旧式 TodoWrite 更新与清空。产品 CLI 集成 `tests/unit/claude-conversation-cli.test.ts` 一项通过（74.36s），覆盖原生终端创建任务后切换对话、跨轮推进、无效任务更新不伪造进度、旧式清单延续／清空及原有控制回归；模型响应由本地夹具确定，未验证真实供应商模型主动规划概率。

控制器与 Mods 定向单测共 21 项通过（含 Codex 回归），浏览器 `tests/e2e/codex-conversation.spec.ts` 共 18 项通过，覆盖同步失败、恢复、切换、窄窗与既有显示交互。`tests/e2e/desktop-claude-conversation.spec.ts` 在最终构建上通过（一项，约 1.1 分钟），真实 Electron／IPC／原生 worker 默认工具配置完成任务创建、推进与勾选，始终同一 session。初次桌面运行因本地模型夹具把原生附加提醒误当作工具尚未返回而重复创建任务；夹具改为检查当前提示后的实际工具调用，重跑通过。主 Agent 查看 `desktop-plan.png` 和 `plan-stale-light.png`，确认桌面任务区及 380px 同步失败提示。生产构建、严格 unused 类型检查、定向 ESLint、双语键检查通过；Notes 校验 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，无独立子 Agent 审阅。

### 首次对话的输入区过渡

每次按 Enter 或点击发送时，前端先把文字存入运行期 outbox，立即显示待发气泡并清空输入框，不等待 IPC 或原生消息回传。首次发送复用原输入表单，以实际位置差执行 420ms 缓出动画，从中部落到底部；草稿高度与 pane 尺寸参与起点测量，流式回复和焦点不等待动画。切换视图、隐藏 pane 或卸载取消动画；已有历史不重播，减少动态效果时直接使用最终布局。

五个引擎共用投递队列保存提交状态，普通发送不指定 delivery，由 liveInput 能力决定工作中是否立即派发。Codex、Claude 与 OpenCode 直接提交原生输入，Pi、DSH 等空闲后派发；底层协议保留显式 queue／steer，输入区不显示投递方式选择器。Codex 使用 turn/steer 并携带 expectedTurnId，完成竞态失败不自动重发为新轮，协议依据为 [官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。OpenCode 活跃时使用原生 prompt 的 steer 投递。Claude 活跃时使用 daemon 的普通 reply，交给原生输入处理，不强制 nextTurn；空闲仍使用 nextTurn:true。活跃输入收到 daemon 确认后保持已发送待同步，实际消费由原生模型／工具边界决定，不再因十秒内没有新 turn.start 就判定断线。

IPC 仍串行提交，原生已接收的不同文字不阻塞后续输入；重复文字等待前一条原生回显，以免确认身份混淆。停止与发送按钮同时保留，队列最多保留 100 条；后台任务本身不阻止下一轮主对话。每条文字显示等待发送、发送中、已发送待同步或未确认状态，原生回传用发送前不存在的 user item 身份与正文确认。队列跨 pane remount 保留但不持久化到磁盘，pane 未挂载时的后续调度等重新订阅快照；应用退出不承诺恢复待发文字。发送失败暂停后续队列并保留全部文字，可移回输入框；未知送达不自动重发。模式、thread 或进程变化使未确认文字停止派发，旧进程迟到结果不能覆盖新进程状态。IPC 在途时禁止切换视图，确认后可去终端检查，保留的队列不会跟随旧控制代次自动发送。

验证（2026-11-04）：修复前 Codex、Claude、OpenCode 三项浏览器用例均复现第二条消息被本地强制排队；去掉 AgentComposer 和 AgentSessionPane 的默认 queue 后，通过 Enter 与发送按钮连续提交三条消息，全程无须结束当前轮。conversation-outbox、codex-conversation、claude-conversation、opencode-conversation、native-conversation、conversation-questions 共 60 项单元测试通过，覆盖原生活跃提交、重复身份、延迟回显、失败保留、控制代次和提问校验。codex-conversation、conversation-context、conversation-attachment-recovery、conversation-input-editing、conversation-questions 共 35 个不同浏览器用例分轮通过，覆盖 Pi／DSH 等待空闲、remount 后继续派发、必答问题暂存及删除消息、回答后立即派发、附件和多行占位提示回归。旧 OpenCode 强制排队断言改为必答问题阻塞场景后复验通过；类型检查与变更源码 ESLint 通过。日志在 artifacts/conversation-live-input。此次未修改原生适配器，界面与协议夹具不代表真实供应商模型采纳输入的效果。

Claude 同一原生轮可合并多条输入；Mods 在 prompt.submit 进入下游前暂存每条正文，在 turn.start 一次投影独立 user item，拒绝／异常的暂存输入移除。不能仅使用 turn.start.text，否则只显示合并批次最后一条，前面消息无法确认。真实 CLI 回归已验证 Codex 0.166.0 的第二、第三条输入留在同一 turn 并进入后续模型请求，以及 Claude 2.1.316 在流式未结束时接受两条输入、后续请求包含两条且界面投影完整；均为隔离配置与 localhost 模型。Claude 完整审批／停止／多会话回归 96.3 秒通过；浏览器 31 项通过。未验证真实供应商模型采纳新要求的效果。

### P1 指令预览与模型控制

原输入框把 `/model` 当成普通提示词发送，无法实现原生 CLI 的本地命令语义。现由 `AgentComposer` 在输入时识别斜杠指令并展示可操作的选项；普通消息、绝对文件路径（如 `/tmp/report.md`）继续使用原发送路径。共享 parser 和 controller 双层拦截指令，避免绕过 UI 后误发模型请求。

| 输入/入口 | 当前行为 |
| --- | --- |
| `/`、`/help` | 预览支持的指令与用途 |
| `/model`、`/model <搜索词>` | 展示并筛选后端模型目录，选择后更新同一会话 |
| `/effort`、`/effort <搜索词>` | 仅显示当前模型声明支持的推理强度 |
| `/terminal`、`/stop` | 切换同一会话到终端、停止当前轮次 |
| Codex `/new` | 空闲且没有待发文字时新建原生会话；确认新 thread 后清空当前阅读流，终端同步切换，不删除旧会话记录 |
| 输入框底部模型/effort 按钮 | 模型打开搜索选择器，effort 打开横向强度阶梯；保留正在编写的草稿（包括未执行的斜杠指令） |
| 原生目录中的技能、模板及命令 | 按引擎展示类型图标；Codex/OpenCode/Pi 走结构化调用，Claude 标记终端执行。支持冒号命名空间和目录中的嵌套名称 |
| 目录外的斜杠指令 | 显示尚未适配与终端入口；未命中原生目录的绝对路径继续作为正文 |

预览支持上下键定位、Enter 执行、Tab 仅补全、Esc 关闭及点击外部收起；输入法组合期间不提交。原生命令首次选择补入名称，用户可继续输入参数，再 Enter 调用；终端执行项在确认完整名称后切换视图，并将单条指令提交给所属原生终端，后续弹窗在终端处理。模型当前选项显示勾选，effort 用横向强度控件表达。切换模型时优先保留兼容的 effort，否则采用该模型的目录默认值；未知自定义模型仍显示真实模型名，但不猜测 effort 列表。目录失败可重试且不打断会话，设置失败保持草稿并显示反馈。模型与 effort 标签使用中英文文案；模型描述保留后端返回文本，effort 不显示描述或描述悬停提示。

Codex `/new` 由主进程向所属原生 TUI 发出固定命令，仅放行一次非临时 thread/start；沿用原生客户端的选择与订阅，不另建一个终端未绑定的 thread。操作期间锁定提交，15 秒内没有原生新 thread 确认则显示失败并停用对话控制，可转终端检查；不自动重试。`codex-conversation-cli.test.ts` 的 `starts /new` 用例在 Windows/Codex 0.166.0 与 localhost 模型实测通过：新建本身没有模型请求，新建后的对话输入与终端输入投影到同一新 thread。该用例单独运行，真实供应商、其它版本和跨平台未验收。

协议依据为 [OpenAI 官方 app-server 文档](https://developers.openai.com/codex/app-server/)中的 `model/list`、模型能力字段，以及本机 Codex 0.166.0 生成 schema 的 `ThreadSettingsUpdateParams` / `ThreadSettingsUpdatedNotification`。controller 从 thread/start、thread/resume 响应获取初始 model/reasoningEffort；模型目录支持分页、隐藏项过滤与有界读取。选择通过 `thread/settings/update` 提交 model/effort，等待 `thread/settings/updated` 权威通知更新展示，通知继续转发原生 TUI；终端侧改动也由同一通知投影。仅更改当前 thread 的后续轮次设置，不写用户全局 config，不重启、不新建 thread、不取消在途回复。更新期间禁止新发送和重复设置；控制代次、模型目录和模型/effort 组合都在主进程校验。

当前单元测试 `npx vitest run tests/unit/codex-conversation.test.ts` 八项通过，新增分页能力、默认值、主 thread 设置过滤、更新中发送阻断、失败不伪造选择、过期控制与指令/路径区分。真实 CLI 集成使用 localhost 模型，验证对话选择后的 model 和 reasoning.effort 确实出现在对话第二轮、原生终端第三轮的 HTTP 请求中；同一 thread 与 Hook/审批/清理回归通过（一项，37.06s）。换模型会改变可用工具定义，因此命令审批夹具在设置验证后明确恢复 `probe` 的 exec_command 定义。该测试证明协议传值与双模式同步，不证明真实供应商账号拥有目录中每个模型的调用权限。

浏览器五项覆盖指令预览、搜索、键盘选择、快捷入口保留草稿、目录重试、设置失败、未知指令拦截、原生设置投影、IME，以及既有流式/审批/阅读位置回归。截图 `model-command-dark.png` 与 `effort-command-light.png` 在 `artifacts/codex-dual-mode/`；主 Agent 已查看暗色与 380px 浅色选项面板。

预览层宽度由 480px 调整为最多 360px，高度与内边距同步降低，命令行采用更紧凑的“指令名 + 单行说明”；外层 `box-shadow` 移除，避免悬浮面板周围出现黑色阴影圈。effort 使用横向强度阶梯，中文按“低／中／高／极高／极限／超限”表达，极限、超限分别对应原生 `max`、`ultra`；设置提交和斜杠参数保留原生值。选项按强度排序并仅展示模型实际声明支持的档位，不补造能力。底部使用六根递增柱形，避免四档图标合并最高两档的视觉状态。

effort 面板只保留横向档位和操作提示，不显示预览区、推理用途描述或描述 title。左右键、Home/End 与鼠标悬停只移动候选档位：底板在 200ms 内移动，候选柱形伸展，不播放激活动效；当前已提交档位用同档颜色的圆点、aria-selected 与入口标签表达。Enter 或点击提交设置；快捷选择器中的 Tab 关闭并恢复焦点，斜杠入口中的 Tab 只补全。左右到达两端后停止，不跨端跳转。保留下一轮生效与键盘提示，窄窗横向容纳六档，更多档位允许内部滚动，不撑破页面。

六档固定色相依次为绿、青、蓝、紫、金、玫红。`effortToneClass` 统一菜单标签和柱形、激活动效、底部入口的配色；文字按应用的深浅主题使用相应明度。底部强度入口仅以彩色图标和中文标签持续表达原生快照中的档位，不加底色或描边，动画结束、悬停与展开菜单都保留文字和图标颜色及透明背景。候选变化和失败不会覆盖实际颜色；CLI 原生设置更新后，入口名称与颜色一起同步。`minimal` 使用灰蓝，`none`、默认及未知自定义值使用中性色，不推断原生自定义强度高低。

`EffortActivation` 直接覆盖对话输入框的边界并继承圆角，不再创建独立激活卡片。六档分别采用绿色轻亮边框、青色脉冲、蓝色扫光、紫色双向流光、金色光晕与粒子、以玫红为主的多色扩散与角部闪光。高档增加边框厚度、光晕、扩散圈与粒子，单次时长从约 1.15 秒增至 2.4 秒；文字和控件不随动画移动。色彩是装饰性档位表达，不表示警告、实际 token 预算、耗时或跨模型能力分数。`none`、默认、未知及自定义 variant 使用中性边框，`minimal` 使用轻量边框；紧凑入口图标仍保留最低半级映射。菜单只展示原生目录支持的选项，OpenCode 保留原生顺序。

设置命令成功且 effort 改变后才播放激活反馈，菜单随成功提交收起。动效不延迟设置应用、不改变焦点，使用 `pointer-events: none` 保持输入可用；到时卸载，再打开选择器会取消旧反馈，不重复播放。悬停、键盘导航、失败和重复选择当前档位不触发激活。入口标签始终取原生快照，不乐观覆盖。视觉层不展示文字，只用屏幕阅读器状态播报已激活档位。`prefers-reduced-motion` 关闭全部动画与装饰粒子，保留短时静态边框。

2026-11-03：`npx playwright test tests/e2e/conversation-settings.spec.ts --project=island --workers=1 --timeout=60000` 十一项通过。逐档用例检查六种不同颜色与边框动画、菜单/入口/动效色相一致、动效超时后颜色保留、激活层与输入框边界一致、输入焦点可用和窄屏无横向溢出。中文用例分别覆盖深浅主题，验证极限/超限仍提交 `max`/`ultra`，并跟随原生快照更新名称与颜色；其余覆盖菜单无预览、失败和重复选择不激活、候选与已选分离、OpenCode 自定义 variant 中性态、减少动态效果、Claude 原生档位、快捷键和草稿回归。普通类型检查、组件 ESLint、中英文文案检查通过。深浅主题截图为 `artifacts/effort-feedback/chinese-picker-{dark,light}.png` 与 `chinese-persistent-{dark,light}.png`；逐档底部状态为同目录 `persistent-1.png` 至 `persistent-6.png`，切换录制为 `activation-demo.webm`。静态截图不代表动态帧率测量；本轮使用浏览器 fixture，未重跑生产构建、真实供应商或 Electron 协议验收，桌面证据仍为下述此前记录。

紧凑控件阶段 `npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 五项通过，覆盖 effort 横向语义、键盘切换和窄窗边界；紧凑外观与去阴影属于上述截图人工核对，不是独立样式断言。`npm run theme:check`、`npm run i18n:check`、严格 unused 类型检查通过；构建日志 `build-compact-controls.log` 已确认完成。真实模型/effort 协议集成证据沿用上一段记录。

最终构建、严格 unused 类型检查、相关源码 ESLint、主题检查、双语键检查通过；Notes 321 篇、0 错误、17 条既有外部链接诊断。`tests/e2e/desktop-codex-conversation.spec.ts` 真实 Electron 一项通过（27.1s）：在真实 UI 使用 `/model` 与 `/effort`，随后对话第二轮及终端第三轮的 HTTP model/effort 均为所选值，同一 thread 且输入未夹入指令文本。主 Agent 查看 `desktop-model-picker.png` 完整桌面截图；同样使用 localhost 模型，不涉及用户供应商账户。主 Agent 自检，无独立子 Agent 审阅。

### P1 同 pane 切换动效

终端/对话分段入口使用等宽双列和独立选中指示块，点击后立即以 220ms 缓动滑向目标。等待模式命令返回时，原内容轻淡化，内容区顶部中央显示无阴影的“正在切换视图”提示与细环；命令成功后目标内容以 220ms 淡入并上移 5px，加载提示随之淡出。没有最短后端等待或伪造进度，只有短暂的视图交接时间。任一时刻仍只显示一个视图，终端组件保持挂载。

命令等待及入场期间禁止重复切换，两个内容宿主均为 inert，输入框显式 disabled；过渡结束再恢复目标输入焦点，避免终端在解除 inert 前尝试聚焦。失败后显示原错误并恢复当前模式、指示块及输入；组件卸载或换会话会清理计时并忽略旧切换回执。系统启用减少动态效果时不执行滑动、淡入或额外计时，真实命令等待仍显示静态提示。动效仅涉及当前 pane，不重启执行、不更换 thread，也不清空草稿和阅读位置。

浏览器回归七项通过（24.4s）：新增可控延迟与拒绝切换，验证等待提示、输入阻断、失败后重试、双向焦点恢复及减少动态效果；原有流式、指令/模型、草稿、阅读位置、审批与文件入口回归仍通过。主 Agent 查看 `artifacts/codex-dual-mode/view-switch-loading.png`，确认等待提示与模式入口；截图本身不证明动态帧率。`npm run build:app`、严格 unused 类型检查、组件 ESLint、主题及双语键检查通过。

最新构建后的 `npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-codex-conversation.spec.ts` 一项通过（33.3s），使用 Codex 0.166.0、真实 Electron/preload/IPC/PTY 和 localhost 模型，验证三轮往返保持同一 thread、回到终端后的焦点与输入、模型/effort 实际传值和关闭回收。主 Agent 查看 `desktop.png` 中的入场加载状态及 `desktop-effort-scale.png` 中的稳定桌面与强度选择器；未测真实供应商或跨平台。主 Agent 自检，无独立子 Agent 审阅。

| 阶段 | 可交付结果 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0：身份与能力验证 | Codex 独立协议/TUI 探针已通过 | 协议层核心可行性已证明；边界见实测节 |
| P1：Codex 最小产品接入 | 已实现受管后端、controller、同 pane 切换、正文、双向输入、审批和文件详情；实际验收边界见当前实现 | 扩展真实供应商与长期测试后再考虑默认开放；其它无协议 CLI 不随之获得能力 |
| P2：Janus 对话及双向切换接缝 | 复用 Janus Chat 的流式、工具、审批、文件和产物；与 agentX 建设或验证同 session 的终端前端 | 终端发送后切对话可继续，反向也成立，保持同一运行与上下文；仅接入命令 shell 不算通过 |
| P3：一个外部结构化 Agent | 选一个协议与版本经过验证的 adapter，完整跑通发送、工具、审批、历史与取消 | 不依赖 ANSI 猜测；协议进程与原生 TUI 的区别已在 UI 表达；跨运行方式继续是显式操作 |
| P4：扩展与恢复完善 | 逐个引擎扩展能力、重连与资源预算；确有能力时增加原生 TUI attach | 每个引擎独立通过兼容矩阵，不能由首个适配结果推定全部支持 |

Codex 的 P1 可直接验证双向切换，不必把只读投影作为必经产品阶段。其它 CLI 的只读投影仍只是过渡。P2 的 Janus 双向切换依赖其运行时接缝；一个引擎通过不能推定其它引擎也支持。

以下保留完整目标的验收清单，并非全部已通过；实际证据与未交付边界以上述 P1 当前实现为准：

- 在空闲、流式输出、工具执行、审批等待、完成和失败时连续切换终端/对话，始终只有一个可见界面；进程数不增加、输入不重复、草稿不丢，原生 TUI 状态保留。
- 对声明完整支持的引擎，终端发送后在对话继续提问，再切回终端继续交互，使用同一 session/execution 和上下文；只读查看、命令 shell 或新会话交接均不能替代。
- 流式→完成→历史恢复后，文本/工具顺序和身份一致；同名并行工具、重复事件、迟到事件、事件缺口均可正确处理。
- 对话默认呈现正文、工具摘要、变更和产物卡；不搬运终端横幅、重绘与重复状态。长输出可展开，失败和待审批始终可见；简化显示不删除执行证据或改变模型上下文。
- 切换瞬间旧视图的迟到输入/审批与新视图操作相遇，业务最多执行一次；重复 commandId 返回同一回执，断线时未知发送不会自动重发。
- 终端拥有控制权时，对话没有可误发的发送/审批按钮；原生草稿和 IME 输入不被接管动作破坏。
- 切换工作区、拖拽会话 pane、切换显示或关闭会话页面不误杀会话；显式结束运行才释放对应资源；重启不误续发任务。
- 同路径不同 worktree、同 cwd 不同会话、父子 Agent、远端同名路径不串数据；共享 checkout 的变化不虚称单一 Agent 归属。
- 变更卡与现有 Island 使用同一记录；快照不可用显示未知；撤销先核对当前文件，不覆盖后续人工修改。
- 产物半写、重写、删除、超大文件和历史版本缺失有明确状态；预览关闭后不反复抢开，未保存编辑不被刷新覆盖。
- 长会话分页/虚拟化保持滚动和文本选择；在持续输出中反复切换模式，并打开 diff/HTML，测切换响应、输入延迟、内存和后台 CPU，按同机单模式基线判断回归。
- 旧会话与旧布局可回退；普通 Chat、蓝图与运行配置助手的既有专属工具和审批不因组件复用退化。

## 取舍与仍需验证的事项

完全替换终端能简化 UI，但会失去原生 CLI 特性，不符合本次目标。把 ANSI 正则解析为聊天实现快，却在全屏、重绘、工具归属和审批上不可靠。对两个模式分别启动 Agent 可以独立工作，但应明确是两个会话，不能用来兑现同一会话双显示。直接搬入 Codeg/ZCode 整体架构会引入不必要的宿主、运行时和协议迁移成本。

当前采用双数据通道、统一会话控制与共享内容 renderer。成本主要是每个引擎的结构化能力、恢复映射和输入控制测试；UI 组件只是其中一层。Codex 0.166.0 和 Claude 2.1.316 均已通过固定版本的同实例探针、产品接入及 localhost 桌面验收；Claude 已支持会话模型／强度选择，原生默认标签、复杂审批及子代理控制仍有上述限制。其它 CLI、安装版本矩阵、Janus 接缝与持久显示 journal 仍待实施。首版范围为本地新会话，不把移动端和远程双控制加入承诺。

产品方向可以成立：JanusX 从以终端为主的工作区扩展为同时容纳终端与结构化 Agent 对话的工作区。关键成果是用户能持续看见同一工作的输入、过程、结果和产物，并清楚知道当前在哪个界面控制它。


## 直接进入对话的初始化状态

Codex 直接进入对话时始终保持对话布局，普通连接只显示轻量状态，不展开原生终端。需要账号登录、目录信任或新增／修改 Hook 授权时，由 ConversationStartupPanel 在聊天内容列、输入框上方自然浮现确认内容，不使用弹窗、遮罩、门户挂载或焦点圈定，输入框仍可编辑草稿。确认区使用中性色主要按钮和文字次要操作，API 密钥入口默认折叠。取消暂停启动，继续设置重新显示待确认步骤。ChatGPT 登录打开系统浏览器，API 密钥使用密码输入框且提交后清空，不进入快照或错误诊断。原生确认成功后移除确认内容并继续建立同一 thread，不发送模拟确认按键，不自动授予信任。

对话主输入框和原消息编辑框支持 Ctrl+J 在光标或选区处插入换行，保留 Shift+Enter，不触发发送；输入法组合输入期间不拦截。两个输入框关闭拼写检查、自动纠正和自动大写，避免代码、路径和混合语言出现红波浪线。对话范围内的文本选中、焦点轮廓及启动确认按钮使用随主题变化的中性色，不使用橙色强调。回归检查选区替换、光标位置、连续换行、组合输入、编辑框以及授权等待时继续写草稿。

CodexStartup 在首次 thread 创建前拦截原生 account/read、目录信任专用 config/read 与 hooks/list 的响应。登录通过 account/login/start 和匹配的完成通知，目录信任通过 config/batchWrite，Hook 通过 hooks.state 按用户已审阅的 currentHash 写入 trusted_hash；全部重新读取原生状态后才放行原请求。Hook 来源与命令可逐项展开，配置变化后读回仍未信任则保留错误，不批准新内容。取消浏览器登录调用 account/login/cancel，迟到回调、过期步骤和重复并发操作不能继续启动。启动期间锁定 Codex 的显示切换，隐藏终端只接受设备查询响应；启动完成后恢复双视图切换。终端优先启动保留原生确认流程。显式传递 --cd，确保原生目录确认针对所属工作目录。

兼容依据为 Codex 0.166.0 生成的协议及固定版本 [目录信任](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/tui/src/config_update.rs)、[Hook 信任](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/tui/src/hooks_rpc.rs)源码；[账号接口文档](https://learn.chatgpt.com/docs/app-server)用于核对登录流程。结构化适配增加了对原生启动请求形状的依赖，升级版本时须重新验证，不解析 ANSI 来猜测授权。其它 CLI 的启动和会话内工具审批不受影响。

验证入口：`npx vitest run tests/unit/codex-startup.test.ts tests/unit/codex-conversation.test.ts --project=unit` 覆盖确认前无写入、取消／继续、过期和并发请求、Hook 哈希、登录完成时序及密钥不进入快照。真实 0.166.0 的 `codex-conversation-cli.test.ts` 使用隔离配置和 localhost 服务验证 API 密钥登录、目录信任、Hook 授权后进入 ready，全程只回传终端设备查询，不输入授权按键。`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 验证布局、焦点、浏览器入口、取消与草稿；生产构建后 `npx playwright test tests/e2e/desktop-codex-conversation.spec.ts --config playwright.desktop.config.ts -g 'conversation-first startup'` 已通过真实 preload／IPC、目录与 Hook 对话框、草稿恢复及首条消息发送。截图位于 `artifacts/codex-startup/`；真实 ChatGPT 账号浏览器登录、其它 Codex 版本及非 Windows 桌面尚未验收。主 Agent 自检，无独立子 Agent 审阅。

聊天正文链接拦截默认及中键导航：HTTP(S) 通过 openPreviewLink 在系统浏览器打开，本地文件通过 openEditor 打开，避免路径触发应用页面导航。终端对话以所属 cwd 解析相对路径，支持 Windows/Unix 绝对路径、file URL、百分号编码和行号后缀；没有明确工作目录时不猜测相对路径。IPC 失败在原文旁显示错误，不刷新页面。回归入口为 conversation-link 单测及 codex-conversation 单测和浏览器测试；浏览器夹具不等同真实账号首次登录或安装版桌面验收。

首份快照尚未返回与原生连接 starting 均属于初始化阶段，不作为只读能力判定，也不要求用户转往终端。输入框保留可编辑草稿、发送等待连接就绪；模型与思考强度入口先显示禁用的占位标签，接收原生快照后显示实际值并开放受支持的设置。只有快照明确不支持 submit 时显示只读提示，needsTerminal 仍提供终端入口。没有设置能力的引擎也展示原生已返回的模型与思考强度，不推测缺失值或补造修改能力。

回归入口：`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1`。新增可控的无快照→starting→ready 流程，检查加载提示、模型/强度同步、草稿保留、发送禁用与真实只读能力；夹具验证不替代真实供应商或 Electron 启动验收。

## OpenCode 会话模型与强度设置

OpenCode 2.1.4 支持执行中的连续输入：适配器声明 liveInput，发送时向原生 `/api/session/{id}/prompt` 指定 `delivery: "steer"`。成功响应表示原生 inbox 已持久接收，不再用五秒内必须出现历史回显作为活跃输入的成功条件；轮询仍负责将待同步气泡替换为原生消息。公共控制器只对声明该能力的引擎放开活跃发送，历史编辑、审批／表单等待及设置修改仍受门禁，Pi／DSH 行为不变。接口依据为 [OpenCode API](https://dev.opencode.ai/v2/docs/api)。

2026-11-01 验证：20 项相关单测、4 项 OpenCode 浏览器回归、类型检查通过；真实 2.1.4 服务与 TUI、隔离 localhost 模型验证首个响应完成前接收两条输入，后续模型请求包含两条、原生 user item 回显完整、session 不变，取消与模型／强度切换回归通过（18.3 秒）。未验证真实供应商的内容采纳效果。

2026-11-01 在 Windows OpenCode 2.1.4 的隔离服务确认原生支持会话设置：`GET /api/model`、`/api/provider`、`/api/model/default` 按 `location[directory]` 返回当前工作目录的目录与默认模型；`POST /api/session/{id}/model` 接收 `{ model: { providerID, id, variant? } }`，`GET /api/session/{id}` 返回确认后的选择。未传 variant 时原生读回 `default`。在线[模型说明](https://opencode.ai/v2/docs/models/)与[API 文档](https://dev.opencode.ai/v2/docs/api)用于核对概念，兼容依据是本机固定版本实测；其它版本不再被版本门控拦截，实际兼容性由协议行为决定。

OpenCode adapter 独立开启 settings 能力，不修改 Pi/DSH 的基类默认能力。模型以 provider/id 区分，筛除未启用模型及不可用 provider，IPC 仅发布名称、身份和 variants，不传含凭据的原生 settings。强度选择保留原生 variant 名称和顺序并提供默认值；variant 也可能代表供应商自定义参数组合，不承诺所有模型具备相同思考档位。无 variants 的模型只显示默认值。设置只影响当前会话，不改全局配置，不提交模型提示词。

OpenCode 模型选择沿用公共弹层、字体、主题令牌、选中标记和键盘交互，在同一单列列表中增加供应商筛选与分组标题。保留完整 provider/model 调用身份，同时通过 `ConversationModelOption.provider` 单独传递供应商 id/name；显示优先采用原生名称，缺少名称的 `opencode-go`／`opencode` 回退为 OpenCode Go／OpenCode Zen，自定义供应商按各自身份显示。搜索匹配模型名、完整 ID 和供应商名称，并支持 Zen 别名。同一供应商下名称冲突时显示完整 ID，否则模型行不重复显示供应商；悬停可查原始身份，读屏选项名称包含供应商。

供应商筛选默认全部，关闭／切换会话后复位；筛选不修改模型。底部当前选择将供应商与模型分开显示，长名称省略但保留完整悬停提示。原生连接或配置变化后可使用“刷新模型”重读目录，不包含登录、购买或配置写入。为保持各引擎 UI 一致，不增加独立双栏窗口或另一套模型卡片；代价是长列表仍需要筛选或滚动。公共弹层按输入框上方的实际可用高度限高，避免窄窗空态中被模式切换栏遮挡。旧会话缺少 provider 元数据时保留原有列表，不猜测任意第三方来源。

2026-11-04 供应商展示验证：`opencode-conversation.test.ts` 8 项通过，覆盖自定义名称、Go／Zen 缺省名称、同名模型的独立身份和凭据不进入快照；OpenCode 2.2.5 的真实 `opencode-conversation-cli.test.ts -t 'shares terminal and dialog'` 1 项通过，确认配置中的 Team gateway 名称进入目录，模型／variant 的实际请求、原生设置及会话切换保持正确，模型服务为隔离 localhost。`opencode-model-picker.spec.ts`、`conversation-settings.spec.ts` 和 codex-conversation 中 3 项 OpenCode 用例共 18 个不同浏览器用例分轮通过；覆盖供应商筛选与搜索、深浅主题、380px 窄窗、键盘、失败保留选择／草稿、刷新入口及其他引擎设置回归。主 Agent 查看 `artifacts/opencode-model-picker/{dark,light}-grouped.png`，修复弹层标题遮挡后复验。Go／Zen 账户和付费模型未实际调用，不将浏览器目录夹具视为供应商服务可用性验收。

空闲且无待处理审批时允许修改；过期控制代次、重复并行设置、设置期间发送或切换视图均拒绝。确认来自原生会话读回；请求失败仅读回一次，不重发修改，无法确认时停用对话控制。已有 250ms 轮询增加会话设置读取，原生 TUI 修改可同步回来；修复前从历史 assistant 消息更新模型的逻辑已移除，设置代次屏蔽修改前发出的迟到轮询结果。终端代理在对话拥有输入或设置进行中拒绝原生 model/prompt 写入。额外轮询有本机请求成本，后续如统一事件订阅，应保持相同确认和过期结果边界。

验证入口：`npx vitest run tests/unit/opencode-conversation.test.ts --project=unit` 覆盖目录隔离、凭据不进入快照、默认值、忙碌/过期/并发控制、失败读回和轮询竞态。设置 `JANUSX_TEST_OPENCODE_BIN` 为本机 2.1.4 后执行 `npx vitest run tests/unit/opencode-conversation-cli.test.ts --project=integration`：隔离配置、真实服务与 TUI、localhost 模型，验证切模型及自定义 variant 后对话和终端的实际请求均使用新模型/强度，设置本身不调用模型，原生接口改回默认后对话同步。`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 验证公共输入框的模型选择、自定义强度、恢复默认和草稿保留；这是 IPC 替身界面测试，本轮没有完整 Electron OpenCode 验收。

## OpenCode?Pi?DSH ?????????

???????? AgentSessionPane?AgentComposer????????????? DOM ????????????????????????? HTML??????????????????????????????????????????????????????????????????????????????????????????????????????IME?Ctrl+J?Shift+Enter ????????????? pane ????????

?????????????????????????????????????????????????????????????????????????????????????????????????????? PTY???????attach-only ??????Codex update_plan ???????????????? adapter ???????? Agent ????? todo?

| ??????? | ????????? | ?????? |
| --- | --- | --- |
| OpenCode 2.1.4 | ?? loopback serve ????? TUI ?? --server/--session?API ???? session | ????????????????? 250ms ???????????? 200 ??????????? 500 ???? |
| Pi 0.85.1?npm ? @earendil-works/pi-coding-agent? | ?? TUI ? session-scoped --extension?message_*?agent_start?agent_settled ? sendUserMessage/abort | ???????????????agent_settled ?????/???? |
| DSH 0.2.0-rc.2 + dsh-tui 0.12.0 | ?? --patch ????? Cordis ???agents registry?session/event?agent/assistant-stream?followup/cancel | ??????????????????? Agent??????????? |

???????????????????????????OpenCode ?? pending permission/form?DSH ?? approval/request??????????Pi ?????????????????????????????????? DSH ??? hook/usage ????????????? registry ???? session id??????????? token ???

???? src/main/terminal/native-conversation.ts?extension-conversation.ts?opencode-conversation.ts ??????? native-bridge.js?pi-extension.js?dsh-extension.js??????? loopback???????? token????????????????????Origin ????????????????reload ???????????????????????????????? 32000 ???????????????OpenCode ???????????????????????? session ???????????????????????????????/??? controller ????????????

Windows npm ???????????????????????????? CLI ???? tests/unit/{opencode,pi,dsh}-conversation-cli.test.ts????? JANUSX_TEST_OPENCODE_BIN?JANUSX_TEST_PI_BIN?JANUSX_TEST_DSH_BIN ?????Vitest integration ??? worker ???????????????? TUI ????????? session??????????OpenCode/Pi ?????????????????? HTTP ?? DSH ??? llm/stream ???????????

DSH ??? TUI 0.12.0 ??????????? profile???????????? runtime/???????????/global TUI ?? junction ??? DSH_HOME ????????? dsh-session-persistence-jsonl??????????? profile ?????????????? profile?DSH ???????? Esc ?????????????????????????????

?? unused ??????? ESLint??????????????Notes ?? 321 ??0 ???17 ??????????????????? 38 ????controller/??????????Codex/Claude ???????????? UI 17 ?????????? DSH ????? DSH ???? DeepSeek ??????????????????????????????? Electron ?????????????????????????? CLI ?????????????????????

## 跨会话输入历史

公共 AgentComposer 支持首行 ↑ 回填上一条、末行 ↓ 前进，并在退出浏览时恢复原草稿；历史浏览采用固定快照，不被新记录移动游标。选区、组合输入、带修饰键的方向键、命令菜单与 @ 文件选择保持原行为，回填不自动提交或附加历史附件。历史切换还须通过实际光标与内容排版的可视行检查：显式换行和自动折行后的中间行保留原生方向键编辑；光标在可视首行／末行时才可回填／前进，无法确定光标位置或处于折行交界时优先保留编辑。

2026-11-03 换行与方向键回归：新增浏览器用例在修复前复现第一次换行光标未下移、空行草稿恢复错误及自动折行误触历史。最终 `npx playwright test tests/e2e/conversation-input-editing.spec.ts tests/e2e/conversation-input-history.spec.ts tests/e2e/conversation-inline-reference.spec.ts tests/e2e/codex-conversation.spec.ts --project=island --workers=1 --output artifacts/input-editing/verified` 共 25 项通过，覆盖实际光标移动、连续空行、选区替换、撤销／重做、草稿重建、多行引用、历史回填及原草稿恢复；实际发送文本逐字符核对，不以 DOM textContent 代替换行语义。输入历史单测 4 项、`npm run typecheck` 与两处改动组件的 ESLint 通过。本轮使用 Chromium 浏览器夹具，未重新打包、进行真实桌面会话或中文输入法人工验收。

JanusX 在消息进入待发队列时保存用户原始文本，不保存包装后的文件上下文；记录代表用户输入，不代表模型已接收。历史按 workspaceId、cwd、engine 隔离，独立于 terminalId/threadId，在新会话及应用重启后保留。每范围最多 200 条，全局最多 30 个范围、500000 个文本字符；相邻重复输入不新增，合并浏览按文本去重。存储失败保留内存行为，不阻断发送。附件仅保留当前草稿引用，不从历史重新加载。

本机 Claude/Codex 通过只读 IPC 补入各自 history.jsonl 的末尾至多 1 MiB、最近 200 条有效记录。读取使用终端的 CLAUDE_CONFIG_DIR/CODEX_HOME；缺失、损坏或未完成的行跳过。Claude 按 project 过滤并还原 pastedContents 中的文本；Codex 原生记录只有 session_id/ts/text，没有项目字段，沿用其全局输入范围。远端终端不读取本机历史，远端原生历史导入尚未接入；JanusX 自己保存的对话输入仍按工作区隔离。不会回写原生历史文件，因此不承诺“对话输入 → 原生终端 ↑”同步。历史读取失败不影响正常输入。

实现入口为 `src/renderer/src/stores/conversation-input-history.ts`、`AgentComposer.tsx`、`AgentSessionPane.tsx` 与 `src/main/terminal/input-history.ts`，IPC 只接受终端 ID，不允许 renderer 指定任意历史文件路径。原生历史格式来自本机字段核对，真实 CLI 按键与远端历史未作端到端验证。

验证：2026-11-02，`npm run typecheck` 通过；`npx vitest run tests/unit/conversation-input-history.test.ts tests/unit/conversation-outbox.test.ts` 共 14 项通过；`npx playwright test tests/e2e/conversation-input-history.spec.ts --project=island --workers=1` 共 3 项通过，覆盖 Claude/Codex 重开页面、原草稿恢复、多行与组合输入、命令菜单、原生历史读取和引擎隔离。相关实现文件 ESLint 通过。`npm run check:notes` 为 0 errors，另有 17 条仓库既有外部链接诊断。本次浏览器夹具不代表真实 CLI 或远端端到端验证。

## 斜杠命令目录与技能选择：原生接口验证

动态目录及命令调用已接入产品，实际边界见下方“公共控制与命令系统落地”。用户要求输入 `/` 后展示带图标的功能与技能，并保留 Codex、Claude、OpenCode、Pi 的差异。以下保留实施前的真实原生接口探针与反例，不能把 SDK 验证自动等同于后台双模式支持。验证与实施由主 Agent 直接完成，没有委派独立审阅。

2026-11-02 在 Windows 使用真实安装的 Codex 0.166.0、Claude Code 2.1.316、OpenCode 2.1.4、Pi 0.85.1，执行[原生探针](../../../scripts/slash-command-probe.mjs)。命令为 `node scripts/slash-command-probe.mjs`，也可追加 `codex`、`claude`、`opencode`、`pi` 选择引擎。脚本精确检查版本，以临时目录、自建技能、假密钥和 localhost 模型接收器验证目录与消息构造；不使用用户供应商凭据，不向生产模型发送请求。接收器故意返回 400，验证边界为原生展开后的出站载荷，不代表模型成功完成技能任务。子进程会退出，Claude 测试 daemon 只在新建 CLAUDE_CONFIG_DIR 内停止。

### 各引擎已验证结果

| 引擎 | 目录与元数据 | 调用结果与产品缺口 |
| --- | --- | --- |
| Codex 0.166.0 | `skills/list` 按 `cwds` 返回 `name/description/path/scope/enabled/pluginId/interface`。测试 `agents/openai.yaml` 的 `displayName/shortDescription/iconSmall` 正确投影；新增技能后 `forceReload: true` 能发现 | `turn/start.input` 同时携带 `$probe-skill` 文本与 `{type: 'skill', name, path}`，localhost 请求包含技能正文。可按现有 app-server 通道接入；图标仅验证元数据与路径，未验收 UI 渲染。未验证完整内置斜杠命令目录 |
| Claude 2.1.316 | stream-json 的 `initialize` 控制响应包含 `commands`，返回 `name/description/argumentHint`，部分内置项另有 `aliases/builtin`。自建项目技能出现，`user-invocable: false` 的技能不出现；本次未发现独立图标字段 | SDK 的 `/probe-skill ARGUMENT_MARKER` 会展开正文及参数。但现有 daemon `reply` 通道曾在 `ok: true` 后把 `/probe-skill DAEMON_ARGUMENT_MARKER` 原样送入模型，没有技能正文。SDK 成功不等于当前后台双模式可执行 skill；不能只放开 parser 拦截 |
| OpenCode 2.1.4 | 经认证的 `GET /api/command` 与 `GET /api/skill`，使用 `location[directory]` 定位工作目录。command 只有 `name/description`；skill 包含 `id/name/description/path/content`，schema 另允许 `autoinvoke`。本机 `/openapi.json` 给出对应契约 | `POST /api/session/{id}/command` 的 `{name: 'team/review', text: 'ARGUMENT_MARKER'}` 返回 204，模型载荷包含展开的模板和参数；`POST .../prompt` 的 `skills: [{id: 'probe-skill'}]` 返回 200，载荷包含技能正文。可复用现有服务连接，但需要独立 command 请求及结构化 skill 附件 |
| Pi 0.85.1 | RPC `get_commands` 和运行中扩展的 `pi.getCommands()` 都能给出 extension、prompt、skill；真实结果以 `sourceInfo` 保存 path/source/scope/origin/baseDir。技能名为 `skill:probe-skill`；内置 TUI 操作不应由该目录推断 | RPC `/probe-extension` 执行了自建回调；模板与 skill 在 localhost 请求中展开。扩展 `pi.sendUserMessage('/skill:...')` 默认发送原始文本；传 `{expandPromptTemplates: true}` 才出现技能正文。本次产品仅对显式 invoke 设置该选项，普通消息仍保持原语义 |

OpenCode 冷启动时曾以 200 返回空目录，稍后注册完成才出现自建 command/skill。探针使用有界轮询等待测试条目出现；产品须单独表示加载/失败/空目录，不能把启动瞬间的空数组永久缓存。首轮探针曾漏传服务认证而返回 401，后续使用临时 OPENCODE_SERVER_PASSWORD；这不是接口不存在。V2 有 `experimental.session.skill` 激活接口，但本轮只读取其 schema，没有执行；已实测的是 prompt 的 skill 附件路径。

Claude 后台探针最初因临时工作区未信任而无法启动，补入仅针对临时目录的信任状态后取得明确的原样转发反例。其后固定延迟或等待 SessionStart HTTP hook 的探针出现就绪超时；空后台会话在首次输入前不保证触发该 hook，不能将这一探针假设直接归因为产品启动故障。修订后仅在测试中读取所属 job 的原生日志，观察输入提示符后再发送，复测通过了“后台 reply 原样转发、不展开技能”的负向断言。日志观察仅是探针门控，不建议产品依赖 ANSI 解析；实施前仍需核实同一 worker 内真正的命令执行入口和权威回执。不得为调用命令新开第二个执行会话，并把它冒充当前终端会话。

### 证据和复现边界

`artifacts/slash-command-probe/1793587197512/report.json` 记录四家目录/协议探索，其中 Codex reload、Claude SDK 隐藏技能过滤、OpenCode command/skill 附件、Pi 扩展与模板展开均通过；该轮还没有 Claude daemon 子用例。`1793587334783/claude-requests.json` 中的后台请求含 DAEMON_ARGUMENT_MARKER 及原始斜杠文本，却不含 CLAUDE_SKILL_BODY_MARKER，daemon 回执为成功；该轮按“应展开”的假设检查而失败。`1793587524580/report.json` 记录错误就绪假设导致的 SessionStart 超时；最终全引擎运行 `1793587579031/report.json` 中 Codex/OpenCode/Pi 通过，Claude 仍受该假设影响；修订门控后 `node scripts/slash-command-probe.mjs claude` 的 `1793587711684/report.json` 通过，包含 SDK 展开成功、隐藏技能过滤、daemon 原样转发断言与 daemonCleanup=0。这里的“通过”表示验证了实际行为，不表示后台技能已可执行。原始报告和请求载荷位于忽略的本地 artifacts，不是随仓库分发的文件；版本、复现代码与结论保留在仓库。

资源隔离有实际边界：早期 OpenCode 探针即使替换 HOME/USERPROFILE 仍发现 Windows 用户目录下的兼容技能，修订后用 OPENCODE_TEST_HOME 和禁用 Claude 兼容技能的测试环境隔离；这些测试变量不得复制进产品启动配置。Claude 在临时目录中仍可能读取祖先 CLAUDE.md，因此不能声称“完全没有读取用户配置/指令”。所有记录仅保存在本机，模型接收器始终为 localhost，未使用用户认证信息。生产供应商、远端运行环境、插件同名覆盖、目录变更通知、参数补全、原生 TUI 焦点和 JanusX 菜单均未验收。

### 建议的公共契约与实施顺序

公共菜单负责展示、图标、搜索、分组和键盘；adapter 提供当前运行环境下的真实目录及执行方式。条目需要稳定 id、原生调用名、显示名称、说明、类别、来源、可选图标、可选参数提示、可用状态和执行方式。模型/权限类操作打开选择器；有参数的命令先补全输入；技能选择保留用户继续提问的空间。Tab 只补全，Enter 的行为由条目类型决定，Esc 保留草稿；菜单打开时优先于输入历史。没有原生图标时用统一的类型图标，不能从名字猜来源或执行能力。Claude/OpenCode/Pi 本轮目录不足以提供与 Codex 相同的图标元数据。

现有 `parseConversationSlashCommand` 不支持 `:` 或命令名中的 `/`，会漏掉 Pi `/skill:name`、插件命名空间和 OpenCode `/team/review`。新解析应结合当前引擎目录，保留 `/tmp/report.md` 等路径输入，不能简单把所有 `/` 开头内容都拦成命令。来源不同的同名项保留原生标识及覆盖结果；按 engine、运行环境、cwd 和目录版本隔离缓存，远端不能读取本机 skills 充数。主进程重新验证条目和会话身份，renderer 不能用任意文件路径冒充已加载技能。

实施优先接通 Codex 的结构化 skill 与 OpenCode 的 command/skill 两条路径；Pi 在现有扩展桥中增加目录事件和显式命令类型；Claude 在找到可靠的同 worker 命令路径之前，只能展示明确的终端降级入口，不能标为对话可执行。统一列表不要只增加六个硬编码项的图标，也不要把系统操作、模板展开和技能引用混成同一种普通 prompt。

文档依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Claude skills](https://code.claude.com/docs/en/skills)、[OpenCode V2 commands](https://dev.opencode.ai/v2/docs/commands/)、[OpenCode V2 skills](https://dev.opencode.ai/v2/docs/skills/)。Pi 以本机 0.85.1 的 `docs/rpc.md`、`dist/core/extensions/types.d.ts`、`dist/core/agent-session.js` 及上述真实进程探针为准；安装包文档部分例子仍用 location/path，实际返回已是 sourceInfo，产品应采用实测契约。Claude Mods API 在线文档本轮读取失败，不据此推断存在可用的通用 command.run 路径。

前期探针维护校验：`node --check scripts/slash-command-probe.mjs` 通过；当时 `npm run check:notes` 验证 321 篇 harness Notes，0 errors，17 条既有外部链接诊断。该阶段只新增验证脚本并维护文档；随后产品实施如下。

### 公共控制与命令系统落地

2026-11-02，确认原有 CodexConversation、ClaudeConversation、NativeConversation 重复维护快照初始化、发布计时器、revision、模式/epoch 校验、提交去重和 busy 状态，而且存在漂移：Native 接受 100000 字符而显示只保留 32000；Claude 发送中仍可切换视图；各家 commandId 指纹字段不一致。这些职责已通过组合收敛到 `conversation-session.ts`，三条入口均使用同一控制实现，没有把 Claude 或 Codex 强行继承进 NativeConversation。

公共提交预算统一为 32000 字符、每个运行实例最多 2000 个提交身份；身份包含操作类型、输入/条目、控制代次以及发送方式和附件。重复身份复用原 promise，改变语义则拒绝；失败身份也保留，不自动重发。发送或设置更新期间禁止切换模式，关闭后拒绝控制。显式纠偏以 `capabilities.steer` 声明，当前仍只有 Codex/OpenCode；公共校验按能力判断。输入框不显示投递方式选择，普通发送使用原生输入行为，按 `capabilities.liveInput` 决定能否在工作中派发。原有 renderer outbox、原生 RPC pending 与提交去重承担不同职责，分别保留。

`conversation-catalog.ts` 统一目录刷新、版本与调用回执，目录按 controller 实例持有，工作目录来自原生启动参数。IPC 的 invoke 只传 entryId、catalogRevision、arguments、commandId 与 controlEpoch，不能传任意 skill 路径；路径或实际原生 ID 由主进程已加载条目闭包持有。调用前检查当前控制权、目录版本和空闲状态。目录最多展示 1000 项，回执保留最近 100 项。原生命令目前不进入普通文字 outbox，不支持忙时排队，也不附带输入区文件引用；输入区有附件时禁用调用。

| 引擎 | 产品目录与执行路径 | 本轮真实进程验收 |
| --- | --- | --- |
| Codex | `skills/list` 刷新；显示名/说明采用原生 interface；`turn/start` 携带 text 与 skill 对象 | `codex-conversation-cli.test.ts` 的 structured skill 用例通过，localhost 请求同时含技能正文和参数，thread 不变 |
| OpenCode | `/api/command`、`/api/skill`；嵌套命令走 `/command`，skill 走 `/prompt.skills`；空目录有界重读并允许手动刷新 | `opencode-conversation-cli.test.ts` 通过，`team/review` 参数和自建 skill 正文均进入本地模型；既有发送、设置、取消和原生终端互通回归通过 |
| Pi | 通过现有认证桥读取运行中 `pi.getCommands()`；显式 invoke 才设置 `expandPromptTemplates: true`，原生侧再次检查名称/source | `pi-conversation-cli.test.ts` 通过，本地扩展命令写入标记且没有模型请求，普通发送与取消回归通过 |
| Claude | 复用只读 SDK initialize 取得模型与 commands；`/clear` 用同 worker Mods command.run 执行并确认新 session，其余条目切换并提交给所属原生终端 | 早期 `claude-conversation-cli.test.ts` 90.1 秒验证目录、流式输入、审批、原生 Esc、Bash 停止和只关闭所属 worker；本轮实际指令执行验证见“原生指令执行与会话切换” |

命令回执表示 native API/扩展已接受调用，不表示模型完成任务。Pi 的 `pi.sendUserMessage` 是 void API，因此其 accepted 表示交给原生调度，不是扩展 handler 已完成；真实测试另检查 handler 的文件结果。请求异常保守记为 unknown，保留草稿及错误供用户检查，绝不自动重试。普通消息仍使用原生 user item 正文回显确认，不用技能展开正文去匹配原始斜杠文本。

菜单保留适配过的会话操作，并加入各家原生目录、类型图标、类型/终端执行标识、名称和说明搜索、参数提示、加载/失败与刷新入口。Tab 补全不执行，Esc 保留草稿；冒号命名和已知嵌套路径可识别，普通绝对路径保留文本语义。原生已接受时清空未被用户修改的草稿，保存原始命令到输入历史，并展示接受反馈。采用统一类型图标；原生自带图片图标、参数候选值和目录变更推送未接入。Pi、DSH 增加安装包内置目录，目录外单段指令也可明确选择原生终端执行；终端交接使用独立 handedOff 回执，不显示为原生命令成功。

验证记录：`npx vitest run --project=unit` 对 conversation-commands、native-conversation、codex-conversation、claude-conversation、opencode-conversation、conversation-outbox、conversation-input-history 七个测试文件共 66 项通过，包含四家“调用后立即 dispose，原生派发不得发生”的竞态断言。命令菜单/输入历史浏览器用例最终 7 项通过。浏览器首轮完整 43 项中 42 项通过，发现 effort 搜索遗漏原始 id，修复后该用例及相邻强度选择用例复测 2 项通过。`npm run typecheck`、相关实现 ESLint、`npm run i18n:check` 通过；`npm run check:notes` 为 321 篇、0 errors、17 条既有外部链接诊断。

上述验证使用隔离夹具或 localhost 模型。真实供应商、远端、其它 CLI 版本与 Claude 同 worker 技能执行未验收。工作区实施前已有大量未提交变更，先保存本地基线到忽略目录 `artifacts/conversation-command-baseline`；不能把这些既有变更一起宣称为本轮改动。

### 图片产物、预览与参考图复用

输入区图片附件使用缩略图卡片，覆盖拖入、截图粘贴、文件选择、工作区图片引用与产物参考图。卡片保留文件名和移除按钮，点击可放大，Esc／关闭按钮／背景点击退出；关闭后焦点回到预览入口。图片从既有本地资源读取器加载，不向草稿存储写入图片字节；草稿重建时按引用路径恢复。加载或解码失败显示不可用提示，仍能移除；普通文件保持标签展示。预览不改变现有附件限额、提示词包装及原生图片发送路径。

2026-11-02 输入图片预览验证：`playwright test` 的 conversation-attachment-preview、conversation-attachment-recovery、conversation-context 与 conversation-composer-layout 共 10 个不同用例分轮通过；首轮两个 page.goto 加载超时的用例以单 worker、60 秒超时复跑通过。覆盖拖入／粘贴缩略图、放大关闭与焦点恢复、草稿重建、移除、不可用提示及原生图片路径发送。主 Agent 查看 `artifacts/conversation-composer/attachment-preview.png`，380px 窗口无横向溢出。`npm run typecheck` 和两个相关组件的 ESLint 通过。图片读取使用固定 PNG 浏览器夹具，未执行真实桌面拖拽或模型视觉调用。

对话模式已增加图片产物链路，复用当前 CLI 的工具/skill，不新增生图供应商、密钥配置或独立执行会话。图片输入能力不等于生图能力：实际生成仍取决于当前原生工具和账户。菜单中的真实 skill 入口继续沿用原生目录，不从名称推断生成能力，也没有添加伪造的通用 `/image` 指令。

`ConversationItem.images` 保存图片身份、loading/ready/unavailable 状态、本地缓存路径、MIME 和错误；snapshot 不携带图片 Base64。主进程与 Pi 扩展共用 `conversation-images.js`，按图片内容哈希保存到会话资产目录下的 `images/`。每张最多 8 MiB，每个结果最多 8 张；读取本地文件时有界读取，按文件签名接受 PNG/JPEG/GIF/WebP，拒绝 SVG、非图片、空内容及自动网络读取。原文件被覆盖后已缓存的图片仍可用；缓存是持久文件，不随单个 worker 临时目录清理，目前没有自动总容量回收。现有会话恢复机制之外，不新增图片会话持久化保证。

| 来源 | 接入行为与验证边界 |
| --- | --- |
| Codex 0.166.0 | 本机 `app-server generate-json-schema` 确认 `imageGeneration` 的 savedPath/result/fileId、failure 等字段。转换器支持 savedPath 与内联 result，保留生成中/失败状态。只有 fileId 而无可读取数据时明确显示不可用，不猜测附件 payload。该事件投影有单元覆盖；真实生图服务未调用 |
| Pi 0.85.1 | 原生扩展观察 assistant/toolResult 的结构化 image 内容，落盘后才经认证桥发送引用。真实 CLI + localhost 模型调用测试工具，返回 PNG 并显示为 ready，快照无图片字节；普通发送、去重与取消回归通过 |
| Claude/OpenCode/Codex/其他 NativeConversation | 已完成结果中的显式本地 Markdown 图片链接进入同一缓存与卡片。只识别 `![说明](路径)`，不扫描任意日志、目录或普通文件名。Claude/OpenCode 事件投影有单元覆盖；Codex 真实 CLI 验证同一 skill 会话返回本地图片后形成 ready 产物 |

原生探针有两个明确边界：在 localhost Responses 夹具直接注入 `image_generation_call`，Codex 本轮未发出对应会话图片事件，不能把这一模拟载荷当作真实生图服务验收；Pi 的 `sendMessage` 自定义展示消息未经过当前扩展的 message 事件回调，因此不把 custom message 图片列为支持。改用可观察的文件结果和真实工具返回进行端到端验证，不新开旁路会话冒充原生结果。

图片卡片不藏进已完成过程折叠区；支持缩略图、模态放大/Esc 关闭、保存和“作为参考图”。保存 IPC 只接收 terminalId/itemId/imageId，主进程查找已登记产物，再打开系统保存对话框复制到用户选择的位置；取消不写文件。参考图保留已有草稿，去重后加入现有附件区，遵守 8 个附件上限。Codex 下一轮仍走 localImage；其他引擎沿用文件上下文，不能据此宣称支持直接视觉输入或图像编辑。丢失、超限或解码失败的图片显示不可用，保留文字记录，不出现可点击的无效保存/引用操作。

浏览器 `conversation-images.spec.ts` 与 `conversation-context.spec.ts` 共 5 项通过，覆盖预览、保存请求、缺失文件、草稿保留和下一轮 localImage；真实系统保存窗口未自动操作，主进程导出函数另用真实文件测试身份校验、取消与复制。`codex-conversation-cli.test.ts` 的 generated image 用例及 `pi-conversation-cli.test.ts` 通过，使用真实安装 CLI、隔离目录、固定 PNG 和 localhost 模型，不代表调用了生产生图服务。

收尾回归：图片、输出、四家适配器、命令、上下文和 outbox 共 9 个单元测试文件、77 项通过；缩略图按可视区域延迟加载后，图片浏览器用例 2 项复测通过。类型检查、相关实现 ESLint、国际化检查和 diff 空白检查通过；Note 检查 321 篇、0 errors，保留 17 条既有外部链接诊断。
