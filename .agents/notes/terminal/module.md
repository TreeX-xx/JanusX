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
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# 终端与外部 CLI

## Responsibility

管理 PTY 生命周期、外部 CLI 的发现与启动、输入输出和终端状态。会话归档与恢复归[会话模块](../sessions/module.md)，布局与文件阅读归[工作台](../workbench/module.md)。

## Design

2026-11-14 起，node-pty／ConPTY 资源与 spawn 由 `terminal/pty-driver.ts` 拥有；普通进程、命令解析、目标环境及默认 shell 统一消费 `platform/` 服务，CLI 安装与 provider 策略保留在 external-cli。TerminalManager 管理终端生命周期和 main-only 启动快照。迁移与各平台证据见[跨平台运行时边界](../desktop/platform-runtime-boundaries.md)，尚未进行 Mac 原生验收。

本机、WSL 和 SSH 工作区在目标环境解析 CLI 与工作目录；已打开的 pane 保留自己的实例和输出。平台差异见[macOS CLI 与会话](macos-cli-sessions.md)，引擎安装和升级见[多 CLI 生命周期](cc-switch-multi-terminal.md)。终端与对话视图共用原生会话身份，按各引擎实际支持的能力处理命令、审批和恢复。[双模式专题](../workbench/terminal-dialog-dual-mode.md)维护能力差异。

Hook 服务于状态和通知，统计从原生会话记录读取。[用量与 Hook 解耦](usage-telemetry-hook-decoupling.md)维护账本、归属和缺少用量时的表现，[用量面板](requirements/usage-panel-direct-content.md)维护展示口径。终端状态与消耗统计的更新时间和来源分别处理。

共享渠道和逐 Agent 模型选择见[终端渠道](terminal-provider-collections.md)。[原生登录](native-login-first.md)与[Shell 配置](shell-profiles.md)分别管理 CLI 登录和普通命令行入口。

### 终端自选背景图（待实施）

用户明确希望将终端区域背景换成自己选择的图片，需求包含图片背景，不能以现有终端纯色主题代替。当前 CLITerminal 使用 xterm，已设置 allowTransparency:true，但尚无自选图片、背景图层或偏好持久化；插件调色板目前只提供颜色，不支持图片资源。本轮仅记录，未实施。

## Acceptance criteria

以下保留 2026-09-26 文档整理的验收原文与勾选状态，供旧 Task 引用；其中篇数是当时快照，不是当前模块大小，新增工作也不强制改写历史 parent。

- [x] AC-1: 本域 22 篇直接子与 cc-switch 4 篇孙节点全部携带有效 parent，无孤儿。
- [ ] AC-2: archived 两篇（profile-switch、llm-sync）保持冻结，不复活不改写。
- [ ] AC-3: 新增终端工作引用本域定位，不再新建平铺孤儿。
