# Declarative background examples

The P6 [Agent service adapter guide](agent-services.md) covers explicit Agent authorization and a public status provider shared with the host task UI.
The [model task guide](model-tasks.md) and `p6-model-provider` add bounded host-mediated text generation through the user's default Janus model.
The [skill resource guide](agent-skills.md) and `p6-skill-provider` add explicitly authorized, on-demand guidance for the built-in Agent.
The [workflow guide](agent-workflows.md) and `p6-workflow-provider` add supervised sequential service composition, task-input bindings and step tracking. The [document context guide](document-context.md) and `p6-context-provider` expose fixed saved project files to authorized pages and the built-in Agent.

Link `p5-provider` and enable it first, then link and enable `p5-consumer`. Both are manifest-only packages: no Node entry, page, build or dependency install is needed. Open Settings → Plugins → Background tasks and credentials, then run either report task. Close Settings while it runs and reopen to see its logs. Stop a running task there; run it again to retry. Disabling either participant stops its dependent work.

Each package declares its own permissions. The provider's service delegates only the named task and only to the listed consumer. Its input is the task's primitive object schema; the versioned output is the host's `PluginTaskRun` status/log/result contract. Project tasks bind to the current approved project/worktree and stop when that context changes. Application tasks survive project selection changes. Runs are not resumed after an app restart.

To add a request step, declare `network.fetch` and its exact HTTPS origins. Add a `credentials` slot plus `credentials.use` for a host-stored bearer token. Tokens are entered only in host Settings, per application or project/worktree scope. Credentialed requests return HTTP status only; response bodies and headers are withheld to prevent credential echoes. Noncredentialed text/JSON responses are limited to 64 KiB. IPv4 public destinations on HTTPS port 443 are supported; private/reserved addresses, IP literal grants, cross-origin redirects and POST redirects are refused. Requests use the host TLS broker; plugin pages remain offline. General background JS and shell/process execution are unavailable.
