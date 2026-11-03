---
{
  "schema": "harness-note/2",
  "id": "241cfe30-fca9-40db-955f-8747b797c885",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-10-05",
  "class": "feature",
  "tags": ["telemetry","usage-stats","terminal"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/61b5d05c-e1ad-4f7a-a3e9-57982fb78c4e",
  "updated": "2026-11-03T09:51:53Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 用量统计自定义日期与明细展示

## Problem

设置用量视图只支持今日、本周、本月三档预设，`src/renderer/src/lib/usage-stats.ts` 的 `UsageRange` 与 `rangeStartFor` 均无起止日期概念，`src/renderer/src/components/UsageStatsPanel.tsx` 的 `RANGES` 硬编码三个按钮。用户无法回看任意日期区间，跨月对账与活动复盘均被阻塞。

展示维度不足以支撑成本判断。`aggregateUsageStats` 已经按 preset 累加 `inputTokens` 与 `outputTokens`，`TimeBucket.output` 与趋势图第四条 `output` 曲线也已落地，但汇总区只展合计与缓存命中率，整体环形只按 `row.totalTokens` 切终端占比，底部分组每行只展合计与命中率。`row.inputTokens` 与 `row.outputTokens` 算出后即被丢弃，用户看不到输出侧消耗。

类型与范围切换为硬切。`OverallDonut` 与 `CacheDonut` 直接重算 `strokeDasharray`，`TrendLines` 对 `path d` 直接重算，且外层以 `key={activeType-range}` 强制整图卸载重建，`activeIndex` 清零。`UsageStatsPanel.module.css` 仅按钮有 120ms 过渡，SVG 无任何过渡，切换时数字与曲线同步闪变。

## Expected behavior

设置用量视图支持自定义起止日期，输入输出拆分进入汇总与分组展示，类型与范围切换具备克制的过渡动效，且 DSH 缺数状态保持可解释。

- 自定义日期接受本地起止日历输入，起止均含当日，非法区间（开始晚于结束、未来日期、跨度超限）拒绝并提示，不发起聚合。
- 自定义区间与三预设共用同一终端类型筛选，两个环形、趋势图与底部分组随所选区间一起切换。
- 汇总区在合计之外展示输入与输出拆分，底部明细按终端类型与模型分别展示总量、新鲜输入、输出和命中率，输出曲线保留在趋势图中并可读数。
- DSH 在无解码能力前一律显示未知，不以零值冒充真实用量，自定义区间与明细列均不为例外。
- 过渡动效覆盖环形占比变化与曲线形状变化，`prefers-reduced-motion` 下退化为即时切换，键盘聚焦读数行为不变。
- 空状态直接呈现空表（底部时间轴与 token 轴保留，全零时只画基线并居中水印），图例为可点选的曲线筛选器（有数据时同样可用），汇总卡置灰而非藏起。
- 时间范围与终端类型两组切换均采用与 LLM 引擎 `terminalTabs` 一致的下划线 tab。

## Scope

In scope：`usage-stats.ts` 的自定义区间类型、起止边界、分桶策略与聚合复用，`UsageStatsPanel` 的日期输入、输入输出展示列、环形与曲线的过渡实现，`settings.json` 中英文文案，对应单测与 e2e。

Out of scope：`session.v4.jsonl.zstd` 解码、pid 到会话挂载匹配、无 hook 自动绑定、dsh 成功结束与审批与数值解析在无样本时落地、历史增量账本的持久化采样。后者为自定义区间的长期解法，本需求仅以前端过滤口径交付，并在文案中明示快照口径。

当前统计源已由[会话源单源化](./usage-telemetry-single-source.md)切换为持久账本，保留本文的日期、输入输出和交互要求；事件时间与采样时间的口径说明仅保留在开发文档。累计差分跨日区间仍不能宣称为精确逐日消耗；下文快照算法及 AC-1 至 AC-4 属于原阶段交付记录，新账本契约与验证以单源化 Note 为准。

### 当前展示布局

总计、输入输出和缓存命中率合并为一个紧凑汇总容器，输入输出各展示一次，减少重复数字与卡片留白。输入使用蓝色、输出使用橙色，数值、比例条和明细列保持对应；输出趋势曲线也沿用输出色。

终端类型使用统计页专属色板，总计环形、图例与明细表保持同色对应，环形分段留小间隙。色板按主题的浅深色基底切换，不改动应用中的终端品牌色。

汇总容器宽于 680px 时为三列；不超过 680px 时总计占首行、输入输出与缓存占第二行；不超过 360px 时纵向排列。

模型明细由 `UsageModelBreakdown` 展示，与汇总共享筛选、账本去重和加载快照。按 `(engine, model)` 聚合，未知模型单列，不把同名模型跨引擎合并。每组按会话身份去重；会话切换模型会出现在多个模型行，汇总会话数仍按引擎内会话去重，不能相加模型行会话数。默认按总 Tokens 降序，同量时按组键稳定排序。

明细使用统一表头，模型名为主信息，终端类型和会话数为次级信息；数字右对齐，总量附当前筛选范围内占比。展开按钮支持键盘并提供展开状态，详情显示完整计数及缓存读取、写入。容器不超过 680px 时隐藏主表输入输出列，仍可从详情查看；窄屏详情采用两列，长模型名允许换行。

设置页与终端详情共用 `formatUsageRate`，缓存命中率固定一位小数，明细悬浮与展开详情提供两位小数。计算仍为缓存读取 /（缓存读取 + 新鲜输入 + 缓存写入），输出不入分母；未改变账本与总量口径。缓存读取字段缺失时显示 `–`，部分记录缺失与全部缺失使用不同提示，明确零命中显示 `0.0%`。缓存写入未完整报告时，详情不把已知部分的和当作完整值，而显示 `–` 并说明命中率沿用已记录的输入侧计数；历史未知分项不反推或回填。

## Proposal

自定义区间以前端过滤口径先行，不改遥测合并语义。`UsageRange` 新增 `custom` 分支并附带 `rangeStart/rangeEnd` 入参，`bucketKeysFor` 按跨度动态分桶（短跨度按小时，长跨度按日或周），`aggregateUsageStats` 在现有 `observedAt < rangeStart` 之外增加 `observedAt > rangeEnd` 拒绝。日期输入采用原生 date 输入加本地时区换算，保持无图表依赖。

明细展示复用已聚合字段，不新增终端私有协议解析。汇总与分组直接读取 `view.inputTokens/view.outputTokens` 与 `row.inputTokens/row.outputTokens`，缓存命中口径保持 `cacheSplitFor` 的输入侧定义不变，输出不计入命中与未命中。

动效去掉 `TrendLines` 的强制重挂载 `key`，改为受控更新，环形以 `stroke-dasharray/offset` 过渡、曲线以受控插值或淡变过渡，时长控制在 200ms 内。

## Alternatives considered

- Do nothing：维持三预设与合计展示，零成本，但日期回看与输出成本判断继续缺失，终端增多后缺口放大。
- 自定义区间连同历史增量账本一起做：可给出真正的逐日新增消耗，代价是新增持久化采样、有界读取与幂等去重，投入大且需先确认 schema，本需求先以快照过滤交付并明示口径，账本另立需求。
- 引入图表库做动画与日期选择：开发快，但打破现有无依赖 SVG 与键盘聚焦实现，增加包体积与主题适配成本，否决。
- 输出计入缓存命中分母：将输出混入 `cacheSplitFor` 可让单环形同时表达两件事，代价是混淆输入侧缓存语义，否决，输出独立展示。

## Acceptance criteria

- [x] AC-1: 自定义起止日期可选择并驱动聚合，非法区间被拒绝并提示，三预设行为不变。`tests/unit/usage-stats.test.ts` 覆盖起止边界与分桶，`tests/e2e/usage-stats.spec.ts` 覆盖日期切换与空状态。
- [x] AC-2: 汇总区与底部分组展示输入与输出拆分，数值与 `aggregateUsageStats` 的 `inputTokens/outputTokens` 一致，缓存命中率口径不变。
- [x] AC-3: 切换终端类型与时间范围时环形与曲线具备过渡效果，`prefers-reduced-motion` 下为即时切换，键盘聚焦读数与悬停行为不变。
- [x] AC-4: DSH 在自定义区间与明细列中无真实用量时显示未知，不显示 0 或 0%，不参与输出合计的虚假拉低。
- [x] AC-5: 汇总区减少重复展示，输入输出并排且配色与比例条一致；浅深色主题下终端类型可区分，480px 与 1000px 窗口下布局紧凑且无横向溢出。

## Risks

当前聚合读取持久账本，时间精度边界以单源化 Note 为准；按用户要求不在界面展示时间口径说明。覆盖范围、采集异常及未知值仍需可见。过渡动效需避免与键盘聚焦冲突，大时间范围仍走按需计算；颜色之外保留名称和数值，避免只靠颜色识别。

DSH 真实用量缺失为硬限制，来源见 [DSH 接入决策](../dsh-terminal-integration.md) 与 [DSH 信号与日志补全需求](./dsh-telemetry-completion.md)：`session.v4.jsonl.zstd` 无解码器，不能据此报告真实用量；conpty 中间层 pid 与 `session-mounts.json` 内层 pid 不一致，不能据 pid 自动绑定；无 hook 且无外部 `sessionId` 时扫描不生效。任何展示细化均不得将缺失数值或启动零值当作真实用量，DSH 在自定义区间与明细列中保持未知态。

## Validation evidence

2026-11-03：`npx vitest run tests/unit/usage-stats.test.ts tests/unit/usage-stats-loading.test.ts --maxWorkers=2 --reporter=dot` 两文件 27 项通过，覆盖模型/引擎分组、同会话切换模型、去重、日期筛选、缓存缺失与小数精度，以及筛选加载过渡。`npx playwright test tests/e2e/usage-stats.spec.ts --project=island --workers=1 --timeout=60000` 六项通过；同参数下 `terminal-usage.spec.ts` 三项通过。首轮并发冷加载有四项在导航阶段超时，串行重跑通过；明细测试的部分缺失文案匹配修正后通过。截图检查发现并修复窄屏展开时隐藏表格列占位的问题，并补充末列与表格右边界对齐断言。人工查看宽屏及窄屏深浅主题截图，360px/480px 不横向溢出；测试使用 fixture，未实测运行中的 Electron 账本。

普通类型检查、中英文文案检查通过；定向 ESLint 无错误，保留 `UsageStatsPanel` 已有 `customRange` effect 依赖警告。Note 校验通过，17 条既有跨仓库链接诊断未在本次处理。

2026-10-13：`tests/e2e/usage-stats.spec.ts` 三项通过，覆盖日期与类型筛选、键盘读数、未知态、480px 窄窗口无溢出，以及浅深色主题下四种已支持引擎的颜色区分和输入输出比例条配色。汇总区在 480px 窗口下高度小于 240px，在 1000px 窗口下小于 150px；输入输出数值保持同一行。已检查对应宽窄窗口及浅深色截图，严格类型检查和组件 ESLint 通过。
