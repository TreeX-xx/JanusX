---
{
  "schema": "harness-note/2",
  "id": "bd612cd8-0676-4c46-98ba-81d1dc008505",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-11-20T12:06:46Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "moduleState": "partial",
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/notes/note-provider.ts", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/ui/NoteReader.tsx", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/shared/note-wiki.ts", "role": "implementation"}
  ]
}
---

# 工程文档读取与 wiki

## Responsibility

工程 wiki 展示所选 checkout 中的原始 Note。共享索引解析身份、模块归属、关系、正文链接和诊断，文件版本用原始字节的 SHA-256 标识。完整 Note URI 标识仓库和文档，跨仓读取还需明确选择目标 checkout。

## Design

宿主和蓝图插件通过共享读取服务取得快照。目录、搜索和反向引用从快照派生，源文件修改或移动后重新索引；稳定 UUID 允许移动后继续用 URI 识别同一主题。旧数据的迁移证据保存在[迁移 Task](tasks/migrate-notes-v2.md)，格式和相对链接检查见[机械校验](note-mechanical-checks.md)。

## Note 阅读面板

插件阅读区展示原文、章节和关系。点击关联目标后按实际载入的版本定位，文档阅读与审核操作各有入口。[模块导航](../navigation/module.md)维护图与阅读区的联动，[更新与已读](../navigation/note-updates-and-suggestion-navigation.md)维护阅读版本。

## Verification

读取契约与历史验收见[共享读取交付](tasks/note-blueprint-r2-read.md)及[Wiki 交付](tasks/note-wiki-r3.md)。
