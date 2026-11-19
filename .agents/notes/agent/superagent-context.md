---
{
  "schema": "harness-note/2",
  "id": "61ec1bb4-e349-4aa2-a10b-346afef29920",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-19T16:43:51Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a591e250-1719-48a5-8750-663fdb00681e" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e546b79c-cdf2-49e5-8efd-8dcf5c11b017" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e1bdfc5f-a4ff-4dea-b7e3-965ab2ffe161" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/context.ts", "symbol": "SuperAgentContext", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/context-reader.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/context-store.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/chat-tools.ts", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/workers.ts", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/superagent-context.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/llm/chat-orchestrator.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/managed-chat-session.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/llm/chat-turn-guard.test.ts", "role": "test" }
  ]
}
---

# SuperAgent 工作卡、原文召回与上下文保护

## Problem

只向 Janus 提供最近几张卡片，无法从新对话找回旧功能；直接传送全部历史又会超过模型窗口。摘要、送达回执和 Worker 报告分别说明不同事实，旧 ready 不能覆盖后来提出的约束。长工具结果还可能被原生 Codex 再次截断，导致宿主声明的页范围与模型实际收到的正文不一致。

本决策维护[实施计划](ideas/janus-superagent-mvp-plan.md)的 P5。P6 已实现[生命周期回收与明确缺失时的背景重建](superagent-lifecycle.md)，关键原文不足时停止并澄清；最终侧栏、Island 和联合验收继续由 P7–P8 完成。

## Decision

### 同一份目录、卡片与材料

`work_route.context.outcome.maxRepairRounds` 使用有界整数 schema（minimum=0、maximum=1），不使用数值 literal union，避免序列化成 Vertex/Gemini 不接受的 `enum: [0, 1]`。宿主校验仅接受数值0和1，拒绝字符串、小数、越界或缺失值，解析后的类型仍为 `0 | 1`。当前 Vertex SDK 会省略上下界，模型侧依靠字段说明，执行边界仍以宿主校验为准。该兼容修复在 janus-agentX 源码维护，通过固定制品交付；验证见[验收记录](superagent-verification.md#gemini-工具声明兼容修复2026-11-14)。

[共享上下文服务](../../../src/main/janus/superagent/context.ts)由 Janus 本地工具和 Worker MCP 共同使用。`work_list` 在当前工作区查找标题、目标、别名、相对文件引用、工作／输入／报告／执行及原生线程标识，分页覆盖全部保留记录，包括已关闭工作。候选是供 Janus 理解的材料；多候选、旧工作未找到或目标有歧义时仍由同一个 Janus 澄清，不按关键词自动定目标。

`work_read`／`read_work` 投影工作身份、当前目标与有效约束、工作／执行状态、环境、最新报告和输入来源。输入、报告、执行、约束及长约束正文有各自的范围与续读入口。创建时 checkout 的分支／HEAD 与本次只读检查结果分开；已移除或不可读环境明确显示状态。历史报告和文件引用不是当前代码证据，也不授予文件权限，Worker 必须核对实际 checkout 后再修改。

宿主事实来自持久记录，Janus 的语义解释写入独立 `context.json`，Worker 报告保留自身来源。`work_update_context` 只保存当前 Janus 已形成的目标／约束、引用输入与覆盖范围，不发起额外总结模型。写入核对工作和解释版本，约束必须引用本工作已覆盖输入；明确替代约束只改变当前解释，旧原文继续保留。解释缺失、损坏、不支持或关联失效时回退到原始输入并给诊断，不盲目覆盖原文件。

`work_route.context` 携带完整目标、有效约束、必要前文输入 ID，以及可选 coveredInputs（inputId、version）。模型分派还必须提供 outcome：确切修改对象、可观察的验收结果、单独列出的未确认建议，以及零或一次返修额度。对象仍有实质歧义时先定位或定向澄清，不能把视觉建议写成用户要求。目标与验收一起进入有效说明及 Worker 提示，沿用现有分页预算；旧记录和直接控制入口仍可读取无 outcome 的 assignment。

宿主校验来源、版本和工作关联，将说明、背景、当前输入及问题回答关联一起保存，再进入调度。约束取当前说明与仍有效旧约束的并集，漏写或改写措辞不撤销旧约束。withdrawConstraints 必须给出旧约束原文和当前用户输入中的逐字引文；宿主校验文本来源，语义上是否构成明确撤销仍由 Janus 对照原文判断。Worker 仅对该显式列表输出撤销提示。卡片、路由和 Worker 共用 effective 解析，优先 assignment、兼容旧 interpretation；缺省 coveredInputs 的旧 assignment 保持覆盖未知，不从背景或送达回执推断。已派发工作不能用 `work_update_context` 事后修改说明。

必要前文由协调器在 backgroundInputIds 中显式选择，宿主保留已关联背景。背景不创建 delivery，不改变旧输入的执行状态，也不证明当前说明已吸收它；跨对话、晚于当前指令或不可读的背景阻止派发。Worker 使用自身有界 read_work/read_resource 补读。协调器不再按最近四轮重复注入原文，普通历史中已完整可见的正文直接复用。

已验证的撤销另保留原输入身份，跨排队补充及重启持续有效；重新加入同名约束时移除该撤销。这样原生等待审批期间连续收到“撤销旧约束”和普通补充，也不会把中间撤销丢掉。新执行没有内存中的旧 brief 时，同样明确传递仍有效的撤销来源。

报告另存 `availableInputIds` 和本执行实际接收的 `assignmentRevision`；前者只确认已投递输入，后者只确认说明版本。旧记录没有字段时保持未知。两者、摘要覆盖和 delivered 都不证明语义上已纳入或已经完成，迟到旧执行报告不能声称覆盖后来执行的输入。

### 原文完整性和实际模型边界

`work_read_resource` 按工作区授权，Worker 的 `read_resource` 只按宿主能力读取本工作材料。引用使用稳定资源 ID 和 SHA-256 版本，返回 UTF-16 实际范围、正文总长、截断标志及续读参数。读取校验持久内容哈希；丢失、损坏、错误版本和越界引用分别反馈，不从摘要伪造原文。连续重复同一页返回无进展提示及续读入口，省略重复正文；压缩后的有意重读可使用 `reread`，不设置累计次数限制。

长用户输入完整持久化，最终请求组装时依据真实模型及工具占用决定是否投影，模型切换后重算。宿主按完整输入哈希或签名页／卡片，在每次实际模型请求中重建可见范围，识别跨轮历史的同版本正文。摘要只保留引用，不能冒充原文；压缩移除正文后旧范围失效，合法重读可自动恢复。签名密钥属于上下文服务实例，重启后的旧签名通过新读取恢复，持久原文仍可读。同批读取和依赖它的派发必须经过下一次模型请求；这不证明模型理解正确或已执行。

协调器取消独立 8000-token 窗口、固定四轮输入、五个候选和必要原文的 100／120-token 预览。chat-core 的 contextTokenBudget 同时供 ManagedChatSession、当前输入投影与工具输出使用，按实际模型窗口、输出预留、固定提示、工具 schema 和请求内容计算余量。并行工具在执行前分享余量，最终 JSON 与凭据也计入。目录和可选资料让位于当前输入，超过实际预算才分页或压缩；UI 历史不会因此删除。

协调器 work_read 默认 dispatch 视图，一次返回当前工作、完整有效目标／约束、未纳入原文、来源版本、实际环境和 arrangement；不复制 work.assignment。旧报告和执行流水使用 view=history 按需读取，回答报告问题时仍要求对应原文。Worker read_work 保留自身传输保护，短原文按真实余量填充，不受小预览预算压到空正文。

Janus 资源页随模型剩余空间缩小，普通材料能放下时完整返回。Worker 接收自身有界背景和原始输入引用，通过 MCP 继续读取。其模型上下文仍由原生 Codex 管理，没有另设 2000／4000 档位、六次读取或累计 12000 tokens 的额度，也没有读取配置页或记忆 Agent。

真实 Codex 0.166.0 检查发现：直接返回 48,000 字符会在原生 MCP 输出处理处再次缩短长字符串，范围字段却保持原值。现在仅在新建的 `janus_worker.read_work/read_resource` 上声明与传输匹配的原生输出上限，保留更小的既有 `tool_output_token_limit`，并以实际 JSON／UTF-8 序列化字节数缩小页正文、重算范围。没有修改用户配置文件或外部 Codex 的全会话窗口。单工具输出设置的接口依据见[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，兼容结论以真实版本和哈希验证为准。

共享 janus-agentX 的 ManagedChatSession 压缩时保留资源／工作／输入／报告身份、版本及范围，失败保持原文与原视图。摘要批次和输出按请求真实预算分配，移除 6000／2000 的固定分块。同一 1M 窗口 fixture 的摘要调用从 21 次降到 1 次，这是调用数回归，不是云模型耗时承诺。共享源码通过固定六包归档交付，node_modules 不作为修改源。

2026-11-16摘要恢复修复将摘要生成额度与压缩后的可用空间统一：摘要独立上限为模型输出上限、4096 token及实际余量的最小值，正文目标留25%余量；正常回答仍使用自己的模型输出额度。选择待压缩历史时同时核算保留内容、精确引用与摘要预留，不能只在固定占比处停止。摘要请求按独立额度预留输出、前次摘要、格式提示和纠正反馈，不受普通回答的大输出预留挤占。

摘要返回允许兼容旧字符串或携带text／finishReason。只规范化已识别的中文章节和外层Markdown围栏，不补造缺失事实；空输出、缺章节、估算超长、生成达到输出上限分别诊断。校验失败最多纠正一次，反馈具体原因并降低正文目标；截断结果即使含必需标题也不提交。全部批次验证通过后才保存检查点，后续失败保留上次成功检查点、原消息和精确引用，取消不再继续请求。若必要内容和引用仍无法留出最小摘要空间，直接报告输入预算、保留内容、引用与摘要余量，不重复请求或暗中删除材料。

桌面聊天与原生插件Agent均传递摘要专用输出额度和结束原因。交付基于原固定构建1f045892a8b95cce，仅覆盖chat-core的managed-chat-session、chat-session-runtime及新增compaction-summary编译产物；其余包只更新统一版本与内部依赖。当前固定构建为d61fe00183e9ffdb，变更及基底清单在`artifacts/compaction-recovery/engine-overlay.json`，没有把相邻引擎工作区的其他未完成修改纳入运行包。

## Alternatives considered

- 继续传送全部输入和历史：实现少，但长消息和原生二次截断会造成缺失不可见。采用完整持久化、按职责投影与可续读原文。
- 独立记忆 Agent、向量库和读取配额：增加总结延迟、模型调用及配置负担。首版使用现有 Janus 解释、确定性目录和已有窗口保护。
- 在工具返回时直接认定已读：同批读／写尚未把正文交给模型。采用实际请求中的完整输入哈希与签名页校验，压缩后重建可见范围。
- 提高 Codex 全局输出和上下文设置：会影响用户其他工作，仍不能保证正文范围正确。只校准本桥读取工具，保留原生全会话管理。

## Consequences

本轮消费端固定包为 `6312b33e4d953071`，六包安装哈希、严格类型、包边界、定向 ESLint 和 artifacts/build-check 构建通过。共享核心分别通过 392（另 1 skip）、68、225 项测试；消费端 61 项单元、33 项集成以及最终包 21 项定向复跑通过，分组有重叠，不相加为整仓统计。完整命令与日志索引见[统一方案](ideas/superagent-context-simplification.md#implementation-and-verification)。

最终构建的 Electron 专项 `desktop-superagent.spec.ts -g 'context budget'` 通过，使用临时 Git、隔离配置、真实 Codex 及 localhost 模型协议。超过旧 8k-token 预算的长输入为 2 次模型请求、1 次 work_route、0 次 work_read_resource；随后各次继续均为 work_read → work_route，未单独补读原文。还验证历史只读、普通讨论、停止、退出不重放和显式继续后恢复。日志为 artifacts/superagent-context-e2e-focused.log，脱敏调用轨迹在 artifacts/superagent-p7/desktop-calls.json。该结果不代表云模型语义质量或线上耗时。

最终包的 `npm run test:integration -- tests/unit/superagent-native.test.ts --maxWorkers=1` 通过 1 项真实 Codex／Electron MCP 专项：检查模型可见原文分页及重组哈希、编辑汇报、闲置回收、线程恢复、缺失历史重建和后台进程终止。使用 JANUS_SUPERAGENT_CODEX_BINARY 选择本机原生程序，JANUS_SUPERAGENT_EVIDENCE_DIR 指向 artifacts/superagent-context-native；日志为 artifacts/superagent-context-native-final.log，模型响应仍来自 localhost fixture。

旧综合导航用例仍在通知跳转后的草稿恢复断言失败，原断言保留；本次没有改动导航和草稿持久化。UI 字符输入限制仍与模型窗口分开，不能把 1M 窗口理解成单次编辑器粘贴容量。正在运行的安装版未替换，整仓 verify 与独立 Agent 审计未运行。

2026-11-12 统一优化已实施：修复 assignment 与旧 interpretation 补读集合不一致、背景误作覆盖和跨轮证据丢失；加入只读并行、批次预算、结构化版本／材料缺口和未知副作用回执。arrangement 从既有 action、delivery、schedule 生成，不新增账本。context_diagnostic 沿既有事件流存入 timeline，记录请求序号、调用身份、预算、资源版本／范围和耗时，不复制正文。原始耗时及 Codex 固定源码证据归[分析记录](ideas/superagent-harness-reliability.md#协调器上下文与少轮派发codex-cli-参考待实施)，实施和验证边界归[统一方案](ideas/superagent-context-simplification.md)。

2026-11-11 修复验证：消费端固定引擎 `ac17208122f89282`，六包归档与安装字节通过 prepackage 校验。引擎 dispatch-context／worker-report／worker-prompt 共 10 项通过；消费端 context／store／worker-mcp 共 23 项通过。routing 原有 9 项通过，新增“说明保存失败不启动”和“短句带前文、问题回答幂等续接”2 项通过；浏览器原有 26 项、新增问题回答／待答区恢复／问题详情折叠 3 项分阶段通过，非一次整仓测试。日志为 `artifacts/question-context-*.log`，已查看 `artifacts/superagent-hifi/question-*.png`。严格类型、定向 ESLint、双语、build:check、相关 diff 检查通过；Notes 340 篇、0 errors、保留 17 条既有外链提示。未运行真实云模型语义验证，未修改用户当前报告或自动续接实际 Worker；构建在 artifacts/build-check，运行应用与 out 尚未替换。

P5 已形成可查询、可分页、可恢复来源的上下文链路，原始输入／报告和核心关联不自动过期，可选原生日志仍沿用 P3 的独立限量。语义解释质量与歧义处理依赖当前 Janus；宿主验证来源、范围和状态，不能证明任意生产模型的理解准确性。Worker 编辑前读取和代码核对由原生工具及协作约定执行，不冒充独立质量验收或原生 Shell 的语义强制门。

历史解释仍在独立文件中；执行所需的新 assignment 与输入关联使用同一次记录提交，保存失败不能启动 Worker。调度回执未知时不自动重放。目录和解释目前仍是本地 JSON 投影，数据量显著增长后再评估索引和存储成本，不提前引入服务。

验证覆盖新会话找回首屏外已关闭工作、别名／代码和原生引用、原始需求与报告、长输入超过六次续读、同批读派发阻止、晚到约束和报告、显式替代约束、缺失／损坏／跨范围材料、重复页、真实 Git 分支／HEAD 和实际模型上下文压缩。真实 Electron 场景检查长输入先读后派发、开发写入、历史只读、同工作继续及停止；原生专项对 95 KB 原文的模型可见页重组后校验哈希，并检查原生回答、同线程恢复与后台进程停止。两者使用临时 Git、隔离配置及 localhost 模型响应，不代表生产供应商的语义质量或其他平台已验收。

复现入口为 `tests/unit/superagent-context*.test.ts`、`superagent-routing.test.ts`、`superagent-workers.test.ts`、`superagent-native.test.ts`、`tests/e2e/desktop-superagent.spec.ts` 和共享 `packages/chat-core/tests/managed-resource-compaction.test.ts`。原生检查需要 `JANUS_SUPERAGENT_CODEX_BINARY` 与当前构建的 `worker-mcp.js`；桌面检查使用 `out/main/index.js`。本机诊断和截图位于忽略目录 `artifacts/superagent-p5`，稳定事实由本决策与实施计划维护。完整 MVP 的固定 AC 仍待 P8 联合验收。

2026-11-06 收口结果：主仓 13 个定向测试文件共 116 项通过，包含新增上下文与并发补充重试、原有存储／调度／Worker／IPC／MCP、聊天端口和真实原生权限回归；共享核心的压缩与会话运行时 36 项通过。最新应用构建上的 Electron 场景 1 项通过。严格未使用项类型检查、相关源码 ESLint、应用及共享包构建均通过；未运行整个仓库的 `npm run verify`。Notes 检查主仓 333 份、共享仓 71 份均为零错误，分别保留 17／9 条既有跨仓库引用诊断。

主仓测试使用 `npx vitest run` 指定上述相关文件并加 `--maxWorkers=1`；桌面复现命令为 `npm run test:e2e:desktop -- tests/e2e/desktop-superagent.spec.ts`。构建／类型／文档入口分别为 `npm run build:app`、`npm run typecheck:strict-unused`、`npm run check:notes`；共享文档校验为在 janus-agentX 执行 `node scripts/verify-note-corpus.mjs`。Windows 原生与桌面测试串行运行；此前并行检查超时的诊断保留在本机产物目录，最终结果以上述完整断言通过为准。
