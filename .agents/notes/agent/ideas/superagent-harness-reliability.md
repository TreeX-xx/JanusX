---
{
  "schema": "harness-note/2",
  "id": "a775d2a2-1aa1-4986-9e20-117882c2b9fb",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-11-08",
  "updated": "2026-11-13T16:20:20.679Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/918c6e34-e84c-4b7b-8731-17855621c27c" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e1bdfc5f-a4ff-4dea-b7e3-965ab2ffe161" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bb19f25e-9321-44e6-9184-e3bd643f92a6" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/chat-tools.ts", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/service.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/controlled-worktree.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/SuperAgentWork.tsx", "role": "implementation" }
  ]
}
---

# SuperAgent 分派故障与共享运行时边界

## Intent

记录实际使用暴露的分派、环境检查、阻塞呈现和续接问题，以及向 janus-agentX 收敛的讨论依据。本篇区分原始故障证据、用户已确认方向、顺序实施进度及尚未验收的范围。

## 已确认方向

2026-11-09 用户要求循环控制不再由用户设置，改为代码内置策略，并参考 Codex CLI 的处理；harness 与 SuperAgent 是否合并仍需讨论。这里的循环控制不包含 Worker 默认引擎、模型和推理强度，也不取消既有并发容量设置。

排查时 janus-chat 默认 40、钳制 1–100，并经设置界面和 ModelResolverPort.getMaxTurns 传给共享循环。现已移除设置入口，IPC 忽略旧写入；桌面交互运行采用引擎内置停滞判断和 256 轮应急上限。旧配置仍能读取，但不再影响桌面交互执行；其他有界消费者保留原端口。

用户随后提出停止保留 janus-cli，专心开发服务于 JanusX 的 janus-superAgent，并将 Agent 后端移入 janus-agentX 独立仓库管理，让 JanusX 专注桌面壳体。现已抽取 SuperAgent 后端，退出独立 CLI 的默认构建、测试和发行，并移除桌面安装、源码 build/link 与新建 CLI 入口。已有 CLI 源文件和旧会话身份保留，避免覆盖未提交工作；内置 Janus 模型配置与 notes-cli 工程工具继续使用。引擎独立于 Electron，不另行维护面向用户的命令行产品。

2026-11-09 用户进一步确认双模式：普通模式具备读取、编辑等工具，可以直接修改；SuperAgent 可以读取和分析，需要修改时调用 Worker。现已实现工具装配和调用前校验，桌面工具栏选择从下一条消息生效，流式执行时不能切换。

## 实际故障与证据

用户提交“扩展 SuperAgent 设置、选择 Worker 终端类型、默认模型和推理强度、右侧调整模型和强度”的任务。会话为 `382ad47e-3eba-408e-bbdd-636dddf06c08`，工作为 `4e024d6c-6aeb-43e3-8104-ddc382af98ec`。2026-11-08 的只读排查核对了本机应用数据 `janusx/superagent/records.json`、`scheduling.json`、`chat-conversations.jsonl` 和实际 Git worktree 列表；不把含用户会话的整个文件复制入仓库。

| 观察 | 对应事实与影响 |
| --- | --- |
| 主 Janus 长时间自行调查 | 第一次回复时间线有 41 次工具调用，第 40 次才调用 work_route；之前主要搜索、列目录、读取文件。40 是内部模型循环上限，不等于工具调用数。 |
| 分派被明确拒绝 | 持久动作记录为 new 和后续 continue，错误均为 `Nested worktrees cannot be assigned to a worker`；executions、reports 和调度 entries 均为空，两个输入投递仍为 pending。没有启动 Worker。 |
| 来源仓库存在嵌套 worktree | 任务绑定 `C:/Users/Tree/Desktop/git/JanusX`；Git 列表包含其 `artifacts/v097-build/JanusX` 与 `artifacts/v098-publish` 下的工作树。inspectCheckout 在来源检查阶段拒绝嵌套关系。 |
| 运行功能与目标 checkout 的代码不同 | 当时主目录没有 `src/main/janus/superagent/chat-tools.ts`，本探索工作树存在该实现；会话反复搜索 superAgent、work_route 得到零匹配。目标基线需要明确，不能因此静默把任务迁移到另一个 checkout。 |
| 继续没有推动执行 | 用户输入“继续”后，下一条回复时间线又有 40 次工具调用，最终仍提示到达 40 轮上限。持久账本中的 continue 同样被环境规则拒绝；不能从时间线断言两者包含完全相同的调用。 |

上述调用数量、错误和空执行记录已核对；它们证明这次任务没有启动 Worker，不证明所有模型或所有工作区都会以相同比例失败。

## 排查时的机制缺口

**分派职责只通过提示词表达。** chat-tools 要求开发任务使用 work_route，但 shared chat-turn 仍组装直接开发工具和搜索、修改、验证指导。workspaceMutationRecovery=false 只关闭一种补做提醒，没有建立执行责任边界。按已确认的双模式方向，普通模式保留直接读取、编辑能力，SuperAgent 模式保留读取和分析能力，将编辑交给 Worker。后续需由工具装配与运行时检查落实模式边界，具体工具清单仍待细化。

**环境验证混合了来源与可写执行目录。** 来源主 checkout 中存在嵌套目录就提前失败，无法进一步评估仓库外的独立执行 worktree。保护目标本身合理：不能让 Worker 经可写父目录修改另一 checkout。修复应分别判断来源可读性、执行目录写入范围、Git 身份与实际授权，不直接删掉重叠保护。

**确定性阻塞被混同为 unknown。** routeDecision 先创建工作、关联输入，再 prepareEnvironment，最后 scheduler.request；环境检查在入队前抛错，catch 将动作统一写成 unknown。对无法确认是否已产生外部副作用的情况保留 unknown 是必要的；明确的环境拒绝应记录可解释的 blocked 原因、阶段和恢复条件，不通过删除账本或无条件重放规避幂等。

**启动前失败可能不出现在右侧。** SuperAgentWork 的 resident 过滤依赖活跃 Worker、调度项或待批准环境操作。上述失败只有工作和 action 错误，因而没有可见工作卡；通知同样主要依赖报告、原生 Worker 或环境操作。接收成功后的工作应持续可发现，启动前失败也应展示原因及恢复入口。

**循环上限没有提供任务级恢复。** 固定 40 轮提示不说明已完成什么、为什么未分派、哪个前提仍然不满足。现有相同失败调用防护不能覆盖大量参数不同但没有推进的成功读取。需同时观察工具结果、新证据和工作状态；不能只以无文件修改认定只读分析停滞，也不能因工具退出码为 0 就认定任务在推进。

**外部后端仍然绑定 Codex。** workers 依赖 CodexConversation，生产启动寻找 Codex，workerLaunch 叠加原生权限、MCP 和限制。后续多终端类型实际需要执行后端能力契约；能力不支持时应明确反馈。模型与推理设置可复用已有原生会话能力，但必须定义运行中设置何时生效。

## 共享运行时设计依据

janus-agentX 中 `harness-core` 是 Note、Task、图、契约、回执的纯数据逻辑，`harness-node` 提供文件和 Git 证据适配；它们并不是整个 Agent 运行时。`agent-core` 的 runJanusAgentLoop、`chat-core` 的会话与上下文、`janus-agent` 的 runChatTurn 和 WorkflowX executor 才承载执行循环及编排。目前 getMaxTurns 位于模型端口，也是运行策略和模型解析混合的一处接缝。

建议将 janus-agentX 明确为服务 JanusX 的独立 Agent 引擎仓库，把 SuperAgent 工作协调作为其核心能力，优先在现有 janus-agent 包内形成模块。普通模式与 SuperAgent 模式共用同一个 Janus 和聊天循环；JanusX 为当前入口提供模式、权限和上下文，引擎按模式落实直接编辑或 Worker 委派的边界，模型识别具体工作归属，运行时校验授权、状态和能力。不增加分类模型，也不为尚无消费者的通用插件平台或 CLI 另造兼容层。

| 所属层 | 建议责任 |
| --- | --- |
| agent-core | 工具调用／结果配对、取消和 steering；返回明确循环结束原因，提供策略检查点，保持与 SuperAgent 业务无关。 |
| chat-core | 历史、上下文容量、压缩与续接引用；压缩不能丢失工作身份、原始输入引用和未解决阻塞。 |
| janus-agent | 工作关联与分派协议、直接／委派策略、后台工作状态机、幂等、容量和事件协调；通过端口访问存储、执行后端与环境。 |
| harness-core / harness-node | 沿用正式 Note／Task 契约和验证回执；普通工作不强制变成正式 Task，Task 绑定的执行继续保留原验收与独立评审义务。 |
| Node 后端适配 | 实际进程、原生协议、worktree、权限和持久化；逐项移入引擎仓库，通过参数接收目录、凭据和系统依赖，不依赖 Electron 单例。 |
| JanusX | Electron 生命周期、工作区选择、IPC、审批交互、右侧卡片、Island 通知及呈现偏好；向引擎传入运行目录、授权结果和用户输入，订阅事件。 |

引擎拥有 work/run 状态、队列、输入投递、环境与 Git 操作规则、Worker 进程控制和恢复；JanusX 不再保留另一份调度或恢复判断。应用退出由壳体触发引擎停止与排空，不能把 app.getPath、BrowserWindow、ipcMain 或 React store 移进引擎。引擎产生报告、待审批和失败等结构化事件，壳体决定卡片与通知呈现。浏览器、系统凭据及业务服务若必须由宿主提供，则保留薄端口，不因可被 Agent 调用就迁走整个产品模块。

独立仓库应以构建包和版本契约交付，记录引擎版本与事件／持久格式兼容；避免依赖相邻源码后再手工覆盖 node_modules/dist。CLI 退出时先核对 packages/cli、packages/notes-cli、构建顺序、分发脚本和测试依赖，保留仍被 JanusX 或工程检查消费的能力。可保留用于验证引擎的无界面测试驱动，不继续维护 CLI 的 TUI、账户配置向导、命令兼容和独立发行。

现有 executeWorkflowXTask 使用内部 forkSession 和 runChatTurn，在正式 Task 下运行实现／验证／评审。外部 Codex Worker 有自己的线程、输入投递、权限和进程生命周期，不能直接当作相同的内部子会话。可以共享执行后端契约、状态与结果事件，但不能让两个调度器同时拥有同一 work/run，也不能因抽取代码丢失原生停止确认和租约。

工作目标 Work、一次启动／恢复的 Run 和原生模型 Turn 应分开。聊天回复结束只表示当前协调动作结束；Worker 正常 turn 结束不等于 ready，更不等于验收通过。已有“正式报告只通知、不自动唤醒 Janus”的行为是已记录的设计选择；若需要自动验证／返修闭环，应另行讨论有界的报告事件消费，不能把它当成本次已授权的行为变更。

### 内置循环策略与 Codex 参考

建议根据完成、交接、等待输入、明确阻塞、取消或不可恢复失败结束当前运行；仍有可执行工作且有推进时继续。上下文压力通过现有压缩与原文引用恢复处理，网络重试与任务循环分别计数。为重复失败和无新证据的重复读取设置内部恢复／终止规则，并保存具体停止原因和下一步；禁止仅靠自动重发“继续”绕过固定轮数。

Codex [App Server 文档](https://learn.chatgpt.com/docs/app-server)区分 Thread、Turn、Item，提供 steer、interrupt 及 completed／interrupted／failed 终态。[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)明确自动压缩 token 阈值、请求重试、流重试和空闲超时。可参考这种生命周期、上下文和故障分别处理的方式；文档没有给出 Janus 应采用的总轮数或停滞阈值，也没有证明 Codex 内部不存在其他保护。本次未核对特定提交的 Codex Rust 循环源码，不将上述建议称为源码等价实现。

## 验证与推进边界

2026-11-08 Main 执行 `npx vitest run tests/unit/agent-max-steps-config.test.ts tests/unit/superagent-environments.test.ts`，2 个文件、26 项通过。前者验证当时 40／1–100 配置，后者验证当时受控环境行为；该轮只有文档维护，不表示缺陷修复。后续实现与验证见下面的顺序实施记录。

建议先覆盖已发生的失败链：早期分派、嵌套来源的安全环境选择、入队前失败持久状态、右侧可见、环境修复后的显式续接且不重复创建／投递。随后按工作记录、协调状态、执行后端和环境管理逐项迁入引擎仓库，验证引擎测试与 JanusX 实际接入，再退出无消费者的 CLI 产品代码，最后扩展多后端与运行中模型设置。迁移应保留现有工作、原文、投递和审批记录，不能通过新建另一套存储掩盖旧阻塞。

## 顺序实施进度（2026-11-09）

用户已授权 Main 按 xdo 顺序实施，不新建正式 Task。两仓原有工作区差异与 HEAD 保存在本 checkout 的 `artifacts/superagent-migration/`，原有修改继续保留。

环境阻塞切片已实现：来源 checkout 检查允许嵌套 worktree，实际可写 Worker 目录仍进行严格重叠检查；来源不可安全复用时，提出仓库外执行目录并等待具体批准。环境准备在 scheduler.request 前失败时，同一次账本写入保存 blocked 动作、环境阶段、工作身份和可见安排。重复决定返回原工作；修复后新的明确输入继续同一工作。进入调度后的不明结果仍为 unknown，原决定不重放。旧 unknown 记录没有自动改判，本轮未改用户应用数据。

双模式已实现：agentX 的 ChatTurnRequest 接受宿主选择的 agentMode；SuperAgent 仅提供注册为读取风险的工程工具及宿主明确声明的读取／协调工具，并在调用前检查，普通模式保留既有工具装配。模式切换不重置已有 Worker。交互循环忽略旧用户轮数配置；新证据可超过 40 轮，连续八次重复读取／错误结果触发停滞，256 轮为应急上限。有界自动化预算保留。判断基于工具名和结果内容摘要，不是语义进展证明，仍需真实使用轨迹校准。

40 个后端模块已抽入 agentX，桌面旧入口为兼容转导出；迁移映射及抽取时源码哈希位于 docs/migrations/superagent-engine.json。六个内容版本化 tarball 和清单取代相邻源码依赖，该轮构建标识为 0da7b01099c608b4（已被下述追加迁移产物替代）。npm 安装后校验压缩包与每个已安装文件的 SHA256。CI 和 Windows 构建使用相同固定包；仍保留既有 WorkFlowX 标准 fixture 依赖。CLI 已退出默认工作区、构建、测试和发行，桌面移除安装、源码 build/link 和新建入口；旧身份保留以读取历史与配置内置 Janus，不卸载用户已有二进制。

验证由 Main 分阶段执行，证据位于 artifacts/superagent-migration；没有声称独立评审或一次完整 verify 全绿：

- 迁移后消费端环境、路由、调度、生命周期、上下文及 Worker 定向回归分批通过 116 项。首次并行批次有测试进程 Channel closed，拆分后的剩余 73 项通过；已完成的 43 项保留原日志。
- 引擎存储、模式与循环定向回归 27 项通过。活动工作区完整测试首次 816 通过、6 失败、1 跳过；其中 5 项是并发下的 5 秒超时，1 项暴露裸 /xflow 命令过早读取工具端口。修复早返回顺序后，三个受影响文件以单进程、30 秒超时重跑，22 项全部通过。
- 最终固定包的宿主聊天接线及产物篡改检测共 26 项通过；独立临时消费者可以安装六包并导入 SuperAgentService、CodexConversation 与循环策略，无相邻源码依赖。准备脚本原有 3 项在单独运行后通过。
- 使用明确指定的 Windows Codex 可执行文件，原生隔离与 Worker 集成 3 项通过；桌面 2 项通过，覆盖模式选择、编辑／报告／召回／续接／停止确认及应用重启后不自动执行。模型请求由本地协议 fixture 提供，不等于真实云模型的行为验收。桌面截图已人工查看。
- Electron 隔离构建暴露图标路径依赖固定目录深度的问题，改用构建器发布的资产路径后启动通过；失败测试现在保存主进程日志并仅终止自身测试进程。
- CLI 与终端回归分阶段通过 143 项、跳过 1 项；旧 Janus 安装预期改为确认不请求 registry、不安装，内置模型绑定继续通过。类型检查、最终应用构建、包边界和双语检查通过，Lint 为 0 错误／51 条警告。两仓 diff 空白检查通过。
- JanusX 338 篇 Note 校验 0 错误、17 条显式外链诊断。agentX 校验仍有两处原有未提交文档错误：agent/omp-tooling-design.md 缺 Intent，proposed/architecture/2026-09-16-codex-cli-tool-surface-survey.md 含失效相对链接；另有两处历史跨仓链接未解析。本轮新增／更新模块未产生新错误，没有改写这些无关文档。

原有 work、输入来源、投递账本、权限与停止确认保持。旧 unknown 不自动改判，新 blocked 账本不能直接交给不认识该状态的旧版应用。用户真实应用数据没有迁移或重放；多后端扩展、报告自动验证／返修与真实模型长期停滞评估属于后续范围。

## 工具能力追加迁移（2026-11-09）

用户要求先读取确认，再继续处理备忘录与运行／生成工具。核对发现前一轮完成的是 SuperAgent 后端，memo、launch-config 与 project 工具执行仍在桌面；本轮将其与依赖契约、纯 Node 配置／检测实现共 10 个模块迁入 [agentX 工具模块](note://62b44166-82f0-41ff-838d-e2b02388ed06/df09fc5b-5cbb-4282-875c-3268459044e5)，映射及抽取前哈希记录于 docs/migrations/agent-tools-engine.json。

桌面保留 MemoStore 与共享 ProjectRunner，分别通过 MemoStorePort 与 ProjectProcessPort 提供现有存储和进程；不复制存储、不新建第二个进程调度器。项目配置仍沿用 agent-core 的工作区存储解析与 I/O 队列。工具规则、读取分页、路径限制、配置验证／生成、审批转接和编辑回执已由引擎拥有。command.run 的通用执行实现此前已在 node-hosts，本轮复测其后台启动、查询与停止接线。

独立引擎新增测试 19 项通过；固定包实际消费路径的 11 文件、122 项通过，包括 MemoStore 修订冲突与来源、取消／重复创建、真实 Vertex 工具参数序列化、运行配置审批和共享进程。新测试初次因 fixture 使用错误 session 字段、缺检测特征文件及审批 preview 失败，修正 fixture 后通过。严格类型检查发现宿主的空进程返回 null，已将端口契约修正为接受 null／undefined。

桌面初验发现 Island 聊天使用全局默认 SuperAgent 模式，却没有模式选择入口，备忘录编辑因此被拒绝。现由共享 AgentModeSelect 在 Island 聊天和 SuperAgent 工具栏展示同一偏好，流式执行期间禁用，下次消息生效；默认模式与引擎写入限制不变。备忘录桌面测试通过真实界面选择普通模式后，覆盖新建、增删改、节点切换、来源写入与取消绑定。SuperAgent 的 memo_read 可见、强制 memo_edit 不触达存储由独立引擎测试覆盖；本轮没有增加 Worker 备忘录传输协议。

最终交付构建标识为 f11ae408ec8c7e6b12e484c1ffe5ab8e87fa9e0f51cb482b0cd6d55a161a6deb，vendor 六包、锁文件与安装目录一致，prepackage 校验通过。最终包再次运行备忘录、Vertex schema、launch-config 与 project 四文件 40 项通过；它们是上述 122 项中的复验，不重复计数。

Main 验证记录位于 artifacts/tool-migration：引擎 tool-launch-config.test.ts／tool-host-ports.test.ts 共 19 项；消费端 npx vitest run 的 consumer-tests.log 所列 11 个文件共 122 项；npm run typecheck:strict-unused、npm run build:check、包边界检查通过。Lint 无错误，全库保留 51 条既有警告，最后 UI 定向检查为 4 条既有警告。最终 Electron 构建通过 JANUS_DESKTOP_BUILD_ROOT 与 JANUS_DESKTOP_MAIN 指向 artifacts/build-check，执行 npx playwright test tests/e2e/memo-chat-desktop.spec.ts tests/e2e/run-config-assistant.spec.ts --config playwright.desktop.config.ts --workers=1，两项全部通过，截图已人工检查。HTTP 模型响应使用本地 fixture，未声称真实云模型验收或全库 verify 全绿。两仓文档校验未引入新错误，agentX 原有两处错误仍保留。

## Worker 任务上下文组装优化（2026-11-10）

用户要求先记录提示词分析，尚未要求实施。本次核对 checkout 为 feat/superagent-automation-exploration、HEAD 为 742db250fd6588d2a93717c26705b8b40fcf7dc3；存在其他未提交修改。当前桌面通过固定包消费引擎，实际拼接逻辑在已安装 janus-agent 的 superagent/workers.js 中，不能将桌面转导出文件当成实现源文件修改。

deliver 每次投递待处理输入都会拼接任务说明、原始输入资源封装及 JSON 工作卡背景。背景保留 intent、checkout、report 和 inputs 元数据；超过内联预算时改为读取提示，已有会话追加输入仍重新附带任务说明与背景。输入原文、资源版本与可续读引用有恢复价值，但投递状态、时间戳、重复身份和分页封装不必全部成为模型的默认任务正文。

本例同时出现“先确认 Demo”、历史报告“Demo 完成、生产未接入”、最新指令“分配 Worker 去实现”及 stale=true。应依据相关原文明确本轮阶段和验收，单列尚未解决的冲突，不要求 Worker 从内部状态自行重建全部任务解释，也不把历史报告当作当前代码或设计已获确认的证据。

建议首次启动或历史丢失恢复时提供完整有效需求；已有会话追加以新增要求、状态变化和必要引用为主。正文保留目标、工作目录／分支／基线、范围、有效约束、当前阶段及交付要求，发布规则归发布工具。原文、版本、投递账本和历史保留于工具读取与宿主校验，不因精简提示词删除追溯能力。以上为当时分析，现已按后续 xdo 授权实施，见本文末尾记录。

## 原生审批频率与本地化分析（2026-11-10）

用户提供运行 superagent-workers.test.ts 与 superagent-ipc.test.ts 的原生审批，说明系统临时目录中的 .git/config 和原子 rename 遭拒。本次只核对代码，未获得该次失败的完整日志，也未在相同 Worker 沙箱复现；具体 rename 错误是否还受 Windows 文件占用影响仍未知。

当前 worker-permissions 默认根目录只读、分配 checkout 可写，显式保护真实 Git 元数据及配置目录；未在该工厂声明独立测试临时写入根。原生审批由 user 审阅，各类 sandbox／permission／rules／elicitation／skill 请求均保持交互。worker-launch 还明确要求缓存、临时目录和网络访问不足时请求原生批准。测试 fixture 使用 os.tmpdir() 创建 janusx-superagent-test-*，环境 fixture 会 git init、写本地 Git 配置及提交，持久层通过临时文件 rename 写入。因此测试实际写入需求与基线权限存在不匹配，提示词要求少询问不能解决这个权限问题。

命令审批支持一次或当前 session；受管模式移除持久命令／网络规则选项。独立 permissions 请求只返回 scope=turn，不能把一次批准解释成整个 work 永久授权。同一请求 ID 在内存中去重，但这不合并新的同类请求。此前内部 MCP 读取／汇报免重复审批的修复不涵盖原生 Shell 扩权。

英文控件来源已确认：引擎 codex-questions 硬编码 Allow once、Allow for this session、Decline 等标签，permissions 分支同样硬编码英文；桌面 SuperAgentWork 对标题使用 t()，按钮却直接显示 choice.label。应按结构化决策语义本地化，同时保留原生响应值，明确区分一次、当前轮和当前会话；动态请求正文不能靠翻译静态按钮解决。

建议后续优先设计每个 execution 专属的可写 scratch，向测试进程传递 TMP/TEMP，并验证隔离仓库初始化、原子替换和清理；继续保护真实 checkout 的 Git 元数据。是否需要专属测试执行通道应由实际原生沙箱能力验证决定，不仅按 npm 命令名自动放行。审批界面应呈现操作、路径、权限范围与有效期，原始命令可展开查看。上述为分析及待实施方向，未改变权限配置、审批行为或 UI。

## 自主验证切片实施

用户随后授权 xdo 实施自主测试环境与审批本地化，并重新打包覆盖本 worktree 的 release/superagent/installer。实现边界和 Windows MXC 实测行为归[Worker 决策](../superagent-workers.md#worker-自主验证与审批本地化)。初始分析中“仅传 TMP/TEMP 即可”的假设未通过真实 MXC 验证，已改为在沙箱内启动命令时设置；完整回归还发现网络全禁用会阻止本地测试 HTTP，现采用仅允许回环目的地的原生代理配置。该切片只更新自主验证相关指引；提示词整体组装精简由后续 xdo 单独完成。

## 修复请求未分派与思考超时（2026-11-10，待实施）

用户测试输入为“分析superAgent 我点击右侧卡片的模型，显示的设置界面在左上角，这样是不对的，需要优化修复”。用户明确要求此类工程修复直接安排 Worker，代码搜索、定位、修改和验证均在 Worker 内完成；Janus 负责需求理解、工作关联、分派、状态和必要讨论。“分析”一词不抵消同一输入的明确修复意图，不应要求用户再次授权分派。这收紧了此前“SuperAgent 可自行读取分析、修改才交 Worker”的职责方向；本节记录新要求，尚未改变代码或验收状态。

Main 只读核对本机应用数据中会话 c82eac68-80cc-4899-98d2-09aa54e63e61 的输入 99b486bb-7ee9-4bc9-87d0-febd5cc350a6、回复时间线及 SuperAgent 账本。该轮耗时约 7 分 8 秒，17 次工程工具调用、0 次 work_route；一次搜索约 120 秒后超时，另两次约 84 秒与 30 秒。最后回复约 3997 字符，给出未经当前组件验证的通用定位假设，并让用户再次要求指派。工程工具使用登记主目录 JanusX，已有设置工作的执行环境为 JanusX-superagent-automation；主目录没有 WorkerModelControls.tsx，说明应先沿已有工作记录确定执行落点，不能靠主目录反复搜索代替分派。

后续明确输入“分配worker去修复这个问题”（事件 bec6e4e0-d0b4-4d60-8fcb-31d98711af30，输入 1169d18d-1a56-4393-813c-8ca84d8fbd74）已保存，首次核对时无投递记录。约 5 分钟后话题输入为 failed，diagnostic 为“流式响应空闲超时，已断开”。随后再次读取最新账本，发现同一输入已形成 applied 的 continue 动作和 pending 投递，投递 updatedAt 为 1794305754989，距用户输入约 6 分 22 秒，晚于前端失败；调度项 updatedAt 为 1794305755016，状态 failed，错误为 Environment is occupied by an active worker or terminal。应据此更新判断：前端超时后后台仍推进了分派，但 Worker 启动失败，不能继续将第二条输入表述为始终没有分派。本轮未获得实时服务端请求轨迹，无法确定此前等待发生在模型服务还是内部处理。

机制核对基于当前安装的固定引擎包：superagent/chat-tools.js 要求项目实施使用 work_route，但 orchestrator/chat-turn.js 仍开放所有 inspect/list/stat/read 风险工程工具，且继续使用 chat-core 的普通开发提示词，其中包含小修复直接搜索、读取、编辑和验证的指导。没有落实明确执行意图必须形成分派结果的约束。run-policy.js 以工具名与结果内容哈希识别重复，结果变化就重置重复计数；它不能可靠判断持续搜索是否推进了分派，交互应急上限仍为 256 轮。

桌面 src/renderer/src/services/llm.ts 的空闲超时为 300000 毫秒，每次相关流事件重置；超时仅清理监听并调用 onError，没有调用后台 abortChat。useJanusChat.ts 在正常完成或报错时会清除 isStreaming，不能仅凭用户看到“思考中”就断言此处漏清。另有准备会话阶段先显示 thinking、再等待 ensureAgentSessions 的可观测性缺口，但本例输入已获宿主接收，不能据此认定卡在会话创建。

建议以同一 Janus 完成语义判断，对明确修复／新增／优化意图尽早关联或创建工作并调用 work_route；只读工作卡、目录身份和必要原文属于协调，代码调查归 Worker。分派完成、排队、审批或阻塞必须有真实回执，禁止用修复建议结束已授权执行请求。空闲超时应协调取消后台并收敛请求状态，区分准备、等待模型、分派、工具执行和失败；不得盲目重放结果不明的操作。验证需覆盖上述两条真实输入的模型行为、正确 checkout、无重复分派及超时收尾，既有直接调用工具的 fixture 测试不能代替语义验收。

本次仅维护分析记录，没有修复运行代码、停止终端／Worker、改变应用数据或进行真实模型复测。

## 单 worktree 多 Worker 与目录占用（2026-11-10，分析）

用户询问 JanusX-superagent-automation 工作目录的“请先结束该目录或其上下级目录中的终端／Worker……空闲但未关闭的终端也会占用目录”是否源于不支持单 worktree 多 Worker。当前代码确实实施目录排他：桌面 ipc/register.ts 将 terminalManager.listInstances() 中全部终端的 config.cwd 作为 occupiedPaths，不过滤空闲终端；引擎 environments.idle 拒绝与这些目录或任何活动 lease 相同及互为上下级的路径。overlaps 使用规范化路径与目录边界，不判断具体正在修改的文件。此检查使用终端启动目录，不能可靠代表 Shell 后续 cd 或当前读写活动。

另有长期绑定限制：available 拒绝不同未释放工作绑定同一或重叠目录；environment-schema.parseEnvironmentDocument 同样拒绝重叠的活动环境记录。因此仅删除终端检查不能实现共享 worktree。当前存储、lease、工作归属和基于分支／HEAD 的有效性检查均按独占环境设计，具体已实现规则仍归[环境决策](../superagent-environments.md)。

本次最新账本中，同一设置工作 4e024d6c-6aeb-43e3-8104-ddc382af98ec 已收到上述输入 26 的 continue，但启动失败、投递仍 pending。旧执行 46591c19-8225-4f0f-ba03-64e27e9b2569 的生命周期为 ready、stopConfirmed=true；这不能证明当前存在第二个活动 Worker。错误消息没有返回占用者身份或路径清单，本轮没有读取主进程实时终端表和内存 leases，无法断言具体是哪一个终端／Worker 阻塞，也不能把早期输入 16 的同类 blocked 动作误认为输入 26 的新错误。

同一 worktree 可以承载多个协作进程；当前产品限制来自所选的隔离策略。共享目录意味着共享文件、未提交修改、分支、Git index 与 HEAD，现有命令锁或分支检查不等于多 Worker 协作协议。后续可考虑允许普通空闲终端共存、多个只读 Worker 共存，以及在明确协作范围下共享目录并按文件／模块分工；同文件冲突需要协调，提交／切分支／合并／清理等全局操作需要串行，测试临时目录与输出也需避免互相覆盖。独立目标仍可选择隔离 worktree。这是待讨论方案，尚未将共享多写设为默认，也未放宽现有停止未确认保护。

环境就绪检查应返回实际占用者类型、身份、目录和可用操作，区分普通终端、受管 Worker、未确认停止和其他工作绑定。SuperAgentWork.tsx 的 phase 优先使用旧 worker.phase，而 diagnostic 优先使用新 schedule.diagnostic；在旧执行 ready、续接调度 failed 时可能同时显示旧完成状态和新启动错误，且重试按钮要求 phase 属于 failed/blocked/interrupted/stopped，可能被旧 ready 状态隐藏。这是当前代码与账本组合暴露的呈现风险，未做桌面复现。已明确的修复要求即使遇到占用，也应保留同一工作与待投递输入，并清楚说明启动阻塞。前述首轮 0 次 work_route 属于语义分派缺口，后续路由成功后被占用检查拒绝属于启动缺口，两者需分别验证。本次没有关闭终端、停止 Worker 或修改调度／权限策略。

## Orca 编排参考与 SuperAgent 候选改进

2026-11-11 用户要求将 Orca 对照分析中的三点详细保存为 Note。本节是待讨论方案，不代表已批准启用自动协调、自动返修或专门验收流程。现行“正式报告只通知、不自动唤醒 Janus”及用户查看 ready 的规则继续有效；若后续采用方案，应同步修改对应需求与实现决策。本节候选字段和验收场景均不是已发布接口或已通过测试。

### 适用边界与已有基础

Orca 面向多种独立 Agent 会话、终端、嵌套 Worker 和远程运行时，需要显式派工、邮箱消费权和跨主机身份。SuperAgent 已有同一 Janus 协调、引擎管理状态与调度、受管 Worker 执行的边界；当前 Worker 不再委派，桌面消费独立引擎包。无需为借鉴 Orca 另建通用 CLI、递归 Agent 树或远程联邦。

已有 workId 表示长期工作，executionId 表示一次执行，原生 session／turn 表示后端会话与轮次，已承担 Task／Dispatch 分离所解决的主要问题，不宜再增加同义对象。pending／unknown／delivered 输入账本、正式报告、执行租约、停止确认、容量与共享 checkout 协作继续复用。当前事实由[Worker 决策](../superagent-workers.md)、[调度决策](../superagent-scheduling.md)及[生命周期决策](../superagent-lifecycle.md)维护。串行 JSON 持久化也不因 Orca 使用 SQLite 就改写，只有实际事务、并发或容量问题证明不足时再评估。

### 一、Worker 正式报告后的有界自动推进

**问题与目标。** 当前报告通知用户，但不自动恢复 Janus 的协调轮次。若产品希望一次目标委派后继续进行结果检查、后续派工和必要返修，应让持久事件驱动协调。定时发送“继续”、不停轮询或每条日志触发模型都不能替代受控的业务推进。

**建议流程。** Worker 报告先经既有 MCP 保存；引擎核验工作、执行、报告身份和当前版本，记录待处理协调事件；同一协调上下文合并事件，启动一次 Janus 判断；Janus读取相关工作、原始要求、报告摘要和按需证据，选择汇总、继续派工、提出明确返修、等待其他执行、保留阻塞或请求用户决策。决定仍经已有工作工具执行，动作回执落地后才把对应事件记为已处理。

触发范围应小于运行日志：正式完成、有新信息的失败／阻塞和需要协调者回答的问题可以成为候选；推理片段、工具输出、心跳与重复状态仅刷新界面。原生审批沿现有用户审批通路处理，不因唤醒 Janus 而自动批准。问题仅在原目标和授权足以回答时由 Janus处理，产品取舍或权限缺口仍等待用户。

**身份与幂等。** 候选事件至少关联稳定事件／报告 ID、workId、executionId、所属对话及工作或输入版本。旧执行报告可以保留历史，但不能完成当前执行。新输入到来后，协调判断必须看到新要求，在实际派工前再次核验版本。事件消费与工作动作分别幂等：若返修动作已落地而事件确认前发生崩溃，重放不得再次创建同一 Worker。目标是可重放且不重复应用动作，不宣称跨模型与外部进程的端到端恰好执行一次。

**串行与优先级。** 同一协调上下文只允许一个会修改工作安排的协调轮次；用户输入、停止、关闭优先于旧报告续接。忙碌时保存事件，当前轮次结束后合并处理，不并发启动互相冲突的协调者。已有临时并行对话可以继续服务独立讨论，涉及同一工作安排时进入统一协调入口。界面切换工作区不改变报告所属对话和工作。

**生命周期与重启。** 停止或关闭以后，迟到事件不能自行重开工作。报告触发判断也不证明进程退出；追加、返修和释放容量仍遵守既有进程、租约与停止确认规则。重启可以恢复待处理事实，但不能借机自动重放旧安排。在明确变更现有重启策略前，继续要求新的明确输入后再核验与消费。用户主动结束工作与临时等待必须区别记录。

**预算与收敛。** 自动判断次数、返修次数及时间／成本约束由引擎内置有界策略管理，不重新引入让用户猜循环次数的设置。具体阈值待真实轨迹校准，本次不指定任意常数。网络重试、启动重试和语义返修分别计数；新日志或工具返回成功不能单独证明进展。预算耗尽、同一失败重复且无新证据、授权不足、执行状态不明或用户取消时停止自动推进，保存原因、已完成内容、剩余问题和可行下一步。

**与长命令续接的区别。** 已有长命令完成自动续接可提供取消、事件合并及上下文管理的实现参考，但工具完成只表达一次调用结束。Worker 报告表达长期工作的一次业务结果，额外需要工作版本、证据及派工授权校验。不得直接把通用完成回调接成无限返修循环，也不能把现有内存续接能力描述为跨重启接管。

候选验收场景：重复报告只产生一次有效处理；多个 Worker 同时报到可合并且不遗漏；新输入使旧结论失效；停止／关闭竞态不重启；返修决定落地后崩溃不重复派工；进程未确认退出时不释放容量；预算耗尽可解释。协议和状态使用 fixture 验证，模型是否合理选择汇总、返修或澄清另用真实任务轨迹评估。

### 二、引擎统一提供状态与恢复回执

**问题与目标。** 已有故障曾表现为工作创建成功但启动前失败不可见，以及旧 ready 与新启动错误组合显示。需要让 Janus、聊天和工作卡消费同一份事实，避免模型和界面各自猜测“发生了什么、还能做什么”。回执覆盖启动前拒绝、排队、执行、收尾和恢复，不只覆盖成功派工。

建议在既有动作、调度和执行记录上形成规范化投影，不新增第二份状态真相。候选内容如下：

| 信息 | 应表达的事实 |
| --- | --- |
| 身份与版本 | workId、动作／请求 ID、输入或工作版本；尚未执行时 executionId 可空，不能伪造执行身份 |
| 阶段与结果 | 环境准备、排队、启动、执行、等待决策或收尾；明确拒绝、失败、成功和结果不明分别表达 |
| 阻塞依据 | 稳定原因码、可读说明、实际占用者／路径或缺少前提，以及来源执行与观察时间 |
| 已发生动作 | 工作／队列／进程是否创建，输入是否尝试发送；已确认与未知副作用分开记录 |
| 资源事实 | 存活或停止证据、租约和容量占用，不能从模型报告推导 |
| 合法下一步 | 等待、查看证据、补充输入、回答审批、准备环境、请求停止或明确重试，附目标身份和适用条件 |

例如目录阻塞应表达“工作和输入已保存，尚未启动；某 execution 停止未确认；可查看详情或等待”，不能只返回 failed，更不能建议直接关闭用户终端。现有共享 checkout 能力不能倒退为笼统的目录排他；只报告当前引擎实际拒绝的租约、嵌套目录或未知执行等条件。

下一步是运行时允许操作的描述，不是自动授权。模型选择后仍在执行前复核工作版本、执行身份、租约、能力与批准，旧卡片按钮不能绕过新状态。确定在副作用前被拒绝时可给出修复前提；结果不明时先核实，不能统一建议“再试一次”。相同请求身份返回已有回执，内容冲突明确拒绝。

工作入口应持久可见，按当前执行／安排及版本展示有效状态；历史 ready 可查看但不能覆盖新启动失败。Janus 消费精简摘要及恢复选项，详细证据按引用读取，不反复注入完整账本。引擎负责规范化和合法操作，JanusX 只负责本地化、展示与用户交互。

候选验收场景：启动前失败仍可找到工作且保留输入；新安排错误不被旧 ready 遮盖；相同请求返回已有动作结果；unknown 不提供盲目重放入口；占用提示能定位实际阻塞者；过期操作被拒绝；聊天和工作卡对同一版本一致。若现有回执已满足这些条件，优先复用；只针对重复投影和诊断缺口抽取契约，不为统一名称重写存储。

### 三、正式报告的证据契约与完成判断

2026-11-11 用户以 xdo 授权实施结构化汇报与阅读界面，并要求对话卡片移除输入编号、UUID、哈希与 checkout 等密集过程信息。工具字段约束、不可变结构化资源、历史兼容及简短卡片现已落地，当前事实归 [Worker 决策](../superagent-workers.md) 与 [界面决策](../superagent-interface.md)。下面关于自动完成判断、证据过期判定和补充验证调度仍为候选；本次未启用报告自动唤醒或正式验收流程。

**问题与目标。** 已有显式报告优于根据轮次结束猜完成，但报告能否支撑协调判断需要单独约定。报告保存成功、Worker 自报 ready、验证命令通过和目标满足分别表达，不能互相推导。此建议增强可追溯性，不把普通工作强制变为正式 Task，也不默认增加审核 Agent。

可在现有报告结构上逐步补齐以下语义，具体 schema 应与现有报告、资源和输入覆盖契约对齐：

| 内容 | 最低语义 |
| --- | --- |
| 归属与覆盖 | reportId、workId、executionId，以及所依据的输入／目标版本或覆盖引用 |
| 工作结果 | 已完成内容、结果类型和未完成部分，不用一句“完成”代替范围 |
| 修改与产物 | 文件、资源或提交引用；未提交、只读分析、无文件产物都允许如实报告 |
| 验证证据 | 实际命令／方法、环境与目录、结果、日志或产物引用；通过、失败、未运行、不适用分别表达 |
| 阻塞与限制 | 缺失权限、无法验证的条件、已知失败、待用户决定事项和适用的恢复建议 |

证据需要限定执行和代码状态的适用范围。历史测试不能覆盖新修改；新输入未处理、测试后代码变化或共享 checkout 被其他 Worker 修改时，旧证据可能失效。有未提交改动时，HEAD 不能代表完整验证对象，应按风险关联相关文件／补丁摘要、资源版本或现有快照引用。具体粒度待设计，不强制每项任务保存整仓快照。

Janus 首先核对要求覆盖、结果矛盾和证据缺口；需要代码调查或进一步验证时仍安排 Worker，遵守现有协调职责。明显缺项可请求原 Worker 补充报告或做针对性验证，既不能因结构齐全就信任全部内容，也不默认重跑全部测试。仅在任务明确要求或用户选择时增加独立评审；已有正式 Task 的验收与独立评审义务保留。

现行产品不设专门验收流程，初期可仅增强报告展示，不增加 accepted 状态。若以后启用自动完成判断，判断依据、评估的报告／输入版本和判断者应单独记录，不改写 Worker 原报告，也不将接收成功映射为验收通过。旧自由文本报告保留历史，不推导不存在的验证事实；格式升级与兼容策略需在实施前明确。

候选验收场景：只读任务无需伪造文件修改；未运行测试显示未验证；失败测试不能汇总为通过；旧执行及重复报告不推进当前完成；新增要求使旧覆盖不足；共享目录变更可提示证据过期；日志引用不可读时明确缺口；报告保存与后续判断失败分别恢复。结构 fixture 验证契约，真实模型任务另验诚实报告限制和识别缺项的能力。

### 推进顺序、取舍与参考

建议先完善统一状态和恢复回执，再补齐报告证据与版本关联，最后在明确产品范围后加入有界事件消费。三点可独立交付，自动推进不是前两点的前提。任务 DAG 等真实依赖场景出现再扩展，不预先引入递归 Worker、远程联邦和通用邮箱系统。

保持仅通知的成本最低，符合现行用户主动续接方式，但多阶段任务仍依赖手动跟进。自动协调减少跟进成本，同时引入模型费用、错误返修和事件竞态，需要预算与证据约束。统一回执减少模型和 UI 猜测，代价是梳理已有状态投影。结构化报告提升可追溯性，但增加协议和上下文开销，应使用短摘要与按需引用，避免每次携带完整执行日志。

参考包括 Orca 的[新版编排指南](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md)、[邮箱投递实现](https://github.com/stablyai/orca/blob/main/src/main/runtime/orchestration/db/messages/role-mailbox-delivery.ts)、[Worker 启动入口](https://github.com/stablyai/orca/blob/main/src/main/runtime/rpc/methods/orchestration/worker/workers.ts)与[生命周期消息校验](https://github.com/stablyai/orca/blob/main/src/main/runtime/orchestration/workers/lifecycle/lifecycle-reconciliation.ts)。它们是本轮阅读的可变 main 链接，未固定提交，不是 SuperAgent 已实现或已验证的证据；实施时需核对版本。公开网站的 check 等待示例与新版指南的事件唤醒建议存在差异，不以旧 Coordinator 类推定当前自动拆解能力。

本节初次保存时仅记录方案和候选验收场景。随后第三项的结构化报告与阅读界面已按 xdo 实施，结果归对应 Worker／界面决策；自动唤醒策略、权限、审批行为和应用历史账本未因此改变。

## 执行完成但偏离需求的质量链路

2026-11-13 用户明确本次问题是任务能够完成，但结果质量差或偏离需求。Main 对照本机应用的输入85–90、scheduling 动作参数、Janus 对话时间线、Worker 原生会话和正式报告。该样本的首个偏差发生在需求解释与任务说明，之后的自测和报告展示没有纠正目标；不能据此推定全部任务都由同一原因造成。

输入85要求优化“右侧卡片worker 收起展开”，存在单卡片与整体栏目的指代歧义。Janus 未定位实际界面对象，派发说明已加入“微型终端监视器、刻度、阻尼”等具体方向。原生 Worker 收到了这份说明及完整用户原文，按单卡片实现 WorkerMonitor，并报告14项组件浏览器回归和46组离线检查通过。用户随后反馈看不到变化，输入88才明确“右侧worker整体栏目”；输入89据此重新派发整体 Dock。该轮 Worker 使用 gpt-6-astra／xhigh，证据不支持将这次偏差归因为原文丢失或 Worker 模型降级。

同一会话中，输入86询问是否修改，Janus 的未截断时间线没有工具调用，直接复述已完成结果。输入87反馈没有变化时，Janus读取了环境、工作卡及报告，却把路径和运行目录当作主要原因；这些读取不能证明用户实际打开了哪个界面对象。Worker 报告明确标注未构建安装包、未代替主观验收，这些限制没有成为主对话后续判断的显著边界。交付路径需要说明，但本例后来已确认另有目标对象误解。

修复前核对的代码边界：

| 环节 | 已核对的行为与影响 |
| --- | --- |
| 需求到分派 | chat-tools 要求尽早委派调查、实现和验证；dispatchContextSchema 保存 goal、constraints、来源和版本，没有独立的目标对象、必需验收结果或假设字段。来源完整性可检验，语义正确性依赖 Janus；具体设计假设容易进入约束并被 Worker 当作既定方案。 |
| 约束续接 | workerDeliveryHeader 用字符串 includes 对约束数组求差，旧文本未出现在新数组时输出 Withdrawn constraints。原生输入89／90确有这种提示；换措辞或合并条目也被表达为撤销。最小探针另验证，模型漏写仍有效约束同样会被标成已撤销。实际样本证明了错误的撤销表达，尚未证明它造成某项功能回退。 |
| 报告与验收 | workerReportSubmissionSchema 接受 kind=ready 且 checks=failed、存在未完成 limitations 的报告；本轮最小探针实际返回成功。Worker phase 看正式报告、当前输入版本与原生轮次结束，不核验需求是否满足。ready 按现有契约是交付声明，不能用于推导验收通过。 |
| 后续协调 | 普通 work_route 的报告在 useJanusChat 中追加到对话，不唤醒模型复核。显式 work_plan 已有开发→测试依赖与最多一轮返修，但本样本未使用该链路；其节点完成也依据当前 ready 报告，不能声称已有通用语义验收。 |

建议优先在现有 assignment 中区分用户要求、定位到的对象、模型假设与可观察的验收结果；不必创建正式 Task。对关键对象歧义作一次定向确认，或先用读取证据定位，避免未定位就把视觉隐喻定成必需方案。约束续接应使用稳定身份与显式替代／撤销来源，漏写不产生用户撤销语义。若后续授权普通工作自动推进，复用现有报告事件与动作幂等机制，让 Janus 对照原始要求、实际产物和必需检查做有界复核，保留交付与验收的区别；只在发现具体缺口时返修，不默认增加独立 Agent 或重跑整仓测试。

证据保留在用户原目录，不复制整份会话进仓库：应用 janusx/superagent 的 records.json、scheduling.json、资源297eb61d-b5e2-411f-8bc7-2829ae163580与062c60a0-8e4b-489c-881f-a6b572f7f548；Janus 会话1fa5b19a-82e2-4720-ba43-945e34c494e8；原生线程01a1c93e-b5d4-7bf0-b347-7258af677936。抽查时安装包引擎元数据为6312b33e4d953071，工作区依赖为0ffd216a55f9f844；分派、schema、service、worker-prompt、worker-launch、workflow及报告契约共8个文件字节相同，workers文件存在差异，但安装版的ready判定与上述结论一致。版本标签差异本身不构成这次语义偏差的原因。本轮只做读取、两个模块探针与文档维护，没有改变产品运行逻辑、应用账本或启动真实 Worker 验收。

上述问题已获用户以 xdo 修复优化并 review 的指令授权。当前实现补齐目标／验收契约、显式约束撤销和普通工作的有界证据复核；实现职责与限制分别维护在[上下文决策](../superagent-context.md)和[Worker 决策](../superagent-workers.md#普通工作交付后的证据复核)。本节保留修复前样本用于解释改动原因，不作为现行行为说明。

## Open questions

下面历史问题保留为后续范围；前述分派、共享目录与超时分析已获 xdo 授权并实施，结果见文末。

- 后续是否还需迁移其他宿主业务工具；本轮已完成 SuperAgent 后端、Git 环境与原生 Worker，浏览器及产品服务仍由壳体提供。
- 是否采用上述有界报告事件消费，还是继续只通知并等待明确输入？若采用，自动协调范围、内置预算和证据判断规则如何确定？
- 内置停滞判定、恢复次数和最后熔断条件如何用真实轨迹验证，避免误停正常分析或把成功读取误当进展？
- 多后端第一批支持哪些原生能力，缺失模型切换、追加、停止确认或沙箱能力时如何呈现限制？

## 提示词精简实施

实际实现位于 agentX 的 superagent/worker-prompt.ts 与 workers.ts，桌面继续消费固定引擎包。首次正文保留任务、目标、约束及 checkout／branch；HEAD、内部工作 ID 与修订号保留在 read_work 数据中。输入原文直接呈现，完整输入只附资源 ID，截断输入附版本与精确续读位置。固定协作、权限、共享目录及结构化汇报规则放在线程系统指令中，不再随每条输入重发。首次执行或历史丢失时明确要求读取原始需求；解释过期时以新原文为准，不自动推断 Demo 已获批准。

同一执行和进程内确认续接同一原生线程时，WorkerBrief 分字段保留已接收内容；续接仅发送本轮原文和改变的目标、标题、目录或约束。新增／撤销约束分别列出，未变约束继续有效；任一侧为截断预览时要求读完整约束，不将省略项视为撤销。仅修订号、背景或来源变化时给出短补读提示，不重发全部范围；HEAD 更新也不重发。接收回执后才更新内存记录，审批延期不能提前消耗变更。应用重启、回收后缺少接收记录时保守补发一次完整范围，原生历史丢失则重建；已重建且接收成功后的下一条仍为短续接。正文预算 2000 tokens，超出时附明确补读指令，整体继续受 8000 tokens 投递预算约束。历史报告为短摘要与读取引用，不代表当前验证。状态询问只核查并汇报；明确实现或修复请求仍自主执行，不以关键词另设路由分类器。

本轮固定包标识 `fcdb2f0490800835`，六包、锁文件与安装目录一致。agentX 的 `npm exec --workspace=@janus-agent/janus-agent -- vitest run tests/worker-prompt.test.ts` 通过 5 项；消费端 `npx vitest run tests/unit/superagent-workers.test.ts tests/unit/superagent-lifecycle.test.ts tests/unit/superagent-context.test.ts tests/unit/engine-packages.test.ts` 通过 44 项，覆盖续接、缺失历史恢复、投递竞态及长原文无损召回。引擎编译、桌面 `npm run typecheck:strict-unused`、`npm run build:app`、包边界和固定包 SHA256 校验通过。Notes 校验为 340 篇、0 errors，17 条既有跨仓库链接诊断。本次构建更新当前 worktree 的 out，未重新制作安装包，也未进行真实模型端到端验证；旧会话记录不会被重写。

2026-11-11 增量提示词验收：固定包更新为 `9079f8b4eae8658b`，实际字节变化仅限 worker-prompt／worker-launch 及声明文件，六包与安装字节经 prepackage 核对。对同一组原型需求的样例，仅版本变化的续接从 1879 字符降至 266（减少 86%）；目标变化从 1842 降至 311（减少 83%），首次范围从 2036 降至 1038。前后正文、估算 token 与复现脚本在 `artifacts/worker-prompt-20261111/`；这是代表样例，不是所有请求的固定压缩比例。

本轮分阶段通过 91 项：引擎 worker-prompt／dispatch-context／worker-report 16 项；消费端 context／store／worker-mcp／engine-packages 24 项、lifecycle 20 项、workers／routing 30 项；真实 Windows Codex + 构建后的 Electron MCP 1 项。原生链路验证短补充、历史缺失重建、原文分页、结构化汇报、内部工具无重复许可及后台停止；模型响应使用 localhost 协议夹具，不声明云模型语义可靠性。生命周期旧断言已匹配现有的派发前原文校验：背景原文缺失时不启动新执行；报告原文缺失时仍阻止历史重建。严格类型与 build:check 通过，构建在 artifacts/build-check；当前运行进程、安装版与历史会话未替换或改写。

## 协调分派、共享目录与界面收尾实施

用户授权将前述问题合并 xdo。Main 在 agentX 实现协调器工具边界与专用提示词，移除 SuperAgent 的 registry 工程读取／搜索能力和普通直接开发 WorkflowX 提示词；work_route 指引明确包含“分析…需要优化修复”和续接修复。仍由同一个 Janus 解释意图，没有新增分类 Agent；讨论、状态询问和关键澄清继续保留。工具限制是确定性保证，真实模型能否正确解释每一种自然语言仍需使用轨迹验证。

同一 checkout 允许多个工作绑定及独立 Worker 租约，普通终端不阻塞启动。既有共享目录中的改动予以保留；未分配目录的脏文件仍要求明确承接。相同 workId 重复租约、不同可写目录的上下级重叠、未知执行及停止未确认继续阻塞。宿主提交串行化并同步同目录有效租约 HEAD，合并／删除在提案与批准时均核对共享分配及空闲；Worker brief 明确文件／模块分工、保留他人修改和独立临时输出。文件职责依靠协调与自查，当前没有强制的文件级锁。格式仍为 version 1，旧引擎拒绝共享绑定，不能直接带新账本降级。

桌面聊天五分钟空闲超时现在取消对应后台请求并解除监听，迟到事件不能覆盖失败状态；不自动重放不明操作。初始状态显示等待响应，收到推理事件才显示思考中。卡片在旧实例已确认停止后采用新的失败／排队调度状态，保留原生失败后的重试入口。模型设置原生 dialog 显式指定 fixed/inset/margin 居中，避免全局 margin 重置使其停靠左上角；保留既有模态交互和 Select 容器。

最终固定引擎包为 c335748d60a85a10。Main 回归：引擎模式／Worker brief 8 项；消费端环境、路由、共享 checkout、生命周期、固定包 5 文件 53 项；界面浏览器 20 项；聊天超时、状态与运行态 6 项；目录选择 9 项。真实 Git 夹具验证共享租约和提交后的 HEAD 同步，受管执行器夹具验证两个 Worker 同目录并行且单独停止互不影响；没有以 fixture 冒充真实云模型行为。首次回归的旧独占断言及旧 JSON 提示词断言已更新，界面优先级回归修复后 20 项全部通过。模型弹窗截图已查看，居中另由窗口坐标断言验证。

引擎全包编译、桌面严格类型检查、双语检查、固定六包实际文件哈希与包边界检查通过，最终桌面构建日志位于 artifacts/superagent-coordination-build.log。上述测试为分阶段执行，目录选择 9 项在前一打包轮次通过；最终包再次通过环境／路由／共享目录／生命周期／固定包 53 项。JanusX Notes 340 篇、0 errors、17 条既有外链诊断。引擎 Notes 检查仍有两处原有错误：agent/omp-tooling-design.md 缺 Intent，proposed/architecture/2026-09-16-codex-cli-tool-surface-survey.md 的历史相对链接失效，另有两条跨仓引用诊断；本轮维护文档未新增错误。本次更新本 checkout 的固定包及 out；没有重放真实用户请求、修改其账本或关闭其终端，运行中的其他 checkout／安装版不会自动升级。真实云模型端到端、真实原生双 Worker 同文件冲突恢复仍未验证。

## ??????????

????????? package:prepare ??? Windows x64 NSIS ?????? release/superagent/installer ???????blockmap?latest.yml?builder-debug.yml?BUILDINFO.json ? SHA256SUMS.txt????? 0.9.8?????? c335748d60a85a10?????????????LLM runtime ??? GUI ???????478 ??????178 ????????????????? SHA512???????????? SHA256 ???????? SHA256 ? 7ac6be77787251f018b49ff96b2ac8412b31da0dceb1103c949c703ed5a8f184????????? artifacts/superagent-installer/installer-verification.json?????????????????

## 工具执行流畅度优化

2026-11-11 用户要求参考 Codex CLI 与 OpenCode CLI，记录 Note 并以 xdo 实施、测试和修复。共享引擎的调度、长命令续接、完成通知和停滞判断由 [工具执行 Note](note://62b44166-82f0-41ff-838d-e2b02388ed06/1b5b3374-506b-46b5-a229-a4074baef96b) 维护。已修复同批 edit → read 被重排的问题；普通命令默认等待 10 秒后交回执行 ID，完成事件自动续接原任务，进程期限独立设置。真实运行等待不再触发重复停滞；重复发起尚在执行的同一调用等待原实例，恢复提示不要求盲目重跑。

桌面端口与记忆、Note、自动化、启动配置、工具事件包装层保留续接能力和请求取消信号；初始回执显示 running，最终回执沿原 callId 更新卡片。引擎的最终工具记录替换初始 running 状态，供验证与收尾使用。Desktop Task、CLI 和共享 WorkflowX 验证流程等待真实完成结果。background:true 继续用于常驻服务，普通长命令无需模型预判并反复轮询；续接状态当前仅在宿主内存中，不提供应用重启后接管。

最终桌面固定六包为 7c354dd1b2b25cc0，package.json、package-lock.json、归档 SHA256 与安装目录实际文件一致。消费端执行 npm run test:unit:fast -- tests/unit/llm/command-continuation.test.ts tests/unit/llm/janus-agent-ports.test.ts tests/unit/chat-tool-events.test.ts tests/unit/agent/memory-tool-context.test.ts tests/unit/agent/command-tools.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/chat-stream-timeout.test.ts tests/unit/janus-tool-pairing.test.ts tests/unit/model-tool-name-contract.test.ts tests/unit/engine-packages.test.ts tests/unit/automation-chat-tools.test.ts tests/unit/note-chat.test.ts tests/unit/launch-config-chat.test.ts：13 文件、125 项通过。真实子进程经过上述包装层后超过模拟前台期限仍完成，且只启动一次；取消测试检查运行时 cancelled 回执，CLI 另核对子进程已退出。严格未使用类型检查、本次修改源文件 lint、包边界和 npm run build:check 通过。日志位于 artifacts/tool-execution-desktop-tests.log、artifacts/tool-execution-typecheck.log、artifacts/tool-execution-build-check.log。

桌面任务端口另外执行 npm run test:integration -- tests/unit/harness-desktop-executor.test.ts，45 项通过，日志为 artifacts/tool-execution-task-adapters.log；与上述单元回归合计 170 项。引擎分阶段回归共 717 项通过、1 项既有 skip，CLI 相关 16 项通过，且实际验证命令运行约 10.3 秒后自动续接成功。

本轮测试使用本地模型流 fixture 和真实子进程；未宣称真实云模型速度／token 收益。构建输出在 artifacts/build-check，未覆盖正在使用的 out，也未制作或安装新安装包；运行中的应用不会自动采用本次实现。

Notes 检查为 340 篇、0 errors、17 条既有外链诊断。引擎侧还记录两处既有 Note 错误，以及可在原 CLI 适配器复现的两项 xflow 独立评审测试失败；详情和复现日志见共享工具执行 Note，未将这些结果表述为全部通过。

## 协调器上下文与少轮派发（Codex CLI 参考，待实施）

2026-11-12 用户要求分析连续 work_read_resource 后才派发的延迟，并参考 Codex CLI 学习工具流程。本节只记录排查与候选设计，不改变现有派发、权限或上下文契约。

本机安装版 0.9.9 的引擎为 20c26913ba5c4f38；安装包内 chat-tools、context、context-reader 与本 checkout 的固定依赖字节一致。21:48:58 提出的“移除独立提问及左侧高亮边，HTML 与代码同步调整”在 21:52:58 回复：总耗时 239.665 秒，15 次工具执行合计 13.820 秒，其中 10 次 work_read_resource 合计 5.906 秒。实际顺序为 list、card、environment、route、十次 resource read、route、正文；首次正文出现在第 234.862 秒。工具之外的 225.845 秒包括模型、网络和宿主处理，不能全部算作推理耗时。时间线只有参数名，没有资源 ID、offset 值或路由阻塞正文，不能逐条证明重复读取。可重查统计保存在本机 artifacts/superagent-latency-2026-11-12.json。

共享引擎存在可定位的不一致：context.card 优先以 work.assignment 构造有效解释，chat-tools 的路由补读集合却从旧 context.interpretation.coveredInputIds 生成。该工作当前 assignment revision=12，旧 interpretation revision=10。ContextReadEvidence 每轮新建；最小运行探针确认，普通历史文本不会自动取得资源读取凭据，本轮正文与凭据进入模型请求后才计入已读，旧轮凭据也不会被新实例接受。这些事实支持重复补读风险，但不证明每次补读都由同一原因触发。

### 固定源码与可借用机制

核对官方 openai/codex 提交 c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee（2026-11-12），本机只读参考 checkout 位于 .cache/codex-cli-reference。以下路径相对该 checkout；这是该提交的实现，不保证其他安装版本相同。

| 机制 | 源码证据 | 对本系统的含义 |
| --- | --- | --- |
| 一次响应可发起多个工具调用 | codex-rs/core/src/session/turn.rs 使用 FuturesOrdered 保存 in_flight，收集结果后记录回会话；tools/parallel.rs 按 supports_parallel 使用共享或独占锁 | 独立读取可同批，写入／派发仍保留依赖屏障；不能让模型尚未看到的读取结果授权同批派发 |
| 读取工具明确声明并行能力 | tools/handlers/mcp_resource/read_mcp_resource.rs 返回 true；tools/handlers/mcp.rs 使用服务器并行能力或 read_only_hint | 可给本地工作读取工具设置明确的并行元数据；MCP 提示只影响执行策略，不替代宿主授权 |
| 模型历史与持久原文分别管理 | context_manager/history.rs 的 record_annotated_items 保留原始 rollout，截断应用于模型历史副本；history_version 区分压缩／回滚 | 区分存储原文、当前模型可见材料和当前有效约束，不用一个“已读”标记代替所有状态 |
| 尽量追加上下文，保持前缀稳定 | client.rs 保留同轮连接及增量请求状态；context_manager 保存历史与版本 | 固定规则／schema 顺序，动态工作卡作为追加状态；收益需看供应商实际 cache usage，不能承诺 Gemini 复用 OpenAI 专用机制 |
| 按模型压力压缩并保留后续上下文 | session/turn.rs 与 session/context_window.rs 区分 token 使用、阈值和继续条件 | 复用既有 ManagedChatSession，避免在每条短补充前重建全部背景；压缩后关键缺失仍须恢复 |

官方 [Codex 工具指南](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide#parallel-tool-calling)建议先确定所需读取再批量调用，依赖未知结果时才串行；[Prompt Caching 201](https://developers.openai.com/cookbook/examples/prompt_caching_201)说明 Codex 使用稳定前缀和追加变化；[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)记录自动压缩阈值；[App Server](https://learn.chatgpt.com/docs/app-server)区分 thread、turn 与 item。它们支持机制取舍，不提供本系统的性能保证。

### 候选改造与验证顺序

候选设计与大窗口参数调整已统一整理到[工具、运行时与上下文优化方案](superagent-context-simplification.md)。该方案包含代码 review 结论、工具职责、覆盖兼容、请求可见性、共享批次预算、统一结果、实施顺序及 V1–V10 验收。本节保留实际耗时、探针和 Codex 固定源码证据，避免两处继续维护实施清单。

首期 work_read 聚合派发材料、统一有效说明、可见证据与预算已经实施，没有在 work_route 建第二条自动补读路径。实现和验证归[上下文决策](../superagent-context.md)与[统一方案](superagent-context-simplification.md)。本节保留改动前分析证据，真实用户派发未重放，云模型性能收益未实测。

### 数值阈值的职责与简化方向

用户进一步提出是否因 SuperAgent 设置过多数值与阈值而限制执行，要求先记录再讨论。当前证据可以确认本链路有多层固定裁剪，不能据此断言 Codex CLI 的参数总数更少；没有做全仓参数数量统计。此前对 Codex 的机制概述未列出其内部上限，不应被理解为 Codex 没有阈值或行为保护。

改动前 SuperAgent 的业务 Inline 为 8000 tokens，近期输入 4 轮，首批候选 5 项，必要原文使用 100／120-token 预览；历史展示另有 1200 字符分页，资源还有 48000 字符上限。协调器的重复裁剪与预算已按统一方案收敛。历史展示、Worker 传输和业务校验的职责性限制仍保留，不意味着持久历史只保存四轮。

固定 Codex 提交的 codex-rs/core/src/unified_exec/mod.rs 同样定义默认输出 10000 tokens、输出缓存上限 1 MiB、进程数量上限 64，以及 yield／等待的上下界；这些值分别约束输出、缓存、进程和等待，不能混为总执行期限。官方配置还包含 model_auto_compact_token_limit、tool_output_token_limit、重试与超时等参数。因此设计比较应关注每个限制是否有明确职责，以及多个限制是否反复作用于同一信息，而不是比较表面上的数字多少。

对本链路可分三类处理：模型窗口、传输上限、取消和资源保护继续保留；候选页数与可选历史预览作为可恢复的展示策略；派发所需原文的固定小预览及重叠预算优先合并。例如必要短原文能完整放入本批预算时，先截成 120 tokens，再因不完整要求模型补读，会额外消耗工具与推理轮次。是否确实发生应由资源范围与路由缺口日志验证，不能用这个例子反推本次十次读取的全部原因。

实现复用既有上下文管理器，以实际模型空间、输出预留和传输边界计算共享预算，能放下的必要材料完整返回。覆盖来源不一致和可见证据失联另作契约修正，没有固定两三次读取上限。原生传输限制与未知副作用保护继续保留。
