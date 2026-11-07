---
{
  "schema": "harness-note/2",
  "id": "be9da2fc-754c-490b-ae77-eddfb4dcd3d2",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-16",
  "updated": "2026-11-07T12:46:03.452Z",
  "class": "feature",
  "tags": ["chat", "timeline", "agentX-parity", "blueprint", "launch-assistant"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/54b1046a-2c23-4bd0-acc5-7ddcd7f3a343"}
  ]
}
---

# Chat 工作时间线与入口扩展工具展示

## Expected behavior

普通 Chat、蓝图对话、运行配置助手应呈现 agentX 风格的工作过程：工作说明、模型公开返回的推理内容或摘要、工具调用和后续回答按实际发生顺序交错展示。用户可以理解 Agent 正在做什么，以及工具结果如何引出后续行动。没有公开推理内容的模型仍可展示实际输出的工作说明和工具状态，不生成虚假的推理，也不承诺取得模型内部未公开的思维链。

三个入口共享过程顺序、阶段生命周期与基础交互，各自保留独立工具集、权限、结构化结果和专属操作。统一时间线不能把入口扩展工具全部降级为通用的“调用成功”卡片。当前实现已接入三个入口；具体边界、验证命令和结果见下文。

## Interaction target

用户应在同一条助手回复内，边执行边看到过程自然向下延伸。每段工作说明和公开推理紧邻相应工具，后续分析继续追加在工具之后，最后给出回答。例如：“先检查启动入口” → 推理段 A → 读取配置工具 → “发现脚本引用异常，继续查找入口” → 推理段 B → 搜索工具 → 修改草稿的专属结果 → 最终回答。这个次序是示例，不要求模型每次调用工具前都额外生成一段说明，也不推断输入中没有的因果关系。

完成后保留同样的段落顺序，不把全部推理重新聚到顶部、全部工具移到末尾，也不再追加一份合并正文造成重复。工具结果在原位更新，最终回答正常渲染 Markdown。过程应以紧凑的文本段和工具行呈现，不把每个 token、阶段切换或心跳都渲染成独立卡片；“时间线”描述有序过程，不要求时间轴装饰或另开日志面板。

助手公开正文和最终回答始终直接可见，使用正常正文颜色。连续工具与公开推理从执行中起默认收起，不等待最终答案；正文、用户消息、阻断错误和图片结果中断分组，分组不跨轮次。折叠行以最近仍运行的操作为主，全部结束后保留最后一项操作；纯推理执行时显示“正在分析”，无可用预览时显示“执行记录”。状态、计时和活动数作为辅助信息，并行活动显示额外运行数。失败工具以“含 N 项失败”保留，不把局部失败概括为整轮失败；拒绝、中断和未知状态分别显示，单项截断显示“输出已截断”。会话历史裁剪仅由顶部提示表达，不污染完整活动组。第一次展开显示有序活动，工具参数与输出可再次展开。审批、提问、阻断错误及 Note／配置业务结果保持在折叠区外。

分组使用首条活动的稳定身份，后续增量和完成事件不改变用户的展开选择。JanusChat 与运行配置助手在流式回复进入历史时保存该选择，会话切换时重置。推理正文在工作过程内部使用较浅主题文字和最大 240px 的滚动区；单段手动折叠时保留实时尾行，结束后停止光标及计时。摘要沿用模型公开返回的首个有效行，不额外生成推理内容。

思考、写入、执行工具和等待审批按实际阶段切换。推理段 A 在工具开始时已经结束，即使整个轮次仍在运行，也不能继续给它显示“思考中”或增长其耗时。后续推理段 B 独立追加；轮次总耗时与单段耗时分别计算。

三个入口的输入框、用户消息和助手输出（包括公开推理）支持原生拖动框选及 Ctrl+C 复制。消息区与文本输入显式设置 `user-select: text` 和 `-webkit-app-region: no-drag`，覆盖浮层祖先的禁止选择规则；标题、按钮和拖拽手柄沿用各自交互。

## Current implementation

Island 与 AgentSessionPane 共用 `work-output.ts` 的相邻活动分组、状态统计和 `WorkDisclosure`，正文沿用共享排版。折叠仅影响展示，不删除事件或改变模型上下文。Note 结果及撤销、配置校验和应用状态按调用身份显示在对应过程组之后，不随日志隐藏，也不因展开重新执行。折叠内容首次展开前不构建；展开后收起保留当前挂载子树，以保存内部明细选择，历史行卸载仍交给既有虚拟列表。成本是已访问的可见行在收起后仍占用节点，不承诺折叠立即释放所有 DOM。

`chat-model-stream.ts` 使用独立的 `ai-chat`（AI SDK 4.3.19）消费端，`withChatStreamCompatibility` 从原始 provider 模型恢复公开推理增量，再转成 agent-core 接受的事件。非 Chat 消费者继续使用原 SDK 及原兼容路径。不能只删除旧兼容层的忽略项：旧消费者不能读取新 reasoning 协议。

`src/shared/chat-timeline.ts` 持有 version 1 展示快照与纯 reducer。相邻文本或推理增量合并；类型切换、工具准备和执行、模型结束、等待提问会结束前一文本段；工具依据 `callId` 原位更新。`chat-tool-events.ts` 用 AsyncLocalStorage 隔离并行调用，把同一身份带入 Note/配置业务事件，并在工具完成时立即发送脱敏 trace。结束后再发送整轮 trace 的旧回填路径已移除，避免 listener 解绑后丢失结果或重复展示。

`useJanusChat` 累计并提交快照，`JanusChat` 按快照渲染；没有快照的旧消息仍保留正文，推理及工具组默认收起，不伪造历史交错顺序。`ChatTimeline` 复用 `ThinkingRegion` 与 `ToolCallCard`，公开推理在外层过程展开后可读，各段独立计时。摘要保存开头预览，即使正文按尾部截断也保留首行。三个入口共享布局。停止、异常和请求结束收敛工具与文本状态；已经进入历史的调用从旧运行时工具列表排除，恢复失败不会重复卡片。

运行配置 service 使用同一 reducer，`ProjectLaunchAssistant` 使用同一 renderer。`config_change` 只在 controller 消费一次以回填表单；展示快照仅投影摘要、校验与应用状态。`launch-config.get/edit/apply` 的安全结果摘要也进入原调用卡，分别显示读取、草稿修改和写盘结果；工具成功不等于配置已应用。

[已有反馈设计](../janus-chat-feedback-parity.md)仍记录状态行、折叠区及主题规则；本文负责后续交错过程。

## Tool extensions

| 入口 | 必须保留的展示与行为 |
| --- | --- |
| 普通 Chat | 已接入工程及其他扩展工具的调用状态、参数与结果摘要，支持专属展示和通用卡片兜底。 |
| 蓝图对话 | Note 读取、定位、修改以及提案、审批、修复进度等已有专属能力；关联文档、变更与业务状态。 |
| 运行配置助手 | 草稿回填、校验结果、配置差异及应用状态；区分工具执行成功、草稿已修改和配置已落盘。 |

工具生命周期事件与 `note_change`、`config_change` 等业务事件需要可靠关联，避免同一操作出现互不相关的重复卡片。专属交互可以按需保留在入口区域，通过稳定标识与时间线对应；不要求把所有业务面板都搬进工具卡。

展示扩展只决定如何呈现，不决定工具能否调用。controller 负责草稿回填、审批和应用等业务效果；渲染、展开卡片、切换页面和恢复历史不得重新执行操作。历史卡片展示当时结果，操作按钮按当前业务状态检查可用性。参数与结果继续沿用各入口的脱敏边界；含真实配置值的业务载荷只供现有业务处理，不能未经处理直接作为工具摘要展示、归档或加入模型上下文。

实际工具与位置清单如下。工具清单来自共享运行时注册表及各入口的白名单，展示注册不扩大权限。

| 工具或扩展 | 位置与交互 |
| --- | --- |
| 普通 Chat 的 workspace、git、command、project 等共享工程工具，以及未知 MCP/扩展 | 调用位置的通用 ToolCallCard；展示脱敏参数键、结果摘要、错误与耗时，支持展开。审批、todo、提问仍由既有 controller 槽处理。 |
| 普通 Chat 的 Memo 扩展 | 保留 memo_created 的会话绑定和既有 MemoPanel，通用工具卡标识调用；展开和恢复不重建 Memo。 |
| 普通 Chat/蓝图的共享 Note 读取、写入，以及 note.focus、note.scope | NoteTimelineDetails 在对应调用内复用 FocusNoteList 与 ChangeCard，保留定位、加入关注、差异查看和撤销预检。快照只存变更记录引用，历史按 checkout/conversation 读取既有记录；未带调用身份的旧事件仍走轮次或底部区域。 |
| 蓝图提案与 Note 修复 | 继续使用既有提案、审批与 NoteRepairCard；不把维护结果或修复状态误认为普通工具结果，不因过程回看触发实施。 |
| 运行配置 workspace.list/read、project.detect | 原位通用工具卡；仍为只读理解工具。 |
| 运行配置 launch-config.get/edit/apply | 原位展示读取/草稿/写盘状态及校验错误、警告；完整草稿、差异和写盘审批继续在配置窗口业务区域。 |

## Retention and boundaries

agent-event 是过程增量的唯一来源；legacy delta 仅在未使用 agent-event 时回退。请求身份及 controller generation 隔离迟到事件。运行配置的模型历史显式只投影 role/content，Chat 也不把 timeline 发送给模型。工具上下文 trace 与展示专属回执分开；真实配置值不进入展示快照。

单轮最多 256 块，累计文本保留 200,000 字符；每个推理段保留末尾 4,000 字符和开头 512 字符摘要预览，工具元数据另受约 1,000,000 字符预算。超限淘汰较早块并显示提示。只在阅读位置接近底部时跟随，向上阅读不强制滚动。

普通 Chat 的有序快照随现有消息历史持久化。蓝图沿用[工作区对话生命周期](../../blueprint/maintenance/tasks/blueprint-workspace-dialog.md)：关闭重开保留过程，切换工作区、主动清空和应用重启清除面板历史；本需求没有改为跨重启恢复蓝图会话。运行配置按 checkout 路径与项目相对路径在本地保存最近 40 条，序列化总量最多 1,000,000 字符；恢复只展示历史，不重放表单回填、审批或写盘，关闭时保存并收敛未完成过程。

保留旧 SDK 加独立 Chat 消费端增加一个依赖，但避免整仓 SDK 迁移。若以后所有消费者都支持同一推理协议，应合并 SDK。历史中的 Note 记录若已删除，卡片显示不可用提示；撤销始终重新检查当前事务状态。没有模型公开推理时，仅显示实际文本和工具，不补造内容。

## Acceptance criteria

- [x] AC-1: 三个入口均按实际事件次序展示“工作说明或公开推理 → 工具 → 后续说明或推理 → 回答”，流式与完成后顺序一致，正文无重复。
- [x] AC-2: 支持公开推理的模型，其内容通过实际模型适配路径到达展示；不返回公开推理时仍正常显示工作说明与工具过程。
- [x] AC-3: 三个入口各自扩展工具保持专属语义、状态与交互；蓝图文档能力和运行配置草稿、校验、应用能力无退化，工具调用成功不被误标为业务已应用。
- [x] AC-4: 同一次工具调用的生命周期与业务结果正确关联，卡片原位更新；同名重复调用和并行工具不会串卡或产生重复结果。
- [x] AC-5: 停止、失败、重试、会话切换均保留已有过程并隔离请求；迟到事件不污染其他轮次或会话。
- [x] AC-6: 新历史恢复后可回看有序过程；旧历史正常回退。恢复、展开或重渲染不触发工具、草稿回填或应用操作，历史按钮按当前状态判断可用性。
- [x] AC-7: 展示快照不自动进入模型上下文，工具权限与脱敏边界保持有效；超限截断有明确提示。
- [x] AC-8: 三个入口覆盖长过程、展开收起、滚动与主题验证；用户向上阅读时不被强制拉回底部。
- [x] AC-9: 同一轮有两段推理、两段工作说明及多次工具时，执行中和完成后均保持交错顺序；正文及回答使用正常颜色并始终可见，连续工具／推理默认收进过程摘要。展开后可按序回看，完成不重复正文或重置用户选择；失败、中断、截断仍有可见状态。单段推理结束后停止光标和计时。
- [x] AC-10: 推理段、工具和整轮各自准确结束；工具执行期间前一推理段不继续显示“思考中”，停止或异常后无未收敛的加载状态。
- [x] AC-11: 实施前完成三个入口实际扩展工具与展示位置清单；验证普通 Chat 的工程操作、蓝图的文档读取与修改或审批、运行配置的读取与草稿修改及校验。至少覆盖一个已有专属业务结果，并验证业务事件早于工具完成时仍只关联到正确调用。
- [x] AC-12: 新过程数据验证真实模型适配链路，三个入口分别验证完整流式与结束后的界面。仅向 renderer 注入 `reasoning_delta` 的测试不能作为模型事件已打通的证据。

## Verification

2026-11-07 操作摘要与状态归属调整：Main 直接 xdo 自检，`conversation-output`、`native-conversation`、`codex-conversation`、`claude-conversation`、`opencode-conversation` 单测 61 项通过，`conversation-turns`、`chat-timeline` 另 8 项通过。浏览器命令 `npx playwright test tests/e2e/conversation-work-disclosure.spec.ts tests/e2e/claude-progress.spec.ts tests/e2e/chat-work-timeline.spec.ts --project=island --workers=1 --timeout=60000` 覆盖五类 CLI、三个 Chat 入口、截断与未知状态分离、局部失败、展开选择、计时和长过程滚动。计时夹具先等待会话就绪，再暂停时钟并精确推进，避免冷启动丢事件与真实时间漂移。类型、双语和相关源码 ESLint 检查通过；Notes 为 0 errors、17 条既有外部链接诊断。已检查 `artifacts/claude-progress/activity-dark.png` 与 `activity-light.png` 的 380px 布局。未配置真实 CLI 证据的集成测试及原生快照回放跳过；未执行 Electron 打包或真实供应商验收。

2026-11-02 过程摘要调整：`npx vitest run tests/unit/conversation-output.test.ts tests/unit/conversation-turns.test.ts tests/unit/chat-timeline.test.ts` 的 17 项通过。浏览器按文件与 grep 分轮运行 `npx playwright test ... --project=island --workers=1 --timeout=60000`，覆盖 `chat-work-timeline` 14 项、`conversation-work-disclosure` 5 项、`conversation-virtual-history` 2 项、`janus-chat-theme` 6 项以及 `codex-conversation` 的 completed work disclosure 2 项，共 29 个不同用例通过。覆盖五类 CLI、三个 JanusX 入口、失败／中断摘要、Note 撤销、配置结果、复制、两种主题、窄窗和历史滚动。运行配置助手曾在转入历史时丢失手动展开选择，补上作用域保存后该用例连续三次通过。

本轮类型检查、双语键检查通过；定向 ESLint 为 0 errors，保留 JanusChat 既有 4 条文案 warnings。Note 检查为 321 篇、0 errors、17 条既有外部链接诊断；查看了 `artifacts/work-disclosure-narrow.png`。桌面 `run-config-assistant.spec.ts` 已同步展开前置条件，本轮未重跑桌面测试、打包或调用真实供应商。这些证据验证展示与交互，不新增模型协议兼容性结论。

2026-10-16 原生选择修复：设置 `JANUS_E2E_PORT=41739`、`NO_PROXY=127.0.0.1,localhost` 后，`npx playwright test tests/e2e/chat-work-timeline.spec.ts --project=island --workers=2 --grep 'native selection'` 的 3 项通过。三个入口均实际拖动选择输入框、用户消息、公开推理和回答，再用 Ctrl+C 并读取剪贴板核对；测试显式设置外层 `user-select: none`。同文件既有 11 项过程回归在本轮完整运行中通过；新增测试随后修正了重复文本定位和入场动画等待。未验证 Electron 原生窗口。

2026-10-16 可见性调整：`npx vitest run tests/unit/chat-model-stream.test.ts tests/unit/chat-timeline.test.ts tests/unit/janus-reasoning.test.ts tests/unit/llm/chat-turn-guard.test.ts` 共 39 项通过；`npm run typecheck` 通过。设置 `JANUS_E2E_PORT=41739`、`NO_PROXY=127.0.0.1,localhost` 后运行 `npx playwright test tests/e2e/chat-work-timeline.spec.ts tests/e2e/janus-chat-theme.spec.ts --project=island --workers=2`，17 项通过，覆盖三个入口默认展开、完成后保留、恢复、手动折叠和过程颜色。此轮未运行桌面 Electron 验证。

本次为 Main 直接 xdo，未创建执行 Task，未声称独立评审。验证使用确定性 provider 数据及本地 HTTP 模型服务，没有调用外部付费模型。

`chat-model-stream.test.ts` 经过实际兼容层与 SDK；`llm/chat-turn-guard.test.ts` 的 provider 用例继续经过真实 agent loop 到 IPC，检查两段推理及两段文本的顺序。`run-config-assistant.spec.ts` 使用本地 HTTP Responses 流与应用实际 OpenAI provider，覆盖三段推理/工作说明、配置读取、修改、审批、写盘、长回复和完成后原序回看。它不是仅向 renderer 注入 reasoning_delta 的证据。

`chat-work-timeline.spec.ts` 分别覆盖三个入口的两段推理、多次同名工具、展开收起、完成后顺序、停止与迟到事件、长过程滚动和主题切换；另覆盖运行配置早到业务事件/恢复不重放，以及蓝图 Note 原位结果与撤销冲突。`janus-chat-theme.spec.ts` 和 `blueprint-chat-recovery.spec.ts` 保留主题与恢复回归；工作台测试先打开当前默认收起的 Copilot。

最终验证：相关 13 个单测文件共 110 项通过；`npm run test:llm-core -- tests/stream-compat.test.ts` 的 6 项兼容回归通过。浏览器命令 `npx playwright test tests/e2e/chat-work-timeline.spec.ts tests/e2e/janus-chat-theme.spec.ts tests/e2e/blueprint-chat-recovery.spec.ts --project=island --workers=2` 共 25 项通过；桌面命令 `npx playwright test tests/e2e/run-config-assistant.spec.ts --project=desktop --workers=1` 对 `artifacts/build-check/main/index.js` 的最新构建有 1 项通过。Windows 本机验证设置 `NO_PROXY=127.0.0.1,localhost`，避免本地夹具经过系统 HTTP 代理。

`npm run typecheck:strict-unused`、`npm run build:check`、`npm run i18n:check` 和 `npm run check:package-boundary` 通过。变更源文件定向 ESLint 为 0 errors，JanusChat 的既有中文文案有 4 warnings。`npm run check:notes` 为 315 篇、0 errors、17 项既有显式链接诊断；这些诊断不是本次需求的未解析引用。未执行全仓 verify、打包发布或外部真实模型请求。
