---
{
  "schema": "harness-note/2",
  "id": "b3067d0b-261d-4788-a691-fdf79c4b635b",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-11-12",
  "updated": "2026-11-24T06:36:16Z",
  "class": "architecture",
  "tags": ["shutdown", "windows", "macos", "superagent"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/5b300170-6b75-400d-998e-1d699dd7d591"}
  ],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/index.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/shutdown/AppShutdown.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/terminal/manager.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/janus-runner/stream-manager.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/office/office-watch-pool.ts","role":"implementation"}
  ]
}
---

# 应用退出、进程回收与安装占用

## Windows 使用中意外退出（2026-11-23）

0.9.8、0.9.9、0.9.10 的主进程完成启动后，将 `uncaughtException` 和 `unhandledRejection` 合并计数。每次异常都会重新安排 5 秒后的清零回调。用模拟时钟运行三个发布标签中 `src/main/index.ts` 的原处理器，交替注入这两类异常，每 4 秒一次，第 21 次在第 80 秒请求重启并调用 `app.exit(1)`。同样 21 次改为每 6 秒一次时均未触发。0.9.10 对已进入退出流程的保护不覆盖正常使用时的这条路径。

强制退出跳过 `before-quit`，因此也跳过 JanusX 在该事件中安排的会话保存与资源清理。便携版另有重启竞态。三个版本锁定的 NSIS 模板都会等待解压后的程序退出，随后删除解压目录。JanusX 调用无参数的 `app.relaunch()`，目标仍是该目录中的程序。清理可能妨碍新实例启动。三个版本的计数逻辑已在 macOS 上隔离验证，清理与重启的实际先后仍需 Windows 便携包验证。[Electron 退出与重启语义](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions)

每次主进程未捕获异常会写入 `logs/startup.log`，触发重启的决定只输出到控制台。11 月 23–24 日提供的 Windows 安装版日志中，0.9.10 有六条启动记录，其间没有未捕获异常或未处理的 Promise 拒绝。`Starting JanusX` 在取得单实例锁之前写入，重复打开程序也会留下记录。同时段的 `logs/shutdown.log` 有五个不同宿主 PID 记录子进程回收，却没有主程序的 `requested`、`begin` 或 `exit`。现有证据支持继续核对 Windows 可靠性记录、Chromium 日志和崩溃转储，尚不能确定窗口消失的原因。

同机旧日志在 0.9.6 和 0.9.9 启动时共三次记录 `window:get-maximized` 重复注册，堆栈指向 `bootstrapApp → createWindow → registerWindowIpc`。0.9.10 已将窗口 IPC 注册移出窗口创建函数，该故障未再出现在所提供的 0.9.10 日志中。

## 公共运行时接入（2026-11-15）

当前 JanusX 工作区已将既有 Windows 身份核验和 POSIX 自有进程组清理抽到 `platform/process-host/owned-tree.ts`；`shutdown/process-tree.ts` 保留桌面诊断装配和兼容导出，Node 独立入口不再因进程回收加载 Electron。普通进程、CLI、Git、项目与 Office 等消费者经公共服务启动／停止；协议原生驱动、SSH/WSL transport 和外部引擎仍按[运行时边界](./platform-runtime-boundaries.md)逐项列明。

这是公共入口归属调整，不表示本篇所有历史限制或独立安装包验收已解决。真实 Windows 参数／超时／取消及后代退出确认回归通过，Mac TERM／升级 KILL／权限失败仅有模拟证据；父节点提前消失、脱离组的后代、Mac Cmd+Q 和实际升级占用仍需对应环境验证。下文 2026-11-12 的提交、安装副本和构建来源保留其当时边界，不作为本次产物证据。

## 当前交付记录（2026-11-12）

用户授权 xdo 实施并覆盖 SuperAgent installer。修复实施在 JanusX-superagent-automation 工作树和相邻 janus-agentX 引擎源码；保留两处原有未提交迁移。dev 本轮维护此分析 Note，尚未回移产品代码，因此不能把 dev 视作已修复构建。

- 退出意图在 renderer ACK 前锁定；异常风暴不再 relaunch，second-instance／窗口激活不再创建新窗口。正常运行期的崩溃恢复保留。
- AppShutdown 同时发起独立资源停止，终端记录在终端停止等待结束后保存，Office 索引在 watch 停止等待结束后关闭。总预算 20 秒，进程步骤 17 秒，最后 3 秒尝试自有进程失败重试；未确认、异常和超时退出码为 1。同步诊断写入 userData/logs/shutdown.log，仅持久化步骤、耗时、状态和进程身份，不记录命令、提示或环境变量。单步 timeout 不等于底层操作已完成；保留失败诊断，不能把退出码 1 称为清理成功。
- 终端、普通 Agent、项目和 OpenCode 共用停止入口。Windows 在父进程存活时捕获原生创建时间，以句柄终止并验证退出；终止后重新扫描后代，最多三轮，失败保留捕获身份用于重试。首次普通进程清理合并为一次 PowerShell 调用，避免三次启动造成单项目超过 5 秒。原 managed Worker 保留持久身份恢复与二次核验。普通进程尚未在创建时持久登记，父节点在停止请求前自然消失、权限拒绝以及不可查询后代仍是需扩展验证的边界。
- Agent 的 AbortSignal 不再先杀父壳；killAll 等待停止结果，CLI 路径解析期间取消的任务不能稍后 spawn。ProjectRunner 移除同步 taskkill 和用 killed 误判退出的逻辑；POSIX 自有组验证后执行 TERM、等待、KILL。Mac 原生系统测试未运行，不能据此宣称 Mac Worker 已开放。
- Browser terminal host、workspace 本地 SSH/WSL 连接、mobile host 显式接入协调器，插件 runtime 在等待 service.dispose 前释放；远程 daemon／PTY 保持持续运行契约。终端、Agent、项目、OpenCode、Office 预览和本地 transport 启动检查退出状态。既有 Office watch 清理保留；文档 resident、插件原生进程及真实 SSH/WSL 混合负载仍需后续专门矩阵。
- 真正的引擎 workers.close 重试此前失败的 stop Promise；新失败仍保留 stopConfirmed=false、hostDrained 和环境占用。普通 Codex Windows dispose 也改为确认式树终止，拒绝访问不再静默成功。

已验证：桌面核心 9 文件 88 项，追加 2 项 Agent 关闭竞态测试；Office／workspace 服务 4 文件 29 项（其中 17 项 Office 与前组重复）；引擎原生 2 文件 15 项；桌面 typecheck 与引擎 build 通过。首次回归发现停止耗时超限，优化后同一真实项目测试通过。以下为最终安装包的隔离运行证据。

引擎固定包版本为 0.1.0-engine.20c26913ba5c4f38，六个包由 vendor/janus-agent/manifest.json 记录完整 SHA-256；包含原有迁移工作区输入，源码不是干净发布提交。构建只覆盖用户指定的 release/superagent/installer，不改动 D:/janusX 真实安装和配置，不代表已经执行覆盖安装或远端发布。

最终安装包已从 NSIS 中解出 EXE 与 app.asar，哈希与实际测试目录一致；478 个 out 文件、186 个引擎文件逐字节一致，latest.yml 的 SHA-512 与大小通过。包外独立目录的模块图、LLM runtime、真实窗口和 preload 验证通过。安装包 SHA-256：d8b543fdf5ea340a104d95b7367a5a6900529d2ebc36fd461de3e6866f09589f，大小 171998430 字节。

| 最终包隔离场景 | 启动器观察耗时 | 退出码 | 30 秒检查 |
| --- | --- | --- | --- |
| 空闲退出 | 1057 ms | 0 | 自有进程 0、所测端口关闭、EXE 可独占打开 |
| PTY＋项目＋managed 协议夹具＋Office 预览 | 5016 ms | 0 | 自有进程 0、所测端口关闭、EXE 可独占打开 |
| Worker／自动化清理阻塞注入 | 17615 ms | 1 | 自有进程 0、所测端口关闭、EXE 可独占打开 |
| 退出期间 21 次异常风暴 | 2453 ms | 0 | 自有进程 0、所测端口关闭、EXE 可独占打开 |

正常负载包含真实 PTY、后台项目及其监听子进程、真实 OfficeCLI 和 managed transport 协议夹具；没有调用真实模型。阻塞注入按预期返回 1，其余返回 0。旧异常风暴场景产生的新实例已不再出现。候选测试发现并发 PowerShell 冷启动超时和 Worker 超过 12 秒预算，均未交付；最终合并原生请求、以 Toolhelp32 快照替代重复 WMI 枚举，并按实测调整总预算为 20 秒、进程步骤为 17 秒，保留最后 3 秒兜底。

证据保存在 artifacts/shutdown-delivery-20261112/shutdown-results.json 和 artifact-verification.json；失败候选证据保留，最终记录用 app.asar SHA-256 绑定候选字节。NSIS 同目录覆盖升级、真实 SSH/WSL／插件多进程混合矩阵和 Mac 真机验收仍为 not-run。

Windows 快照入口依据 [Microsoft Toolhelp 文档](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot)实现，并保留创建时间与原生句柄验证。夹具叶子 PID 未总出现在 CIM 进程清单中，因此以监听端口检查作为附加观察，真实 Node 父子进程的独立原生测试作为树回收证据；不把有限场景扩展为全部原生 CLI 的证明。

## 修复前的结论与调查边界

用户反馈：使用 SuperAgent 安装版，退出并等待至少 30 秒后，重新安装仍提示正在运行。当前 Windows 清理不能认定为所有路径均可靠。正常关闭的隔离安装版测试可以释放所测资源；退出期间异常重启的故障注入则复现了新 JanusX 进程继续运行、程序文件仍被占用。串行清理超时、普通进程树终止和退出事件覆盖也有确定缺口。

这证明存在能够造成同类安装提示的路径，尚未证明用户此前每次遇到的原因就是该路径。用户选择暂不关闭正在工作的真实实例；本次没有终止它、修改它的配置或执行覆盖安装。下文保留修复前的调查与原始计划；SuperAgent 交付链的实施和验证见当前交付记录。

本次比较了三个层次，不能互相替代：

| 对象 | 核对基线 | 用途 |
| --- | --- | --- |
| 当前 dev | `12fc9bf5cf4491bfe6d9fc4798a8f4144c2d29ee`，保留原有未提交改动 | 通用桌面、终端、Office、项目和退出代码 |
| SuperAgent 工作树 | `feat/superagent-automation-exploration`，HEAD `d3abad6bb59c7d14386394a2af128c418dd0b735`，另有大量未提交引擎迁移 | 同时检查 HEAD 与当前工作树；不覆盖其改动 |
| 实际安装包 | `D:\janusX`，JanusX `0.9.9`，内置 `@janus-agent/janus-agent` 为 `0.1.0-engine.457d4530b40f11d6` | 从实际 `app.asar` 读取并运行；不是用 dev 源码猜测安装版本 |

调查时 SuperAgent 工作树依赖为 `0.1.0-engine.ea0ea625e770270c`，与安装包不同。当前 `workers.ts`、`codex-managed-transport.ts` 等已转为引擎包转导出；后续应在相邻 `janus-agentX/packages/janus-agent/src/superagent` 的真正实现处修复、测试并生成固定版本包，不能只修改桌面的转导出文件或 `node_modules`。

## 安装器提示的含义

仓库 `electron-builder.yml` 未设置自定义 `customCheckAppRunning`。本地固定依赖的 `app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh` 用 `APP_EXECUTABLE_FILENAME` 查找进程：按用户安装通过 `tasklist` 过滤用户名和映像名，全用户模式通过 nsProcess 查找。因此“JanusX 正在运行”首先表示检测到了 `JanusX.exe`，并不是对内存、所有端口或任意文件锁的统一判断。

Windows 上 Electron 主进程、渲染器等共用该映像名；安装包的 Worker MCP 还以 `process.execPath` 加 `ELECTRON_RUN_AS_NODE=1` 启动，同样可能叫 `JanusX.exe`。另一个安装目录的同名实例也可能命中。只有孤立 `codex.exe` 或 `officecli.exe` 时，可能发生资源／文件占用，但不能仅凭它们解释这条映像名提示。

已经退出的 Windows 进程会释放自身资源，但不会因此自动终止所有子进程；其他进程持有的句柄仍可能存在。[Microsoft 进程终止说明](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process)支持这一边界。排查应记录实际映像路径、PID、父 PID、创建时间和所属执行，不能按所有 `node.exe`／`codex.exe`／`JanusX.exe` 批量杀进程。

## 隔离安装副本的实际验证

在同一 Windows 主机建立进程与数据隔离环境：复制完整安装目录，使用独立 `--user-data-dir`、HOME、USERPROFILE、APPDATA、LOCALAPPDATA、TEMP、CODEX_HOME、知识目录和临时工作区。它不是 Windows 虚拟机，也不代替 Mac 或不同权限用户的验证。副本 EXE 和 asar 与原安装文件逐字节哈希一致：

- `JanusX.exe` SHA-256：`e43aed01d12ad363fdfc19f7bdc670c837cd8f422c85f7541cc73dfc1fda3d59`。
- `resources/app.asar` SHA-256：`317b85220856d6e93e6ca3594ea85d045a4b476656828f5e7b8e6b0ea96e1df2`。

通过 Playwright 启动实际 Electron，等待真实页面与 preload 就绪，再关闭主窗口，30 秒后采样进程、测试端口及 EXE 独占打开。没有调用测试框架的应用关闭来代替观察；清理测试副本在结果采集后进行。负载包括真实 node-pty、真实 OfficeCLI DOCX 预览，以及安装包内真实 `CodexManagedTransport` 配合本地协议夹具和后台监听进程。没有调用真实模型服务，不能声称验证了完整 SuperAgent 模型、审批和提交工作流。

| 场景 | 启动器观察到的退出耗时 | 关闭 30 秒后的结果 | 解释 |
| --- | --- | --- | --- |
| 空闲正常关闭 | 569 ms，退出码 0 | 副本进程 0；EXE 可独占打开 | 基础窗口退出路径通过 |
| 终端、原生 RPC 夹具和真实 Office 预览 | 11945 ms，退出码 0 | 副本进程 0；测试监听与预览端口均关闭；EXE 可独占打开 | 本场景正常释放，耗时已接近 SuperAgent 12 秒单步预算；不代表全部负载通过 |
| 清理阻塞注入 | 16832 ms，退出码 1 | 日志出现 SuperAgent 单步超时及整体强退；30 秒时副本进程 0、所测端口关闭、EXE 可独占打开 | 证实强退路径执行；本轮没有复现强退后的资源残留，不能把源码风险写成这轮实测泄漏 |
| 退出时异常风暴注入 | 原实例 1250 ms，退出码 1 | 新实例 PID `45432` 及其 4 个子进程仍为 `JanusX.exe`；EXE 独占打开失败 | 真实 `triggerFatalRelaunch` 在退出中仍重启应用，命中安装器同名进程条件 |

异常风暴场景在退出回调中注入 21 次未处理拒绝，满足现有阈值；没有修改应用包文件。新进程创建时间晚于旧实例退出，属于重新启动，而非把旧 PID 误判为仍存活。本次未实际运行 NSIS 覆盖安装；实际用户实例仍在运行，全局映像名检查本来就会命中它，因此按副本路径单独归属证据，不把全局检测结果冒充隔离安装验证。

OfficeCLI 的 `create` 会产生独立 resident。首次夹具准备没有关闭该 resident，观察到一个父进程属于准备命令的 `officecli.exe`；它不属于应用创建的 watch。正式负载复测先执行 `officecli close` 收尾准备阶段，再启动应用预览，结果为零残留。实施时仍需分别管理 JanusX 发起的文档 resident 与 preview watch，不能把所有 Office 常驻进程混作一类。

本地证据在忽略目录 `artifacts/shutdown-analysis-20261112/`：`installed-results.json` 为四场景摘要，`sandbox-test.mjs`、`sandbox/fixture.cjs`、`sandbox/probe-loader.cjs` 为探针，各场景目录保存 `result.json`、`application.log`、截图和独立数据。正式四场景目录为 `idle-1794479665711`、`active-1794479951193`、`slow-cleanup-1794480158799`、`relaunch-1794480241614`。此前的探针动态导入／单条 CIM 结果形状错误及一次 Windows 进程核验命令失败保留原记录，不计为正式通过；后者在进程已消失时仍产生未确认停止错误，具体原因未确定。最终测试副本进程数为 0，真实安装主进程 PID `16812` 保持运行。

## 已确认的机制缺口

| 编号／优先级 | 机制与证据 | 后果及修复边界 |
| --- | --- | --- |
| EXIT-01 / P0 | `index.ts` 的 `triggerFatalRelaunch` 只检查 `app.isReady()`，没有退出状态门；上面的真实副本故障注入复现重启 | 退出意图必须优先于异常自动重启；普通运行期间的故障恢复仍应保留。它是当前与安装提示直接吻合的已复现路径，但用户历史现场原因仍待采样 |
| EXIT-02 / P0 | `AppShutdown` 串行执行，整体 15 秒，常规步骤 4 秒；安装包的 `flushSuperAgentRecords` 位于前部且允许 12 秒，终端、Office、Agent、项目停止位于后部 | 前面耗尽预算时，后面的停止甚至未被调用；`Promise.race` 不会取消未完成清理。必须先冻结入口并发起所有独立停止，再按依赖收尾，保留强制回收预算，不能只延长总等待 |
| EXIT-03 / P0 | `TerminalManager.kill` 和普通 `AgentStreamManager` 先杀直接进程、后 `taskkill /T`；普通路径还忽略 taskkill 非零码 | 父进程先消失后可能无法再按根 PID 找全树。独立 Windows 原生夹具中 taskkill 返回 128，后代及其 TCP 端口仍存活；测试后已清理。不能据此声称所有 PTY 必然泄漏 |
| EXIT-04 / P1 | 普通 `AgentStreamManager.killAll()` 返回 void，树杀进程未被等待；普通 Codex／OpenCode 的退出确认也弱于 managed Worker | 应统一为可等待、带实际退出结果的回收契约；“调用了 kill”不是“资源已释放” |
| EXIT-05 / P1 | 安装包 `SuperAgentWorkers.stopWork` 会在 `stopFailed` 后清空失败的 `entry.stopped` 再重试，而 `close()` 直接复用它 | 应用退出遇到此前停止失败的 Worker 时，不会重新尝试原生停止。抽取实际类方法的隔离探针得到原生重试次数 0、close 拒绝；修复应有限重试，保留未确认状态，不能直接释放目录 lease |
| EXIT-06 / P1 | `browser/terminal-service.ts`、`ipc/workspace-runtime-handlers.ts` 依赖 `will-quit` 释放；总退出终点是 `app.exit()` | 这些回调不会由当前终点触发。主进程退出仍会释放它自己的 socket，不能据此断言其端口永久泄漏；但本地 SSH／WSL 连接子进程与业务撤销没有完整等待保证 |
| EXIT-07 / P1 | `ProjectRunner.tryTreeKill` 在主线程同步 `spawnSync`，单次可等待 10 秒；POSIX 强杀计时又以 `.killed` 判断是否已经停止 | 同步阻塞会延迟 JS 全局退出计时器，多项目可累计超过名义 15 秒；`.killed` 只是信号发送状态，不能用于排除仍存活的进程 |
| EXIT-08 / P1 | 退出步骤主要写 console；现有启动日志未形成完整的退出资源清单。局部步骤失败后，整体未超时仍可能 `app.exit(0)` | 现场难以区分主实例未退、退出后重启、同名 MCP、其他安装实例和非同名文件占用。需要持久化退出阶段、创建身份、耗时和未确认项 |

[Electron 官方契约](https://www.electronjs.org/docs/latest/api/app#appexitexitcode)明确 `app.exit()` 不触发 `before-quit`／`will-quit`。[Node 子进程契约](https://nodejs.org/api/child_process.html#subprocesskilled)区分 `.killed` 与实际终止。以上事件和状态判断均与本地源码对照，不能只依赖命名或注释推断。

SuperAgent 已有值得保留的机制：Service 并行停止 Workers 与排空队列；Windows managed transport 捕获 PID 和创建时间、校验真实存活状态；失败时保留 `stopConfirmed=false`、processTree、hostDrained 和环境占用，允许明确重试。问题在于桌面总预算、普通执行路径和旧失败重试未统一，不能总结为“SuperAgent 没有清理”。该 transport 的原生查询本身有 6 秒命令上限，taskkill 有 5 秒上限，退出等待有 8 秒上限；整体预算须按真实重叠关系计算，并覆盖多 Worker 情况。

Office watch 已有 stopAll、等待退出、execa 强杀延迟与代理连接关闭，不应凭安装提示先认定 Office 是根因。远程工作区退出本地连接时，Linux daemon／PTY 按现有契约有意保留；清理改造不能擅自杀掉这些持续任务。

补充验证：对实际安装包和 dev `AppShutdown` 运行可控时钟探针，分别让前置 12+4 秒步骤／四个 4 秒步骤阻塞，均在 15000 ms 调用 app.exit，调用快照中尚无 `killTerminals`、`stopOfficeWatches`、`killAgents`、`stopProjects`。这证明调度遗漏，不等同于真实安装副本的残留结果。`probe.cjs` 共保留 5 项机制探针；现有 dev shutdown 单测 5/5、SuperAgent 工作树 shutdown＋managed recovery 单测 13/13 通过，它们未覆盖全部上述故障路径。

## 原实施计划与验收范围

按以下顺序落地；修复优先进入用户实际使用的 SuperAgent 交付链，共用部分后续回移 dev 时须同时对齐引擎版本，不能把新的引擎接口直接复制到旧依赖上。维护同一份资源归属契约，不建立两套逐渐分歧的 shutdown。

| 阶段 | 修改范围与交付物 | 验收条件 |
| --- | --- | --- |
| 1 / P0：固定退出意图并补诊断 | `index.ts`、`AppShutdown.ts`、startup diagnostics。在等待 renderer ACK 前锁定退出意图；阻止异常 relaunch、second-instance 等路径在退出中重新创建应用／窗口。按步骤记录耗时、超时、失败和剩余资源身份，不写 token 或用户提示正文 | 正常关闭、反复关闭、退出中 21 次异常都只执行一次退出；关闭 30 秒后无新主实例。保留正常运行时的崩溃恢复；退出日志能区分未退出与重启 |
| 2 / P0：重排停止阶段并统一进程确认 | 先禁止新任务／新进程与调度，再立即向所有独立资源发停止；按绝对截止时间并行等待、升级强制终止、最后保存完成证据。覆盖 terminal、普通 Agent、project runner、SuperAgent Worker。共享 PID＋创建时间／句柄归属，避免先杀父节点丢失后代；退出重试旧失败 Promise；移除主线程同步 taskkill | 任一前置步骤挂起都不阻止其他资源收到停止；后代、监听端口与延迟写入确实停止；拒绝访问或身份无法确认必须留下未确认记录；PID 复用不误杀；不以成功发信号或 taskkill 启动作为停止证明 |
| 3 / P1：服务与记录闭环 | 显式注册并等待 browser terminal host、workspace 本地连接、Hook、Companion、插件、Office watch／自有 resident、自动化、队列、watcher、编辑器和隐藏窗口。给在途启动、HTTP/RPC 和保存队列设置取消／排空边界；保留远程 daemon 的既有持续运行语义 | 清理不依赖被绕过的 will-quit；Office／本地服务端口关闭；等待审批、启动中、保存失败、停止失败再退出均有结果；记录未落盘或停止未确认时不误释放 worktree／容量；用户外部进程和远端持续任务不受影响 |
| 4 / P1：交付回归与 Mac 适配 | 增加上述真实安装副本场景及多 Worker／多终端、普通 Agent、Office resident、插件和 SSH／WSL 的测试；固定引擎包版本、重建并核对安装字节。Mac 复用公共阶段，按实际归属管理进程组，TERM→等待→KILL，并修正 `.killed` 判断 | Windows 同目录升级需在无真实用户实例的独立系统或专用账号环境执行，记录 NSIS 提示、残留 PID、文件替换和重启结果；正常与故障场景退出 30 秒均无非预期本地资源。Mac 分别验证关窗保活／Dock 重开及 Cmd+Q 完整退出，覆盖 arm64 与声明支持的 x64；当前未运行 Mac 验收 |

Windows 可评估 Job Object 作为进程归属的内核兜底，但须先核对 ConPTY、原生 CLI、已有 Job／权限和有意持续的进程，不把“使用 Job”当作无需验证的万能修复。Mac 只能对确实创建并拥有的进程组发送组信号，不推断任意 PID 都是合法 PGID。SuperAgent 桌面 Worker 当前仍有 Windows 能力门，进程回收改造本身不等于已经开放 Mac Worker。

实施后的最小验收矩阵包括：空闲、1／多 Worker、待批准／待回答、启动中、后台子进程、父进程先退出、旧 stop 失败后退出、单步挂起、异常风暴、Office watch 与 resident、多项目、重复退出、退出后立即升级以及退出后 30 秒检查。资源结果必须包含主／辅助／原生进程、端口、安装文件独占访问和持久记录；测试完成后确认夹具本身也已清理。
