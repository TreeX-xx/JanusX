---
{
  "schema": "harness-note/2",
  "id": "984f67da-38f0-455e-8903-2b0083c5b533",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-10-29T16:29:34.958Z",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662",
  "moduleState": "partial",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/ipc/checkpoint-handlers.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/stores/checkpoint.ts",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/shared/ipc/checkpoint.ts",
      "role": "implementation"
    }
  ]
}
---

# 会话检查点

## Responsibility

文件还原点功能已退场。终端提交及内置 Agent 文件工具不再创建持久化检查点，应用不再订阅其事件或初始化检查点缓存。旧 IPC 仅保留兼容拒绝入口：列表返回空，其余请求明确报告已退场，不访问快照数据。历史文件保留给存储迁移／清理处理。

P4 已接管迁入 userData 的旧快照维护，沿用 30 天窗口、最新 5 个底线和 40 个上限；关联解除后的整份数据保留 30 天。通用设置支持主动清除旧快照及内容块，具体计时、使用保护、未知数据保留和验证归[存储专题](../../desktop/workspace-state-storage.md#p4-本地验收与限制)。此维护不恢复检查点生成或用户恢复入口。

## 当前实现与验证

终端提交只记录提示词，Companion、历史续接和交接沿用同一记录路径；退出与关闭不再完成检查点。右侧 Island 的回合内存快照与差异算法保持独立，回合事件的旧 checkpointId 字段为 null。共享 agentX 的 workspace.create／edit／delete 不再调用检查点解析器或返回 checkpointId；路径和审批限制、哈希及提交复核、原子替换、取消、共享排队和本次调用的 diffPreview 继续保留。独立 CLI 不再根据旧检查点 ID 宣称“可撤销”。Note／Harness 的事务撤销与聊天上下文压缩保持原职责。

主 Agent 验证：agent-core 全套 24 文件 378 项通过、1 项既有跳过；新增测试在快照解析器必定失败的条件下验证创建／修改／删除成功且不创建检查点目录。桌面终端、退场 IPC、退出及 Island 的定向测试覆盖 6 文件 38 项（首轮语法修复后分别重跑受影响文件），类型检查及定向 ESLint 通过。旧数据未删除；没有进行真实安装包升级和慢盘长期验收。

## 退场依据（实施前核实）

记录只观察，不静默修改工作树；恢复要求用户明确操作。计数、列表和回合关联共享 sessionId，数量与时间双上限约束存储。会话界面只查阅对话与续接，不调用检查点服务，交互见 [职责入口](../records/module.md)；工作树创建、合并与删除见 [职责入口](../worktrees/module.md)。

当前实际创建入口有两类：`CLITerminal` 提交完整输入后发送 submitLine，主进程的 enqueueCheckpointFromSubmit 在共享队列中完成上个检查点并创建新检查点；Companion 输入及会话交接也复用此路径。该捕获异步排队，不阻塞外部 CLI 执行，不能保证外部 CLI 每次编辑都有严格写前快照。内置 Agent 的 workspace.create、workspace.edit、workspace.delete 则等待保护快照完成后再写入或删除；工具在 agent-runtime-handlers 及 desktop-task-turn 中注册，底层实现位于相邻 agentX 的 workspace-tools.ts。

终端回合记录携带 checkpointId，但右侧回合变更统计由 TerminalTurnChangeTracker 独立捕获内存文件基线并比较，不读取持久化检查点内容，不能把该统计描述为依赖检查点磁盘快照。TurnChangeIsland 通过 useTurnChangesStore 订阅 terminal:turn-changes，直接显示事件中的 files 和增删行数；最新与历史视图均不读取 checkpointId，点击文件通过 openEditor 打开当前文件，不查询历史快照。两套机制只共用 workspaceIo 读写队列，不能据此推断数据依赖。App 仍订阅检查点事件并刷新元数据列表；创建、差异与恢复 IPC 仍注册，但现有会话界面没有恢复按钮。知识模块支持 checkpoint-event 类型不等于当前存在实际快照调用，不能仅据类型声明认定它是检查点消费者。

用户明确不要会话界面的恢复／还原点功能，且已授权 xdo 移除自动快照，再继续 P4。以下分析描述退场前的调用关系和取舍，不代表这些捕获仍在执行。

### 内置 Agent 文件工具评估

用户倾向移除冗余检查点。本次核实的建议是保留 workspace.create／edit／delete 文件能力，移除它们自动创建持久化检查点的副作用。三者目前调用同一 createCheckpoint，捕获整个候选工作区快照后保存元数据和索引、执行保留规则并安排 GC，并非仅备份此次触及的文件。内容缓存和去重减少重复字节读取／存储，但仍有目录枚举、状态查询及每次快照元数据写入，且快照失败会阻止本次文件操作。移除它能减少这类附加读写，不能据此承诺目标文件写入或整个系统磁盘占用有固定上限。

检查点属于事后历史恢复，不负责文件操作的路径授权和冲突检测。workspace.edit 的 expectedHash、匹配／锚点校验、提交前重验、临时文件落盘及原子替换在 file-transaction 中独立执行；workspace.create 使用排他创建，拒绝覆盖已存在路径；workspace.delete 独立执行路径／敏感目标限制、预览及提交时的身份／内容复核。共享队列、审批、审计和取消也应保留。删除原快照区间时需保留必要的再次核验，不能顺带删掉并发保护，也不能把排他创建或递归删除描述为完整事务回滚。

实际消费方面，Agent 注册工具中未发现 checkpoint.restore／workspace.undo 等恢复工具，桌面普通文件工具也没有使用该检查点的恢复按钮。底层 restoreCheckpoint 和 IPC 仍有恢复能力，因此它不是空操作；移除的真实代价是失去该份历史内容恢复来源，尤其是未提交／未跟踪文件删除后不能靠此恢复。Git、审批和审计不等价于文件内容备份；本次建议接受取消历史还原点的产品取舍，不另建自动备份或回收站作为替代。

文件差异可以独立保留：工具输出的 diffPreview 来自此次创建内容、编辑请求或删除前读取的目标内容，不依赖检查点 blob；右侧终端 Island 仍使用自身回合内存快照。模型摘要、chat-core 工具轨迹和 CLI 只透传或展示 checkpointId，CLI trace-preview 还拼接“可撤销”文案；退场时应停止新结果产生该字段并同步撤下此提示，兼容旧会话携带字段，不为展示历史记录读取／重建快照。JanusX 直接使用共享 agent-core 工具，实施需修改 agentX 源码并验证桌面／独立 CLI／任务执行入口，不能仅改桌面包装或 node_modules。

Note／Harness 的 txId、journal 和 undoPreview／undoApply 是另一套已落地的事务撤销机制，未发现它们调用 checkpointManager，不属于本次删除范围；聊天上下文压缩的 checkpoint 也不是文件快照。后续建议把终端提交捕获、文件工具快照及无人消费的检查点 IPC／订阅作为同一退场切片核实，P4 不再为即将停产的新检查点扩展维护机制；已有数据迁移兼容与主动清理仍需保留边界，不在分析阶段删除用户数据。此前确认的 30 天仅在仍保留的检查点／历史数据策略中适用，不构成必须继续生成检查点的要求。

实施验收覆盖三类工具成功／拒绝／冲突／取消、快照存储不可写不再阻止普通文件操作、新操作不创建 checkpoints 元数据或 blobs、调用差异和 Island 独立性。旧工具轨迹仍能保留 checkpointId 字段显示历史标识，但不恢复快照功能；后续兼容字段清理由独立范围处理。

## Related documents

[Session checkpoint expand panel](session-checkpoint-expand.md) 维护展开面板的订阅与状态呈现；[session-checkpoint-migration](session-checkpoint-migration.md) 记录检查点归属迁移；[count-truth](session-checkpoint-count-truth.md)、[retention](checkpoint-retention.md)、[safety](checkpoint-safety.md) 分别维护计数真值、保留上限与快照安全。
