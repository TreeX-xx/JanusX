---
{
  "schema": "harness-note/2",
  "id": "91dac1f7-1814-400f-802e-5229ff6b0228",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-05",
  "updated": "2026-11-11T08:07:09.901Z",
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

环境与操作存于 Electron `userData/janusx/superagent/environments.json`，格式 version 1，复用 P1 原子文件写入；`records.json` 的工作记录增加可选 environmentSelection，旧记录保持可读。环境关联稳定 workId 和 workspaceId，保存规范化工作区根路径、worktree 路径、Git commonDir／gitDir、目录物理身份、分支、HEAD 及创建基线。一个工作最多一个未释放且未删除的环境。2026-11-10 按用户 xdo 授权允许不同工作共享同一 checkout，仍禁止互为上下级的不同执行目录；旧版本不能读取新建的共享绑定，不应直接降级使用该账本。

读取只还原记录，不重放操作，不恢复执行占用。重启发现 executing 操作时派生为 unknown 并保留诊断，待明确操作时持久化；不把不明结果当成失败后自动重试。损坏、未知版本和非法引用保持原文件并报错，写入失败不发布成功事件。

### 规划、批准与执行

复用先验证登记工作区、仓库、实际目录、分支、未提交修改、Git 操作中状态和占用。首次复用默认要求目录干净；用户明确要求处理现有改动时，通过 environmentSelection.includeChanges 承接原目录中的修改。同一工作继续使用自己的环境时保留已有修改。工作区路径别名、终端路径别名均解析到实际目录；别名改指另一目录后原绑定失效，不随导航或别名变化迁移。

work_route 保存明确目录、分支、复用／创建方式及已有改动承接意图。已有绑定优先延续；无绑定时优先查找指定目录或分支，再考虑当前检出及同仓库其他已有具名分支检出。指定目标被占用或改动归属不明时报告阻塞，不静默新建替代工作树。明确隔离请求仍生成具体创建计划。显式改选要求旧执行确认空闲，释放原绑定并使旧待批准计划失效；新路径不会续接旧路径的原生会话。

提交、推送及发布任务先通过只读 work_environment 查询当前仓库各具名检出的路径、分支、HEAD、已有改动和分配关系，可分页读取；查询不分配目录、不启动 Worker，也不代表目录已被预留。相同 HEAD 不代表包含原目录未提交或未跟踪的文件。仅指定 includeChanges 的承接请求指向登记工作区，即使原任务已绑定独立工作树，也需在旧执行确认空闲后改选；持久选择与实际绑定不匹配时阻止启动。同一续接输入不能以相同决策身份替换环境选择。

创建批准界面在来源含未提交改动时说明新工作树只包含所选提交。Worker 输入明确展示执行目录、分支和提交／推送范围，发布前核对目标分支、完整改动、版本、仓库发布脚本及构建资源；文档已有的依赖和资源准备继续走原生权限入口。此优化不修改项目发布分支政策，不自动迁移正在运行的任务，也不以构建检查代替发布结果。

releasedAt 记录分配释放，与 removedAt 的物理删除分开。关闭任务且确认空闲后可释放历史绑定；其他工作也可共享同一 checkout。终端启动目录不再阻止普通 Worker 启动；Git 合并、删除和环境切换仍使用严格空闲检查。宿主不宣称能识别所有外部 Shell 的当前写入活动，Worker 必须保留其他执行的修改。

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

权限工厂从 lease 生成 `janus-superagent` 原生 profile：允许读取根文件系统，工作检出目录及该执行的私有 scratch 可写；`.git` 指针、实际 Git 元数据目录和 `.codex`／`.aws` 子目录保持只读。2026-11-11 用户明确选择整个 `.agents` 目录可写，保留其他目录和 Git 的现有权限，因此将 `.agents` 改为显式 `write`，范围包括 Notes 和其余 `.agents` 文件，不新增专用 Note 工具或逐文件批准。实际 Windows MXC 回归发现仅移除只读规则仍被原生隐式保护拒绝，必须明确声明该目录可写。文件权限不改变仓库指令、共享 Task 归属或保留他人修改的要求。

不附加系统临时目录的通用写权限；Windows 明确选择 MXC，网络代理仅默认允许 localhost／127.0.0.1／::1 及本地绑定。构建、依赖和上传需要外部网络或额外目录时，允许原生权限请求，经具体批准执行；权限请求只授予本轮显示的范围，不自动保存全局规则。配置以本次进程／线程 override 返回，不修改用户全局模型、审批或其他配置。已运行 Worker 的沙箱不热更新，使用新构建启动或重新拉起执行后采用新 profile。

原生 config/read 的缺失信任决定在工作卡中展示准确目录并等待确认，写入后重新读取配置，再复核 lease 后继续同一次启动。取消保留暂停，停止终止待启动承诺；已有 trusted／untrusted 决定不被自动改写。Windows 路径大小写和分隔符统一比较。

git_work 为受控标签创建和非强制推送提供宿主入口，固定当前 HEAD、分支、标签及解析后的唯一远端目的地，执行前重新核对。复用现有操作审核及持久回执；未知结果不重放。构建和安装包上传仍由 Worker 使用原生命令与所需权限执行。

P3 已使用这份策略启动及恢复 Worker，并在派发、追加、恢复前校验 lease，运行期间检查身份变化并停止失效执行。释放 lease 前确认所属进程与后台活动结束；无法确认时保留占用和诊断，不把调用 release 当成已经停止。具体进程归属及真实后台验证归[Worker 决策](superagent-workers.md)，P6 再接入完整生命周期监督与重启恢复。

该原生策略也阻止 Worker 直接 `git add`／`commit`。P3 已提供具体文件快照批准后的宿主提交，提交与 lease 校验／停止串行协调，成功后更新当前 lease 的预期 HEAD；未知结果使 lease 失效，不为兼容工作流改成 full access。依赖安装、联网与临时写入遇到需要时按明确范围处理；不因当前 profile 较严格而静默扩大权限。

原生文件系统沙箱不自动约束外部 MCP、插件／浏览器工具或获批的提权执行。P3 对继承 MCP、插件和额外执行通道施加本次进程限制，避免间接写通道绕过宿主批准；保留可用工作流配置不等于原样接受所有权限。依据为 [Codex permissions](https://learn.chatgpt.com/docs/permissions)、[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)及[审批与保护路径](https://learn.chatgpt.com/docs/agent-approvals-security)。本次实际验证使用本机 Codex 0.166.0 的 MXC，不将结论推广为所有执行器／系统均已验证。

2026-11-11 `.agents` 可写验证：固定引擎 `624fe7f84629ac28` 的六包及安装字节通过 `npm run prepackage` 校验。设置本机 `JANUS_SUPERAGENT_CODEX_BINARY` 后执行 `npm run test:integration -- tests/unit/superagent-worker-permissions.test.ts`，5 项全部通过；其中真实 Windows MXC 子进程执行 19 个边界探针，允许代码及 `.agents` 既有 Note、新 Note、其他文件和原子替换，拒绝配置目录、外部路径、其他 checkout、junction 越界和 Git 元数据修改。日志为 `artifacts/worker-agents-permissions.log`。这验证本机沙箱行为，不代表真实模型一定不会提出其他审批。

## 2026-11-09 优化验证

9 个相关测试文件累计 85 项通过，覆盖目录／分支选择、已有改动承接、空闲工作树复用、释放后重分配、原生信任暂停与恢复、原生权限响应、宿主标签及非强制推送、持久回执、调度和工作卡交互。Windows 实际 Codex 验证包括原有沙箱边界、父目录下嵌套工作树只读保护，以及隔离 CODEX_HOME 中通过原生配置 API 确认信任并继续启动；没有修改真实用户信任配置或向真实远端推送。

引擎 typecheck/build、桌面 typecheck/build:check、工作卡 ESLint、i18n:check 和六包制品校验通过。Note 校验为 0 errors，另有 17 条已有外部链接诊断。整仓 diff 检查仍报告未由本轮改动的 JanusIslandExpandedShell.tsx 行尾空白；本轮相关文件的检查通过。没有执行真实安装包上传或全仓测试，不把临时远端推送测试等同于生产发布验收。

## 2026-11-10 发布任务分配回归

固定引擎制品更新为 `7e6e92bb6b828b87`，六包依赖、锁文件、归档与安装内容校验通过。消费端 environment-selection、routing、context、environments、workers、engine-packages 六文件 67 项通过；工作卡浏览器测试 9 项通过。覆盖相同 HEAD 下的已修改／新增文件差异、环境查询不产生副作用、旧隔离目录承接当前改动、持久选择与绑定不匹配阻止启动，以及创建前显示未提交文件不会被复制。续接身份冲突增加最新卡片读取后定向复验通过，计入上述用例，不重复计数。

引擎 janus-agent 包构建、桌面严格未使用项类型检查、build:check、包边界、工作卡 ESLint、双语与制品检查通过。应用 339 篇 Note 为 0 errors／17 条已有显式外链诊断；引擎 Note 仍有原有的缺 Intent 和历史相对链接两项错误及两条未解析跨仓引用，本次维护文档未引入新错误。测试使用临时 Git 仓库和原生协议 fixture，未执行真实远端推送、安装包上传或公开发布，也未改写已有任务的运行数据。

## Alternatives considered

- 直接复用手动 API：已有 UI、依赖共享和删除流程，改动最少；但默认复制配置、删分支及动态避让路径与具体批准不相容，因此保留原默认，增加显式受控模式。
- 提示词或命令名称拦截：接入轻，能提醒遵守工作流；Shell 脚本、子进程和直接文件写入仍可修改 Git，因此不能作为强制边界。采用原生文件系统策略，宿主管理 Git 元数据。
- 独立容器或完整文件操作代理：可进一步隔离并统一所有写入，代价是运行环境、依赖和工具兼容工程。当前 Windows MXC 已通过目标边界测试，首版先使用原生能力；跨平台或提交能力要求若不能满足，再评估额外隔离层。

## Consequences

checkout 检查记录可写父目录内的已登记嵌套工作树，将其作为 protectedPaths 下发原生只读规则；租约持续检查保护目录集合是否变化。同一 checkout 可共享，互为上下级的不同 Worker 目录仍拒绝。未知或停止未确认的执行继续阻塞；由当前宿主管理的正常活跃同目录 Worker 可以共存。同一 workId 不得重复获取活动租约。宿主提交串行化，成功后同步同目录有效租约的 HEAD；外部未经协调的分支／HEAD 改变仍使租约失效。创建和复用均核对原仓库身份及明确选择的方案，不擅自切换任务基线。具体证据见[可靠性记录](ideas/superagent-harness-reliability.md)。

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
