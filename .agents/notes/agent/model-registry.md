---
{
  "schema": "harness-note/2",
  "id": "31cda2d8-3b47-5cce-affd-3978b2189c19",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-07-09",
  "class": "process",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-07-09-agent-note-unified-model-registry-with-openrouter-sync--31cda2d8.md",
      "sourceHash": "34efed6b3d6b33c411b3680cc1966c2d8e2a6731e3abd70dc06e4d6c39d60a60",
      "originalBodyHash": "094b38c90421f67d8d5a6af388f5d136df17089324d6a0c16032fe2b7c4a0588",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Unified model registry with OpenRouter sync. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/process/2026-07-09-model-registry.md",
        "sourceHash": "34efed6b3d6b33c411b3680cc1966c2d8e2a6731e3abd70dc06e4d6c39d60a60",
        "originalBodyHash": "094b38c90421f67d8d5a6af388f5d136df17089324d6a0c16032fe2b7c4a0588"
      }
    }
  },
  "updated": "2026-11-10T02:32:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---
# Unified model registry with OpenRouter sync


## Problem

Model capacity changes independently of application releases. If chat budgeting reads only bundled metadata, new model IDs receive a 16,384-token estimate and trigger premature history compaction. Adapter lists also contain bundled limits, so treating every listed capacity as a provider override prevents updated metadata from taking effect.

## Decision

Registry and provider JSON imports use `with { type: 'json' }`, supported by the repository's Node 24 runtime and Electron's Node 22 runtime. The removed `assert` syntax cannot be parsed by Node 24. Repository Blueprint tests resolve model metadata from the current workspace source; independent plugin builds continue consuming locked published archives.

OpenRouter supplies the bundled registry and runtime catalog cache. Janus chat, the blueprint conversation and Note repair share the model port in `janus-agent-ports.ts`. Each resolution queries model metadata and the adapter list, including when manual settings exist. Complete automatic context and maximum-output pairs take precedence in this order: runtime catalog, adapter list, then bundled exact or high-confidence match. A valid manual pair applies only when no complete automatic pair is available. Context-only settings cannot suppress output detection. The detected maximum output is passed to generation without the previous 20%-of-context cap; context budgeting reserves that output allowance.

The service reads `userData/janusx/model-catalog.json` and uses the bundled document when the cache is unavailable or invalid. Catalogs older than 24 hours trigger a background refresh. A known complete model can use its cached capacities immediately; subsequent resolutions consume the completed refresh. Missing models and cached entries without an output limit wait for the shared refresh before inference. Automatic requests have a 60-second retry interval and a 20-second network timeout. Refresh failure preserves the last valid document, and a missing runtime entry can still resolve from the bundled registry. Only exact or high-confidence matches supply automatic capacities.

Both conversation indicators query the same authoritative budget API before the first request and display context, maximum output and source. An unresolved model first offers catalog update. If the update attempt still leaves capacities unavailable, including a network failure, both manual inputs become available. An existing valid manual fallback remains editable for an unresolved model; automatic detection hides that form when complete metadata becomes available. Saving preserves other provider settings and per-model entries. Model or conversation changes invalidate pending display results. Inputs require integer context between 1,024 and 10,000,000 and maximum output of at least 256, smaller than context.

Production model ports reject unresolved limits before constructing the language model, with instructions to update the catalog and then configure both limits if necessary. Estimated values remain only for injected legacy hosts without a metadata resolver; they are not successful automatic detection.

## Alternatives considered

- Per-provider live fetching — strongest case is always-fresh data. The driver that rules it out is multiplicative fragility: every provider outage becomes a capability outage.
- Manual curation only — strongest case is full editorial control. The driver that rules it out is staleness velocity: model releases outrun editors within weeks.
- Do nothing / reuse hardcoded limits — staying put needs no pipeline. The cost is permanently disagreeing context displays.
- Refresh only when the adapter has no capacity — avoids catalog lookups for known models, but bundled adapter values can indefinitely hide updated context and output limits.

## Consequences

Settings presents the catalog as a quiet vendor/model list with separate context/capability and pricing sections. The sections sit side by side on wide screens and stack below 720px. Context and maximum output remain distinct; supported parameters become localized capability labels with readable fallback names. Runtime conversion and the bundled-registry generator preserve the complete OpenRouter `pricing` object alongside the legacy input/output fields. Older runtime caches can supply details through `raw.pricing`; older bundled entries retain their existing base prices until the catalog is updated.

Token rates show USD per million tokens, including cache reads, cache writes, one-hour cache writes, audio-cache input and internal reasoning when supplied. Missing or invalid rates stay unavailable; a published zero remains zero. Conditional `overrides` with `min_prompt_tokens` get expandable tier tables showing only overridden rates. Unknown rules and other charge types preserve their original values without assuming a token unit. These are OpenRouter reference prices, not the configured provider's bill. Revisit dedicated image/audio/search formatting when their billing-unit contracts are available.

The usage statistics page consumes this catalog to estimate persisted token records and shows a compact USD total beside total usage, with an icon to refresh prices. Coverage and unavailable prices use short tooltips; there is no separate cost table or explanatory paragraph. Conditional rates require request-level event data; unresolved tiers, cache TTL splits and separate reasoning rates remain unpriced. Codex events carry their preceding turn's model, and source-backed replay enriches missing historical models without duplicating consumption. The accounting contract and source verification live in [native usage accounting](../terminal/requirements/usage-telemetry-single-source.md).

Chat budgeting consumes the same cached catalog exposed by settings. Manual settings remain stored but do not override complete automatic metadata. Cache reuse and shared refreshes avoid one network request per conversation turn.

A missing or incomplete model may delay first detection by the network timeout. OpenRouter coverage and matching confidence bound automatic detection; unknown aliases and refresh failures can require a manual context/output pair. A known stale model keeps its previous capacities while refresh runs. Automatic metadata is a model capacity description, not proof of a provider account's restrictions. Revisit the source priority if adapters acquire authoritative provider-reported limits or catalog discrepancies become measurable. Larger output allowances reserve more context and can increase generation cost.

## Verification

The catalog presentation change passed `npx vitest run tests/unit/model-catalog-panel-logic.test.ts tests/unit/model-catalog-service.test.ts --maxWorkers=2 --reporter=dot` (20 tests), `npm run test:llm-core -- --reporter=dot` (80 tests), and `npm run typecheck`. `tests/e2e/model-catalog.spec.ts` passed two Playwright island cases covering both themes, cache/tier values, raw extra charges, 390px overflow, missing prices, search and refresh. Responses are fixtures, not provider billing evidence. Screenshots are under `artifacts/model-catalog/`. Run the island tests with `NO_PROXY=localhost,127.0.0.1` in proxy-enabled environments.

`npx vitest run tests/unit/managed-chat-session.test.ts tests/unit/llm/janus-agent-ports.test.ts tests/unit/model-catalog-service.test.ts --maxWorkers=1 --minWorkers=1` passed 49 cases: automatic priority, querying despite old manual context, both-limit validation, blocking unresolved production inference, missing-output refresh, offline/cache reuse and compaction. Network responses are simulated. The actual orchestrator regression in `chat-turn-guard.test.ts` also verifies `maxTokens: 65536` reaches inference despite a saved context-only setting. That file passed 19 of 22 cases; three engineering-memory capture/access assertions remain failing outside this capacity change.

`npx playwright test tests/e2e/janus-context.spec.ts --project=island --workers=1` passed seven cases using React and IPC substitutes. These cover both conversation entries, catalog update before manual fallback, replacing a saved fallback after matching, failed update with visible reason, both-limit persistence and late results across model switches.

The read-only dev-cache check `npx vitest run --config .cache/model-limit-current.config.ts` passed: current `gemini-3.8-flash` resolves automatically to context 1,048,576 and maximum output 65,536 even with the existing context-only setting. Configuration, cache and target Note hashes remained unchanged; no model or tool executed. Safe capacity evidence is in `artifacts/note-repair/model-limit-automatic.json`. Build and targeted source lint passed. Repository typechecking remains blocked by the pre-existing `note-mcp-server.ts:48` read-option error; this is not a claim that the historical target Note has been repaired.
