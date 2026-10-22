---
{
  "schema": "harness-note/2",
  "id": "8a20f7fe-2bf4-4473-ae37-1f1d0711f0bf",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-12",
  "class": "feature",
  "tags": ["telemetry","usage-stats","terminal","session-files"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/61b5d05c-e1ad-4f7a-a3e9-57982fb78c4e",
  "updated": "2026-10-22T07:55:52Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 终端上下文与用量统计单源化（会话文件路线）

## Problem

改动前，统计数字有两个来源：PTY 流解析（`src/renderer/src/lib/runtime-telemetry.ts` 的 TUI 正则与结构化 JSON 分支）和会话历史扫描（`src/main/runtime-telemetry/history.ts`），经 `mergeRuntimeTelemetrySnapshot` 按置信度、时间和单调累计规则合并。两条路径需要分别适配 CLI 输出变化，TUI 重绘、文本误命中与来源优先级会影响数字稳定性。

改动前，`UsageStatsPanel` 的 `aggregateUsageStats`（`src/renderer/src/lib/usage-stats.ts`）按当前终端 store 快照归桶，以 `telemetryUpdatedAt` 入桶。[用量统计修复与全局统计](./usage-telemetry-fix-and-stats.md) 记录了该阶段的快照口径。聚合没有独立持久账本，关闭、移除或重建终端会影响结果；恢复会话后能否重新读出数字，不能替代历史时间分布的持久化。

用户确认本方案并要求 xdo 实施后，当前 worktree 已切换为原生会话源和持久账本。本文记录实现、验收证据及保留边界；Janus/DSH 原生用量接入仍属于后续扩展。

> 2026-10-14：本文的 hook 归属与采集范围已被[hook 解耦决策](../usage-telemetry-hook-decoupling.md)（accepted，未实施）取代——统计链路将完全移除 hook，账本改纯会话扫描并覆盖未打开历史，归属改会话诞生/激活时刻的 pty×文件相关性。决策落地前，本文契约仍是现行实现；其中"Out of scope：无绑定的全磁盘历史普查"一条按决策移入范围，Codex 的累计基线差分将升级为事件模式重放（迁移政策见决策待定项）。

## Stability assessment

**方向更稳，但直接给现有 `RuntimeTelemetrySnapshot` 加 `max(0, 本次累计 - 上次累计)` 账本并不可靠。** 单源减少了解析与合并的维护面，正确记账仍取决于源计数的范围、完整性、稳定身份和恢复语义。

| 实施前基线事实 | 对原方案的影响 |
|---|---|
| Claude `parseClaudeSession` 累加逐消息 usage；长文件只读头部 16KB 加尾部 256KB | 这是截取范围的和，不是 CLI 提供的完整累计值；文件增长会让旧记录滑出窗口，差分会漏算或产生伪增量 |
| Pi `parsePiSession` 只累加活跃叶路径；`contextTokens` 也取该路径 usage 的和 | 分支切换会使累计值回落；已放弃分支仍可能发生真实请求消耗，不能从账本删除；路径 usage 和也不是准确的当前 prompt 长度 |
| Codex 读取 `total_token_usage`，OpenCode 读取 session 表 token 字段 | 可以考虑累计差分，但需要验证各自计数器范围、fork 继承和 reset 语义，不能只凭字段名保证准确 |
| history 的 `startedAt` 会过滤文件或记录；Pi 还会过滤会话头 | 同一外部会话恢复到新终端时，读数范围可能改变或返回空；终端启动时间不能定义账本累计范围 |
| coordinator 的账本按 terminalId 保存绑定、模型段与压缩数；`unbindTerminal` 删除该条目 | 它不是用量账本；照搬生命周期会在关闭终端时丢历史与续算基线 |
| coordinator `getSnapshot` 在异步读取前获取绑定，读取结束后没有复核绑定版本 | 新增记账时必须拒绝换绑、退出后返回的旧读数，防止旧会话重新写回 |
| `observedAt` 多来自文件 mtime 或 session 更新时间；renderer 每 10 秒轮询 | 两次累计值之间的增量不能还原请求时间；mtime 也不能独自承担读取版本或并发排序 |
| 缓存分组把全零缓存视作缺数据；`hasUsageData` 接受仅有 context 的快照 | 启动基线可能被当作用量样本；明确的零命中和缺字段需要分别表达 |

两个可复现反例：Claude 新增消息后，尾读累计可以从 10 降到 5，而完整源已经消耗 115；Pi 两条分别消耗 100 和 20 的互斥分支，活跃路径读数从 100 降到 20，而两次消耗合计为 120。这两类源不能直接进入累计差分。

普通计数器也有反例：`100 → 80 → 100` 若每次都更新基线，则增量为 `0 + 20`，回落后的恢复可能重复计数；若始终保持高水位，则无法辨认真正 reset 后的新消耗。没有源 generation 或明确重置证据时，应暂停该段记账并标记异常。

### 外部参考的适用边界

2026-10-13 核对的 [cc-switch 官方 Changelog](https://github.com/farion1231/cc-switch/blob/main/CHANGELOG.md) 记录了 fork 回放重复记账、字节游标与尾部指纹、半写行重试、Windows 文件增长但 mtime 不变、会话内换模型归属修复，以及用量重建入口。它支持的结论是会话源仍需要身份、读取与修复机制；不能据此宣称累计差分天然免去去重或具有相同准确性。该参考用于 token 消耗导入的边界，不作为上下文占用算法的证明，也不宣称已穷尽其产品功能。

## Expected behavior

每个引擎的运行数值来自其原生会话文件或数据库，统一由主进程 history 适配层读取；PTY 不再提供模型、上下文或用量数值。配置声明和模型目录仍用于启动模型与窗口容量，并携带 declared/estimated 标记。单源指运行数值的来源，不要求删除配置和模型元数据。

上下文与历史消耗共用源读取，采用不同投影：

```
原生会话文件 / 数据库 → history 适配层（唯一运行数值入口）
                         ├─→ 当前上下文投影 → 终端上下文条
                         └─→ 用量观测（累计计数或稳定事件）
                                  → 持久用量账本 → UsageStatsPanel
配置 / 模型目录 → 声明模型、窗口容量及来源标记
```

- 上下文表示最近请求或当前有效上下文的占用，可在压缩、分支切换后下降；消耗表示真实发生的请求 token。两者同源、不同口径，不要求同数。源不能还原当前占用时显示未知或明确估算。
- 用量账本是会话源的持久投影，不是第二个采集来源。原生稳定累计值使用受约束差分；逐消息源使用稳定事件身份，去重属于同源导入。
- 当前上下文与窗口容量都缺失时显示未知；配置启动零值不作为真实用量，缺缓存字段不当作零命中。
- 统计在关闭终端、renderer 卸载或重启后保留，并标明覆盖起点、采集缺口及异常；已有日期筛选、输入输出拆分和无数据态继续工作。

### 引擎实现矩阵

| 引擎 | 原生会话源 | 当前实现与边界 |
|---|---|---|
| claude | JSONL 逐消息 usage | 全量读取完成的 assistant 响应，按 message.id（缺失时 requestId）去重；行 uuid 不作请求身份；上下文取最近有效请求输入 |
| codex | token_count 的 last/total usage | total 使用持久基线差分，首次只建基线；缓存从含缓存 input 中扣除一次；源替换、截断或旧前缀改写时暂停 |
| opencode | opencode.db 的 assistant 消息用量；v2 同时读取 compaction | 全历史按原生 message id 和完成时间导入，推理计入输出；流式未完成消息重试，原有累计会话保持模式锁，只记后续差分 |
| pi | JSONL 消息及 id/parentId 分支结构 | 消耗导入所有分支，按 entry.id 加 timestamp 去重；上下文取活跃叶路径最新 assistant 请求的 input 加缓存，标估算 |
| janus | 已接入历史只存消息与工具轨迹，无 usage | 找到并验证原生用量落盘点，否则未知 |
| dsh | session.v4.jsonl.zstd，当前只定位不解码 | 解码器加真实样本，并验证用量字段，否则未知 |

Codex 来源目录与启动一致：优先使用主进程为该终端登记的恢复目录，其次取 `CODEX_HOME`，最后回退 `~/.codex`。声明配置、会话扫描、账本 namespace 及 checkpoint 均使用所选目录；Hook 刷新和 renderer 读取不会覆盖启动目录，终端释放前最后采集仍使用原目录。renderer 不提供目录选择。`last_token_usage.total_tokens = 0` 是有效上下文读数，不再当作缺失。对应回归位于 `runtime-telemetry-history.test.ts` 与 `runtime-telemetry-coordinator.test.ts`，连同 renderer 合并测试共三文件 42 项通过。本机近期日志的结构仍包含 `token_count.info.last_token_usage/total_token_usage`；未以目录兼容性修复代替用户当前实例的绑定实测结论。

### 缓存写入字段适配（2026-10-15）

Codex 本机原生 `total_token_usage` 已提供 `cache_write_input_tokens`。终端累计投影与历史事件差分都读取该字段：新鲜输入 = 原生输入 − 缓存读取 − 缓存写入，总 token 保持原值。缺少写入字段的旧日志保持未知，明确零写入保留为 0；继承事件的缓存写入也留在父会话。缓存写入是新建缓存的 token 用量，不是磁盘容量或每轮对话的必有增量。

2026-10-22：上段原含“最近命中率仍为最近缓存读取 / 最近原生输入，写入不另加分母”，该口径已随 `recentCacheHitRate` 字段整体移除。底部卡片改用会话累计命中率（命中 = 累计缓存读取，未命中 = 累计新鲜输入 + 累计缓存写入），与设置页统计共用 `cacheSplitFor`，Codex 不再有“分母不含写入”的特例。见[用量面板直接展示内容](./usage-panel-direct-content.md)。本段的输入拆分、总量守恒与账本差分规则不变。

账本升级保持已有消耗：旧事件会话即使文件大小不变也重新读取一次；只有新旧用量满足“旧输入 = 新鲜输入 + 写入”且读取、输出、总量一致时，才原位补充分项并保留记录 id、日期和模型。缺源或核对不一致不猜测。旧累计基线没有历史写入分量，升级过渡区间保留原有未拆分输入，随后使用新写入基线差分；不回填无法还原的旧采样区间，真实计数回退仍暂停。

Claude 的 `cache_creation_input_tokens` 原已接入，本轮补充正数/零/缺失回归并修正整段缺失被投影成 0 的情况。近期完整日志使用 `mimo-v2.6-pro`、`step-5-preview`，原生写入均缺失或为零，缓存读取为正；不从读取反推写入。

验证：`npx vitest run tests/unit/runtime-telemetry-history.test.ts tests/unit/runtime-telemetry-corpus-scan.test.ts tests/unit/runtime-telemetry-accounting.test.ts tests/unit/usage-ledger.test.ts tests/unit/runtime-telemetry-coordinator.test.ts tests/unit/usage-stats.test.ts --maxWorkers=2 --reporter=dot`，6 文件 81 项通过；遥测三文件定向 ESLint、普通类型检查通过。真实日志只读核验（临时账本）：5 个近期 Codex 会话均满足事件写入之和等于累计写入、事件总量之和等于累计总量，且输入/读/写/输出守恒；3 个近期 Claude 会话解析写入为 0，与源一致。未运行 live Electron 验证。全项目 `typecheck:strict-unused` 被其他文件的 3 个未使用变量错误阻塞（TerminalManagerPanel 的 useEffect/load、workspace 的 getBrowserPaneContent），未改动这些文件。

### OpenCode 全历史与费用估算（2026-10-17）

漏统断点是全语料扫描未枚举 SQLite，且 pty 相关归属不支持 OpenCode。参考 [magpie 的原生读取](https://github.com/yetone/magpie/blob/8bb9375e745845ee8520c1045ee25516e6a023c5/internal/sessions/opencode.go)及[逐请求统计](https://github.com/yetone/magpie/blob/8bb9375e745845ee8520c1045ee25516e6a023c5/internal/sessions/calls_opencode.go)，`opencode-source.ts` 只读投影消息的 tokens、模型及时间，不把消息正文传入统计。v1 读取 message，v2 读取 session_message 的 assistant/compaction；迁移时已复制会话优先 v2，kv 标记迁移完成后忽略遗留 v1 表。子会话独立导入，不加回父会话。输入、缓存读、缓存写为互斥计数，输出包含 reasoning；只导入有完成时间且有消耗的稳定消息。每条消息用原生 id 去重，不从 session 总数反推历史请求日期。

全扫描先处理 OpenCode，再处理 JSONL 引擎；每个会话之间让出事件循环，沿用启动 20 秒后及每 5 分钟扫描。暂未为 SQLite 增加持久增量游标，每次按会话重读用量字段。终端自动归属使用同一数据库的 directory/time_updated，与 pty 活跃窗口匹配，唯一候选才绑定。统计、会话发现、恢复和知识转录回补共用数据库路径解析：OPENCODE_DB 的绝对路径优先，相对路径在 XDG_DATA_HOME/opencode（默认 ~/.local/share/opencode）下；:memory: 不作磁盘路径。已存在累计基线的会话继续原生 session 累计差分，避免历史双计；其旧覆盖起点和采样时间口径不改写。OpenCode v2 的转录详情渲染未在本次扩展。

用量页从持久账本投影参考费用，不把计算金额写回原始 token 记录。模型精确或高置信匹配当前目录，按新鲜输入、输出、缓存读、缓存写分别计价。在总用量旁以一行「预估费用 + USD 金额」展示，保留小图标更新价格；不再另设费用面板、分项表格或长说明。计价覆盖率、缺价和更新失败状态仅通过金额的简短提示展示。请求级事件可按含缓存的 prompt 选择 min_prompt_tokens 阶梯，累计采样缺少请求拆分时不猜阶梯。不同 TTL 的缓存写入或独立推理价格缺少用量拆分时，相应部分保持未计价；未知模型/价格显示「–」，真实零价保留。图片、音频、搜索附加费未估算，当前目录也不能还原历史账单。

验证：遥测、费用、账本与设置加载相关 12 文件 127 项通过；费用五项覆盖缓存拆分、零价/缺失、阶梯、TTL/推理限制、筛选与去重。Playwright `usage-cost.spec.ts` 与 `usage-stats.spec.ts` 共 6 项通过，包含双主题、390px 布局、引擎筛选、价格刷新及原有趋势交互。严格类型与语言键检查通过。真实 OpenCode 数据库只读核验以临时账本导入 545 会话、43,539 条有消耗请求，共 8,192,796,763 tokens；四分项分别与源 SQL 求和相等，复扫记录数及总数不变，源文件 size/mtime 未变，零 issue。证据在 `artifacts/opencode-usage-verification.json`；截图在 `artifacts/usage-cost/`。未运行真实 Electron 终端交互，v2 兼容由 fixture 验证。

### 费用零值修复与紧凑展示（2026-10-17）

真实 dev 账本的当日 Codex 事件缺少 model，导致用量存在但目录无法匹配价格。`collectCodexEvents` 按文件顺序读取前置 `turn_context.payload.model`，切换模型只影响后续事件，缺失模型不沿用旧值。账本保存原生 eventId；重放旧事件时，仅补齐会话、事件时间、全部 token 分项唯一匹配记录的空模型，不覆盖已知模型或重记消耗。`codexEventModels` 版本标记使旧 Codex 事件文件即使大小不变也重读一次，随后恢复字节游标跳过。累计模式锁与异常暂停保持原口径。

实际只读源验证使用 SQLite backup 的临时副本，重放其中 2 个 Codex 会话已入账的 191 个源事件。当日 155 条记录全部补齐模型，20,403,333 tokens 不变，金额从 $0 恢复为 $7.1691381；记录 id、日期和各 token 分项保持相同。证据为 `artifacts/usage-cost/codex-model-repair.json`；未写入运行实例的账本，更新主进程后由正常扫描自动回补。

本次验证：`runtime-telemetry-accounting`、`runtime-telemetry-corpus-scan`、`usage-ledger`、`usage-cost`、`usage-stats-loading` 五个单测文件 58 项通过，覆盖模型切换、旧记录唯一匹配、重复回放、缓存写入同步升级及歧义保留。`usage-cost.spec.ts` 与 `usage-stats.spec.ts` 六项 Playwright island 测试通过，双主题及 390/480px 窗口无页面溢出，费用行不超过 24px；截图位于 `artifacts/usage-cost/` 和 `artifacts/usage-stats-narrow.png`。严格类型、语言键、构建检查通过；Notes 校验为 315 篇、0 错误及 17 条既有外链诊断。定向源 ESLint 无错误，UsageStatsPanel 的 customRange effect 依赖提示为既有告警。未运行 live Electron 交互。

### Codex 绑定实证（2026-10-14，用户 dev 实例）

用户实测 dev 版时 Codex 上下文与用量均未统计、Claude 正常。定位结论：**不是 rollout 解析不适配新格式**——本机 codex 0.162.1 的 `session_meta.payload.id/cwd`、`event_msg/token_count.info.*`、`turn_context.payload.model/cwd` 与解析器字段路径完全匹配。真正断点在 hook 载荷解码：Codex 在 Windows 上把 hook stdin 写成 **UTF-16LE 带 BOM**（实测捕获 payload 首字节 `FF FE`），而 `buildWindowsHookScript()` 用 `[Console]::In.ReadToEnd()`（InputEncoding=UTF8）读取，得到 NUL 间隔乱码，`ConvertFrom-Json` 失败后 catch 把载荷降级为字符串，`Get-FirstString` 对字符串输入返回 null，`session_id`/`thread_id`/`transcript_path` 全部丢失。后果链：`bindSession` 从不调用 → coordinator 无绑定 → 每 10s 轮询走 bootstrap 分支只返回 config.toml 声明模型 → 无上下文、无用量。实证：dev 应用绑定账本中 codex 条目停留在 8 月 2 日，用户当前 codex 终端（hook 正常发出 Stop）从未入账。

修复：hook 脚本改为读原始字节流并按 BOM 解码（UTF-16LE/BE/UTF-8 通吃），Node 版 hook client 同步加 BOM 探测。已实测两种编码的 stdin 经生成脚本都能正确解出 sessionId。codex 的 `hooks.state.trusted_hash` 只覆盖 hooks.json 中的命令、不覆盖脚本内容，更新脚本不需要用户重新信任 hooks；应用重启后创建终端即自动重部署脚本（`ensureHookClientScript` 每次安装都重写）。Claude stdin 为 UTF-8，走同一解码的 else 分支，行为不变。

### janus / dsh 挂账：未解决，后续扩展

已按用户确认的方案采用声明模型、带来源的窗口容量和「无用量数据」，当前占用无法读取时保持未知。Janus footer 和 DSH 文本数字不再参与统计；对应筛选没有已记录用量时显示「–」。关闭挂账需要原生会话源的真实样本、读取实现及回归验证；仅有解码器或未经验证的新文件不算完成。

### 解析功能去留清单

保留：

- history 适配层的会话源读取与声明配置读取，但重划上下文和消耗边界。
- `extractDshTurnStatus` 的 running/degraded 状态信号及其所需文本清理工具；它不参与数字统计。
- `janus-runner/parsers/*`（Claude/Codex/OpenCode/DshParser，无头 Agent JSONL 事件解析，服务 SubAgent 运行/通知，与终端遥测无关，原样保留）。

删除：

- 已移除 `CLITerminal` 的 `createRuntimeTelemetryStreamParser` 数字采集路径及无其他消费方的模型、上下文、footer 和结构化数字提取函数；保留 `mergeRuntimeTelemetrySnapshot`、`resolveContextWindows` 及有效投影测试。

## Scope

In scope：history 用量观测契约与适配、持久用量账本、coordinator 绑定版本与采集调度、`system` IPC 和 preload、`usage-stats.ts` 聚合换源、`UsageStatsPanel` 口径与缺数提示、`CLITerminal` 数字流解析退役、相关单测与 e2e。账本位于 `<userData>/janusx/usage-ledger.sqlite`，独立于绑定元数据的删除生命周期。

Out of scope：DSH 解码、Janus 新增用量落盘协议、费用定价、无绑定的全磁盘历史普查、专门的重建 UI、`janus-runner/parsers` 无头解析和状态环协议调整。必要的消息/请求去重、异常诊断和源重放恢复能力属于账本正确性范围。

## Implementation

### 观测与账本契约

`src/shared/usage.ts` 定义观测、记录及查询契约。history 适配层返回上下文投影及独立用量观测，后者明确 `cumulative` 或 `events`，携带引擎、存储命名空间、外部会话身份、字段可用性及时间依据。累计来源另携带文件身份、大小及可用的内容指纹。配置声明、空启动快照和截断样本不入账；观测仅在主进程处理，IPC 上下文快照不携带内部观测。

累计模式按引擎、命名空间和 sessionId 保存独立基线，验证非负安全整数及 total 等于各互斥分量之和。重复读取不增加消耗，更旧读取不回写基线。计数回落、字段集合变化或源变化保留旧记录并暂停；当前没有可靠 reset/generation 协议，因此不自动建立新代次，也不以 `max(0,·)` 静默吞掉。字段缺失不变成零。

首次接入已有累计值时只建立基线，不把此前全部消耗记到当前时间桶；若要补历史，必须从同一原生源按可验证事件时间重放。恢复同一会话使用原有基线；换绑只切换当前投影，保留两边账本。fork 继承的父历史不是新消耗，来源无法给出可靠边界时标缺口并暂停对应导入。

事件模式由 `history-usage.ts` 归一化 Claude/Pi usage，同一引擎和原生存储命名空间内的响应身份幂等入账。Claude `stop_reason:null` 视为未完成，重复内容块选同响应的最大有效 usage；跨次读取同身份 usage 改变则暂停，不重复入账。Pi 消耗不因分支放弃而回吐，复制历史不重复入账。JSONL 每次全量读取，单文件上限 64MB；半写末行下次重试，完整坏行、读取中截断或超限作为不可用源。当前没有持久字节游标；Codex 校验文件身份与旧前缀 SHA-256，不依赖 mtime。

### 身份、采集与持久化

账本键至少包含引擎、原生存储命名空间和外部 sessionId，并独立于 terminalId。大小写规范化服从引擎身份契约，不能假定所有 id 都不区分大小写。terminalId 只用于关联当前展示；关闭终端不删消耗、去重状态或续算基线。

coordinator 在主进程跟踪终端，hook 触发刷新，10 秒轮询补偿漏事件；同终端读数串行，读数未完成时不叠加周期任务。renderer 只订阅上下文、查询账本。异步读取后复核同一绑定对象，拒绝换绑或解绑后的结果；退出时先停轮询，再尝试最后一次采集并解除原绑定。精确绑定不以新终端 `startedAt` 过滤原生历史，恢复同一会话沿用原基线。事件源可补原生历史；累计源只能保留离线区间和采样增量，不能还原区间内每次请求。

`usage-ledger.ts` 使用 SQLite WAL、synchronous FULL、busy_timeout 100ms；复用连接并在关闭或 profile 路径变化时释放，仅新库在事务内初始化 schema/version，普通查询不写版本或反复创建 WAL/SHM。`BEGIN IMMEDIATE` 将会话基线、事件身份和增量记录作为一次原子提交，并处理跨进程写入互斥。查询或写入失败回滚，保留旧基线供重试；较短锁等待限制单次主线程停顿，持续争锁会延后采集。损坏或未来版本显式报错，保留原数据库。相同事件源重放可幂等校验，但账本损坏后不自动重建；累计源无法重建已经丢失的采样时间分布。异常会话与读写错误在统计页提示，正常重试可清除暂时不可用状态，源改写或计数回落的暂停不自动解除。

绑定会话最多缓存 128 份成功投影，不缓存 JSONL 或 usageObservation。键包含引擎、绑定、cwd 和自定义 Codex home；命中前异步 stat 核对文件身份、大小、mtime 与 ctime，最长 30 秒强制全文复核，异常或重绑失效。源变化仍执行完整 JSON 校验、精确压缩计数和累计前缀哈希验证。后台语料扫描不重叠，在文件间让出事件循环并支持取消；累计模式预读保留实际文件身份与完整行字节，半写尾行不进入前缀哈希。应用退出在终端停止后取消扫描及采集定时器，清缓存排入最终采集，等待在途读取再关账本。版本对比、压力数据与验收边界见[长时间使用性能分析](../../workbench/long-session-performance.md)。

2026-10-14 用户要求下的偏离：**Codex 的 issue 会话不再触发统计页的“用量尚不完整”提示**。理由是本机 24 个 codex 暂停会话全部源于压缩后累计计数器重置（实测回落点≈上下文窗口值），属已知 CLI 行为而非数据损坏，提示只是噪音；提示对 codex Filter 与“全部”视图均屏蔽，其他引擎的缺口照常提示。会话本身仍处于暂停状态（压缩后消耗不入账），界面不再可见该信号——若后续要把这部分消耗补上，需要识别重置并重新建立基线，属账本正确性扩展而非展示问题。

### 时间、模型与展示

2026-10-16：设置用量页采用轻分隔线、紧凑日期分段控件和数字优先的汇总布局，保留原有输入/输出配色与趋势交互。`UsageHeatmap` 通过同一账本接口独立查询最近 365 个本地自然日，以日 token 总数生成周日开头的 53 列日历；首尾补位不可交互，日期递增采用日历运算以适应夏令时。热力图跟随终端类型筛选，今日/本周/本月/自定义只控制原汇总和趋势。五档绿阶以当前筛选的单日峰值线性分级，跨引擎颜色深浅不表示固定相同 token 阈值。悬停、聚焦和方向键可查看日期及精确 token 数；窄面板仅日历内部横向滚动，首次加载后定位到最近日期。

年度视图每 60 秒刷新，查询范围保持在 IPC 的 367 天限制内，沿用 2000 条分页与客户端 100 页上限；超限或读取失败保留上一份完整日历并提示失败，不发布部分年度总量。类型切换期间保留旧图并标记 busy/降透明度，异步结果取消标志阻止旧引擎覆盖新筛选。色块只描述账本已记录消耗，空白日期不证明源用量完整。聚合边界见 `tests/unit/usage-heatmap.test.ts`；筛选、年度历史、键盘及宽窄/明暗布局见 `tests/e2e/usage-stats.spec.ts`；加载保留、失败恢复见 `tests/unit/usage-stats-loading.test.ts`。

有可靠请求时间的事件按该时间归桶；只有累计采样差分的记录保留上次/本次采集区间，以采集确认时间归桶。按用户要求，时间口径说明仅保留在开发文档，不在用量统计界面展示。跨午夜、长时间离线及首次观察的历史差额不能宣称精确发生在发现时刻，不按比例虚构请求时间。`observedAt`、请求时间与采集时间分开；文件增长检测结合 size/源版本，mtime 不单独决定新旧。

IPC 每次查询最多 367 天、每页 2000 条；首批固定 throughId，后续页不混入并发导入的历史。客户端最多读取 100 页，失败不发布部分结果。`aggregateUsageStats` 只读账本记录，以记录 id 去重、以原生会话计数；日期、类型、输入输出和图表交互保留，界面保留覆盖起点与未知态提示。显式零缓存显示 0%，缺字段或混合不完整覆盖显示未知。事件按自身模型归属；累计区间模型变化或无法确认时标未知，包括模型切走后切回同名的情况。

统计页的总计、输入输出与缓存命中率使用紧凑汇总容器；终端统计色板、输入输出配色与响应式布局见[日期与明细展示](./usage-stats-custom-range-detail.md)。本次展示调整不改变账本或聚合契约。

实现入口为 `history.ts` / `history-usage.ts`、`usage-ledger.ts`、`coordinator.ts`、`system` IPC、renderer `services/usage.ts` 及 `UsageStatsPanel.tsx`。状态信号、无头 Agent 解析和容量解析继续由原模块负责。

## Alternatives considered

- 所有引擎统一做累计快照差分：代码最少，但 Claude/Pi 当前没有符合契约的计数器，且不能自动解决首样本、fork、回落或时间归属，否决。
- 所有引擎统一事件导入：容易按请求时间归桶，但原生累计源未必提供完整请求身份，强行统一增加成本；选用同一源下按能力分型的观测，不引入另一条采集路线。
- 保留现状：已有覆盖和刷新速度较好，但继续承担 TUI 数值适配与快照历史缺失；仅作为迁移期间的现状，不作为最终统计方案。
- 缺源引擎显示零：界面简单，却把未知伪装为无消耗；选择明确未知及扩展条件。
- 首次累计全部记到今天：不会漏总量，却污染今日趋势；选择建立基线并展示覆盖起点，可验证历史重放另行扩展。
- 增加重建按钮：便于用户自助修复，但不是本次最小 UI 范围；保留源重放和诊断能力，不能以没有按钮为由免除恢复责任。

## Acceptance criteria

- [x] AC-1: 运行数值统一由 history 会话源适配层提供；统计不读终端 store 快照。上下文、容量和消耗各自保持语义及来源标记，不要求同数。
- [x] AC-2: 稳定累计与事件观测分别测试重复采集、首样本基线、恢复续算、计数回落、fork/重放、缺字段和换模型；Claude 超过头尾窗口、Pi 放弃分支均不漏算或重算真实消耗。
- [x] AC-3: PTY 数字采集入口及无消费方的解析函数移除；DSH 回合状态、无头 Agent 解析、模型容量解析与有效合并投影回归通过。
- [x] AC-4: Janus/DSH 缺少原生用量时显示未知，启动零值不入账；降级范围、真实样本和扩展完成条件明确。
- [x] AC-5: 趋势图按可靠事件时间或采集确认时间展示新增量，覆盖跨日和离线场景，不把累计快照或首样本历史量伪装成单桶真实消耗；时间口径保留在开发文档，界面不展示该说明。
- [x] AC-6: 关闭终端和 renderer 卸载不丢账；重启、写盘失败、损坏数据与提交中断可诊断，基线/游标和增量原子恢复不重账。轮询与 hook 并发、异步换绑/退出不接受旧结果。
- [x] AC-7: 账本范围查询有界；现有类型、日期、输入输出、键盘读数与窄窗口行为回归通过；零缓存与未知缓存区别可见，模型归属不猜测。

## Risks

原生会话格式、数据库 schema 与真实字段含义仍可能随 CLI 版本变化，单源并不免除适配。上下文刷新受落盘和 10 秒采集节奏限制；更多终端和大日志下需要增量读取或索引，当前全量 JSONL 读取的 64MB 上限会停止超限源采集。没有进行长时运行、强制杀进程及所有真实 CLI 版本的兼容测试，不能用 fixture 验证替代这些结论。

最小稳定版本可以先覆盖经验证的引擎，其余显示未知；不能为统一展示把不完整源标为完整。事件时间与采样时间不能互相替代，跨区间增量只具备已声明的精度。账本损坏、源被删除和离线缺口可能无法完全恢复，需要可见覆盖范围。

## Validation evidence

以下证据覆盖本次实现，外部参考仅用于导入边界。验收勾选针对本需求中的实现与回归范围，不代表所有原生 CLI 版本、真实重置协议或任意账本损坏均可无损恢复。

2026-10-13 验证结果：

- 相关单测七个文件、82 项全部通过，覆盖 history、coordinator、投影、统计聚合、账本和客户端。Claude 长文件 input=100/10/5 正确记为 115，重复内容块不重算；Pi 两条互斥分支的上下文取最新活跃请求 20，真实消耗保留为 120。
- 累计基线重启、回落暂停、换模型、同 mtime 增长、旧前缀改写、事件 fork 重放、半写行、事务写入故障、跨日与离线采样区间、查询分页并发均有针对性断言。
- 全量单测运行结果为 361 个文件通过、1 个失败、6 个跳过；3094 项通过、1 项失败、23 项跳过。唯一失败为 `note-repair.test.ts` 的固定 updated 日期早于动态 created 日期；未修改的相邻主目录可复现同一失败，本次不修改该无关测试。
- `tests/e2e/usage-stats.spec.ts` 三项通过，覆盖类型与日期筛选、键盘读数、曲线切换、缺数提示、宽窄窗口汇总区尺寸，以及浅深色主题下终端类型和输入输出的配色。汇总布局调整后重新通过 `npm run typecheck:strict-unused` 与组件 ESLint；此前账本改动的 `npm run i18n:check`、`npm run build:check` 均通过。
- `npm run check:notes` 通过：297 篇 harness Notes、0 错误；17 条既有跨仓库链接诊断不涉及本次更新。
- 初次账本验证临时借用相邻 JanusX 主目录现有 node_modules，结束后解除工作树链接。后续 dev 修复已在本 worktree 安装独立依赖并保留，启动检查与安装约定见[可复现验证](../../desktop/reproducible-verification.md)；package-lock.json 未改动。
- 合并前复核：相关七个单测文件加 dev 环境检查共 86 项通过；最终 `npm run build:check` 通过。统计页三项 e2e、严格类型检查、组件 ESLint 与 Note 校验的验证结果保持有效。Janus/DSH 原生用量接入继续作为后续扩展，不纳入本次收尾。
