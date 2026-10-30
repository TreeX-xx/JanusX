---
{
  "schema": "harness-note/2",
  "id": "671574ba-c6e4-54ab-8fee-8d762e72f622",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-07-05",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-07-05-agent-note-custom-desktop-toast-window--671574ba.md",
      "sourceHash": "7e68aaeee8319652ce17f82a77edbc14fecaf60bbdf511020d07657c626c33f3",
      "originalBodyHash": "6b859f349d9a09d0732157d68518229646dfc6a106e87bdd1c85a568a8f1add3",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Custom desktop toast window. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-07-05-desktop-toast.md",
        "sourceHash": "7e68aaeee8319652ce17f82a77edbc14fecaf60bbdf511020d07657c626c33f3",
        "originalBodyHash": "6b859f349d9a09d0732157d68518229646dfc6a106e87bdd1c85a568a8f1add3"
      }
    }
  },
  "updated": "2026-10-30T05:18:12.832Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# Custom desktop toast window


## Problem

System notification delivery fails silently across packaging variants. Portal builds, notification-center permissions, and shortcut registration drift apart, so task completion pings vanish exactly when background runs need them most.

## Decision

Local reminders leave the system notification path for a dedicated toast window. An independent window renders Janus toast styling above minimized or backgrounded main frames, while in-app toasts keep serving active sessions. Activating a desktop toast restores and focuses the main window at the owning terminal. The remote notification channel stays independent and never renders through the local toast. Replacement semantics govern the window: the newest reminder supersedes the current one with no stacking and no history center.

The desktop card uses the standard A layout within the existing 380 × 112 window: terminal icon and name beside JanusX, status symbol beside the supplied title, then a two-line summary. Terminal icons reuse `TerminalPresetIcon` and preset display names; unknown engines retain their supplied name with a shell icon. Codex's dark glyph is inverted on the dark theme. Neutral theme surfaces, borders and text replace the colored side strip, colored engine labels and hover glow. Completion and attention symbols stay neutral; only the failure symbol uses the theme's failure color. Brand colors remain confined to their existing icons. The in-app notification styling remains independently owned.

## Alternatives considered

- Repair system notification integration — strongest case stays native everywhere. The driver that rules it out is platform variance: each packaging quirk reopens the same failure class.
- Third-party notification library — strongest case buys stacking and history. The driver that rules it out is dependency weight for a single-window need.
- Do nothing / reuse system notifications — staying put keeps zero custom chrome. The cost is reminders that vanish by packaging luck.

## Consequences

- **Gains**: Toast delivery stands independent of shortcut and permission state; styling and behavior stay consistent across installs.
- **Costs and limits**: A second window joins the lifecycle with its own readiness handshake; stacking and history stay explicitly out.
- **Transparency over blur**: The toast page carries transparent `html`/`body` from pre-paint (an inline `toast-prepaint` hook in the renderer entry plus a synchronous class attach before React mounts), the viewport carries zero padding so the card fills the window with no transparent ring for DWM to paint, the card paints as a solid surface without `backdrop-filter`, and the window opts out of native shadow, thick frame, DWM system backdrop (`backgroundMaterial:none`), and system rounded corners (rounding stays owned by the CSS card). These native composition options are set at creation and stay unchanged across show/hide; the earlier material reassertions around show have been removed to avoid composition resets while visible. The in-app twin paints the same solid card without `backdrop-filter`. The cost is the loss of background blur behind the card, which the near-opaque surface keeps visually negligible. Windows visual behavior still requires desktop verification; unit/browser checks cannot prove DWM transparency.
- **Paint before show**: The renderer loads its initial theme before reporting subscription readiness. Main sends the cached theme before each payload and attaches a monotonically increasing delivery ID. After React commits the card, two animation frames precede `desktop-toast:painted`; main accepts only the current delivery from the toast renderer, then shows the window and starts its timeout. Hidden-window background throttling is disabled so that this handshake can complete. Replacements cancel the previous hide timeout and do not call show again on a visible window. The card has no entrance opacity/scale animation or hover translation. The trade-off is a short paint delay and a static entrance; two animation frames provide a paint opportunity, not a guarantee of Windows compositor presentation.
- **Hide clears the frame**: Every main-side hide broadcasts `desktop-toast:hide` so the renderer drops toast state while hidden; a superseding reminder paints over an empty transparent frame instead of flashing the previous one.
- **Replacement cancels actions**: A new payload or hide cancels the renderer's delayed close action, preventing an old click from dismissing the replacement notification.

## Verification

For the standard layout, `npx vitest run tests/unit/desktop-toast-ui.test.ts tests/unit/desktop-toast-window.test.ts` covers eight tests, including 48 combinations of two themes, eight terminal/fallback types and three statuses at 380 × 112 with long summaries. It checks loaded icons, layout bounds, paint readiness and replacement/hide behavior. `npm run typecheck` and the component ESLint check passed. The updated Electron smoke passed 24 dismiss/reopen cycles, 40 burst replacements and automatic hiding, with 26 captures and 144 early-frame samples; dark and planche captures were visually inspected. This validates the isolated production component/controller, not an installed application or continuous Windows compositor behavior. Temporary previews and generated smoke artifacts are removed after inspection.

`node scripts/desktop-toast-visual-smoke.mjs` bundles the current controller, preload, React component and CSS into an isolated Electron host. Config storage and renderer routing are substituted; the full packaged application is not launched. On Windows, the 2026-10-29 run passed 24 dismiss/reopen cycles, 40 burst deliveries, a theme change while visible and automatic timeout hiding. It saved 26 PNGs and sampled six early renderer frames for each reopen (144 total). Corner alpha ranged from 7 to 33 out of 255 (the CSS shadow); card interior alpha stayed 255. No opaque corner or blank sampled frame occurred. 测试生成的构建、临时 profile、JSON 结果和截图已按用户要求删除；保留本验证记录及可复用脚本，重新运行脚本会再次生成产物。

Computer-use Windows Graphics Capture inspection of both dark and planche windows showed the rounded card without a white rectangular backing. This is a point-in-time native capture, not continuous desktop recording: the renderer samples and native snapshots do not rule out an unsampled DWM flash, other GPU/driver behavior, or differences in an already installed build. Set `JANUSX_TOAST_VISUAL_HOLD=1` and optionally `JANUSX_TOAST_VISUAL_THEME=planche` to hold the test toast briefly for native inspection; the process closes its own window afterward.
