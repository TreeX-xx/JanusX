# Claude native dual-mode feasibility probes

The product adapter is now `src/main/terminal/claude-conversation.ts`, with
the native observer in `claude-mod.js`. These scripts retain the earlier
feasibility evidence; product checks use the real adapter and shared UI:

```powershell
$env:JANUSX_TEST_CLAUDE_BIN = Join-Path $env:APPDATA 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
npx vitest run tests/unit/claude-conversation-cli.test.ts --maxWorkers=1
npm run build:app
npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-claude-conversation.spec.ts
```

Those tests also use disposable config and a local fake model. The product
currently requires Windows and native 2.1.316. Complete login/folder trust in
a normal Claude terminal before enabling conversation mode for a new session.
Model and effort selectors now use the native model catalog and apply to this
session's next main-conversation turn, including native terminal input. Unsupported
questions stay in the native terminal. These selections do not save global defaults.

Run from the repository root on Windows:

```powershell
node scripts/claude-dual-mode/probe.mjs
```

The daemon probe supports reviewed baselines **2.1.314 and 2.1.316** at the standard
npm binary path. Set `JANUSX_TEST_CLAUDE_BIN` to select another installation.
Dependencies are the repository's existing `node-pty`; no SDK/ACP package is installed.

It creates a temporary workspace and home, accepts only that workspace's native
setup dialogs, disables tools, and uses a dummy key with a localhost Messages SSE
fixture. It neither copies user credentials nor calls a real model. The generated
background service and workers are stopped before exit; the temporary evidence is
kept for inspection. No system service is installed.

The probe checks:

- Native validation of stream JSON, SDK URL and cloud attach arguments.
- A working headless stream as a control, then native TUI → another process with
  the same session ID → native TUI, comparing the actual model request histories.
- Native `--bg` / `attach`, a semantic daemon reply while attached, then native
  input, comparing session IDs and native execution PIDs throughout.
- Ctrl+Z detach → semantic input → reattach without changing the execution PID.
- Whether daemon stream frames are structured deltas or ANSI bytes, and whether
  the native transcript contains partial text during a delayed response.

Semantic replies use the **private, version-specific daemon control protocol**
with `nextTurn: true`, authenticated only with the disposable daemon's own control
key. The probe does not connect directly to a worker's rendezvous socket or inject
a prompt by simulating terminal input for the semantic branch. Do not treat these
private messages as a supported public SDK. Subscribe frames are inspected, not
parsed into a proposed chat UI.

New results are saved under ignored `artifacts/claude-dual-mode/<version>/`.
Earlier 2.1.314 evidence remains in the parent artifact directory:

- `probe-report.json`: version, binary hash, outcomes, identity comparisons and cleanup.
- `probe-runs.json`: CLI arguments and captured output.
- `probe-requests.json`: localhost model request histories.
- `probe-background-events.json`: daemon subscription frames.

`completed-with-limitations` means the native-session round trip passed while
structured streaming remains unavailable on the tested channel. It does not mean
a Claude product adapter, tool/file approvals, model/effort controls, retries or
multi-client conflict handling passed. This is not JanusX renderer acceptance.

## Public Mods API: native streaming and controls

Requires **Claude Code 2.1.316**, the tested API baseline:

```powershell
node scripts/claude-dual-mode/mods-probe.mjs
node scripts/claude-dual-mode/mods-probe.mjs --interrupt-only
node scripts/claude-dual-mode/mods-probe.mjs --queue-only
node scripts/claude-dual-mode/mods-probe.mjs --settings-only
node scripts/claude-dual-mode/mods-probe.mjs --hybrid-settings --hybrid-empty --env-effort
node scripts/claude-dual-mode/mods-probe.mjs --hybrid-settings --hybrid-empty --flag-settings
node scripts/claude-dual-mode/mods-probe.mjs --hybrid-only
node scripts/claude-dual-mode/mods-probe.mjs --stop-tool-only
node scripts/claude-dual-mode/mods-probe.mjs --stop-foreground-only
```

`probe-plugin.js` is original probe code, copied into a temporary `--plugin-dir`.
This probe also uses a disposable home/config/workspace, dummy key and localhost
Messages SSE. It installs no user plugin and reads no user credentials. Unlike
the daemon baseline, it enables real native Write/Bash/TaskStop tools in that workspace.

The test uses an ordinary native TUI, documented Mods hooks/API, and HTTP settings
hooks. Dialog input uses `$.prompt.submit({text, asUser:true})`; terminal keystrokes
exercise the native surface and its setup. Structured text comes from `turn.step`,
whose chunks and return value are forwarded unchanged. No ANSI is parsed into
assistant text. This establishes a structured stream through a different channel
from the daemon baseline. The hybrid suite also loads this plugin in a native
daemon worker and submits explicit test-user input through private daemon reply.

The default suite checks:

- An empty session makes no model request; native → dialog → native input shares
  one live native PID/session and actual model history.
- Text arrives before completion without waiting for a newline. Tool chunks,
  `tool.call` and `tool.check` expose native tool activity.
- Unsent native draft survives dialog input. Plugin turn cancellation keeps the
  native process alive and permits another dialog submission; stale turn IDs fail.
- HTTP `PermissionRequest` allow/deny controls real native Write side effects.
  Native approval can complete while the HTTP hook is still pending.
- A real delayed Bash child can survive turn cancellation and still write a file.
- Two sessions in the same directory have independent injected identities and
  histories. Closing one leaves the other usable.
- `$.config.set({key:'model',value:'haiku'})` affects subsequent dialog and native
  requests and persists `model: haiku` in the **disposable** settings file.

Targeted suites verify native Esc refusal and recovery after explicit native input,
input queued during generation, and model settings respectively. Optional
`--settings-only --probe-command-settings` records the observed `command.run`
model-command timeout; it is a negative exploration, not a required passing control.

Additional boundary suites now pass on the pinned build:

- `--hybrid-settings --hybrid-empty --env-effort`: apply model/effort through public
  `turn.step` and worker-local `CLAUDE_CODE_EFFORT_LEVEL`. Actual requests cover
  Haiku/low, Sonnet/high, Opus/max, repeat changes and native input, with unchanged
  disposable user settings. Without the env override, an effort equal to the
  incoming step value can fall back to the new model's default. `--flag-settings`
  is a negative control: changing the additional settings file live does not
  apply. Evidence: `2.1.316/mods-1793451370717/` and `mods-1793451370722/`;
  `mods-1793452562246/` repeats the passing matrix with per-entry effort assertions.
- `--hybrid-only`: accept trust in the disposable native setup session, then start
  a daemon worker with Mods and attach its real TUI. Native Esc makes direct plugin
  submission return `drop`. Authenticated daemon `reply(nextTurn:true)` then enters
  exactly one recovery prompt, with live Mods text. Plugin and native follow-ups
  preserve history and the same worker PID/session. No terminal keystroke submits
  the recovery prompt. The initial job listing can lack a PID until startup is
  ready; the test waits for the Mods boot turn before checking it. The isolated
  daemon is stopped during cleanup; no user daemon is stopped.
- `--stop-tool-only`: start a real Bash task with `run_in_background:true`, take
  `backgroundTaskId` from the native result, cancel the answer, then call
  `$.tool.call({tool:'TaskStop', task_id})`.
- `--stop-foreground-only`: cancel while the Bash call is still foreground. In
  this build it moves to the background. Match the original `tool_use_id` in
  `$.session.messages().toolUses`, whose structured result contains
  `backgroundTaskId` and `backgroundedByTurnAbort:true`, then call TaskStop.
  The cancellation emits no classic Stop hook in this fixture, and the observed
  live tool completion can be missing; neither is required for this lookup.

Both TaskStop cases verify the real child exits, no delayed file appears after
its 14-second deadline, and the original session accepts a new prompt. OS process
cleanup happens after these assertions, so it cannot manufacture a passing stop.
They exercise one owned local Bash task, not arbitrary process trees, concurrent
tools, teammates, remote jobs, or reversal of already completed side effects.

Results live under `artifacts/claude-dual-mode/2.1.316/mods-<timestamp>/`:

- `mods-report.json`: checks, limitations and native PID cleanup.
- `mods-events.json`: sequenced plugin events and classic Hook envelopes.
- `mods-requests.json`: actual localhost model requests and timestamps.
- `mods-runs.json`: native CLI arguments and captured terminal output.

`completed-with-limitations` means the selected probe completed, not full product
acceptance. Material findings and remaining limits:

1. Native Esc holds plugin submissions until the next human input. The API can
   resolve successfully with `{drop: 'the session was stopped and nobody has sent input since'}`;
   transport success must not be shown as successful delivery. `asUser` retains
   plugin provenance. The interrupt test explicitly uses the native input surface
   for recovery. The separate hybrid test establishes semantic daemon recovery
   without another terminal prompt. Ordinary standalone TUI plus Mods alone still
   has the limitation; the hybrid depends on a private version-specific protocol.
2. Canceling a turn is not stopping all tools. The Bash probe demonstrates a
   side effect after cancellation. The new TaskStop tests demonstrate explicit
   task stopping for both background and cancellation-backgrounded Bash. Native
   exit may still require confirmation to stop tasks.
3. Native approval leaves the pending Hook connection open in this build. Expire
   stale approvals using correlated execution facts, not HTTP connection closure.
   Concurrent identical requests, AskUserQuestion and plan confirmation are untested.
4. Model config changes persist a default; the product therefore uses the
   session override described above. Catalog discovery uses native stream-json
   initialize without a prompt, with hooks disabled, no tools and no saved
   session. The native default footer remains unchanged; AbovePrompt shows the
   JanusX selection. Native `/model`, `/effort` or `/config` restores native
   control and can persist native defaults. Pending confirmation blocks dialog
   sends. Worker env is inherited by later children; subagent effort isolation
   and complex provider policy/alias combinations are not fully verified.
5. History rows lack stable message IDs; history/live reconciliation, compaction,
   replay, deduplication, controller ownership and reconnect are not implemented.
   The observer records sequence gaps but has no durable queue; cancellation can
   prevent observation requests from reaching the bridge.
6. Images, file mentions, multiple content blocks, subagents, real providers,
   long sessions and non-Windows systems remain untested. JanusX renderer and
   real Electron evidence comes from the product tests listed above, separately
   from these probe suites.

API references: [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md),
[events](https://code.claude.com/docs/en/plugins/mods/events.md),
[API and interruption rules](https://code.claude.com/docs/en/plugins/mods/api.md),
[build-specific types](https://code.claude.com/docs/en/plugins/mods/create.md).
Cached docs and the native build's generated types are in the ignored version
artifact directory. Review a new native build before changing the version guard.
