---
{
  "schema": "harness-note/2",
  "id": "50551227-aa00-4022-8b2e-53e222045bcb",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-10-14",
  "class": "architecture",
  "tags": ["telemetry", "usage-stats", "terminal", "session-files", "hooks"],
  "updated": "2026-10-29T11:24:13.898Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 用量统计链路与 hook 解耦，改为纯会话扫描

## Problem

改动前，运行数值虽然全部来自会话文件扫描，但**终端↔会话归属只有 hook 一个来源**：`bindSession` 只在 hook 载荷带 `sessionId` 时调用（`src/main/ipc/terminal-handlers.ts` 的 `refreshRuntimeTelemetry`），coordinator 无绑定时每 10 秒轮询只回落 bootstrap 声明模型。hook 成为统计链路的单点。

2026-10-14 用户实测 dev 版时 Codex 上下文与用量全部缺失而 Claude 正常，定位根因不是 rollout 解析不适配新格式，而是 **Codex 在 Windows 上把 hook stdin 写成 UTF-16LE 带 BOM**，hook 脚本按 UTF-8 读出乱码，`ConvertFrom-Json` 失败后 `session_id` 静默丢失：hook 触发成功（诊断文件持续 posted/ok）、终端从未绑定、统计全空。dev 应用用量账本历史上从未有过 codex 记录，佐证该断点自单源化重构依赖 hook 传 sessionId 后一直存在。

结构性脆弱不止这一处：各引擎 hook 契约独立演进（stdin 编码、事件名、负载字段），JanusX 需逐引擎适配；Codex 的 `hooks.state.trusted_hash` 在命令变化时要求重新信任，实测改一个字符即弹 "Hooks need review" 且 hook 直接不执行——静默失败、无账本侧感知。用户两个既定场景进一步放大了代价：**同 workspace 并发跑同一个 CLI 是常用操作**（归属不能错），**全局统计必须覆盖从未在 JanusX 打开过的历史会话**（hook 只覆盖打开过的终端）。参考实现 cc-switch 不用 hook，直接扫描各工具本地会话日志完成用量统计。

## Decision

采用用户选定的选项 A：**统计链路完全移除 hook**，用量账本与终端归属都改为会话文件扫描，hook 只保留与统计无关的回合状态/通知职责。

- **L1 用量账本纯扫描**：启动全量扫描 + 定时增量（持久字节游标），账本键 `(engine, namespace, sessionId)` 本就与终端无关，扫描覆盖所有会话文件，包括从未打开过的。hook 未装、失效或引擎升级改契约都不影响账本。
- **Codex 升级为事件模式**：本机实测一个 13 回合会话，13 个 `token_count` 事件的 `last_token_usage` 之和精确等于最终 `total_token_usage`，且事件带稳定 `ordinal` 可作身份——每个事件的 `last_token_usage` 即该轮消耗，可按事件时间逐轮归桶，历史可完整重放。Claude/Pi 本就支持事件导入；OpenCode 的 sqlite 累计值无法还原区间，只能建基线并标覆盖起点。
- **L2 归属改为会话"诞生/被激活"时刻定性**：歧义来自回合级并发（两个终端可能同时有后台 turn），但会话创建/resume 是用户驱动的单一事件。会话文件首次出现（或旧文件 mtime 跳变=被 resume）时，取该窗口内 pty 活跃的终端归属，定下终身有效（sessionId 在文件内稳定，一个会话只属于创建它的 TUI 进程）。信号：pty 活跃时间戳（`terminal-handlers.ts` 的 `lastDataAt` 已声明未接线，启用即得）× 文件首现/mtime 跳变 × cwd（Claude 按 project 目录键、Codex 在 `session_meta.cwd`、OpenCode 在 DB 行、Pi 在 header，均可精确恢复）。脚本并发等非人类速度场景歧义时标 `estimated` 并在 UI 明示。
- **L3 每终端私有 home 暂缓**：唯一 100% 精确的方案，但与 hook 信任机制冲突——`hooks.json` 住在 `CODEX_HOME` 内，每个私有 home 都要单独装 hook 并单独信任（要么每次弹信任提示，要么静默 `bypass_hook_trust`，安全 posture 更差），另有 auth 硬链复制与 resume 列表分裂的代价。重启条件：L2 歧义率实测不可接受（如多终端自动化编排成为常规用法），且届时把状态信号也改扫描制（transcript 哨兵已有基础）。
- **hook 保留范围**：回合状态/通知（running/等审批/降级）、turn 记录、知识沉淀等与统计无关的职责原样不动。
- **代码触点**：`refreshRuntimeTelemetry` 的 `payload.sessionId` 触发点不再驱动统计；`coordinator.readSnapshot` 的无绑定回落从 bootstrap 改为参与扫描；`history.ts` 的 `sessionId` 缺失分支从"只读 config.toml"改为"按 cwd 找该终端活跃会话，标 estimated"；10 秒轮询保留（上下文档条实时性）但账本记录不再挂在它身上。

## Alternatives considered

- hook 绑定保留为归属的增强信号（选项 B）：hook 健康时归属更即时精确。否决：用户选定 A；保留双路增加心智与维护面，收益仅限边缘场景的即时性。
- 每终端私有 home 一步到位（选项 C）：100% 精确归属，并发零歧义。否决：与 hook 信任机制冲突（每 home 单独信任或静默 bypass）、resume 列表分裂、auth 复制成本；留作 L3 条件触发。
- 进程树/文件句柄关联：pty → CLI 进程 → 其正在写的会话文件，精确。否决：Windows 拿不到子进程句柄表（需 native addon），且需先验证 CLI 是否常驻持有句柄；跨平台维护重。
- 维持现状：否决——单点故障已实证（codex UTF-16 事件），且不满足"覆盖未打开历史会话"的既定需求。

## Consequences

- hook 故障/未装/引擎升级改契约不影响统计归属和账本，只影响非统计生命周期消费者；终端统计的故障形态从"全空"变为"降级并标注"。
- 全局统计覆盖全部历史：Claude/Codex/Pi 和新导入的 OpenCode 会话按事件时间回放；已有累计基线会话保留原覆盖起点，不重放其历史。
- 读放大需要基础设施：持久字节游标、64MB 单文件上限、启动扫描与低峰增量的调度；当前账本无持久游标，属新增件。
- 同 workspace 并发归属依赖"诞生时刻单一性"，人类交互速度下成立；脚本并发场景退化 `estimated`。
- Codex 切事件模式后，旧账本中的累计基线如何处理尚未决定，见待定项。

## 待定（已由实现解决）

Codex 事件模式的迁移政策：**一次性重放全历史**（数字最全，但旧会话消耗按事件时间回填到过去日期，趋势图变化）还是**仅从切换日起算**、历史会话可见但不聚合。影响 L1 实施方案，需用户拍板。

2026-10-14 实施时按模式锁解决，无需用户另行拍板：**会话的记账模式在首次入账时锁定，之后永不切换**。从未入账的会话（含全部未打开历史、关闭终端的后续增长）走事件模式完整重放；已被终端路径建立累计基线的会话维持累计差分。ledger 在 `record()` 内执行该锁（旧行按形状推断），因此两条路径并存是幂等的而非双记。代价：旧基线会话不回填历史（其区间消耗只有采样差分），趋势图上新旧会话精度不同——界面已有覆盖起点与 issue 标注承接这一差异。

## 实施状态

- **L1 已落地**（2026-10-14）：`corpus-scan.ts` 全语料扫描（Claude projects、Codex sessions+archived_sessions、Pi 全局 sessionDir；OpenCode 为 sqlite 单库暂未枚举）；codex 事件模式 `collectCodexEvents`（身份=ordinal、时间=事件时间戳）；`readJsonlLinesWithCursor` 提供完整字节回游标，未变化文件只 stat 不读；coordinator 启动 20 秒后首扫、之后 5 分钟周期，零终端时仍运行；ledger 增模式锁与 `sessionState` 查询。
- **L2 已落地**（2026-10-14）：`session-attribution.ts` 按"会话诞生/激活时刻"归属——候选必须位于该终端工作区（Claude project 键、Codex `session_meta.cwd`、Pi header `cwd`）且末次写入落在终端 pty 活跃窗口（15s）内；唯一候选才绑定，零或多个候选保持未绑定（显示未知，不猜）。pty 活跃度经 `noteTerminalActivity`（1 秒节流）采集；`bindSession` 仅保留 correlated 来源；P3 已移除 Hook 优先／升级路径，快照只标 correlated。终端创建及独立轮询继续执行归属，不依赖 Hook。
- **L3 未实施**：每终端私有 home 暂缓，重启条件不变。

2026-10-17 补齐 OpenCode：L1 全语料扫描读取 v1/v2 SQLite 消息用量并沿用原生身份去重，L2 使用同库工作区与会话活动时间关联 pty，唯一候选才绑定；旧累计模式不迁移。费用从既有账本与模型目录计算，不引入另一路采集。当前行为与 545 会话真实只读核验见[会话源单源化](./requirements/usage-telemetry-single-source.md)的 OpenCode 全历史与费用估算章节。

## Verification

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
