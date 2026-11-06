---
{
  "schema": "harness-note/2",
  "id": "e546b79c-cdf2-49e5-8efd-8dcf5c11b017",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-06T06:13:35.294Z",
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
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/workers.ts", "symbol": "SuperAgentWorkers", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/terminal/codex-conversation.ts", "symbol": "CodexConversation", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/worker-mcp.ts", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/controlled-commit.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/SuperAgentWork.tsx", "role": "entry" }
  ]
}
---

# SuperAgent 受管 Codex Worker 与 MCP 闭环

## Problem

P1 的工作记录和 P2 的受控目录需要接入真实执行。既有 Codex 对话桥依赖终端连接来建立线程，其显示长度、内存命令去重和未知请求转交终端的规则不能直接承担长期工作输入。Worker 还必须受宿主停止、工作目录身份和具体 Git 批准约束，不能因视图关闭或 MCP 失联继续脱离管理。

本决策维护[实施计划](ideas/janus-superagent-mvp-plan.md)的 P3 受管执行：真实 Codex 的启动、补充、原生决策、汇报及停止。P4 已将入口升级为[同一 Janus 的分派与容量调度](superagent-scheduling.md)，P5 已接入[共享上下文与原文召回](superagent-context.md)，P6 已补齐[生命周期与应用恢复](superagent-lifecycle.md)，完整侧栏／Island 归 P7。

## Decision

### 进程、线程与输入

[受管传输](../../../src/main/terminal/codex-managed-transport.ts)直接拥有 `codex app-server` 的 stdio 子进程，不启动 TUI；[CodexConversation](../../../src/main/terminal/codex-conversation.ts)复用原生事件与决策投影，并保留原终端通路。[Worker 协调器](../../../src/main/janus/superagent/workers.ts)按 workId／executionId 管理实例，绑定真实 providerSessionId 与 turnId。原生协议依据为 [App Server 文档](https://learn.chatgpt.com/docs/app-server)，实际兼容证据为本机 Codex 0.166.0。

完整输入先经 P1 保存，发送前将投递记为 unknown，收到原生确认后才记 delivered；该确认不代表语义上已纳入。活跃轮次使用 `turn/steer` 和预期 turnId。原生问题／审批阻塞时，输入保持 pending，解除后按原状态投递；轮次结束竞态由宿主串行核对。空闲后的明确补充启动新 execution，并恢复最近一个有真实 session ID 的线程；不因较新的失败启动丢掉旧会话。停止会取消尚未开始的续接，不自动重发结果不明的输入。

正常轮次结束、无输出或进程退出都不产生 ready。只有当前执行经 MCP 保存的明确报告能更新结果；旧执行和重复报告保留其历史语义，不重复通知或推进输入覆盖。后到的 pending／unknown 输入使旧 ready 不再覆盖当前要求；原生失败仍显示失败，不以此前 ready 掩盖。

### 权限与停止

每次启动和恢复都采用 [P2 lease 与权限工厂](superagent-environments.md)，派发前复核，运行中持续检查。线程显式使用本地执行环境及分配目录；`environments: []` 会关闭执行工具，不能用于表示受限的本地环境。启动分别诊断 CLI、登录、可信目录、本地环境和 MCP 就绪问题，不替用户修改全局模型、账户或规则。

[启动配置](../../../src/main/janus/superagent/worker-launch.ts)保留可用原生配置及 developer instructions，追加本次协作约定。继承 MCP 逐项禁用，本次只启用宿主桥；插件、apps、hooks、原生多 Agent、JS／code-mode 等额外执行通道在本次进程内关闭，并在界面披露。原生命令／文件审批只允许当前 profile 范围内的决定，拒绝扩权、持久网络／命令规则等旁路。配置叠加与能力名称以 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)和实际版本为准；能力不足明确失败，不降级为 full access。

停止先撤销桥接能力并阻止待续接，立即请求原生中断并停止所拥有的进程树；随后拒绝未决提交，排空已开始的输入、报告和受控提交，确认后才释放 lease。Windows 路径使用进程树终止，并验证受管后台子进程不会在停止后继续写入。异常退出或无法确认进程树结束时，保留失败状态、停止入口及环境占用；不伪造 stopConfirmed，也不自动重试。P6 将未确认停止与环境隔离持久保存，跨重启恢复只读实例事实，不猜测旧进程身份。

### MCP 与受控提交

[随应用构建的 stdio MCP](../../../src/main/janus/superagent/worker-mcp.ts)暴露 `report_work`、`read_work`、`read_resource` 和 `commit_work`。它通过只监听 loopback 的 [broker](../../../src/main/janus/superagent/worker-broker.ts)连接宿主，随机能力凭据绑定具体实例，不以模型提供的 workId 授权。心跳／请求失败终止桥接，旧实例的凭据撤销后不能继续读写。入口为主构建旁的 `worker-mcp.js`；IPC 构建在 `chunks` 时回退一级定位，Electron 以 `ELECTRON_RUN_AS_NODE` 启动。

报告先持久保存再回执。P5 起读取共用工作卡与来源覆盖，只返回本工作材料；超大正文依据原生工具输出保护及实际序列化字节数分页，返回版本、实际范围和续读入口，避免 Codex 再截断正文却保留旧范围。这只是内部传输边界，不新增用户读取额度。可选原生日志独立存储，单 execution 上限 2 MiB、总量 32 MiB，截断／缺失明确显示，清理不删除用户输入和正式报告。

Worker 的 Git 元数据仍只读。`commit_work` 提交明确文件和说明后，宿主展示路径、字节数、哈希与差异；用户批准仅针对该快照。文件变化、分支／HEAD 变化、已有暂存内容、保护目录、别名或符号链接均阻止错误提交。受控 Git 禁用 hooks、fsmonitor、签名及配置的 clean／smudge／process filters；实际提交使用私有 index、已核对原始字节和条件更新 HEAD，保留已有可执行模式。执行中提交与停止串行收尾，未知结果不重放；不隐含 push、合并或清理授权。

### 现有聊天和原生请求

[SuperAgentWork](../../../src/renderer/src/components/janus/SuperAgentWork.tsx)嵌入现有 JanusChat，P4 起由正常对话安排新工作或继续既有工作，卡片提供可配置容量、环境批准、原生决定、停止、关闭与持久报告。P3 的手动运行／补充入口已移除。导航只换投影，旧异步响应与控制身份不能串到新工作区；详细归属与报告交付规则见[调度决策](superagent-scheduling.md)。

命令／文件审批、`request_user_input` 选项和文字回答使用现有组件及原生请求 ID；产品尊重原生功能是否可用，不替用户开启实验选项。MCP elicitation 支持可验证的简单表单和 URL 操作，明确接受／拒绝／取消；无效必填答案保留待答状态。未知请求或无法安全映射的 schema 显示阻塞与停止能力，不自动批准，也不要求打开不存在的 Worker TUI。

## Alternatives considered

- 直接复用终端实例：可以沿用成熟显示，但会把执行建立、未知请求和停止依赖于 TUI／视图，不能独立确认 Worker 归属。因此复用协议映射，另建受管传输。
- 只加提示词或放宽沙箱以允许原生 Git 提交：改动少，但 Shell、外部 MCP 与 hooks 可绕过具体批准。保留原生写入限制，由宿主在快照批准后提交；代价是部分扩展和需要额外权限的工作流暂不可用。
- 固定两个 Worker 字段／槽位：实现简单，但违背数量可扩展要求。实例按身份存入集合；P4 统一通过 `maxConcurrentWorkers` 申请容量，默认 2，数量不绑定 UI 槽位。

## Consequences

P3 已有真实产品通路，P4 已接入自然分派和满额队列，P5 已交付共享工作卡与原文召回；P6 已交付回收与应用恢复，完整 MVP 仍待 P7–P8。ready 且原生轮次结束后，P4 调度器确认执行进程树结束再释放容量，保留线程引用、结果与 ready 卡片；明确继续使用新 execution 恢复原线程。P6 已在确认收尾后接入 30 分钟实例回收及原文充分性核验，细节见生命周期决策；最终侧栏／Island 布局归 P7。原生 API 或插件边界发生变化时，应按实际版本重验，不静默接受新增执行通道。

验证覆盖 Windows 的真实 Git、Codex 0.166.0 与 Electron：原生测试通过生产权限和构建后的 MCP，检查读取、代码写入、运行中补充、审批、中文回答、报告落库、原线程续接、全局配置不变、继承 MCP 未启动及停止后后台不再写入；桌面 E2E 从现有 JanusChat 经真实 preload／IPC 启动 Worker，看到 MCP 报告并确认停止。模型响应由 localhost 夹具提供，未验证付费供应商的开发质量、其他系统或任意 CLI 版本。

复现入口为 `tests/unit/superagent-workers.test.ts`、`superagent-commit.test.ts`、`superagent-worker-mcp.test.ts`、`codex-managed-decisions.test.ts`、`superagent-native.test.ts`、`superagent-work-ui.test.ts` 和 `tests/e2e/desktop-superagent.spec.ts`。原生用例需设置 `JANUS_SUPERAGENT_CODEX_BINARY` 并先构建 MCP；桌面用例使用 `out/main/index.js`。相关存储、环境、既有 Codex 对话、worktree 和退出回归通过；类型、严格未用项、定向 ESLint、主题／双语检查、开发检查构建和应用构建通过。Notes 校验为 331 篇、0 errors，另有 17 条既有跨仓库链接诊断。日志与已查看的聊天／桌面截图保存在忽略目录 `artifacts/superagent-p3*`，实际 Git 副作用均在临时测试仓库。
