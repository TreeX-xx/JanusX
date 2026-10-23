---
{
  "schema": "harness-note/2",
  "id": "bc044834-72f8-4752-a1d5-a36cc7c81a15",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-23T03:04:03Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/e29da5b4-dc65-40a9-883d-9026e3b280b1"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/dbd39c38-4ec5-4626-8a56-d497f805fa4f"}
  ]
}
---

# CLI 子智能体会话结构实测（Codex / Claude Code / OpenCode）

## Purpose

子智能体监控投影（见[监控投影方案](../../workbench/cli-subagent-monitoring.md)）需要各 CLI 子智能体记录的落盘形状。2026-10-23 在本机（Windows，真实用户目录）对三家 session 存储做了只读探针，记录实测事实。探针只读文件与 sqlite（`node:sqlite` readOnly），未启动任何 CLI、未改动任何历史文件。

## 实测结论

三家全部使用**显式 ID 父子链接，无一家需要启发式归属**。这是投影可行性的关键事实。

### Codex —— 独立 rollout 文件 + 出身元数据

子智能体是独立 rollout 文件（与主会话同目录树），`session_meta` 携带完整出身：

```json
{ "type": "session_meta", "payload": {
    "id": "<子会话 id>",
    "parent_thread_id": "<父会话 id>",
    "source": { "subagent": { "thread_spawn": {
        "parent_thread_id": "...", "depth": 1,
        "agent_path": null, "agent_nickname": "Tesla", "agent_role": "worker" } } },
    "thread_source": "subagent",
    "agent_nickname": "Tesla", "agent_role": "worker" } }
```

父侧派发点是命名工具调用 `spawn_agent`（配 `wait_agent`、`list_agents`）。实测样本：26 个 `thread_source:"subagent"` 会话、150 次 `spawn_agent` 调用，`parent_thread_id` 全部非空。`depth` 字段暗示支持嵌套派发，嵌套归属未在实测样本中验证。

### Claude Code —— 新旧两种形状并存

- **新形状（现行）**：子智能体是独立文件 `<project>/<session-id>/subagents/agent-<agentId>.jsonl`，每条记录带 `isSidechain: true` 与 `agentId`，首条记录即完整任务 prompt（标题来源）；另有 `tasks/<agentId>.output`。主链 Task `tool_result` 文本含 `agentId: <id>` 配对。
- **旧形状（历史数据中仍在）**：`isSidechain: true` 记录交错写入主 JSONL——`agent-turn-sentinel.ts` 与 `transcript-kernel.ts` 现行的 sidechain 跳过逻辑针对的就是它。
- **两种都要兼容**；Claude 已发生过一次落盘形状迁移，是格式漂移的现实证据。

### OpenCode —— sqlite 外键直查（最简单）

`session` 表自带 `parent_id`、`agent`、`title` 列；`message`/`part` 表按 `session_id` 查内容。实测样本：88 条子会话 `parent_id` 全部非空，`agent` 列区分类型（explore×66、general×22），标题自带任务语义（如 `"Recon JanusX structure (@explore subagent)"`）。

## 到 SubAgentRun 的字段映射

| SubAgentRun | Codex | Claude | OpenCode |
|---|---|---|---|
| id | 子 rollout session_id | agentId | session.id |
| parentRunId | parent_thread_id | 主链 tool_result 的 agentId 配对 | parent_id |
| title | spawn_agent 参数 / agent_nickname | 子文件首条 prompt | title 列 |
| role | agent_role（worker 等） | subagent_type | agent 列（explore/general 等） |
| 内容 | 子 rollout 正文 | 子文件正文 | message/part 表 |

每引擎适配器是同一模式的三次实例化：找子记录 → 读显式父子链接 → 取身份与标题。

## 边界与重访信号

- 格式漂移真实存在（Claude 的迁移史），消费方须容错解析（只认已验证字段）并以真实样本做 golden fixture；样本取自本次探针路径。
- Codex 嵌套派发（depth > 1）的归属链未实测；投影落地前若涉及嵌套场景需补样本。
- pi / dsh 未探针；在其能力行标 `subagents: 'none'` 即可，不阻塞三家。
- 各家格式是其 resume 保真自用的持久化，厂商自身依赖，变更频率低于 hook 类集成面——这是被动观察路线的稳定性依据，不是兼容承诺。
