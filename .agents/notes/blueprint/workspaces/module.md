---
{
  "schema": "harness-note/2",
  "id": "bc9c2ca8-e036-48ec-a35e-667d694460ca",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-10-27T07:15:00Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "moduleState": "partial",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/main/service.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/harness/workspace-blueprint.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/ui/App.tsx",
      "role": "implementation"
    }
  ]
}
---

# 工作区组合与初始化

## Responsibility

负责跨模块管理 Note 的工作区识别与蓝图投影，提供每工作区的接入状态、空态和初始化预览。蓝图只显示当前工作区的 Note，切换工作区后读取对应来源；规划声明与开发证据各保留自己的身份。

## Design

HarnessNoteService.projectView 只投影当前根目录，不按引用发现或读取其他已注册、已绑定工作区。composeBlueprint 的 localOnly 装配保留本工作区接口与证据；本地 Note 的可读状态不取决于它声明的外部开发仓库。跨工作区 URI 与绑定记录仍保存在共同来源中，但不并入当前画布、数据来源和审核订阅。外部引用、外部接口提供方及其接入诊断不触发来源报错，本工作区的缺失目标、无提供方接口、无效文档和扫描失败仍可检查。显示与验证由[模块浏览](../navigation/requirements/module-browsing.md)维护。

WorkspaceBlueprintService 调用 agentX 的初始化和撤销能力，打开工作区不自动生成文件；只读接入检测不替代数据初始化。

插件先读取当前实际根的 workspace.status，只有 ok 才激活 Note 监听并读取图与审核。缺少 .agents、未接入 Notes 的 .agents 或无可显示 Note 时显示“未检测到蓝图 Note”；缺少接入时可预览初始化，不把正常空态解释为后台未运行。无效文档和读取失败保留来源诊断，显示“暂时无法读取蓝图 Note”。后台 workspace.activate 对非 ok 根安全返回，不启动会因缺失来源报错的监听。项目／worktree 切换保留页面与顶栏，内容按根重置；契约见[导航模块](../navigation/module.md)。

启动后后台准备当前工作区蓝图，其他工作区空闲时逐个预热索引。前台打开复用同一加载请求，临时忙碌自动等待并重试；切换工作区取消旧等待，同工作区刷新失败保留最后画布。读取状态与真实错误边界见[工作区加载与初始化](requirements/blueprint-empty-init.md)，索引复用见[性能专题](../requirements/blueprint-performance.md)。

架构师功能以跨模块 Note 管理为核心。蓝图区分文档主要归属与跨模块关联，支持无代码的规划工作区，并在模块浏览和关注定位时保留共同需求、决策与协作关系的来源。解析复用标准模块和显式关系；验收引用与正文引用可从参与模块访问，同一目标的多种关系保留类型、方向与来源。实现与 Main 自检见[架构师工作区契约](architect-workspace-model.md)，最终独立验收由接入计划维护。
