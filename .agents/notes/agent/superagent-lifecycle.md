---
{
  "schema": "harness-note/2",
  "id": "a591e250-1719-48a5-8750-663fdb00681e",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-06T06:34:41.344Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e1bdfc5f-a4ff-4dea-b7e3-965ab2ffe161" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e546b79c-cdf2-49e5-8efd-8dcf5c11b017" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/61ec1bb4-e349-4aa2-a10b-346afef29920" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/lifecycle-store.ts", "symbol": "SuperAgentLifecycleStore", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/workers.ts", "symbol": "SuperAgentWorkers", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/service.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/terminal/codex-conversation.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/shutdown/AppShutdown.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/janus/SuperAgentWork.tsx", "role": "entry" }
  ]
}
---

# SuperAgent 实例回收、明确继续与应用恢复

## Problem

P4 已在明确 ready 后确认进程树结束再释放执行容量，但结果卡片一直保留，退出后的实例状态和未确认停止缺少持久事实。只保存工作摘要无法区分“可以继续的历史”和“仍可能写入目录的执行”；仅因没有输出或窗口已关闭就清理实例，会丢失待处理输入或错误释放环境。

本决策维护[实施计划](ideas/janus-superagent-mvp-plan.md)的 P6。完整右侧布局、双入口与 Island 联动仍归 P7，固定 44 条 AC 的全链路验收归 P8。

## Decision

### 实例与执行分别结束

`lifecycle.json` v1 按工作保存最近 execution／instance、工作区与目录、阶段、停止确认、空闲起点和回收时间。原始输入、正式报告、投递与原生线程引用仍由既有核心记录保存，生命周期文件不复制正文。新 execution 在启动进程前落盘；停止确认先落盘，再释放环境 lease。损坏、未来版本或身份不一致明确阻止执行并保留原文件。

ready 必须来自当前 Worker 的正式报告，并且进程树、宿主提交和已开始的写入均已收尾。此时开始 30 分钟实例空闲计时；执行容量已按 P4 规则释放。新执行输入立即退出计时，包括暂时排队的补充；下一次确认 ready 才重新计时。卡片、目录和历史查询不延长计时。运行、原生审批／回答、pending／unknown 输入、后台收尾或未确认停止均不回收。

回收先持久保存，再移除对应实例和卡片；保留工作、报告、代码、分支、worktree 和原生线程引用。更新检查 execution 身份及原空闲起点，避免旧事件覆盖新执行或新输入与回收交错时误删卡片。若实例先于调度收尾回调移除，回调仍按原 reservation 身份释放名额并继续队列，不能留下无实例的占用，也不能释放后来执行的名额。关闭、回收后的历史仍通过普通 Janus 查询，界面显示当前实例和排队安排，不把所有历史工作当成驻留 Worker。

### 明确继续与原生历史缺失

正常继续使用最近有真实线程引用的 execution，重新验证当前 checkout 并调用原生 `thread/resume`。只有随后投递新的明确输入才开始模型轮次。原生返回超时、认证、provider mismatch、损坏或其他不明确结果时，不换线程、不重试。

只有原生明确返回请求线程的 `-32600 / no rollout found for thread id …`，才进入同一次启动中的重建分支。宿主先核验全部已关联输入和最新正式报告原文的存在性／哈希，再验证当前 lease；材料充分则以同样目录与权限创建新原生线程，交给 Worker 原始来源、当前工作卡和代码事实。缺失关键原文则保留诊断并停止，要求 Janus 澄清，不能编造背景或暗中新建另一个工作。`recovery` 区分原线程恢复和背景重建。

[官方 App Server 协议](https://learn.chatgpt.com/docs/app-server)规定 `thread/resume` 恢复已有线程、`turn/start` 才开始新轮次；同为 `-32600` 的 provider mismatch 有不同语义。缺失线程的精确报文来自本机隔离 Codex 探针，因此匹配有意保守。原生版本改变报文时明确失败并重新核对，不能放宽为“所有恢复错误都新建”。

### 关闭、停止全部与退出

卸载／收起面板只解除订阅。关闭工作保留 closed 状态，取消未派发输入并请求停止；迟到报告或回调不能重开。停止未确认时，关闭工作仍显示问题和停止入口，不能显示已完成清理。明确重开沿用 P4 的新输入和工作版本检查。

普通对话通过 `work_route(stop-all)` 发起停止全部。默认语义范围为当前工作区；只有用户明确全局请求时使用 `all-workspaces`。宿主先持久保存作用范围、目标集合和输入序号，再在调度队列的一次操作中冻结整个集合、撤销 pending／unknown 并向全部目标发出停止。释放第一个名额不会启动集合内其他排队目标，较旧输入不能在停止后重新安排；后来的明确输入仍可继续。已确认收尾且没有待派发输入的 ready 结果不属于待停止执行，保留原回收计时。回执表示已请求，实际停止确认另列。该动作不永久关闭工作，也不停止不属于 SuperAgent 的终端。

真正退出先结束聊天接收，再让 SuperAgent 同时停止拥有的执行与排空记录；写盘或其他队列失败不跳过进程停止。AppShutdown 为此步骤保留 12 秒，整体 15 秒强退上限不变。重启只恢复记录及界面：ready 保留原空闲起点，其他先前活跃实例显示 interrupted，没有可操作的旧控制连接；旧队列和 RPC 不自动重放，必须新的明确输入才能执行。

持久记录未确认停止时，重启仍占执行容量，并阻止重叠环境的执行／Git 管理操作。不会猜测旧 PID、杀死可能已复用 PID 的无关进程，或用应用重开作为退出证明。没有持久停止回执且控制连接已丢失时，当前版本只能显示诊断并保持隔离，不能自动解除占用；后续若要恢复这类环境，应增加能核验进程所有权的专门机制。P6 之前的历史没有此文件，不补造停止证明或历史进程信息。

### 确定性监督

现有监督循环核验 lease、原生控制连接与 MCP 心跳，启动桥接后 20 秒无心跳即报告故障并请求停止。正常原生等待且心跳健康不会被当成失联。停止未确认保留隔离，状态写入失败也请求停止。监督不启动新进程、不重发 unknown、不调用模型巡视，也不自动解除原生决策。

## Alternatives considered

- 仅用内存计时和恢复时清空实例：代码较少，但重启会延长空闲时间并遗失未确认停止。采用最小独立事实文件，代价是多一处串行写入及身份关联。
- 恢复失败一律新建原生线程：可用性表面更高，却把认证／未知执行结果误当历史缺失。采用精确原生错误与原文核验，代价是新版本报文需重新验证。
- 跨重启按旧 PID 自动杀进程或重启 Worker：无法可靠证明进程所有权，也可能重放已有副作用。保守隔离，未来有进程所有权凭据时再评估自动清理。
- 逐个停止并立即排空队列：实现简单，却可能启动正在被“停止全部”的目标。先冻结整个明确集合，再并发请求停止。

## Consequences

P6 的回收、持续工作和重启静止语义已进入现有主进程与聊天界面。容量仍是可配置正整数 N、默认 2；实例数量、历史数量与执行名额分别计算。没有新增恢复向导、全局停止按钮、存储依赖或模型轮次。

本轮分组运行 20 个定向测试文件，去重后 178 项通过，另有 1 项真实桌面 E2E 通过。选择范围与命令保存在忽略目录 `artifacts/superagent-p6/` 的日志及 `verification.json`；稳定结论如下。

| 检查 | 实际证据 |
| --- | --- |
| 生命周期、收尾竞态与调度 | `npx vitest run tests/unit/superagent-lifecycle.test.ts tests/unit/superagent-scheduling.test.ts --maxWorkers=1`：17 + 8 项通过。可控时钟覆盖 30 分钟、查询不延时、新输入竞态、空闲截止时间跨重启、未知停止占用、MCP／控制失联、原文不足、整批停止和迟到收尾回调；使用真实记录／MCP 桥及可控原生／Git 边界。 |
| 原生恢复错误、退出与组件 | `codex-managed-recovery` 6 项、`app-shutdown` 6 项、`superagent-work-ui` 1 项通过。精确缺失线程才重建；退出等待超过普通 4 秒步骤时限；卸载无停止，回收卡片移除，关闭但未确认停止仍保留控制。 |
| 原有记录与聊天边界 | `superagent-context` 10、`superagent-store` 10、`superagent-persistence` 12、`superagent-ipc` 7、`superagent-worker-mcp` 2、`codex-managed-decisions` 3、`llm/chat-turn-guard` 23、`llm/janus-agent-ports` 24 项通过。 |
| 真实 Git 与受控执行回归 | `superagent-workers` 13、`superagent-routing` 4、`superagent-context-environment` 2、`superagent-environments` 24、`superagent-commit` 3 项通过。覆盖 N=4 与第五项排队、未确认停止跨重启阻止真实目录占用、批准失效与提交边界；这些执行场景使用可控 Worker 引擎。 |
| 真实 Codex 与 MXC | 显式设置 `JANUS_SUPERAGENT_CODEX_BINARY` 后，`npx vitest run tests/unit/superagent-native.test.ts tests/unit/superagent-worker-permissions.test.ts --maxWorkers=1`：1 + 2 项通过。真实原生过程完成编辑、长原文读取、回收后原线程续接、隔离配置中已知不存在的线程 ID 重建、停止后台进程，以及 13 类实际 Shell／子进程权限尝试。 |
| 桌面退出与恢复 | 同一二进制条件下，`npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-superagent.spec.ts --workers=1`：1 项通过。真实 Electron、preload／IPC、临时 Git 与 Codex 完成聊天安排、历史查询、实际 AppShutdown 退出、同配置重开不新增模型请求、历史报告保留、明确继续原线程及对话停止全部。历史报告不伪装成新 execution 的完成结果。 |

真实原生与桌面测试使用本机 Windows Codex 0.166.0、隔离配置和 localhost 模型响应，不触碰用户全局配置或其他运行的 JanusX。界面与桌面恢复截图已人工查看。严格未用项类型检查、变更实现定向 ESLint、主题／双语、最终应用构建和差异空白检查通过；Notes 校验 334 篇、0 errors，17 项既有跨仓库链接诊断未改变，44 条固定 AC 与实施前逐行一致。

完整应用 `npm run verify`、跨平台进程恢复、真实断电和生产供应商任意语义判断未运行／未验收；localhost 响应夹具只证明产品通路及协议边界。P7 完整界面和 P8 联合验收仍待实施。本轮为 Main Agent 实施和自查，没有独立子 Agent 审查、提交或发布。
