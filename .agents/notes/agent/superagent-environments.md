---
{
  "schema": "harness-note/2",
  "id": "91dac1f7-1814-400f-802e-5229ff6b0228",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-05",
  "updated": "2026-11-06T02:44:59.000Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e546b79c-cdf2-49e5-8efd-8dcf5c11b017" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bf3a9f67-1cbe-42fe-92cb-aff46e2dc0e3" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/35d88be6-50e5-466b-9514-9ecd7ac8ba7e" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/636764b9-0105-4944-91f7-72fcbd3c4869" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/environments.ts", "symbol": "SuperAgentEnvironments", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/controlled-worktree.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/janus/superagent/worker-permissions.ts", "role": "implementation" }
  ]
}
---

# SuperAgent 受控工作环境与 Git 批准

## Problem

P1 已保存稳定工作和输入，但没有约束工作的执行目录。直接复用手动 worktree API 会默认共享依赖、复制配置，删除时还会尝试删分支；这不符合用户明确批准具体创建、合并和删除操作的要求。仅在 MCP 或提示词里要求确认，也不能阻止外部 Worker 通过 Shell 修改 Git 元数据。

本决策交付[一期实施计划](ideas/janus-superagent-mvp-plan.md)的 P2 后端，依赖 P1。P3 已接入受管 Worker、MCP 与必要批准界面，见[Worker 决策](superagent-workers.md)；自然语言调用归 P4，完整界面和侧栏归 P7，本篇 implemented 不代表整个 MVP 完成。

## Decision

### 模块与持久记录

| 模块 | 责任 |
| --- | --- |
| [共享契约](../../../src/shared/superagent-environment.ts) | 检出身份、工作环境、具体操作计划、批准及变更事件 |
| [schema](../../../src/main/janus/superagent/environment-schema.ts)、[store](../../../src/main/janus/superagent/environment-store.ts) | 严格版本／引用校验、串行原子落盘、成功提交后的事件 |
| [environments](../../../src/main/janus/superagent/environments.ts) | 工作归属、规划、批准复核、执行占用与环境失效 |
| [controlled-worktree](../../../src/main/git/controlled-worktree.ts) | 本地 Git 事实检查和受控创建／合并／删除 |
| [worker-permissions](../../../src/main/janus/superagent/worker-permissions.ts) | 由已绑定环境生成 Codex 原生文件系统策略 |
| [IPC handlers](../../../src/main/ipc/superagent-handlers.ts) | 工作区查询／事件和可信主窗口的具体批准决定 |

环境与操作存于 Electron `userData/janusx/superagent/environments.json`，格式 version 1，复用 P1 原子文件写入，不改变 P1 `records.json` 格式。环境关联稳定 workId 和 workspaceId，保存规范化工作区根路径、worktree 路径、Git commonDir／gitDir、目录物理身份、分支、HEAD 及创建基线。一个工作最多一个未删除环境，不同工作的活跃绑定不能重叠。

读取只还原记录，不重放操作，不恢复执行占用。重启发现 executing 操作时派生为 unknown 并保留诊断，待明确操作时持久化；不把不明结果当成失败后自动重试。损坏、未知版本和非法引用保持原文件并报错，写入失败不发布成功事件。

### 规划、批准与执行

复用先验证登记工作区、仓库、实际目录、分支、未提交修改、Git 操作中状态和占用。新归属的目录须干净；同一工作继续使用自己的环境时保留已有修改。工作区路径别名、终端路径别名均解析到实际目录；别名改指另一目录后原绑定失效，不随导航或别名变化迁移。

Janus 的宿主接口生成并保存具体计划，renderer 只能针对 operationId 同意或拒绝，不能随批准替换目标。计划保存工作 revision、实际路径／分支／提交、Git 状态及被忽略的文件列表；创建还保存基线引用和解析后的提交，删除记录未合并提交数、保留分支及不强删。批准期限是一个内部常量（15 分钟），没有新增参数面板。

执行前再次读取事实并比较批准快照，复核工作未关闭、revision、登记工作区、物理目录身份、分支／HEAD、占用及目标不存在等条件。实质变化将操作标记 stale，必须生成新计划；不改用碰撞后缀或悄悄切换基线。拒绝不执行；重复提交已决操作返回已有结果。先保存 executing 再调用 Git，成功后在同一环境账本提交结果与环境绑定／删除标记。

| 操作 | 具体行为 |
| --- | --- |
| 创建 | 默认以当前登记工作区分支及其已解析提交为基线，固定分支和完整目标路径；不同工作使用独立检出目录。禁止碰撞、已有分支、嵌套检出；不链接 node_modules，不复制配置／秘密文件，不自动安装依赖。 |
| 合并 | 合入明确登记工作区，以批准的源提交执行 `--no-ff`；源和目标干净、空闲、同仓库且不同检出／分支。冲突保留并报告，后续通过既有 Git UI 或明确操作处理，不自动 abort、重试或清理。 |
| 删除 | 只删除明确 linked worktree，禁止删除主检出或当前登记工作区本身；拒绝脏目录、占用、锁定和进行中的 Git 操作，不 force。预览被忽略内容和未合并提交，目录删除后保留分支与工作历史，不隐含 prune 或删分支。 |

[既有 worktrees API](../../../src/main/git/worktrees.ts)通过可选 `isolated` 创建及 `worktree-only` 删除模式接入上述实现。原手动 UI 的默认共享／复制和删分支行为保持兼容，由原文档继续维护。受控 Git 调用使用参数数组、去除继承的 `GIT_*` 环境覆盖，并禁用 hooks／fsmonitor／签名及配置的 clean／smudge／process filters 等隐式执行；这些选择只作用于此宿主路径。

执行前写入失败不会调用 Git；Git 已完成但结果写入失败时保留不确定状态，不自动回滚、删除目录或再次执行。协调器串行化自身操作，Git 自身锁提供命令级保护；不宣称与所有外部 Git 客户端之间存在一个跨进程事务。

### 执行占用与原生权限

宿主 acquire 在绑定与工作版本复核后生成短期环境 lease，release 只释放占用。校验 lease 时复核当前工作归属／关闭状态、工作区根、仓库／目录身份、分支和 HEAD；失效后不能通过切回原分支复活旧 lease。补充输入仍可更新工作版本，不因此自动停止有效执行。应用重开不恢复 lease。当前也检查已知终端的启动 cwd，包括路径别名；无法由该信息知道所有外部进程或 Shell 后来切换的 cwd。

权限工厂从 lease 生成 `janus-superagent` 原生 profile：允许读取根文件系统，仅工作检出目录可写；`.git` 指针、实际 Git 元数据目录和 `.agents`／`.codex`／`.aws` 子目录保持只读，不附加系统临时目录写权限，沙箱命令网络关闭。Windows 明确选择 MXC。原生规则／MCP 询问仍可交给用户，但禁止 Worker 自行申请扩大文件系统权限；配置以本次进程／线程 override 返回，不修改用户全局模型、审批或其他配置。

P3 已使用这份策略启动及恢复 Worker，并在派发、追加、恢复前校验 lease，运行期间检查身份变化并停止失效执行。释放 lease 前确认所属进程与后台活动结束；无法确认时保留占用和诊断，不把调用 release 当成已经停止。具体进程归属及真实后台验证归[Worker 决策](superagent-workers.md)，P6 再接入完整生命周期监督与重启恢复。

该原生策略也阻止 Worker 直接 `git add`／`commit`。P3 已提供具体文件快照批准后的宿主提交，提交与 lease 校验／停止串行协调，成功后更新当前 lease 的预期 HEAD；未知结果使 lease 失效，不为兼容工作流改成 full access。依赖安装、联网与临时写入遇到需要时按明确范围处理；不因当前 profile 较严格而静默扩大权限。

原生文件系统沙箱不自动约束外部 MCP、插件／浏览器工具或获批的提权执行。P3 对继承 MCP、插件和额外执行通道施加本次进程限制，避免间接写通道绕过宿主批准；保留可用工作流配置不等于原样接受所有权限。依据为 [Codex permissions](https://learn.chatgpt.com/docs/permissions)、[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)及[审批与保护路径](https://learn.chatgpt.com/docs/agent-approvals-security)。本次实际验证使用本机 Codex 0.166.0 的 MXC，不将结论推广为所有执行器／系统均已验证。

## Alternatives considered

- 直接复用手动 API：已有 UI、依赖共享和删除流程，改动最少；但默认复制配置、删分支及动态避让路径与具体批准不相容，因此保留原默认，增加显式受控模式。
- 提示词或命令名称拦截：接入轻，能提醒遵守工作流；Shell 脚本、子进程和直接文件写入仍可修改 Git，因此不能作为强制边界。采用原生文件系统策略，宿主管理 Git 元数据。
- 独立容器或完整文件操作代理：可进一步隔离并统一所有写入，代价是运行环境、依赖和工具兼容工程。当前 Windows MXC 已通过目标边界测试，首版先使用原生能力；跨平台或提交能力要求若不能满足，再评估额外隔离层。

## Consequences

P2 提供可持久追踪、幂等决定和执行前复核的 Git 管理入口，区分长期工作环境与短期 Worker 占用；新旧手动路径有独立兼容检查。用户仍在具体操作上作决定，回收／ready／关闭不会自动授予清理权限。

当前支持本机、已登记检出根目录、具名分支及 linked worktree。远程／WSL／SSH、bare、detached HEAD 和子目录作为工作区根尚未纳入；其他系统的原生权限策略未做产品验证。目录身份及 Git 快照在操作边界检查，不能承诺抵御任意外部客户端在检查后同时改写；P3 已增加运行期身份监控和失效停止，但不承诺与任意外部客户端之间存在跨进程事务。完整 AC-9／19／20／25 保留多工作调度、生命周期与完整 UI 的联合验收。

### P2 验证（2026-11-06）

真实 Git 临时夹具覆盖创建前无副作用、拒绝／过期／重复批准、路径／基线／工作版本变化、并发争用、复用保护、终端别名占用、工作区别名改指、分支切换后 lease 失效、重启不重放、精确提交合并、冲突保留、未合并分支保留、脏目录拒删、非法／损坏账本及写入失败。旧 worktree 共享依赖、配置复制及默认删除路径回归通过。

原生集成测试直接使用生产权限工厂生成的 override，通过真实 Codex MXC 执行 13 项命令／文件检查：允许读取 Git 和修改当前工作代码，拒绝写主目录／工作区外／目录别名、创建／合并／删除／切换 Git 分支或 worktree，以及写入 Git 指针／HEAD 或改名 Git 元数据。测试同时验证未获授权的目标和 Git 状态未被改变；不调用模型，不替代 P3 的 App Server 全链路验证。

9 组相关测试共 117 项通过，包含 P1、IPC、退出、旧 worktree 和新增环境／原生权限测试。原生测试需在 Windows 设置 `JANUS_SUPERAGENT_CODEX_BINARY` 指向兼容的真实 Codex 二进制，否则该项会跳过；本轮已设置并实际运行。执行命令为：

```text
npm run test:unit -- tests/unit/superagent-environments.test.ts tests/unit/superagent-worker-permissions.test.ts tests/unit/worktree-git.test.ts tests/unit/superagent-store.test.ts tests/unit/superagent-persistence.test.ts tests/unit/superagent-ipc.test.ts tests/unit/app-shutdown.test.ts tests/unit/janus-ipc-contract.test.ts tests/unit/janus-chat-store.test.ts
```

类型检查、改动源码 ESLint 和应用构建通过；Note 校验结果在实施计划交付记录维护。本轮补齐 P1 安装时跳过的 Electron 二进制下载，用于真实 Git 模块加载；未修改依赖声明／锁文件或 Codex 全局配置。P2 轮次未做桌面 E2E、模型开发或多平台测试；P3 已另行通过受管 Codex 和完整 Electron E2E，证据见[Worker 决策](superagent-workers.md)。P2 实际 Git 变更仅发生在临时夹具仓库；测试和构建日志位于忽略目录 `artifacts/superagent-p2-*.log`。
