---
{
  "schema": "harness-note/2",
  "id": "a85f23e2-19d4-4b11-b07d-813797240311",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-17",
  "class": "feature",
  "updated": "2026-11-25T13:03:34Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/shared/native-login.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/llm/native-login.ts","symbol":"NativeLoginService","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/CliSyncSection.tsx","role":"implementation"}
  ]
}
---
# Native login-first sign-in probe

The workbench displays the active, officially signed-in Codex session’s subscription windows through its local App Server. The CLI retains ownership of login credentials. The [runtime drawer decision](../workbench/runtime-drawer-cards-resize.md#codex-subscription-quota) records the eligibility checks and refresh schedule.

## Problem

Selecting "Native settings / official sign-in" only rewrote bindings and told the user to sign in somewhere else. The switch succeeded while the next Agent session still failed for lack of credentials — the opposite of magpie's login-first model, where authentication is completed during setup and switching is a pure configuration act.

## Decision

Native mode for external Agents now probes sign-in state and gates apply on it, while login ownership stays with each CLI. `NATIVE_LOGIN_CAPABILITIES` (`src/shared/native-login.ts`) is the single capability table: credentials location plus how to launch that Agent's own login. `NativeLoginService` performs a presence-only probe — the credentials file must parse as a non-empty JSON object; contents are discarded in-process and never cross IPC. Missing file means `logged-out`; anything else (empty/malformed file, EACCES, unknown agents such as Pi) degrades to `unknown`.

In the LLM settings panel, `logged-out` shows a "Sign in" action and hard-blocks Apply; `unknown` never blocks. Sign in spawns the Agent's CLI in a hidden main-process PTY (`startNativeLogin`, one per Agent id, 5-minute lifetime) — Claude gets `/login` submitted into its TUI after a boot delay, Codex runs `codex login`, OpenCode runs `opencode auth login`. The CLI opens the browser itself and the settings panel stays in place: from the user's view, clicking Sign in pops the vendor's authorization page directly (the magpie click-to-browser feel) without JanusX hosting any OAuth UI. A 2.5s poll plus a window-focus recheck watches for the credentials file to appear and unlocks Apply automatically; the file is the only success signal, never PTY exit.

Verified against Claude Code 2.1.302 by driving a real hidden PTY (2026-10-17): the TUI sequence is boot → `/login` → **login-method menu** (1 subscription · 2 Console · 3 platform; option 1 preselected) → Enter → "Opening browser to sign in…". The runner confirms the menu automatically. An untrusted cwd inserts a folder-trust dialog that swallows keystrokes (its ANSI cursor moves also break naive text matching — strip VT sequences to spaces before matching), so Claude's login PTY runs in a directory already trusted in `~/.claude.json`. A PTY that dies early surfaces its cleaned output tail as `launchError` in the login state — this is how a port-bind failure (e.g. Codex's fixed callback port 1455 landing inside Windows' dynamic excluded range) becomes visible instead of a silent no-op.

This extends [the channel design](./terminal-provider-collections.md)'s native semantics without changing them: no OAuth session is created by JanusX, no subscription token is copied or stored, and `connection-projector` / `configuration-service.apply` are untouched — the gate exists only in the renderer. Programmatic apply paths are unaffected.

The hidden Claude login child sets `CLAUDE_CODE_NO_FLICKER=0` to use classic rendering. This PTY has no visible xterm renderer and gains nothing from fullscreen. Claude 2.1.302 records a fullscreen boot canary until the first frame has remained healthy for ten seconds; forcibly terminating the process before cleanup can leave a pending record even after a working prompt appeared. Two such failures can disable fullscreen for later sessions sharing the config. The override is passed through `TerminalConfig.env` only: workbench terminals retain their renderer preferences, and JanusX does not reset Claude's failure counters or rewrite its TUI setting. ConPTY cursor movement is normalized to spaces for menu recognition (SGR styling remains transparent); recognition uses `login method` plus the subscription label because differential output may omit part of `Select`.

## Alternatives considered

Soft guidance (status badge without blocking Apply) was rejected: it leaves the original failure mode — a "successful" switch to a signed-out Agent. GUI-internal OAuth (a subscription-token manager) was rejected as out of scope and against the standing boundary that CPA owns accounts and quotas. Running the login in a visible workbench terminal was tried first and rejected by the user: jumping to the workspace broke the click-to-browser flow magpie delivers. The hidden main-process PTY keeps the CLI as the OAuth driver while the browser becomes the only visible surface.

## Consequences

Capability table entries need maintenance when CLI credential paths or login commands drift; the probe deliberately checks only presence and shape so schema changes degrade to `unknown` instead of false `logged-out` blocks. Pi remains `unknown` with no sign-in action. Polling lives only inside the settings panel lifecycle (2.5s cadence, five-minute deadline); there is no global credential watcher or background login.

The renderer override is verified against Claude 2.1.302 and needs reevaluation if its environment contract changes. It prevents hidden login from arming new fullscreen canaries; it does not establish the cause of any user's existing strikes or fix a real fullscreen renderer crash. Existing auto-disable state remains Claude-owned. Normal PTY close followed by the current process-tree fallback cleared pending state in the isolated probe, so this change does not introduce a global graceful-close delay.

## Verification

`npx vitest run tests/unit/llm tests/unit/remaining-ipc-contract.test.ts` passed 96 tests across 11 files, including the new `native-login.test.ts` (injected temporary homes; ENOENT→logged-out, malformed→unknown, env overrides, capability-table shape lock). `npx playwright test tests/e2e/llm-configuration.spec.ts --project=island --workers=2` passed 14 scenarios including the logged-out gate, unknown/Pi passthrough, poll flip unlocking Apply, and Sign in invoking `startNativeLogin` for the selected Agent.

2026-10-18 renderer regression: `npx vitest run tests/unit/llm/native-login.test.ts tests/unit/llm/native-login-runner.test.ts` passed 14 tests; `npm run typecheck:strict-unused` and scoped ESLint on `src/main/llm/native-login.ts` passed. Tests cover child-only mode override despite a fullscreen parent, unchanged Codex/OpenCode environment, `/login` submission, and split ConPTY menu output confirmed exactly once. Notes validation passed with zero errors and 17 existing external-link diagnostics. A further `node artifacts/claude-renderer-probe/reproduce.cjs` run reproduced the exact repeated-fullscreen-failure warning on launch four after two forcibly terminated fullscreen boots, while still displaying the classic prompt.

Real CLI probes used local Node/node-pty with Claude 2.1.302, isolated temporary `CLAUDE_CONFIG_DIR` directories, synthetic onboarding/trust settings, and a dummy API key targeting `127.0.0.1:1`. No real credentials were copied, OAuth browser opened, or chat prompt submitted. `node artifacts/claude-renderer-probe/probe.cjs` compared fullscreen and classic: only fullscreen entered the alternate screen and registered pending boot state. `forced.cjs` force-killed two fullscreen boots before ten seconds (with an intervening classic fallback) and observed `fullscreenAutoDisabled.strikes=2`. `manager.cjs` tested two close sequences matching PTY kill then process-tree kill; neither left pending state. `login.cjs` reached the classic `/login` menu with no pending state. These local diagnostic scripts are untracked artifacts, not CI tests. Node-pty's console-list helper emitted `AttachConsole failed` during teardown; inspected Claude config state and captured menu output, rather than helper exit status, are the evidence. Browser OAuth completion and the packaged Electron app were not retested in this change.
