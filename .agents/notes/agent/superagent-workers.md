---
{
  "schema": "harness-note/2",
  "id": "e546b79c-cdf2-49e5-8efd-8dcf5c11b017",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-13T16:43:44.632Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a591e250-1719-48a5-8750-663fdb00681e" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/61ec1bb4-e349-4aa2-a10b-346afef29920" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e1bdfc5f-a4ff-4dea-b7e3-965ab2ffe161" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/91dac1f7-1814-400f-802e-5229ff6b0228" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb67585-99d2-49a1-975e-e88fe85e7ed6" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/desktop-service.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/desktop-chat-turn.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/worker-settings.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/workers.ts", "symbol": "SuperAgentWorkers", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/terminal/codex-conversation.ts", "symbol": "CodexConversation", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/worker-mcp.ts", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/controlled-commit.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/SuperAgentWork.tsx", "role": "entry" }
  ]
}
---

# SuperAgent 受管 Worker 与 MCP 闭环

Worker 首次提示词保留目标、约束、checkout／branch 与输入原文；同一已确认原生线程续接只发本轮原文和实际变化的目标、目录或约束。版本／来源变化仅提示补读，HEAD 及内部工作 ID 留在工具数据中。新增与撤销约束明确区分，截断预览不得推断撤销；历史丢失或接收记录不在内存时保守补发完整范围。固定协作与权限规则归线程系统指令，状态询问只核查和汇报。截断输入保留版本和续读位置，原始账本与宿主审批不变。完整设计与验证记录见[引擎迁移记录](ideas/superagent-harness-reliability.md#提示词精简实施)。

## Problem

P1 的工作记录和 P2 的受控目录需要接入真实执行。既有 Codex 对话桥依赖终端连接来建立线程，其显示长度、内存命令去重和未知请求转交终端的规则不能直接承担长期工作输入。Worker 还必须受宿主停止、工作目录身份和具体 Git 批准约束，不能因视图关闭或 MCP 失联继续脱离管理。

本决策维护[实施计划](ideas/janus-superagent-mvp-plan.md)的 P3 受管执行：真实 Codex 的启动、补充、原生决策、汇报及停止。P4 已将入口升级为[同一 Janus 的分派与容量调度](superagent-scheduling.md)，P5 已接入[共享上下文与原文召回](superagent-context.md)，P6 已补齐[生命周期与应用恢复](superagent-lifecycle.md)，完整侧栏／Island 归 P7。

## Decision

### Codex 与 Claude Code

2026-11-12 用户选择 Windows 原生 Claude Code，沿用原生权限和用户审批。Codex／Claude Code 各自保存模型和推理强度；默认 Worker、允许使用的引擎与配置编辑独立设置。worker-settings.json 保存为 version 3，保留 active 和 profiles，新增 enabled；旧配置保留原默认并将此前支持的两种引擎视为已启用。默认引擎必须处于启用集合中，编辑另一引擎的模型不会切换默认。默认引擎只决定未指定类型的新工作；work_route 的 new 可带 workerBackend 明确选型，继续现有工作不允许换引擎。execution 与 lifecycle 记录保存 backend，旧记录缺省 Codex，重启恢复显示实际引擎；所有类型共用容量、投递、报告、环境 lease 和空闲回收。

桌面 DesktopSuperAgentService 在新建／继续／重开与手动启动时检查启用策略，启动命令解析前再次读取当前策略。禁用不停止正在运行的工作，但拒绝新的派发和补充；不静默更换引擎。desktop-chat-turn 将 `#` 选择绑定到宿主已接纳的输入身份，模型漏传时补齐、传错时拒绝，steering 输入各自保存约束。宿主仍校验既有工作引擎，受管执行、租约和原生审批继续由固定引擎制品负责；未改写 node_modules 或生成新的引擎包。

ClaudeWorkerEngine 复用原生 ClaudeConversation 的后台会话、Mods 事件桥、模型目录、问题与审批。仅为本次启动配置严格 MCP 列表，工具发现须收到真实 tools/list 的宿主回执；report_work 等工具的身份、去重和持久化仍由共同宿主控制。原生输入队列接受补充只表示已投递；新轮次等待完整原文的原生回显，不截断后冒充确认。保留原生权限与用户规则，不启用 bypassPermissions。Claude 原生 Windows 没有 Codex MXC 的文件／命令隔离，界面明确说明；本次选择不改变 Codex 的权限工厂。

Claude 的 --bg --resume 在携带新的执行配置时，会显式复制原历史到新会话。宿主只接受原生回执明确关联原会话和新后台 job 的复制，保存新 providerSessionId，并将 recovery 标为 forked；工作身份和引擎保持不变。不能确认关联或历史不可用时明确失败，不伪装为同一原生会话，不自动重放输入。新 MCP 凭据和临时目录不沿用已撤销的旧执行配置。

停止前保存创建时间绑定的进程树，并先请求原生 stop，再验证／终止该树内残留进程；CLI 返回成功本身不释放执行名额。启动归属不明、停止失败或落盘失败均保留占用。普通用户终端和共享 daemon 不属于停止目标。原生适配器仅在 managed 启动时使用这些附加证明。

### Codex 进程、线程与输入

[受管传输](../../../src/main/terminal/codex-managed-transport.ts)直接拥有 `codex app-server` 的 stdio 子进程，不启动 TUI；[CodexConversation](../../../src/main/terminal/codex-conversation.ts)复用原生事件与决策投影，并保留原终端通路。[Worker 协调器](../../../src/main/janus/superagent/workers.ts)按 workId／executionId 管理实例，绑定真实 providerSessionId 与 turnId。原生协议依据为 [App Server 文档](https://learn.chatgpt.com/docs/app-server)，实际兼容证据为本机 Codex 0.166.0。

完整输入先经 P1 保存，发送前将投递记为 unknown，收到原生确认后才记 delivered；该确认不代表语义上已纳入。活跃轮次使用 `turn/steer` 和预期 turnId。原生问题／审批阻塞时，输入保持 pending，解除后按原状态投递；轮次结束竞态由宿主串行核对。空闲后的明确补充启动新 execution，并恢复最近一个有真实 session ID 的线程；不因较新的失败启动丢掉旧会话。停止会取消尚未开始的续接，不自动重发结果不明的输入。

正常轮次结束、无输出或进程退出都不产生 ready。只有当前执行经 MCP 保存的明确报告能更新结果；旧执行和重复报告保留其历史语义，不重复通知或推进输入覆盖。后到的 pending／unknown 输入使旧 ready 不再覆盖当前要求；原生失败仍显示失败，不以此前 ready 掩盖。

### 普通工作交付后的证据复核

带 outcome 的普通工作在当前报告、已送达输入和原生进程退出都确认后，使用派发对话所选 Janus 模型做一次独立于聊天回复的只读复核。主进程仅提供工作原文、报告和分配 checkout 内的文本／图片读取，以及终态提交；不开放 Shell、编辑或额外委派。明确失败的检查不能提交 ready，未运行的检查仍可如实记录，但 ready 继续只表示 Worker 已交付。

复核必须完整读取相关原文及报告，在后续模型请求中看到证据，并逐项覆盖当前验收。判定通过或不符合的每项都必须引用实际读取的产物；提交前再次校验文件哈希。只有报告自述、同批尚未进入模型上下文的读取、伪造引用或变化中的产物不能支持通过。运行界面不可见、主观审美或证据不足标为 unverified；该机制不承诺模型的语义判断必然正确，也不把源码修改等同于已更新安装版。

验收契约绑定到提供它的输入。直接追加给 Worker 的新指令可以继续执行，但若没有刷新验收条件，旧条件不能支持新指令的通过或自动返修，报告明确保留未验证状态。宿主安排的有界返修复用已核对的同一契约。

同一路径读取到新哈希后，旧文本／图片引用立即失效；不能通过重读新版本保留旧版本的验收依据。同内容重读和当前版本的证据仍可使用，判定所依据的版本必须与提交时的实际文件一致。

只有有证据的具体缺口能使用 assignment 中的返修额度，最多一次，沿用原工作、约束、环境和全局队列。修复后再次复核仍不通过时保留缺口，不能继续循环。补充需求和明确停止使旧结论失效；重复事件不重复派发，重启只把中断复核标为未验证，不重放模型或返修。work_plan 的开发／测试链路继续使用自身控制器，避免叠加两套返修。单次复核限十二轮和三分钟，异常、模型不可用或不能确认返修入队均保留未验证状态。工作卡和对话分别显示复核结论与 Worker 报告。

本次消费端固定引擎为 `c3b228697d8a8e02`。独立复审通过：正式引擎定向回归48项、两项原始缺陷复现、图片证据3项、复核状态浏览器1项与制品校验1项均通过；严格类型、桌面隔离构建及固定包安装字节检查通过。首轮发现的排队撤销丢失和旧哈希引用误通过已修复。固定验收、源码哈希和结果位于 `artifacts/superagent-quality/`。这些检查使用可控模型／原生夹具，不代表真实云模型语义效果或图片审美验收；当前运行安装版和用户工作账本未替换。

### 权限与停止

Codex 每次启动和恢复都采用 [P2 lease 与权限工厂](superagent-environments.md)，派发前复核，运行中持续检查。线程显式使用本地执行环境及分配目录；`environments: []` 会关闭执行工具，不能用于表示受限的本地环境。启动分别诊断 CLI、登录、可信目录、本地环境和 MCP 就绪问题，不替用户修改全局模型、账户或规则。

[启动配置](../../../src/main/janus/superagent/worker-launch.ts)保留可用原生配置及 developer instructions，追加本次协作约定。继承 MCP 逐项禁用，本次只启用宿主桥；插件、apps、hooks、原生多 Agent、JS／code-mode 等额外执行通道在本次进程内关闭，并在界面披露。原生命令／文件审批支持用户确认具体操作和扩展范围，权限请求使用独立的原生响应结构并限制为当前轮；持久网络／命令规则仍不开放。配置叠加与能力名称以 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)和实际版本为准；能力不足明确失败，不降级为 full access。

受管启动的目录信任和登录复用原生启动确认，在工作卡中等待并于配置读回后继续。取消可以恢复，停止终止待启动承诺。提交仍走 commit_work，标签和非强制推送走 git_work；后者固定目的地及当前 HEAD，复用具体审核、执行前核对和持久回执。执行目录改选后不恢复旧目录的原生线程。

停止先撤销桥接能力并阻止待续接，立即请求原生中断；原生进程终止与宿主队列收尾并行，原生失败也继续拒绝未决提交、排空输入、报告和受控提交。两者确认后才释放 lease。Windows 受管 Codex 在发送 initialize 前抓取并持久保存进程树的 PID 与原生创建时间；启动与停止共享抓取承诺，关闭发生在抓取或写盘期间也不会继续初始化。终止后通过查询句柄和 WaitForSingleObject 核验退出，并发现启动后新增的残留子进程；主进程退出或 taskkill 返回成功都不能单独证明整树已结束。终止命令失败或主进程已退出后的明确重试，按创建时间复核句柄并终止残留子进程，不按裸 PID 操作。原始退出原因通过独立诊断事件保存，停止失败不覆盖首次执行错误；重试确认成功后移除过时的占用错误。缺少进程身份的历史记录仍沿用已验证 Windows 重启恢复，详见生命周期文档。

Windows taskkill 的诊断与 Codex 的 UTF-8 协议流分别解码。引擎对 stdout、stderr 独立流式解析，优先采用通过完整校验的 UTF-8，否则回退到中文 Windows 的 GBK/CP936；保留跨块字符，并在 close 确认管道排空后组合最多 3000 字符的诊断。Windows 对已终止但仍被持有句柄的进程也可能返回[拒绝访问](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)，因此失败结果须结合实际退出核验，不能只匹配错误文案。核验失败、权限不足或持久写入失败都保留占用和原始诊断，跨重启的恢复条件见[生命周期](superagent-lifecycle.md)。

此前停止恢复验证使用引擎包 `96c0c94a7876277d`，六包、锁文件和已安装字节均已校验。Main 执行引擎 `npm exec --workspace=@janus-agent/janus-agent -- vitest run tests/codex-managed-transport.test.ts tests/windows-process-tree.test.ts tests/native-managed-requests.test.ts --maxWorkers=1`，23 项通过，包含真实 Windows 父子进程终止与创建时间不符时保留新进程。消费端 lifecycle／scheduling／managed-recovery／managed-decisions／engine-packages 五文件 43 项、Worker 浏览器 23 项、真实 Git Worker 17 项通过。Git 集成调试时的 15 秒上限出现超时，恢复仓库 60 秒默认后 17 项通过。显式设置 JANUS_SUPERAGENT_CODEX_BINARY 后，真实 Codex／MXC、Electron MCP、续接、历史重建及后台停止集成 1 项通过；模型响应为本地协议夹具，不是云模型语义验收。最终包另复验 lifecycle 与 artifact 21 项通过。

严格未用项类型检查、`npm run build:check`、包边界、组件定向 ESLint 与 Notes 校验通过（340 篇、0 errors、17 条既有外链诊断）。本次范围内 diff 空白检查通过；全仓检查另有 JanusIslandExpandedShell.tsx 的既有行尾空格，未改写。构建产物在 artifacts/build-check，验证摘要在 artifacts/worker-stop-recovery；未替换运行中的应用或安装版，未运行完整 verify。

2026-11-07 用户明确当前禁止 Worker 再委托：不得创建子 Agent、另启执行器分派任务或自行向其他 Worker 转派，工作分派仍由 Janus 负责。现有原生多 Agent 关闭约束继续保留；DSH 的子 Agent 能力不构成本项目的实现授权。相关讨论订阅已认可为后续方向，但尚未实施，边界见[架构设计记录](ideas/janus-superagent.md)。

### Worker 自主验证与审批本地化

2026-11-11 用户确认当前 checkout 的整个 `.agents` 目录可由 Worker 写入，以正常完成 Notes 维护，其他文件系统及 Git 权限保留。启动指引明确使用普通文件工具维护本轮相关 Notes，不因路径位于 `.agents` 就申请额外权限；仍遵守仓库指令、Task 归属和多人协作约束。无需新增 Note 专用 MCP。实际原生 profile 和生效时机归 [环境决策](superagent-environments.md)。

2026-11-10 用户要求测试继续由 Worker 的终端模型自主选择、执行、修复及重跑，宿主准备必要环境。本次引擎在每次 execution 启动时创建独享 scratch，将其作为额外可写根并注入 TMP、TEMP、TMPDIR；仅在原生进程树确认结束后清理。停止失败保留目录和租约，确认停止后可重试清理；新 execution 使用新目录，应用崩溃遗留目录不在启动时自动删除。用户全局配置及真实仓库 Git 元数据保护保留。

真实 Windows MXC 会在 shell 启动时重写 TEMP/TMP，因此只传环境变量不够。Worker 指引明确在 PowerShell 测试／构建命令前执行 `$env:TEMP=$env:TMPDIR; $env:TMP=$env:TMPDIR`，再运行项目原有命令。隔离测试仓库允许在 scratch 内初始化、写本地配置和提交；该许可不适用于真实项目 Git 元数据或全局配置。测试仍由 Worker 调用原生命令，不增加宿主测试调度器，也不按 npm 命令名自动批准任意扩权。

本地集成测试还需要回环通信。原生网络代理保持开启，配置仅允许 localhost、127.0.0.1 和 ::1，并启用本地绑定；外部目的地不在默认允许列表。实际 Windows 探针验证回环 HTTP 正常、直接外部 TCP 被权限拒绝，以及真实 Git 元数据和另一执行 scratch 不可写。任务确需新增外部网络或文件访问时仍走原生具体审批。

原生 permissions 请求在展示契约中显式携带 permissionScope=turn。Worker 和终端会话的标准审批按钮使用 terminal 翻译资源，区分允许一次、本会话允许、允许本轮权限及拒绝并停止本轮；响应 ID 和原生权限封装不变，未知动态选项保留原文。此次同时补齐 Worker 模型设置中文文案，移除旧 details 负边距对新模型面板的影响，窄侧栏回归保留。

最终引擎包标识为 ddcef3f83e76cb75。Main 使用真实 Codex Windows MXC 生产权限执行用户提供的 superagent-workers／superagent-ipc 两组测试，22 项通过；初次完整沙箱运行暴露回环 HTTP 被拒绝，修复代理允许列表后通过。浏览器、IPC、原生决策回归 25 项通过；真实权限、真实 Worker 与产物校验 7 项通过，包括 Worker 自主执行临时 Git 和原子替换时原生命令审批计数为 0。真实模型响应使用本地协议 fixture，不是付费模型行为验收。静态类型、双语、定向 lint 与 Notes 校验通过；Notes 保留 17 条显式外链诊断。未运行全库 verify。

证据位于 artifacts/superagent-autonomous-tests。package:prepare 和 Windows NSIS 构建完成，包外中立目录的模块图／LLM 运行时及可见 GUI 启动通过；478 个构建文件、177 个引擎文件逐字节匹配，latest.yml 的 SHA512 和大小校验通过。0.9.8 安装包及 blockmap、latest.yml、BUILDINFO.json、SHA256SUMS.txt 已覆盖 release/superagent/installer，并复核复制后哈希；安装包 SHA256 为 f985bf791385080aac5ae8c9b43ffe2f39d3b02841f0fe8300e9378174a07034。版本不变，包含当前 checkout 既有未提交修改；未执行安装或公开发布。新权限在更新应用后启动／续接的 Worker 生效，已有原生进程不热改配置。

### Worker 默认设置与逐工作覆盖

桌面通过[设置适配器](../../../src/main/janus/superagent/worker-settings.ts)装饰引擎公开的 ManagedWorkerEngine factory；启动、输入投递、租约、原生权限、停止和执行状态仍由固定引擎包负责，不复制后端或修改包字节。默认配置保存到应用数据目录 janusx/superagent/worker-settings.json，模型留空表示原生默认。当前支持受管 Codex 和 Claude Code；允许使用不等于已安装或已完成原生登录，启动检查及失败诊断沿用原生通路。模型 ID 和强度格式在宿主验证，实际模型／强度组合在启动时按原生目录验证；无效配置阻止发送首条输入。

强度解析不再使用固定能力白名单：只检查非空标识格式和 64 字符上限，是否支持由当前 Worker 原生模型目录决定。这样目录提供的 ultra、max 或新增标识不会在前置解析时被拒绝；目录未声明的组合仍在修改选择前拒绝。全局设置没有运行时目录，因此只提供常见值建议并保留已保存的未知标识，明确说明启动时校验。未知标识可保存不代表可执行，也不会自动降级为别的强度。

默认设置与单 Worker 设置共用 settings 命名空间的强度翻译和错误映射，含 xhigh／max／ultra。按钮摘要、当前配置、下轮生效和选项均使用同一文案；未知原生强度直接显示标识，提交值始终保持原始 token。已知参数、能力和状态错误转为中英文可操作提示，去掉 Electron IPC 包装；未识别的原生错误保留原始诊断。

2026-11-11 强度统一回归：`npm run test:unit:fast -- tests/unit/superagent-worker-settings.test.ts` 9 项通过，覆盖 6-astra／ultra、max、新目录标识、非法格式、未知组合拒绝和下一轮生效。Worker 浏览器回归首轮 24 项通过，剩余一项仍断言旧错误文案；更新后执行 `npm run test:browser -- tests/unit/superagent-work-ui.test.ts -t 'defaults|bilingual|single Worker'`，三项全部通过，分阶段覆盖 25 项。Main 已查看 `artifacts/superagent-worker-settings/effort-ultra-{zh,en}.png`。严格类型、定向 ESLint、双语、范围内 diff 及 `build:check` 通过，构建日志为 `artifacts/worker-effort-build.log`。Notes 340 篇、0 errors，保留 17 条既有外链提示；模型能力及 IPC 使用本地夹具，不代表已向真实 6-astra 服务发起推理请求。仅更新源码和 artifacts/build-check，未覆盖运行中的 out 或安装版。

右侧覆盖按 workspaceId、workId、executionId 校验当前实例，过期、恢复快照、停止中和已停止的执行均不可修改。运行中追加沿用当前轮的模型；覆盖在下一新轮发送前应用，并等待 thread/settings/updated 的实际模型与强度读回一致。五秒未确认或设置请求失败时不发送输入；本地配置失败使用 ManagedInputDeferred 保留 pending，真实输入 RPC 的不明结果仍保留 unknown。

完成一轮后的续接会更换 execution，因此桌面按原生线程保留本次工作选择及最初的原生基线，恢复默认不会把已覆盖的模型误当基线。覆盖只存在当前应用会话内，最多保留最近 256 个线程；重启后由已保存的默认值重新配置明确续接的执行，不自动恢复覆盖或启动任务。全局默认值不改写已有 Worker 的选择，右侧“使用默认设置”明确取一份当前默认值用于下一轮。

继续使用公开 factory 和原生设置命令，避免壳体另建调度器；代价是新模型可用性要到原生目录可用时才能验证，逐工作覆盖尚未持久化。若增加其他终端后端或要求跨重启保留覆盖，应先扩展引擎能力／持久契约，不在桌面绕过执行和权限边界。验证入口为 superagent-worker-settings.test.ts、superagent-ipc.test.ts、superagent-workers.test.ts 和 superagent-work-ui.test.ts；这些夹具与真实临时 Git 验证不等于真实云模型或新增后端验收。

### MCP 与受控提交

[随应用构建的 stdio MCP](../../../src/main/janus/superagent/worker-mcp.ts)暴露 `report_work`、`read_work`、`read_resource` 和 `commit_work`。它通过只监听 loopback 的 [broker](../../../src/main/janus/superagent/worker-broker.ts)连接宿主，随机能力凭据绑定具体实例，不以模型提供的 workId 授权。心跳／请求失败终止桥接，旧实例的凭据撤销后不能继续读写。入口为主构建旁的 `worker-mcp.js`；IPC 构建在 `chunks` 时回退一级定位，Electron 以 `ELECTRON_RUN_AS_NODE` 启动。

报告先持久保存再回执。新桥接的 report_work 要求结构化 report：完成事项、产物引用、验证方法／状态／结果／证据、限制、问题和可选 Markdown 说明。至少提供一项验证状态；未运行与不适用必须说明原因，问题报告须有具体问题，失败报告须说明阻塞。摘要是一句最多 160 字符的用户可读结论，拒绝换行、UUID、长哈希和绝对路径；读取输入、checkout、分支与 HEAD 等过程信息归详细证据。桥接和宿主分别校验，错误作为工具错误返回，Worker 可修正后重新提交。

结构化正文保存为不可变 janus-worker-report/1 JSON 资源，仍复用原报告身份、哈希、投递覆盖与重复提交冲突检查。workId、executionId 和已投递输入由宿主绑定；这些关联不证明语义覆盖或验收。SuperAgent 工作卡提供报告引用及审阅规则，按需读取同一资源核对当前要求、失败检查和缺项。现存旧桥接可继续提交文本，历史正文不迁移、不补造验证。结构化只保证字段约束，不验证 Worker 证据真实性，也不新增 accepted 状态。

2026-11-11 问题闭环：当前执行的最新 `question` 报告在工作未关闭、尚无回答关联时进入对话待处理区，兼容旧文本和结构化报告；不会把所有历史问题重新弹出。用户回答或选择补读前文后，以稳定 eventId 将输入、派发上下文和 work.questionResponses 关联一起保存，再通过既有调度继续原工作。旧报告正文不修改；重复提交复用原输入，已回答或被新报告替代的问题拒绝新的过期回答。关闭工作后不再待答。原生提问继续使用原生请求及回传协议，宿主问题卡不伪造原生 RPC。问题报告与 failure 的 idle 展示分别为等待补充、已汇报受阻，不再声称没有汇报。报告仍不会无条件自动唤醒协调模型；正常派发自动带前文，当前旧问题提供明确的补读继续入口。

P5 起读取共用工作卡与来源覆盖，只返回本工作材料；超大正文依据原生工具输出保护及实际序列化字节数分页，返回版本、实际范围和续读入口，避免 Codex 再截断正文却保留旧范围。这只是内部传输边界，不新增用户读取额度。可选原生日志独立存储，单 execution 上限 2 MiB、总量 32 MiB，截断／缺失明确显示，清理不删除用户输入和正式报告。

Worker 的 Git 元数据仍只读。`commit_work` 提交明确文件和说明后，宿主展示路径、字节数、哈希与差异；用户批准仅针对该快照。文件变化、分支／HEAD 变化、已有暂存内容、保护目录、别名或符号链接均阻止错误提交。受控 Git 禁用 hooks、fsmonitor、签名及配置的 clean／smudge／process filters；实际提交使用私有 index、已核对原始字节和条件更新 HEAD，保留已有可执行模式。执行中提交与停止串行收尾，未知结果不重放；不隐含 push、合并或清理授权。

### 现有聊天和原生请求

[SuperAgentWork](../../../src/renderer/src/components/janus/SuperAgentWork.tsx)嵌入现有 JanusChat，P4 起由正常对话安排新工作或继续既有工作，卡片提供可配置容量、环境批准、原生决定、停止、关闭与持久报告。P3 的手动运行／补充入口已移除。导航只换投影，旧异步响应与控制身份不能串到新工作区；详细归属与报告交付规则见[调度决策](superagent-scheduling.md)。

命令／文件审批、`request_user_input` 选项和文字回答使用现有组件及原生请求 ID；产品尊重原生功能是否可用，不替用户开启实验选项。MCP elicitation 支持可验证的简单表单和 URL 操作，明确接受／拒绝／取消；无效必填答案保留待答状态。未知请求或无法安全映射的 schema 显示阻塞与停止能力，不自动批准，也不要求打开不存在的 Worker TUI。

2026-11-10 排查设置工作 `4e024d6c-6aeb-43e3-8104-ddc382af98ec` 的“原生请求暂不支持”阻塞：本机记录先为 waiting，随后观察到 stopped 且 stopConfirmed=true，工作仍未关闭。安装版原生适配器会将无法归入当前线程的请求置为 needsTerminal，但界面此前只显示通用提示，原生错误未展开；本次请求的具体方法未被保留，不能据此断言是哪种审批或表单。桌面现显示可用的 conversation.error，并说明停止后的恢复方式；只有确认停止且工作未关闭时才开放既有继续接口，保留 workId、来源会话及失败重试的 eventId。停止中不开放重试，停止后的旧阻塞提示不再显示。不自动批准未知请求，也不宣称已补齐该原生协议类型。定向浏览器／原生决定回归 `node node_modules/vitest/vitest.mjs run tests/unit/superagent-work-ui.test.ts tests/unit/codex-managed-decisions.test.ts --maxWorkers=1 --minWorkers=1` 共 22 项通过；证据为夹具，不代表安装版已更新或真实阻塞已续接。

2026-11-10 用户反馈 `Allow the janus_worker MCP server to run tool "report_work"?` 等权限提示频繁打断执行。引擎启动配置此前没有区分内部通信与工具执行审批。现对 `janus_worker` 显式设置默认 `prompt`，仅 `read_work`、`read_resource`、`report_work`、`commit_work`、`git_work` 使用逐工具 `approve`。前三项仍由宿主凭据绑定当前工作／执行；后两项仅免除工具调用前的重复确认，实际 Git 操作继续等待宿主对路径、内容、HEAD 与目标的具体批准。未知工具、原生 elicitation、沙箱扩权与网络权限不继承此放行。配置仅注入受管线程，不修改用户全局配置；已有运行线程需结束后重新启动或续接才能获得新配置。实现归 agentX `superagent/worker-launch.ts`，桌面通过固定产物消费。

### Codex 原生请求归属与答复

2026-11-10 用户要求直接适配 Codex 原生请求，停止／重试仅保留为恢复操作。核对本机 Codex 0.166.0 生成的 ServerRequest、旧版审批响应和 ThreadReadResponse schema 后，确认受管适配器曾把非当前主线程的请求直接判为不支持；applyPatchApproval／execCommandApproval 使用 conversationId，也会被同一条件挡住。原始故障请求的完整方法未被保留，因此这两条已复现路径不等于已确认该历史请求的具体类型。

实现由 agentX 的 native/codex-conversation.ts 和 codex-questions.ts 拥有。主线程命令／文件审批、当前轮权限、request_user_input 和 MCP elicitation 继续使用现有界面；旧版两种审批归一为同类决定，再按原版枚举返回 approved、approved_for_session、denied 或 abort，保留原生 RPC ID。现代审批严格按 availableDecisions 显示可选决定。权限答复仍只授予请求中的范围和当前轮，不扩大为全局规则。

来自其他线程的支持请求通过 thread/read、includeTurns=false 核对原生 source.subAgent.thread_spawn.parent_thread_id，最多查询八级祖先；只有当前 Worker 的后代才投影到同一工作。此过程不切换、恢复或新建原生线程，也不启用多 Agent 或另行委派。审批说明保留子线程身份；无关线程、归属读取失败、未知协议和无法验证的表单继续明确阻塞。后代缓存上限 256；后代请求按原生 request ID、线程和 turn 清理，主线程结束不会清掉另一个线程的待答问题。查归属期间的已解决、已结束、换线程和停止竞态不能复活旧请求；pending 输入在校验期间保留。

原生日志补存请求 ID、方法和 thread／turn／item 身份，包含旧版和子线程请求及 resolved 通知；未知请求不存任意表单、文件内容或认证字段。保留前一轮补充的原生错误详情与确认停止后的重试入口。完整原生协议仍以 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 和本机 generate-json-schema 为依据；动态工具与外部认证回调未新增执行能力。

固定产物构建 c1a723596d030a8f，六包及锁文件已接入本 checkout，通过 npm 安装，不手改 node_modules。引擎协议回归 10 项通过，含真实 Node stdio 子进程的旧版审批、后代审批、MCP 表单及原线程继续输出；桌面消费、生命周期、界面和现有 Codex 对话回归 101 项通过。本机 Codex 0.166 与已构建 Electron MCP 的隔离集成 1 项通过，覆盖问答、续接、缺失历史恢复和后台停止；模型响应来自本地协议 fixture，不代表云模型质量或历史会话重放。类型检查、build:check 和六包完整性校验通过。命令和产物证据见 artifacts/codex-native-requests/verification.json。运行中的 D:/janusX 安装版没有被替换或重启，原用户工作没有被重新投递。

2026-11-10 用户随后明确要求打包并覆盖 release/superagent/installer。当前 0.9.8 NSIS 安装包、blockmap、latest.yml、builder-debug.yml、BUILDINFO.json 与 SHA256SUMS.txt 六个文件已覆盖并逐一复核复制后哈希。安装包为 153511341 字节，SHA256 为 46a8a7f32af7c46efc9b288d23e9152d075b3c0fe110364ea3189a13afd9ad7f；固定引擎为 c1a723596d030a8f。包内 478 个构建文件及 178 个引擎运行时文件与当前构建／固定清单匹配，更新清单 SHA512 与大小通过，包外中立目录的模块图、LLM 运行时和可见 GUI 检查通过。首次打包因路径大小写不一致失败，使用磁盘规范路径的 projectDir 后成功；首次中立目录校验因 C 盘空间不足失败，改用 D 盘独立临时目录后通过，失败日志保留。证据见 artifacts/codex-native-requests/installer-delivery.json 和 installer-verification.json。仅覆盖安装包目录，未执行安装、重启现有应用或公开发布。

## Alternatives considered

结构化报告沿用原存储，只把新正文变为版本化 JSON；未另建报告数据库或让前端从任意 prose 猜测验证事实。代价是新增字段填写与校验成本，因此空产物、空完成事项及未运行验证均可如实提交。摘要限长只影响用户入口，完整证据不截断。后续若需要自动判断证据过期或要求覆盖，应在原资源版本和执行身份上扩展，不把字段完整误当证据可信。

- 直接复用终端实例：可以沿用成熟显示，但会把执行建立、未知请求和停止依赖于 TUI／视图，不能独立确认 Worker 归属。因此复用协议映射，另建受管传输。
- 只加提示词或放宽沙箱以允许原生 Git 提交：改动少，但 Shell、外部 MCP 与 hooks 可绕过具体批准。保留原生写入限制，由宿主在快照批准后提交；代价是部分扩展和需要额外权限的工作流暂不可用。
- 固定两个 Worker 字段／槽位：实现简单，但违背数量可扩展要求。实例按身份存入集合；P4 统一通过 `maxConcurrentWorkers` 申请容量，默认 2，数量不绑定 UI 槽位。

## Consequences

2026-11-11 结构化汇报固定引擎为 `0bcf736cf5e8bb41`，六包归档、锁文件与安装字节一致。引擎 `worker-report`／`superagent-store`／`worker-prompt` 三文件 18 项通过；消费端 `superagent-worker-mcp`／`superagent-context`／`superagent-store`／`engine-packages` 四文件 24 项通过，包含真实 stdio 子进程拒绝旧格式和接收结构化报告；`superagent-workers` 18 项通过，覆盖字段拒绝、宿主归属、重复提交与同源读取。`superagent-work-ui` 24 项及 `conversation-topics-ui` 的报告恢复单项通过，已查看宽窄结果页和简短卡片截图，位于 `artifacts/superagent-hifi/structured-*.png`。使用真实 Codex 与构建后的 Electron MCP 的 `superagent-native` 一项通过，日志在 `artifacts/worker-report-native.log`；模型为本地协议夹具，未声称云模型汇报质量验证。

严格类型检查、定向 ESLint、双语检查、包边界与 `build:check` 通过，构建日志为 `artifacts/worker-report-build.log`；桌面 Notes 340 篇、0 errors、17 条既有外链提示。引擎索引无顶层诊断，读取侧仍提示未绑定跨仓库及原有 omp-tooling-design 无效目标。本次仅更新本 checkout 固定包和 `artifacts/build-check`，未覆盖运行中的 out、制作安装包或重启应用；新桥接需使用更新后的应用构建启动。

2026-11-10 审批修复的固定包构建为 `1f03829855457f24`，六包、锁文件和安装字节校验通过。Main 执行 `npx vitest run tests/unit/superagent-worker-permissions.test.ts tests/unit/superagent-workers.test.ts tests/unit/superagent-commit.test.ts tests/unit/superagent-worker-mcp.test.ts tests/unit/engine-packages.test.ts --maxWorkers=1 --minWorkers=1`，21 项通过、3 项需原生环境的权限用例跳过。另执行 `superagent-work-ui.test.ts`，10 项通过；补充的 Git 批准前 HEAD 不变断言在 Worker 14 项复验中通过。设置 `JANUS_SUPERAGENT_CODEX_BINARY` 后执行 `superagent-native.test.ts`，真实 Codex 与 Electron MCP 的读取／汇报／续接内部审批计数为 0。该原生用例首次在 Windows taskkill 进程树退出确认失败，单独重跑通过；首轮证据保留在 `artifacts/superagent-approvals/native-first-attempt.json`，最终证据在 `artifacts/superagent-p6/native-result.json`。模型响应为本地 fixture，未验证真实云模型语义质量。

严格未用项类型检查、应用 `build:check` 和固定包完整性校验通过；UI 源文件定向 ESLint 无错误，测试文件由现有 ESLint 配置排除。桌面 Notes 339 篇、0 错误、17 条既有外链诊断；引擎 Notes 保留原有的 Intent 缺失与失效相对链接两项错误。本轮不替换正在运行的安装版；使用新应用构建并启动／续接受管线程后生效。

P3 已有真实产品通路，P4 已接入自然分派和满额队列，P5 已交付共享工作卡与原文召回；P6 已交付回收与应用恢复，完整 MVP 仍待 P7–P8。ready 且原生轮次结束后，P4 调度器确认执行进程树结束再释放容量，保留线程引用、结果与 ready 卡片；明确继续使用新 execution 恢复原线程。P6 已在确认收尾后接入可配置的实例空闲回收（默认 30 分钟）及原文充分性核验，细节见生命周期决策；最终侧栏／Island 布局归 P7。原生 API 或插件边界发生变化时，应按实际版本重验，不静默接受新增执行通道。

验证覆盖 Windows 的真实 Git、Codex 0.166.0 与 Electron：原生测试通过生产权限和构建后的 MCP，检查读取、代码写入、运行中补充、审批、中文回答、报告落库、原线程续接、全局配置不变、继承 MCP 未启动及停止后后台不再写入；桌面 E2E 从现有 JanusChat 经真实 preload／IPC 启动 Worker，看到 MCP 报告并确认停止。模型响应由 localhost 夹具提供，未验证付费供应商的开发质量、其他系统或任意 CLI 版本。

复现入口为 `tests/unit/superagent-workers.test.ts`、`superagent-commit.test.ts`、`superagent-worker-mcp.test.ts`、`codex-managed-decisions.test.ts`、`superagent-native.test.ts`、`superagent-work-ui.test.ts` 和 `tests/e2e/desktop-superagent.spec.ts`。原生用例需设置 `JANUS_SUPERAGENT_CODEX_BINARY` 并先构建 MCP；桌面用例使用 `out/main/index.js`。相关存储、环境、既有 Codex 对话、worktree 和退出回归通过；类型、严格未用项、定向 ESLint、主题／双语检查、开发检查构建和应用构建通过。Notes 校验为 331 篇、0 errors，另有 17 条既有跨仓库链接诊断。日志与已查看的聊天／桌面截图保存在忽略目录 `artifacts/superagent-p3*`，实际 Git 副作用均在临时测试仓库。

2026-11-12 双引擎验证：固定制品 e735e2e657a3ffd0 的六包及安装字节核验通过。lifecycle／settings／IPC／store／routing／artifact 定向回归共 65 个不同用例通过（混合引擎用例首轮断言早于异步启动，改为等待启动参数后 lifecycle 22 项复跑通过）。另有 Worker 执行／MCP／调度及 IPC 39 项通过，Claude 会话与启动 23 项通过。显式 work_route 指定 Claude、默认 Codex 并存及禁止续接换引擎的用例通过。设置页三个浏览器用例通过，截图已复核。真实 Claude Code 2.1.322 配合本地提供方夹具：Worker MCP 报告、历史复制续接、实时补充及创建时间绑定的进程树停止 1 项通过；原生问题／审批／Bash 停止 2 项通过。严格类型、定向 ESLint、双语键、build:check 和 Notes 检查通过，Notes 保留 17 条既有外链诊断。构建日志 artifacts/claude-worker-build.log。未替换运行中的安装版，未声明真实云模型任务质量或全部 CLI 版本兼容；上轮无关报告弹窗焦点恢复缺口未在本次修改。
