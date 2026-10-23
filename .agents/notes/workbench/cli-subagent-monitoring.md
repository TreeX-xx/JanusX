---
{
  "schema": "harness-note/2",
  "id": "dbd39c38-4ec5-4626-8a56-d497f805fa4f",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-23T03:15:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/bc044834-72f8-4752-a1d5-a36cc7c81a15"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/93151b7b-6a33-5e5d-bf83-f2109fc85389"}
  ]
}
---

# CLI 派发子智能体的 Island 监控投影

## Problem

Island 二级展开 monitor 的子代理运行时列表只呈现 JanusX 自己登记的 run：终端级 `terminal:{id}` main 行，看不到 Claude Code Task、Codex `spawn_agent`、OpenCode subagent 等 CLI 内部派发的子智能体。多 CLI 工作台的功能必须稳定服务多个 CLI；逐 CLI 专属适配会把差异散落进 UI 与管道，维护成本随 CLI 数量增长。用户同时约束：**不新增 hook 装订，不污染各 CLI 配置文件**。

## Decision

检测 100% 被动观察各 CLI 自己的 session 持久化（transcript / rollout / sqlite），零 hook、零配置污染。实测三家（Claude Code、Codex、OpenCode）子智能体记录均为显式 ID 父子链接，可映射到既有 `SubAgentRun` 模型（`parentRunId/rootRunId/missionId` 归属链、`source`、`role` 字段已存在，模型零改动）——事实样本与字段映射归[子智能体会话结构实测](../sessions/records/session-subagent-structures.md)。

**分层纪律**（复制 turn 管线"差异进数据表、契约与 UI 永远统一"的既有范式）：

1. **契约层**：一切子智能体事实先翻译为 `SubAgentRun` 树再进 registry；UI 只消费契约，零引擎分支。
2. **差异层**：每引擎一个分类函数（找子记录 → 读显式父子链接 → 取身份与标题），住进 `transcript-kernel.ts` 同族；`AgentEngineCapability` 增加 `subagents` 能力字段（`'transcript' | 'none'`），pi/dsh 标 `none`，UI 自动退化为现状。
3. **呈现层**：monitor 右列表按 `parentRunId` 组树，main 行全宽 + 子行缩进连接线 + 角色色降档，main 行聚合徽标汇总子状态（复用 RunOrb `+N` 溢出语义）；选中子行加 `main › role` 面包屑。主次区分是产品硬需求。

**内容查看**（第二级需求）：单击子行在左栏展示该子智能体的会话内容，内容源即子记录正文（Codex 子 rollout / Claude 子文件 / OpenCode message-part），有界读取复用 `transcript-excerpt.ts` 的尾读模式；单击 main 行保持现状。Focus 跳终端只在 main 行提供（子智能体无独立终端）。

**价值来源不押单一机制**：来源 A（JanusX 自编排子智能体，`SubAgentRunRegistry` 由 JanusX 亲手登记）天然全 CLI 统一，与来源 B（CLI 内部派发）共用同一棵树、同一 UI。Codex 若某种派发形态不可读，能力表如实标 `none`，功能对该引擎退化而非失效。

**容量**：main 行恒占一席，子行分支内限 N 条 + 溢出收纳；子智能体可见后 `slice(0, 6)` 静默截断必须一并解决。

## Alternatives considered

- **hook 通道（SubagentStart 类事件）**——最强理由是实时性毫秒级、归属由 CLI 直给。否决驱动是用户约束：每加事件就多一条装订进 CLI settings 的条目，配置污染且事件名随版本漂移。
- **每 CLI 专属监控 UI/管道**——最强理由是单家体验最优。否决驱动是差异散落，N 套逻辑并行，与多 CLI 稳定目标直接冲突。
- **启发式归属（连续块分组、时间邻近）**——备选兜底。实测后不需要：三家都有显式 ID 链接，启发式只在无 ID 时才有价值，而无 ID 引擎应标 `none`。
- **只做 Claude Code 硬编码**——最快见效，但功能绑死单一 CLI，与工作台定位冲突。
- **解析 pty 输出流**——已被 turn-change 决策否决（TUI 重绘毁数据），维持 transcript/hook 唯一事实源纪律。

## Consequences

- **Gains**: 子智能体监控在 Claude Code / Codex / OpenCode 三家成立且同构；主次分明可交互；检测零 hook 足迹；新 CLI 接入成本 = 能力表一行 + （视格式）一个分类函数。
- **Costs and limits**: 格式漂移是真实风险（Claude 已从交错 sidechain 迁移到独立子文件），须容错解析 + 真实样本 golden fixture；检测延迟为秒级（fs.watch / 存储查询，监控场景可接受）；Codex 嵌套派发归属未实测；pi/dsh 不覆盖；CLI 崩溃残留的孤儿子记录需归档策略。
- **Revisit when**: 任一 CLI 提供稳定的子智能体订阅接口（届时可加推送源补实时性，契约层不变）；或格式漂移导致某引擎分类函数维护成本超过其使用价值（则该引擎降标 `none`）。

## Implementation shape（未实现，供排期）

### 整体数据流

```
各 CLI session 落盘（JanusX 不写、只读）
  ├─ Claude:   <session>/subagents/agent-*.jsonl   ← turn-sentinel 读循环顺带发现
  ├─ Codex:    rollout-*.jsonl (thread_source:"subagent") ← external-session-scanner 已遍历此目录
  └─ OpenCode: session 表 parent_id 非空行          ← sqlite list 驱动已查此表
        │  每引擎一个分类函数（transcript-kernel 同族）
        ▼
   SubagentRecord { engine, id, parentId, title, role, status?, contentPath }
        │  投影器（薄桥）
        ▼
   subAgentRunRegistry.upsertRun()   ← 现有 registry/IPC/store 零改动
        │  subagent-run:updated
        ▼
   JanusIslandExpandedShell monitor 右列表：main 行 + 缩进子行树
```

### P0 检测投影（主进程为主，无 UI 风险）

1. **能力表加列** `agent-engine-capabilities.ts`：`subagents: 'transcript' | 'none'`；claude/codex/opencode 标 `'transcript'`，pi/dsh 标 `'none'`。
2. **三个分类函数** 住 `transcript-kernel.ts` 或紧邻 `subagent-kernel.ts`，输出统一中间形状 `SubagentRecord`：
   - Claude：子文件 `agent-<id>.jsonl` → `{ agentId, title: 首条 prompt }`；旧形状兜底为主 JSONL 中 `isSidechain:true` 连续块。
   - Codex：`session_meta.payload.source.subagent.thread_spawn` → `{ id, parent_thread_id, nickname, role, depth }`。
   - OpenCode：`select id,parent_id,agent,title from session where parent_id is not null`。
3. **投影器** `subagent-run-projector.ts`：`SubagentRecord → registry.upsertRun({ id: 'subagent:{engine}:{id}', parentRunId: 父 run 存在则父 id、否则 terminal:{id}, source: 'hook', role, title, status })`；`normalizeRun` 自动补 root/mission 归属。孤儿记录（父 run 不存在且无 terminalId）挂 `ORPHAN_WORKSPACE_ID` 语义或暂存待归档（P3 细化）。
4. **挂接点**：turn-sentinel 读取循环第二消费者（Claude）、外部扫描回调（Codex）、opencode list 驱动回调。
5. **Golden fixture**：本探针真实样本脱敏入 `tests/fixtures/`，分类函数各一组单测；格式漂移时红灯而不是用户发现。

### P1 主次树 UI（集中在 JanusIslandExpandedShell 右列表渲染段）

- **组树在 shell 的 useMemo 做**（按 `parentRunId` 分组），不动 store 的状态优先排序（那是全局语义）。
- main 行全宽 + 右侧聚合徽标（如 `2▶ 1✓`，复用 RunOrb `+N` 语义）点开/收起分支；子行缩进 20px + 1px 分支连接线，角色色降透明度，标题字重降档。
- 选中子行：左栏 CRT 标题上方加 `main › role` 面包屑（复用 `runRoleLabel` 标签链）。
- Focus 跳终端只在 main 行提供（子智能体无独立终端）。
- **容量**：main 行恒占一席；子行分支内限 4 条 + `+N` 溢出收纳，替换现有 `slice(0, 6)` 静默截断。
- i18n 加 `janus:island.monitor.*` 键组（双语）。

### P2 内容查看（交互增强）

- 单击子行 → 左栏从"身份预览"切"内容视图"（再点/Esc 退回；main 行行为不变）。
- 数据：`subagent-run:getContent(runId)` IPC，有界尾读（照抄 `transcript-excerpt.ts` 的 64KB tail 模式）读子 rollout / 子文件 / message 表。
- 展示：滚动消息列表（kicker + 文本），复用通知行排版语言。

### P3 兜底与扩展

孤儿记录归档策略、Codex 嵌套派发（depth > 1）样本补验与归属链测试、其余 CLI 按需探针、孤儿子记录（CLI 崩溃残留）的清理。

### 验证面

| 层 | 手段 |
|---|---|
| 分类函数 | golden fixture 单测（三家样本） |
| 投影归属 | registry 单测（parent 链、mission 归属、孤儿） |
| 树 UI | `island-interaction.spec.ts` 扩 monitor 用例（现有 e2e 骨架） |
| 真机 | 启一个 Claude Task + Codex `spawn_agent`，目检树与主次 |

### 工作量切片

P0 ≈ 三个分类函数 + 投影器 + fixture；P1 ≈ 右列表组树 + 徽标 + 面包屑（一个组件渲染段 + i18n）；P2 ≈ 一个 IPC + 左栏内容态。P0+P1 交付"多子智能体可见、主次分明"的核心诉求；P2 为交互增强。实施顺序建议 P0 起步（纯主进程、可单测、不动 UI）。
