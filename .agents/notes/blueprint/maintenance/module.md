---
{
  "schema": "harness-note/2",
  "id": "a09981f4-1a94-42ce-9255-2e1127cfa37b",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-10-27T05:25:35Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "moduleState": "partial",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/ui/Maintenance.tsx",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/main/janus/maintenance/service.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/main/notes/maintenance-apply.ts",
      "role": "implementation"
    }
  ]
}
---

# 蓝图维护对话

## Responsibility

承接蓝图连续讨论、获授权的 Note 修改预览、确认写入、建议定向修复与复核，以及实施简报。范围、展示意图和写入权限分别维护，普通访问和关注变化不授权写入。用户已暂缓撤销并取消蓝图修改审计，确认后的文件事务直接生效。

## Design

插件按项目与规范化后的实际 worktree 根分别创建维护服务，任务与授权根在服务内保持固定。同项目不同 worktree 可独立生成、预览和确认修改，不通过当前界面选择重新解释旧任务的目标。确认时继续核对该根的 Note 版本；其它工作树的修改不使本根预览失效。页面释放会取消尚未进入事务的预览／确认请求，事务已进入后的提交遵循共享引擎语义；验证归[官方插件专项](../../planning/blueprint-official-plugin.md#worktree-显示切换)。

右侧插件对话复用共享会话和流式能力；普通讨论只读，整理后展示文件预览，用户确认才经共享 Note 事务写入。继续讨论、提案替换或源变化使旧预览失效。1.0.3 移除蓝图维护审计写入、查询和撤销入口；图刷新独立于已完成的确认结果，详见[文件审批决策](blueprint-maintenance-approval-gap.md)。建议定向修复绑定来源、工作区、分支、所选问题及文件版本；[建议交接专题](../navigation/note-updates-and-suggestion-navigation.md#建议定向修复)保留原宿主行为和历史边界。对话线程生命周期见 [职责入口](../../sessions/threads/module.md)，画布关注与定位见 [职责入口](../navigation/module.md)。执行 Task 和独立评估仍由 Agent 对话与执行模块负责。

本层保留审核生成与维护对话职责，使用[建议管理子模块](suggestions/module.md)，集中维护 Note 各种变化下的建议状态、版本和清理。目标 Note 删除后自动清理其建议，界面、原生 MCP 和独立 MCP 共用同一机制；不留建议历史。建议模块已接入桌面、原生工具和独立 MCP，共用 SQLite 当前状态；不把读取作为生成入口。

[蓝图内容审核与决策复核](note-content-review.md)维护已实现的审核行为及验收边界：全项目三类 Note 可逐篇手动审核，Git 自动化审核变化目标；生成式 Agent 分析、JEV 可选核验，修改由用户或获授权 Agent 决定。自动默认关闭、N=5、静默运行，可识别普通合并不等 N；压缩合并等特殊检测暂缓。开启后状态栏持续可见，设置与进度由独立轻量通道读取，Note 内容和详情另行同步。左侧阅读原文及折叠建议，右侧读取已有建议并承接用户点击授权的单篇修复或只读讨论，修复在独立内部会话处理本篇全部当前意见，普通对话可同时使用；未写入原因与写入证据由[建议交接专题](../navigation/note-updates-and-suggestion-navigation.md#整篇修复紧凑卡片与独立对话)维护。修复与撤销后的宿主复核调用同一审核引擎；常规生成仍从手动或自动入口发起。模型配置、触发与展示细节由审核专题维护，取证与质量由[首版审核设计](review-first-release.md)维护，阶段依赖见[交付计划](../evolution-roadmap.md)。

已接入的 [harness-note 结构审核](note-content-review.md#harness-note-结构审核)复用共享格式/模块组织校验，覆盖当前工作区所有正式 Note 类型，结构结论与无法解析文件的诊断进入审核视图、来源与重试/建议列表。程序检查不依赖模型，目标无效时阻止语义生成，修复后由当前来源复查；语义审核仍保持三类范围。结构反馈的 MCP 扩展与大规模扫描性能尚未验收。
