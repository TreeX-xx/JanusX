---
{
  "schema": "harness-note/2",
  "id": "f481b0db-5010-45f8-9723-50b0c8fca03a",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-07",
  "class": "architecture",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/services/workspace-launch-assistant.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/ProjectLaunchAssistant.tsx",
      "role": "implementation"
    },
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/llm/chat-orchestrator.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/harness/launch-config-chat.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/shared/launch-config-chat.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/harness/note-chat.ts","role":"entry"},
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "tests/unit/workspace-launch-assistant.test.ts",
      "role": "test"
    },
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/unit/launch-config-chat.test.ts","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/e2e/run-config-assistant.spec.ts","role":"test"}
  ],
  "updated": "2026-11-20T12:09:55Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---

# 运行配置助手受限工具面与专属配置编辑工具

## Problem

运行配置窗口右栏（`ProjectLaunchAssistant.tsx`）与原生 Janus chat 只共用传输层：对话经 `chatStream`（`src/renderer/src/services/llm.ts`）进入 `handleChatStream` → `runChatTurn`（janus-agentX facade），流式增量、中止与单轮锁走共享管线；能力层一律绕开。助手不传 `workspaceResources`，`runChatTurn` 的工具装配拿不到 trusted resources，模型无工具可调；配置交换自造文本协议——模型在正文末尾输出 `<janus-launch-action>` 包裹的全量 `LaunchConfig` JSON，渲染端 `parseLaunchAssistantResponse` 用正则与 JSON.parse 剥离后整体替换中栏表单草稿。save/test/run/stop 由渲染端回调直连 `projectService`，不经任何工具面。

这套走法有四个缺口。其一，配置编辑没有粒度：改一个 env 也要重发整包配置，与用户在中栏表单的手改冲突时整包覆盖。其二，校验不回灌：`ValidationResult` 不回模型，生成非法配置时模型无从自修。其三，讨论上下文死限于 `analyzeWorkspaceLaunch` 预载的至多 5 份 manifest 摘录，「看看 package.json 的 scripts」这类请求无法满足。其四，`sourceTag: 'janus-chat'` 让助手闲聊进个人画像：janus-agentX 的 `chat-turn.ts` 在 `sourceTag === 'janus-chat'` 判点注入 `prepareJanusChatRecall` 召回、调用 `captureTurn` 轮内观测；`chat-orchestrator.ts` 轮末在 `sourceTag === 'janus-chat' && domain !== 'project'` 判点写 `capturePersonEpisodeFromTurn` / `capturePersonChatTurn` 个人时间线。运行配置的生成讨论不属于个人画像素材。

产品诉求是一句话生成运行配置文件——用户说「运行 debug 版 start.exe」，助手读取工作区证据后生成对应运行配置文件；右侧可附带工作区讨论。能力边界经产品裁决：读工作区理解与 chat 板块同款，不能运行脚本，不能使用通用编辑工具，编辑运行配置只能经专属扩展工具。

## Decision

实现已迁入 agentX，文件归属见[工具迁移清单](../../../docs/migrations/agent-tools-engine.json)。launch-config.get/edit/apply、局部操作／脱敏、项目检测／配置生成与校验均由引擎维护。JanusX 旧文件保留兼容导出，仍负责工具轮次接入、审批 UI 与 config_change 表单桥接；实际进程由既有 ProjectRunner 通过窄端口提供。下文历史实施路径指向这些兼容入口，授权与固定工具面不变。

**右栏助手定为「只读理解 + 专属写入」的受限工具面**。能力矩阵：

| 能力 | 予夺 | 落点 |
|---|---|---|
| 读工作区、理解上下文 | 予 | 只读工具族 `workspace.list` / `workspace.read` / `project.detect`（git 只读按需可选） |
| 理解自然语言需求 | 予 | 单轮流式对话，历史由渲染端自持 |
| 运行脚本、命令 | 夺 | 不提供 `command.*`、`project.start-process`、`project.stop-process` |
| 通用编辑工具 | 夺 | 不提供 `workspace.write`、`note.*`、git 写工具、`user-memory.*` |
| 编辑运行配置 | 予，唯一写入口 | 专属工具族 `launch-config.*` |
| 生成运行配置文件 | 予 | `launch-config.apply` 校验后落盘 `.janusX/janusX.launch.json`，走既有 config-apply 审批框（i18n `editor:project.approvalRequest`） |
| 会话管理 | 夺 | 不接 `managed-chat-session`；历史 `messages.slice(-8)` 自持 |
| 个人画像采集 | 夺 | `sourceTag` 换 `'launch-assistant'`，画像三闸全不命中 |

两个附带裁决随边界确定：`<janus-launch-action>` 文本协议整体退役，配置只经工具面交换；`action: test/run/stop` 从模型语义中删除，测试、启动、停止退回窗口工具栏的人类按钮（Play / Test / Stop 既有）。

**待确认两点**（实施前向用户落定；新会话可按默认推进，用户反对再改）：

1. run/test/stop 的模型触发永久移除 —— 默认「是」，这是「无法运行脚本」的直接推论。若用户要求模型一键运行，属例外开口子，须回本 Note 记录。
2. 生成落盘时机 —— 默认「生成即 `launch-config.apply`，弹一次审批即文件落盘」，贴合「生成运行配置文件给我」的直给语义。备选「只更新表单草稿，用户手点保存」。

## Proposal

实施分六步，顺序即合入顺序，第 1 步可独立先行。（进度 2026-10-08：六步全部落地——工具面经 `launchDraft`/`workspaceResources` 点亮、`config_change` 回表单、`toolTraces` 回放、`<janus-launch-action>` 协议退役、`onSave/onTest/onRun/onStop` props 收缩、测试改写为工具面；单测 + 桌面 e2e 全链（受限工具面 + edit→表单 + apply→审批→落盘）全绿，本 Note 已置 `implemented`。）

**1. sourceTag 切割（画像隔离，独立小步）**。把 `src/shared/ipc/llm.ts`（`ChatRequest` 公共契约）、`src/renderer/src/services/llm.ts`、`src/main/ipc/llm-handlers.ts`、`src/main/llm/chat-orchestrator.ts` 四处的 `sourceTag?: 'janus-chat'` 字面量类型放宽为 `'janus-chat' | 'launch-assistant'`（`ChatStreamRequest` 与非流式 `chat` 同源改；原文记三处，实测公共契约另持一份）。`streamWorkspaceLaunchAssistant` 改传 `sourceTag: 'launch-assistant'`。切割后 `chat-turn.ts` 的召回注入与 `captureTurn`、`chat-orchestrator.ts` 的轮末个人时间线写入三闸全不命中，`recallTrace` 转发同闸门一并停。回归测试以 `tests/unit/knowledge/janus-chat-recall.test.ts` 与 `tests/unit/knowledge/user-turn-capture.test.ts` 为反证基座，钉死 `'launch-assistant'` 轮次零召回、零采集、零时间线写入。**（已落地 2026-10-08：反证测试 3 项——工作区已绑定与无工作区两形状下零 `search`/`capture`/`capturePersonTurn`/`capturePersonEpisode`、零 `recall-trace` 事件，加 `workspace-launch-assistant.test.ts` 源头钉 `sourceTag: 'launch-assistant'`；`tsc` 干净，四测试文件 42 项通过。）**

**2. 双闸工具面**。`ChatStreamRequest` 新增可选 `toolAllowlist?: string[]` 与 `toolGate`，在 `handleChatStream` 组装 `runChatTurn` 请求处透传给 `ChatTurnRequest`。janus-agentX 的 `chat-turn.ts` 既有机制承接：`toolAllowlist` 归一化过滤工具供给（未列入即不提供给模型），`toolGate` 在调用点拦截并返回 `{ block: true, reason }`（reason 回灌模型）。助手轮次固定 allowlist：`workspace.list`、`workspace.read`、`project.detect`、`launch-config.get`、`launch-config.edit`、`launch-config.apply`；git 只读（`git.status` / `git.diff`）按需追加；`project.process-output` 只读进程日志，默认不放行。`toolGate` 兜底拦截 allowlist 之外的一切调用（含未来新注册工具）。双闸用法照 `src/main/harness/desktop-task-turn.ts` 的既有先例。**（已落地 2026-10-08：契约四处同型（shared `ChatRequest`、orchestrator `ChatStreamRequest`、llm-handlers 镜像、渲染端 `chatStream` 选项）；`handleChatStream` 以 `gateFromToolAllowlist` 派生兜底闸并在两处 `runChatTurn` 调用点透传，host 可另携策略闸（链式，allowlist 未命中先拒）；助手固定 allowlist 常量 `LAUNCH_ASSISTANT_TOOL_ALLOWLIST` 随每轮请求发出。偏离一处：`toolGate` 为函数不可过 IPC，共享契约只收 `toolAllowlist`，闸在主侧派生——与「兜底拦截」语义一致；主侧调用方仍可经 `ChatStreamRequest.toolGate` 注入策略。测试：guard 双闸 4 项（越界 block + reason 回灌、松散名匹配、策略链式、无 allowlist 不变），assistant 请求形状与固定面钉 2 项；`tsc` 干净，eslint 零 error，验证清单 5 文件 76 项通过。第 2 步的 `workspaceResources` 传递仍受包侧 `resolvesTrustedResources` 未认 `'launch-assistant'` 制约（见 Risks），只读工具族点亮留待包侧修复后随助手收编一并接线。）**

**3. 专属工具族（唯一写入口）**。新建 `src/main/harness/launch-config-chat.ts`（名可定）提供 `attachLaunchConfigTools(ports, options)`，照 `src/main/harness/note-chat.ts` 的 `attachNoteChatTools` 端口拦截模式：包一层 `executeFunctionCall`，名单内自处理、名单外回落 registry；不注册进全局 ToolRegistry，避免泄漏进通用 chat 的 staged offering。工具语义：

- `launch-config.get`：返回当前轮内草稿与 `ProjectConfig.validate` 结果。
- `launch-config.edit`：唯一编辑面。输入 `{ ops: [...] }` 或 `{ config: LaunchConfig }`。ops 词汇固定五种：`setField`（`path` + `value`，path 形如 `configurations[0].program`）、`addConfiguration`、`updateConfiguration`、`removeConfiguration`、`setEnv`（configuration 定位 + 键值对）。整包 `config` 是首次生成与推倒重来的逃生舱。每次应用的回执含草稿摘要与 `ValidationResult`，模型据此自修；连续两次修复仍非法则停手，把错误交还用户。
- `launch-config.apply`：`ProjectConfig.validate` 通过后写 `.janusX/janusX.launch.json`。审批复用 `ProjectSettings.tsx` `handleSave` 的既有回路——`agentRuntime.createSession` + `onEvent('approval-requested')` → `pendingApproval` → `resolveApproval` + `executeTool('project.apply-config')` 的 preview 形状。

编辑以 ops 为默认路径；进模型上下文的 env 值沿用 `redactConfig` 脱敏规则。**（已落地 2026-10-08：ops 引擎 `src/shared/launch-config-chat.ts`（`applyLaunchConfigOps` 五种 ops + `redactConfig` + `LaunchConfigChange`）与 `src/main/harness/launch-config-chat.ts`（`LAUNCH_CONFIG_TOOLS` get/edit/apply + `attachLaunchConfigTools` 端口拦截，含连续两次非法即停手、`[REDACTED]` 保持原值、`apply`→`project.apply-config` 带 preview 审批）全部落码；`chat-orchestrator.ts` 563-572 按 `sourceTag === 'launch-assistant' && launchDraft` 挂载并把 `onChange` 转 `config_change` 事件桥。但工具面尚未在真实路径点亮：渲染端 `streamWorkspaceLaunchAssistant` 未随请求发 `launchDraft`/`workspaceResources`，助手仍走 `<janus-launch-action>` 文本协议，激活依赖第 4/5 步切换。单测已补 `tests/unit/launch-config-chat.test.ts` 15 项（ops 五种 + 路径/查重报错、get/edit/apply、`ValidationResult` 回灌、两连非法即停手、`[REDACTED]` 保持原值、权限闸 `PERMISSION_DENIED`、`apply`→`project.apply-config` 带 preview 与 fallthrough），`tsc` 干净、eslint 零 error——工具族代码与验证完整，只差第 4 步接线点亮。）**

**4. 状态与事件**。草稿所有权留在渲染端表单：每轮请求把当前 `config` 脱敏副本送进上下文并随请求到达 main，`attachLaunchConfigTools` 以该副本为轮内文档；编辑经 `config_change` agentEvent（照 `note_change` 事件桥）回 `ProjectSettings.setConfig`，中栏表单即时反映。会话连续性不建：历史仍由 `ProjectLaunchAssistant` 自持 `messages.slice(-8)`，但每轮须把上一轮的 `toolTraces`（`ChatToolTraceEntry[]`）随 `ChatStreamRequest.toolTraces` 回放，否则模型上一轮读过的文件在下一轮从上下文消失。流式展示简化：正文不再夹带动作块，`visibleLaunchAssistantText` 的剥离逻辑随协议退役删除，delta 直出。**（已落地 2026-10-08：`LaunchConfigChange` + `config_change` agentEvent 进 `ChatAgentEvent` 契约并回 `handleAssistantConfig`（`applied` 时结算基线）；`streamWorkspaceLaunchAssistant` 每轮发 `launchDraft`（真实 config + `projectPath`）与 `workspaceResources`（`ProjectSettings` 建/复用 agent 会话）点亮 `attachLaunchConfigTools`；`toolTraces` 跨轮回放（`toolTracesRef` 累积 → `ChatStreamRequest.toolTraces` 回灌）；`visibleLaunchAssistantText` 退役、delta 直出。审批框复用 `ProjectSettings.pendingApproval`（新增按 workspaceId 捕 `approval-requested` 的常驻监听）。手测未跑。）**

**5. 退役清单**。`<janus-launch-action>` 协议与 `parseLaunchAssistantResponse`、`buildLaunchAssistantMessages` 的动作块指令段；`ProjectLaunchAssistant.applyResponse` 的 save/test/run/stop 分发与 `onSave` / `onTest` / `onRun` / `onStop` props。窗口工具栏的 Play / Test / Stop 人类按钮保留，运行脚本能力留在人手里。`analyzeWorkspaceLaunch` 保留为轮前证据构建（检测、候选配置、manifest 摘录仍是首轮上下文的来源）。**（已落地 2026-10-08：`<janus-launch-action>` 协议、`parseLaunchAssistantResponse`、`buildLaunchAssistantMessages` 动作块指令段、`visibleLaunchAssistantText` 全退役；`ProjectLaunchAssistant.applyResponse` 与 `onSave`/`onTest`/`onRun`/`onStop` props 收缩（Play/Test/Stop 留工具栏人类按钮）；`tests/unit/workspace-launch-assistant.test.ts` 改写为工具面/ops 回灌测试（10 项）。`analyzeWorkspaceLaunch` 保留为轮前证据构建。）**

**6. 实施顺序与验证**。顺序：① sourceTag 切割 + 反证测试；② `ChatStreamRequest` 双闸透传；③ `attachLaunchConfigTools` 三工具 + `config_change` 事件桥；④ `ProjectLaunchAssistant` 收编（协议退役、props 收缩）；⑤ `tests/unit/workspace-launch-assistant.test.ts` 从协议解析测试改写为 ops 应用与校验回灌测试；⑥ 本 Note 更新为 `implemented` 并在 `launch-config-chat.ts` 模块顶留逆向注释。验证命令：

- `npx tsc --noEmit`；触达文件 `npx eslint`。
- `npx vitest run tests/unit/workspace-launch-assistant.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/knowledge/janus-chat-recall.test.ts tests/unit/knowledge/user-turn-capture.test.ts tests/unit/assistant-ui.test.ts --maxWorkers=2`。
- 钉点断言：`'launch-assistant'` 轮次零 `captureTurn`、零个人时间线写入；allowlist 外工具调用被 `toolGate` block；非法 config 两连失败后错误回到用户而非静默重试。
- 手测场景：「运行 debug 版 start.exe」→ `launch-config.edit` 生成配置 → 审批框 → `.janusX/janusX.launch.json` 落盘 → 中栏表单与 diff 视图一致。

**（已落地 2026-10-08，全绿）**：`npx tsc --noEmit` 干净 + `--noUnusedLocals` 严格型检过 + 触达文件 eslint 零 error；74 项单测（`launch-config-chat`15 + `workspace-launch-assistant`10 + `llm/chat-turn-guard`17 + `note-chat`24 + `assistant-ui`8）+ `planche-theme`14 过。桌面 e2e `tests/e2e/run-config-assistant.spec.ts` 全链绿（`npm run build` 后 `--config=playwright.desktop.config.ts` 23s）：mock-LLM 驱动「运行 debug 版 start.exe」→ 断言受限工具面 → `launch-config.edit` 回中栏表单（出现 `debug-start.exe`）→ `launch-config.apply` 弹审批框 →「批准」→ `.janusX/janusX.launch.json` 落盘（`configurations[0].program='debug-start.exe'`）。第 6 步手测场景已自动化覆盖。**留痕**：e2e 用 mock-LLM 驱动工具调用，真 LLM 生成质量手测另属产品验收（非实现完备闸）；两个待确认默认值（run/test/stop 模型触发已移除、生成即 `launch-config.apply` 弹一次审批落盘）维持默认，用户反对再改；逆向注释已在 `launch-config-chat.ts` 顶。）**

## Alternatives considered

- 纯文本 ops 协议、不上工具循环 —— 最强理由是零 IPC 改动，单轮保持纯流式，实现最省。否决原因：能力边界以「工具」为单位定义（产品裁决「无法用通用 edit 工具，编辑得用独有的扩展工具」），文本协议只能靠提示词约束，`toolGate` 执行层卡不住它，也无法按工具粒度审计谁改了配置。
- 运行配置助手整体换用 `JanusChat` —— 最强理由是 composer 与消息流只剩一份实现。否决理由沿用 [右侧对话栏互认卡片语言与开场引导](../workbench/right-chat-column-card-language.md)：动作管线与会话控制器不同构；本决策消掉动作管线后矛盾缩小，但 `JanusChat` 自带的会话控制器、审批槽、todo 条仍超出「单发生成 + 轻讨论」场景，收编继续搁置。
- 专属工具注册进全局 ToolRegistry —— 最强理由是复用 `project.*` 既有注册与 staged offering 机制，零新接缝。否决原因：通用 chat 轮次将获得运行配置编辑权；专属工具必须只挂在助手轮次上，`attachNoteChatTools` 的端口拦截模式天然排他。
- 接 `managed-chat-session` 做会话管理 —— 最强理由是上下文压缩与工具回放免费获得。否决原因：场景是单发生成，产品裁决不要会话管理；`toolTraces` 回放已覆盖工具连续性的必要部分。
- 用 `domain: 'project'` 切画像 —— 最强理由是一行改动、免扩类型。否决原因：`domain: 'project'` 同时触发 `projectChatContext`、note 工具挂载与 project 记忆投递，把蓝图会话的包袱带进运行配置；`sourceTag` 是画像三闸的共同判点，换标签是精确切断。
- Do nothing / reuse 现状 —— 零成本、零回归风险。代价是四缺口持续：全量覆盖冲突、校验不回灌、讨论死限预载摘录、闲聊进个人画像。

## Risks

字段路径编辑拒绝 `__proto__`、`prototype` 和 `constructor`，并只遍历草稿自身的字段，避免模型提供的路径改变共享对象原型。对应单测验证根对象与配置项的原型路径均被拒绝。

- 工具循环把单轮从一次流式变成模型多轮工具往返，复杂配置的生成时延上升；以 `getMaxTurns`（`configService.getAgentMaxSteps`）封顶，超限报错交还用户。
- `config_change` 与用户手改表单并发：ops 只动被点名字段以降低冲突面，同一字段撞车仍以事件到达序为准；表单既有 diff 视图与 `baselineConfig` 兜底，用户可回看再改。
- allowlist 漂移：全局新增工具若被 staged offering 自动供给助手轮次会破边界；`toolGate` 兜底 block，allowlist 须在工具注册表变动的 review 中对表。
- `ChatStreamRequest` 扩型牵动 `llm-handlers`、preload、`electron.d.ts` 公共契约链路；字段全部可选，向后兼容，但三处类型须同步。
- 两个待确认点在实施前落定；默认值已记录，新会话可按默认推进。
- 包侧 `resolvesTrustedResources`（`@janus-agent/janus-agent` `chat-turn.js`）只认 `'janus-chat' | 'maintenance' | 'harness'`，`'launch-assistant'` 轮次不解析 trusted resources。**已用等价改法缓解（2026-10-08）**：`chat-orchestrator.ts` 把 `turnSourceTag` 在进 `runChatTurn` 前重映射 `sourceTag === 'launch-assistant' ? 'maintenance' : sourceTag`，借闭名单内标签解析工作区资源；画像三闸仍看请求上的 `sourceTag: 'launch-assistant'`，不受重映射影响（见步骤 1 闸门）。彻底修法仍是包侧认新标签（包升级）。第 4 步已接线：渲染端每轮发 `workspaceResources`（agent 会话）与 `launchDraft`，只读工具族与 `attachLaunchConfigTools` 今已吃到工作区根。

## Consequences

过程展示现使用[共享 Chat 工作时间线](./requirements/chat-work-timeline.md)：读取、修改与写盘回执按调用原位展示，完整草稿只由 controller 回填表单。按 checkout/project 保存的展示历史不会重放配置变更、审批或写盘；容量与恢复规则由该需求维护。

2026-10-18 的 README 实录发现：助手触发的审批在批准并写盘后仍留在中栏，手动保存路径则由 finally 清除。`resolvePendingApproval` 现于 IPC 正常返回后清除对应 ID 的审批，保留其间新到达的其他请求；IPC 拒绝时保留审批并显示错误。桌面 e2e 增加批准后审批栏消失断言，并显式配置脚本模型的 Responses 协议与容量。隔离构建上的 `run-config-assistant.spec.ts --project=desktop --workers=1` 一项通过，覆盖真实 edit、审批、写盘及最终回复；不代表已验证所有审批失败情形。

- **Gains**: 运行配置生成获得与 chat 板块同款的工作区理解能力，文件随聊随读；配置编辑有粒度、有校验闭环、有审批落盘；助手轮次退出个人画像；能力边界以工具面形式可执行、可审计。
- **Costs and limits**: 专属工具族与事件桥是一套新接缝（照 `attachNoteChatTools` 复制其形）；`toolTraces` 回放成为助手历史自持的必要附件；`ChatStreamRequest` 公共契约扩型三处同步；run/test/stop 的模型触发被移除（除非待确认点 1 改判）；工具循环使单轮时延高于纯流式。
- **Verification**: 见 Proposal 第 6 步的命令与钉点；实施时以实测为准，未跑的部分不得记为通过。
