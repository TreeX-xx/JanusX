---
{
  "schema": "harness-note/2",
  "id": "ff0fe2db-3fbe-5071-b9dd-a8a947b756dc",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-06-28",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-06-28-agent-note-agent-desktop-notifications--ff0fe2db.md",
      "sourceHash": "efbab0189be64162e94735697b517a373ce81af788a5378b47d0f9ea5c1bd0cc",
      "originalBodyHash": "fc1181c36b1d442f6ef6425bf22eddc130f11b424e53b4dbda82675b57d9001e",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Agent desktop notifications. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-06-28-agent-notifications.md",
        "sourceHash": "efbab0189be64162e94735697b517a373ce81af788a5378b47d0f9ea5c1bd0cc",
        "originalBodyHash": "fc1181c36b1d442f6ef6425bf22eddc130f11b424e53b4dbda82675b57d9001e"
      }
    }
  },
  "updated": "2026-11-18T07:14:32Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---
# Agent desktop notifications


## Problem

Long agent runs finish while the user looks elsewhere. Completion, failure, and approval-waiting states surface nowhere unless the window holds focus, so background work stalls on unnoticed checkpoints.

## Decision

A main-side notification service handles Agent completion, failure, and approval-waiting events. On macOS it posts silent system notifications through Notification Center so posting leaves window presentation to macOS. An unavailable or rejected native notification falls back to the main renderer. On Windows and Linux the service tries the [custom desktop toast](../desktop/desktop-toast.md), then native and in-app delivery. A click on a desktop notification restores and focuses the main window at the owning terminal. Delivery and dismiss callbacks leave window focus alone.

Hook bridges normalize Claude, Codex, and OpenCode events and the headless start chain. Settings control notification enablement, success and failure delivery, minimum duration, and failure-text truncation. The native path keeps a bounded set of recent notification objects alive for clicks and releases them on click, close, or failure.

## Alternatives considered

- Window-only toasts — strongest case needs no native integration. The driver that rules it out is invisibility: background and minimized states miss everything.
- Polling run state from the renderer — strongest case keeps logic in one process. The driver that rules it out is wakefulness cost plus missed transitions between polls.
- Do nothing / reuse terminal output only — staying put ships zero notification surface. The cost is stalled approvals nobody sees.

## Consequences

Desktop notifications default to enabled; remote notifications, the Feishu provider and inbound control default to disabled. Normalization preserves explicit user switches. These defaults already existed; the 2026-10-19 optimization changes loading rather than overwriting persisted preferences.

`FeishuInboundRuntime` loads `sdk-channel` and the Feishu SDK only after remote notifications, provider App mode, inbound control and credentials pass the enablement gate. Desktop-only startup, disabled control and outbound-only webhook use do not load that SDK through the runtime. Async loading stays inside the existing serialized reconfiguration queue: disable/stop runs after a pending load and closes its client; loading failures become the existing redacted failure status and allow retry. Enabling once retains the imported module in Node's cache even after disconnect, so this primarily avoids cold-start cost for users who never enable control. Main-window setup now configures the runtime once rather than twice.

Validation: 22 targeted tests passed across runtime, defaults/normalization, SDK adapter, settings IPC and outbound dispatch; TypeScript passed. The isolated production build emits the SDK adapter as a separate dynamically imported chunk. No real notifications were sent and no existing profile settings were changed.

- **Gains**: Every terminal state needing attention raises a notification with a click path back to its terminal; hook normalization covers all three engines plus headless runs.
- **Costs and limits**: macOS system banners depend on a signed bundle and notification permission. The existing renderer receives a failed post while the current Space stays active. Focus modes and Notification Center determine whether an accepted post appears as a banner.

## macOS notification verification

The regression tests cover platform routing, click-only activation, unsupported and rejected native delivery, and single delivery when custom window creation fails. The notifier, toast controller, and hook coordinator passed 49 unit tests. Three toast browser tests passed.

An isolated, ad hoc-signed Electron 45.3.3 host on macOS 27.0 exercised the real permission-denied path. One in-app IPC event was sent. The main window stayed hidden, no toast window was created, and the frontmost application was unchanged across 13 samples. Authorized banner delivery and click routing across ordinary and full-screen Spaces still require installed-app testing.
