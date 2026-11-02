---
{
  "schema": "harness-note/2",
  "id": "0cb67585-99d2-49a1-975e-e88fe85e7ed6",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-30",
  "updated": "2026-11-02T15:20:05Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "tags": ["terminal", "conversation", "agent", "dual-mode"],
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935" }
  ]
}
---

# 终端与对话双显示模式：Codeg、ZCode 调研及 JanusX 融合方案

## OpenCode 原生会话切换

JanusX 管理的双模式 OpenCode 使用外层终端标签承载多个运行实例；原生 TUI 通过进程级 `OPENCODE_CLI_CONFIG_CONTENT` 覆盖 `tabs.mode=off` 与 `tabs.enabled=false`，不恢复或写入共享的内层 tab 列表。仍可打开 New session、主动新建或切换历史会话。覆盖合并已有 JSONC 环境配置，保留主题、快捷键及其他字段，不修改全局配置和原生历史；配置格式无效时在启动服务前明确失败。这样避免同目录的旧空会话在新 pane 中再次出现，以及窄窗内多层标签标题互相挤压；代价是双模式实例不提供 OpenCode 内层标签栏，需要多实例时使用 JanusX 的终端标签。

验证（2026-11-02）：`vitest run tests/unit/opencode-terminal-config.test.ts tests/unit/opencode-tabs-cli.test.ts tests/unit/opencode-session-startup.test.ts tests/unit/opencode-conversation-cli.test.ts` 共 11 项通过，类型检查与适配器 ESLint 通过。真实 Windows OpenCode 2.2.5 的对照复现两个保存 tab 加新会话显示三个 New session；修复后 80／45 列终端不加载旧 tab、不追加新 tab、不额外创建会话，保存文件字节不变，双向对话／新建／切换回归通过。画面证据取真实 PTY 输出与 xterm buffer；窗口捕获工具初始化失败，未验收用户 dev 窗口整体是否另有裁切问题。测试清理仍有既有 ConPTY 警告。若后续需要保留内层多标签，应引入按 pane 隔离的 tab 状态及单独布局验收，不能直接恢复共享 tab 列表。

OpenCode 代理不再把其他会话的历史读取或尚未成功的新建请求判为会话损坏。原生 TUI 成功新建会话或发送 `POST /api/session/{id}/view` 后，适配器回读身份与工作目录再绑定；清空旧会话投影、撤销旧控制代次，并通过既有回调同步原生会话归属。读取历史不改变绑定，失败请求保留原会话；切换期间暂停轮询与对话控制，旧轮询的迟到消息和错误不能污染新会话。

对话视图、发送或设置更新占用输入时，原生新建／切换返回 409。回读失败、响应丢失或切换交叠只暂停对话控制，保留终端操作；重新选择原生会话并确认后可恢复，不永久断开、不自动重发提示词。仍只管理当前服务与工作目录，其他引擎的身份保护不变。接口变化应更新选择信号适配，不能恢复“读历史即切换”的猜测。

验证（2026-11-02）：`vitest run tests/unit/opencode-session-selection.test.ts tests/unit/opencode-conversation.test.ts tests/unit/native-conversation.test.ts` 共 19 项通过，覆盖旧控制失效、同会话保留历史、未知结果恢复、迟到读回及旧轮询消息／失败隔离。Windows 真实 OpenCode 2.2.5 的 `opencode-session-startup.test.ts` 与 `opencode-conversation-cli.test.ts` 各 1 项通过，使用隔离目录和 localhost 模型夹具，覆盖启动、历史预览、失败新建、原生 `/new`、双向发送、返回旧会话、模型设置及取消。测试通过不代表所有上游版本或生产模型均已验收；强制回收 TUI 时仍有既有 ConPTY `AttachConsole failed` 警告。

## CLI 版本兼容策略

Claude、Codex、OpenCode、Pi 与 DSH 的双模式启动不再以 CLI 或 DSH TUI 包版本号作为准入条件。启动前不运行仅用于门禁的 --version，也不读取 Pi／DSH 包清单做精确版本比较；升级后会直接进入既有后端启动或扩展桥准备流程。已验证版本只描述历史测试环境，不构成产品允许列表。诊断探针中的固定版本条件用于复现已有实验，不参与产品启动。

实际可执行文件解析、平台限制、DSH 的 dsh-tui profile、登录／目录信任、原生服务响应、桥认证、会话身份、事件序号及控制权校验仍保留。移除门禁不代表承诺任意上游版本兼容；协议或扩展 API 变化时按实际启动、握手或请求失败报错，不伪造就绪、不自动重发。这样消除每次 CLI 升级都需改允许列表的维护成本；出现真实接口变化时再适配该接口，而非恢复精确版本锁。

验证（2026-11-02）：conversation-launch-version 新增 6 项行为测试，验证 Codex／OpenCode 直接进入后端启动、Claude 进入实际启动操作、Pi／DSH 无包版本清单时仍可准备桥且保持 starting、DSH 错误 profile 仍拒绝。连同 codex-conversation、claude-conversation、opencode-conversation 与 native-conversation 共 45 项单测通过；类型检查与四个适配器 ESLint 通过。Note 校验 321 篇、0 errors，保留 17 条既有外部链接诊断。启动测试使用子进程替身或本地扩展桥，不调用供应商；该轮未实测 OpenCode 2.2.5，后续真实 CLI 验证及边界见上方原生会话切换小节。


## Intent

用户希望保留 JanusX 的原生终端体验，同时提供现代 Agent 对话界面，展示流式回答、工作过程、工具调用、文件修改和产物。用户已明确：不需要并排；同一会话在同一内容区域随时切换“终端／对话”，任一时刻只显示一种。两种模式在产品中共存，不要求同时显示。用户在完成技术探针后授权实施；已接入 Codex 和 Claude 的最小实验版本。本篇保留跨引擎目标方案，“Claude 当前实现”与“P1 当前实现”界定实际交付范围；未建立执行 Task。

建议采用“会话拥有运行实例，视图订阅会话”的设计。会话标题条只提供“终端／对话”二选一，同一会话只有一个执行所有者，切换展示不启动第二个 Agent。对话与终端共用一个工作区 pane，不做阻塞整个应用的模态弹窗，也不创建第二个会话标签。

完整目标是：用户在终端发送请求，执行中切到对话查看过程和结果，再在对话继续提问，随后切回终端仍是同一会话。显示切换与输入适配需要分别实现；只读历史切换只是过渡能力，不能算完成上述目标。原生 CLI 没有结构化控制能力时必须标明限制，不能用“把终端文字套进气泡”承诺双向交互。

## 研究范围与证据

2026-10-30 读取以下固定版本的公开源码与 README，结论来自静态分析，未安装或运行上游应用，未验证真实模型调用与跨端恢复。完整 clone／压缩包下载未完成，实际证据来自 GitHub 目录 API 与固定提交的原始源码；不能据此宣称审查过整个仓库。

| 对象 | 分析基线 | 主要职责 |
| --- | --- | --- |
| [Codeg](https://github.com/spacering-net/codeg/tree/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5) | `ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5` | Tauri/Rust 宿主、多 Agent 适配、React 对话工作台 |
| [ZCode](https://github.com/zai-org/ZCode/tree/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1) | `a60ba6a7e5a06742270ca605f5d2cc2766afa7e1` | 自有 Agent/CLI/TUI、共享协议、Electron/Web 与共享 React UI |
| JanusX | `4f1ed94250abd57ceb766f2616f2381fb069a4f2` | 当前 checkout 的终端、会话记录、内置 Chat、pane 和文件预览 |

上游根许可证均为 Apache-2.0；本次学习架构并原创记录设计，没有复制上游实现。以后若复用代码或素材，应针对实际文件保留适用的版权、许可证与 NOTICE。它们不是既有 [MIT-only ADE 调研](../desktop/desktop-ade-mit-survey.md)的 MIT 条目；本篇是用户指定的独立调研，不改写旧调研的选型范围。

本机没有可用的共享 wiki reader，本次按模块及明确依赖读取原始 Notes，并以有界路径检索核对源码。新方案不依赖旧调研中未核实的外部 wiki 路径或旧市场统计。

## Codeg：把多种 Agent 转成统一交互

Codeg 的重点是 Agent 协议适配，而不是把既有终端屏幕翻译成聊天。其 [agent_process.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/agent_process.rs)启动外部 ACP 子进程并通过 stdio 通信；[connection.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/connection.rs)处理初始化、会话加载、prompt、取消、工具、文件系统与权限请求。适配器和各提供方差异仍然存在，ACP 并不使所有功能天然等价。

它的对话模型分开处理已持久化、乐观提交和流式中的轮次。[conversation-runtime-store.ts](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/stores/conversation-runtime-store.ts)按 conversation 分区订阅，避免一个会话的 token 刷新全部 UI；后台转录补充记录带 watermark，持久化读取追上同一转录的字节位置后才移除临时覆盖。已经落盘不等于执行完成，旁观端仍须依据 in-flight 状态展示运行中。

[event_stream.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/event_stream.rs)给事件添加序号，采用有界近期事件缓冲。订阅在同一状态锁下取得快照、水位和 receiver，避免快照与增量之间漏事件；游标超出缓冲范围或存在缺口时回退快照。这里最值得学习的是恢复语义，JanusX 不需要照抄 Rust 实现或缓冲参数。

UI 将“回答”和“工作过程”组合为同一条阅读流。[content-parts-renderer.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/message/content-parts-renderer.tsx)把工具过程交给 ActivityTimeline，再在相应位置绘制说明、计划、图片、错误和专属结果卡；工具不是统一的 JSON 大框。[edit-row.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/message/activity/rows/edit-row.tsx)默认折叠文件修改，保留路径和真实增删统计，失败或等待时展开；大 diff 有独立预览上限。

[conversation-shell.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/chat/conversation-shell.tsx)组合输入、状态条、问题与计划审批等区域。[permission-dialog.tsx](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src/components/chat/permission-dialog.tsx)保留提供方的 requestId、optionId 和授权范围，显示待处理队列数量；前端不能自行把所有选项简化为永久允许。

产物展示同时支持显式引用和文件路径发现：明确的 visualize／preview 引用原位展示，一般 HTML 引用在回答停止流式后显示按需预览入口。这适合作为补充发现，但“提到某路径”不能证明文件确实由该轮生成。

**对 JanusX 的启发：**引入能力驱动的 Agent 适配边界、紧凑工具活动行、稳定调用身份、流式到历史的无重复交接。不要复制其整套 Tauri 后端，也不要把“ACP 对话 + 工具终端”理解为外部原生 TUI 的双向镜像。

### Claude 专项：Codeg 如何实现，哪些能力不能直接推定

用户要求先学习 Codeg 的 Claude 实现，再决定 JanusX 接入路线。本次继续核对上述固定提交，并下载其实际固定的 [Claude ACP 0.99.1 发布包](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp/v/0.99.1)做静态分析，没有安装到项目依赖、启动 Codeg 或调用真实供应商。发布元数据的 gitHead 为 `0f78dbbdd089e5c64fc908173e8656aa9cc757fb`，依赖官方 `@anthropic-ai/claude-agent-sdk@0.3.312` 和 ACP SDK 2.1.0，要求 Node >=22。证据缓存在忽略目录 `artifacts/codeg-research/`，可由固定提交与 npm 版本重新获取。

调用链为：Codeg React 对话 → Rust ACP client → stdio 子进程 `claude-agent-acp` → 官方 Claude Agent SDK `query()` → SDK 管理的 Claude Code 子进程。它没有从 xterm 屏幕提取聊天正文。[registry.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/registry.rs#L364)明确区分原生 `claude` 与第三方 ACP 适配器，并记录共用 `~/.claude` 配置/凭据；同文件 L2958 固定适配器版本。[agent_process.rs](https://github.com/spacering-net/codeg/blob/ddd1f09fc5dd2f464e68bb4b5a2bbf51257ecfc5/src-tauri/src/acp/agent_process.rs#L433)将三个标准流设为 pipe，用于协议传输。

| 能力 | 实际机制 | JanusX 可借鉴部分 |
| --- | --- | --- |
| 流式正文与公开思考 | 发布包 `dist/acp-agent.js` L9061 开启 `includePartialMessages`；L10612 将 text_delta 映射到 agent_message_chunk，L10636 仅将实际非空 thinking 映射到 agent_thought_chunk | adapter 归一化内容，公共 UI 增量显示；不补造未返回的推理文本 |
| 工具、文件与输出 | tool_use/tool_result 以调用身份映射 tool_call/tool_call_update；renderer 保留结构化状态、diff 和 terminal 输出元数据 | 用稳定 callId 更新活动卡，文件进入现有 viewer，不将所有结果塞进正文 |
| 权限与提问 | `canUseTool` 转为 ACP permission/elicitation；Codeg 的 connection 保留 optionId、允许一次/持久范围及拒绝语义，UI 回传选择 | 扩展通用审批契约，不能拿当前 Codex accept/decline 二选一直接覆盖 Claude 所有交互 |
| 模型、参数与指令 | ACP 会话配置/可用指令更新，适配器调用 SDK 的真实控制方法（如 setModel） | UI 复用，选项从 adapter 提供；Claude 不继承 Codex 六档 effort 或全部原生命令 |
| 历史与继续 | `loadSession` 回放转录，缺少内存 session 时建立 SDK 会话；恢复可传原 sessionId | 保留历史上下文，但恢复不证明仍使用原来的操作系统进程 |
| 命令终端 | Codeg `terminal_runtime.rs::create_terminal` 按请求另建命令子进程；适配器也提供命令执行结果的 terminal 展示信息 | 工具运行区可复用；这不是原生 Claude TUI 的 attach 通道 |

适配器发布包 `dist/index.js` L9–43 的 `--cli` 分支确实能启动原生 Claude，使用继承 stdio；但它与后面的 `serveAcp` 分支互斥，不提供一个进程同时服务 ACP 和原生 TUI 的证据。因此，“有 CLI 入口”“共用登录”“按 sessionId 恢复”均不能证明原生终端与对话能在同一执行实例任意切换。当前核对的 Codeg 路径解决了完整的 Claude 对话交互，尚未找到它解决 JanusX 所要求的原生 TUI 同实例切换的源码证据。

ACP adapter 是 Claude 完整结构化对话的一条候选路线，复用公共 UI，但不能据此承诺原生 TUI 同实例切换。用户进一步要求实际测试原生切换，下面记录本机原生 daemon 路线的新证据；不把只读版、另起 SDK 进程或伪终端作为同实例验收替代。

### Claude 原生 daemon 基线：同实例基础可行，该通道缺少结构化流式

2026-10-30T17:42:17Z 完成本地 Windows ConPTY 探针，CLI 为 `2.1.314`，原生二进制 SHA-256 为 `66e00df32e6981f686a91f67287fcc86e6e1b80ba4973a7b7c4aa43c59986cfa`。可重复执行 `node scripts/claude-dual-mode/probe.mjs`，说明在 `scripts/claude-dual-mode/README.md`。探针使用临时 home/config/workspace、假 key、localhost Messages SSE，显式 manual 权限模式且禁用全部工具；不复制用户凭据、不调用真实模型、不安装系统服务。本轮只新增探针和文档，没有接入产品 Claude adapter。

该基线的结论是：**原生后台执行实例与另一输入界面的往返可行；daemon subscribe 本身不提供结构化流式正文。** 后续 2.1.316 Mods 探针已找到另一条公开结构化事件来源，见下一节；不能再把 daemon 通道的限制推广为原生 CLI 整体的限制。后台往返来自 Claude 自己的 daemon，而不是 Codeg 的 ACP 适配器。

| 验证项 | 实测结果 | 含义 |
| --- | --- | --- |
| 普通原生 TUI + stream-json | ConPTY 下返回 `--input-format=stream-json requires --print` | 不能给现有 TUI 直接加 SDK 流式输出参数 |
| 本地 SDK URL / attach-serve | localhost SDK URL 被原生端拒绝；本地 UUID 被拒绝，cse_ 形式也要求启用 headless cloud client | 这些入口不是已验证的本地原生 attach；未测试真实账号的 Remote Control/cloud |
| SDK 基线 | 真 CLI 返回 7 个 stream_event 且 result 成功 | 本地模型和结构化流式夹具本身可用，后续缺口不是夹具不能输出 token |
| 同 sessionId 另起 SDK | 新 SDK PID 读取原生历史，但原生进程第三轮请求缺少 SDK 第二轮输入 | sessionId 相同不等于共享内存执行状态；此方案不能用于同步双模式 |
| 原生 `--bg` | 未完成信任时明确拒绝；接受本测试目录的原生信任后成功创建后台 session | 不能把初次信任前的报错当作后台模式不可用 |
| attach → 语义输入 → attach 输入 | daemon 的认证 `reply(nextTurn:true)` 进入同一原生会话；原生第三轮实际模型请求包含语义第二轮 | 同实例基本双向输入通过，没有为对话启动第二个推理进程 |
| Ctrl+Z 脱离 → 语义输入 → 重新 attach | 脱离后仍能执行，重连后原生 TUI 显示该轮；执行 PID 与 sessionId 均未变化 | 视图客户端可与原生执行生命周期分离，不必恢复或重启 Agent |
| daemon subscribe | 收到 snapshot/stream/state；stream.line 含原始 ANSI，没有 text_delta / stream_event | JSON 封装的终端字节不是富对话结构化事件，不用它解析聊天正文 |
| 转录中的流式正文 | 将同一回答的两个 SSE 增量间隔延长至 1600ms，期间轮询未见部分正文，完成后可读到完整正文 | 此版本和此场景下，转录可承接完成内容，不能据此宣称 token 级流式已解决 |
| 退出回收 | 停止本探针 daemon 成功，后台原生执行 PID 消失 | 未遗留测试后台执行实例 |

最后一次探针约 28 秒，退出码 0，报告状态 `completed-with-limitations`。后台执行 PID `46656`、sessionId `0a30eafb-caf2-4c5f-b6b2-7a1be4f7d12e` 在终端/语义输入往返和脱离/重连后保持不变；原生 attach 客户端本身可以更换。SDK resume 的反例使用存活的原生 PID `51244` 与另起 PID `48164`，实际请求确认上下文分歧。原始结果位于忽略目录 `artifacts/claude-dual-mode/probe-report.json`、`probe-runs.json`、`probe-requests.json`、`probe-background-events.json`；稳定的脚本与本篇结论保存在仓库，可重新生成证据。最终运行的退出回收无 ConPTY 警告；较早探针的强制终止曾触发 AttachConsole helper 警告，已改为原生退出/脱离后再回收。

`reply/subscribe` 属于 **2.1.314 的内部 daemon 协议，不是已承诺兼容的公开 SDK**。探针从自己临时目录读取 control key，使用 supervisor 控制通道，未直接占用 worker 的单连接 rendezvous socket；`nextTurn:true` 走语义排队，避免普通 reply 的 PTY 粘贴回退。本轮没有验证 requestId 去重、迟到命令、重复重试、输入草稿、停止、审批、文件编辑、模型/effort 切换、并行工具或长会话恢复；内部 `permission-response` 返回成功也不能证明真实审批已经实现。

该基线曾提出 `ClaudeNativeDaemonAdapter` 候选。后续公开 Mods bridge 解决了结构化事件来源，而两者组合又通过原生 Esc 后的语义恢复实测，当前接入候选见下文。既有普通前台 Claude 不自动迁移，启动仍需保留原生信任流程，不批量接受用户目录。不把 ANSI 文本变成气泡，也不把 ACP 与另一个原生进程的输出拼接成同一执行事实。

### Claude Mods 实测：同实例流式已通，任意状态切换仍有边界

2026-10-31 在 Windows 上运行实际 `2.1.316 (Claude Code)`，二进制 SHA-256 为 `e896a9d8da519353a49bf69ca4a695ba7e09067752687c675b3969041e632d52`。审查当前 daemon 分支后重跑旧基线，结果位于 `artifacts/claude-dual-mode/2.1.316/probe-report.json`：同实例往返仍通过，subscribe 仍只有 ANSI，另起 SDK 仍不能同步原生内存。supervisor 的 `permission-response` 仍只确认，不转发真实审批；`nextTurn:true` 跳过斜杠命令，不能据此推导设置或提问能力。

新的主要证据来自官方 [Mods](https://code.claude.com/docs/en/plugins/mods/overview.md)、[事件](https://code.claude.com/docs/en/plugins/mods/events.md)及 [API](https://code.claude.com/docs/en/plugins/mods/api.md)。原创 `scripts/claude-dual-mode/probe-plugin.js` 经 `--plugin-dir` 加载进普通原生 TUI；`mods-probe.mjs` 用隔离 home/config/workspace、假 key 和 localhost SSE 运行真实 CLI 与 Write/Bash 工具。流式观察使用 `turn.step` async generator，并原样传递所有 chunk 与返回值；没有解析终端正文、截取真实模型网络流或另起推理实例。构建实际生成的类型比公开仓库类型更新，按本机生成的声明核对 API。

**公开 Mods bridge 已证明同实例结构化流式及主要交互可行；后续 daemon + Mods 组合解决了测试中的 Esc 后语义恢复，TaskStop 解决了测试中的 Bash 残留。** 本节是产品实施前的探针证据，当前 adapter 与桌面验证见下一节；任意状态下的完整兼容矩阵仍未验收。

| 验证项 | 实测结果 | 产品含义 |
| --- | --- | --- |
| 原生 → 对话 → 原生 | 同一存活 PID/sessionId，第三轮实际模型请求包含前两轮输入；`prompt.submit({text, asUser:true})` 保留 plugin 来源 | 对话输入进入原生执行内存，无需第二个 SDK |
| 实时正文与工具 | 两个无换行文本增量间隔 1400ms，首段在回答完成前到达；工具 chunk.id 与 tool.call 的 tool_use_id 对应，真实 tool.call/check 可观察 | 原生 token 流来源已解决；多 block、子代理、恢复仍需验收 |
| 空会话与归属 | 空会话无模型调用；同 cwd 的 A/B 获得各自 terminalId/sessionId，模型历史不串线；关闭 A 后 B 可继续 | 普通 TUI 每会话启动注入可用；不是已有 daemon 的多 worker 环境验收 |
| 草稿与排队 | 原生未发送草稿在对话发送后保持；运行中提交在当前轮结束后执行一次 | 视图切换不应提交/清空草稿；提交回执与轮次完成应分开 |
| 对话取消 | `turn.abort({turnId})` 终止当前回答、保留进程，可继续插件发送；旧 turnId 被拒绝 | 取消要校验当前轮身份 |
| 原生 Esc | 后续插件发送返回 `{drop: 'the session was stopped and nobody has sent input since'}`，无模型请求；明确的原生新输入后恢复。后续 daemon + Mods 专项验证语义输入也可恢复，见下节 | 普通 TUI + Mods 单独仍受限；daemon 组合可接收显式用户发送，不能把 HTTP/调用成功显示为发送成功 |
| 真实写入审批 | HTTP PermissionRequest 的 allow 写入实际文件，deny 不写；原生审批界面可同时接受 Enter | Hook 可以完成基本审批；并发相同工具、问题、计划确认未验证 |
| 迟到审批 | 原生批准完成后，HTTP Hook 连接仍未关闭 | 不能用连接断开判断审批过期，需依执行事实关闭旧请求 |
| 取消与副作用 | 真 Bash 子进程在回答 aborted 后仍活着，随后完成延迟写文件；后续按原生 task_id 调用 TaskStop 的专项能停止它并阻止延迟文件 | 停止回答与停止工具需组合；归属映射和完成确认不可省略 |
| 模型设置 | config.set 接受 haiku 别名，之后对话与原生请求都变为 claude-haiku-5-5；临时 settings.json 持久化 model=haiku | 该 API 是持久默认值修改，不能包装成仅当前会话设置；完整模型 ID 被拒绝，effort 未验证 |
| 斜杠命令控制 | command.run 的 model 探针无原生键盘活动时超时，ui.invalidate 未解决 | 暂不暴露为可靠设置控制，不能把排队当生效 |

最终完整矩阵为 `artifacts/claude-dual-mode/2.1.316/mods-1793421659933/`；Esc 拒绝及恢复为 `mods-1793421623859/`，运行中排队为 `mods-1793421640895/`。各目录保留 report/events/requests/runs，均退出码 0、状态 `completed-with-limitations`，原生测试 PID 已回收。先前完整矩阵 `mods-1793421208032/` 与设置专项 `mods-1793421338750/` 留作对照。证据覆盖 Windows 真 CLI 加本地模型夹具，不是实际供应商、跨平台或 JanusX 桌面验收。运行方式与全部限制见 `scripts/claude-dual-mode/README.md`。

### Claude 当前实现

2026-10-31 接入 `src/main/terminal/claude-conversation.ts` 与原始 Mods 源码 `claude-mod.js`。新建本地 Claude 默认使用 AgentSessionPane 和 AgentComposer，以无提示词 `--bg` 创建一个原生 worker，终端通过真实 `attach` 接入，对话显式发送使用认证 daemon `reply(nextTurn:true)`，Mods 提供结构化正文、工具、取消及原生任务停止。启动不触发模型请求，切换不重建 worker。Windows 原生 2.1.316 精确门控；旧终端、恢复会话、远端和带自定义 extraArgs 的入口不迁移。第一次使用的原生登录与目录信任仍需先完成，可在普通 Shell 中运行 Claude 初始化；产品不代替用户确认信任。

主进程按 terminalId、原生 sessionId、daemon job/PID 和每会话随机 token 绑定事件流。插件与附加 settings 位于 userData 下的临时会话目录，保留既有启动 Hook，并将身份环境与 HTTP PermissionRequest Hook 注入当前 worker；不改用户全局 settings 或插件安装。关闭只执行自有 job 的 `claude stop <id>`，不停止共享 daemon；启动中关闭会等待在途 dispatch 后再清理。原生停止失败会报告未关闭并保留资产，不声称后台任务已退出。

历史恢复需要独立设计。`session.messages()` 最多返回最近 4096 行，缺少稳定消息 ID；`session.turns()` 是计数，不是逐轮账本。Mods turnId 与经典 MessageDisplay 的 turnId 不可直接等同，不能按正文相同去重。建议主进程保留带启动代次、seq、turnId、step 和 tool_use_id 的事件日志，在原生 JSONL 有可验证身份时做显式映射。断线、进程重启、compaction 与完整行游标都需验收；现有 `transcript-kernel.ts` 的正文搜索职责保持，不充当完整工具时间线。

产品 Bridge 在取消 Hook 之外定时发送有序批次，按 seq 确认与去重；传输失败只重发事件，不重发模型请求。缓冲上限 4000 事件／约 200 万字符，溢出、序号缺口或会话变更即关闭对话控制并提示使用终端。短暂失联可恢复同一事件流，进程重启与持久重放未实现。发送按 commandId 去重，除 daemon ack 外必须观察到新原生 turn；未知送达锁住再次发送，保留终端核查入口。显示最多 500 项，单项文本约 32000 字符；尚无长会话性能验收。

Write/Edit/Bash 的 HTTP 审批只在能唯一关联当前工具时展示“允许一次／拒绝”；并发歧义及问答／计划交互交还原生终端。原生批准或工具结束会使旧审批失效。模型与强度已接入公共选择器和 `/model`、`/effort` 预览，修改当前会话后续主对话请求；其它未适配指令仍提示去终端。设置只在空闲时提交，等待原生事件更新显示；提交期间阻止新发送及终端输入，失败保留原选择，超时标记结果未知并关闭对话控制。

#### Claude 会话模型与强度

模型目录来自独立原生 `--print --input-format stream-json --output-format stream-json` 进程的 initialize 控制响应，不发送提示词，不创建第二个执行会话。`claude-models.ts` 读取 resolvedModel、displayName、disabled、supportsEffort 和 supportedEffortLevels，仅提供原生声明的能力，不复制 Codex 的 ultra。辅助进程使用同一 provider 环境和附加 settings，另设 disableAllHooks、空 tools、strict MCP 与 no-session-persistence，防止目录探测重复触发用户生命周期 Hook；响应后退出，超时或关闭会话时取消。未知／自定义当前模型仍显示原值，不猜测其强度能力；目录失败可重试。

`config.set(model)` 与原生 `/model`、`/effort` 会保存默认值，因此产品使用公开 Mods `turn.step` 改写主对话 model/effort，并通过 `$.env.set` 设置当前 worker 的 CLAUDE_CODE_EFFORT_LEVEL。只改 turn.step 时，若所选 effort 等于输入事件的值，原生可能把它视为未改动并退回新模型默认；worker 局部环境补足这一边界。空 effort 恢复启动时的环境并沿用原生推导，不承诺各模型固定默认强度。设置变更不产生模型请求、不重启 worker、不改用户 settings；主对话的终端输入同样使用所选值。模型锁定及 settings 各层的 maxEffortLevel／modelSettings 上限在应用前检查，原生仍拥有最终策略约束。

原生默认模型页脚不因 turn.step 改写而同步；终端 AbovePrompt 增加 `JanusX session` 行显示会话覆盖值。用户执行原生 `/model`、`/effort` 或 `/config` 时，恢复原有 effort 环境并撤销覆盖，将控制交回原生；其命令本身仍可能保存默认值。原生设置确认未结束时，对话提示回终端并禁止新发送。代价是保留两种设置语义，不能把原生默认标签宣称为当前请求模型。

验证探针为 `node scripts/claude-dual-mode/mods-probe.mjs --hybrid-settings --hybrid-empty --env-effort`，首次证据在 `artifacts/claude-dual-mode/2.1.316/mods-1793451370717/`，补强逐项 effort 断言后的复验为 `mods-1793452562246/`。Haiku/low、Sonnet/high、Opus/max、重复切换和原生输入均核对实际请求；`mods-1793451370722/` 的 `--flag-settings` 负对照证实运行中改附加 settings 文件不生效。动态目录证据为版本目录下的 `settings-catalog.json`。产品真实 CLI 回归进一步断言三组模型／强度传值、零额外请求、用户 settings 不变、原生命令接管和另一个 worker 的 high 上限拒绝 max。

该路径按 Windows 2.1.316 验证。模型目录不保证真实账户有调用权限，复杂第三方别名／策略组合未全覆盖；局部 env 会被后续子进程继承，虽然 turn.step 的模型改写排除子代理，仍不能承诺子代理强度完全不受影响。子代理、真实 provider 与长期资源测试是后续验证项；原生版本改变必须复验目录协议、Mods 行为和 env 优先级。

#### 停止与产品验证

停止先阻止该轮新增工具、取消回答，再等待所选工具的结构化结果，用原 tool_use_id 找 backgroundTaskId 并执行 TaskStop。真实集成发现 abort 返回早于 Bash 后台化结果，现有界等待结果到达，缺失或停止失败保留未知状态。停止范围为当前轮；空闲时选仍有活动任务的最近轮，避免结束无关旧服务。后台自然完成通过公开 UserMessage.task 通知更新状态；原生 meta prompt 不当成用户气泡。停止不回滚已完成写入，子代理、任意进程树和远端停止仍不在当前保证范围。

验证使用临时 home/config/workspace、假 key 与 localhost Messages SSE，不调用用户供应商账户。`JANUSX_TEST_CLAUDE_BIN` 指向上述原生二进制后，`npx vitest run tests/unit/claude-conversation-cli.test.ts --maxWorkers=1` 通过：空启动零请求、真实流式、终端与对话往返、重复发送去重、原生 Esc 后恢复、Write 允许/拒绝、原生 Enter 批准后旧审批失效、Bash 子进程停止且超过 9 秒写入期限仍无文件、后台自然完成，以及共享 daemon 中关闭一个 worker 后另一个仍可发送且上下文隔离。证据为 `artifacts/claude-dual-mode/managed-last.json`。

`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 九项通过（24.5s），覆盖 Claude 原生能力筛选、模型／强度选择、不提供 ultra、运行中设置禁用、后台停止与原 Codex 交互回归。`npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-claude-conversation.spec.ts` 最新真实 Electron 一项通过（52.5s），走实际启动开关、preload/IPC/PTY、原生信任和三轮同 session 切换。界面选择 Sonnet/high 后，对话第二轮、终端第三轮的实际请求均带所选模型与强度；选择操作无额外模型请求。测试明确等待原生假 key 确认落盘和异步设置提交完成。主 Agent 已查看 `artifacts/claude-dual-mode/desktop-model-picker.png` 与 `desktop-effort.png`。后续重点是私有 daemon 协议升级兼容、真实供应商、复杂并发工具/审批、compaction、长期运行及持久恢复；本次不宣称这些已完成。

定向回归为 `npx vitest run tests/unit/claude-conversation-cli.test.ts tests/unit/claude-conversation.test.ts tests/unit/codex-conversation.test.ts tests/unit/terminal-launch.test.ts tests/unit/terminal-officecli-path.test.ts --maxWorkers=1`，显式设置原生二进制后 30 项通过，其中真实 CLI 一项为 72.2s。包含设置权威事件、失败保留、更新中发送阻断、原生确认等待、启动中关闭、原生停止失败不报已关闭、事件去重、未知发送锁定与旧轮后台任务停止；后补原生确认门控断言的 Claude 八项单测单独通过。严格 unused 类型检查、相关源码 ESLint、双语键校验与 `npm run build:app` 通过；Notes 为 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，无独立子 Agent 审阅。

### 原生停止与工具停止：候选方案的运行验证

2026-10-31 用户授权继续验证后，新增三个隔离专项并实测通过，CLI 仍为上述 2.1.316 二进制。命令为 `node scripts/claude-dual-mode/mods-probe.mjs` 加 `--hybrid-only`、`--stop-tool-only` 或 `--stop-foreground-only`。全部为原生 CLI、原生工具及 localhost 模型，未接入 JanusX 产品 UI。

**Esc 后的语义恢复通过。**临时原生会话完成目录信任后退出，后台新建 worker 加载同一个探针插件并接受真实 attach。原生输入运行中按 Esc，Mods 直接发送仍返回 drop 且没有模型请求；随后通过认证 daemon `reply(nextTurn:true)` 提交一次恢复消息，原生执行接收且 Mods 在响应完成前收到两段文本。继续插件发送及终端发送均通过，末轮模型上下文包含此前各轮。worker PID `2160`、sessionId `97b39500-d46d-4de0-af36-b0922781332c` 全程不变；恢复消息没有经 PTY 输入，daemon ack 之外还有模型请求与 Mods turn/chunk 证据。报告为 `artifacts/claude-dual-mode/2.1.316/mods-1793423446150/`。初次探针过早断言 listing 必须已有 PID 而失败；初始 job 已有 sessionId 但 worker 尚未就绪，改为等 Mods 启动轮后再核验，未改动原生逻辑。

**后台与取消转后台的 Bash 均能停止。**显式后台 Bash 的结果直接提供 backgroundTaskId；取消前台 Bash 时，实时 tool.complete 可能缺失，经典 Stop Hook 本场景也未出现，但 `session.messages()` 的 toolUses 按原 tool_use_id 返回结构化 `result.backgroundTaskId`，并有 `backgroundedByTurnAbort:true`。这揭示了之前的残留是被原生转到后台，可通过公开工具入口控制。调用 `$.tool.call({tool:'TaskStop', task_id})` 后，实际 Node 子进程退出；等待超过启动后的 14 秒写入期限，目标文件仍不存在，原生会话可继续发送。后台专项报告 `mods-1793423359932/`；前台转后台最终报告 `mods-1793423494225/`，子进程 PID `48096`，任务 `b177y702r`，原生会话 `1db12e11-ba99-41c0-83d3-7ec44c04f128`。初次前台探针只从 live completion 读取 ID 而失败；检查公开历史发现稳定的 tool_use_id 关联，修正读取路径后通过，没有解析终端文本或猜测 PID 对应的任务 ID。操作系统兜底清理在上述断言后才执行，不用于制造停止成功。

产品应建立 turnId/tool_use_id → native task_id 映射，停止时阻止该轮新增执行、取消回答、停止属于该轮的任务，再确认终态；不能停止其它会话或用户明确保留的长期服务。TaskStop 两项只覆盖单个本地 Bash 子进程，不保证任意进程树、并行工具、子代理或远端任务；任务结果迟到、历史截断、重复停止和完成竞态还需测试。若原生停止超时，保持“仍有任务运行”，提供单独的结束会话操作。自有进程树回收只能作为结束会话的兜底，不能冒充保留同实例的停止回答；停止也不会回滚已完成的写入或外部操作。

这两处已从“候选未验证”推进到“固定版本与场景下可行”。三个专项及原完整矩阵回归均退出码 0，回归报告为 `mods-1793423533458/`；记录的原生进程、daemon worker 及 TaskStop 子进程均已核实退出。daemon 私有协议仍需实际握手与响应校验，公开 Mods 直接发送的停止屏障没有被修改；必须保留显式用户发送与后台插件工作的区别，不自动重试旧请求、伪造来源或全局截获 Esc。后续已接入产品，当前实现及新增证据见上节。

## ZCode：把执行事实、传输和界面分层

ZCode 的 [README](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/README.md)明确区分 CLI/TUI、Web、Electron、services、shared 和 ui。统一 `zcode` 命令可以按参数进入 TUI 或 Web；这证明共享运行基础和多种入口，不证明两个进程可以同时无冲突地控制一个原生终端会话。

[rows.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/rows.ts)把显示内容定义为自包含行：turnHeader、userInput、assistantText、reasoning、toolCall、subagent、artifact 等。row 有稳定身份、轮次归属、状态和可用动作；文本增长用 delta，结构变化用整行更新。轮次边界和真实耗时由运行侧给出，UI 不从文字或时间间隔猜测。

[transport.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/transport.ts)定义握手、能力与带 `logEpoch + seq` 的订阅基线；[apply.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/apply.ts)给出 delta 的纯归约语义。[command.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/zcode-protocol-v4/command.ts)包含 commandId、部分操作的 revision/epoch 校验，以及 accepted/rejected/stale/duplicate/noop/failed 回执；accepted 本身不承诺跨 CLI 进程存活。这比“点击发送后立即显示成功”严谨。

[agentConversationTransport.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/agentConversationTransport.ts)以 transport 接口连接宿主服务，使 UI 数据层不绑定 Electron；[WorkbenchPane.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/WorkbenchPane.tsx)负责 pane 焦点、会话绑定和恢复校验。视图位置与会话身份分离，适合 JanusX 现有分屏树。

[ConversationTimeline.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationTimeline.tsx)使用虚拟滚动、历史分页、阅读锚点与滚动记忆；[ConversationRowView.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationRowView.tsx)按类型分派渲染。这里的价值是长会话可持续阅读，而非无限追加 DOM。

[ConversationFileSummaryPanel.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationFileSummaryPanel.tsx)从轮次聚合值按需读取文件明细，打开 patch，并把文件撤回预览作为独立动作。[conversation-preview-artifacts.ts](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/shared/src/conversation-preview-artifacts.ts)识别 Markdown、HTML、Office、PDF 和音视频引用；Markdown/HTML 候选还结合文件变化，而非仅看扩展名。

[SidePaneTerminalPane.tsx](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/SidePaneTerminalPane.tsx)通过稳定 persistentKey 管理 xterm/PTY，组件卸载只 detach，workspace 关闭才按归属回收。这个终端是独立 shell 能力；不能仅凭它的存在宣称 Agent 对话与原生 TUI 使用同一个执行实例。

**对 JanusX 的启发：**稳定的显示实体、明确命令回执、可恢复订阅、pane 与运行生命周期分离、文件摘要与重型预览分层。无需为了双模式迁移整个 monorepo 或同步建设 Web/mobile。

## JanusX 已有基础与真正缺口

“纯终端”准确描述外部 CLI 的主要工作入口；整个应用已经有内置结构化 Chat。应复用这些能力，而不是另造一套聊天系统。

| 已有基础 | 核对入口 | 融合方式与限制 |
| --- | --- | --- |
| node-pty、xterm、PTY IPC 与状态 | `src/main/terminal/manager.ts`、`src/shared/ipc/terminal.ts`、`TerminalArea.tsx` | 保留原生 TUI、输入与重放；PTY 字节和 seq 不等于语义事件与轮次 |
| pane 树与跨 pane 布局 | `src/renderer/src/lib/workspace-pane.ts`、`stores/workspace.ts` | 在一个会话宿主中保存 displayMode 并切换内容；现有终端 Tab 关闭会走 kill，切换模式不能复用关闭逻辑 |
| Chat 有序时间线 | `src/shared/chat-timeline.ts`、`components/janus/ChatTimeline.tsx`、`useJanusChat.ts` | 已有文本/公开推理/工具、callId、终态收敛、容量约束；可共享 renderer 和 reducer，不直接给所有外部 CLI 套用内置 Chat controller |
| 会话注册与转录 | `src/main/sessions/session-registry.ts`、`transcript-kernel.ts`、`transcript-reader.ts` | 延用身份与读取来源；当前内核有意排除 thinking/tool 内容，现有正文接口不能承载完整工作时间线 |
| 外部 CLI Hook 能力表 | `src/main/notifications/agent-engine-capabilities.ts` | 是状态/历史来源表，不是结构化发送、取消、审批或实时 token 能力保证 |
| 本轮文件变化 | `src/main/terminal/turn-change-tracker.ts`、`stores/turn-changes.ts` | 共享同一变化记录；tracker 的 turnId 不应假定等于 recorder/provider turnId，需要明确映射 |
| 文件与产物查看 | `FileViewerContent.tsx`、`viewers/MonacoViewer.tsx`、`HtmlViewer.tsx`、`office/OfficeFileViewer.tsx` | 继续走现有文件窗口和类型分发，不复活已删除的独立产物工作区 |
| Agent 执行与审批 | `src/main/llm/chat-orchestrator.ts`、`src/main/harness/execution-adapter.ts` | 继续使用 Janus/agentX 契约；普通对话不强制创建 WorkflowX Task |

已有 [Chat 工作时间线](../agent/requirements/chat-work-timeline.md)维护流式顺序、公开推理、工具结果与恢复边界；[引擎能力](../sessions/records/session-engine-capabilities.md)维护各 CLI 的实际历史/恢复差异。Pi 的实时身份绑定、Janus CLI 原生恢复映射和 DSH 会话信号不能被本方案当成已解决。

[终端原生滚动](../terminal/terminal-scrollback-navigation.md)曾明确移除会话阅读面板。本次新请求允许重新设计 Agent 对话入口，但不撤销原生滚动、全屏 TUI 和快捷翻页约定。新入口是独立会话视图，不占用原滚动按钮或伪造终端历史轨道。

[统一文件窗口](./unified-file-window.md)包含已确认方向与分项实施状态；本方案遵循它的单一打开路由，不宣称所有跨宿主能力已完成。与 [长会话性能](./long-session-performance.md)共用预算与测试原则。

## 双模式的产品契约

### 运行方式与显示方式分开

| 会话运行方式 | 终端显示 | 对话显示 | 切换后交互的边界 |
| --- | --- | --- | --- |
| 原生 CLI + PTY | 原生 TUI，完整保留 | 从明确绑定的 Hook/原生转录投影；标记“实时”“轮后同步”或“记录不完整” | 初期终端独占输入，对话只读；有正式可验证控制协议后再开放 |
| Janus 或结构化协议托管 Agent | 工具命令输出、关联 shell；只有真实 TUI attach 能力才显示“Agent 终端” | 完整流式、工具、审批和输入 | 对话控制执行；关联 shell 是另一进程，不能当成同一 Agent 输入端 |
| 明确支持同实例多前端的运行时 | 真实 attach 的 TUI | 同实例事件投影 | 新建本地 Codex 双模式已实现当前可见视图取得输入控制权；不以版本号拦截启动，历史实际验收版本为 0.166.0 |

创建时选择 Agent 和默认显示模式，之后在同一会话内切换。支持的会话可以在空闲、输出中、执行工具、等待审批、完成或失败时切换，无需等当前轮结束。若当前引擎没有可用正文源，解释暂不支持，而不是显示看似完整的空对话；只有只读投影时标注“对话只读”，不能标为完整双向切换。

协议托管会话没有真实 TUI 时，不提供冒充原生 Agent 终端的切换项；关联“命令终端”保留为独立工具入口，不计入双模式验收。若用户需要换运行方式，使用显式“在新会话中继续”，标明是原生 resume、分支还是摘要交接；这不是显示切换，不能静默启动第二个同 provider session 写入者。

### 随时切换的具体语义

显示状态只有 `terminal` 和 `conversation`，保存在会话级，与 executionId、连接状态和执行状态分离。切换只变更显示状态，不创建、resume、取消或重发运行。当前可见视图负责键盘输入；隐藏视图保持必要的数据状态，不接收快捷键或自动抢焦点。

| 切换时机 | 应有行为 |
| --- | --- |
| 正在流式输出或执行工具 | Agent 继续运行；目标视图先读取当前快照，再接连续增量，不从头播放或重复执行 |
| 等待审批或用户回答 | 待处理请求保留；支持协议时在当前界面处理同一 requestId，否则给出“切回终端处理”入口；不擅自批准或取消 |
| 已有未发送输入 | 两种视图各自保留原草稿；只有宿主统一管理输入时才共享草稿，原生 TUI 草稿不可读取时不承诺自动迁移 |
| 正在阅读历史 | 分别保存终端滚动位置与对话阅读锚点，回来恢复原位置；新输出通过提示到达，不强制跳到底部 |
| 快速连续切换 | 只落实最后一次显示意图；旧挂载回调和焦点恢复失效；输入交接期间短暂禁用发送，不重复提交 |
| 目标数据未就绪或读取失败 | 目标显示同步中/明确错误并可立即切回；原运行继续，不能为修复显示而重启 Agent |

对 Janus 自有运行时，完整双向切换可通过共享 session controller、结构化事件，以及可重附着的终端前端实现。当前桌面 Chat 和 Janus CLI 仍不能直接视为同一个实例；这一运行时接缝需在 janus-agentX 验证或建设。外部 Agent 只有在同实例控制和事件能力得到验证后，才声明支持完整切换。若使用自有终端 renderer 呈现协议事件，须明确这是 JanusX 终端界面，不冒充提供方原生 TUI。

### 布局与视觉

同一会话标题条展示名称、Agent、项目/worktree、运行状态，以及能力允许的“终端 / 对话”。左侧导航和 pane 标签只保留一条会话身份，切换时标题与状态位置固定，仅中央内容替换。移动整个会话 pane 不改变显示偏好、历史、草稿和运行身份。

两种模式均使用当前 pane 的完整可用区域。对话正文建议最大阅读宽度 800–900px；工具摘要使用紧凑行，详情按需展开。窄窗调整正文、输入和工具条，不新增分栏。切换动画只做短淡入或直接替换，遵循减少动态效果设置；恢复终端时按稳定后的实际尺寸 fit，避免隐藏期间错误 resize 破坏 TUI。

概念布局如下，尺寸仅用于讨论：

```text
项目 / 会话       会话 A · Agent · worktree       [终端 | 对话]
                 ┌───────────────────────────────────────────┐
                 │ 当前模式占用整个内容区域                  │
                 │ 终端：原生 TUI                            │
                 │ 或                                        │
                 │ 对话：请求 → 工作过程 → 回答 → 文件/产物  │
                 │       输入框 / 只读能力提示               │
                 └───────────────────────────────────────────┘
                 文件窗口按需打开，与显示模式独立
```

沿用 JanusX 的中性色、主题令牌、细分隔和标签选中语言。Agent 回答以可阅读正文为主，不把每段输出包成重色大气泡；用户输入可用轻底色形成边界。错误、审批和当前工作有语义强调，普通工具不抢正文层级。现有公开推理默认展开的规则保持，用户可折叠；没有公开内容就不补造。

产物卡只给缩略预览、类型、名称、来源轮次和打开动作。详细文件进入统一文件窗口，切换终端/对话不关闭文件预览或丢失编辑草稿。空间不足时按既有辅助面板规则收起，禁止抢焦点或覆盖未保存草稿。Island 继续作为状态/变更入口，不能另存一份结果数据。

### 输入、审批和生命周期

1. **原生终端优先。**第一阶段对话 composer 只显示草稿/控制状态，不自动向 PTY 发自然语言。用户在终端审批时，对话只提示“请在终端处理”，不把“允许”按钮映射成猜测的 y/Enter。
2. **结构化提交。**支持协议的会话由主进程 controller 接收 commandId、sessionId、executionId 和目标版本；区分排队、送达、运行中、失败。重复提交返回同一回执。连接中断后的未知提交先查询，不自动重发；PTY write 成功也不等于 Agent 接受。
3. **控制权切换。**完整支持的会话在用户切换模式时，由主进程原子地把输入控制权交给当前视图，不额外要求点击“接管”。带 generation 的控制租约拒绝隐藏视图的迟到输入；切换不提交任何草稿。原生 CLI 只能读取时，对话仍只读并提供切回入口，不伪造接管。普通 shell 独立输入不占 Agent 租约。
4. **运行中输入。**默认保存为可编辑的下一条草稿，只有已实现可靠队列时才提供排队；steer/中途补充必须由 adapter 单独声明。Enter/Shift+Enter 与 IME 遵循现有 composer，不能在中文候选确认时发送。
5. **审批与提问。**区分授权请求、用户问题、计划确认和终端等待。请求有独立 ID 与待处理状态，主进程原子消费；切换后读取最新处理结果。保留真实选项、对象和范围；超时或旧 generation 的按钮不可再生效。
6. **停止。**取消当前轮、停止工具子进程、终止 Agent 是不同动作。无法确认停止时显示“等待停止确认”；关闭视图不代表取消，停止也不回滚文件。
7. **关闭与恢复。**切换模式不关闭 PTY 或会话 controller；独立终端的既有关闭/kill 保留明确语义。新增会话入口把“关闭会话页面”和“结束运行”分开，关闭页面后后台仍可从侧栏找到。重启恢复历史、布局和显示偏好；没有重附着凭据的旧运行标记中断，不自动重发上一轮或伪称进程仍活着。

## 内容如何显示

### Codeg 式结构化呈现

用户进一步明确希望对话模式具有 Codeg 那样的呈现效果，不要求输出终端的全部内容。采用面向阅读与操作的结构化对话：助手正文流式显示，工具过程用紧凑活动行，文件变化用差异入口，产物用可打开的卡片。终端与对话共享执行事实，但可以采用不同的信息密度和排版；切换无需两边逐行对应。

默认展示用户请求、助手公开说明与回答、当前工作状态、工具摘要、文件/产物入口，以及需要处理的审批或错误。终端启动横幅、ANSI 控制符、光标重绘、重复状态刷新不进入对话时间线。工具完整参数、长命令输出和大 diff 默认折叠，用户主动展开或打开日志查看；容量截断需要明示，不假称保存了完整输出。等待授权、执行失败、取消和记录不完整必须可见，不能为界面简洁而隐藏。

例如一次修复任务的对话可以显示：“我先检查登录逻辑” → “读取 auth.ts” → “修改 auth.ts · +12 −4（查看差异）” → “运行 npm test · 退出码 0（展开输出）” → 最终回答 → “变更文件 / 报告预览”。路径、统计和退出码都来自真实事件；仅凭退出码不能虚构通过的测试数量。过程顺序保留，重复输出可在同一调用中折叠，不把过程全移到回答末尾。

实现依赖结构化事件和有类型的历史记录，再由 renderer 决定展示方式；不依赖实时让另一个模型总结终端全文。只有 PTY 字节时，无法可靠恢复工具、审批和产物语义，应降低展示能力并明确说明，不能猜测出看似完整的 Codeg 式时间线。这一 UI 方向与完整双向切换是两个验收维度，视觉成立不代表输入控制已经打通。

### 各类内容规则

| 内容 | 显示规则 | 事实来源 |
| --- | --- | --- |
| 用户输入 | 文本、文件/选区引用、附件、发送状态 | 本地草稿 + 命令回执 + 提供方确认；不会展示两次同一提交 |
| 流式回答 | 同一 block 原位追加 Markdown；正文/代码可复制；向上阅读时不拉回底部 | 真实 text delta；仅有轮后转录时不做假打字动画 |
| 工作说明/公开推理 | 按事件顺序插入，与工具交错；每段独立开始/结束 | 公开事件；无此能力时省略 |
| 工具调用 | 名称、目标、状态、耗时；展开参数与截断输出；未知工具有通用卡片 | callId + 实际工具事件；相同名称不能代替身份 |
| Shell 输出 | 默认紧凑显示命令和状态，结束后显示退出码；展开查看 cwd 与有界 stdout/stderr，长日志按需读取 | 工具/PTY 证据；命令输出不是最终回答 |
| 最终结果 | 正文 + 已知验证结果 + 文件/产物入口 | 最终消息及已关联结果；工具完成不等于任务完成 |
| 文件变化 | 每轮路径列表、增删统计、状态与 diff 入口 | 已有快照/工具证据；标记“工作区在本轮期间变化”或“工具直接写入” |
| 产物 | 类型卡、预览/源码/打开所在位置；保存中、可用、已修改、缺失分别呈现 | 显式产物事件优先，其次有路径的成功工具结果，最后才是受限文件发现 |
| 子 Agent | 主时间线中的紧凑状态与结果，点开独立过程 | 父子运行身份；不把子输出混入主助手正文 |

文件修改、产物和模型说法分开：`report.html` 是交付对象，`src/app.ts` 的修改是变更记录，两者可以相关但不等价。Markdown 代码块默认只是文本，不能因为包含 HTML 就自动执行。普通路径引用只能给“打开文件”候选，不足以标为本轮已生成。

快照比较可能包含用户、格式化器或其他 Agent 的同期写入；多个 Agent 使用同一 checkout 时尤其不能声称独占归属。多写者优先使用既有 worktree 隔离。历史 diff 必须指向保留的版本/patch；历史文件入口打开当前文件时要明确提示。没有历史 blob 就显示不可用，不用当前内容冒充当时产物。

终端和对话统一采用用户主动打开预览：文件生成或修改时只更新变更提示与文件入口，用户点击文件或预览入口后才唤出既有文件窗口。HTML 也遵循此规则，首次生成、轮次结束及模式切换均不自动弹出或抢焦点；用户关闭后，后续更新仍须点击才能重新打开。这是已确认的交互约束，不将自动弹出列为待补功能。

产物引用建议包含 `artifactId + sessionId + turnId + workspaceRuntimeId + worktree + path/resourceId + mime + contentHash/version + origin`。对于用户已打开的预览，文件稳定落盘或收到 finalized 后再刷新内容；保留上一次完整版本，避免半写 HTML/Office 闪烁。统一文件发现、变更归属与版本刷新仍属后续建设范围，不能据交互约束宣称已经实现。

HTML/Markdown/Office 继续使用现有隔离 viewer；生成 HTML 不获得 Node、preload 或任意 IPC。资源路径在实际运行宿主验证，远端路径不能拼成本机路径；符号链接、项目外引用和外链沿用已有访问边界。声明式工具卡由宿主注册，模型输出不能注册 React 代码或新增工具权限。

## 实现架构建议

### 一份事实，多种投影

数据流为“提供方事件/原生转录 → adapter → 主进程会话 controller → 有界事件/快照 → 对话、状态和变更投影”。原始 PTY 字节继续走终端专用通道；不将大量 ANSI 塞进语义事件日志，也不从清屏、光标移动和颜色猜工具语义。

主进程 controller 管执行身份、发送、取消、审批和订阅恢复；renderer 只投影与发命令。会话 registry 仍拥有身份和索引，provider transcript/现有 Chat 历史仍是其对应正文权威来源；新增展示 journal 保存规范化事件及出处，不复制一个竞争的会话数据库。重放、展开、换视图和恢复历史永远不触发业务写入。

建议新增的显示契约概念如下，名称和路径在实施时收敛，不是当前已存在 API：

```ts
type DisplayEnvelope = {
  schemaVersion: number
  sessionId: string
  executionId: string
  epoch: string
  seq: number
  eventId: string
  source: 'native-agent' | 'protocol-agent' | 'transcript' | 'hook'
  sourceRef?: string
  turnId?: string
  blockId?: string
  callId?: string
  payload: DisplayEvent
}
```

`DisplayEvent` 覆盖 turn 生命周期、text/reasoning 增量、工具开始/更新/结束、approval/question、file-change、artifact 和错误。单独保存连接状态、执行状态与读取完整性；断线不等于运行失败，缺日志不等于没有执行。PTY seq、provider seq 和规范化 seq 各有命名空间，不能直接互相比大小。

持久/重放身份稳定，流式与转录重合依据 sourceRef、原生 message/call identity 或可靠映射替换；禁止用文本相同、时间接近或 cwd 相同去重。来源无稳定映射时保留“补充历史/无法关联”，不强行合并。现有不同 turnId 在主进程建立映射，无法证明时文件卡保持独立。

订阅返回 `(snapshot, epoch, lastSeq)` 并保证后续增量连续；主进程用同一串行事务完成取快照与注册订阅。重复事件忽略，缺口请求重同步，epoch 变化切换新基线，旧 execution 的迟到事件隔离。按事件数与字节限制缓冲，大图片和大日志用资源引用。文件转录读取保留完整行游标，处理半行、截断和轮转，不按 token 全量重读文件。

### 适配器按能力开放

适配层声明 `readHistory / liveText / liveTools / submit / cancel / approvals / questions / resume / attachNativeTui / artifacts`，并记录探测版本与缺失原因。能力以实际连接握手和版本测试为准，不能只按引擎名称写 true。MCP 是工具协议，不能替代会话、流式与控制协议。

优先级是 Janus 自有事件、外部正式结构化协议、原生转录加 Hook、最后仅终端。ACP 可作为一种 adapter，不要求为了兼容一个 CLI 把 JanusX 内部所有事件强行改成 ACP。Janus CLI 与桌面若需同实例 attach，属于 janus-agentX 的协同契约，本篇不替该仓库承诺已经具备。

第一版不做泛用的“给任意 PTY 填 prompt 并按 Enter”。这种行为可能落入 shell、登录流程、菜单或审批界面，而且无法可靠获知原生草稿。必须保留它作为受限的显式用户动作时，也应显示未确认送达，不能成为完整双模式的验收替代。

### UI 分层与拟议落点

用户明确要求对话能力作为跨 CLI 的公共底层框架，各 CLI 只做适配。当前已将 UI 抽取为 `AgentSessionPane` / `AgentComposer`，公共快照、命令、模型和能力在 `src/shared/conversation-display.ts`，主进程以 `ConversationController` 注册表连接 adapter。Codex 已改用此边界，原生 app-server/remote 协议保持在 Codex adapter 内；滚动、草稿、切换动效及输入预览由同一 UI 负责。尚只有 Codex 一个实际 adapter，审批契约仍是命令/文件的二选一，完整原生指令目录和更细能力需要第二个 adapter 验证，不能宣称公共框架已覆盖所有 CLI。

公共层负责同 pane 模式切换与动效、焦点/输入互斥、消息/工具/文件/产物的展示组件、流式阅读、返回最新、草稿/阅读位置、通用指令预览及模型设置控件。滚动状态按稳定会话身份隔离；底部追随、向上阅读不抢滚动及返回最新应作为公共行为测试，CLI adapter 不实现自己的滚动。公共事件/快照使用规范化身份、内容与能力，公共 UI 不直接引用某 CLI 的协议类型、RPC 方法或 Codex 专用 IPC。

adapter 负责实际进程/连接与原生 TUI attach、会话/轮次/调用身份映射、事件转译、历史读取、发送/取消/审批/设置命令及真实能力声明。通用输入框消费 adapter 提供的指令目录和模型/参数描述：支持的共享动作复用同一控件，CLI 专属动作通过声明扩展；不将 Codex 的六档 effort、审批选项或斜杠指令全集硬编码成所有 CLI 的能力。不支持某项能力时隐藏入口或清楚降级。不同授权范围保留真实 optionId/语义，不能都压成 accept/decline。

现有公共对话区已支持已加载内容的上下滚动、流式时保持历史位置、返回最新及视图切换时保存位置，源码在 `AgentSessionPane`，行为回归在 `tests/e2e/codex-conversation.spec.ts`。当前投影有 500 项/文本预算，尚无历史分页和虚拟列表，因此不能称为完整历史无限回看；后续公共层须区分已加载内容滚动与按需读取更早历史。框架抽取后沿用这些回归；不同能力的第二个 adapter 尚待验证。

| 层 | 复用/拟议落点 | 职责 |
| --- | --- | --- |
| 会话控制 | `src/main/sessions/`，拟增 controller/adapter 模块 | 身份映射、能力、命令仲裁、投影恢复；调用现有终端/Chat 服务 |
| 共享契约 | 已有 `src/shared/conversation-display.ts` 与对应 IPC | 当前为快照、命令及能力；分页、扩展审批待实现，不承载密钥 |
| 展示状态 | 拟增按 session 分区的 conversation store | rows、运行状态、快照水位；不持有子进程或审批副作用 |
| 工作区宿主 | `workspace-pane.ts`、`TerminalArea.tsx`、workspace store | 单会话 pane、displayMode、内容替换、焦点恢复与关闭/销毁区分 |
| 内容组件 | 复用 `ChatTimeline`、`ToolCallCard`、Markdown 与 ThinkingRegion | 增加文件/产物/请求槽；专属 renderer 注册在宿主边界 |
| 文件与产物 | turn-changes、既有文件打开服务与 viewers | 一份变更记录、一条打开路由、版本与来源说明 |
| Agent 运行 | 既有 Chat/harness 与 janus-agentX 端口 | 工具与权限事实；本次不新建第二套 Agent loop |

显示快照不自动进入模型上下文。选择“引用结果/文件”才通过已有上下文构造进入请求；脱敏摘要与业务原始载荷分开。一个会话宿主共用 store 和数据订阅，切换不重复启动 watcher、历史扫描或 usage 统计。隐藏终端保留 PTY/xterm 状态，隐藏对话保留投影与阅读状态；隐藏 UI 不持续参与重型渲染。

前台 token 可按帧合并绘制，生命周期/审批即时更新；后台暂停动画和重型 Markdown/diff 渲染，但继续接收必要状态。长列表按稳定 rowId 虚拟化并分页，插入旧历史保持阅读锚点；终端继续既有 buffer/resize 管理，只有实际可见尺寸变化才 fit。应测量而不是预先承诺双视图零性能代价。

## 交付顺序与验收建议

### P0 实测：Codex 同实例双前端

2026-10-30 执行 `node scripts/codex-dual-mode/probe.mjs`，Windows / Codex CLI 0.166.0 全部断言通过。脚本及使用说明位于 `scripts/codex-dual-mode/`；本次完整报告留存在 `artifacts/codex-dual-mode/report.json`（本地忽略目录），原始事件与请求位于报告中的临时根目录。以下持久摘要与可重跑探针一起构成证据，不依赖临时文件永久保存。

验证结构为一个真实 `codex app-server --listen ws://127.0.0.1:PORT`、一个真实 ConPTY `codex --remote … resume threadId` 原生 TUI，以及一个 JSON-RPC 客户端模拟未来对话 controller。模型输出来自本地确定性 Responses 服务，配置、环境和工作区独立，未使用用户账户、真实模型或现有会话。模拟服务只发出固定指令；命令、补丁、审批与会话执行由真实 Codex 完成。

| 已执行检查 | 结果及边界 |
| --- | --- |
| 终端 → 对话 → 终端继续输入 | 原生 TUI 发起第一轮，协议客户端发起下一轮并出现在 TUI，再由 TUI 发起后续轮；七条测试用户输入在主 thread 历史中各出现一次，模型请求包含前文 |
| 流式与重连取消 | 收到 `item/agentMessage/delta`；流式未完成时断开结构化客户端，重新连接并 resume 同一 thread，再 interrupt，收到 interrupted 完成状态；未验证丢失增量的完整重放 |
| 工具命令 | 收到 `item/commandExecution/requestApproval`，协议接受后收到请求解决事件、commandExecution 成功结果、退出码 0 和真实标记输出 |
| 文件与产物 | 收到 `item/fileChange/requestApproval`、请求解决事件、fileChange 路径/diff/完成状态；临时工作区 `result.html` 内容与预期一致；未实现产物卡或预览 UI |
| 身份与进程 | 主 thread 为 `01a18d04-e69b-7580-88d2-f4064a08a646`，后端 PID 13220、TUI PID 53004 在检查期间存活；未启动第二个用户对话执行后端 |

原生 TUI 会创建 `ephemeral: true / threadSource: thread_title` 的标题生成线程。本次剩余一个已加载辅助线程，已核对其类型。未来 adapter 必须按主 threadId 绑定用户内容，并过滤标题辅助事件；不能把全部线程都拼进对话，也不能将“全局线程数必须为 1”作为同会话验收。

本地模拟模型的 fallback 元数据未提供独立 apply_patch 工具，探针使用 Codex 可识别的 exec_command 内 apply_patch 形式进入原生补丁处理，确实得到 fileChange 与对应审批。该事实验证了协议事件链，不代表真实供应商工具选择已经验收。临时 CODEX_HOME 无法创建 PATH helper aliases 的警告未阻断上述路径。

另一个实测边界是：刚执行 thread/start、没有持久历史的空线程无法被原生 TUI resume，返回 no rollout found。P0 探针先执行一轮 BOOTSTRAP 才接入 TUI。P1 已改为转发原生 TUI 的连接，直接绑定原生创建的空线程，不向模型发送初始化提示。

### P1 当前实现：Codex 实验双模式

空工作区的终端选择器与 pane 新建菜单均不再提供“对话模式”开关。公共 launchTerminalPreset 对新建本地 Codex、Claude、OpenCode、Pi、DSH 默认创建具备终端和对话两种形态的会话；设置 → 通用 → 会话启动习惯只选择“新会话默认视图”，默认终端，也可选择对话。偏好即时保存，只作用于之后新建的会话，不迁移或切换正在运行的会话；旧开关无论开启或关闭均迁移为终端优先。远端、attach-only、Shell、Janus 及既有原生恢复入口继续按实际能力运行，不伪造双形态支持。

初始视图随单次创建请求传入，主进程在 adapter 启动前确定控制权，renderer 的启动占位沿用同一选择。失败重试保留该会话创建时的选择；重挂载以运行快照为准，不重新套用全局偏好。带初始提示词的启动在对话优先时填入对话草稿，终端优先时沿用 PTY 预填，两者均不自动发送。用户点击普通 Codex 卡片即创建一个终端身份，由 `src/main/terminal/codex-conversation.ts` 管理独立 loopback app-server 与本地 WebSocket 转发连接，真实原生 TUI 以 `--remote` 接入。`AgentSessionPane` 在原终端区域提供终端／对话切换，任一时刻只显示一种。Claude 使用上文独立 adapter；以下协议与模型控制细节仅指 Codex。

早期开关阶段的历史验证：`codex-conversation.test.ts` 与 `terminal-officecli-path.test.ts` 共 14 项、`terminal-launch.test.ts` 与 `terminal-launch-program.test.ts` 共 11 项通过；公共 UI 浏览器回归 8 项通过。真实 Electron 使用当时的新开关启动普通 Codex，终端→对话→终端三轮保持同一 thread，模型/effort 实际传值和关闭回收仍通过（1 项，27.5s，localhost 模型）。严格 unused 类型检查、定向 ESLint、双语键、主题检查通过，生产构建通过；末尾补充本地/非 attach 启动范围过滤后，启动单元回归及类型检查通过，未单独验证开启开关时的远端/attach 场景，也未再重建桌面。Notes 检查 321 篇、0 错误、17 条既有外链诊断。此处只验证当时 Codex 与公共层，不代表 Claude adapter 通过；默认双形态的最新验证见下节。

采用转发连接是为了保留原生创建、信任审阅、订阅与完整 TUI 语义，同时解决空线程无法 resume 的限制。controller 只根据原生 thread/start、thread/resume 请求的响应选择主 thread，不根据全局 thread/started 广播猜测归属，标题线程和子 Agent 不改变当前对话。主进程使用独立请求 ID 前缀发送对话操作，只拦截自己的响应，原生响应与通知继续交给 TUI；该转发器随会话运行，不随 React 视图挂载变化。

Codex 原生 remote 传输会读取代理环境变量，127.0.0.1 也可能被送往 HTTP 代理。用户启动报 connection lost 时，现场环境有 HTTP_PROXY／HTTPS_PROXY 而无 NO_PROXY；先前 CLI 夹具自带本机绕过，未覆盖该条件。新增隔离代理回归在修复前捕获 `CONNECT 127.0.0.1:<bridge-port>`，TUI 报 `Proxy connection failed: HTTP CONNECT failed with status 502`；修复后本地连接直接建立。adapter 现在为后端及原生 TUI 合并 NO_PROXY／no_proxy，保留用户既有排除项并加入 127.0.0.1、localhost、::1，保留 HTTP_PROXY／HTTPS_PROXY／ALL_PROXY，不改用户全局配置。主进程把 adapter 返回的环境补丁用于同一 PTY，避免只修后端而遗漏 TUI。桌面回归进一步发现宿主 ProxyManager 的全局 HTTP hook 也会代理本机 WebSocket；后端就绪探测与正式连接均显式传入 agent:false，防止该内部通道被全局代理接管。

传输关闭不再用笼统错误覆盖已有具体故障，也不在尚未建立 thread 的启动阶段保证历史已保存。断线仍不自动重发请求或重建会话。新增环境与错误保留单测后 `codex-conversation.test.ts` 十一项通过；真实 CLI 两项通过（代理隔离约 4.87s、双会话控制回归约 35.1s），仅 HTTP_PROXY／HTTPS_PROXY 的现场同类条件单独复测通过（4.61s）。测试确认外部代理配置保留、本机地址不再进入代理。真实 Electron 代理回归通过（28.1s）：原生 TUI 启动、终端与对话切换、同一 thread 三轮交流以及模型／强度设置均正常。生产构建、严格 unused 类型检查与定向 ESLint 通过；测试使用隔离 profile 与本地模型服务，未重启用户正在运行的应用或重发失败请求。

2026-11-01 现场定位启动期 `Max payload size exceeded`：原生 TUI 的 `plugin/list` 单条响应为 26,304,472 字节（约 25.09 MiB），其中 `openai-curated-remote` 返回 10,689 条目录记录。旧桥接两端的 16 MiB 限额在接收后端响应时断开连接；以该限额直接请求接口复现 `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`。两端现统一为有限的 100 MiB，与 `ws` 默认值及独立探针一致，原生报文完整转发，不受对话展示裁剪影响。代价是单次接收、字符串转换和 JSON 解析可占用更多内存；若目录继续增长接近上限，应重新评估上游分页和转发成本。`npx vitest run tests/unit/codex-conversation.test.ts --project=unit` 十二项通过，新增真实 loopback WebSocket 回归发送超过 25 MiB 的插件目录，验证原文转发、后续轮次事件与连接存活；该用例在旧限额下失败。本轮未重跑完整 Electron 交互回归。

新路径把现有 inline Hook 配置、terminal/workspace 身份环境、工作目录及 Office 环境传入自有 app-server，移除该后端命令中不适用的 --no-daemon。原 Hook manager 的默认参数未更改，不连接用户共享 daemon，不复制用户登录或原生 home。Hook 准备失败时新双模式启动失败并显示错误，避免悄悄运行无归属会话；原生信任仍在 TUI 由用户审阅。不再设置版本门控，此处历史实测版本为 0.166.0；Windows npm shim 会解析到原生 codex.exe，不能以 shell 字符串拼接 Hook TOML。仅接受新建本地 Codex，会话恢复参数与远程路径明确拒绝。

显示切换不创建/取消/resume 轮次，原生 PTY/xterm 保持挂载；隐藏视图设为 inert，主进程同时拒绝隐藏终端的普通输入、原生主线程发送/中断与审批回复。显示控制代次让切换前的迟到对话操作失效。对话发送使用 commandId 去重，超时/断线不自动重发，运行中禁止再开一轮；原生终端继续保留它自己的补充输入语义。正文完成并不意味着轮结束，停止与忙碌状态以 turn 事件为准。对话草稿和阅读位置放在已有终端状态，终端草稿由原生 TUI 保留，两边不自动互拷。

对话正文复用现有 Markdown renderer；工具活动默认收拢，命令卡显示结构化输出，文件卡显示路径和 diff。命令与文件审批可允许一次或拒绝，通用问答等未实现的交互明确提示切回终端。点击文件使用现有 openEditor 路由，HTML 等预览由既有文件窗口承担；预览按已确认规则由用户点击打开，不自动弹出。尚无独立产物目录、版本化产物卡或撤销。终端 Island 保留在终端视图；对话文件卡使用协议补丁记录，尚未与 checkpoint Island 合并为单一变更记录。

显示投影按 turnId/itemId 更新，最多 500 项、总文本约 100 万字符，单项文本或 diff 预算 32000 字符，截断会显示提示，不修改原生记录。流式快照最多约 32ms 推送一次，后台工作区保留最新快照但暂停对话渲染。列表尚未实现虚拟化与历史分页；全量快照仍有传输成本，不宣称长会话性能已验收。

切换模式、标签或工作区不结束运行。显式关闭终端标签沿用现有“结束会话”语义，PTY 退出、同 ID 替换、创建失败及应用退出均回收自有后端；killAll 等待后端进程树回收。关闭标签后后台保活、应用重启恢复、协议自动重连和断线增量重放未实现，不能把 P0 的重连探针记作产品恢复能力。

[官方 app-server 文档](https://developers.openai.com/codex/app-server/)与 [CLI 参考](https://developers.openai.com/codex/cli/reference/)给出了 remote TUI 连接方式，但明确将 app-server/WebSocket 标为实验性且不支持生产负载。产品入口默认具备双形态，底层保留协议校验与后端回收，不再设置版本门控；启动失败显示错误，不静默重启或迁移。入口文案不改变协议的固定版本验证边界。

可重复验证：`tests/unit/codex-conversation.test.ts` 八项覆盖 thread 过滤、稳定身份、去重、控制代次、审批失效、预算、初始化期间切换及模型/指令控制；`terminal-officecli-path.test.ts` 补充 shutdown 等待自有后端回收。真实集成 `tests/unit/codex-conversation-cli.test.ts` 使用生成的 Hook、原生审阅、两套后端/TUI 和 localhost 模型，覆盖空会话、往返输入、模型/effort 同步、两会话 Hook 归属、真实命令审批、执行输出与退出后进程消失。设置 `JANUSX_TEST_CODEX_BIN` 为原生 CLI 绝对路径后运行 `npx vitest run tests/unit/codex-conversation-cli.test.ts --project=integration`，默认跳过不能记通过。UI 五项 `tests/e2e/codex-conversation.spec.ts` 使用真实组件和 IPC 替身，覆盖流式切换、不重建终端、草稿、工作区往返、重挂载、IME、审批、文件窗口路由、断线、历史阅读不抢滚动、键盘返回最新、输入框自适应与命令选择器；暗色/纸面/窄窗截图在本地 `artifacts/codex-dual-mode/`。协议/P0 真实文件写入和 P1 文件 UI 属不同层证据，不能合称 P1 真实文件编辑全链路通过。

本步骤未验证真实供应商账户、其它平台、Janus 自有运行时、复杂并行工具、极端审批抢答、完整崩溃恢复或长时间资源曲线；其它 CLI 以各 adapter 的独立验证为准。支持范围内的新会话默认具备双形态；未发布安装包。

Windows 真实 Electron 验收 `tests/e2e/desktop-codex-conversation.spec.ts` 一项通过：从新入口启动、原生 Hook 审阅、终端第一轮→对话第二轮→终端第三轮，同一个主 thread 的三条用户输入完整保留，关闭后 controller 消失；全链路使用真实 preload/IPC/PTY/CLI 与 localhost 模型。桌面截图在 `artifacts/codex-dual-mode/desktop.png`。本轮构建、严格 unused 类型检查、定向 ESLint、双语键检查通过；Notes 检查 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，未调用独立审阅者。

### 默认双形态与启动视图验收

启动路径单测 `terminal-launch.test.ts`、`terminal-launch-program.test.ts`、`terminal-officecli-path.test.ts` 共 19 项通过，覆盖五种已接入 CLI 默认双形态、非支持入口不启用、对话草稿不写隐藏 PTY、偏好修改后失败重试仍保留原选择。设置与对话浏览器测试共 26 项通过（设置七项、对话十九项），覆盖偏好持久化、旧开关迁移、窄窗、首次聚焦及重挂载保留运行视图。真实 Electron 的 Codex 默认终端启动通过（28.9s）；Claude 从设置选择对话后创建、自动聚焦、往返切换与任务面板回归通过（约 1.1 分钟）。首次 Claude 桌面测试发现输入框晚于占位视图挂载而漏掉聚焦，修复为提交能力到达时补充聚焦，并通过新增浏览器测试及最终构建后的桌面复测。两条桌面测试均使用真实 CLI 和本地模型夹具，不涉及真实供应商账户。

最终生产构建、严格 unused 类型检查、定向 ESLint、双语键检查通过，Notes 校验 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 查看 `artifacts/codex-dual-mode/startup-preference.png` 的 380px 设置布局。仅修改新会话的创建策略和首个视图，不迁移旧运行或扩展未支持的版本、远端、Janus 接缝；主 Agent 自检，无独立子 Agent 审阅。

### P1 界面优化：以 Codex 桌面端为视觉参考

2026-11-01 按用户要求进行首版视觉精修：空态在居中内容列中左对齐，引擎身份、标题和输入区共用阅读轴；正文标题按 25/21/17/15px 区分，正文 14px，强调以字重表达。共享 Markdown 组件原有内联样式会覆盖 pane CSS，新增仅供对话使用的排版变体，保留代码、链接和资产处理，其他预览不变。用户气泡改为较紧凑的不对称圆角；工具摘要保持逐项展开，以连续细线和语义状态颜色组织。输入区提升底色区分、增加底部控制分隔，聚焦使用主题强调色，发送/停止改为圆角方形。没有改变会话控制和工具事件归属。深浅主题及 390px 宽度截图经主 Agent 查看，无横向溢出，示例内容由测试夹具提供，位于 `artifacts/conversation-design/`。这版保留长对话滚动、草稿与 reduced-motion 行为。

用户要求切换与对话设计更现代、简约。2026-10-30 读取 [OpenAI 官方 Codex 应用页面](https://developers.openai.com/codex/app/)并查看其 proactive-teammate-v2 演示封面：采用留白、居中任务起点、圆角输入区和圆形发送按钮作为参考。这里提炼视觉原则，组件仍由 JanusX 实现并读取既有主题令牌，正文继续使用共享 Markdown renderer；没有复制官方图片作为产品资产，也没有添加尚无能力支撑的模型、附件或权限选择器。

当前 `AgentSessionPane` 使用右上角紧凑分段按钮表达终端/对话，左侧不再显示就绪等常驻运行状态，取消全宽工具栏分隔线。两种模式位置固定，当前项有明确选中态；再次点击当前模式不发送切换请求。采用可见的两个标签是为了让视图切换保持一步可达。切换不触发会话重建，隐藏视图仍为 inert。

空会话将任务标题与输入框放在内容区中央的阅读列中，文字左对齐；有内容后使用最大 744px 正文内宽和底部输入区。用户消息用轻底色气泡，Agent 正文保持开放排版并标明引擎。工具过程是默认收起的摘要行，显示类型、首行或文件名及状态，展开后显示输出、文件路径和着色 diff；失败/拒绝状态保留文字提示。审批改为中性描边卡片，允许一次是高对比主操作。文件名打开现有文件窗口，完整路径仍可通过悬停及无障碍标签读取。

输入区使用整体主题色焦点边框，不在 textarea 内部增加强调色矩形；文本随输入和 pane 宽度增高，最大 200px 后内部滚动。底部为模型/推理强度快捷入口与圆角方形发送/停止按钮；工作区由左栏表达，不重复显示工作目录标签。键盘提示仅在输入区获得焦点时显现，窄 pane 隐藏辅助文字。布局按 pane 宽度使用容器查询，适应应用内分屏；系统减少动态效果偏好会关闭状态呼吸与过渡。

阅读历史时保持用户位置并显示“回到最新”，点击或键盘激活后恢复追随；流式增量不抢走正在阅读的历史。界面验证命令为 `npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1`，包含此行为的五项回归通过。主 Agent 查看暗色空态/正文、640px 纸面审批和 380px 窄窗截图，确认输入框、工具内容和模式入口无横向溢出。截图中的 Other workspace/Remount 是测试夹具控件，不是产品界面。现阶段未增加切换快捷键、工具分组时间线或独立产物目录。

上一轮纯视觉优化的 `npm run build:app`、`npm run typecheck:strict-unused`、组件定向 ESLint、`npm run theme:check`、`npm run i18n:check` 均通过；主题扫描无新增问题。构建后真实 Electron 验收一项通过（32.1s），完整桌面截图确认原生终端/对话三轮往返仍保持同一 thread。Notes 校验为 321 篇、0 错误、17 条既有外部链接诊断。以下指令与模型控制改变了后端边界，采用单独的当前验证记录。

### 对话阅读层级

对话正文沿用 Codex 风格参考中的开放阅读流，用户消息使用轻底色圆角气泡，轮次之间增加留白。回答正文统一 14px 字号与 1.8 行高，标题收敛至 16px，通过字重和段落间距建立层级。工具过程使用紧凑摘要行和悬停反馈，保留展开输出、文件与审批入口。代码块保留原始换行和缩进，横向滚动且不限制正文代码块高度；工具原始输出仍保留高度上限。所有调整仅作用于 AgentSessionPane，使用现有主题令牌。

本轮查阅 https://developers.openai.com/codex/app/ 时已重定向至 https://learn.chatgpt.com/docs/app ，具体排版数值为 JanusX 自身设计，不宣称与当前官方应用像素一致。

用户消息下方在悬停或键盘焦点进入时显示复制、重新编辑及时间，触屏常显。Codex、OpenCode 的重新编辑在原消息位置展开编辑卡片，提供取消和保存并重新发送，独立保留底部草稿。Enter 换行，Ctrl/Cmd+Enter 提交，Esc 取消并将焦点还给原消息编辑按钮；编辑期间锁定模式切换，提交即显示等待并防止重复提交。回答结束后下方常显复制及时间，复制失败明确提示。发送与执行期间在阅读流左侧显示 Thinking，审批或原生接管时让位于对应提示；完成后移除。消息时间由主进程记录首次接收时刻，跨快照更新保持稳定，旧消息没有时间时不补造。

原位编辑真实替换该消息起的会话历史，再从这里生成回答，不撤销工作区文件。Codex 0.166.0 使用本机生成 schema 确认的 `thread/revert {threadId,beforeTurnId}`，原生 TUI 同步接收 `thread/reverted`；旧 `thread/rollback` 已移除。OpenCode 2.1.4 使用 `revert/stage {messageID,files:false}`、`revert/commit` 并读回消息确认，轮询代次隔离编辑前的在途响应。确认后才移除本地后续项，Codex 同时移除对应计划，再发送修改后的文本。空闲、控制代次、消息身份、截断与非纯文本内容均有门禁；原生操作结果不明时禁用对话控制，不自动重试，编辑文字仍可选取复制。Claude、Pi、DSH 尚未接入可靠历史编辑，隐藏编辑入口，不能以追加提示词代替。

验证：`tests/unit/conversation-edit-cli.test.ts` 两项真实本地模型测试通过，覆盖三个回合后编辑中间回合、重复 commandId、模型实际上下文不含旧后续、会话身份保持、工作区文件保留及切回原生终端续聊。设置 `JANUSX_TEST_CODEX_BIN` / `JANUSX_TEST_OPENCODE_BIN` 后运行 `npx vitest run tests/unit/conversation-edit-cli.test.ts --project=integration --maxWorkers=1`；未配置时跳过不算通过。相关 unit 28 项通过；`codex-conversation.spec.ts` 与 `conversation-edit.spec.ts` 浏览器 35 项通过，包含取消、失败前后历史状态、底部草稿、重复提交与深浅色/窄窗。截图在 `artifacts/conversation-design/inline-edit-{dark,light,narrow}.png`。以上真实 CLI 是本地确定性模型证据，不代表真实供应商或桌面完整端到端验收。

运行时长由主进程在轮次开始、结束事件间记录墙钟耗时，包含该轮等待审批的时间。Thinking 旁每秒更新分钟:秒；结束后回答工具栏显示固定耗时。视图切换不重置计时，缺少开始事件的历史轮次不补造耗时，后台工具任务不计入已完成的回答耗时。

### Codex 原生执行计划

2026-11-01 本机 Codex 0.166.0 验证可用。默认隔离配置没有向模型提供 update_plan；启用 tools.update_plan.enabled=true 后，真实工具调用产生 turn/plan/updated，包含 threadId、turnId、explanation 和 pending/inProgress/completed 步骤状态。探针使用原生 app-server、TUI 与本地确定性模型服务，不调用真实供应商。成功证据为临时目录 janusx-codex-dual-q5H70M/report.json，可通过 node scripts/codex-dual-mode/probe.mjs 重建。

JanusX 只在受管 Codex 双模式后端与原生 TUI 的进程参数中启用此工具，不写入全局配置。工具可用不保证 Agent 每轮使用；无原生计划时不显示面板，不解析回答文字生成 todo。Claude 任务投影复用此面板，原生状态来源与验证范围见下一节。

输入框上方显示可折叠执行计划、当前步骤和完成条目数。首次计划默认展开，用户收起后后续版本不强制展开；默认展开的计划全部完成后自动收起。每次非重复通知创建新版本，旧版本进入阅读流的计划历史。回答结束仅记录轮次结果，绝不自动完成步骤；中断、失败保留进度，断线显示最后已知计划并停止旋转。第一版只读，不提供用户直接勾选。

主进程按当前 threadId/turnId 校验消息，拒绝其它会话、迟到旧轮及无效状态；每版最多 100 步、每步 2000 字、说明 4000 字，保留最近 100 个计划版本。版本与步骤保留在当前 runtime 的快照中，切换视图和 renderer 重挂载可恢复；进程退出后的持久恢复、断线期间漏失版本补齐尚未实现。历史版本记录已接收的计划，不冒充完整原生账本，也不据完成勾选宣称测试或审阅通过。

本轮验证：原生协议探针通过；受管 Codex CLI 集成一项通过（34.1s），覆盖原生工具计划投影与已有双会话/Hook/审批路径；投影单测九项通过，界面全量十三项通过，补充完成/中断与计划专项两项通过。严格 unused 类型检查、定向 ESLint、双语键校验与 Notes 校验通过（321 篇，0 错误，17 条既有跨仓链接诊断）。已查看 380px 浅色计划面板截图；未做本轮真实 Electron 桌面验收。

### Claude 原生任务与旧式 TodoWrite

Windows Claude Code 2.1.316 已验证并接入同会话任务投影。Mods 在主 Agent 的 TaskCreate／TaskUpdate 成功后调用原生 TaskList 读取实际清单，直接执行的 TaskList 也可提供快照；旧式 TodoWrite 使用成功结果中的 newTodos。任务输入、工具输出文字及模型回答均不作为完成依据，失败、拒绝和子 Agent 工具调用不改主计划。pending／in_progress／completed 映射到共享三态，删除后的空清单创建明确版本。任务工具与停止后台进程的 TaskStop 属于不同用途。

现代任务来源被识别后，每轮开始重新读取清单；旧式 TodoWrite 延续本 worker 最后确认的未完成项，直到原生工具更新或清空。读取失败保留最后确认的状态并标记同步失败，停止旋转；下一次有效快照恢复。读取串行化，主进程校验当前 turn、过滤重复和迟到事件，沿用 100 步、每步 2000 字及最近 100 版本的限制。轮次正常结束、中断或失败只改变运行结果，不补勾未完成项。界面只读，折叠偏好、历史版本及双视图切换复用现有计划组件。

[Claude 官方工具说明](https://code.claude.com/docs/en/tools-reference#task-tool-availability)区分新版任务工具与 CLAUDE_CODE_ENABLE_TASKS=0 的 TodoWrite，也说明模型及后台会话的可用性差异。产品沿用原生后台 worker 的工具策略，不额外改全局环境、不注入强制规划提示词，也不绕过用户工具禁用或审批设置。模型没有实际使用任务工具时不显示虚构计划；是否主动使用由模型与原生设置决定。首版不监听其它 Agent／外部进程对共享任务文件的持续修改，也不恢复 JanusX 进程退出前的计划历史；下一主轮或任务工具调用会重新读取现代任务状态。

可行性探针 `node scripts/claude-dual-mode/mods-probe.mjs --tasks-only` 与 `--todos-only` 均通过，原始报告分别位于 `artifacts/claude-dual-mode/2.1.316/mods-1793468135670/mods-report.json` 和 `mods-1793468158480/mods-report.json`。使用真实原生 CLI 与隔离 localhost 模型服务，验证现代任务待办→进行中→完成→删除，以及旧式 TodoWrite 更新与清空。产品 CLI 集成 `tests/unit/claude-conversation-cli.test.ts` 一项通过（74.36s），覆盖原生终端创建任务后切换对话、跨轮推进、无效任务更新不伪造进度、旧式清单延续／清空及原有控制回归；模型响应由本地夹具确定，未验证真实供应商模型主动规划概率。

控制器与 Mods 定向单测共 21 项通过（含 Codex 回归），浏览器 `tests/e2e/codex-conversation.spec.ts` 共 18 项通过，覆盖同步失败、恢复、切换、窄窗与既有显示交互。`tests/e2e/desktop-claude-conversation.spec.ts` 在最终构建上通过（一项，约 1.1 分钟），真实 Electron／IPC／原生 worker 默认工具配置完成任务创建、推进与勾选，始终同一 session。初次桌面运行因本地模型夹具把原生附加提醒误当作工具尚未返回而重复创建任务；夹具改为检查当前提示后的实际工具调用，重跑通过。主 Agent 查看 `desktop-plan.png` 和 `plan-stale-light.png`，确认桌面任务区及 380px 同步失败提示。生产构建、严格 unused 类型检查、定向 ESLint、双语键检查通过；Notes 校验 321 篇、0 错误、17 条既有跨仓链接诊断。主 Agent 自检，无独立子 Agent 审阅。

### 首次对话的输入区过渡

首次按 Enter 或点击发送时，前端先记录本次 pendingSend，再调用 IPC，立即退出空态布局并显示加载反馈；后端 submitting/turn 状态同样使空态退出，不再等待首条原生消息出现。复用原输入表单，以实际位置差执行 420ms 缓出位移动画，从中部平滑落到底部。空态期间跟踪草稿高度和 pane 尺寸，流式回复与发送不等待动画，焦点保持在输入区。提交确认后才清除未被用户继续修改的草稿；失败清除本地 pending，保留草稿和错误，在后端没有运行状态或消息时恢复空态。不构造原生消息、不自动重发，重复提交受同步输入锁保护。切换视图、隐藏 pane 或卸载会取消动画；已有历史的会话不重播首次过渡。系统启用减少动态效果时直接使用最终布局，但仍立即显示加载反馈。`tests/e2e/codex-conversation.spec.ts` 的延迟 IPC 夹具覆盖五个引擎在尚无快照/消息时下移与加载、重复 Enter 不重复发送，以及减少动态效果下的失败恢复。

### P1 指令预览与模型控制

原输入框把 `/model` 当成普通提示词发送，无法实现原生 CLI 的本地命令语义。现由 `AgentComposer` 在输入时识别斜杠指令并展示可操作的选项；普通消息、绝对文件路径（如 `/tmp/report.md`）继续使用原发送路径。共享 parser 和 controller 双层拦截指令，避免绕过 UI 后误发模型请求。

| 输入/入口 | 当前行为 |
| --- | --- |
| `/`、`/help` | 预览支持的指令与用途 |
| `/model`、`/model <搜索词>` | 展示并筛选后端模型目录，选择后更新同一会话 |
| `/effort`、`/effort <搜索词>` | 仅显示当前模型声明支持的推理强度 |
| `/terminal`、`/stop` | 切换同一会话到终端、停止当前轮次 |
| 输入框底部模型/effort 按钮 | 模型打开搜索选择器，effort 打开横向强度阶梯；保留正在编写的草稿（包括未执行的斜杠指令） |
| 其它斜杠指令 | 显示尚未适配与终端入口，保留草稿，不发送；不声称兼容全部原生 CLI 指令 |

预览支持上下键定位、Enter/Tab 选择、Esc 关闭及点击外部收起；输入法组合期间不提交。模型当前选项显示勾选，effort 用横向强度控件表达。切换模型时优先保留兼容的 effort，否则采用该模型的目录默认值；未知自定义模型仍显示真实模型名，但不猜测 effort 列表。目录失败可重试且不打断会话，设置失败保持草稿并显示反馈。模型与 effort 标签使用中英文文案；模型描述保留后端返回文本，effort 不显示描述或描述悬停提示。

协议依据为 [OpenAI 官方 app-server 文档](https://developers.openai.com/codex/app-server/)中的 `model/list`、模型能力字段，以及本机 Codex 0.166.0 生成 schema 的 `ThreadSettingsUpdateParams` / `ThreadSettingsUpdatedNotification`。controller 从 thread/start、thread/resume 响应获取初始 model/reasoningEffort；模型目录支持分页、隐藏项过滤与有界读取。选择通过 `thread/settings/update` 提交 model/effort，等待 `thread/settings/updated` 权威通知更新展示，通知继续转发原生 TUI；终端侧改动也由同一通知投影。仅更改当前 thread 的后续轮次设置，不写用户全局 config，不重启、不新建 thread、不取消在途回复。更新期间禁止新发送和重复设置；控制代次、模型目录和模型/effort 组合都在主进程校验。

当前单元测试 `npx vitest run tests/unit/codex-conversation.test.ts` 八项通过，新增分页能力、默认值、主 thread 设置过滤、更新中发送阻断、失败不伪造选择、过期控制与指令/路径区分。真实 CLI 集成使用 localhost 模型，验证对话选择后的 model 和 reasoning.effort 确实出现在对话第二轮、原生终端第三轮的 HTTP 请求中；同一 thread 与 Hook/审批/清理回归通过（一项，37.06s）。换模型会改变可用工具定义，因此命令审批夹具在设置验证后明确恢复 `probe` 的 exec_command 定义。该测试证明协议传值与双模式同步，不证明真实供应商账号拥有目录中每个模型的调用权限。

浏览器五项覆盖指令预览、搜索、键盘选择、快捷入口保留草稿、目录重试、设置失败、未知指令拦截、原生设置投影、IME，以及既有流式/审批/阅读位置回归。截图 `model-command-dark.png` 与 `effort-command-light.png` 在 `artifacts/codex-dual-mode/`；主 Agent 已查看暗色与 380px 浅色选项面板。

预览层宽度由 480px 调整为最多 360px，高度与内边距同步降低，命令行采用更紧凑的“指令名 + 单行说明”；外层 `box-shadow` 移除，避免悬浮面板周围出现黑色阴影圈。effort 使用横向强度阶梯，中文按“低／中／高／极高／max／ultra”表达，max、ultra 保留原词；选项按强度排序并仅展示模型实际声明支持的档位，不补造能力。底部使用六根递增柱形，避免四档图标合并 max 和 ultra 的视觉状态。

effort 面板不再显示推理用途描述或描述 title。左右键、Home/End 与鼠标悬停只预览档位：选中底板在 200ms 内平滑移动，柱形同步逐级亮起并轻微伸展，当前已提交档位仍由 aria-selected 与底部标签表达；Enter/Tab 或点击后提交设置。左右到达两端后停止，不跨端跳转；减少动态效果偏好会关闭这些动画。保留下一轮生效与键盘提示。窄窗横向容纳当前六档，更多档位允许内部滚动，不撑破页面。主 Agent 查看 `effort-preview-max-light.png`，确认 380px 中文面板六档名称、max 预览和无描述布局；静态截图不代表动态帧率测量。

本次控件调整的浏览器验证共八项通过：原有七项回归通过，新增中文六档场景在修正语言切换后的输入框定位后单独复测通过，覆盖无描述/悬停描述、左右预览不提交、两端停止、max/ultra 确认及草稿保留。严格 unused 类型检查、组件 ESLint、双语键与主题检查通过。此轮仅改 renderer 展示，未重跑生产构建或真实 Electron；协议及桌面证据仍为下述此前记录。

紧凑控件阶段 `npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 五项通过，覆盖 effort 横向语义、键盘切换和窄窗边界；紧凑外观与去阴影属于上述截图人工核对，不是独立样式断言。`npm run theme:check`、`npm run i18n:check`、严格 unused 类型检查通过；构建日志 `build-compact-controls.log` 已确认完成。真实模型/effort 协议集成证据沿用上一段记录。

最终构建、严格 unused 类型检查、相关源码 ESLint、主题检查、双语键检查通过；Notes 321 篇、0 错误、17 条既有外部链接诊断。`tests/e2e/desktop-codex-conversation.spec.ts` 真实 Electron 一项通过（27.1s）：在真实 UI 使用 `/model` 与 `/effort`，随后对话第二轮及终端第三轮的 HTTP model/effort 均为所选值，同一 thread 且输入未夹入指令文本。主 Agent 查看 `desktop-model-picker.png` 完整桌面截图；同样使用 localhost 模型，不涉及用户供应商账户。主 Agent 自检，无独立子 Agent 审阅。

### P1 同 pane 切换动效

终端/对话分段入口使用等宽双列和独立选中指示块，点击后立即以 220ms 缓动滑向目标。等待模式命令返回时，原内容轻淡化，内容区顶部中央显示无阴影的“正在切换视图”提示与细环；命令成功后目标内容以 220ms 淡入并上移 5px，加载提示随之淡出。没有最短后端等待或伪造进度，只有短暂的视图交接时间。任一时刻仍只显示一个视图，终端组件保持挂载。

命令等待及入场期间禁止重复切换，两个内容宿主均为 inert，输入框显式 disabled；过渡结束再恢复目标输入焦点，避免终端在解除 inert 前尝试聚焦。失败后显示原错误并恢复当前模式、指示块及输入；组件卸载或换会话会清理计时并忽略旧切换回执。系统启用减少动态效果时不执行滑动、淡入或额外计时，真实命令等待仍显示静态提示。动效仅涉及当前 pane，不重启执行、不更换 thread，也不清空草稿和阅读位置。

浏览器回归七项通过（24.4s）：新增可控延迟与拒绝切换，验证等待提示、输入阻断、失败后重试、双向焦点恢复及减少动态效果；原有流式、指令/模型、草稿、阅读位置、审批与文件入口回归仍通过。主 Agent 查看 `artifacts/codex-dual-mode/view-switch-loading.png`，确认等待提示与模式入口；截图本身不证明动态帧率。`npm run build:app`、严格 unused 类型检查、组件 ESLint、主题及双语键检查通过。

最新构建后的 `npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-codex-conversation.spec.ts` 一项通过（33.3s），使用 Codex 0.166.0、真实 Electron/preload/IPC/PTY 和 localhost 模型，验证三轮往返保持同一 thread、回到终端后的焦点与输入、模型/effort 实际传值和关闭回收。主 Agent 查看 `desktop.png` 中的入场加载状态及 `desktop-effort-scale.png` 中的稳定桌面与强度选择器；未测真实供应商或跨平台。主 Agent 自检，无独立子 Agent 审阅。

| 阶段 | 可交付结果 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0：身份与能力验证 | Codex 独立协议/TUI 探针已通过 | 协议层核心可行性已证明；边界见实测节 |
| P1：Codex 最小产品接入 | 已实现受管后端、controller、同 pane 切换、正文、双向输入、审批和文件详情；实际验收边界见当前实现 | 扩展真实供应商与长期测试后再考虑默认开放；其它无协议 CLI 不随之获得能力 |
| P2：Janus 对话及双向切换接缝 | 复用 Janus Chat 的流式、工具、审批、文件和产物；与 agentX 建设或验证同 session 的终端前端 | 终端发送后切对话可继续，反向也成立，保持同一运行与上下文；仅接入命令 shell 不算通过 |
| P3：一个外部结构化 Agent | 选一个协议与版本经过验证的 adapter，完整跑通发送、工具、审批、历史与取消 | 不依赖 ANSI 猜测；协议进程与原生 TUI 的区别已在 UI 表达；跨运行方式继续是显式操作 |
| P4：扩展与恢复完善 | 逐个引擎扩展能力、重连与资源预算；确有能力时增加原生 TUI attach | 每个引擎独立通过兼容矩阵，不能由首个适配结果推定全部支持 |

Codex 的 P1 可直接验证双向切换，不必把只读投影作为必经产品阶段。其它 CLI 的只读投影仍只是过渡。P2 的 Janus 双向切换依赖其运行时接缝；一个引擎通过不能推定其它引擎也支持。

以下保留完整目标的验收清单，并非全部已通过；实际证据与未交付边界以上述 P1 当前实现为准：

- 在空闲、流式输出、工具执行、审批等待、完成和失败时连续切换终端/对话，始终只有一个可见界面；进程数不增加、输入不重复、草稿不丢，原生 TUI 状态保留。
- 对声明完整支持的引擎，终端发送后在对话继续提问，再切回终端继续交互，使用同一 session/execution 和上下文；只读查看、命令 shell 或新会话交接均不能替代。
- 流式→完成→历史恢复后，文本/工具顺序和身份一致；同名并行工具、重复事件、迟到事件、事件缺口均可正确处理。
- 对话默认呈现正文、工具摘要、变更和产物卡；不搬运终端横幅、重绘与重复状态。长输出可展开，失败和待审批始终可见；简化显示不删除执行证据或改变模型上下文。
- 切换瞬间旧视图的迟到输入/审批与新视图操作相遇，业务最多执行一次；重复 commandId 返回同一回执，断线时未知发送不会自动重发。
- 终端拥有控制权时，对话没有可误发的发送/审批按钮；原生草稿和 IME 输入不被接管动作破坏。
- 切换工作区、拖拽会话 pane、切换显示或关闭会话页面不误杀会话；显式结束运行才释放对应资源；重启不误续发任务。
- 同路径不同 worktree、同 cwd 不同会话、父子 Agent、远端同名路径不串数据；共享 checkout 的变化不虚称单一 Agent 归属。
- 变更卡与现有 Island 使用同一记录；快照不可用显示未知；撤销先核对当前文件，不覆盖后续人工修改。
- 产物半写、重写、删除、超大文件和历史版本缺失有明确状态；预览关闭后不反复抢开，未保存编辑不被刷新覆盖。
- 长会话分页/虚拟化保持滚动和文本选择；在持续输出中反复切换模式，并打开 diff/HTML，测切换响应、输入延迟、内存和后台 CPU，按同机单模式基线判断回归。
- 旧会话与旧布局可回退；普通 Chat、蓝图与运行配置助手的既有专属工具和审批不因组件复用退化。

## 取舍与仍需验证的事项

完全替换终端能简化 UI，但会失去原生 CLI 特性，不符合本次目标。把 ANSI 正则解析为聊天实现快，却在全屏、重绘、工具归属和审批上不可靠。对两个模式分别启动 Agent 可以独立工作，但应明确是两个会话，不能用来兑现同一会话双显示。直接搬入 Codeg/ZCode 整体架构会引入不必要的宿主、运行时和协议迁移成本。

当前采用双数据通道、统一会话控制与共享内容 renderer。成本主要是每个引擎的结构化能力、恢复映射和输入控制测试；UI 组件只是其中一层。Codex 0.166.0 和 Claude 2.1.316 均已通过固定版本的同实例探针、产品接入及 localhost 桌面验收；Claude 已支持会话模型／强度选择，原生默认标签、复杂审批及子代理控制仍有上述限制。其它 CLI、安装版本矩阵、Janus 接缝与持久显示 journal 仍待实施。首版范围为本地新会话，不把移动端和远程双控制加入承诺。

产品方向可以成立：JanusX 从以终端为主的工作区扩展为同时容纳终端与结构化 Agent 对话的工作区。关键成果是用户能持续看见同一工作的输入、过程、结果和产物，并清楚知道当前在哪个界面控制它。


## 直接进入对话的初始化状态

首份快照尚未返回与原生连接 starting 均属于初始化阶段，不作为只读能力判定，也不要求用户转往终端。输入框保留可编辑草稿、发送等待连接就绪；模型与思考强度入口先显示禁用的占位标签，接收原生快照后显示实际值并开放受支持的设置。只有快照明确不支持 submit 时显示只读提示，needsTerminal 仍提供终端入口。没有设置能力的引擎也展示原生已返回的模型与思考强度，不推测缺失值或补造修改能力。

回归入口：`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1`。新增可控的无快照→starting→ready 流程，检查加载提示、模型/强度同步、草稿保留、发送禁用与真实只读能力；夹具验证不替代真实供应商或 Electron 启动验收。

## OpenCode 会话模型与强度设置

2026-11-01 在 Windows OpenCode 2.1.4 的隔离服务确认原生支持会话设置：`GET /api/model`、`/api/provider`、`/api/model/default` 按 `location[directory]` 返回当前工作目录的目录与默认模型；`POST /api/session/{id}/model` 接收 `{ model: { providerID, id, variant? } }`，`GET /api/session/{id}` 返回确认后的选择。未传 variant 时原生读回 `default`。在线[模型说明](https://opencode.ai/v2/docs/models/)与[API 文档](https://dev.opencode.ai/v2/docs/api)用于核对概念，兼容依据是本机固定版本实测；其它版本不再被版本门控拦截，实际兼容性由协议行为决定。

OpenCode adapter 独立开启 settings 能力，不修改 Pi/DSH 的基类默认能力。模型以 provider/id 区分，筛除未启用模型及不可用 provider，IPC 仅发布名称、身份和 variants，不传含凭据的原生 settings。强度选择保留原生 variant 名称和顺序并提供默认值；variant 也可能代表供应商自定义参数组合，不承诺所有模型具备相同思考档位。无 variants 的模型只显示默认值。设置只影响当前会话，不改全局配置，不提交模型提示词。

空闲且无待处理审批时允许修改；过期控制代次、重复并行设置、设置期间发送或切换视图均拒绝。确认来自原生会话读回；请求失败仅读回一次，不重发修改，无法确认时停用对话控制。已有 250ms 轮询增加会话设置读取，原生 TUI 修改可同步回来；修复前从历史 assistant 消息更新模型的逻辑已移除，设置代次屏蔽修改前发出的迟到轮询结果。终端代理在对话拥有输入或设置进行中拒绝原生 model/prompt 写入。额外轮询有本机请求成本，后续如统一事件订阅，应保持相同确认和过期结果边界。

验证入口：`npx vitest run tests/unit/opencode-conversation.test.ts --project=unit` 覆盖目录隔离、凭据不进入快照、默认值、忙碌/过期/并发控制、失败读回和轮询竞态。设置 `JANUSX_TEST_OPENCODE_BIN` 为本机 2.1.4 后执行 `npx vitest run tests/unit/opencode-conversation-cli.test.ts --project=integration`：隔离配置、真实服务与 TUI、localhost 模型，验证切模型及自定义 variant 后对话和终端的实际请求均使用新模型/强度，设置本身不调用模型，原生接口改回默认后对话同步。`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 验证公共输入框的模型选择、自定义强度、恢复默认和草稿保留；这是 IPC 替身界面测试，本轮没有完整 Electron OpenCode 验收。

## OpenCode?Pi?DSH ?????????

???????? AgentSessionPane?AgentComposer??????????????????????????????????????????????? PTY???????attach-only ??????Codex update_plan ???????????????? adapter ???????? Agent ????? todo?

| ??????? | ????????? | ?????? |
| --- | --- | --- |
| OpenCode 2.1.4 | ?? loopback serve ????? TUI ?? --server/--session?API ???? session | ????????????????? 250ms ???????????? 200 ??????????? 500 ???? |
| Pi 0.85.1?npm ? @earendil-works/pi-coding-agent? | ?? TUI ? session-scoped --extension?message_*?agent_start?agent_settled ? sendUserMessage/abort | ???????????????agent_settled ?????/???? |
| DSH 0.2.0-rc.2 + dsh-tui 0.12.0 | ?? --patch ????? Cordis ???agents registry?session/event?agent/assistant-stream?followup/cancel | ??????????????????? Agent??????????? |

???????????????????????????OpenCode ?? pending permission/form?DSH ?? approval/request??????????Pi ?????????????????????????????????? DSH ??? hook/usage ????????????? registry ???? session id??????????? token ???

???? src/main/terminal/native-conversation.ts?extension-conversation.ts?opencode-conversation.ts ??????? native-bridge.js?pi-extension.js?dsh-extension.js??????? loopback???????? token????????????????????Origin ????????????????reload ???????????????????????????????? 32000 ???????????????OpenCode ???????????????????????? session ???????????????????????????????/??? controller ????????????

Windows npm ???????????????????????????? CLI ???? tests/unit/{opencode,pi,dsh}-conversation-cli.test.ts????? JANUSX_TEST_OPENCODE_BIN?JANUSX_TEST_PI_BIN?JANUSX_TEST_DSH_BIN ?????Vitest integration ??? worker ???????????????? TUI ????????? session??????????OpenCode/Pi ?????????????????? HTTP ?? DSH ??? llm/stream ???????????

DSH ??? TUI 0.12.0 ??????????? profile???????????? runtime/???????????/global TUI ?? junction ??? DSH_HOME ????????? dsh-session-persistence-jsonl??????????? profile ?????????????? profile?DSH ???????? Esc ?????????????????????????????

?? unused ??????? ESLint??????????????Notes ?? 321 ??0 ???17 ??????????????????? 38 ????controller/??????????Codex/Claude ???????????? UI 17 ?????????? DSH ????? DSH ???? DeepSeek ??????????????????????????????? Electron ?????????????????????????? CLI ?????????????????????
