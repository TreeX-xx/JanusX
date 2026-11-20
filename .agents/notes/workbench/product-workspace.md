---
{
  "schema": "harness-note/2",
  "id": "034fb695-ff94-5476-b085-9818bcbef5c1",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-09-13",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-13-agent-note--034fb695.md",
      "sourceHash": "0bd18ce08a79210135bd8a8bfefa0882eb25db9c485276095d30601ebe437ea4",
      "originalBodyHash": "81582fef1879c468739e17fb58cbe8c460cfbdee4e180480358fd5aabf5f8764",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents 产物工作区彻底重构. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-13-product-workspace.md",
        "sourceHash": "0bd18ce08a79210135bd8a8bfefa0882eb25db9c485276095d30601ebe437ea4",
        "originalBodyHash": "81582fef1879c468739e17fb58cbe8c460cfbdee4e180480358fd5aabf5f8764"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "disposition": {"reason": "独立产物面板、store、发现与尺寸工具已经删除。统一文件窗口和共享查看器承接当前文件预览。"}
}
---

# 独立产物工作区与预览通知的历史设计

## Problem

早期工作台需要在终端之外查看生成的 Markdown、HTML、图片及 Office 文档，同时避免同一文件修改反复产生提醒。

## Decision

旧产物列按工作区索引文件，区分新增、覆盖与基线修改，用户点选后在本地标签或 Office 预览中打开。独立面板和专用 store 已退役。当前终端、文件树与对话内的文件入口使用[统一文件窗口](unified-file-window.md)，预览和编辑行为归[文件编辑专题](file-editor-experience.md)。

## Alternatives considered

独立产物列便于集中发现文件，同时引入第二套路由、宽度分配和标签状态。统一入口可以复用查看器并在内嵌与浮窗之间迁移。

## Consequences

当前工作台保留共享图片适配、Office 查看器和文件变更记录。通知分类属于旧面板的历史行为。主题样式与检查归[主题专题](theme-system.md)。

原方案、逐项试验记录与当时的限制保存在 Git `a56971d5db7a948a7a10bc5706f0d94b65ff65f2:.agents/notes/workbench/product-workspace.md`。
