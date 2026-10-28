---
{
  "schema": "harness-note/2",
  "id": "48db2e15-9318-5068-b300-b1913abf5463",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-07-11",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-07-11-agent-note-embedded-browser-surface--48db2e15.md",
      "sourceHash": "13cf5ef4f753cba639f3ab4de9eff7829dad1c4e312c6e6dccba9ed20e1154a1",
      "originalBodyHash": "3e89eaa1285dcd2443c6a58d8d570c12a20bd459651e9a33064d3fd96f8a9ba6",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Embedded browser surface. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-07-11-browser-surface.md",
        "sourceHash": "13cf5ef4f753cba639f3ab4de9eff7829dad1c4e312c6e6dccba9ed20e1154a1",
        "originalBodyHash": "3e89eaa1285dcd2443c6a58d8d570c12a20bd459651e9a33064d3fd96f8a9ba6"
      }
    }
  },
  "updated": "2026-10-27T15:52:43.428Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---
# Embedded browser surface


## Problem

Agents manipulate code and files but never touch the live web runtimes their changes serve. Verifying a fix means leaving the workspace for an external browser, and running dev servers stay invisible to the working context.

## Decision

The workspace embeds a real browsing panel on isolated per-tab views with a persistent partition. Entry points span dedicated tabs, sidebar shortcuts, running-project links, editor handoff, and terminal URL recognition. Sandboxed local preview keeps serving static artifacts while the full surface handles scripted pages, routing, and dev servers. Agent operation of the surface stays out: no page scripting from agents, no host interface exposure, and no main-side client integration in this scope.

## Alternatives considered

- External browser handoff — strongest case needs no new carrier. The driver that rules it out is context loss: verification leaves the workspace it belongs to.
- Full browser product — strongest case covers bookmarks, history, and downloads. The driver that rules it out is scope: the panel serves tasks, not browsing as a destination.
- Do nothing / reuse sandboxed preview — staying put covers static artifacts. The cost is every live page still opens elsewhere.

## Consequences

- **Gains**: Dev servers, local previews, and documentation resolve inside the workspace beside the code that serves them.
- **Costs and limits**: Each tab carries a full view process, so tab count needs bounding; agent-driven operation awaits its own protocol, switch, and audit pass.

Agent-driven operation is explored separately in [browser and computer use](./browser-computer-use.md), including codeg/Orca references, shared CLI/MCP access and runtime delivery. That draft does not change the implemented scope or the separate [user-driven element picker](./requirements/element-picker-ai-edit.md) requirements.

## Global tool ownership

The ordinary browser has one application-level identity and one embedded host in the [global tools region](../workbench/global-tool-layout.md), outside the hot project cache. Workspace changes retain its host. Pop-out detaches only the pane presentation; reopening restores and focuses the existing window. Re-embedding works without an active project, and destroyed events clear the singleton. CPA retains its separate surface and partition.

## Browser chrome and start page

Embedded and standalone browsers share two compact rows: a horizontally scrolling web-tab strip with a fixed new-tab action, followed by navigation, address input and the carrier action. Selected tabs use a quiet neutral fill with rounded corners; controls use borderless icons and theme-aware tooltips. Focus, hover and address input use neutral feedback rather than orange fills or underlines. The browser inherits the shell font and theme colors; standalone re-embedding uses the same icon treatment. Agent status appears only while control is active. Two rows reserve more vertical space than the former compressed toolbar, keeping tab titles and navigation usable as tab count grows or pane width shrinks.

New blank tabs and surfaces with all tabs closed show a host-rendered start page with a concise explanation and an action that focuses the address bar. The address bar accepts the next URL even when no tab exists. Blank URLs (empty or `about:blank`, including its query/fragment) share one predicate in `src/shared/browser-url.ts`; both renderer bounds and main-process attachment keep those native guests detached so they cannot cover the start page. Switching to a loaded tab restores its existing guest. Changing tabs resets stale address drafts; Escape restores the current address. Web-tab close controls use the same one-second pointer or keyboard hold as workspace tabs, with early release cancelling. Errors keep the failed URL, reason and retry action on the same quiet surface. Content-only service views such as CPA retain their own toolbar and guest lifecycle.

Verification: `npx vitest run tests/unit/browser-surface-manager.test.ts tests/unit/browser-ipc-contract.test.ts tests/unit/browser-occlusion.test.ts tests/unit/hold-to-confirm.test.ts` passes 40 cases. `npx playwright test tests/e2e/browser-surface.spec.ts tests/e2e/pane-tab-drag.spec.ts --project=island --workers=1` passes 31 cases, covering both themes and carriers at 480/1280 px, blank and zero-tab states, hold closing, failure display and tab dragging; the empty-tab case passes again after making the fixture honor submitted URLs. `npx playwright test tests/e2e/desktop-smoke.spec.ts tests/e2e/desktop-cpa.spec.ts --project=desktop --workers=1 --grep 'Browser start page|Browser load failure|Browser global page|CPA native page'` passes four real Electron cases, including detached native children on blank pages, standalone start-page interaction, restored loaded tabs, error retry, workspace closing and preserved CPA login. Strict-unused typecheck, scoped ESLint, i18n validation, `npm run build:app` and Notes checks pass. Screenshots were inspected for both themes, narrow panes and the real standalone window; evidence lives under `artifacts/browser-refresh*`. No exe was packaged.

The final tab-width refinement sets both intrinsic width and flex basis to 160 px so the standalone strip cannot clip its close control. After this refinement, `browser-surface.spec.ts` passes all ten cases again, and the rebuilt desktop `--grep 'Browser start page'` case passes with an explicit close-control visibility assertion. Final screenshots are under `artifacts/browser-refresh/visual-final` and `artifacts/browser-refresh/standalone-final`.

## Native view visibility and load failures

Host-owned service surfaces can select a separate persistent partition and restrict navigation to HTTP(S) through internal `BrowserSurfaceOptions`. These options are not part of the browser IPC request. CPA uses a partition derived from its configured origin; its managed local control page explicitly uses direct networking so system proxy/PAC settings cannot capture management traffic. Provider traffic leaves through the managed backend's shared proxy relay, while the system browser handles authorization pages. Ordinary browsing retains `persist:janusx-browser`. Each guest explicitly disables Node integration, has no preload, and keeps sandbox, contextIsolation and webSecurity enabled. Restricted surfaces reject local files, credential-bearing URLs and custom schemes in creation, navigation, redirects and popups; by default, allowed HTTP(S) popups become tabs. An internal `openExternalUrl` handler can consume selected HTTP(S) popups, navigation and redirects without creating a guest tab; managed CPA uses it for vetted OAuth authorization endpoints. Ordinary surfaces keep their existing behavior. They do not remove CSP or frame headers. CPA configuration, login persistence and known compatibility limits belong to [service integrations](../workbench/service-integrations.md).

Electron WebContentsView children render above the shell DOM. CSS z-index cannot put an error panel or quit confirmation above them. The main process attaches an active tab only after receiving positive layout bounds and while that tab has no main-frame load error. Zero bounds detach the view without closing its session; load and tab events respect that hidden state. Closing a tab removes it from the surface before closing its webContents, so close events cannot publish a destroyed tab.

Yielding is visible unless covered: detaching to an empty canvas reads as a black screen where a full page used to be. The manager now freezes one frame per yield — `capturePage` at the visible→hidden bounds transition, kept as a JPEG data URL and read back through `browser:surface:hidden-frame` — and `BrowserSurface` shows that frame in the body while yielded, dropping it once visible again. Repeated zero-bounds reports do not recapture; a frame is invalid after the view comes back. Capture failure or an empty image falls back to the old empty canvas. The freeze covers every yield cause (menus, dialogs, tab drags, workbench covers), so overlay-induced hides no longer blank CPA or browser pages.

The internal `externalPopups` option lets a content-only service send other HTTP(S) popups to the system browser after URL validation and the authorization handler; CPA enables it so popup pages cannot replace its management page without a tab strip. Ordinary surfaces retain their existing popup behavior. The renderer can hide browser chrome through `showChrome={false}` while retaining native bounds, error/retry and occlusion handling; CPA supplies its own compact icon toolbar.

BrowserSurface reports zero bounds while hidden, dragging, covered by a workbench, showing a load error, or covered by a dialog. PromptDialog and ModalFrame hold window-local occlusion leases; nested dialogs keep the view hidden until the last lease ends, including the modal exit animation. Resize, scroll and completed layout transitions refresh the view bounds. Failed navigation retains the attempted URL for the address bar and retry; ERR_ABORTED from a superseded navigation is not a page failure.

2026-10-14 verification: 97 unit tests passed across browser-surface-manager, browser-occlusion, browser-ipc-contract, global-tool-entry, workspace-front-surface, workspace-pane and docker-settings. Typecheck, targeted ESLint and `npm run build:check` passed. The Electron case `Docker load failure, retry, dialogs and close release native browser views` in `tests/e2e/desktop-smoke.spec.ts` passed against `artifacts/build-check/main/index.js` with `JANUSX_E2E_ENTRY` set to that path and `NO_PROXY=127.0.0.1,localhost`. It checks the native child-view tree as well as real dialog clicks, failed HTTP load, retry, pane close, reopen and application quit. The fixture is a local HTTP page; a deployed Portainer service and its authentication were not verified.

The same run confirmed closing and reopening a failed page before retry, and verified the loaded fixture title after retry. A TCP connection to the default local endpoint `127.0.0.1:9443` returned ECONNREFUSED; this is a point-in-time observation of the default endpoint, not a diagnosis of every configured environment. `npm run check:notes` reported two unrelated errors in `terminal/tasks/gitbash-shell-terminal-management.md` (missing Progress and Evidence sections), plus existing cross-repository link diagnostics; those references remain unresolved by this change.

2026-10-14: the Docker integration this verification exercised was removed the same day, together with the rest of the Portainer direction (see [Docker 面板入口](../workbench/docker-management-entry.md)). The case above was renamed to drive the workspace browser entry instead of the Docker one, so the native-view, load-failure, dialog and quit evidence still stands for the browser surface; the `docker-settings` unit suite was deleted with its subject.
