# Trusted workbench extensions

The public [plugin SDK](../../../../packages/plugin-sdk/README.md) provides strict manifest/call-policy validation, a port client and an external-project scaffold. `plugin-runtime.tsx` registers trusted shells after authorization; external scripts run only inside sandboxed native pages with private offline Sessions. Main-process installation, grants, immutable resources, scoped storage and broker dispatch live in `src/main/plugins/`. Current contract: [.agents/notes/workbench/plugin-contract-v1.md](../../../../.agents/notes/workbench/plugin-contract-v1.md).

Trusted definitions may declare `commands`, `menus` and `keybindings` separately. Commands currently open a declared local view; the same command can appear in `toolbox` and `workspace-add` menus and have a local shortcut. Omit `commands` to adapt the existing workspace launchers automatically; pass an empty list for no implicit launcher. `manifestContribution(manifest, componentFactory)` uses only explicit public contributions and requires a trusted factory; it is not a package loader. `extensionCommands.setMenuPreference(entryId, {hidden, order})` and `.setKeybinding(commandId, keyOrNull)` persist overrides under `janusx:extension-commands:v1`; undefined restores a default shortcut. Settings → Plugins exposes these controls. Equal-priority shortcut conflicts return `KEYBINDING_CONFLICT` diagnostics and do not run; input, Monaco, terminal and iframe focus keep their keyboard input.

S1 provides an in-code renderer API for workspace tabs and right-hand panels. It does not load downloaded code or provide the later third-party sandbox. See [.agents/notes/workbench/requirements/plugin-architecture-forms.md](../../../../.agents/notes/workbench/requirements/plugin-architecture-forms.md).

Register a definition once in the workbench's startup code, outside React rendering:

```tsx
import { extensionRegistry, openExtensionView, type ExtensionViewProps } from '@/extensions'

function Overview({ active, workspacePath }: ExtensionViewProps) {
  return <div style={{ color: 'var(--shell-text)', background: 'var(--shell-canvas)' }}>
    {active && workspacePath}
  </div>
}

const unregister = extensionRegistry.register({
  id: 'team.example',
  views: [
    { id: 'page', title: 'Example page', location: 'workspace', scope: 'project', component: Overview },
    { id: 'summary', title: 'Example summary', location: 'right', scope: 'project', component: Overview },
  ],
  activate: () => {
    // Set up extension-owned resources here. Return their cleanup function.
    return () => {}
  },
})

openExtensionView('extension:team.example/page')
extensionRegistry.disable('team.example')
extensionRegistry.enable('team.example')
unregister()
```

Names use lowercase letters, digits, dots and hyphens and start with a letter. View IDs are unique within an extension. Duplicate registrations and invalid view metadata fail before activation. Activation is synchronous and runs once per enable; cleanup runs once per disable/unregister. A disabled definition remains registered until its returned disposer is called. An activation error must clean any partially acquired resources inside the activation function.

Right-hand contributions appear automatically in the tool rail. Workspace contributions default to the existing pane's `+` menu; setting `launcher: 'tool-menu'` places their entry in the top-right global tools menu instead. This metadata applies only to workspace views and does not change where the page renders. Both support `openExtensionView`; opening is idempotent. Tool-menu entries indicate an already open view and become available after it closes. Project contributions require a selected project; application entries remain available without a project or terminal.

`application` views receive null project context and reuse one identity across project switches. Open application tabs transfer to the new project instead of remaining in inactive project snapshots. Their React component can remount during transfer: durable business state belongs in extension-owned state, as in [examples/workspace-tools.tsx](examples/workspace-tools.tsx). Project workspace tabs restore within their project; project right-hand views remount on project changes to prevent local state leakage. Both positions inherit host CSS theme tokens. Titles are supplied by the extension; localized titles require registration to follow the extension's locale lifecycle.

The host owns workspace tab closing for terminals, Browser, Markdown and every extension view, regardless of launcher. The close control requires a continuous one-second pointer hold or Enter/Space hold and shows progress; releasing early, leaving the control or losing focus cancels. Extensions inherit this behavior without implementing their own tab controls. Closing a view does not disable its extension, delete a document or stop managed CPA.

Open but inactive views remain mounted and receive `active: false`, allowing the extension to pause its work. Closing a view unmounts its component. Disabling or unregistering removes its views from the active tree, inactive snapshots and right-hand open set. Unknown extension tabs are dropped during snapshot reconciliation; right-hand preferences continue the existing rail-only startup policy. Layout snapshots are kept by the existing in-memory workspace store; this API does not introduce disk persistence for workspace tabs.

The example is opt-in, and is not registered in production. A runnable harness is at `tests/e2e/island-harness/extensions.html`. Third-party imports, credential APIs and the marketplace remain separate stages.

The production file tree, Git and session panels register through this same registry as `janusx.files`, `janusx.git` and `janusx.sessions`; each contributes a right-hand `panel` view. Their definitions and compatibility metadata live in [builtins.tsx](builtins.tsx). The right-tool adapter maps these view IDs to the existing `files`, `git`, and `sessions` keys, preserving saved widths and callers without duplicate tabs. Icons, ordering, localized labels, feature gates and width defaults belong to the definitions. These are trusted, bundled React views with existing host services, not third-party packages.

Built-in metadata registers before right-tool preference hydration. Components load lazily to avoid a metadata/store/component import cycle. These application-scoped shells continue reading the current project/worktree from their existing stores, preserve local UI state across project switches as before, and remain usable without a selected project. Disable removes their entry and open panel; re-enable leaves them closed and retains their width preference. Closing the session view releases its UI subscriptions and leaves host-owned sessions and terminals running. The right container supplies its existing retry/close error boundary for all contributions; workspace views use the workspace error boundary.

Use `extensionRegistry.disable('janusx.git')` / `.enable('janusx.git')` for trusted lifecycle control, or `openExtensionView('extension:janusx.git/panel')` to open through the compatible legacy identity. Session entry points also enforce the existing experimental feature flag. This API does not yet add a plugin-management settings page or persist enabled/disabled state across application launches.

CPA is now the optional signed [official.cpa plugin](../../../../plugins/cpa/README.md), with application-scoped workspace and settings pages. Its toolbox entry appears after activation; its business code is independent of the host renderer and IPC. The old `janusx.cpa` registration and fixed Service integrations settings tab have been removed. The plugin retains managed and external modes, encrypted management keys, verified component updates and legacy data migration.

The native plugin activation owns the local service, retaining it after panel closure and stopping it on disable/reload/uninstall or application exit. An enabled managed configuration starts on page opening, save or explicit start; application launch alone does not start CPA. Updates stage without replacing a running process. Windows children inherit the current privilege level; ordinary plugins do not gain native rights from this example.

The offline plugin page requests a separate online guest through the trusted native desktop callback. The guest has no preload or host bridge, preserves the legacy login partition and follows its owner's visibility and closure. Details and compatibility limits belong to [service-integrations.md](../../../../.agents/notes/workbench/service-integrations.md) and the public SDK's trusted native services contract.
