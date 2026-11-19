---
{
  "schema": "harness-note/2",
  "id": "01f4c269-442b-4a80-8ac1-f4928da6b8d9",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-11-17",
  "updated": "2026-11-18T08:13:36Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3"
    }
  ]
}
---

# SuperAgent 作为可选官方实验插件

## Problem

SuperAgent 会把工作交给后台 Worker，并允许用户在执行期间继续交谈。这种交互仍在探索，运行稳定性和用户对自动分派的接受程度都需要验证。

## Decision

SuperAgent 整套编排体验作为可选的官方实验插件交付，默认关闭。普通 Janus 对话独立可用。用户主动安装并启用后，继续在同一个 Janus 对话入口使用编排能力。

插件承载任务分派、队列、Worker 视图和引擎适配。宿主负责工作区权限、审批、受管进程收尾和历史读取。启用前说明后台分派的行为；首次派发时展示负责的 Worker、当前工作和停止入口。停用时列出尚在执行的工作，由用户选择等其结束或请求立即停止。停用后仍可查看工作历史。

## Alternatives considered

曾考虑保留内置编排，仅将 Worker 引擎做成可替换模块。这能降低迁移成本，也能让引擎独立演进，但用户需要选择的是是否采用后台分派这套工作方式。以整套编排为安装单位，更符合当前产品定位。

## Consequences

迁移的源码边界、实施顺序、各阶段验收及回退条件见[插件化迁移计划](./superagent-plugin-migration.md)。

独立签名候选已接入。安装并启用插件后，Janus 工作台可受理编排；停用后保留只读历史。宿主继续持有审批和进程停止回执，并遵循已有的[生命周期决策](./superagent-lifecycle.md)。以后评估是否默认启用时，关注运行稳定性，以及用户体验一次分派后，是否会在下一项适合的任务中主动再次选择它。
