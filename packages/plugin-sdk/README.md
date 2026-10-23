# JanusX plugin SDK

The SDK provides the version 1 local-plugin contract, strict manifest and call-policy validation, a MessagePort client, and an independently buildable four-surface scaffold. In JanusX, open Settings → Plugins, import the built directory, enable local development mode, review permissions and project scope, and enable the plugin. The scaffold shows a standalone preview outside the authorized host.

## User configuration

To add a host-generated configuration form, require `configuration.settings`, declare the `configuration.read` permission and add `contributes.settings`. These are ordinary non-secret parameters, separate from private KV and authorization:

```json
[
  { "key": "label", "title": "Reference label", "type": "string", "default": "Reference", "scope": "project", "minLength": 1, "maxLength": 40 },
  { "key": "enabled", "title": "Show details", "type": "boolean", "default": true, "scope": "project" },
  { "key": "limit", "title": "Item limit", "type": "number", "default": 10, "minimum": 1, "maximum": 100, "integer": true, "scope": "project" },
  { "key": "style", "title": "Display style", "type": "enum", "default": "compact", "options": ["compact", "full"], "scope": "application" }
]
```

Each of up to 64 unique fields has a key, title, optional description, type, valid default and scope. `scope: "project"` permits a project/worktree override of the application value; `application` fields cannot be overridden there. Strings are bounded to 4096 characters, enums to 32 options. Patterns, arbitrary schemas, HTML, executable migrations and credential fields are unsupported.

Users edit these fields in Settings → Plugins → Configuration. Saves and resets check a revision including the schema and inherited layer. Unknown or invalid old values are diagnosed and ignored when computing effective values, but kept on disk until explicitly reset or replaced. Disable and uninstall preserve configuration; Delete plugin data clears it. Corrupt stores fail rather than silently resetting.

`context.configuration` is true for a plugin with settings. `api.configuration.get()` returns `{ values, overrides, inherited, revision, issues }`; `watch(listener, options?)` returns `{ configuration, unsubscribe }` and streams complete effective snapshots. It follows the page's bound project/root, accepts no path or plugin/project ID, and requires `configuration.read`. The generated page displays and watches configuration when present. Configuration writes belong to the trusted host form; plugins cannot call an arbitrary configuration setter. A stale form reports `CONFIGURATION_CONFLICT` and preserves its edits until the user reloads. Custom isolated configuration pages and credential references are later increments; do not put API keys or tokens in ordinary settings.

To offer a configuration button in your own page or menu, also require `configuration.open`. With settings declared, the host sets `context.configurationNavigation: true`; the generated page then shows Configure plugin. `await api.configuration.open()` takes only optional call options, accepts no plugin ID, path or scope, and requests the host to open this plugin's settings. `{ opened: true }` acknowledges dispatch, not a saved configuration. Project pages select the current project/root layer; application pages select application defaults. Only an active page may request navigation, with one request per plugin per 10 seconds across its pages. Hidden pages return `CONTEXT_UNAVAILABLE`, repeated requests return `RATE_LIMITED`, and revoked pages retain the usual lifecycle errors. The host shell also offers a Configuration button for all plugins with settings, including those without this new capability. Navigation expands and locates the plugin's form, and the existing settings modal shields native pages until closed. No custom page or configuration write authority is granted.

Call `await connectPlugin()` from a bundled page module to obtain `PluginApi`. The client accepts the port transferred by the minimal isolated carrier preload (or a parent shell), performs the ready handshake, and converts timeouts, aborts and invalidation into `PluginError`. It does not install a global `window.janusPlugin` or expose Electron IPC. Each page has its own instance and context revision; project/root changes close its port.

Build and pack the SDK from this repository:

```powershell
npm run build:plugin-sdk
npm pack --workspace=@janusx/plugin-sdk --pack-destination C:/my-plugin-artifacts
npm run plugins:create -- C:/my-plugins/reference --sdk C:/my-plugin-artifacts/janusx-plugin-sdk-0.1.0.tgz
```

The SDK is not yet published. The generator requires a packed tarball and a new destination; it never overwrites an existing directory. The resulting project uses the public package exports and contains no imports of JanusX source, React, private stores or IPC.

In the generated directory:

```powershell
npm install
npm run build
npm run check
npm run preview
```

`build` typechecks and bundles two HTML pages with local JS/CSS. `check` validates the manifest and the `dist` delivery tree, file types, budgets and declared entries without executing plugin scripts. It rejects linked resources; runtime real-path races, identity, network and navigation isolation are outside this development diagnostic and are checked separately by desktop tests. No install scripts, remote plugin source or package JS entry is executed by the checker.

Use `parsePluginManifest(text, host?)` for strict JSON/schema/compatibility checks, including duplicate keys and contribution references. Optional unknown capabilities are reported through the host's capability list and do not permit unknown fields or methods. `validatePluginCall(manifest, method, params)` rejects unknown methods, undeclared permissions/files, malformed parameters and undeclared view targets. This pure gate does not establish sender identity or user grants. The host must bind the real sender, source, instance, context revision and grants before dispatch, recheck before returning, and perform filesystem/quotas checks.

The SDK reserves `janusx.*` for built-ins. Contributions support single-instance workspace/right/workbench/island views, declarative open-view commands, toolbox/add-menu entries and local shortcuts. Methods expose context, declared UTF-8 files, private KV, view opening, toast and bounded Island status. Declare `contributes.island` and `ui.island` to call `api.island.update({ id, status })`; status is host-rendered text, progress, badge and a bounded text preview. Actions reference up to three own open-view commands of the same scope. Closing the latest publisher removes its status. Network, writes, execution, model calls and arbitrary command callbacks are not accepted by this schema. Terminal types, CLI/session adapters and PTY backends remain host responsibilities.

`npm run plugins:check` builds the SDK, validates the contract template, verifies the external scaffold and runs the SDK/tool/runtime/command tests. `npm run plugins:verify-scaffold` runs the external scaffold verification separately: it packs this SDK and performs an actual install, typecheck, build and package check in a new system-temporary directory outside the repository; the receipt is `artifacts/plugin-p1/scaffold.json`.

Read-only document viewers are supported in the main window's embedded file editor. Add `documents.viewers` and `documents.readText` to required capabilities, add the `documents.read` permission, and declare a viewer referencing a project-scoped workspace view:

```json
"viewers": [{ "id": "text", "title": "Text preview", "view": "details", "extensions": [".txt", ".log"], "filenames": ["Makefile"] }]
```

The generated page already handles `context.document`. Use `api.workspace.getContext()` to inspect `{ document?: { viewer, path } }`, then `api.documents.readText()` to read only that bound file. The read accepts no path and returns `{ path, text, bytes, version }`; `version` is the content SHA-256, not a save token. Each document/viewer/project-root binding has its own page instance. Private KV remains scoped to the plugin and project/root, so different document pages can deliberately share it. Regular views retain their existing single-instance policy. A matching filename is not permission for arbitrary workspace reads, writes or directory traversal.

To submit a draft, also declare the `documents.edit` permission and required `documents.applyEdit` capability, then re-enable the plugin to approve the changed permissions. The bound document context includes `editable: true`; the generated page then offers a textarea and a submit button. Call `api.documents.applyEdit({ text, expectedVersion: file.version })` with the full UTF-8 text (up to 1 MiB, no NUL). It takes no path. Success `{ applied: true }` means the host accepted an unsaved draft, **not** that a file was saved. A dirty or stale host buffer, or a changed disk baseline, returns `DOCUMENT_CONFLICT`. This is a one-draft handoff: review it in the built-in editor before saving or making further submissions.

Accepted drafts survive plugin disable, page failure, project switching and editor detach through the host's existing in-memory editor sessions and unsaved-close flow. Unsubmitted textarea edits remain page-local; neither draft kind promises recovery after an application crash or restart. Reads still observe disk, not the accepted draft. Cancellation or a lost acknowledgement does not undo a draft already accepted by the host. User-triggered saves retain policy authorization and check the baseline hash, serialize competing editor saves, and preserve the draft on conflict. External processes do not share the save queue: this is a pre-write version check, not an OS-level atomic compare-and-swap or a merge UI.

Users choose a viewer through Open with and may persist a default for the filename extension (or full name for extensionless files). No plugin automatically replaces a built-in viewer merely by registering. Dirty buffers, diff/navigation, binary/Office files and floating editor windows use the built-in path. Mount failures, invalidation or a disabled/unavailable plugin fall back to the built-in viewer. Changes to viewer declarations require renewed authorization. Reads are UTF-8, at most 1 MiB, with the same sensitive-path and real-filesystem restrictions as ordinary file reads. Reads observe the current disk content; automatic document change notifications, plugin editing/saving and general multi-instance panes are not implemented in this slice.
