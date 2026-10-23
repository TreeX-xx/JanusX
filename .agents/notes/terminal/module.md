---
{
  "schema": "harness-note/2",
  "id": "bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": ["terminal","shell"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/terminal/manager.ts",
      "symbol": "TerminalManager",
      "role": "entry"
    },
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/ipc/terminal-handlers.ts","role":"implementation"}
  ],
  "interfaces": [
    {"name":"TerminalManager","direction":"provides"},
    {
      "name": "AgentSessionRegistry",
      "direction": "needs",
      "provider": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662"
    }
  ],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/0358ada8-8f0d-4fcd-8f78-19d14e2b6b19"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/e29da5b4-dc65-40a9-883d-9026e3b280b1"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a976752-d637-40c7-9fa3-bce52ac5dc15"}
  ],
  "updated": "2026-10-23T16:36:37Z",
  "moduleState": "partial"
}
---

# 终端与外部 CLI

## Responsibility

管理 PTY 进程、终端输入输出、外部 CLI 的启动与终端界面。终端 IPC 通过会话模块的 AgentSessionRegistry 关联会话与终端事件；终端模块不拥有会话持久化或 Task 验收规则。

下列链接保留已有决策、阶段需求和交付记录的阅读路径；正文及生命周期由原 Note 负责。当前目录和蓝图归属以最近模块的 module 声明为准；历史 parent 关系保留旧阅读脉络，不参与模块层级，跨模块关联由本声明的 related-to 补充。模块声明只在职责、接口、明确依赖或代码入口变化时维护。

## Design

### 终端自选背景图（待实施）

用户明确希望将终端区域背景换成自己选择的图片，需求包含图片背景，不能以现有终端纯色主题代替。当前 CLITerminal 使用 xterm，已设置 allowTransparency:true，但尚无自选图片、背景图层或偏好持久化；插件调色板目前只提供颜色，不支持图片资源。本轮仅记录，未实施。

建议先由宿主终端外观设置提供本地选图、移除／恢复纯色及持久化；图片适配、透明度／暗化、全局或按项目／终端覆盖等细节待定。绘制方案需让默认终端背景透出图片，同时保持文字、光标、选择及输入可读，不通过降低整个终端透明度淡化文字。CLI 显式绘制的单元格背景可能遮挡图片，不能承诺任意 TUI 全屏都完整透图。主题包是否能提供背景资源另定契约，不授予插件直接修改终端 DOM 或 PTY 的能力。

### 现有终端设计

终端阅读入口分为状态、设置、外部 CLI 和 Shell 语义；各组可跨模块引用：

新建终端立即显示启动反馈，直到 xterm 实际绘出文字；进程创建与首屏内容就绪分别表达。启动链路只读应用启动时已验证的 OfficeCLI 缓存，不因 Office 能力探测等待；AI 终端的文件基线保留在进程创建之前，采用最多八文件并发、按路径顺序提交与 16 MiB 文本保留上限。分段计时、验证结果和大目录限制见 [turn-history](./terminal-right-island-turn-history.md)。

已有终端标签切换保留实例和输出缓冲；同尺寸直接请求绘制，避免每次激活两轮适配与整屏刷新。尺寸变化、工作区返回和显式恢复仍保留适配及滚动意图恢复；标签和终端视图通过稳定参数隔离无关渲染。多终端基准、TUI／后台输出回归及限制见[工作区标签](../workbench/pane-tab-reorder.md)。隐藏终端继续解析输出，尚无跨终端总预算。

[终端原生滚动与 island 快速翻屏](./terminal-scrollback-navigation.md)保留各 CLI 的原生渲染方式及固定输入区，移除模式选择和会话阅读面板。文件 island 上方独立的两个按钮支持点击翻屏、按住连续滚动及切换／失焦停止；普通缓冲翻动真实历史，全屏按鼠标能力转发原生滚轮或翻页。滚轮支持 Alt 加速，不伪造全屏比例轨道或精确提交跳转。窄分屏、小高度及输入焦点已通过浏览器验证，真实 CLI 持续长输出与打包现场使用仍待验收。

状态显示链（路由与投影分层，互链不合并）：[model-lifecycle](./terminal-model-lifecycle.md)、[sidebar-states](./terminal-sidebar-states.md)、[status-display](./terminal-status-display.md)、[idle-prompt](./terminal-status-display.md)、[status-ring](./terminal-status-display.md)、[sidebar-hierarchy](./terminal-sidebar-states.md)、[context-telemetry](./claude-opencode-context-telemetry.md)。

上下文与消耗统计共用主进程 history 的原生会话源，分别投影当前上下文与历史消耗；PTY 仅保留必要状态信号。coordinator 管理精确绑定、hook 刷新和 10 秒采集，独立 SQLite 用量账本保留去重身份、累计基线和新增消耗，关闭终端不删除记录。账本复用连接、普通查询不执行初始化写入，同步锁等待限制为 100ms；绑定投影按文件版本缓存，最多 128 份、30 秒强制复核，变化后完整校验。退出先取消扫描并完成最终采集再关闭账本。Claude/Pi 按稳定响应事件导入（Pi 保留放弃分支消耗），Codex/OpenCode 新会话按事件回放，已有累计会话保留模式锁；来源异常暂停，Janus/DSH 缺少原生 usage 时显示未知。OpenCode 全扫描读取 v1/v2 原生消息，自动归属使用工作区与会话活动时间。设置用量页查询账本，按事件时间或已声明的采样时间归桶，并结合当前模型目录在总用量旁紧凑展示 USD 预估总额，缺价不作免费；Codex 事件按前置 turn_context 关联模型，旧记录从原始会话唯一匹配回补，不改变消耗。[会话源单源化](./requirements/usage-telemetry-single-source.md)拥有当前契约、实现边界与验收证据；[统计修复](./requirements/usage-telemetry-fix-and-stats.md)和[日期及明细](./requirements/usage-stats-custom-range-detail.md)保留历史交付记录及继续沿用的交互要求。[筛选切换的加载过渡](./requirements/usage-stats-loading-transition.md)（2026-10-14 实施）在切换类型/范围时保留上一份数据，以 2px 发丝线进度与降透明度衔接旧值到新值，周期重查不闪烁。

已接受的架构转向：[hook 解耦决策](./usage-telemetry-hook-decoupling.md)（accepted）决定统计链路完全移除 hook——用量账本改纯会话扫描（覆盖未打开历史，Codex 升级事件模式重放），终端归属改会话诞生/激活时刻的 pty×文件相关性，每终端私有 home 暂缓。**L1、L2 已落地**（2026-10-14）：账本不再依赖 hook 与终端绑定（全语料扫描 + 回游标 + 记账模式锁）；终端归属在无 hook 绑定时按 pty 活跃度×会话文件写入相关性推断（唯一候选才绑定，hook 断言优先），hook 仍是回合状态/通知的来源。L3（每终端私有 home）未实施。

设置绑定链（演进关系已由正文 supersede 声明）：[settings-llm](./settings-terminal-llm.md)、[provider-collections](./terminal-provider-collections.md)、[native-login-first](./native-login-first.md)、[tabs-projectors](./terminal-tabs-per-format-projectors.md)、[settings-todos](./requirements/settings-terminal-llm-todos.md)、[background-image](./requirements/terminal-background-image.md)、[workbench-transition](./settings-workbench-transition.md)。

LLM 配置以共享渠道目录和各 Agent 独立模型选择为入口，官方 API、CPA、自定义服务共用一份渠道信息。协议兼容检查、旧配置迁移与完整连接写回由 [共享渠道设计](./terminal-provider-collections.md) 维护；原生登录沿用各 Agent 自身状态——设置面板按 [登录在前](./native-login-first.md)（2026-10-17 实施）探测凭据存在性，未登录时以终端引导该 Agent 自己的登录并阻塞应用，不代持令牌；路由、故障转移和远程环境留在后续阶段。

cc-switch 机制从[port 总纲](./requirements/cc-switch-port.md)进入，detect-install、cli-matrix、multi-terminal、pi-janus 四篇维护具体能力；总纲与专题都直接归属终端模块，历史 parent 只表示原交付脉络，不形成子模块。profile-switch 与 llm-sync 两篇 archived 历史保留在 history/，不复活或改写。

Shell 语义与外围：[adhoc-parity](./adhoc-shell-parity.md)、[self-heal-parity](./command-error-self-heal-parity.md)、[cold-restore](./shell-cold-restore.md)、[orca-parsing](./orca-terminal-acquisition-parsing.md)、[ime-drift](./ime-candidate-drift.md)、[pane-tree](./pane-tree-subagent.md)、[monaco-diff](./monaco-diff-single-line-number.md)、[turn-history](./terminal-right-island-turn-history.md)。

Shell 入口探索：[可选择的普通终端 Shell](./shell-profiles.md)已定稿终端管理设计（用户自建条目、自由命令与启动后缀、显隐与检测候选区、全局默认 PowerShell 种子），P1–P5 已实现；Janus CLI 新建入口默认隐藏，设置仍可开启，已有显隐偏好及运行中会话保留；`--login -i` 建议后缀与 Git Bash 落位待 Windows 实测定型（见 Task Results）。工作区运行时方向（WSL 与 SSH 连接途径，`kind: 'windows' | 'wsl' | 'ssh'` 三态）与两条分阶段适配线见 [wsl-support-direction](./wsl-support-direction.md)（accepted，取代首版 WSL 留白；手机远控经桌面转发、不直连 SSH 的边界同篇维护）。

island 一词两义（pane 姿态层与 turn 历史浮层）为术语债，改名消歧前两篇并存，不合并。

底部[用量面板](./requirements/usage-panel-direct-content.md)直接展示上下文、会话累计缓存命中率、累计缓存读取/写入、Token 总数及输入/输出；运行时间按当前终端实例计时。底栏徽标和卡片上下文区域提供精确容量、剩余量及压缩次数的悬浮提示。普通对话入口同名，原二次点击详情及遥测诊断展示已移除。2026-10-15 接入 Codex 原生 `cache_write_input_tokens`，从含缓存的输入中拆出读/写分量，保持总量不变；旧事件历史在原源可读且分项核对一致时补齐写入，旧累计基线的过渡区间保留未拆分输入。Claude 保留明确零值，整段未提供写入字段时显示未知。

## Acceptance criteria

以下保留 2026-09-26 文档整理的验收原文与勾选状态，供旧 Task 引用；其中篇数是当时快照，不是当前模块大小，新增工作也不强制改写历史 parent。

- [x] AC-1: 本域 22 篇直接子与 cc-switch 4 篇孙节点全部携带有效 parent，无孤儿。
- [ ] AC-2: archived 两篇（profile-switch、llm-sync）保持冻结，不复活不改写。
- [ ] AC-3: 新增终端工作引用本域定位，不再新建平铺孤儿。
