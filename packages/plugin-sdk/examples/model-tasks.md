# Host-mediated text generation

`p6-model-provider` is a manifest-only summary service. Configure a default API model for Janus in host settings, link this directory, review its permissions, and enable it. In Settings → Plugins → Background tasks, supply `{"text":"Your text"}` and run **Summarize supplied text**. The host shows the generated text and reported token counts. The built-in Agent can call the same public service with `plugin.call-service`:

```json
{"plugin":"example.text-summary","service":"summarize","version":1,"input":{"text":"Your text"}}
```

Add the required `models.generate` capability and permission, plus `tasks.declarative` / `tasks.run`. The task declares a string input and one model step:

```json
{"type":"model","promptInput":"text","instruction":"Summarize the supplied text.","maxOutputTokens":256}
```

This permission authorizes model use and transmission of supplied input to the user's host-selected default Janus model. It may incur charges. Changing an existing package to request model access requires renewed authorization. Agent invocations also use the existing `run` policy and approval gate. Host Settings tasks are explicit user actions; plugin pages with task permission may also start their declared tasks after authorization. There is no additional per-request approval dialog for a page-initiated task.

Plugins cannot select a provider, model, endpoint, API key, arbitrary headers or extra model options. The host takes a private default-model snapshot, uses its configured adapter and refuses results if the configuration changed. OpenAI-compatible, Anthropic and no-auth API channels are supported by this adapter; Vertex and OAuth channels remain unavailable. A channel needs known context/output capacity from the host catalog or configured limits. No automatic fallback model is used.

The host sends only the static instruction and the selected string input. It does not add chat history, files, memory, system configuration or tools. Results are untrusted text and are never executed or interpolated into later task steps. Generation streams internally so the broker can bound output; plugin clients receive a completed result, not a live stream.

The budgets are one model request per whole task run (including nested services), one concurrent request per plugin, two globally, two attempts per minute per plugin and eight globally. Failed/unavailable attempts also consume that minute's rate budget. A request asks for 16–1,024 output tokens, has a 30-second host deadline and retains at most 16 KiB of UTF-8 text / 4,096 chunks. Existing task deadlines and the 64 KiB combined task-result budget still apply. Inputs use the existing 4,096-character primitive string limit; static instructions are at most 1,000 characters. The host conservatively checks prompt bytes plus requested output and a 512-token allowance against known context capacity.

`PluginTaskRun.modelResults` contains only text, normalized finish reason and reported input/output tokens (`null` when unknown). It shares the run's existing owner: another plugin cannot read Agent-owned model results. Provider diagnostics, response metadata, settings and credentials are not returned. A literal echo of the configured API key causes the entire generated result to be withheld. The configured model provider remains trusted by the user; this is not protection from a malicious provider encoding secrets into generated text.

Stopping the task/session, disabling or reloading a participant, changing its bound project/worktree, or closing the app cancels inference and rejects late output. Agent invocations of application services also bind to their current workspace; ordinary application tasks survive project switching as in P5. Cancellation closes the local request; the upstream service may still bill accepted work. Token limits are requested caps and local output limits, not a guaranteed monetary spending ceiling. No automatic retries, cross-restart recovery, bill reconciliation or persistent usage-statistics integration are added.

Plugin pages stay offline. This model permission authorizes only the host-selected model route (including user-configured local endpoints/proxies); it does not grant generic `network.fetch` or access to model credentials. External CLIs do not gain plugin model hooks through this adapter. Plugin skills/workflows and document context providers remain separate P6 work.
