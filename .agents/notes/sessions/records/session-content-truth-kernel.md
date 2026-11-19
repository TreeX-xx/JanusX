---
{
  "schema": "harness-note/2",
  "id": "bfb75f46-e26d-4e35-b25c-6e6e0c7f4638",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-10",
  "class": "feature",
  "tags": ["session","transcript"],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/7cc69d43-fa82-4b5e-9ac1-fe32fa4f0d5f"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/36a4c7d5-fc0f-4436-9fc0-f925ef8fc4f7"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/fc8ba315-f289-423c-babc-2b048bc2726b"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/bc53c6cc-29fb-59db-a0cf-1e32eaf2fc0a"}
  ],
  "updated": "2026-11-11T04:21:31Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935"
}
---

# 统一转录解析内核、一问一回合与身份合并

## Problem

会话解析在扫描器、详情读取、摘要提取三处各写一套记录提取：Codex `event_msg` 镜像双计、agentic 多步拆回合、sidechain/`isMeta`/compact 摘要污染首问与计数、多块文本无分隔拼接、窗口读取跨缺口虚构问答、渲染按索引合并错挂 prompt。身份层把同一对话裂成两张卡（Codex `thread_id` 被 Windows hook 白名单丢弃、provider id 晚到不合并），workspace scope 子串判定串相邻目录，continue/resume 的双 createSession 与 Stop+SessionEnd 双终结各产生幻影记录。

## Decision

Codex 指令头同时识别 `# AGENTS.md instructions for <path>` 和无路径、直接换行的 `# AGENTS.md instructions`（包括 CRLF 与文件结尾），且必须结束标题行，避免吞掉讨论 AGENTS.md 的普通句子。无 metadata 的记录继续按正文判别，兼容旧版真实提问；不能一律视为注入。加载 Codex 旧账本时清空注入形 firstPrompt/lastPrompt 并持久化，保留原回合与身份，再由重扫补回真实首问。原转录缺失时首问保持空值，界面使用默认标题，不从后续提问猜测首问。

会话概括独立于 firstPrompt：扫描读取 Codex 同配置根的 `session_index.jsonl` 中 `thread_name`、Claude 的 `custom-title`/`ai-title`（自定义优先）、Pi 的 `session_info.name` 和 OpenCode session.title，存入独立 title 字段。Codex 索引每次扫描重读，转录缓存不阻止单独改名同步。账本摘要按新鲜度选取转录预览或 Hook 回合的最近问答作为 conversationPreview，排除注入形正文；卡片和详情标题使用提供方 title，缺失时使用引擎名，卡片另显示最近讨论预览。firstPrompt 仍保留在详情，不再用其截取内容充当概括；本路径不额外调用模型。

新增 `src/main/sessions/transcript-kernel.ts` 作为唯一记录分类内核：text 类块提取（工具与 thinking 天然排除）、多块换行拼接、Claude `isMeta`/`isSidechain`/`isCompactSummary` 与运行时通知排除、Codex `response_item` 源记录优先且镜像仅在无源记录的旧文件保留、用户文本过滤 `<command-name>`/`[Request interrupted by user]`/`<system-reminder>` 包装。Codex 真实输入以记录元数据判别：任何非空 `metadata`（`user_input_order`、`retained_source`、`client_authored`、`fallback_token_limit_override` 等）标记真实记录，空元数据 user 记录在存在标记记录的文件里视为环境注入丢弃；旧版无元数据记录回退内容判据（`# AGENTS.md instructions for`、`<ENVIRONMENT_CONTEXT>`、`<user_instructions>`、`<INSTRUCTIONS>` 前缀）。存量愈合：`importExternalSession` 重扫时对外部行按转录真值刷新错误首问（含种子回合与 lastPrompt），hook 行仅愈合空/注入形标题，不动已录回合。`external-session-scanner` 复用并 re-export 原有提取器（knowledge-transcript 导入路径不变），扫描与详情读取共用 `segmentTurns`：窗口读取按 head/tail 分段配对，缺口两侧不虚构问答。回合语义统一为一条用户提问一回合，连续 assistant 记录归并为同一回复，各引擎 turnCount 同口径。

身份与归属：Windows hook 白名单与 hook client 透传 `thread_id`/`threadId`（Codex 的 provider 身份）；hook 行在 `noteProviderSession` 学到 provider id 时吸收既有外部行（firstPrompt/transcriptPath/turns 合并、单卡），导入按 `engine+providerSessionId` 主匹配、transcript 路径次匹配；workspace scope 只做归一化路径的相等或边界前缀判定；重扫重算 turnCount 而非只增；外部行种子拆成问、答两条独立回合，不再混成一对。渲染侧 `session-turn-merge.ts` 纯函数按尾对齐合并：账本保 kind/检查点/时间，转录只补正文，多余的早期转录回合前置为正文回合。回合终结只关闭已开启回合（hook 开回合或 submit 待决），Stop 与 SessionEnd 重复终结不再产生幻影回合。

## Alternatives considered

- 把内核放进 knowledge-transcript 复用其 parse — 最强理由是零重复规则。排除原因：知识管线的证据模型（tool 证据、回合选取预算）与显示管线诉求不同，耦合会互相拖累；以提取器共享加口径测试保持一致更稳。
- 镜像逐文件判定改为无条件排除 event_msg — 最强理由是与知识口径完全一致。排除原因：旧 Codex 文件只有 event_msg 时会显示空对话；镜像仅在无源记录时保留是明确的兼容退化，fixture 锁定。
- 渲染继续按索引合并加启发式修正 — 最强理由是改动最小。排除原因：配对错位是结构性的，尾对齐合并把身份与正文职责分开，规则可测。
- 回合终结去重放在 registry.recordTurnEnd 内 — 最强理由是调用方不动。排除原因：registry 无法区分「有意的无 prompt 回合」与重复终结；开启回合的语义只有 hook 层的 tracker 与 submit 待决知道。
- 种子回合保持问/答混合单条 — 最强理由是旧行形状不变。排除原因：预览把首问和末答读成一次问答，正是解析症状之一。

## Consequences

本次无路径指令头与概括展示回归：7 个相关单元套件 104/104 通过，覆盖无/空/非空 metadata、LF/CRLF、普通提问不误删、缺失转录的持久化清理、Hook/外部行愈合、原生标题与首问分离、Claude 自定义标题优先，以及 Codex 仅索引改名时同步。触达源码 eslint 与 `npm run typecheck` 通过。Playwright 会话卡片套件 4/4 通过，验证概括与最近讨论呈现、首问保留在详情、标题搜索，以及原有延迟加载、分页和展开行为。原生标题依赖提供方是否写入元数据；没有标题时仅提供最近讨论预览，不将其宣称为生成摘要。

- **Gains**: 卡片首问与回合数反映真实对话；L3 显示用户输入全文与 Agent 文本回复全文；Codex 计数不再翻倍；同一对话单卡归属正确工作区；重复终结无幻影回合。
- **Costs and limits**: 窗口文件的 turnCount 是可见下限（缺口中段不可见），超大单条正文按 200k 上限截断并带省略号；AC-4 的活界面显示未在 Electron 里人工演练，仅由数据层与渲染合并测试覆盖；`recordTurnEnd` 仍无条件写入，去重依赖 hook 层开回合判定；`typecheck:strict-unused` 有一处与本切片无关的既有报错（`src/main/janus/maintenance/service.ts` 未使用导入，属工作区未提交改动）。
- **Verification**: `npm run typecheck` 干净；`npm run typecheck:strict-unused` 仅上述既有报错；触达源文件 eslint 0 问题；`npm run i18n:check` 12 命名空间同步；`npx vitest run` 通过 transcript-kernel 7、session-turn-merge 5、transcript-reader 8、external-session-scanner 9、agent-session-registry 18（含新增双卡合并/重算/scope 测试）、knowledge-transcript、opencode-sessions、transcript-excerpt、agent-engine-capabilities、remaining-ipc-contract、worktree-store、session-continue-resume、agent-hook-config（含 thread_id 透传断言）、turn-change-tracker（含 hasActiveTurn）、agent-hook-shell、opencode-hook-plugin、pi-hook-extension 全绿；全量 tests/unit 2837 通过，7 个失败文件（blueprint-graph-controller、file-tree-git-ignore、janus-ipc-contract、memory-review-ui、llm/chat-turn-guard、knowledge/local-resources、office/workspace-watcher）均不导入本切片模块，属工作区既有未提交改动。后续切片补 codex 环境注入过滤与两处 UI：transcript-kernel 增 2 项注入用例（9/9），external-session-scanner 的 codex fixture 前置 AGENTS.md 注入记录仍解析出真实首问，planche-theme 钉选 `.foldBtn` 无边框，L2 首问 4 行 clamp 加 160 字符预算与展开/收起入口（Copy 全文不截断），触达套件 77/77。定位回归（用户实测首问仍为 AGENTS.md）：对真实 `~/.codex/sessions` 六个 rollout 复跑解析，首问全部正确、注入全部丢弃，症状确认为存量行未愈合；补 `importExternalSession` 重扫愈合（外部行转录真值刷新首问/种子/lastPrompt，hook 行愈合空与注入形）与「非空元数据即真实记录」的规则放宽（保护大段重注册输入），触达套件 61/61，真实文件复验保持正确。
