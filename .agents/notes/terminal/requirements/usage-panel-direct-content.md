---
{
  "schema": "harness-note/2",
  "id": "670abb8a-4665-41cf-a3de-9429cd67027d",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-14",
  "updated": "2026-10-22T07:55:52Z",
  "class": "simplification",
  "tags": ["usage", "context", "panel", "interaction"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 底部用量面板直接展示内容

## Expected behavior

2026-10-14 用户确认底部统计面板的产品名称为“用量”，单纯对话场景也使用此名称。主要内容为“上下文”“缓存命中率”“缓存读取”“缓存写入”“token 总数”“输入/输出”（命中率口径见下文 2026-10-22 修订）。

- 将面板中的“更新时间”调整为“运行时间”。运行时间为本次终端实例从 `telemetryStartedAt` 到当前的时长，每秒刷新；异常退出且保留的终端以退出时的 `updatedAt` 为结束时间，启动时间缺失时显示“–”。它不是遥测数据的更新时间，也不是外部会话历史的累计活跃时长。
- 取消再次点击才进入详细界面的交互；打开用量面板即直接展示内容，无需二次点击查看详情。
- 移除用户不关心的“遥测状态”展示区及其内部诊断信息。用户讨论中称为“遥感状态”，现有代码文案为“遥测状态”。

本需求只调整底部用量面板的名称、信息层级与交互。现有上下文和用量数据契约由[会话源单源化](./usage-telemetry-single-source.md)维护；设置中的全局统计页继续由[日期与明细展示](./usage-stats-custom-range-detail.md)维护。

缓存命中率为本终端绑定会话的累计口径：命中为累计缓存读取，未命中为累计新鲜输入加累计缓存写入，输出不入分母。它与设置页统计共用 `src/renderer/src/lib/usage-stats.ts` 的 `cacheSplitFor`，只是范围收窄到单个会话，两处公式不再各自演化。缺少缓存读取或新鲜输入字段时显示“–”，明确的零命中显示 `0.0%`。缓存读取、缓存写入、Token 总数和输入/输出沿用会话累计投影；输入为现有契约中的新鲜输入。Janus/DSH 缺少原生用量时保持未知。

2026-10-22 修订：上述累计口径取代原“最近缓存命中率”（原文：取原生源最近一次请求，分母为该请求的新鲜输入、缓存读取与缓存写入之和；Codex 直接以缓存读取除以原生输入）。用户指出最近一次请求不是关心对象，且与设置页统计并列时会被读成整体命中率——长会话后期上下文几乎全部命中、新鲜输入只剩几十 token，卡片必然逼近 99%，而设置页累计含每个会话首轮的零命中与纯写入轮，两数长期背离（实测 99.7% 对 92%）。Codex 原“分母不含缓存写入”的不对称也随之消除。

卡片与设置页公式统一后仍不要求同数：卡片只含当前终端绑定的会话，设置页按时间范围聚合所有引擎与所有会话（含全语料扫描到的未打开历史），差额即其他会话，不是偏差。

`recentCacheHitRate` 字段随之从四个原生源的计算、共享 IPC 契约、renderer 合并层与 `Terminal` 类型整体移除：已无界面读取，保留即是会再次分叉的第二套口径。需要恢复按请求的瞬时命中率时重新引入，不在显示层用累计值冒充。

底部抽屉及普通对话的上下文入口统一显示“用量”。用量卡片直接呈现统计内容，点击卡片只切换活动终端。原预览/详情状态、详情浮层、诊断行、更新时间格式化与专用翻译已移除。抽屉默认高度由 210px 调整为 320px，保留按视图拖拽、键盘调整及终端最小空间；短窗口或更多终端仍可滚动。普通对话入口保留原有模型额度配置能力。

2026-10-14 后续修复恢复了底栏上下文徽标及卡片上下文区域的悬浮提示。提示展示精确占用/窗口、运行窗口、模型容量、剩余上下文及已确认的压缩次数；未知显示”–“，明确的零保留为零。提示复用主题 tooltip 并通过 portal 避免抽屉裁切；卡片直接展示的统计和点击切换终端行为保持一致。

2026-10-14 同日迭代：悬浮提示与展开卡片内容对齐，卡片布局重设计。悬浮提示改为左对齐结构面板（ThemedTooltip 新增 `variant=”panel”` 与 ReactNode 标签），展示 提供商 · 模型 标题、运行时间、上下文明细（精确占用/窗口与占比、剩余、运行窗口、模型容量、压缩次数）及五项统计；五项统计由 `TerminalUsageDetails.tsx` 的 `usageStatEntries` 单一定义，卡片（2 列网格，末项通栏）与悬浮（标签/数值行）共用，两边内容不会漂移。卡片去掉模型徽章填充与整卡填充，改为透明底 + 1px 发丝线（`--shell-border`/`--shell-border-soft`，修复计划主题下白色边框不可见的问题）；选中态 = 左侧 2px 强调条 + 提供商名着色，不再加深填充；统计标签/数值/模型行形成三级字重层次。展开态一律精确值（8,000 / 20,500），紧凑值（8.0k）只属于折叠徽章。

2026-10-14 工作区视觉统一的后续调整取代上述透明整卡描边：卡片取消外围边框及上下文区的重复横线，用 7px 圆角和轻微中性色底区分；当前终端保留左侧 2px 强调条与提供商名着色，并有略强的中性色底。折叠入口为整行可点击、可键盘操作的“用量”工具栏，收起不画贯穿横线，展开保留一条弱边界和调高把手。上下文徽标保留语义颜色、去描边；实时值、未知值、悬浮内容与直接展示契约保持一致。实现与验证见[底部用量栏](../../workbench/runtime-drawer-cards-resize.md)。

## Acceptance criteria

- [x] AC-1: 底部统计面板称为“用量”，单纯对话场景名称一致。
- [x] AC-2: 打开面板即可看到主要统计内容，不再通过二次点击进入详情界面。
- [x] AC-3: 原“更新时间”位置调整为“运行时间”，实际数值与明确后的计时口径一致。
- [x] AC-4: 面板中不再展示“遥测状态”分区及其内部诊断信息。
- [x] AC-5: 卡片与悬浮提示的缓存命中率为会话累计口径，公式与设置页统计同源（`cacheSplitFor`）；标签为“缓存命中率”，不声明“最近”。缺字段显示“–”，明确零命中显示 `0.0%`。

## Implementation status

已在当前工作树实施。界面入口为 `src/renderer/src/components/TerminalArea.tsx`，统计行与运行时间由 `TerminalUsageDetails.tsx` 提供。

2026-10-22：命中率改为 `TerminalUsageDetails.tsx` 的 `cacheHitRateLabel`，直接调用 `@/lib/usage-stats` 的 `cacheSplitFor`，读取既有会话累计投影字段，不新增 IPC 与解析。标签键由 `terminal:context.row.recentCacheHitRate` 更名为 `terminal:context.row.cacheHitRate`（中「缓存命中率」/ 英 `Cache hit rate`）。同时移除 `recentCacheHitRate`：`src/main/runtime-telemetry/history.ts` 的 `recentCacheHitRate()` 及四处源赋值（Claude/Codex/OpenCode/Pi）、`src/shared/ipc/system.ts` 契约字段、`src/renderer/src/lib/runtime-telemetry.ts` 的两处接口声明与合并分支及两处字段清单、`src/renderer/src/types/index.ts` 的 `Terminal` 字段。持久账本的累计口径与聚合契约不受影响。

## Validation evidence

悬浮恢复回归：`tests/e2e/terminal-usage.spec.ts` 三项通过，覆盖抽屉收起时徽标、卡片悬浮、移开关闭、实时值变化、零与未知、中英文和 480px 提示边界。已查看 `artifacts/terminal-usage-narrow.png`。本轮同时运行的遥测单测三文件 42 项通过；严格类型、定向 ESLint、翻译一致性及 `build:check` 通过。测试使用 renderer fixture，尚未确认用户当前运行实例中的 Codex 会话是否已精确绑定。

`npx vitest run tests/unit/runtime-telemetry-history.test.ts tests/unit/runtime-telemetry.test.ts tests/unit/runtime-telemetry-coordinator.test.ts tests/unit/usage-stats.test.ts tests/unit/draft-card/quick-note-view.test.ts --maxWorkers=2 --reporter=dot`：五文件 70 项通过，覆盖四种原生源最近请求、零与缺失缓存字段、非单调命中率及原统计/抽屉行为。

`tests/e2e/terminal-usage.spec.ts` 两项通过，验证一次打开直接显示内容、运行时间增长及退出后停止、未知值、终端切换、中英文名称、480px 无横向溢出及首张卡片末行无需滚动；`tests/e2e/janus-context.spec.ts` 七项通过，验证普通对话和蓝图对话的"用量"名称，以及原模型额度配置与压缩流程。浏览器检查使用真实 renderer 组件和 Electron API fixture，不代表 live Electron 或所有 CLI 版本的实测。已查看 `artifacts/terminal-usage-narrow.png`。

`npm run typecheck:strict-unused`、本次修改组件和遥测文件的定向 ESLint、`npm run i18n:check`、`npm run build:check` 均通过。初次普通对话回归中的精确文案断言因新增"Usage"前缀失败，更新为确认后的名称后七项全部通过。

2026-10-22 累计口径切换验证：`npm run typecheck:strict-unused`、改动文件的定向 ESLint、`npm run i18n:check`（12 namespace 双语同步）、`npm run build:check` 均通过；`tests/unit/runtime-telemetry-history.test.ts`、`runtime-telemetry.test.ts`、`runtime-telemetry-coordinator.test.ts`、`usage-stats.test.ts` 四文件 66 项通过；`tests/e2e/terminal-usage.spec.ts` 三项通过，断言改为累计值 `8,000 / (8,000 + 10,000 + 500) = 43.2%`，并覆盖缓存读取为零时的 `0.0%`、缺失时的“–”、中英文标签与 480px 窄窗。原「允许最近命中率下降」的 renderer 合并回归已随字段移除改为累计字段的置信度与单调性断言；原四源「最近请求命中率」单测断言随之删除，缓存读写分量与总量断言保留。

`tests/e2e/janus-context.spec.ts` 有两项失败（模型目录额度断言 `1,000,000`）。已 stash 本次改动跑干净 HEAD 基线复现同样两项失败，确认为既有红灯，与本次改动无关，未修复。

未实测：live Electron 实例中真实 CLI 会话的卡片数值，以及与设置页同引擎筛选下的人工对账。e2e 使用 renderer fixture。

本次 `git stash`/`pop` 取基线时，`tests/e2e/island-harness/pane-tabs.tsx` 已被并行的终端导航工作改写，导致 `navigationFixture`/`navigationInputs`/`sessionListeners`/`readingTurns` 四处声明丢失、fixture 加载即抛错。已从 stash 原样恢复两段声明并核对四处引用与 CRLF（179/179）；`tests/e2e/terminal-navigation.spec.ts` 属该并行工作，本次未运行。并行写入期间不应以 stash 取基线。

2026-10-14 同日迭代（悬浮/卡片一致 + 布局重设计）验证：`tests/e2e/terminal-usage.spec.ts` 三项通过（断言改为按标签行取父级校验数值，并新增悬浮提示包含五项统计的一致性断言）；`tests/e2e/janus-context.spec.ts` 七项通过；遥测与 hook 单测五文件 90 项通过（含新增的 stdin BOM 解码回归）；定向 ESLint、`i18n:check`、`typecheck:strict-unused` 与 `build:check` 通过。已查看浅深两主题截图（`artifacts/terminal-usage-narrow.png` 及临时深色检查），卡片透明 + 发丝线、选中 2px 强调条、统计 2 列网格在两主题下均成立。此前"尚未确认用户当前运行实例 Codex 绑定"的遗留结论已定位并修复，见[会话源单源化](./usage-telemetry-single-source.md)的 Codex 绑定实证。
