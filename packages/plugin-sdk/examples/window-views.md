# Native window views

Add `views.window` to `capabilities.required`, request `{ "name": "ui.windows" }`, and append a view to `contributes.views`:

```json
{
  "id": "utility",
  "title": "Project utility",
  "entry": "dist/index.html",
  "location": "window",
  "scope": "project",
  "instancePolicy": "single"
}
```

This can reuse a bundled scaffold page. It creates a dedicated view; existing panes and document viewers cannot be detached or reparented. A host without `views.window` rejects the required capability. Import/reload the package and review the changed authorization before enabling it. Settings → Plugins → Windows offers an Open window button for each declaration.

To add a toolbox entry, append these contributions and retain the scaffold's `commands.openView` / `menus.toolbox` capabilities:

```json
"commands": [{ "id": "open-utility", "title": "Open project utility", "action": { "type": "openView", "view": "utility" } }],
"menus": [{ "location": "toolbox", "command": "open-utility", "when": "projectOpen" }]
```

Merge these into existing arrays. An active plugin page may also call `api.views.open({ view: "utility" })` with its normal `ui.views.open` permission. No native window object, arbitrary title, always-on-top, transparency, positioning or close API is exposed to plugin code. The native title includes the plugin name, view title and plugin ID.

Repeated opens focus the same live window. Closing the native frame revokes that page and its MessagePort; explicit reopen creates a fresh instance. Persist business data with existing scoped KV/configuration APIs. Only validated normal geometry is restored, keyed by plugin/view/project-root (or application), with offscreen bounds fitted to the current display. Open windows, unsaved content, minimized/maximized state and automatic reopening across application restarts are not restored. Corrupt layout data falls back to default geometry.

Project windows bind to the current authorized project/worktree and close when it changes. Use `scope: "application"` for a window that survives project switching without receiving project context. Plugin disable, reload, uninstall, development-mode shutdown, guest failure and main-window navigation/crash/close revoke the native resources. Limits are four windows per plugin and sixteen globally, including pending creation; existing page limits also apply.

Content uses the existing offline isolated Session, sandboxed WebContentsView and bounded broker. Host settings, approvals and other occluding surfaces detach plugin content from all native plugin windows, leaving a blank frame; a window opened during occlusion stays hidden until it ends. Focus/minimize state updates `context.active`, and hidden pages cannot bypass active-page restrictions. Window permission grants no additional file, network, model, configuration-write or session authority. Windows development builds have automated desktop evidence; macOS/Linux and packaged installers remain unverified.
