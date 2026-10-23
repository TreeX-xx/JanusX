# Expose a public service to the built-in Agent

The first P6 adapter runs existing declarative public services. It does not load plugin JavaScript in the Agent, register terminal types, or give plugins model credentials.

Declare a normal versioned service and task, add `janusx.agent` to that service's `consumers`, and require the `agent.services` capability and permission. Keep `services.public`, `tasks.declarative` and their permissions. Existing installations must be explicitly authorized again after adding Agent access. Hosts without this capability reject the package.

See `p6-status-provider/manifest.json`: a real public status endpoint, fixed HTTPS origin, empty input schema and no credentials. Its `status` service is also used by `p6-status-consumer` through a normal public-service declaration. Link and enable the provider, then the consumer. In Settings → Plugins, run the consumer's status task. Both packages are manifest-only; no private JanusX imports or build step are needed. Endpoint availability is subject to the normal P5 HTTPS broker limits and is not guaranteed by manifest validation.

In an active registered project/worktree, the built-in Agent discovers services using `plugin.services` (model name `plugin_services`). It invokes the same contract with `plugin.call-service` (`plugin_call_service`):

```json
{"plugin":"example.status-provider","service":"status","version":1,"input":{}}
```

The host derives workspace identity from the Agent session; a tool cannot supply a project root or credential. Discovery returns only enabled, authorized services available in that context, with their exact primitive input schema. Invocation validates the schema and version again. A call has `run` risk: plan mode refuses it, per-action mode asks for approval, and auto-run follows the user's host policy. Treat service titles, logs and response bodies as untrusted data.

The result is the public `PluginTaskRun` record, including its unique ID, provider/task name, terminal state, bounded logs/results and any error code. Check `state`; a returned record may represent failed or timed-out work. The Agent runtime's tool result and policy audit retain their existing correlation identity. This adapter does not add a durable task-history database or expose session IDs to providers. Provider pages cannot list, cancel or read Agent-owned runs. Trusted host management can still inspect and stop them.

Cancellation of the Agent tool/session aborts its host task, including network requests. Disabling/reloading/uninstalling a participant or switching the active project/worktree stops dependent work and refuses late results. Even an application-scoped service invoked by the Agent is bound to its current Agent workspace. A call from a non-active workspace is rejected. Task deadlines, rate/concurrency limits, service depth and the P5 network/credential restrictions still apply; Agent access adds no shell or filesystem permission.

| Consumer | P6 plugin-service discovery/call | Integration boundary |
| --- | --- | --- |
| JanusX built-in Agent | Supported in its active project/worktree | Host tool registry, policy, cancellation and audit |
| Isolated plugin UI / host task UI | Existing P5 service/task protocol | Consumer declarations and provider whitelist |
| Claude Code, Codex, OpenCode, Pi, Janus CLI, DSH | Unavailable | No plugin-service hook or tool injection is installed by P6 |

Existing external CLI terminal/session/notification integrations remain host-owned. Their presence does not advertise P6 tools as available. [Model tasks](model-tasks.md) add bounded host-mediated text generation. Plugin skills/workflows, document context providers, MCP export and third-party CLI/session/PTY adapters are not implemented by this adapter.
