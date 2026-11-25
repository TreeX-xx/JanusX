---
{
  "schema": "harness-note/2",
  "id": "e1bdfc5f-a4ff-4dea-b7e3-965ab2ffe161",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-25T02:09:23Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a591e250-1719-48a5-8750-663fdb00681e" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/61ec1bb4-e349-4aa2-a10b-346afef29920" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e546b79c-cdf2-49e5-8efd-8dcf5c11b017" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/scheduler.ts", "symbol": "SuperAgentScheduler", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/chat-tools.ts", "symbol": "createSuperAgentChatTurn", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/scheduling-store.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/SuperAgentWork.tsx", "role": "entry" }
  ]
}
---

# SuperAgent 的 Janus 分派与可配置 Worker 调度

## Problem

P3 提供受管执行，但显式选择单工作、等待执行启动的中间入口不能承担连续对话。用户要求同一个 Janus 理解新工作、补充、历史与停止，并明确并发数量不能写死为两个。原生审批、迟到停止回执和工作关闭都可能与新输入交错，容量不能只根据卡片数量或模型描述计算。

## Decision

### 同一 Janus 与宿主边界

正常 Janus 对话在模型调用前保存原始输入，按消息事件去重，并固定发送时的工作区和会话。运行中 steering 也先保存再确认；切换浏览工作区不会迁移旧轮次。工具只接受本轮宿主接收的输入身份，取消的 steering 撤销其分派资格。专用受限工具会话继续使用原能力范围。

`work_list`、`work_read`、`work_read_resource` 和 `work_route` 加入既有工具集合。同一个 Janus 结合目录和简单卡片判断回答、软件操作、新工作、继续、停止、关闭、明确重开或澄清，不增加分类模型。只读工具不启动 Worker，候选首屏最多 5 项，目录可搜索和分页到全部保留历史。P5 已补齐[上下文投影、覆盖信息和读取保护](superagent-context.md)，并加入同一 Janus 的 work_update_context 解释入口。

分派先核对输入、工作版本和当前状态，再持久保存决定意图。相同输入与动作身份返回已有结果；内容冲突、结果不明或早于最近停止／关闭的旧输入不能重放。新工作允许一条用户输入拆成多个独立目标，Worker 每次收到自己的明确目标以及原始输入。关闭取消待执行输入并请求停止；只有新输入的明确重开可继续。

工具返回安排状态和工作引用，后台启动不占住模型工具调用。工作区、目录归属与批准仍由 P2 复核；增加容量不自动批准新 worktree。普通原生输出只刷新卡片，正式 ready／问题／失败报告按稳定报告 ID 进入所属对话一次，不自动再发起模型轮次。

共享 `janus-agentX` 的 `ChatTurnRequest` 增加可选宿主策略 `workspaceMutationRecovery`，默认保持既有行为。SuperAgent 对话将其设为 false，关闭“尚未直接修改工作区”的通用补做提醒；软件工具及其权限仍然保留。真实桌面检查发现原提醒不认识 Worker 安排，可能额外要求 Janus 自行改文件，因此不能只靠新工具提示词处理。共享源码、两项策略测试及所属模块 Note 同步维护；当前桌面消费 vendor 固定 tarball，修改共享源码后构建产物并更新 manifest、依赖和 lockfile，经包完整性校验后构建应用。

### 容量与执行

独立的 `scheduling.json` 保存正整数 `maxConcurrentWorkers`、每工作一条安排及决定去重记录。默认值为 2，设置 1、2、4 或其他正整数均使用同一逻辑。并发上限由「设置 → SuperAgent → Worker 调度」配置。右侧工作区显示名额占用。提高上限立即排空可执行队列，降低到当前占用以下会要求先结束相关执行。占用和入队序号均为宿主全局计数，候选及工作操作限明确工作区；不同工作区已经获准安排的工作共享同一队列。

满额自动排队，以实际入队序号取代原始输入序号。优先级为高／普通／后台，默认普通；有效优先级相同时全局 FIFO。可调度等待每满 15 分钟提升一级，最高到高，不抢占已占用名额。补充保留原工作顺序、优先级和暂停状态；活跃工作直接尝试追加，不重新申请容量，停止直接进入控制通路。空闲轮次因已有补充切换原生 execution 时保留原工作的名额和先后顺序，避免新工作抢先占满。运行、原生等待及尚未明确 ready 的空闲执行都占名额；明确 ready 且进程树结束、确认停止或确认失败退出后才释放。每次占用绑定本次启动，旧停止回执和旧原生事件不能释放后来执行的名额。

队列控制只允许尚未占用名额的 queued／paused 工作，使用独立 queueVersion 防止旧界面操作覆盖新输入或已经启动的任务。暂停不停止执行，恢复保留 FIFO 序号并重新计等待晋级时间。取消排队撤销 pending／unknown 投递，保留工作与历史；后续新输入可再次安排。环境等待不参加可执行排序，暂停标记穿过补充与环境批准保持有效。普通输入、`#` 引擎选择与 `@` 直投都进入同一宿主调度器。

账本升级为 version 2，增加 nextOrder 与队列元数据；version 1 读取后建立确定性历史顺序，下一次写入保存新格式。重启仍把 queued、paused、环境等待及运行记录转为 interrupted，要求新的明确输入，不自动消费旧授权。旧版引擎不支持新版账本，不能直接降级复用。宿主快照只返回当前工作区明细，同时提供全局占用、排队数、暂停数、受阻数与全局位置；任一工作区改变队列会通知全部已知工作区。

原生审批阻塞的补充保持 pending。持久发送标记之后若原生适配器在 RPC 之前明确本地拒发，宿主恢复待投递，决策解除或轮次变化后按当前状态处理；已实际尝试 RPC 而回执不明仍保持 unknown，不自动重试。停止／关闭撤销 pending 与 unknown 的后续投递资格，已发送内容不因此伪装成从未送达；进程停止确认单独记录。

ready 后结束该 execution 的原生进程树以确认后台活动已收尾，保留工作、报告、线程引用和 ready 卡片。明确继续使用新 execution 恢复原线程。卡片保留不代表仍占执行容量；P6 已实现[30 分钟实例回收及应用恢复](superagent-lifecycle.md)，未确认停止跨重启仍占容量。重启只恢复记录，旧队列／等待／运行转为 interrupted，需新的明确输入，不自动续跑。

### 界面

现有聊天输入承担自然分派，P3 的手动运行／补充按钮已移除。右侧按运行中、排队、待处理及已结束／保留分组；运行、排队和待处理项目不因历史分页而隐藏。排队卡显示全局位置、等待原因、可调度等待时长、优先级及等待晋级，并提供暂停／恢复／取消。卡片跨组保留组件身份和未提交的交互状态。每 30 秒刷新等待信息，调度事件即时刷新；异步读取仍按工作区与版本隔离。`@` 的“调度已接收”与开始执行分开呈现，当前目标在队列时附全局位置；模型回执根据宿主安排状态说明排队，不承诺已送达。

## Alternatives considered

- 保留两个固定 Worker 槽：实现少，但数量、队列与控制会被界面结构绑定，违背可扩展要求。采用按工作身份的集合和统一容量配置。
- 再加分类 Agent：可以独立调提示词，但多一次模型调用、状态传递和决定竞态；现有 Janus 已有对话与软件工具，直接扩展其受限本地工具更短。
- 根据报告或 turn 结束直接释放容量：响应快，但原生等待、后台进程和旧事件会造成实际超额。宿主以执行身份和退出确认释放，代价是完成卡片可能短暂显示收尾状态。
- 重启自动消费旧队列：可以继续未完工作，但旧授权与结果不明的操作不能安全重放。保存记录并要求明确新输入，P6 已补齐实例事实恢复和原生历史缺失的保守重建。

## 已知问题与后续讨论

2026-11-08 的真实任务已创建工作和绑定输入，但来源 checkout 的嵌套 worktree 检查在 scheduler.request 前抛错，两个决定被记录为 unknown，尚无调度项或执行。主 Janus 在分派前大量读取，继续后又达到 40 轮上限；仅关闭 workspaceMutationRecovery 不足以建立委派职责。2026-11-09 用户要求循环控制内置，harness／SuperAgent 向 agentX 的收敛仍待讨论。证据、错误分类、侧栏不可见风险和迁移边界统一维护在[可靠性讨论](ideas/superagent-harness-reliability.md)，不以既有通路测试推定该故障已修复。

## Consequences

2026-11-12 分级队列交付使用 agentX 固定构建 `b9f04002dca68710`。源码修改在相邻引擎仓库；消费包以原固定构建为基底，只覆盖调度、服务和相关 contracts 的源码编译产物，六个包统一版本并更新 lockfile。变更清单保存在 `artifacts/priority-queue-engine-patch.json`。共享源码的其他未完成修改未纳入此次交付。

本轮 `superagent-scheduling` 14 项、`superagent-ipc` 11 项、`superagent-routing` 12 项、`superagent-lifecycle` 22 项全部通过；浏览器 `superagent-work-ui` 32 项、`conversation-topics-ui` 25 项全部通过，共 116 项。覆盖实际入队 FIFO、跨工作区位置通知、优先级不抢占、等待晋级、暂停穿过补充和批准、取消保留历史、版本冲突、旧格式迁移及恢复不执行。迁移测试曾与仍活跃的旧调度器并行写同一测试账本，现先关闭旧调度器，定向复测通过且无该写入竞争。

严格未用项类型检查、双语、定向 ESLint、应用 build:check 和六包完整性检查通过。已查看窄屏中文截图 `artifacts/superagent-priority-queue/narrow-zh.png`；分区切换保留打开控件和输入状态的浏览器回归通过。桌面 Notes 340 篇、0 errors、17 项外部引用诊断；引擎 corpus 74 篇、0 errors、13 项读取诊断。构建日志为 `artifacts/priority-queue-build.log`。本轮未运行真实 Codex／Claude 供应商任务，也未更新正在运行的桌面实例。

迁移第一步新增环境准备 blocked 状态。在 scheduler.request 之前发生的环境错误，与工作身份、失败阶段及恢复提示一起持久保存，右侧状态和待决策区域均可显示；重复相同决定返回原工作，环境修复后以新输入继续。进入调度后的结果不明仍保留 unknown，原决定禁止重放。旧 unknown 历史未自动改判，已有账本、原文和投递记录继续保留。实现和验证进度见[迁移记录](ideas/superagent-harness-reliability.md#顺序实施进度2026-11-09)。

P4 已完成正常聊天接入与可扩展调度。该步骤不等于整个 MVP 完成，P5 已交付共享上下文；P6 已交付生命周期，P7–P8 仍包含最终 UI 与联合验收。

容量没有产品硬编码的两个槽位；很大的 N 仍受本机资源限制。日志与队列继续采用本地串行 JSON 写入，工作量明显增长时再评估存储或公平性策略。语义归属质量依赖当前 Janus 模型，宿主只验证身份、版本、状态和能力边界；localhost 响应测试不能证明真实供应商对任意歧义的判断质量。

验证分轮覆盖 67 项相关用例：`superagent-scheduling.test.ts` 8 项，`superagent-routing.test.ts` 4 项，`superagent-workers.test.ts` 13 项，`superagent-store.test.ts` 10 项，`superagent-ipc.test.ts` 7 项，`superagent-work-ui.test.ts` 1 项，`llm/chat-turn-guard.test.ts` 23 项及真实 `superagent-native.test.ts` 1 项。调度验证同一机制的 N=1／2／4、等待占容量、ready 等退出、旧停止回执、原生审批前拒发、空闲续接优先、关闭／重开和重启不自动消费。真实 Git 集成建立 5 个不同目录，4 个执行、第五项排队，补充 A 与停止 B 互不串线。

共享包执行 `npm run test --workspace=@janus-agent/janus-agent -- tests/chat-turn-recovery-policy.test.ts tests/chat-turn.test.ts tests/chat-local-tools.test.ts`，29 项通过，包构建通过。策略默认行为和关闭提醒时的软件工具可用性都有实际断言。

`npx playwright test tests/e2e/desktop-superagent.spec.ts --project=desktop --workers=1` 通过真实 Electron preload／IPC 与 Codex：正常输入安排工作、受限目录实际写文件、报告出现、历史查询不启动执行、继续同一工作、Worker 运行时使用 `workspace_overview`、自然语言停止及进程确认。历史查询只产生本次工具与回答请求，未出现额外补做提醒；正式报告不唤醒模型。`superagent-native.test.ts` 另验证原生选项／中文回答、原线程恢复和停止后后台不再写入。两者需设置 `JANUS_SUPERAGENT_CODEX_BINARY`；原生测试使用已构建 MCP，桌面测试使用 `out/main/index.js`。

上述测试使用 Windows Codex 0.166.0、隔离配置、临时 Git 和 localhost 模型响应，不代表生产模型开发质量或其他系统已验收。聊天组件与桌面截图已查看。严格未用项类型检查、变更实现定向 ESLint、主题、双语和应用构建通过；Notes 校验 332 篇、0 errors，保留 17 项既有跨仓库链接诊断。复现日志与截图位于忽略目录 `artifacts/superagent-p4*`，稳定结论保存在本决策和实施计划。
