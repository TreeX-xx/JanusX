---
{
  "schema": "harness-note/2",
  "id": "b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-03",
  "class": "architecture",
  "tags": [],
  "updated": "2026-11-20T12:09:55Z",
  "moduleState": "partial",
  "role": "project"
}
---

# JanusX

## Responsibility

JanusX 在桌面工作区承载 AI 编程终端、会话与 Agent 执行。各模块入口维护职责、调用边界与当前实现，需求和 Task 保存交付范围与验收记录。

## Design

[桌面与分发](desktop/module.md)装配窗口、IPC 和应用生命周期。[终端与外部 CLI](terminal/module.md)管理进程、输入输出及状态，[会话与工作区](sessions/module.md)管理会话记录、工作树、对话线程和检查点。[工作台](workbench/module.md)把这些能力组织为分屏、侧栏与文件窗口。

[Agent 对话与执行](agent/module.md)连接共享引擎与桌面工具、审批和受管 Worker。[远程与托管协作](remote/module.md)维护手机配对、远程会话操作和 GitHub、GitLab 仓库协作。

[Note 与蓝图](blueprint/module.md)读取选定 checkout 的原始工程文档，并承接导航、审核和确认写入。[个人记忆](knowledge/module.md)维护画像、个人召回及备忘录。[产品规划](planning/module.md)汇集跨模块安排，各专项的实际交付状态回到所属模块核对。

模块以各目录的 `module.md` 为入口，子模块声明最近上级的 parent，专题通过 module 指向归属。普通分组目录不增加模块层级。模块状态与 Task 验收分别维护；迁移与历史依据见[职责目录整理](blueprint/module-responsibilities.md)。

## Acceptance criteria

- [x] AC-1: 当前模块具有明确职责、项目归属与可核对的代码入口。
- [x] AC-2: 模块图不要求复制决策、Task、人工坐标或另存关系总表。
