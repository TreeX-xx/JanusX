---
{
  "schema": "harness-note/2",
  "id": "0cb931e1-e33c-4e38-a9d9-9d652796d935",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-10-23T03:08:30Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662",
  "moduleState": "partial",
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/sessions/transcript-snapshot.ts","role":"implementation"},
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/sessions/session-registry.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/sessions/external-session-scanner.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/sessions/transcript-reader.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/sessions/session-recovery.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/SessionPanel.tsx",
      "role": "implementation"
    }
  ]
}
---

# 会话记录与续接

## Responsibility

维护稳定的会话身份、终端绑定、回合记录、外部转录发现与有界读取，以及会话时间线和续接。提供 AgentSessionRegistry 给终端、检查点及其他调用方。

## Design

注册表先加载后写入并在退出前刷盘，外部扫描批量合并通知；各引擎的转录与续接能力显式判断。会话管理只读取账本回合和提供方转录，保留筛选、归档查阅、复制、实时预览、详情导航与原生续接；不显示还原点计数、文件变更、diff 或恢复操作，也不请求 checkpoint IPC。问题文本来自回合快照与转录合并，不再从检查点补齐。底层快照创建、数据与其他调用方仍归 [会话检查点](../checkpoints/module.md)，本次移除不迁移或删除历史记录。界面分层见 [窗口化阅读](session-windowed-reading.md)。Hook 能力表属于终端事件协作边界，知识证据提取由知识模块维护。

外部会话可见期间持续检查文件变化，流式解析及计数/预览投影见 [外部会话同步](external-session-backfill.md)；Hook 回合与状态不被转录覆盖。详情正文随会话事件重新读取。侧栏首屏和扫描的调度见 [会话侧栏渐进呈现](session-open-stall.md)。终端登记、对话内容读取、外部会话发现、原生恢复和任务交接是不同能力，不能由终端可启动推导为全部可用；各类型现状归 [引擎能力与转录解析](session-engine-capabilities.md)。CLI 子智能体记录（Codex 独立 rollout + parent_thread_id、Claude 子文件/交错 sidechain、OpenCode session.parent_id）的实测形状与字段映射归[子智能体会话结构实测](session-subagent-structures.md)。

会话标签激活复用同筛选最近 5 秒内的列表，慢读取合并，停留后补查隐藏期间漏掉的变化；事件刷新仍立即进入原有防抖流程。未变化摘要保留引用，扫描调度跨标签切换延续，隐藏面板不发起扫描。边界与验证见[会话侧栏渐进呈现](session-open-stall.md)。

Claude、Codex、Opencode 的同引擎 Continue 与 Resume 已统一为提供方原生恢复，内部、外部和归档记录均有恢复入口。主进程先校验原 cwd、历史身份与配置来源，再建立终端；不自动发送首条 prompt，恢复后的回合继续由 Hook 跟踪。缺少 ID 的 Continue 明确说明并保留任务交接，显式 Resume 则报错。实际问题、Orca 参考、验证及边界归 [转录详情与原生恢复](session-resume-detail.md)。新终端继续同一个提供方对话，不创建独立历史分支，也不恢复仓库文件。Pi、Janus CLI、DSH 和应用冷启动自动恢复保持后续范围。
