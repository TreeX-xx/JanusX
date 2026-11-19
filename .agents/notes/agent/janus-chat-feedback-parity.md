---
{
  "schema": "harness-note/2",
  "id": "54b1046a-2c23-4bd0-acc5-7ddcd7f3a343",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-26",
  "class": "feature",
  "tags": ["janus-chat","agentX-parity","streaming-feedback","thinking","theme","blueprint"],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/6813a52b-249b-556e-a0eb-55acc6930922"}
  ],
  "updated": "2026-11-12T07:58:32.622Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10"
}
---

# Janus chat streams agentX-grade feedback

## Problem

Janus chat and the janus-agentX TUI share the `runChatTurn` event contract. A reasoning-heavy turn needs a visible phase, elapsed time and reasoning summary before the first answer token; a three-dot loader alone cannot explain the wait. Island and Blueprint host the same `JanusChat` renderer with separate conversation controllers. If light-theme feedback colors depend on an Island ancestor, Blueprint falls back to white text on paper. Keeping shared composer rules inside Blueprint CSS also makes ordinary chat depend on an unrelated host's stylesheet.

## Decision

2026-10-16 visibility update: the user requested directly visible process content. This supersedes the collapsed default described below: public reasoning now defaults to expanded, including completed and restored turns, with a 240px scroll limit and manual collapse. Tool-preceding work updates use `--shell-muted`; the trailing answer uses the normal palette. The linked Chat timeline requirement owns current behavior and validation; earlier evidence below records the original design.

The renderer derives the same status row from the same `ChatAgentEvent` union and times the turn from request start. `chatStatusForEvent` in `janusRuntimeState.ts` maps `agent_start` / `reasoning_delta` to thinking, `text_delta` to writing, `tool_call_start` / `tool_call_ready` to preparing, `tool_execution_start` / `update` to running with the tool name, `model_finish(tool_calls)` to running and other finishes to finishing, and `question_requested` to awaiting; all other events preserve the prior status. `useJanusChat.ts` holds `turnStartedAt` plus `turnStatus` per conversation, sets both on `startRequest`, advances status on every agent event, and clears the start on done, error, stop, and session failure. The done path settles `durationMs` into the stored reasoning snapshot.

`JanusChat.tsx` renders a `TurnStatusRow` (spinner plus translated phase plus `· Xs` elapsed, ticking at 250ms) for every streaming turn, so the pre-first-token phase carries the same signal as agentX `Activity`. `ThinkingRegion.tsx` keeps its collapsed default; the header reads `思考中…N字 · Xs · gist` live and `已思考N字 · Xs · gist` when done, with a collapsed live-tail line plus cursor during streaming and the full text only on expand. New replies use `ChatTimeline` to render independent reasoning segments in event order; each segment receives its own start/end and opening preview. Legacy replies retain the older snapshot fallback. Duration formatting (`X.Xs` under a minute, `Xm Ys` above) plus gist and live-tail extraction live as pure helpers in `janusReasoning.ts`. The three-dot loader remains a secondary cue before process blocks arrive.

`styles/03-janus-chat-core.css` owns shared feedback, message text and metadata, and the compact navigation and minimal composer variants. Status, reasoning text and author labels use `--shell-muted`; elapsed time and timestamps use `--shell-dim`; message and input text use `--shell-text`; the cursor, thinking border, assistant label and input caret use `--shell-accent`. The minimal composer consumes the existing pane, border, hover and accent tokens. Palette values belong to `src/shared/theme/definition.ts` and its generated stylesheet. These rules contain no Island or Blueprint ancestor requirement and need no per-theme feedback override, so theme changes apply to active streams and completed reasoning alike.

Host styles own placement, sizing and structural skins. They must not duplicate shared feedback or text colors. `BlueprintMaintenancePanel` continues to use `JanusChat` rendering, model calls and streaming through its own controller. The [workspace dialog decision](../blueprint/maintenance/tasks/blueprint-workspace-dialog.md) owns conversation lifetime and the explicit file-review boundary.

## Alternatives considered

- Mirror the full TUI timeline (interleaved thinking/tool/assistant blocks with expand/collapse-all): strongest case is pixel parity with agentX. The driver that rules it out is scope: Janus chat already owns message history, tool cards, todo strip, and question gate; re-laying the stream order risks scroll and persistence regressions for no new signal.
- Auto-expand thinking during streaming: strongest case is zero-click visibility of the full process. The driver that rules it out is noise: long reasoning pushes the answer and tool cards off-screen; the collapsed gist plus live tail carries the signal without the layout cost.
- Derive elapsed from main-process timestamps or IPC heartbeats: strongest case is one clock for every surface. The driver that rules it out is plumbing: the renderer already owns turn boundaries, and a renderer clock matches the existing flush and abort ownership with no contract change.
- Add Blueprint-specific light-theme overrides: this is a small local repair, but each status or theme change then needs matching rules in two hosts. Shared semantic-token rules remove that maintenance dependency.
- Do nothing / reuse the existing host-scoped styles: this preserves every existing shade and selector, but leaves Blueprint feedback illegible on paper and makes compact chat depend on Blueprint CSS.

## Consequences

- **Gains**: every streaming turn shows phase plus elapsed from the first frame; reasoning turns show gist plus live tail without a click; completed turns retain `N字 · Xs` for later review. Status mapping and duration helpers carry unit tests.
- **Costs and limits**: two 250ms interval timers run during streaming (status row plus thinking region); both unmount with the turn, and neither participates in scroll signatures. Legacy reasoning snapshots without `durationMs` render headers without duration. Controller-less hosts fall back to a thinking status without elapsed until they forward the controller fields. Shared text uses theme-wide shades, so host-specific opacity variations and cursor glows are absent. Island geometry and structural skins remain separate. A new chat-specific color token is warranted only if its semantic role cannot use the existing palette.
- **Verification**: `npx vitest run tests/unit/theme-registry.test.ts tests/unit/janus-reasoning.test.ts tests/unit/janus-chat-status.test.ts tests/unit/janus-runtime-state.test.ts` passes 17 tests, including generated CSS consistency. `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` and `npm run build` pass. `npx playwright test tests/e2e/janus-chat-theme.spec.ts` covers six passing cases: real Island feedback, shared active and completed reasoning, live switching between Planche and dark, and the real Blueprint workbench composer without Blueprint CSS. The 18 cases in `blueprint-workbench.spec.ts` and `project-conversation.spec.ts` pass, along with six Island interaction regressions covering clicks, Roundtable, prompt recall, rewriting, model menus and pinning (30 browser cases total). The fixtures import the application theme stylesheet and use `DEFAULT_APP_THEME` for both tokens and host skins. `node scripts/check-agent-notes.mjs` reports no errors for this Note; its six repository errors belong to `dsh-integration.md`.

Related contract alignment lives in [the chat contract alignment](./janus-agent-chat-alignment.md): that note owns event parity and the question gate, this note owns the streaming feedback surface.

[Chat 工作时间线](./requirements/chat-work-timeline.md)已接入当时因范围限制排除的完整交错过程，并覆盖各入口扩展工具展示、调用级身份与展示快照恢复。新过程的容量、生命周期及验证由该需求维护；本文的 Verification 保留原反馈方案的历史证据。

## Shared error cards (2026-11-12)

`chat/ChatErrorCard` now owns the SuperAgent error card and conversation attachment feedback, including themed card, message and action styles. SuperAgent retains its retry callback and recovery status; attachment errors expose a Close action that preserves the draft and restores input focus. The old host-specific card selectors were removed. Backend retry and terminal connection notices continue to use `ConversationNotice` with their existing lifecycle.

Validation: all 12 `janus-chat-theme.spec.ts` browser cases pass, including provider failures and retry in two independent hosts across dark, Planche and white. The attachment context, recovery and composer suites pass 11 cases, including dismissal and clearing on a successful reference in 390px panes. Type checking passes; targeted ESLint reports zero errors and four pre-existing Chinese-literal warnings in `JanusChat.tsx`. Real provider failures and native desktop dragging were not exercised.
