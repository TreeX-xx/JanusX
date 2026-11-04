---
{
  "schema": "harness-note/2",
  "id": "b28d07a3-bc27-4be1-9868-87849e9efb16",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-30",
  "class": "feature",
  "tags": ["dsh","terminal","external-cli"],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/tool-registry.ts","role":"entry"},
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/janus-runner/parsers/dsh-parser.ts",
      "symbol": "DshParser",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/runtime-telemetry/history.ts",
      "role": "implementation"
    }
  ],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8795ab54-4051-4d53-9805-e85a9073ca5d"}
  ],
  "extensions": {
    "corpusReorganization": {
      "sourcePath": ".agents/notes/dsh-integration.md",
      "sourceCommit": 9842316,
      "sourceHash": "7570c338514dc3140298b2ee0460351a16a95ec3d90893f09b3fa4d3b7f1e869",
      "reason": "Git blob provenance before separating current facts and historical planning."
    }
  },
  "updated": "2026-10-31T17:25:01.281Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# DSH 终端接入与可信遥测边界

## Problem

DSH 的官方入口以 Web UI 和 headless 为主，桌面工作区需要兼容外部 TUI、后台执行和状态感知。直接把 DSH 当作已有引擎会误装 hook、误判结束状态或尝试写入并不存在的模型配置文件；从散文和单轮 token 文本推断当前上下文也会产生错误统计。

## Decision

DSH 复用外部 CLI 注册、PTY 终端及 headless 子进程入口。工具描述声明 `@deepseek-ai/dsh`，手动安装指令为 `npm i -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui && dsh-tui`；第一次运行 launcher 自举 `dsh-tui` profile，终端预设使用 `dsh --profile dsh-tui`。TUI 插件的安装由用户完成，JanusX 负责检测及启动。终端选择器、设置工具行、派发预设和会话引擎沿用统一类型与 `TerminalPresetIcon`，图标真源为 `src/renderer/src/assets/icons/dsh.svg`，品牌色为 `#4D6BFE`。

DSH 的 hook 安装为 no-op，不能落到 OpenCode 插件分支。状态感知保留实测 PTY 信号：`模型醒了` 断言 running，`turn error` 断言 degraded。解析器不据此推断 idle；`CLITerminal.writeLiveOutput` 仅对 dsh 预设更新不同的状态，不覆盖 needs-approval、needs-input 或 error。状态栏模型与数字解析已由[会话源单源化](./requirements/usage-telemetry-single-source.md)移除。没有 hook 就不声称具备 turn 通知；本地状态接入也不扩大 CompanionGateway 的远控引擎范围。

固定的 agent-core 依赖在运行时按原值保存检查点引擎，但其发布类型缺少 `dsh`。JanusX 的安装期兼容脚本精确扩展 `CheckpointEngine` 声明，并在上游声明形状不匹配时终止安装；已有补丁重复执行不改文件。只在本机修改 node_modules 无法覆盖 CI，宿主把 DSH 伪装为其他引擎则会污染检查点归属。该补丁沿用现有安装钩子，限制在类型声明，待两条工作流固定到原生支持 DSH 的上游提交时移除。

无 sessionId 时，历史入口读取 `~/.dsh-tui/model-recents.json` 中的最近模型，缺失时回退声明默认 `deepseek-flash`；DeepSeek 模型窗口估计为 128,000，来源标记为 configuration/declared。有主进程精确绑定的 sessionId 时，扫描 `~/.dsh/sessions/<workspace-key>/<uuid>/`，workspace key 精确匹配失败后允许大小写不敏感回退；会话先精确 UUID，再兼容子串，并按 mtime 选择，返回 id、path、recency。coordinator 对恢复绑定不使用终端启动时间过滤。`session.v4.jsonl.zstd` 没有解码器，当前上下文与用量保持未知，声明配置不提供启动零用量。conpty 中间层 pid 与 `session-mounts.json` 内层 pid 不一致，不能据 pid 自动绑定；没有 hook 时不自动发现并绑定会话。

后台执行使用 `dsh --profile headless --json <prompt>`。模型和 approval policy 由 profile 管理，宿主不透传其他引擎的 flag。DshParser 将 text 映射为 text-chunk、thinking 映射为有界 phase、tool_call/tool_result 映射为工具事件、turn_end 的 error reason 映射为错误。final 是已流式文本的重复输出，session 和未识别的成功 reason 不制造额外完成事件；进程关闭拥有 done。工作树隔离复用 activePaths 所决定的终端 cwd，不引入 DSH 专用隔离器。

DSH 不做模型配置投影。其 bundle 默认值与 TUI `/model` 会话 fork 不等价于外部模型文件，`cordis.patch.yml` 的 `!!js` YAML 也不能按 JSON 或普通 YAML 键安全回写。`TERMINAL_FILE_META.dsh` 为 null，设置页隐藏 Live 文件行，`terminalModelUnsupported('dsh')` 指向 TUI `/model`。模型显示来自声明配置，不将 PTY 状态栏作为运行模型来源。

`UsageStatsPanel` 已查询独立持久账本，日期与类型筛选保留；DSH 未接入原生 usage，因此没有已记录数据时显示「–」并说明来源边界，不从文本 token 行猜测用量。[全引擎统计需求](./requirements/usage-telemetry-fix-and-stats.md)保留历史检测门验收，当前数字契约和持久化证据以单源化 Note 为准。后续 DSH 数值接入仍需要压缩日志解码及真实 usage 样本。

???????????[??????????](../workbench/terminal-dialog-dual-mode.md)??? DSH 0.2.0-rc.2 ? dsh-tui 0.12.0??????? --patch ???? Cordis ???????? session id????????????????? Agent ? followup/cancel????????????????????????????? hook????? usage ? Companion ????? profile + ???????? CLI ???????? Electron ????? profile ??????????????? Note?

## Alternatives considered

- 只接官方 headless 可以降低 TUI 插件维护成本，但无法提供交互式终端工作区；使用外部 TUI profile，同时保留独立 headless 解析入口。
- 模仿已有引擎安装 hook、通过 pid 挂载或写模型文件能复用更多代码，但 DSH 没有相同协议和文件语义；采用 no-op、显式会话输入与只读模型感知，缺失信号保留为缺失。
- 直接把 PTY token 行累计成上下文可立即显示数字，但单轮 token 与窗口占用不是同一指标；未经真实样本验证的成功、审批和数值格式保持待办。
- 维持不接入或仅由用户在普通 shell 启动，依赖最少，但缺少统一工具检测、预设和后台事件。复用现有引擎入口，增加有限的 DSH 协议适配。

## Consequences

DSH 在现有终端与后台任务框架中工作，代价是额外的 TUI profile 安装和协议版本维护。2026-09-30 的 Windows + node-pty 实测组合为 DSH `0.2.0-rc.2` 与 TUI launcher `0.12.0`；首次自举需 pnpm，缺构建脚本时按 launcher 提示补 allowBuilds。这是历史验证组合，不保证未来 npm latest 保持兼容。

旧 `@dsh-tui/dsh-tui@0.1.2` + `tui` profile 路线的 peer 只到 DSH `0.1.0-rc.6`，在 `0.2.0-rc.2` 下插件被禁用；退到 `0.1.0-rc.8` 又遇到 `cordis-plugin-hmr@1.0.19` 移除 registerConfig，历史复现需要手动 pin `1.0.16`。这些限制是选择新 launcher 的依据。

[DSH 信号与日志补全需求](./requirements/dsh-telemetry-completion.md)保存未完成信号、真实用量和人工兼容验证。结束标记、审批面板、tokens/tps、contextUsage/contextBar 在缺少带 key 的真实非零样本时不得臆测。上游协议或配置发生变化时应重新验证这些边界。

原始混合文档保留在 Git `9842316:.agents/notes/dsh-integration.md`，本文件 extensions 记录提交、路径与原始 blob 的 SHA-256。原文的阶段状态、合并冲突记录、共享包构建同步及历史测试结果是来源事实，不作为本轮新测试或当前所有环境通过的声明。共享 CheckpointEngine 对 dsh 的支持仍由 agentX 包负责，本决策不复制其源码。
