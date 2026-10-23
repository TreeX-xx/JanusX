# Supervised sequential workflows

`p6-workflow-provider` is a manifest-only local demonstration. Link it in Settings → Plugins, review **Agent workflows**, allow a project and enable it. In Background tasks, select Project, enter `{"topic":"Your report topic"}`, and run **Sequential report**. The host runs the declared `collect` and `finish` services in order and shows each step's state. This example uses only delays/logs, without network, files or models.

A workflow publishes an existing public service as an explicitly declared sequence:

```json
{"id":"report","title":"Sequential local report","service":"report","version":1}
```

Add it to `contributes.workflows`, require capability `agent.workflows`, and retain the existing `agent.services`, `services.public` and `tasks.run` grants/capabilities. The referenced service must have the exact version and allow `janusx.agent`. Its task has 1–8 `service` steps, a normal scope/input schema and a 10–60,000 ms task deadline. A package has at most eight workflows with distinct IDs and underlying tasks. No new execution permission is implied: this is a specialization of an already authorized public service, and changes to the sequence require renewed authorization.

Service steps may bind primitive fields from the task's original input:

```json
{"type":"service","plugin":"example.workflow","service":"collect","version":1,
 "input":{},"inputFromTask":{"text":"topic"}}
```

`inputFromTask` requires capability `tasks.inputBindings`. Keys are the called service's input fields; values name this task's input fields. Sources must exist with the same primitive type, literals cannot overlap mappings, and the completed input must exactly match the declared consumption schema. This capability also works on ordinary tasks. It does not read files, configuration, secrets or earlier service results; it is not a template language. Each target service needs the existing consumer declaration/schema/version and must whitelist the coordinator plugin. A downstream provider need not expose itself directly to the Agent; the coordinator is its authorized consumer.

`plugin.workflows` is an `inspect` tool returning `{workflows,truncated}`. It advertises only authorized, available workflows in the active Agent project/worktree, with exact package revision, input schema, ordered direct participants, fixed inputs and mappings. Discovery runs no services. The catalog is bounded to 32 entries and 64 KiB of entry JSON; truncation is explicit and this slice has no paging. Content is untrusted plugin data.

`plugin.run-workflow` is a `run` tool:

```json
{"plugin":"example.workflow","workflow":"report","version":1,
 "revision":"<64-character revision from discovery>","input":{"topic":"Your report topic"}}
```

The host checks exact version/revision, current workspace/worktree, grants and activation. Plan mode cannot execute it. Per-action mode requests one approval for the whole reviewed sequence, including external effects, rather than one approval per internal step. The normal public-service tool can still invoke the same service, and the host task UI runs its underlying task through the same supervisor. These routes preserve their existing user action/approval rules.

Before the first effect, the host checks and pins all direct providers, including optional dependencies used by later steps, and reserves their existing concurrency slots. Disabling/reloading a participant cancels the run even before that provider's step starts. Every step rechecks live grants, activation and scope. Nested services retain P5 cycle/depth/step limits and their own checks on entry; there is no promise to preflight every transitive dependency. The workflow shares task concurrency/rate/deadline, 64 KiB output budget and the one-model-call budget across the entire run, including nested services.

`PluginTaskRun.workflow` contains the workflow ID/version and the ordered direct step records. Each step has pending/running/completed/failed/cancelled/timeout/skipped state, available timestamps/error code and half-open `results` / `modelResults` index ranges into the existing result arrays. Nested service internals remain in normal task logs/results; they do not become extra top-level step records. Agent runs keep the `janusx.agent` owner, so provider pages cannot list/read/cancel them. Completed prefix outputs remain available after a later failure. Run history remains in memory and does not survive app restart.

The first failure, timeout, cancellation or bound context invalidation stops the sequence and skips later steps. Earlier external effects are not rolled back. No automatic retries, parallel branches, conditional graphs, result interpolation, arbitrary scripts or durable recovery are added. Application tasks retain P5 scope behavior; Agent calls, including application workflows, bind to the active workspace. External CLI workflow hooks remain unavailable. Saved-file context reads are described in [document context providers](document-context.md).
