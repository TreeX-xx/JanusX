---
{
  "schema": "harness-note/2",
  "id": "a61e849c-265d-4e35-a197-6a8b6e35f92a",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-05",
  "class": "architecture",
  "tags": ["knowledge","capture","extraction","idempotency"],
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf"
}
---

# Hook 触发的证据采集与任务上下文提取

## Problem

终端结束 Hook 可能仅包含状态，界面会话摘要又有长度限制。单事件提取容易缺少用户纠正与工具验证；服务写入失败及模型重试可能造成漏采、重复候选，来源未经绑定的摘要难以复核。持续镜像全部外部会话则需要维护改写、分叉与删除传播，超过当前按任务积累知识的需要。

## Decision

现行 Hook 仍提供终端状态和通知。个人记忆采集只接收策略允许的用户证据，工程会话中的习惯证据同时要求画像与 inferEngineeringHabits 开启。入队和重放都经过 CaptureInbox 筛选，确定性提取器不再产生项目事实。个人事实的更正与遗忘仍走来源撤回机制。下文的工程证据扩展和验证属于退役前的实现记录。

CaptureInbox 在异步处理前保存脱敏后的采集批次，逐事件复用来源 ID，成功落盘后移除待处理批次。失败保留错误与退避时间，应用装配及终端注册启动恢复；诊断提供积压数量。宿主事件 ID 或时间戳优先，缺失身份时仅能保证本次交付及本地重放的身份稳定，不能承诺识别外部客户端无身份的跨进程重复发送。

原始会话读取覆盖 Claude、Codex、Pi、Janus 文件格式与 OpenCode SQLite，使用最近轮次边界，不调用界面摘要接口。文件读取上限为 2 MiB；边界不完整、格式错误、正文尚未完成或预算不足必须报告原因。角色和工具观察分别保留；模型陈述不获得工具证据的权威级别。知识处理不持续同步外部会话文件。

TranscriptRecovery 在读取文件前将工作区、会话、轮次、完成时间、路径与脱敏提示持久化到 `processing/transcript-recovery.json`。正文尚未落盘或读取失败时，证据保留不完整状态，任务按退避时间补读；应用装配与终端注册会恢复处理。完成补读后才捕获完整证据，已解决的不完整完成事件不再生成提取任务。重复完成通知复用已捕获结果。补读记录关联原始请求与不完整事件，来源撤回会阻止恢复；`knowledge:diagnostics` 的 transcriptRecovery 返回待补读数量及最近错误。没有路径的 Hook 保留明确失败原因，宿主不猜测其他会话文件。

模型提取按工作区、会话和 Agent 隔离，任务窗口保留锚点之前的有效会话证据，早期条件不受固定轮数限制。单块证据最多 12,000 字符，长条目使用 6,000 字符片段及 500 字符重叠，窗口最多 512 片。单次提取达到 20 条、输出截断或输入超限时，宿主递归细分证据，最多八层；最终候选集合不受单次 20 条输出限制。提纯按十条候选分页，模型输入或输出超限时继续细分。调用总预算为 512 次，提取与提纯使用所选提取模型及 4,096 token 输出预算；预算耗尽保留任务与证据，不发布部分批次。

每条候选须包含准确原文引用、完整条件和来源标识。引用不连续或不匹配时，模型获得一次完整批次纠正机会；仍不匹配则转人工审核，宿主不做模糊匹配。`processing/extraction/<task-id>.json` 按输入、提示词与任务身份保存已完成调用，重启复用有效分块。显式重试清空调用缓存并保留检查记录，避免错误结果永久复用。来源或模型配置变化使用不同任务身份，旧结果不能授权新输入。

提纯输入包含候选、引用邻近原文、最终证据与相关已有知识。模型逐条保留长期知识、丢弃临时状态或被替代的建议、归并重复陈述，并返回理由。长期规则夹带测试计数或完成状态时，提纯可以清除附带内容，但必须保留长期条件、例外、数值及理由；改写结果仍绑定原始引用并经过入库审核。每条候选必须获得唯一处理结果，无效索引、等价目标或重复目标阻止整批发布。提纯前的候选及全部处理理由保存在任务记录中，不能把被过滤的条目当成从未出现。

独立覆盖调用逐块读取原始证据，核对保留条目、丢弃条目及后续纠正；空产出同样必须检查。宿主要求覆盖结果列出每个证据片段身份，拒绝缺片、非法候选身份和伪造引用。漏提或误删的长期知识会回到提纯，失效陈述会被移除并重新核验，最多三轮覆盖检查。仍不能收敛时任务保留待审原因。所有检查通过才提交完整候选集合，并在既有审计中记录条目及检查结果；覆盖调用使用提取环节所选模型，是独立请求，不是统计独立的判断来源。

候选身份基于工作区、知识类型、陈述及来源快照，独立于模型与输出顺序。完全相同的待审事实合并来源和审核上下文，并失效旧审核建议；新旧条件不同则保留审核冲突。相关知识从全部有效工程事实及待审候选中按 BM25 排序，提取输入最多容纳 6,000 字符已有知识，排序不依赖最近时间或知识类型。模型提示要求同义事实复用已有陈述，词面检索不授予自动替代权限。多次分析同一证据不增加独立确认次数。

自动审核核验完整来源哈希、角色和每条引用，并读取宿主绑定的任务上下文及同一会话后续证据。每个上下文片段与相关有效知识分页都必须通过审核；引用来自早期方案不能掩盖后续纠正。候选快照包含上下文来源，提交前复核新增、撤回、缺失或变动；模型调用中发生变化会使当前审核失效。长引用来源可展示相邻原文，其余上下文仍分块检查。只有模型来源、证据不完整或冲突时保留人工审核。Jev 与生成式审核均检查时序纠正及条件。审核通过才进入正式事实，Wiki 发布继续沿用[工程自动处理](./requirements/knowledge-accumulate-review-wiki-rereview.md)的快照与版本约束。

## Alternatives considered

维持 Hook payload 加单事件提取改动最少，也能保留实时性，但状态型结束事件无法提供答案正文与纠正上下文。

完整镜像原始会话可重建历史和重跑提取，但需要处理各终端格式、改写、压缩、分叉与删除传播。按轮次有限读取复用已有会话定位，维护边界更小。

对摘要反复归纳能降低输入成本，但多层压缩可能丢失否定、条件与数值。任务提取保留来源引用，摘要只用于组织信息。

仅复用提取器的 complete 字段调用最少，但无法观察漏提或提纯误删。独立覆盖请求增加费用与延迟，能将遗漏和时序冲突作为可重试结果。把所有证据与候选一次性交给大上下文模型实现更短，但依赖固定设备容量；分块与检查点支持不同资源预算，并保留无法自动处理的明确边界。

## Consequences

恢复账本和提纯记录占用本地存储，故障积压需要通过诊断发现；磁盘不可写时仍无法保证捕获，不能报告成功。补读不覆盖 Hook 未送达或根本没有路径的情况。会话缺少原生时间戳且重复相同请求时，延迟补读保留边界不明确原因，不猜测轮次；有时间戳时以原完成时间约束用户边界。

完整会话窗口与逐片覆盖增加推理成本，检查次数随证据片段和候选页数增长；超出明确预算的任务保留待审，不能静默截断。BM25 不能保证召回不同措辞或跨语言的同义知识，仍需通过真实漏提率、条件丢失率和重复率评测决定是否引入语义检索或更小的任务边界。独立调用仍可能重复同一模型的错误，引用存在性和模拟回归都不等于生产事实准确率。

## Verification

2026-10-06：`npm run test:unit -- --run tests/unit/knowledge tests/unit/knowledge-transcript.test.ts tests/unit/transcript-reader.test.ts tests/unit/transcript-excerpt.test.ts --maxWorkers=2 --reporter=dot`，86 个文件通过、4 个文件按条件跳过，893 项通过、5 项按条件跳过。覆盖采集、审核、知识存储、个人隔离和原始会话读取。

新增回归位于 `tests/unit/knowledge/extraction-run.test.ts`、`extraction-context.test.ts`、`transcript-recovery.test.ts`、`automation-service.test.ts` 及 `tests/unit/knowledge-transcript.test.ts`。用例验证空提取补漏、误删恢复、过期方案替换、缺片阻止、25 条知识整批提交、分页同义归并、分块中断恢复、显式重试、早期约束、旧事实检索、未引用纠正审核、重复完成去重、持久补读及来源撤回。

最终提取与审核定向验证使用 `npm run test:unit -- --run tests/unit/knowledge/automation-service.test.ts tests/unit/knowledge/extraction-run.test.ts tests/unit/knowledge/extraction-context.test.ts tests/unit/knowledge/transcript-recovery.test.ts tests/unit/knowledge/capture-extraction-pipeline.test.ts tests/unit/knowledge/knowledge-models.test.ts tests/unit/knowledge/fact-evidence-review.test.ts tests/unit/knowledge/observation-revocation.test.ts tests/unit/knowledge-transcript.test.ts --maxWorkers=2`，9 个文件、97 项通过。补读期间关闭功能的边界使用 `npm run test:unit -- --run tests/unit/knowledge/transcript-recovery.test.ts tests/unit/knowledge/agent-turn-recorder.test.ts tests/unit/knowledge/capture-extraction-pipeline.test.ts --maxWorkers=2`，3 个文件、13 项通过；关闭时保留补读任务，不捕获迟到正文。

`tests/unit/knowledge/extraction-live.test.ts` 在 `JANUSX_EXTRACTION_LIVE=1` 及 `JANUSX_EXTRACTION_CONFIG` 指定已有配置时使用真实外部模型，只发送合成证据。本次未执行真实模型评测，模拟输出的机制检查不构成生产准确率或完整率结论。

`npm run typecheck:strict-unused`、本次源文件 ESLint、`npm run build:check`、`npm run i18n:check` 与 `npm run check:package-boundary` 通过。`npm run check:notes` 校验 248 个 Note，0 个错误，27 条已有外部链接诊断；本次文件的 `git diff --check` 通过。

桌面验证设置 `NO_PROXY=127.0.0.1,localhost`、`JANUS_E2E_PORT=42783` 和 `JANUSX_DESKTOP_ENTRY=artifacts/build-check/main/index.js`，执行 `npx playwright test tests/e2e/knowledge-pipeline.spec.ts --project=desktop --workers=1`，两项通过。实际 Electron IPC 与 HTTP 模型客户端覆盖采集、提取、覆盖检查、审核、Wiki 发布、更新和撤回；模型端使用固定响应，应用使用独立临时数据根。
