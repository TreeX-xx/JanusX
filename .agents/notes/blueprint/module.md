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
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/41a64d3c-2811-4dc8-a1ab-2c5c541ec123"
    }
  ],
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# Note 与蓝图

## Responsibility

蓝图把当前工作区中的原始 Note 投影为可浏览的模块、正文与关系。agentX 的共享服务负责身份、读写和文件事务；JanusX 的官方插件负责画布、阅读、讨论、审核与建议。Task 的执行及其回执由[Agent 模块](../agent/module.md)维护。

## Design

[文档读取](documents/module.md)提供同源正文和可重建的索引。[模块导航](navigation/module.md)根据 module 和 parent 显示职责树与直接归属的内容。[工作区接入](workspaces/module.md)管理当前实际 checkout 的状态、初始化和切换。单根首页显示项目模块，进入子模块后可返回原浏览位置。

[维护对话](maintenance/module.md)将只读讨论与文件预览、确认写入分开。[建议管理](maintenance/suggestions/module.md)按来源版本维护当前意见，目标删除后清理建议。外部客户端可通过[Note MCP](note-mcp.md)访问获准的工作区。

官方插件独立提供 UI、设置和受信后台；宿主提供通用插件和共享 Note 接口。插件清单与仓库的[0.9.10 发布记录](../../../docs/releases/v0.9.10.md)均列出 Blueprint 1.0.9。本地调试入口为 `npm run dev:blueprint`，分发、验证范围与尚待验收的场景见[插件实施计划](../planning/blueprint-official-plugin.md)。

## 当前演进方向

[产品方向](product-direction.md)与[交付计划](evolution-roadmap.md)维护后续讨论。工程知识以原始 Note 为来源；个人画像、召回和备忘录归[个人记忆模块](../knowledge/module.md)。

## Acceptance criteria

- [x] AC-1: 工程内容由共同 Note 来源读取，视图不维护第二份文档身份或关系真源。
- [x] AC-2: 文档呈现与 Task 执行、回执职责分别拥有明确入口。
