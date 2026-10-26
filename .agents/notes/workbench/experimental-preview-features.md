---
{
  "schema": "harness-note/2",
  "id": "5f61e8cf-c615-4f45-b520-022cc99f609f",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-10",
  "class": "feature",
  "tags": ["product","surface"],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/b3704d91-c17d-4492-ae71-a44cfec8bbd7"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/908d675a-aec9-4791-8c8b-05f1e4c923ca"}
  ],
  "updated": "2026-10-25T05:40:28.892Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 创新实验功能预览管理

## Problem

创新功能需要通过设置中心统一表达成熟度并控制入口。会话管理和备忘录都处于预览阶段：会话管理提供卡片、时间线、详情与续接，备忘录提供星座里程碑、人工编辑与 Chat 联动。它们需要独立开关，避免入口常驻与成熟度不匹配；关闭功能不能删除既有数据或打断已经开始的回复。

## Decision

机制契约：`ExperimentalFeatures` 逐路布尔开关，`experimental:get/update` IPC 持久化到工作区配置，`normalizeExperimentalFeatures` 对缺席/非法一律回落默认值（默认全关 = 打包默认隐藏，仅设置中心开启后可用），无 IPC 环境以 `EXPERIMENTAL_ENABLED_ALL` 全开降级避免浏览器预览误杀。设置中心实验页分「预览」与「开发」两区（`PREVIEW_FEATURES`/`DEV_FEATURES`），每个开/关走逐项确认弹窗；知识库开关有键与文案但暂不在面板两区列表中。右坞入口统一经 `isRightToolEnabled(toolId, features)` 门控，`RightDock` 对被禁工具隐藏并关闭（重开启用后从关闭态开始），`RightToolRail` 不渲染被禁工具。

「预览」分区包含会话管理和备忘录；个人画像、圆桌、远程协作与团队协作仍归「开发」分区。蓝图已退出创新功能列表，由[官方插件安装与设置入口](../planning/blueprint-official-plugin.md)管理；旧 blueprint 持久字段暂留给兼容消费者，不再控制插件安装或设置入口。`sessions` 与 `memo` 均默认关闭，旧配置缺席键或非法值回落 false。会话管理关闭仅隐藏右坞入口，会话账本和转录扫描保留；当前界面提供对话详情与续接，已移除还原点、文件变更、diff 和文件恢复操作，底层检查点仍由[检查点模块](../sessions/checkpoints/module.md)独立维护。`isRightToolEnabled`、`RightDock` 和 `RightToolRail` 共用入口门控。

设置页红色说明表达当前使用条件或能力边界，随实现维护，中英文同步：会话转录解析和原生续接因终端不同而有差异；备忘录人工编辑可直接使用，Chat 联动需支持工具调用的模型；圆桌需可用的全局默认模型；Android 远控需要电脑批准设备，使用 UDP 直连且不提供业务中继，部分网络可能无法连接；团队已有账号与组织管理基础，跨设备项目和文档同步尚未完成。个人画像的采集、工程习惯、对话使用与保留期说明仍适用。隐藏的旧 knowledge 文案明确工程入口已退出，不再宣传旧工程采集和本地模型部署。来源分别见[会话记录模块](../sessions/records/module.md)、[备忘录专题](../knowledge/user-todo-janus.md)与[远程协作模块](../remote/module.md)，圆桌默认模型条件由 src/main/roundtable/service.ts 校验。

`remoteControl` 同时控制 Android 手机远程入口和主进程服务：默认关闭，加载配置前及读取失败时保持隐藏；即使直接调用 start IPC 也必须通过持久开关检查。关闭时停止隐藏 WebRTC 主机和信令、断开配对设备，保留电脑已创建终端，不允许迟到的异步开启恢复服务。终端屏幕、授权工作区和本机验证由[Android 配对握手](../remote/android-pairing-handshake.md)维护。

备忘录关闭时 MemoPanel 不挂载编辑器，已打开的附岛和对话布局一并恢复；开关不删除文件、不解除会话 memoId 绑定、不取消正在执行的回复。重新开启从面板关闭态进入，可继续使用原文件与绑定。普通隐藏面板仍保留编辑器草稿；关闭功能会卸载编辑器，尚未保存的组件内草稿不持久化。渲染端在发送和追加消息时读取最新开关，关闭后不发送 memoBinding 或 memoMessageId；主进程在装配新轮次时再次读取持久开关，即使收到旧绑定也不提供 memo_create/read/edit，并说明需要开启预览。轮次开始后关闭开关不撤销当轮工具或已有写入。底层 MemoStore 和 IPC 保留，不执行数据迁移。

渲染端 memo 初始关闭，等待配置读取，读取失败继续关闭，避免持久配置加载前短暂显示或提供工具；无 IPC 的浏览器预览沿用全开降级。备忘录文件、星节点及 Chat 绑定的具体契约由[备忘录专题](../knowledge/user-todo-janus.md)维护。

## Alternatives considered

- 会话开关默认开启 — 最强理由是已上线功能不隐身、升级无感。排除原因：预览管理的既定契约是「默认全部关闭，设置中心开启后可用」，例外会让七路语义分裂；用户明确定案默认关闭。
- 关闭时连外部转录扫描与入库一起停 — 最强理由是省后台开销。排除原因：门控语义应收敛在入口层（teamCollab 先例），停扫描改变数据面行为且重开后需要补扫逻辑，收益不成比例。
- 会话门控做成独立设置项而非实验开关 — 最强理由是会话偏核心功能。排除原因：用户明确要求进入创新功能预览管理，与其他创新功能同池灰度回收。
- 不建 Note 只留代码注释 — 最强理由是零文档开销。排除原因：机制契约（默认回落、降级全开、逐项确认、门控收敛点）是长期事实，此前缺失记录正是本次顺带补档的动因。

## Consequences

- **Gains**: 会话管理与备忘录统一归入预览管理，打包默认隐藏，设置中心逐项确认开关。备忘录 UI 与后续 Chat 工具共用开关，保留文件、绑定与在途回复。
- **Costs and limits**: 默认关闭意味着旧配置与新装升级后会话、备忘录入口不出现，需在设置中心「实验」页开启；`knowledge` 开关仍保留在契约与文案，但不进面板列表。会话门控只覆盖右坞入口，不停扫描或 Hook 采集；备忘录门控覆盖编辑入口与新 Chat 工具，不取消在途轮次，也不清理文件。
- **Original verification (2026-10-10)**: `npm run typecheck` 干净；`npx vitest run tests/unit/experimental-features.test.ts tests/unit/right-tool-state.test.ts` 31/31 通过（七路 normalize、sessions 缺席回落 false、严格布尔强转、sessions 门控开/关）；`npm run i18n:types` 当时生成 3310 keys，`npm run i18n:check` 双语同步；Note 检查零错误。

## 备忘录预览验证（2026-10-15）

`npx vitest run tests/unit/experimental-features.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/memo-chat.test.ts tests/unit/llm/janus-agent-ports.test.ts --maxWorkers=2 --reporter=dot`：4 个文件、70 项通过，覆盖旧配置缺席和非法 memo 值、启用后的工具装配、关闭后主进程收到旧绑定仍不提供工具，以及共享 Chat 宿主端口。

Chromium 运行 memo-preview、memo-trigger 和 memo-chat-selection 三份 Playwright，共 7 个场景通过；预览场景覆盖分区归属、默认隐藏、确认取消、开启、关闭已打开面板、在途回复不取消、文件和绑定保留、后续消息无备忘录上下文、重新开启恢复。首次测试直接点击透明 checkbox 被装饰层遮挡，改为真实键盘 Space 触发后该场景重跑通过；原先 6 项入口与选星回归均通过。产物位于本地 artifacts/memo-preview-acceptance/ 与 artifacts/memo-preview-fixed/。`npm run typecheck`、`npm run i18n:check` 和 6 个变更生产文件的 ESLint 通过。尚未运行 Electron 桌面或完整发布验收。
