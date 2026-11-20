---
{
  "schema": "harness-note/2",
  "id": "23372e89-e580-446d-b345-05c8a5c31d87",
  "kind": "task",
  "lifecycle": "archived",
  "created": "2026-10-02",
  "class": "feature",
  "tags": ["cliproxy","llm","codex","external-cli","windows","deferred","dashboard","multi-account"],
  "work": {
    "scope": [
      {
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "paths": [
          "src/main/cliproxy/",
          "src/shared/ipc/cliproxy.ts",
          "src/main/ipc/cliproxy-handlers.ts",
          "src/preload/index.ts",
          "src/renderer/src/services/cliproxy.ts",
          "src/renderer/src/components/CliProxyPanel.tsx",
          "src/renderer/src/components/CliProxyAccountsPanel.tsx",
          "src/renderer/src/i18n/locales/zh-CN/cliproxy.json",
          "src/renderer/src/i18n/locales/en/cliproxy.json",
          "src/main/external-cli/",
          "src/main/llm/ConfigStore.ts",
          "tests/unit/cliproxy/",
          ".agents/notes/"
        ]
      }
    ],
    "acceptanceRefs": [
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-1"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-2"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-3"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-4"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-5"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-6"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-7"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/23372e89-e580-446d-b345-05c8a5c31d87","criterionId":"AC-8"}
    ],
    "verification": [
      {
        "id": "V-1",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npm",
        "args": ["run","typecheck"]
      }
    ],
    "review": "independent"
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5",
  "disposition": {"reason": "早期 Windows 宿主内置方案已由可选官方 CPA 插件取代。保留原 Task 契约与验收状态。"}
}
---
# CLIProxyAPI gateway sidecar (deferred, Windows-first)

目前维护的是[独立 CPA 插件](../../../../plugins/cpa/README.md)。下文是原 Windows 宿主方案及其验收，插件分发不会自动完成其中的条款。

## Goal

2026-10-07: CPA integration is deferred and excluded from 0.9.1 under the accepted [remote-first release decision](../remote-first-cpa-deferred.md). No replacement release is assigned. This task remains proposed; the retained scope and acceptance criteria describe a possible later delivery, not active development. Revisit conditions and prioritization rationale belong to that decision.

If resumed after scope review, ship a Windows-first CLIProxyAPI (CPA) gateway integration so a user can download the official `cli-proxy-api.exe`, log in a Codex subscription via `--codex-login`, keep the gateway running on `127.0.0.1:8317`, and consume it from Janus chat plus external Codex CLI through per-terminal provider entries. No shared credential pool: each terminal keeps its own `llm-config.json` collection and only stores the local gateway key, never the OAuth token. No TypeScript reimplementation of CPA translators.

## Scope

P0 Windows spike (time-boxed, no UI): manually download the official Windows amd64/arm64 release, verify `checksums.txt` SHA-256, run `cli-proxy-api.exe -config config.yaml --codex-login` with browser callback on port `1455`, fall back to `--no-browser` and `-codex-device-login` when the callback is occupied, then start the daemon and prove `POST http://127.0.0.1:8317/v1/chat/completions` plus `GET /v1/models` answer with a Codex OAuth credential. Record the exact release version, callback ports (`8317/1455/8085/54545`), and failure modes. Abort the task if official login is broken on Windows.

P1 managed binary plus lifecycle: new `src/main/cliproxy/` domain reusing the `external-cli` house patterns (`tool-registry` single table, `CliDetector`-style probe, `CliInstaller`-style busy guard, `SerialQueue` plus atomic write). Responsibilities: per-arch download URL resolution from the official GitHub Release, SHA-256 verification before replace, install into `userData/bin` (never overwrite live `config.yaml` or `auth-dir`), `detect` (not-installed / installed-but-broken / ready plus version via `--version` re-probe), `start/stop/status` with health check against `/v1/models`, port-conflict diagnosis, and quarantine of corrupt downloads. No `npm -g` path; no bundled binary in `electron-builder.yml` within this proposal.

P2 config plus login orchestration: generate `userData/janusx/cliproxy/config.yaml` from a minimal template (`host: 127.0.0.1`, `port: 8317`, `management.allow-remote: false`, random local `access.api-keys[0]` and `management.secret-key`, `auth-dir` in `C:/` spelling on Windows). Wrap the three login flows (`--codex-login`, `--codex-login --no-browser`, `-codex-device-login`) with `execa` under UTF-8 PowerShell quoting, stream the device URL/code back to the renderer, never log tokens, back up `config.yaml` before every write (10-file rotation like `ClaudeSettingsApplier`), and refuse `host: ""` binds.

P3 Janus-internal consumption (no sharing): expose the gateway as an ordinary `api-key` provider entry inside each terminal's own collection via the existing `llmService.saveTerminalProvider` path (`src/main/llm/ConfigStore.ts`, `src/main/llm/config-document.ts` unchanged in shape). Provide one-click "write gateway provider into this terminal" per tab (`janus` first, then `codex`/`claude` as needed), each writing `baseURL=http://127.0.0.1:8317/v1`, `apiKey=<local gateway key>`, `modelId=<gateway model alias>` into that terminal only. No pool, no binding map, no cross-terminal reference; editing one terminal never touches another. This extends [the per-terminal collections design](../../terminal/terminal-provider-collections.md) without reopening it.

P4 external Codex CLI pointing: extend the existing per-format projectors (`src/main/external-cli/terminal-projectors.ts`) with a `model_providers.cliproxyapi` TOML block writer for `~/.codex/config.toml` (`base_url=http://127.0.0.1:8317/v1`, `experimental_bearer_token=<local key>`, `wire_api=responses`), keeping the current `model`-key projector, backup-plus-verify, and rollback semantics. Never write `~/.codex/auth.json`; OAuth stays inside CPA `auth-dir`. LAN exposure is outside this proposal. Multi-provider login flows move to P6 below.

P5 UI plus packaging: Settings gateway card with four states (not-installed / stopped / running / broken), actions (download, start, stop, login-codex, open-management, copy-gateway-key), port status line, and zh-CN/en copy in a new `cliproxy` i18n namespace. IPC chain follows the house pattern (`src/shared/ipc/cliproxy.ts` to `src/main/ipc/cliproxy-handlers.ts` to preload bridge to renderer service). No `extraResources` binary in this proposal; on-demand download only. Show the subscription-ToS risk notice before first login. The card keeps an `open-management` fallback (native `http://127.0.0.1:8317/management.html`) for long-tail features without reimplementing them.

P6 full account cards (CPA-Dashboard parity, Janus-native reimplementation, no Python bundle): new `CliProxyAccountsPanel` mounted at the top of the Settings `llm` tab above `CliSyncSection` (general tab keeps only the P5 one-line health row). Visual and interaction parity with `dongshuyan/CPA-Dashboard` account page, rebuilt in React with Janus tokens plus the `cliproxy` i18n namespace — never an iframe or bundled `app.py`. Sections: (a) service control row (start/stop/restart, PID plus service dir plus log path, log view with auto-refresh plus clear); (b) stats overview (total plus per-type plus ULTRA/PRO plus needs-relogin counts); (c) account card grid, one card per credential from `GET /v0/management/auth-files` (local `auth-dir` JSON read as offline fallback): email, provider tag (Antigravity, Gemini CLI, Codex, Claude, Qwen, iFlow, Kimi), membership (ULTRA/PRO/FREE), status (active versus needs-relogin), quota bar plus reset countdown where the provider exposes realtime quota (Antigravity) else the static model list synced with CPA `model_definitions_static_data.go`; (d) per-card actions (refresh-quota, delete with confirm, Codex refresh additionally probes Models API and marks needs-relogin on 401); (e) top-level actions (refresh-all with 1-32 concurrency default 4 plus persisted quota cache, add-account OAuth wizard covering all 7 providers with callback ports `51121/8085/1455/54545/55998` plus device-code for Qwen/Kimi, batch-delete needs-relogin with double confirm); (f) type filter (all plus 7 providers plus ULTRA/PRO) combined with needs-relogin-only toggle; (g) connection info block (Base URL, local gateway key count, copyable cURL/Python/OpenAI-SDK examples). Data path is main-side only: Management API with `Bearer <management-key>` over `127.0.0.1` (`/auth-files`, quota switches, `/reset-quota`, `/logs`, `/api-call`), `SerialQueue` plus quota-cache atomic write, tokens never reach logs or renderer state beyond display-masked email. Full login coverage (all 7 OAuth flows) lands here, not in P2.

Non-goals for this proposal: bundling the exe into the installer, TS port of Codex/Claude translators, `allow-remote:true`, auto-update of the sidecar, Linux/macOS packaging sign-off (code must not break them, but verification is Windows-first plus typecheck).

## Acceptance criteria

- [ ] AC-1: On Windows, official binary plus `--codex-login` (or device fallback) yields a working gateway; `/v1/models` and one `/v1/chat/completions` call succeed through the Codex subscription with no manual YAML editing beyond the generated template.
- [ ] AC-2: Download path verifies SHA-256 before replace, never overwrites `config.yaml` or `auth-dir`, serializes concurrent installs, and re-probes before reporting success; corrupt download fails closed with no half-written binary.
- [ ] AC-3: Gateway binds `127.0.0.1:8317` only, management is localhost-only with a required key, tokens never appear in logs or renderer state, and every `config.yaml` write keeps a restorable backup.
- [ ] AC-4: No shared pool is introduced: gateway credentials reach terminals only as independent per-terminal `api-key` entries; deleting or editing one terminal leaves the others untouched, and `janus` internal features keep resolving the `janus` collection.
- [ ] AC-5: External Codex CLI can be pointed at the gateway through the projector with backup plus verify plus rollback, without touching `auth.json`; rollback restores the newest backup and refuses loudly when none exists.
- [ ] AC-6: UI shows the four gateway states with working download/start/stop/login actions, port-conflict and broken-binary diagnostics, zh-CN/en copy, and the ToS notice; `npm run typecheck`, unit suites, and `npm run i18n:check` stay green.
- [ ] AC-7: Settings `llm` tab shows the full account grid with CPA-Dashboard parity (service row, stats, per-card email plus provider plus membership plus status plus quota-or-static-list, refresh plus delete, refresh-all concurrency, 7-provider add wizard, type plus needs-relogin filters, batch-delete-invalid with confirm, connection examples); no Python runtime, no iframe, Janus tokens plus `cliproxy` namespace.
- [ ] AC-8: Quota path is main-side only with cache plus concurrency 1-32 default 4, Codex 401 marks needs-relogin, offline falls back to `auth-dir` JSON read, management key stays localhost-only and out of logs/renderer secrets.

## Verification

- `npm run typecheck` (V-1, required).
- `npx vitest run tests/unit/cliproxy` (new: download-verify, config-template, port-conflict, provider-writer, projector-block, auth-files-parse, quota-cache-concurrency, card-filter suites; network and OAuth flows mocked, no live subscription in unit).
- `npx vitest run tests/unit/external-cli tests/unit/llm` (regression: terminal collections and projectors untouched in shape).
- `npm run i18n:check` (new `cliproxy` namespace in sync).
- Manual Windows-only: official exe download, `--codex-login` plus device fallback, daemon start, Janus chat call through the gateway provider, `codex CLI` call through `model_providers.cliproxyapi`, stop plus rollback; record release version and ports in Results. No live credentials in the repo.

## Alternatives considered

- Bundle the exe in `electron-builder.yml extraResources` like `resources/officecli` — strongest case is offline install with zero download code. The driver that rules it out for this proposal is payload and cadence: per-arch tens of MB plus CPA release churn plus signing review; on-demand download keeps the installer lean, with bundling as the revisit.
- Reimplement Codex OAuth plus translators in TypeScript — strongest case is zero binary and full control. The driver that rules it out is maintenance: Codex cloaking, Claude betas, and quota semantics track upstream constantly; the sidecar buys all of it for one process-supervision module.
- Point every terminal at one shared gateway provider record — strongest case is single-copy secret. The driver that rules it out is the adopted [per-terminal collections decision](../../terminal/terminal-provider-collections.md): independent `{providers, defaultId}` per terminal with one-time copy, never references; sharing reopens sprawl and cross-terminal delete propagation.
- Depend on an external EasyCLIProxyAPI install only — strongest case is zero Janus code beyond docs. Managed login, daemon supervision, and one-click provider wiring would improve setup if this proposal resumes; external-only remains available while integration is deferred or managed download is unavailable.
- Bundle or iframe CPA-Dashboard (`dongshuyan/CPA-Dashboard` Flask `app.py` on `:5000`) — strongest case is instant full cards with zero React work. The driver that rules it out is stack and trust cost: extra Python venv plus pip plus second supervised port, theme plus i18n plus ToS-gate mismatch, management key in browser localStorage reversible-obfuscation instead of Electron main-side custody, no one-click write into per-terminal collections, and no published license file for bundling; Dashboard stays the product-pattern reference plus the `open-management` fallback, never a runtime dependency.
- Embed the official `management.html` (`:8317/management.html`) in a webview — strongest case is zero parity drift. The driver that rules it out is the same custody gap (localStorage key, no Janus tokens/i18n, no house backup plus verify patterns); keep it as the linked fallback behind `open-management`.
- Do nothing / keep hand-edited `baseURL=http://127.0.0.1:8317/v1` — costs nothing now. The cost is the gap above: manual binary, YAML, login, daemon, and per-terminal wiring with no safety net on Windows.

## Results

2026-10-07: Deferred, with no execution evidence recorded. All acceptance criteria remain unchecked. If implementation resumes and lands, record the CPA release version, Windows verification log, and unit plus typecheck plus i18n results here.

## Progress

Historical delivery statements remain in this document; no v2 execution receipt is asserted.

## Evidence

Original source: Git e433bb8627150126b782a301352da05e2149c18b:.agents/notes/2026-10-02-cliproxy-gateway-sidecar--23372e89.md. See docs/migrations/note-v2.json for the raw-source hash and historical execution.

## Handoff

Main Agent owns this Task. Reassess scope, fixed acceptance sources and verification before any new run. Preserve independent-review obligations; subagents read only.
