# Document drafts and workspace instances

Start with the independent SDK scaffold. Keep its existing capabilities and permissions; add only the features needed by your plugin. New required capabilities reject incompatible hosts. Imports and declaration changes still need the user's authorization.

## Bounded directory metadata

Require `files.listDirectory` and declare `{ "name": "workspace.directories.list", "paths": ["docs"] }`. `await api.workspace.listDirectory({ path: "docs", limit: 100 })` returns `{ entries: [{ name, type }], truncated }`, with at most 200 entries and 32 KiB. `.` explicitly grants the project root. Each path is exact: listing `docs` grants neither its subdirectories nor file contents. File reads still need separate exact-file grants.

Queries are nonrecursive and inspect at most 2,000 entries. Results are sorted within the returned subset; `truncated` means the directory was not completely enumerated, not a stable pagination cursor. Concurrent filesystem changes may produce a partial observation. Sensitive names, links, hardlinked files and protected host storage are excluded. A replaced directory or revoked project context rejects the result. The host allows four concurrent queries and 60 starts per minute across plugins.

## Multiple workspace pages

Require `views.multiple` and set a workspace view's `instancePolicy` to `multiple`. Other locations remain single-instance. Opening its menu command creates a new page; the host stores its key with the pane.

```ts
await api.views.open({ view: 'details', instanceKey: 'comparison-a' })
const context = await api.workspace.getContext()
console.log(context.instanceKey)
```

Reopening a named key focuses the existing instance. Omitting it creates a fresh host key. Keys are 1–64 ASCII letters, digits, hyphens or underscores, scoped to plugin/view/project-root (or application). They are not authorization tokens. Reload preserves open pane keys; each remount gets a fresh broker identity. Existing limits of eight pages per plugin and 64 globally still apply. Private KV remains scope-wide: include a key in your own storage keys if page state must be independent. Document-bound viewer identities remain separate from these keys.

## Continuous host-owned drafts

Declare a project/workspace viewer as described in the SDK README. In addition to `documents.viewers`, `documents.readText`, `documents.applyEdit` and the `documents.read`/`documents.edit` permissions, require `documents.draft` and request `{ "name": "documents.draft" }`. This separately authorizes access to the host-owned draft for the bound document.

```ts
let draft = await api.documents.readDraft()
draft = await api.documents.updateDraft({
  text: nextText,
  expectedRevision: draft.revision,
})
```

A draft contains `text`, host `revision`, disk-baseline `version`, `dirty` and `externalChanged`. Reads may claim a clean host buffer. They do not take over a dirty buffer owned by the user or another viewer. Every update compares the host revision, so native edits and competing submissions cannot silently overwrite each other. Text is limited to 1 MiB of UTF-8 with no NUL. Reading/updating a draft does not write the file. The independent scaffold demonstrates repeated submissions when `context.document.draftSession` is present.

Use the host Save button to write a submitted draft. The host checks the disk version and uses its existing serialized atomic-replacement writer. On conflict it preserves the draft and displays the current disk text alongside an editable result. The user merges manually and chooses **Save reviewed result**; another external change rejects that save and refreshes the comparison. Missing, linked or unreadable files are not force-overwritten.

Submitted drafts survive view failure, disabling the plugin, project scope changes and whole-editor detach within the running app. A successful save advances the revision and the viewer can reopen its draft session. Unsubmitted page-local edits, application crash/restart recovery, automatic merging and cross-process atomic compare-and-swap are not guaranteed. Cancellation or lost acknowledgement does not roll back a draft already accepted by the host; reread before retrying. Automatic filesystem subscriptions and arbitrary pane detachment remain separate work.
