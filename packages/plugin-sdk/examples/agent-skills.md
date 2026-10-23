# Plugin skill resources

Link `p6-skill-provider` in Settings → Plugins, review its **Agent skills** text and permissions, select a project, then enable it. The sample exposes an inert project skill and a local status task; it makes no network or model calls. Host task UI and the built-in Agent can run the same status task. No package build, page, executable entry or dependency install is needed.

Declare required capability and permission `agent.skills`, then add `contributes.skills`:

```json
{
  "id": "explain-status", "version": 1,
  "title": "Explain example status", "description": "Read and explain a local demonstration status.",
  "scope": "project",
  "instructions": "Call the listed status service when the user asks, then explain its task result.",
  "services": [{ "service": "status", "version": 1 }]
}
```

Service references must resolve to this plugin's public services, with the exact version, the same task scope, and `janusx.agent` in their consumer whitelist. They require the existing `agent.services` and service/task grants. A guidance-only package can use `services: []` and omit tasks/views; it does not obtain execution permissions. Skills cannot declare tools, scripts, hooks, extra permissions, file paths or remote resource URLs. Markdown is stored inline in the manifest; the host never loads referenced files or runs code from it.

The built-in Agent uses `plugin.skills` to discover `{skills, truncated}`. Each entry contains plugin, skill, version, revision, title, description and scope; discovery does not insert instruction bodies into the conversation. At most 32 entries are returned, ordered by plugin ID and then manifest order. `truncated` reports additional available entries; there is no paging in this slice. A known skill may still be read directly.

Pass the discovered identity to `plugin.read-skill`:

```json
{"plugin":"example.status-skill","skill":"explain-status","version":1,"revision":"<64-character revision from discovery>"}
```

The result has `trust: "untrusted-plugin-content"`, the metadata, instruction text and live service descriptors with input schemas. Both tools have `inspect` risk and can run in plan mode. Their contents are third-party data, never system instructions or an override of user/host policy. Reading does not start a task, call a model, invoke another tool, or grant access. To execute an operation, the Agent separately calls `plugin.call-service`; its existing `run` approval, cancellation and result ownership still apply. This slice does not register global slash commands or automatically inject/activate skills.

A skill has 1–8,000 UTF-16 code units of nonblank instructions, at most 16 KiB UTF-8, without control/bidi override characters (tab/newlines are allowed). A package has at most eight skills, a skill references at most eight unique services, and the whole manifest remains limited to 64 KiB. One read is limited to 64 KiB of serialized result. No template substitution, service-output interpolation, executable workflow graph or automatic multi-step retry is supported.

Discovery/read requires the Agent's current selected project/worktree. Project skills also require that project's grant; application skills still bind reads to the current Agent workspace. Disabled, blocked, uninstalled or unavailable plugins are not advertised. Direct reads recheck grants, version, revision, workspace and activation after asynchronous validation; cancellation rejects a pending result. Changing any skill text/metadata/reference requires renewed authorization even without a version bump. The revision is the loaded package digest, so unrelated package changes also invalidate an old discovery result.

Stopping a plugin prevents future reads/service calls. Content already returned to an Agent conversation cannot be erased or recalled; it may remain in that conversation's history. The host settings review shows instruction text as plain text, not rendered HTML. Do not include secrets in a manifest. [Sequential workflows](agent-workflows.md) have their own execution contract. External CLI skill distribution/hooks and document context providers remain separate work; the existing external-CLI P6 matrix still reports no plugin hook support.
