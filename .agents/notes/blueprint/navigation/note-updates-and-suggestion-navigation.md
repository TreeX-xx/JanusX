---
{
  "schema": "harness-note/2",
  "id": "77bf944c-de24-4d59-8568-bea35aa30cd4",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-10-10",
  "updated": "2026-11-20T12:11:42Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/17bbe20e-f05c-470c-aee1-3f92a86369ab",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/5d28b582-d905-4aa6-bfc8-8aa33ac17cdd" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c28b6fb3-5cb4-4ebc-895d-0e8dab6c1725" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/9a1a80ef-5f36-474a-905b-c12a902f9b2f" }
  ],
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/ui/BlueprintAttention.tsx", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/ui/NoteReviewPanel.tsx", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/ui/Graph.tsx", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/main/blueprint/note-reading.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/main/blueprint/review/git-scheduler.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/main/blueprint/review/note-repair.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/main/blueprint/review/note-repair-turn.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/blueprint-note-reading.test.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/blueprint-review-retry.test.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/note-repair.test.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/blueprint-plugin-navigation.test.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/e2e/blueprint-local.spec.ts", "role": "test"}
  ]
}
---

# Note 更新、阅读与建议定位

## 更新与已读

插件按工作区记录 Note 的版本。注意列表分为更新、建议与自动审核活动，支持搜索、按模块筛选、定位及连续阅读。打开正文后按实际呈现的 noteId、path、hash 确认已读。批量已读提交所选版本，浏览期间到达的新版本仍可出现在下一次扫描中。

## 右上角审核入口

注意列表汇集正在执行、已完成和需要重试的审核。阅读或定位只读取现有状态。审核的触发条件、设置与覆盖类型由[审核专题](../maintenance/note-content-review.md)维护。

## 修复闭环与左侧界面

选择建议定位到关联的原始 Note。阅读区可以在正文、目录和关系之间切换，展开审核卡查看意见和证据。源文件变化后按新版本刷新，旧结果可用于辨认上次审核的对象。

## 建议定向修复

修复操作绑定工作区、Note 身份、报告修订与问题 ID。结构问题绑定路径和文件哈希。用户可以讨论、逐条处理意见，或发起修复；写入后的版本交由阅读服务观测，并触发结果刷新。[建议管理](../maintenance/suggestions/module.md)维护意见的有效期和删除规则。

### 整篇修复、紧凑卡片与独立对话

“修复全部”提交该报告列出的所有问题。“讨论”沿用相同来源进入对话。写入、失败、重试复核及可用的修复撤回由修复服务处理；普通维护提案的确认写入另见[维护模块](../maintenance/module.md)。

### 反馈、布局与结构审核回归（2026-10-11）

旧宿主界面的布局、动效、故障取证和分次验证属于迁移前的记录。当前的阅读、建议、图导航与修复入口都在官方插件中，桌面切换和签名安装的验证范围见[插件实施计划](../../planning/blueprint-official-plugin.md)。

原方案、逐项试验记录与当时的限制保存在 Git `851a93d70c14b3d016ab8c3463e6e5962a4a58cf:.agents/notes/blueprint/navigation/note-updates-and-suggestion-navigation.md`。

## 当前测试边界

`blueprint-note-reading.test.ts` 覆盖首次阅读、版本变化、已读撤回及不同工作区的隔离。仓库夹具写死 Windows 盘符，在 macOS 有 9 项被绝对路径检查拒绝。仅在隔离副本把两个路径替换为本机绝对路径后，同一文件 10 项全部通过。
