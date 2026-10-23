# Declarative document context

`p6-context-provider` exposes the current project's saved `README.md` as explicitly authorized, on-demand reference data. Link it in Settings → Plugins, review **Document context providers**, approve the project and enable it. It is a manifest-only package: no page, build, network, model call or executable provider is needed.

Declare up to eight `contributes.contextProviders` with distinct IDs:

```json
{"id":"reference","version":1,"title":"Project reference",
 "description":"Read the saved project reference.","path":"README.md"}
```

Require capability and permission `agent.context`, required capability `files.readText`, and permission `workspace.files.read` with that exact relative path. No glob, directory enumeration, absolute path, dynamic path argument, application-scope provider or arbitrary script is supported. A provider may exist without views/tasks/skills. Changes to the provider declaration require reauthorization, including mapping to another already-granted file without a version bump.

The built-in Agent uses `plugin.contexts` to discover `{providers,truncated}` metadata in its active, authorized project/worktree. Discovery does not open files or start tasks; a declared missing file may appear in the catalog and fail on read. The catalog has at most 32 entries and 64 KiB of entry JSON, sorted by plugin ID; there is no paging. Read with the exact package revision from discovery:

```json
{"plugin":"example.document-context","provider":"reference","version":1,
 "revision":"<64-character package revision>"}
```

`plugin.read-context` returns the provider metadata plus `{trust:"untrusted-plugin-content",text,bytes,documentVersion}`. `documentVersion` is the SHA-256 of the saved file bytes; `revision` pins the plugin package, not the document. Each read observes current saved content, so saving a document can change its hash without changing the provider revision. No absolute root is returned. Reads do not observe unsaved editor drafts and do not create a background task or durable result store.

A project-scoped page of the provider plugin can call the same protocol using `api.context.providers()` and `api.context.read(request, {signal})`. Page discovery lists only its own providers; it cannot read another plugin's provider or use an application page to access project documents. The existing `api.context.subscribe` remains available. UI and Agent reads share the same validation, limits and resource format.

These Agent tools are `inspect` actions and can run in plan mode after the plugin's explicit grant. No execution approval is requested for a read. The data is untrusted and does not become system instructions, trigger tools or automatically enter a conversation. Service/workflow execution retains its separate approval path. Disabling a plugin stops new reads but cannot retract data already returned to a conversation.

The host pins activation, project and worktree around asynchronous validation and file IO. Revocation, context changes, cancellation and a 10-second read deadline reject late results. OS reads may finish internally after cancellation; the result is withheld. The host shares a maximum of four in-flight context reads and 60 admitted reads per minute across all plugins and callers in the process. Failed admitted reads consume the frequency budget; limits reset on app restart, not on plugin disable/re-enable.

Each file must be regular, UTF-8, NUL-free, at most 32 KiB, and within the same sensitive-path, protected-directory and link/hard-link restrictions as existing workspace reads. Oversized files are rejected rather than silently truncated. Serialized responses are additionally limited to 64 KiB, including JSON escaping; an otherwise valid file can exceed that response budget. No file content is recorded in plugin diagnostics; unexpected filesystem errors are redacted.

This is a fixed-file provider, not retrieval/search, arbitrary content transformation, a document snapshot transaction, access to selections or unsaved buffers, model-mediated summarization, automatic prompt injection, MCP export or an external CLI hook. Callers can deliberately pass returned text to an already-authorized service under its existing execution/approval rules; no automatic composition is added.
