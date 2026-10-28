---
{
  "schema": "harness-note/2",
  "id": "dc1aca7c-408f-406d-add4-ba78d556b662",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": [
    "session",
    "workspace",
    "worktree"
  ],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/sessions/session-registry.ts",
      "symbol": "AgentSessionRegistry",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/ipc/session-handlers.ts",
      "role": "implementation"
    }
  ],
  "interfaces": [
    {
      "name": "AgentSessionRegistry",
      "direction": "provides"
    }
  ],
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/abb1ccb3-be21-5f64-9b55-de5089e621e9"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/22f762b8-1b14-522d-a971-b11e2dfc9af6"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/70beb72a-424d-5e96-a0d0-8e1a29635220"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/640a69dd-bbea-4606-b51a-f9b545de37a5"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/97a21dee-2b5e-4cf8-8298-28263eeb02bb"
    }
  ],
  "updated": "2026-10-28T06:07:03.626Z",
  "moduleState": "partial"
}
---

# 会话与工作区

## Responsibility

在工作区与 worktree 范围内组织会话、恢复点和连续对话。会话与终端的绑定、检查点关联以及项目线程各有独立身份；PTY 进程和正式 Task 验收由其他模块负责。

## Design

工作区导入使用共享弹窗动效与主题化紧凑布局，三来源通过分段控件切换；SSH 高级参数按需展开，连接后在同一弹窗选择目录。成功导入与取消后恢复侧栏入口焦点，具体交互与验证归 [Local / WSL / SSH 导入](workspace-runtime-import.md)。

[会话记录与续接](records/module.md)维护 AgentSessionRegistry、外部转录、回合时间线及续接；[会话检查点](checkpoints/module.md)复用共享快照引擎，维护会话范围、保留期和显式恢复；[项目对话与任务线程](threads/module.md)维护对话激活及 run 关联上下文；[工作树隔离与切换](worktrees/module.md)维护 Git 生命周期和活动目录作用范围。

[Local / WSL / SSH 工作区导入与操作](workspace-runtime-import.md)处于实施中：三来源共用导入与资源身份，文件编辑预览、终端、Git、蓝图、会话管理同属首版范围。Linux 服务持有远端 PTY，退出桌面只断开连接；Git/worktree 在目标执行，根外目录通过 Git 登记校验。蓝图文档事务与提供方历史解析在目标复用既有 Node 模块，会话按来源隔离，恢复前检查原历史、cwd 和 CLI。真实 WSL/SSH 服务验证和 Windows Electron 导入、预览、退出重开流程均已通过；远端 Hook、维护 Agent、真实提供方账号恢复、交互认证与完整预览对照尚未完成，完整首版未宣告交付，实测范围见该篇。

远端新建 Agent 支持终端内按需安装；原生续接复用目标 CLI 解析器，能找到用户安装及 JanusX 受管目录，不因文档后端旧 PATH 拒绝启动。安装流程不迁移本地凭据，也不等同于提供方登录或真实历史续接验收。

终端以稳定 sessionId 关联会话和检查点，线程以项目/viewRef 或 Task run 维持连续性，工作树为这些入口提供有效目录。各子模块通过现有服务与 IPC 协作，不建立另一个会话或执行事实索引。右坞会话入口默认可用，不受旧实验开关控制。

[工作区、会话与恢复总需求](requirements/workspace-session-checkpoint-continue.md)、[窗口化呈现与恢复需求](requirements/session-mgmt-orca-restore.md)、[会话内容真值](requirements/session-content-truth.md)、[还原点可靠性](requirements/restore-point-reliability.md)（排期滞后）和[初始实现决策](workspace-sessions-v1.md)横跨子模块，仍归本层。工作区行的[常驻菜单](workspace-row-actions-menu.md)与[悬停显示](workspace-row-hover-reveal.md)保留先后取舍。共享弹窗动效和关闭热区已归回工作台，具体搬迁记录见[职责目录整理](../blueprint/module-responsibilities.md)。

## Acceptance criteria

以下保留 2026-09-26 文档整理的验收原文与勾选状态，供旧 Task 引用；其中篇数是当时快照，不是当前模块大小，新增工作也不强制改写历史 parent。

- [x] AC-1: 本域 38 篇直接子全部携带有效 parent，会话十八连发可按四组检索。
- [ ] AC-2: 中文旧根 a361448b 仅作前身附录，真源以 c23ebb35 为准，不三足分立。
- [ ] AC-3: hover-reveal 与 actions-menu 保留一显一隐决策对立，不合并。
