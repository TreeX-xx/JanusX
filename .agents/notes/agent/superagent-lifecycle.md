---
{
  "schema": "harness-note/2",
  "id": "a591e250-1719-48a5-8750-663fdb00681e",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-14T02:32:19Z",
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

`lifecycle.json` v1 按工作保存最近 execution／instance、工作区与目录、阶段、停止确认、空闲起点和回收时间。Windows 受管 Codex 在原生 initialize 前保存可选 processTree（PID 与原生创建时间），停止时再保存 hostDrained（宿主写入队列已排空）证据；旧记录缺省保留未知。原始输入、正式报告、投递与原生线程引用仍由既有核心记录保存，生命周期文件不复制正文。新 execution 在启动进程前落盘；停止确认先落盘，再释放环境 lease。损坏、未来版本或身份不一致明确阻止执行并保留原文件。新增字段不能交给不认识它们的旧版严格解析器。

ready 必须来自当前 Worker 的正式报告，并且进程树、宿主提交和已开始的写入均已收尾。此时开始实例空闲计时，默认阈值为 30 分钟；执行容量已按 P4 规则释放。新执行输入立即退出计时，包括暂时排队的补充；下一次确认 ready 才重新计时。卡片、目录和历史查询不延长计时。运行、原生审批／回答、pending／unknown 输入、后台收尾或未确认停止均不回收。

回收先持久保存，再移除对应实例和卡片；保留工作、报告、代码、分支、worktree 和原生线程引用。更新检查 execution 身份及原空闲起点，避免旧事件覆盖新执行或新输入与回收交错时误删卡片。若实例先于调度收尾回调移除，回调仍按原 reservation 身份释放名额并继续队列，不能留下无实例的占用，也不能释放后来执行的名额。关闭、回收后的历史仍通过普通 Janus 查询，界面显示当前实例和排队安排，不把所有历史工作当成驻留 Worker。

Claude Code 与 Codex 共用上述回收条件。backend 随 execution 和 lifecycle 持久化，旧记录按 Codex 解释；改变默认类型不迁移已有工作。Claude 续接携带新执行配置时允许原生明确证明的历史复制，记录 recovery=forked 和新的原生会话 ID，保留原工作。新增可选字段和枚举需使用本次或更新引擎包，旧严格解析器不能读取。

### 可配置空闲回收时间

桌面 Worker 默认设置支持 1–10080 的整数分钟，默认 30 分钟。受主窗口授权保护的 IPC 读取并更新 worker-idle-minutes.json，独立于模型与推理强度设置，缺少文件时兼容默认值。非法值拒绝保存，损坏文件保留原文并报错；保存失败保留输入供重试。

引擎 SuperAgentWorkers 接收公共 idleTimeoutMs 策略读取端口，每次 sweep 获取最新阈值，缺省使用 WORKER_IDLE_MS；桌面从持久设置提供毫秒值。保存后下一次检查生效，已有 idleSince 不重置，缩短阈值可回收已达到新阈值的实例，延长阈值继续等待；应用重启仍使用保存的设置和空闲起点。运行、待审批、未确认停止及新输入竞态保护保持不变。不修改引擎私有字段、时间源或 node_modules。

### 明确继续与原生历史缺失

正常继续使用最近有真实线程引用的 execution，重新验证当前 checkout 并调用原生 `thread/resume`。只有随后投递新的明确输入才开始模型轮次。原生返回超时、认证、provider mismatch、损坏或其他不明确结果时，不换线程、不重试。

只有原生明确返回请求线程的 `-32600 / no rollout found for thread id …`，才进入同一次启动中的重建分支。宿主先核验全部已关联输入和最新正式报告原文的存在性／哈希，再验证当前 lease；材料充分则以同样目录与权限创建新原生线程，交给 Worker 原始来源、当前工作卡和代码事实。缺失关键原文则保留诊断并停止，要求 Janus 澄清，不能编造背景或暗中新建另一个工作。`recovery` 区分原线程恢复和背景重建。

[官方 App Server 协议](https://learn.chatgpt.com/docs/app-server)规定 `thread/resume` 恢复已有线程、`turn/start` 才开始新轮次；同为 `-32600` 的 provider mismatch 有不同语义。缺失线程的精确报文来自本机隔离 Codex 探针，因此匹配有意保守。原生版本改变报文时明确失败并重新核对，不能放宽为“所有恢复错误都新建”。

### 关闭、停止全部与退出

卸载／收起面板只解除订阅。关闭工作保留 closed 状态，取消未派发输入并请求停止；迟到报告或回调不能重开。停止未确认时，关闭工作仍显示问题和停止入口，不能显示已完成清理。原生停止失败或恢复后的 interrupted 保留真实阶段和可用的停止重试，不能因为工作已有 closedAt 就永久显示 stopping 并禁用按钮。明确重开沿用 P4 的新输入和工作版本检查。

普通对话通过 `work_route(stop-all)` 发起停止全部。默认语义范围为当前工作区；只有用户明确全局请求时使用 `all-workspaces`。宿主先持久保存作用范围、目标集合和输入序号，再在调度队列的一次操作中冻结整个集合、撤销 pending／unknown 并向全部目标发出停止。释放第一个名额不会启动集合内其他排队目标，较旧输入不能在停止后重新安排；后来的明确输入仍可继续。已确认收尾且没有待派发输入的 ready 结果不属于待停止执行，保留原回收计时。回执表示已请求，实际停止确认另列。该动作不永久关闭工作，也不停止不属于 SuperAgent 的终端。

真正退出先结束聊天接收，再让 SuperAgent 同时停止拥有的执行与排空记录；写盘或其他队列失败不跳过进程停止。AppShutdown 为此步骤保留 12 秒，整体 15 秒强退上限不变。重启只恢复记录及界面：ready 保留原空闲起点，其他先前活跃实例显示 interrupted，没有可操作的旧控制连接；旧队列和 RPC 不自动重放，必须新的明确输入才能执行。

持久记录未确认停止时，重启仍占执行容量，并阻止重叠环境的执行／Git 管理操作。恢复时保留原始停止错误；用户明确点击停止／关闭后，存在 processTree 与 hostDrained 的 Windows 记录可通过创建时间校验后的原生句柄终止、核验旧树，确认落盘后释放容量，不恢复模型或重放输入。PID 已复用时不终止新拥有者；查询失败或子进程仍活跃保持隔离。启动和定时巡视不自动执行此恢复。

没有进程身份或宿主排空证据的旧记录，只能通过系统启动时间晚于该记录 updatedAt 证明旧执行已跨 Windows 重启消失；应用重开、等待时长、单个旧 PID 不存在都不足以释放。若原生核验不可用，已验证的 Windows 重启同样可作为恢复证据。本机故障记录只有旧 taskkill 诊断，没有创建时间；排查时 PID 48852 已不存在，但 Windows 启动早于失败记录，因此未改写用户 lifecycle.json 或解除占用。更新应用并重启 Windows 后，明确重试停止／关闭可恢复。非 Windows 平台维持原有保守隔离。

### 确定性监督

现有监督循环核验 lease、原生控制连接与 MCP 心跳，启动桥接后 20 秒无心跳即报告故障并请求停止。正常原生等待且心跳健康不会被当成失联。停止未确认保留隔离，状态写入失败也请求停止。监督不启动新进程、不重发 unknown、不调用模型巡视，也不自动解除原生决策。

### 2026-11-13：退出早于进程树抓取的故障定位

安装版 D:/janusX/JanusX.exe 的运行数据位于用户配置 janusx/superagent。执行 f59adea7-df1a-4540-b847-8fbc9047fea3 属于工作 82c8dc2a-889f-4618-aed7-3f5c8989a253，目录为 JanusX-superagent-automation。北京时间 22:08:38 收到 ready 报告，22:08:45 原生 turn/completed 为 completed 且 error=null；22:10:19 关闭写入 closedAt。停止与关闭动作账本均为 applied，但 lifecycle 最终为 phase=failed、stopConfirmed=false、hostDrained=true，缺少 processTree。原生日志已经截断，保留尾部没有最初的进程退出码，不能据此判定 Codex 崩溃、正常退出或被其他进程终止。

对安装包与本 checkout 的引擎 dist 逐字节比较，codex-managed-transport、workers、scheduler 和 service 四文件一致，消费制品为 engine.6312b33e4d953071。故障在引擎边界：CodexManagedTransport.start 未抓取身份；stop 才调用 captureWindowsProcessTree。根进程若已退出且没有 processTree，stop 在抓取前直接抛出 Codex exited before its process tree could be captured，因此显式重试仍走同一失败分支。stopEntry 保留占用符合隔离要求，但 fail 中的最初错误会被停止错误覆盖；native-logs 仅保存原生协议事件，没有独立的退出诊断凭据。

关闭请求确已到达后端。service 先保存工作关闭，scheduler.cancelMany 异步请求 workers.stopWork，因此 applied 表示控制已请求；停止失败后保留占用，界面因 stopConfirmed=false 继续展示卡片。该表现不能解释为按钮事件丢失，也不能将 applied 当作进程已终止。恢复后的记录没有 processTree，只能走已有 Windows 重启证明分支；本次查询的系统启动时间为 19:22:26，早于故障，应用重开或重复停止无法提供缺失证明。本次未改写运行数据、释放占用或结束用户进程。

Main 在诊断阶段使用已安装的同字节引擎执行隔离 Node 子进程探针：模拟 initialize/initialized 后主动以 7 退出，原始回调收到 Codex exited (7)，随后两次 stop 都返回上述异常，onProcessTree 调用次数为 0。该机器证据复现生命周期缺口，不证明真实 Worker 的退出原因；该阶段未修改引擎或执行修复验收。随后按下面的修复记录提前取得并持久化进程归属，处理启动、抓取与停止竞态，并分别保留原始退出与清理失败诊断；仅在启动时保存裸 PID、删除隔离判断或手改 stopConfirmed 均不足以解决问题。

### 启动身份与清理错误的修复

启动进程树抓取与持久化先于 initialize；停止等待同一承诺，避免根进程退出时重复抓取，或关闭后仍继续启动原生协议。抓取与保存期间的异常退出、取消和保存失败均有回归；保存失败保留内存中的创建时间身份供后续停止重试。原生根进程意外退出时，可沿已有身份发现启动后创建的残留子进程，按原有创建时间核验终止，确认后释放容量。身份未取得时不会猜测退出成功，历史故障记录也不会因升级自动解除占用。

Codex 原始进程错误以 janus/transportError 写入原生日志，不依赖已绑定线程。Worker 保留首次执行错误，清理失败另列，反复停止不重复堆叠原始错误；明确重试确认成功后清除过时的占用错误。关闭工作仍先保存 closedAt 并异步请求停止，实际确认状态通过 stopConfirmed 表示。

2026-11-13 Main 验证：引擎 codex-managed-transport、codex-managed-diagnostics、codex-managed-process、windows-process-tree、native-managed-requests 五文件 33 项通过，含真实 Windows 根进程退出后终止后来创建的 detached 子进程。JanusX 的 lifecycle、scheduling、managed-recovery、managed-decisions、engine-packages、workers 六文件 72 项通过，新增关闭失败后显式停止重试、诊断持久化、名额释放与过时错误清理回归。真实 Codex、Windows MXC 与构建后的 Electron MCP 集成另通过 1 项，覆盖编辑、长原文召回、ready 收尾、续接、缺失历史重建及后台停止；模型响应使用 localhost 协议夹具，不代表云模型语义验收。

消费端固定六包更新为 0ffd216a55f9f844，package.json、锁文件、归档和安装文件哈希一致；与上个制品相比，dist 的变化限于传输、会话和 Worker 三个实现及其声明元数据。引擎编译、消费端严格未使用类型检查、build:check 和包边界检查通过。JanusX Notes 为 346 篇、0 errors、17 条外链诊断；引擎 Notes 为 74 篇、0 errors、16 条读取侧诊断。证据摘要与原生结果保存在 artifacts/worker-process-ownership。构建在 artifacts/build-check，没有替换运行中的安装版，也未修改用户账本或直接解除历史隔离；未运行完整 verify 或制作新安装包。

### 2026-11-14：停止确认后调度诊断残留的定位与修复

诊断时只读核对同一工作 82c8dc2a-889f-4618-aed7-3f5c8989a253：lifecycle.json 已在北京时间 09:40:59 保存 phase=stopped、stopConfirmed=true、hostDrained=true，且 diagnostic 缺省；scheduling.json 对应 execution 仍为 status=stopped，保留旧的 Codex exited before its process tree could be captured; environment remains occupied。因此当前卡片的占用错误已过时，不能据此认定该历史执行仍占环境。Windows 本次启动时间为 08:57:24，旧记录已走过停止恢复。安装版 D:/janusX/resources/app.asar 消费 engine.87d7e30ed28ec2d9，其 transport、workers、scheduler 三文件与诊断时的 node_modules 逐字节一致，已包含提前抓取进程身份的修复；当前问题不是此前进程身份修复未安装。

新缺口在引擎 SuperAgentScheduler.cancelMany：先将 workId 加入 cancelled，成功回调只释放名额并将 stopping 改为 stopped，没有同步或清除 diagnostic；observe 又因 cancelled 或 closed 状态跳过原生诊断同步。Worker 的恢复停止已清除自身及 lifecycle 的诊断，调度副本却一直保留。SuperAgentWork.workGroup 按状态与实际占用把它放入 completed，而 WorkCard 的 diagnostic 优先级为本地错误、schedule.diagnostic、worker.diagnostic、日志，因此仍展示旧错误；isSettled 也被旧调度诊断阻止。既有停止恢复回归检查 Worker 诊断与 occupied=0，未检查此控制路径中调度诊断的同步。

Main 用诊断时消费引擎运行隔离 Node 探针，内存桩仅替代 Worker／存储边界，真实执行 scheduler 的取消、观察和成功回调。stop、close 两种情况均复现 Worker stopConfirmed=true、诊断为空、occupied=0，但调度诊断保留旧报错。随后用户授权修复；探针现改为断言两种路径均清除旧诊断，重跑命令为 node artifacts/worker-process-ownership/stale-scheduling-diagnostic-probe.mjs。

修复在共享引擎 scheduler.ts：停止成功及原生状态观察都同步同一 workspace／execution 已确认停止的 stopped／closed 行诊断，保留 Worker 的原始执行失败；初始化根据同样的确认事实修正持久化历史副本，不启动模型、重发输入或重新核验进程。缺失快照、execution 不符、停止未确认及非终止调度状态保持原状。异步成功和失败回执都核对 inputId、queueVersion、executionId、取消状态及 reservation，不能覆盖新安排或新执行的诊断。取消身份在原有写盘事务内取得；写盘失败仍向全部目标请求原生停止。

固定六包更新为 42cab7549f5deefd，以此前已安装包为基底，仅覆盖 scheduler 的编译实现和声明元数据；package.json、锁文件、归档与安装目录通过 npm run prepackage 校验。Main 执行 npx vitest run --project=unit tests/unit/superagent-scheduling.test.ts tests/unit/superagent-lifecycle.test.ts tests/unit/engine-packages.test.ts --maxWorkers=1，3 文件 45 项通过；新增 6 项覆盖停止／关闭重试、持久诊断恢复的证据边界、迟到成功／失败回执及控制保存失败时仍请求全部原生停止，另加强原始失败保留断言。历史恢复测试先关闭旧调度器再写入故障样本，避免测试自身的收尾回调覆盖夹具。另执行同命令的 --project=integration，指定 superagent-routing.test.ts、superagent-workers.test.ts，2 文件 31 项通过，使用真实临时 Git 仓库和受控原生协议夹具；本轮合计 76 项回归。

引擎编译、桌面严格未使用类型检查、npm run build:check 和包边界检查通过，构建输出为 artifacts/build-check。桌面 Notes 为 346 篇、0 errors、17 条外链诊断；引擎 74 篇仍有此前已记录的两处错误：omp-tooling-design.md 缺少 Intent、历史 codex-cli-tool-surface-survey 的相对链接失效，另有两条外链诊断。本次修改的两篇 Note 未新增错误。测试文件按仓库配置被 ESLint 排除，不将该命令算作代码 lint 通过。完整命令、结果及日志归 artifacts/worker-stop-diagnostics/verification.json。本轮未执行完整 verify 或云模型端到端测试；不手改用户账本、不替换运行中的安装版，新构建启动后才修正历史调度副本。

## Alternatives considered

- 仅用内存计时和恢复时清空实例：代码较少，但重启会延长空闲时间并遗失未确认停止。采用最小独立事实文件，代价是多一处串行写入及身份关联。
- 恢复失败一律新建原生线程：可用性表面更高，却把认证／未知执行结果误当历史缺失。采用精确原生错误与原文核验，代价是新版本报文需重新验证。
- 跨重启按裸 PID 自动杀进程或重启 Worker：无法可靠证明进程所有权，也可能重放已有副作用。采用明确停止时的创建时间核验与宿主排空凭据；旧记录保守隔离至已验证的 Windows 重启，不增加自动清理。
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

2026-11-12 可配置回收验证：固定引擎制品 ddf7765c5034015c 已接入消费端。lifecycle、worker-settings、IPC 和 artifact 四文件共 41 项通过；Worker 默认设置浏览器用例 1 项通过，覆盖可编辑时间、非法值、保存失败重试、恢复默认及双语。严格类型检查、定向 ESLint、中英文键检查、六包安装字节核验和 build:check 通过；Notes 为 0 错误、17 条既有外链诊断。扩大 Worker 浏览器回归为 29 项通过、1 项报告弹窗关闭后焦点恢复断言失败，单独复跑仍失败；该报告组件未在本次修改。未替换运行中的安装版。
