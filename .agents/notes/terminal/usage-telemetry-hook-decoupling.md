---
{
  "schema": "harness-note/2",
  "id": "50551227-aa00-4022-8b2e-53e222045bcb",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-10-14",
  "class": "architecture",
  "tags": ["telemetry", "usage-stats", "terminal", "session-files", "hooks"],
  "updated": "2026-11-04T16:41:08.732Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 用量统计链路与 hook 解耦，改为纯会话扫描

## Problem

改动前，运行数值虽然全部来自会话文件扫描，但**终端↔会话归属只有 hook 一个来源**：`bindSession` 只在 hook 载荷带 `sessionId` 时调用（`src/main/ipc/terminal-handlers.ts` 的 `refreshRuntimeTelemetry`），coordinator 无绑定时每 10 秒轮询只回落 bootstrap 声明模型。hook 成为统计链路的单点。

2026-10-14 用户实测 dev 版时 Codex 上下文与用量全部缺失而 Claude 正常，定位根因不是 rollout 解析不适配新格式，而是 **Codex 在 Windows 上把 hook stdin 写成 UTF-16LE 带 BOM**，hook 脚本按 UTF-8 读出乱码，`ConvertFrom-Json` 失败后 `session_id` 静默丢失：hook 触发成功（诊断文件持续 posted/ok）、终端从未绑定、统计全空。dev 应用用量账本历史上从未有过 codex 记录，佐证该断点自单源化重构依赖 hook 传 sessionId 后一直存在。

结构性脆弱不止这一处：各引擎 hook 契约独立演进（stdin 编码、事件名、负载字段），JanusX 需逐引擎适配；Codex 的 `hooks.state.trusted_hash` 在命令变化时要求重新信任，实测改一个字符即弹 "Hooks need review" 且 hook 直接不执行——静默失败、无账本侧感知。用户两个既定场景进一步放大了代价：**同 workspace 并发跑同一个 CLI 是常用操作**（归属不能错），**全局统计必须覆盖从未在 JanusX 打开过的历史会话**（hook 只覆盖打开过的终端）。参考实现 cc-switch 不用 hook，直接扫描各工具本地会话日志完成用量统计。

## Decision

采用用户选定的选项 A：**统计链路完全移除 hook**，用量账本与上下文数值读取原生会话存储；终端归属使用独立证据，Hook 只保留与统计无关的回合状态／通知职责。

2026-11-05 并发修复将“会话身份”和“数值采集”分开：数值与账本仍只读取原生会话存储；JanusX 自有 Codex 双视图连接通过原生 `thread/start` / `thread/resume` 成功响应确认当前 thread ID，作为主进程 `native` 归属证据，对 renderer 投影为 `exact`。默认本地 Codex 即使显示终端视图也使用该连接。身份无需根据 cwd、分支或时间猜测，也不来自 Hook。启动回调早于终端登记时，登记完成后读取适配器当前身份补接；后续新建、恢复由同一回调更新。

受管 Codex 等待自身连接确认，不参与日志猜测。绑定前检查终端仍注册且属于自有 Codex 连接；退出后的迟到回调被拒绝。准确身份可以纠正已有相关性绑定，但不能抢占另一个准确连接；同一原生会话发生准确身份冲突时保留未知。换绑使缓存与旧异步读取失效，新会话文件尚未落盘时先发布空的新身份，清除旧上下文，再由周期读取补齐。`native` 持久记录不能在新进程中自行恢复，必须经新连接确认；同进程 renderer 重载沿用主进程状态。

未受管终端保留保守相关性兜底：先排除其他终端已经拥有的会话，再检查唯一候选和跨终端竞争。Codex 从完整头记录取身份，从完整尾记录取最新原生事件时间，避免 Windows 打开文件时 mtime 长期不变导致永远错过归属；缓存键同时包含文件身份、大小和时间，内容增长会重读。读取有界（头最多 1 MiB、尾 256 KiB、缓存最多 4096 项），半写尾行不提供身份活动证据，子代理记录不参与终端归属。缺少可验证身份、真实并发歧义或文件损坏时继续未知，绝不取“同目录最新日志”冒充当前会话。准确绑定的历史读取同时覆盖 sessions 与 archived_sessions。

- **L1 用量账本纯扫描**：启动全量扫描 + 定时增量（持久字节游标），账本键 `(engine, namespace, sessionId)` 本就与终端无关，扫描覆盖所有会话文件，包括从未打开过的。hook 未装、失效或引擎升级改契约都不影响账本。
- **Codex 升级为事件模式**：本机实测一个 13 回合会话，13 个 `token_count` 事件的 `last_token_usage` 之和精确等于最终 `total_token_usage`，且事件带稳定 `ordinal` 可作身份——每个事件的 `last_token_usage` 即该轮消耗，可按事件时间逐轮归桶，历史可完整重放。Claude/Pi 本就支持事件导入；OpenCode 的 sqlite 累计值无法还原区间，只能建基线并标覆盖起点。
- **L2 身份优先、相关性兜底**：受管 Codex 的独立原生连接确认当前线程；旧终端使用原生会话活动时间、PTY 活跃窗口和 cwd 相关性。创建／恢复不假定串行；多个候选或多终端竞争保持未知，不输出 estimated 数字冒充归属。原先仅依赖文件 mtime 和“人类启动足够慢”的假设不足以覆盖同目录多开。
- **L3 每终端私有 home 暂缓**：受管 Codex 已有准确原生身份，不需要分裂 home；私有 home 仍有 Hook 信任、auth 复制和 resume 列表分裂的代价。其他未受管引擎若无法提供原生身份且歧义率不可接受，再评估独立存储隔离。
- **hook 保留范围**：回合状态/通知（running/等审批/降级）、turn 记录、知识沉淀等与统计无关的职责原样不动。
- **代码触点**：终端启动接入受管 Codex 的身份回调，coordinator 管理独占、换绑及生命周期；session-attribution 只负责旧终端相关性兜底。history 没有绑定时只提供配置声明，不按 cwd 猜数；10 秒上下文轮询与全语料账本扫描独立运行。

## Alternatives considered

- hook 绑定保留为归属的增强信号（选项 B）：hook 健康时归属更即时精确。否决：用户选定 A；保留双路增加心智与维护面，收益仅限边缘场景的即时性。
- 每终端私有 home 一步到位（选项 C）：100% 精确归属，并发零歧义。否决：与 hook 信任机制冲突（每 home 单独信任或静默 bypass）、resume 列表分裂、auth 复制成本；留作 L3 条件触发。
- 进程树/文件句柄关联：pty → CLI 进程 → 其正在写的会话文件，精确。否决：Windows 拿不到子进程句柄表（需 native addon），且需先验证 CLI 是否常驻持有句柄；跨平台维护重。
- 维持现状：否决——单点故障已实证（codex UTF-16 事件），且不满足"覆盖未打开历史会话"的既定需求。

## Consequences

- hook 故障/未装/引擎升级改契约不影响统计归属和账本，只影响非统计生命周期消费者；终端统计的故障形态从"全空"变为"降级并标注"。
- 全局统计覆盖全部历史：Claude/Codex/Pi 和新导入的 OpenCode 会话按事件时间回放；已有累计基线会话保留原覆盖起点，不重放其历史。
- 读放大需要基础设施：持久字节游标、64MB 单文件上限、启动扫描与低峰增量的调度；当前账本无持久游标，属新增件。
- 受管 Codex 同 workspace 并发归属不依赖启动先后；未受管终端只有唯一可验证候选才绑定，真实歧义保持未知。
- Codex 切事件模式后，旧账本中的累计基线如何处理尚未决定，见待定项。

## 待定（已由实现解决）

Codex 事件模式的迁移政策：**一次性重放全历史**（数字最全，但旧会话消耗按事件时间回填到过去日期，趋势图变化）还是**仅从切换日起算**、历史会话可见但不聚合。影响 L1 实施方案，需用户拍板。

2026-10-14 实施时按模式锁解决，无需用户另行拍板：**会话的记账模式在首次入账时锁定，之后永不切换**。从未入账的会话（含全部未打开历史、关闭终端的后续增长）走事件模式完整重放；已被终端路径建立累计基线的会话维持累计差分。ledger 在 `record()` 内执行该锁（旧行按形状推断），因此两条路径并存是幂等的而非双记。代价：旧基线会话不回填历史（其区间消耗只有采样差分），趋势图上新旧会话精度不同——界面已有覆盖起点与 issue 标注承接这一差异。

## 实施状态

- **L1 已落地**（2026-10-14）：`corpus-scan.ts` 全语料扫描（Claude projects、Codex sessions+archived_sessions、Pi 全局 sessionDir；OpenCode 为 sqlite 单库暂未枚举）；codex 事件模式 `collectCodexEvents`（身份=ordinal、时间=事件时间戳）；`readJsonlLinesWithCursor` 提供完整字节回游标，未变化文件只 stat 不读；coordinator 启动 20 秒后首扫、之后 5 分钟周期，零终端时仍运行；ledger 增模式锁与 `sessionState` 查询。
- **L2 已落地并完善**：受管 Codex 使用上述原生连接身份，快照标 exact；其他终端按工作区及活动时间做相关性兜底，标 correlated。PTY 活跃窗口为 15s，输入采集按 1 秒节流；唯一候选才绑定，多个终端竞争同一候选时全部保持未知。准确身份回调与独立轮询均不依赖 Hook。
- **L3 未实施**：每终端私有 home 暂缓，重启条件不变。

2026-10-17 补齐 OpenCode：L1 全语料扫描读取 v1/v2 SQLite 消息用量并沿用原生身份去重，L2 使用同库工作区与会话活动时间关联 pty，唯一候选才绑定；旧累计模式不迁移。费用从既有账本与模型目录计算，不引入另一路采集。当前行为与 545 会话真实只读核验见[会话源单源化](./requirements/usage-telemetry-single-source.md)的 OpenCode 全历史与费用估算章节。

## Verification

2026-11-05 本机只读诊断确认 Codex rollout 的 mtime 停在 21:18，而文件已有次日 00:18 的 token 事件；单候选、同 cwd 双候选、陈旧 mtime 三种隔离复现分别为成功、未绑定、未绑定。修复的真实 CLI 验证由 `tests/unit/codex-context-cli.test.ts` 启动两个独立后台与同目录 TUI，使用隔离 CODEX_HOME、本地 HTTP 模型、无 Hook；两者并发创建身份和请求后各自读取 9 token，第二个追加请求不改变第一个累计量，第二个新建会话后清除旧量并读取新会话。首次尝试遇到 Codex 新 home 的 SQLite 并发初始化失败；fixture 改为先顺序初始化两个后台，再并发启动 TUI 和创建线程，覆盖已有用户 home 的实际并发场景。证据为 `artifacts/codex-context-native.log` 与 `artifacts/codex-context/native-clients.json`。

定向测试覆盖原生 start/resume 响应与后台通知隔离、同目录多实例、占用候选排除、未知态保留、持久身份重新确认、迟到回调与换绑、无文件新会话、归档历史、mtime 不变的增长、长头记录、半写尾行、复制旧日志和子代理排除。Hook IPC 回归明确断言既不调用相关性绑定也不调用原生绑定；数值单源和全语料扫描维持独立。

最终定向验证九文件 125 项通过（含真实双 Codex 用例），日志为 `artifacts/codex-context-final-tests.log`。renderer 同步保存 exact/correlated 身份，换会话时清除旧上下文、累计量、模型与压缩次数，避免空新会话沿用旧数字；恢复后的 active rollout 优先于遗留 archived 副本。本机真实日志的有界读取也取得了新事件时间，未改动用户日志或运行实例，证据为 `artifacts/codex-context/live-log-identity.json`。严格 unused 类型检查、定向 ESLint、应用构建与 Notes 校验通过；真实 CLI 使用本地模型，不宣称真实云端计费或其他 CLI 的并发验收。

### 当前实现与纯后台边界的差距

2026-10-29 P3 已完成残留清理：onResolvedPayload 不再调用 refreshRuntimeTelemetry、bindSession、getSnapshot 或 750ms 延迟刷新；规范化事件也不触发遥测。旧持久 Hook 来源及缺少 source 的绑定不加载为独立证据，等待 PTY／原生会话相关性归属；同一候选被多个终端认领时全部保持未知。状态、历史继续接收 sessionId，不回灌统计。原生全语料扫描、游标、记账模式锁和独立上下文轮询保留。

定向回归验证 Hook 到达零额外遥测调用／定时任务、旧绑定拒绝、双终端歧义及无 Hook 的历史扫描、归属和记账；P3 实现与命令见[单次启动隔离](terminal-hook-launch-isolation.md#verification)。本节标题保留原锚点，所述差距已清除。

以下为最初决策时的依据实证（2026-10-14）；后台能力的落地与残留耦合分别以上文实施状态及当前差距为准：

- Codex hook stdin 编码实测：pty 起真实 TUI 捕获 payload，首字节 `FF FE`（UTF-16LE BOM）；同载荷按 UTF-8 解析失败。修复（BOM 探测解码）后，生成的脚本与部署的脚本均能正确解出 `sessionId`，用户便携版应用中的 codex 终端于 15:13:21 成功绑定（修复部署后首次 hook）。
- Codex 事件模式等价性：本机会话 `rollout-2026-10-14T14-55-54-01a13932-*.jsonl`，13 个 `token_count` 事件 `last_token_usage.total_tokens` 之和 = 最终 `total_token_usage` = 774,721。
- 信任机制边界：`trusted_hash` 只覆盖 hooks.json 命令、不覆盖脚本内容（改脚本无需重新信任）；改命令触发 TUI "Hooks need review" 且 hook 不执行；`codex doctor` 对失配钩子不报警告（`startup warning hooks 0`）。
- `lastDataAt` 字段在 `terminal-handlers.ts` 已声明但从未更新，归属信号接线成本一行。

L1 落地验证（2026-10-14）：`tests/unit/runtime-telemetry-corpus-scan.test.ts` 8 项通过——codex 未打开会话按事件时间导入且重扫幂等（回游标命中）、已有累计基线只记后续差分、事件导入后终端路径的累计观测被模式锁忽略（不双记）、Claude 响应身份导入、archived_sessions 覆盖与非 rollout 文件忽略、Pi 根命名空间导入、fork 线程继承段留在父文件、跨会话 ordinal 不碰撞。受影响单测（history/coordinator/accounting/usage-ledger/usage-ledger-client/usage-stats/corpus-scan 八文件 94 项）全过；`typecheck:strict-unused` 与遥测目录定向 ESLint 通过。全量单测 3134+ 通过，唯一失败为既有的 `user-recall-m2` 时间炸弹。

**真实语料 dry-run**（本机 1164 个会话文件、1.7GB，临时账本，未碰应用数据）：首扫 1159 入账、81 秒；立即复扫 23 秒、1134 个文件命中回游标跳过。**守恒校验 591/591**：每个 codex 会话账本记录的消耗之和精确等于 rollout 文件最终累计值，零误差。issue 分布：24 个 `counter-regressed`（已抽验属实——codex 压缩后计数器重置为上下文窗口值，按契约暂停），无 `event-changed`/`invalid-event`。5 个文件（0.4%）计 unavailable， characterize 后无空文件/超限/损坏行，应为无 usage 内容的转录。

dry-run 抓出并修复的三个真实数据缺陷（fixture 测不到）：① `last_token_usage` 求和不守恒——300 个抽样会话里 86 个的 `sum(last)` 不等于最终累计值（重复发射与分量清零事件），改用累计计数器差分（伸缩和保证守恒）；② 事件身份只用 ordinal，跨会话碰撞导致 683 个会话被 `event-changed` 暂停，改为 `${sessionId}#${ordinal}`；③ 子代理/fork rollout 复制父线程事件段（`subagent_history_start_ordinal` 之前的 ordinal），直接重放会把父线程最多 4500 万 token 双记，改为跳过继承段并以继承段末尾累计值为基线。

L2 落地验证（2026-10-14）：`tests/unit/session-attribution.test.ts` 6 项通过（Claude/Codex/Pi 三引擎的 cwd 过滤与命名空间、archived_sessions 覆盖、活跃窗外与终端启动前的写入被拒、双候选歧义时保持未绑定、反斜杠盘符匹配、无会话文件的引擎跳过）；`tests/unit/runtime-telemetry-attribution.test.ts` 5 项通过（相关绑定驱动 correlated 快照、hook 绑定不被重归属、hook 升级 correlated、同一会话跨终端独占、无 pty 活跃度不绑定）。受影响遥测单测 61 项全过；`typecheck:strict-unused` 与定向 ESLint 通过。全量单测 `--maxWorkers=2` 下 3146 通过，仅剩既有的 `user-recall-m2` 时间炸弹与 `workflowx-v2` 并发 flake；默认高并发下另有 harness 锁竞争 flake（`pi-hook-extension`/`prepare-package` 隔离运行全过）。尚未在 live Electron 中实测归属（需要真实双终端同 workspace 场景）。
