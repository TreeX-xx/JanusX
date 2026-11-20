---
{
  "schema": "harness-note/2",
  "id": "1aef97e6-77fe-4bae-af51-ff560a737282",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-15",
  "updated": "2026-11-20T12:06:46Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "moduleState": "partial"
}
---

# 产品规划与版本排期

## Responsibility

本模块维护跨模块产品方向、阶段依赖和版本安排。专项计划记录交付顺序及验证边界；当前行为归各功能模块，验收以对应需求和 Task 为准。

## Design

[工程里程碑](engineering-milestones.md)汇集版本节点。[产品演进方向](product-growth-direction.md)保留个人工作台和小团队试点的探索，投入条件仍需确认。

[工作区生命周期计划](workspace-data-lifecycle-plan.md)覆盖私有数据迁移、读写预算、Hook 单次启动隔离和清理。[最小读写设计](workspace-data-contract-baseline.md)给出队列边界；中断恢复和跨环境场景的已验证范围及剩余实物验收在专项计划中维护。

[插件平台计划](plugin-platform-roadmap.md)安排 SDK、权限与授权、工作台贡献、后台服务和分发。[蓝图插件实施计划](blueprint-official-plugin.md)负责官方蓝图的拆分、兼容、签名包和本地验证。仓库的[0.9.10 发布记录](../../../docs/releases/v0.9.10.md)列有 Blueprint 与 CPA 的版本化产物。分发记录和具体平台的场景验收各自维护。
