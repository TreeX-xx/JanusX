---
{
  "schema": "harness-note/2",
  "id": "f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-03",
  "class": "architecture",
  "tags": [
    "note",
    "blueprint"
  ],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/notes/note-provider.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/main/blueprint/blueprint-composition.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "plugins/blueprint/src/ui/Graph.tsx",
      "role": "implementation"
    }
  ],
  "interfaces": [
    {
      "name": "NoteReadSnapshot",
      "direction": "provides"
    },
    {
      "name": "HarnessWorkspaceStatus",
      "direction": "provides"
    }
  ],
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/46d65946-125b-56d0-b23e-05552f5b281e"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/cb026d42-c260-5e79-a66f-e455228d6eaf"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/66bf1be8-fad7-5c9c-8048-4bbe0b665950"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/553f17a8-e800-5e4a-ac55-ae454a51825b"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/4ffa1606-df23-5880-a1a5-003ab5fac9e3"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/6b7c688e-278f-5878-b88f-2bbb9d766fae"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/2a6cd90c-60fa-5fdf-acc4-2989cdf5bdc2"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/8688b5ab-1f7f-5ff9-ba1b-ef75b7fd5917"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0d703ca1-d703-451f-9ac6-15792c08f45d"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dda0c41e-4581-4de5-af98-8fbdc2e768f5"
    },
    {
      "type": "governed-by",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/47c7be36-5a48-4a27-aa86-d4f9dffb641c"
    }
  ],
  "updated": "2026-10-26T15:54:55Z",
  "moduleState": "partial"
}
---

# Note 与蓝图

## Responsibility

通过共享 Note 读取边界提供工程 wiki、文档关系与跨工作区蓝图。NoteReadSnapshot 保留原始身份、元数据、关系与诊断，视图在相同来源上组织信息。

## Design

本模块由四项长期职责协作：[工程文档读取与 wiki](documents/module.md)提供同源正文和目录；[模块投影与导航](navigation/module.md)将来源组织为可逐层浏览的模块页；[蓝图维护对话](maintenance/module.md)承接讨论、文件变更与审批；[工作区组合与初始化](workspaces/module.md)处理明确 checkout 的装配和接入。

单根首页采用根模块页，单击预览真实正文，双击进入并保留当前模块为本页父节点，返回恢复范围、预览和视口。具体交互与工具行为由导航子模块的[浏览需求](navigation/requirements/module-browsing.md)和[关注需求](navigation/requirements/module-focus-navigation.md)维护。

Janus 负责产品投影和交互；agentX 的共享 harness 包拥有解析、身份、读取缓存、创建编辑、事务、监听、共享与撤销。任务执行和回执由 Agent 对话与执行模块承接，旧工程 Wiki 生成已退出，Note 内容审核与当前建议归本模块维护职责；个人记忆保留独立能力。[共享边界](agentx-harness-inheritance.md)记录取舍。

宿主 HarnessNoteService 直接消费共享 NoteService。主进程、renderer、远程 workspace 三个入口均已断开插件业务源码；旧 CRUD、画布编辑、图投影和转换 IPC 返回插件必需提示。黑板使用通用插件入口，聊天证据和圆桌结果通过共享 Note API 读写。公共作者工具与工作区初始化归 @janusx/note-tools，公共聊天／提示组件移出蓝图目录；图身份、布局、旧 JSON 转换与审计归插件。原始旧数据保留，转换必须先预览再确认。清理后的 Windows 安装器和便携包已验证仓库外启动，主包排除 React Flow；三态资源与两版插件升级／回退已有代表证据，完整历史／功能矩阵仍未验收。

应用设置不再内置蓝图页或“创新功能”蓝图开关。安装官方插件后，由包内 settings 贡献加入设置导航，授权启用后加载隔离页面；卸载撤下入口和页面，保留数据。旧设置快捷入口转到插件管理，生产目录仍未发布。`npm run dev:blueprint` 可用独立 profile 本地签名安装和测试，不需要 Release；设置自动保存及模块导航补齐的边界、命令与证据归[官方插件专项](../planning/blueprint-official-plugin.md)。

[接入计划](workflowx-v2-adoption.md)与跨子模块的交付、性能专题保留在本层。它们引用各职责的实现和验收，不复制子模块正文。目录与旧文档的归属依据见[职责目录整理](module-responsibilities.md)。

## 当前演进方向

[产品方向](product-direction.md)是蓝图融合讨论的入口，[交付计划](evolution-roadmap.md)集中维护阶段、依赖与待讨论清单。Note 与建议的变化联动由[建议管理模块](maintenance/suggestions/module.md)集中维护，目标删除后自动清理建议。专题分别由[内容审核](maintenance/note-content-review.md)、[独立 Note MCP](note-mcp.md)和[个人工作台](../knowledge/personal-memory-workspace.md)承载。用户已确认概念融合、设置由蓝图承接、个人画像保留，以及 MCP 模块化与一键导入；原文审核、当前建议、独立 MCP 与 Git 调度已实现，共享实现继续遵循 agentX 归属。实际测试、终端兼容性和未验收项见[实施基线](implementation-baseline.md)，不将实现接线等同完整版本发布。

[官方可下载插件专项](../planning/blueprint-official-plugin.md)把蓝图专属界面与业务按需分发，保留共享引擎、原始 Notes 及独立 Note MCP 的既有契约。隔离 UI、签名分发、受信 native 服务、稳定 MCP 启动器、旧状态导入和显式 JSON 转换已有实现。仓库外锁定构建现在使用九个公开归档，原八个哈希保持不变；同产物真实页面回归接入本地与 CI，完整桌面验证使用隔离项目和 profile。宿主只保留拒绝旧调用的兼容通道，三个入口的实际业务输入由门禁约束为零。Windows 实物损坏导入、数据保留及重启已通过，旧状态导入两个杀进程边界可恢复；完整功能、历史数据矩阵、资源与真实发布继续按 BP-0–BP-6 推进，AC-20–27 未签收。共享重命名撤销和维护应用锁竞争的具体缺口归专项记录。

## Acceptance criteria

- [x] AC-1: 工程内容由共同 Note 来源读取，视图不维护第二份文档身份或关系真源。
- [x] AC-2: 文档呈现与 Task 执行、回执职责分别拥有明确入口。
