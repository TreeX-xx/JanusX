---
{
  "schema": "harness-note/2",
  "id": "cc4811c7-b7f1-490f-8770-81eaae8805e6",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-12",
  "updated": "2026-10-22T11:45:58.917Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "tags": ["worktree", "runner", "testing"],
  "relations": [
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/80e64e6f-91eb-50a2-94b4-fbc40b112e10"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/55fdeb68-aab4-437a-8802-36d53c13bf52"}
  ]
}
---

# 按当前 worktree 运行与测试项目

## Intent

用户需要验证不同 worktree 中开发的功能。探索让运行与测试入口跟随当前选中的 worktree，并按 worktree 管理进程，减少手动切目录及误运行主盘代码。作为 0.9.2 候选功能记录。

## 落地裁决（2026-10-18，运行链路）

运行链路已按以下裁决实施（测试链路尚未跟随，见「剩余范围」）：

- **目标快照**：启动在触发瞬间解析目标——`activePaths[workspaceId]`（与终端/会话同源）缺省回落工作区根；异步读配置期间切换 worktree 不改写目标。顶栏运行按钮启动当前 worktree，Island 长按启动已移除。
- **进程归属盖章**：启动经 `ProjectRunOptions.identity` 盖章 `workspaceId/scopePath/branch/configName`，`groupByWorkspace` 两级分组出 `WorkspaceRunInfo.scopes`；id 路径前缀只作旧数据兜底，worktree 进程不再掉 `__orphan__`。
- **配置解析**：目标目录 `.janusX/janusX.launch.json` 优先，缺失时只读继承工作区根模板（`inheritFrom`）；`${workspaceFolder}` 展开为目标路径，继承配置解析出目标目录外的 `cwd` 直接拒绝，杜绝跑回主盘。
- **运行显示**：每项目一个紧凑刻度，worktree 仅在详情分组（详见 [顶栏运行入口与紧凑运行指示器](run-orb-budding.md)）；面板按作用域分组，空闲 worktree 可直接启动，停止分「整个工作区 / 单 worktree / 单进程」三级。
- **同 worktree 多配置并行允许**（processId 含 configName；`maxConcurrent=5` 全局限流不变）。

## 剩余范围

- 测试入口跟随目标 worktree：`ProjectTaskResult` 保留 `projectPath`/分支身份，结果卡标明验证的哪份代码。
- 端口冲突自动分配（现仅面板警示）与 Electron 多实例隔离（应用数据、调试端口、单实例锁）的评估。
- worktree 删除时仍有活进程的守护语义（提示先停或 force 后保留孤儿归属）。
- 项目设置/子项目入口的目标解析与 Island 侧 `startScope` 完全同规则（现仅盖章一致，未做触发时 worktree 快照）。
- 依赖安装引导（worktree 创建的共享/复制策略已有，运行前缺失依赖的提示未做）。

## 已归档的开放问题

- 选中状态以 `useWorktreeStore.activePaths` 为准；目标已删回落工作区根（`applyExternalWorktrees` 既有语义）。
- 配置独立存各 worktree、缺失继承主仓只读模板；保存永远落目标目录。
- 统一入口为 `useProjectRunning.startScope`，各启动面共用。
- 停止语义：运行面板内分别对工作区、worktree、单进程执行显式点击与二次确认；指示器本身仅查看。
