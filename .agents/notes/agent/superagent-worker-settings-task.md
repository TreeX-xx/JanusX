---
{
  "schema": "harness-note/2",
  "id": "afc0dc04-3d3b-4556-9ac5-9d0217e72d70",
  "kind": "task",
  "lifecycle": "accepted",
  "created": "2026-11-10",
  "updated": "2026-11-20T12:09:55Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "work": {
    "scope": [{"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","paths":["src/","tests/","docs/"]}],
    "acceptanceRefs": [
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/afc0dc04-3d3b-4556-9ac5-9d0217e72d70","criterionId":"AC-1"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/afc0dc04-3d3b-4556-9ac5-9d0217e72d70","criterionId":"AC-2"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/afc0dc04-3d3b-4556-9ac5-9d0217e72d70","criterionId":"AC-3"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/afc0dc04-3d3b-4556-9ac5-9d0217e72d70","criterionId":"AC-4"}
    ],
    "verification": [{"id":"V-1","kind":"command","required":true,"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","cwd":".","program":"npm","args":["run","typecheck"]}],
    "review": "self"
  }
}
---

# SuperAgent Worker 设置与模型控制

## Scope

在指定 SuperAgent checkout 内接入真实设置与右侧 Worker 模型控制。仅改本任务相关源码、测试和文档，保留所有既有未提交改动。不修改外部引擎仓库、固定引擎包字节或其他 checkout。用户最新补充已授权安排 Worker 实现，并要求 UI 符合整体软件设计。原设置 Demo 是历史原型，不是当前实现依据。

## Acceptance criteria

- [ ] AC-1: 设置中展示 Worker 终端类型、默认模型和推理强度；配置持久化并被新 Worker 使用。仅实际支持的受管后端可选，不伪装支持 Claude 或 shell。
- [ ] AC-2: 右侧可独立调整 Worker 模型和推理强度，明确当前配置及生效时机，避免把保存偏好描述为已切换运行中的模型。
- [ ] AC-3: 复用既有设置组件、主题变量和终端图标，中英文齐全，不使用大脑图标或 Emoji。
- [ ] AC-4: 默认值、单 Worker 覆盖、恢复默认、配置验证与错误反馈可验证；不破坏受管权限、输入投递、停止和执行身份边界。

## Verification

必须执行类型检查和最小相关配置／运行时回归。实现者自查并记录实际运行的命令和结果。Main 验证关键接线与 UI；真实云模型／新增后端未验证必须明确记录。

## Progress

当前工作树已接入默认设置持久化、公开 factory 设置适配器、IPC／preload、设置页和右侧模型控件。Main 已检查接线、原生读回与投递边界，复验配置和 IPC 检查并查看主题截图。实际命令、测试数量、源码哈希与限制保存在本 checkout 的 artifacts/superagent-worker-settings/verification.json；未提交、未发布，未作独立评审或真实云模型质量声明。

## Evidence

本次仅修复验收清单的 Markdown 标记，使共享索引能定位原编号。原交付证据对应修复前的 Task，重新执行须使用当时固定的输入或重新核对契约。

固定验收仍为 AC-1 至 AC-4，规范为 harness-note/2；原交付记录所载的 canonical contract hash 为 c90f9cdf02d87ed176b67a7cbe06600de6ce60662bebe5dded892a7773e67157。Janus 工作的七份原始输入已读取，最新 input 24 要求重新分配 Worker；Main 更新本 Task 后由新的 coderX 接续实现。当前分支 feat/superagent-automation-exploration，HEAD 742db250fd6588d2a93717c26705b8b40fcf7dc3。测试与人工截图证据见本 checkout 的 artifacts/superagent-worker-settings/。

## Handoff

实现与 Main 自查已收敛，返回 Janus 宿主审阅工作树。该次交付覆盖受管 Codex；默认配置持久化，逐工作覆盖随应用会话保留且有界，跨重启覆盖与其他终端后端未交付。保留所有原有未提交修改。
