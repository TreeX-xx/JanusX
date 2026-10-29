---
{
  "schema": "harness-note/2",
  "id": "493e1f10-06a4-44a0-aab4-4d6f6f2a9795",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-02",
  "class": "bug-fix",
  "updated": "2026-10-29T11:24:13.901Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---
# Terminal hooks follow each engine's execution contract

## Problem

Codex on Windows runs hook commands through PowerShell. A quoted executable path without the call operator is a string expression, so the command fails with `UnexpectedToken` and exit code 1 before the notification sender starts. Claude uses Git Bash, where a leading PowerShell call operator fails with exit code 2. A single Windows command format cannot serve both shells. Missing events leave terminal status stale even while the CLI keeps working.

OpenCode emits `properties.status` as a tagged object. Matching only string values loses the busy event and prevents the coordinator from opening the turn. Matching words anywhere in the serialized payload can instead mistake a retry message containing “busy” for a running status. File-presence and command-string tests cannot establish that an installed hook delivers an event.

## Decision

`AgentHookConfigManager` restricts JSON command generation to Claude and Codex. Windows Codex commands use PowerShell's call operator and single-quoted arguments; Claude commands use POSIX quoting. Both launch the same hidden executable. The fallback launches PowerShell with a script expression quoted for the outer engine shell and preserves the execution-policy bypass. Linux and macOS use the existing POSIX executable client. Commands retain the ownership marker. Preparation writes only JanusX userData assets; Claude additional settings and Codex session flags load them for one launch. Legacy global registration removal belongs to P5.

OpenCode uses additional OPENCODE_CONFIG_CONTENT without replacing the native config directory. Version 2 uses a default id/setup definition, api.event.subscribe and --standalone; version 1 uses its legacy event plugin via a file URL and receives no v2 flag. The actual resolved binary version selects the adapter; probes are reused until the binary changes. Version 2.1.4 and 1.2.27 have real delivery evidence; 1.19.5 timed out during fresh-home initialization and remains unverified. Questions retain input semantics rather than approval. See [launch isolation](terminal-hook-launch-isolation.md) for the supported matrix, native trust exception and final verification.

Pi uses its `--extension` adapter with `agent_start`, `agent_settled`, `ui_prompt_start`, and `after_provider_response`. OpenCode and Pi HTTP requests have a two-second abort deadline; a stopped or unresponsive bridge must not hold the CLI event handler indefinitely. Janus emits native events in its CLI and needs only the bridge environment. DSH has no installable hook contract and uses its existing PTY diagnostics; ordinary Shell has no agent hook. The [Janus/Pi integration decision](./janus-pi-hook-management.md) owns those adapters' event semantics.

## Alternatives considered

One shared Windows command is shorter and keeps the hidden runner unchanged, but its shell syntax cannot satisfy PowerShell and Bash. Removing the runner and always starting PowerShell reduces the number of processes to maintain, but restores visible console windows on affected launch paths. Editing only the global Codex hook file restores a local command temporarily, but an older JanusX process can overwrite it when creating a terminal. The command generator and the deployed runtime must agree.

Do nothing / reuse string-only tests preserves the current test speed and avoids subprocess dependencies. It does not exercise the failing boundary, so it cannot establish that either shell invokes the sender. The chosen tests execute the generated commands and require actual bridge delivery.

## Consequences

Windows shell integration tests compile the runner in an isolated directory, execute every configured Claude and Codex event through the real shell, and cover the fallback with spaces, apostrophes, dollar signs, and UTF-8 payloads. They require Windows and Git Bash; unavailable platforms or shells are reported as skipped. Runtime plugin tests exercise OpenCode's SDK payload shapes and Pi's event mapping. Both plugin suites also exercise a server that accepts a connection but never responds.

Verification uses `npx vitest run tests/unit/agent-hook-shell.test.ts tests/unit/agent-hook-config.test.ts tests/unit/agent-hook-bridge.test.ts tests/unit/agent-hook-coordinator.test.ts tests/unit/agent-engine-capabilities.test.ts tests/unit/opencode-hook-plugin.test.ts tests/unit/pi-hook-extension.test.ts tests/unit/knowledge/agent-turn-recorder.test.ts tests/unit/terminal-launch.test.ts tests/unit/terminal-launch-program.test.ts`, `npm run typecheck`, and `npm run build`. The ten suites pass 77 tests, including 20 real-shell event deliveries. The sibling Janus CLI's `tests/janusx-hook.test.ts` passes four native sender tests. These checks exercise local delivery and classification, without paid model calls or a full interactive turn in every provider.

An already-running application retains its loaded code. Persistent repair requires starting the rebuilt application; changing source or hook JSON alone cannot replace the old installer in memory. Revisit the shell adapters when Codex or Claude changes its hook shell, and revisit DSH integration when it exposes a documented event interface.
