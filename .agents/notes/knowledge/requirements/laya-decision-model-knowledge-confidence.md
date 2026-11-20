---
{
  "schema": "harness-note/2",
  "id": "673865a1-4c0c-4b66-a2a5-1bb8ef4aa646",
  "kind": "requirement",
  "lifecycle": "archived",
  "created": "2026-09-22",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c0a75c6a-5d06-4088-b7ed-9ecdd835b3d3",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-22-agent-note-open-decision-model-for-knowledge-triage-and-confidence-calib--673865a1.md",
      "sourceHash": "aee49c5a0b012595a9da61f9a49bf0e9ad840401f7953bb3199d60f24491d670",
      "originalBodyHash": "53d98db52feeb6b02c1e6a06781afcb709cdbd8af76bfbcf3c795f7f484d1918",
      "category": "formal",
      "reason": "Retains the source requirement in draft lifecycle; body documents Open decision model for knowledge triage and confidence calibration (Laya selected, switch-gated; CLM tracked as extension). No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-09-22-laya-decision-model-knowledge-confidence.md",
        "sourceHash": "6f56ce631c0466d1f3a316e6a16f6328205841a7dcee52a7a43af016537eee29",
        "originalBodyHash": "eda254dea1b01b759700cc7acb12286d4790b7613506fa373db6b033b2b7cd48"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf",
  "disposition": {"reason": "工程知识生成或 Laya 评分已退役，保留原验收编号、观察状态和固定版本证据。"}
}
---

# Open decision model for knowledge triage and confidence calibration (Laya selected, switch-gated; CLM tracked as extension)

## Expected behavior

旧试验评估 Laya 能否辅助候选分类与置信度校准，并与规则及外部评分器比较。2026-10-30 已撤下 Laya 的部署、设置、控制接口与专用测试。历史样例和当时的门槛仅用于追溯。

个人侧现行行为由[个人记忆模块](../module.md)维护，工程内容审核归[蓝图维护模块](../../blueprint/maintenance/module.md)。

## 历史证据

原方案、逐项试验记录与当时的限制保存在 Git `9c49dbabfa5f9ff1a1144fb23da0a7f3f6992204:.agents/notes/knowledge/requirements/laya-decision-model-knowledge-confidence.md`。 下列勾选状态沿用该版本。

## Acceptance criteria

- [ ] AC-1: Offline spike report: Laya zero-shot vs rules vs current LLM on a JanusX-labeled sample (retention, kind, duplicate/supersedes), with accuracy, Brier, and ECE before/after temperature fitting.
- [ ] AC-2: Switch defaults to off: fresh install has `decisionModel.enabled=false`, installer size unchanged, no Python/weights vendored; pipeline output identical to today when off or provider absent.
- [ ] AC-3: Capability probe + degraded path: enable is blocked with an explicit reason (`not-installed` / `sidecar-missing` / `probe-failed`) until a local `laya-serve`/ONNX endpoint answers; sidecar-absent runs fall back to `NoopScorer` with no throw.
- [ ] AC-4: Scorer is annotate-only: temperature-fitting procedure documented per (question type, option count); no probability drives auto-accept before fitting; existing `autoAcceptDeterministicFacts` policy untouched until P2.
- [ ] AC-5: Chinese observations route to `laya-multilingual` via `Router`; English-only checkpoint never scores non-Latin scripts alone (model card: Khmer 0.000 acc at 0.952 confidence).
- [ ] AC-6: Long observations (>320-token state budget on English, >768 on multilingual) use truncation/chunking; >20-option questions use coarse-to-fine split, not one giant `choice`.
- [ ] AC-7: Typecheck passes; tests cover routing, budget fallback, calibration-gated auto-accept, and sidecar-absent degradation.
