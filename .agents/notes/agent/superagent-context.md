---
{
  "schema": "harness-note/2",
  "id": "61ec1bb4-e349-4aa2-a10b-346afef29920",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-06",
  "updated": "2026-11-06T06:13:35.296Z",
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
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/workers.ts", "role": "entry" }
  ]
}
---

# SuperAgent 工作卡、原文召回与上下文保护

## Problem

只向 Janus 提供最近几张卡片，无法从新对话找回旧功能；直接传送全部历史又会超过模型窗口。摘要、送达回执和 Worker 报告分别说明不同事实，旧 ready 不能覆盖后来提出的约束。长工具结果还可能被原生 Codex 再次截断，导致宿主声明的页范围与模型实际收到的正文不一致。

本决策维护[实施计划](ideas/janus-superagent-mvp-plan.md)的 P5。P6 已实现[生命周期回收与明确缺失时的背景重建](superagent-lifecycle.md)，关键原文不足时停止并澄清；最终侧栏、Island 和联合验收继续由 P7–P8 完成。

## Decision

### 同一份目录、卡片与材料

[共享上下文服务](../../../src/main/janus/superagent/context.ts)由 Janus 本地工具和 Worker MCP 共同使用。`work_list` 在当前工作区查找标题、目标、别名、相对文件引用、工作／输入／报告／执行及原生线程标识，分页覆盖全部保留记录，包括已关闭工作。候选是供 Janus 理解的材料；多候选、旧工作未找到或目标有歧义时仍由同一个 Janus 澄清，不按关键词自动定目标。

`work_read`／`read_work` 投影工作身份、当前目标与有效约束、工作／执行状态、环境、最新报告和输入来源。输入、报告、执行、约束及长约束正文有各自的范围与续读入口。创建时 checkout 的分支／HEAD 与本次只读检查结果分开；已移除或不可读环境明确显示状态。历史报告和文件引用不是当前代码证据，也不授予文件权限，Worker 必须核对实际 checkout 后再修改。

宿主事实来自持久记录，Janus 的语义解释写入独立 `context.json`，Worker 报告保留自身来源。`work_update_context` 只保存当前 Janus 已形成的目标／约束、引用输入与覆盖范围，不发起额外总结模型。写入核对工作和解释版本，约束必须引用本工作已覆盖输入；明确替代约束只改变当前解释，旧原文继续保留。解释缺失、损坏、不支持或关联失效时回退到原始输入并给诊断，不盲目覆盖原文件。

新输入先持久接收并按正常分派通路投递，不等待上述解释更新。卡片始终显露解释尚未覆盖的原始补充。报告另存 `availableInputIds`，只确认报告保存时已送达该 execution 的输入关联；旧记录没有该字段时显示覆盖未知，其他历史引用也可能可读，不能反推未列输入不存在。该字段、摘要覆盖和 delivered 都不证明语义上已纳入或已经完成。迟到旧执行报告不能声称覆盖后来执行的输入。

### 原文完整性和实际模型边界

`work_read_resource` 按工作区授权，Worker 的 `read_resource` 只按宿主能力读取本工作材料。引用使用稳定资源 ID 和 SHA-256 版本，返回 UTF-16 实际范围、正文总长、截断标志及续读参数。读取校验持久内容哈希；丢失、损坏、错误版本和越界引用分别反馈，不从摘要伪造原文。连续重复同一页返回无进展提示及续读入口，省略重复正文；压缩后的有意重读可使用 `reread`，不设置累计次数限制。

长用户输入完整保存在资源目录，进入模型时才使用有界预览。Janus 侧记录宿主发出的页和卡片凭据，直到完整结果出现在后续模型请求中才计入读取范围；同一批工具中的“读取后立即派发”不能绕过。相同补充消息的并发重试复用原投影和读取凭据，原文冲突仍拒绝，避免随机凭据让幂等重试被误判为不同消息。继续旧工作要求看过当前版本的卡片，未覆盖原文或被截断的关键解释须补读；关键引用缺失则阻止依赖它的派发，停止／关闭仍走控制通路。这证明材料已进入模型请求，不声称模型理解正确或已经执行。

业务 Inline 以约 8000 tokens、近期四轮输入和首屏最多五个候选为起点，先保留当前输入与控制规则、近期相关工作的目标／约束及未覆盖补充，再放候选和历史预览。可变 N 的运行状态按计数汇总，明细继续查询。软目标约束业务投影，普通聊天历史仍由既有 `ManagedChatSession` 管理；实际模型窗口、工具 schema 和输出预留决定可用空间，不删除 UI 历史伪装压缩。

Janus 资源页随模型剩余空间缩小，普通材料能放下时完整返回。Worker 接收自身有界背景和原始输入引用，通过 MCP 继续读取。其模型上下文仍由原生 Codex 管理，没有另设 2000／4000 档位、六次读取或累计 12000 tokens 的额度，也没有读取配置页或记忆 Agent。

真实 Codex 0.166.0 检查发现：直接返回 48,000 字符会在原生 MCP 输出处理处再次缩短长字符串，范围字段却保持原值。现在仅在新建的 `janus_worker.read_work/read_resource` 上声明与传输匹配的原生输出上限，保留更小的既有 `tool_output_token_limit`，并以实际 JSON／UTF-8 序列化字节数缩小页正文、重算范围。没有修改用户配置文件或外部 Codex 的全会话窗口。单工具输出设置的接口依据见[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，兼容结论以真实版本和哈希验证为准。

共享 `janus-agentX` 的 `ManagedChatSession` 在实际压缩时保留资源／工作／输入／报告标识、版本及范围，正文移出模型上下文后仍可续读。共享源码与测试一同维护，本仓库的本地 file 依赖同步对应构建文件；后续重新安装依赖须包含这项共享源码变更。

## Alternatives considered

- 继续传送全部输入和历史：实现少，但长消息和原生二次截断会造成缺失不可见。采用完整持久化、按职责投影与可续读原文。
- 独立记忆 Agent、向量库和读取配额：增加总结延迟、模型调用及配置负担。首版使用现有 Janus 解释、确定性目录和已有窗口保护。
- 在工具返回时直接认定已读：同一批读／写工具可能尚未把正文交给模型。采用本轮宿主凭据与后续模型请求中的实际范围核对。
- 提高 Codex 全局输出和上下文设置：会影响用户其他工作，仍不能保证正文范围正确。只校准本桥读取工具，保留原生全会话管理。

## Consequences

P5 已形成可查询、可分页、可恢复来源的上下文链路，原始输入／报告和核心关联不自动过期，可选原生日志仍沿用 P3 的独立限量。语义解释质量与歧义处理依赖当前 Janus；宿主验证来源、范围和状态，不能证明任意生产模型的理解准确性。Worker 编辑前读取和代码核对由原生工具及协作约定执行，不冒充独立质量验收或原生 Shell 的语义强制门。

解释文件与记录分别原子写入，允许语义更新滞后；失效解释回退原文，因此不会静默隐藏新要求。目录和解释目前仍是本地 JSON 投影，数据量显著增长后再评估索引和存储成本，不提前引入服务。

验证覆盖新会话找回首屏外已关闭工作、别名／代码和原生引用、原始需求与报告、长输入超过六次续读、同批读派发阻止、晚到约束和报告、显式替代约束、缺失／损坏／跨范围材料、重复页、真实 Git 分支／HEAD 和实际模型上下文压缩。真实 Electron 场景检查长输入先读后派发、开发写入、历史只读、同工作继续及停止；原生专项对 95 KB 原文的模型可见页重组后校验哈希，并检查原生回答、同线程恢复与后台进程停止。两者使用临时 Git、隔离配置及 localhost 模型响应，不代表生产供应商的语义质量或其他平台已验收。

复现入口为 `tests/unit/superagent-context*.test.ts`、`superagent-routing.test.ts`、`superagent-workers.test.ts`、`superagent-native.test.ts`、`tests/e2e/desktop-superagent.spec.ts` 和共享 `packages/chat-core/tests/managed-resource-compaction.test.ts`。原生检查需要 `JANUS_SUPERAGENT_CODEX_BINARY` 与当前构建的 `worker-mcp.js`；桌面检查使用 `out/main/index.js`。本机诊断和截图位于忽略目录 `artifacts/superagent-p5`，稳定事实由本决策与实施计划维护。完整 MVP 的固定 AC 仍待 P8 联合验收。

2026-11-06 收口结果：主仓 13 个定向测试文件共 116 项通过，包含新增上下文与并发补充重试、原有存储／调度／Worker／IPC／MCP、聊天端口和真实原生权限回归；共享核心的压缩与会话运行时 36 项通过。最新应用构建上的 Electron 场景 1 项通过。严格未使用项类型检查、相关源码 ESLint、应用及共享包构建均通过；未运行整个仓库的 `npm run verify`。Notes 检查主仓 333 份、共享仓 71 份均为零错误，分别保留 17／9 条既有跨仓库引用诊断。

主仓测试使用 `npx vitest run` 指定上述相关文件并加 `--maxWorkers=1`；桌面复现命令为 `npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-superagent.spec.ts`。构建／类型／文档入口分别为 `npm run build:app`、`npm run typecheck:strict-unused`、`npm run check:notes`；共享文档校验为在 janus-agentX 执行 `node scripts/verify-note-corpus.mjs`。Windows 原生与桌面测试串行运行；此前并行检查超时的诊断保留在本机产物目录，最终结果以上述完整断言通过为准。
