---
{
  "schema": "harness-note/2",
  "id": "e7fb1e04-d742-4255-a3d2-86d5376ad439",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-29",
  "updated": "2026-10-30T02:20:12.913Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# Hook 单次启动接入与配置隔离

## Problem

旧安装器会重写 Claude/Codex 原生用户级配置，Windows 发送器散落在 home；OpenCode 新旧插件接口和共享服务还会造成加载失败或多终端归属错误。Hook 同时驱动遥测刷新与未启用的习惯采集，扩大了读写触发面。需要收回接入位置与职责，同时保留原生用户 Hook、登录、历史及审批能力。

P3 将 JanusX Hook 接入限定到本次启动链，保留原生身份、登录和历史；上下文／用量完全独立于 Hook。P5 已提供用户主动触发的旧接入清理，边界与增量验收见下节。普通启动、预热和恢复仍只准备 userData 资产，不自动修改原生配置。

## Decision

所有 JanusX 自有发送器、Windows runner 与源码、附加 JSON、Pi 扩展及 OpenCode 插件默认放在当前有效 profile 的 userData/janusx/hooks。新建、预热及恢复共用同一 manager；不按终端复制资产。准备按 P1 workspaceIo 串行，同引擎并发共享一次准备；稳定内容比较后才原子写入。应用内后续启动跳过已成功准备的资产。正常投递和缺少 Bridge 环境不写发送端诊断，错误仍可记录。端口、token、terminal/workspace ID 经子进程环境传递，保持命令稳定；这不限制外部 CLI 自己的原生读写。

| 引擎 | 本次启动入口 | 保留与限制 |
| --- | --- | --- |
| Claude | --settings 指向自有 additional-settings.json | 不关闭用户／项目 settings 来源，不修改原生 settings |
| Codex | --no-daemon 与 -c hooks=<inline TOML> | 原生加载器保留用户 hooks.json、config.toml 和会话参数的独立来源及信任；未审阅时不执行。验证版本为 0.165.0，其他版本未验收 |
| Pi | --extension 指向自有脚本 | 保留用户扩展自动发现，不改用户 settings |
| OpenCode 2 | OPENCODE_CONFIG_CONTENT.plugins 添加自有目录，--standalone 使用独立服务 | default definition 的 id/setup 与 api.event.subscribe 接口；每个服务继承所属终端环境，避免复用共享服务串线 |
| OpenCode 1 | OPENCODE_CONFIG_CONTENT.plugin 添加自有 v1.js 文件 URL | 保留旧式事件插件，不传新版 --standalone；真实通过版本 1.2.27，1.19.5 初始化超时未通过 |
| Janus / DSH | Janus 延续原生环境入口；DSH 无可安装 Hook | 本次不增加 DSH Hook 契约 |

Codex 和 OpenCode 探测实际解析到的二进制版本；相同路径、mtime、大小共享探测，文件变化后重新识别。Codex 仅对 0.x 且 minor >=165 启用当前参数，其他版本降级，真实验收仅覆盖 0.165.0。OpenCode 保留原生 config dir 和对应 inline 配置字段，未知大版本或探测失败记录 setup 诊断后裸启动，不向旧 CLI 传新版参数。Hook 准备失败不阻止终端本身启动／历史恢复。尚未主动清理的旧全局 Hook 仍可能与新注入同时触发；生命周期层对重复开始和结束去重，清理入口不保证未知接入也被移除。

### P5 旧接入主动清理

“设置 → 通用 → 数据管理 → 旧 Hook 接入”提供一个清理按钮，执行前说明范围，并要求先退出旧版 JanusX、关闭本应用终端／运行任务及外部 CLI。打开设置不扫描 home；没有启动自动清理、周期轮询、保留期或新增阈值。点击确认后，仅核对默认 `.claude/settings.json`、`.codex/hooks.json` 及当前 CLAUDE_CONFIG_DIR／CODEX_HOME 对应文件，不扫描整盘或未知自定义 home。位置由主进程决定，renderer 不能提交任意删除路径。IPC 仅允许应用窗口。

只移除明确标记为 JanusX、匹配旧发送器调用且没有附加用户动作的 command 条目；名称提及、标记前缀相似、自定义复合命令、未知结构均保留。混合条目中的用户 Hook 和其他字段保留，JSONC 定点编辑保留 BOM、注释及未涉及的配置文本。因本次删除而变空、且仅含 hooks／matcher 的标准分组和事件会移除，用户原有空数组及带未知字段的分组保留，避免残留空分组影响原生 Hook 加载。损坏 JSON 和重复键保留并报告。原生配置采用临时文件、权限继承、落盘和原子替换；提交前重新核对原件，检测到用户并发保存则保留新内容并报告可重试失败。Codex config.toml、原生信任、凭据和会话不进入清理清单。这是 P5 显式清除旧注册的例外，不恢复 P3 的全局安装写入。

home/.janusx/hooks 中的旧 PowerShell 发送脚本及 runner C# 源码只按已核实旧版本的 SHA-256 白名单清除，换行差异归一；修改过或未知内容保留。exe 的文件名不能证明二进制归属，因此旧 runner 可执行文件保留供明确核查，界面列出完整路径和原因；未知目录、其他文件和旧诊断日志不递归遍历。原生 Hook 清理失败或仍有疑似旧引用时，发送器保留。当前 userData 中的插件、扩展、发送器、server.js 与 v1.js 保持；旧 OpenCode opencode.json 仅在同目录所有权 marker 和 schema-only 内容均吻合时清除，已修改配置保留。没有删除真实用户 home 的操作。

操作复用 workspaceIo 后台队列、分批让出与既有常量；同一进程的并发请求共享执行。活动终端或运行任务阻止执行；清理期间本地终端在进入创建和实际 spawn 前复核门控，覆盖已在途的创建。结果直接显示删除数量、文件路径、保留原因，失败重试重新核对原件，没有额外调度器或回执数据库。其他进程不受本进程门控，必须遵循执行前的退出提示。

当前仓库 `.janusX/blueprints`、`design`、`shots` 三个残留目录均不存在，本轮未执行实际删除。electron-builder 及包边界检查同时排除 `.janusX` 和 `.janusx` 整棵目录，防止大小写不同的旧数据进入安装包。旧安装器不再用于新建、预热或历史恢复；清理后再准备资产的测试确认全局条目不会被重新写入。

### P5 验收与限制

定向执行 `npx vitest run` 加 `tests/unit/` 下的 `retire-legacy-hooks`、`terminal-ipc-contract`、`agent-hook-config`、`workspace-storage-ipc`、`workspace-storage-preload`、`workspace-storage-ui`、`package-boundary` 七个 `.test.ts` 文件，最终 94 项通过、2 项平台用例跳过。覆盖真实临时目录中的混合 Hook、BOM／注释、重复键、损坏配置、单引号／中文路径、默认及配置 home、并发用户保存、写入／删除故障与重试、旧发送器内容归属、用户配置和现用资产保留、运行任务阻止、创建门控、IPC 授权及不回写旧注册。Windows 目录 junction 拒绝已实测；普通文件软链接和 POSIX 0600 权限测试在 Windows 跳过，不能据此声称 Linux／macOS 已验收。读取与写入复用 P1 的分块 I/O，不新增速率或重试参数。

`$env:JANUSX_TEST_REAL_CLIS='1'; npx vitest run tests/unit/agent-hook-cli.test.ts --maxWorkers=1 -t 'Claude|Codex'` 最终两项通过，Pi／OpenCode 因本次选择范围未运行。隔离临时 home 和 localhost 模型中先种入旧全局条目并清理，再执行真实 Claude／Codex；用户 Hook 继续执行，当前注入仍向 Bridge 投递，移除注入后不再投递。Codex 保留 config.toml 原内容，并经原生 TUI 主动审阅保存夹具信任。初次 Codex 验证在残留空分组时缺少文件来源用户 Hook，移除本次清理产生的空标准分组后，单独及联合复验均通过；此问题已增加定向回归。

Chromium 覆盖取消、确认、失败重试、逐项保留原因、键盘交互、明暗主题和 480px 布局；主 Agent 已检查 `artifacts/workspace-storage/legacy-hooks-480.png`。源码定向 ESLint、严格 unused 类型检查、i18n、包边界、打包排除检查及 build:check 通过。主 Agent 自审完成，未委派独立审查。没有清理真实用户 home，也没有做真实安装包升级、跨进程并发编辑或长期慢盘验收；这些仍归 P6。无法确认的旧二进制、自定义复合命令与未枚举 home 不自动清除。

### Codex 原生信任例外

2026-10-29 用户明确允许：用户在 Codex 原生界面主动审阅后，由 Codex 将信任记录保存到 CODEX_HOME/config.toml。JanusX 只生成 userData 中的定义，经启动参数交给原生加载器；不写原生配置、不自行计算／伪造 trusted_hash、不传 bypass 信任参数。未找到受支持的独立 userData 信任存储入口，因此不搬运或合并审阅状态。命令变化或 CLI 升级可能要求重新审阅，应由原生规则决定。

### 非统计生命周期与采集

引擎名称在 agent-hook-lifecycle 中规范化为五类语义：会话更新、回合开始、等待用户（审批／输入）、回合结束（成功／失败／中断）、会话关闭。Coordinator 先同步确认边界，再分发到状态、通知、审批、历史／文件变化及可选采集。显式失效 terminal ID、引擎不符、冲突会话、较早时间戳均拒绝；无显式 ID 的兼容回退必须满足给出的工作区和 cwd，歧义不猜。等待后恢复沿用同一回合，不新建边界；重复结束和 Stop 后 SessionEnd 不产生虚假历史。历史先记录结束边界，再将异步摘录附回原回合，避免下一次输入串入。

没有原生 turn ID、或到达时才生成时间戳的事件，无法绝对识别跨回合的延迟重复；不增加猜测超时／多层阈值。renderer 沿用现有状态事件和快照恢复能力，没有另建事件平台。

个人习惯采集仅在 persona && inferEngineeringHabits 生效后接入。入口在复制采集载荷及查询 transcript 前门控；recorder 再在入队、执行、恢复、补读、持久化与结果调度前复核。关闭后清定时器和活动回合、提升 generation，丢弃排队及在途旧结果；设置保存等待已获准写入完成。已经开始的系统调用不能回滚，关闭不会删除此前数据；重新开启可处理此前合法持久化的恢复任务。细节由[分域控制](../knowledge/memory-domain-controls.md#习惯采集接入边界已明确待收敛)拥有。

### 遥测独立性

[纯后台解耦决策](usage-telemetry-hook-decoupling.md#当前实现与纯后台边界的差距)是固定边界。onResolvedPayload 不再绑定、读取、刷新或延迟调度遥测，规范化事件也不调用这些入口。coordinator 仅接受 independently correlated 来源；旧 Hook 和缺失来源的持久绑定忽略，等待独立归属。全语料扫描、游标、记账模式锁、上下文轮询及 PTY 活跃度保留。同一原生会话同时被多个终端候选认领时全部保持未知，避免先遍历者获得所有权。状态／历史仍可使用 Hook 的 sessionId，不能将它重新回灌统计。

## Alternatives considered

继续写用户全局配置改动较少，但 JanusX 外启动 CLI 也会加载发送器，且升级／预热会回写。每终端私有原生 home 可隔离服务，却分裂登录和历史，增加 Codex 审阅负担。本次使用附加配置／扩展与必要的独立服务，不迁移原生 home。

自行保存／迁移信任哈希或全局 bypass 可绕过原生交互，但会依赖未公开身份规则并改变用户信任边界，已拒绝。通用总线、多层速率阈值和新扫描器没有必要；复用现有 Bridge、状态消费者及 P1 队列。

## Verification

维护回归：tests/unit/agent-hook-cli.test.ts 配合 tests/helpers/hook-cli-fixture.ts，在独立临时 home、包含空格／单引号／中文的路径和 localhost 模型下贯通正式生成资产、真实 CLI、发送器、Bridge 与 Coordinator，不复制账号凭据。设置 JANUSX_TEST_REAL_CLIS=1 后运行；各 CLI 路径可用 JANUSX_TEST_<ENGINE>_BIN 指定。默认跳过不计通过。测试夹具关闭自动更新和默认网络插件，生产不传这些禁用选项。

Claude 2.1.312 四类生命周期投递及移除参数后脱离；Pi 0.85.1 启动扩展投递且用户自动发现扩展继续执行；Codex 0.165.0 未信任负对照零投递，隔离真实 TUI 审阅后收到开始／结束，用户原生文件及 inline 两种 Hook 来源继续执行，去掉注入后只有用户 Hook 执行；OpenCode 2.1.4 及 1.2.27 双终端身份、开始／结束和去掉注入后脱离均有真实 CLI 通过记录。Codex 原生 TUI 测试仅对可销毁夹具主动信任，不是产品自动审阅行为。OpenCode 1.19.5 在新 home 初始化阶段三次 45 秒超时、尚未开始投递，保留为未通过版本，不能由 1.2.27 的结果外推。

定向 29 文件、322 项测试通过；后补版本门控、用户配置保留与中断续接用例单独通过，累计 326 项。覆盖 Hook、独立扫描／归属／账本、开关四组合、运行中关闭、持久恢复门控、审批、生命周期、历史摘录竞态和终端启动。Windows 真实 Shell 测试逐事件执行 Claude/Codex 的 runner 与 fallback，共 26 次 Bridge 投递；这证明 Shell 发送边界，不等于每个提供方真实审批／中断全覆盖。严格 unused 类型检查、源码定向 ESLint、build:check 与 Note 结构检查通过，既有 17 条跨仓链接诊断保留。

真实 CLI 全套四项有通过记录；OpenCode 1.2.27／2.1.4 补充双终端并发，先初始化原生 DB／provider 缓存。重负载并行构建时曾出现 OpenCode 2.1.4 的原生 standalone server 未就绪退出，单独复验通过；该外部启动竞态仍是限制，不能宣称任意并发启动稳定。Claude print 进程可能先于 SessionEnd 发送器退出，测试保留 Bridge 并等待实际事件，不把进程退出当作事件缺失。Electron 隔离验收通过一项：Claude、Codex、OpenCode 新建与两种原生历史恢复、续接回合；使用 CLI fixture 和真实 preload/IPC/PTY，不能替代真实提供方的恢复验收。Windows .cmd 恢复测试发现内联 TOML 双引号截断参数，已改用 TOML literal 字符串并通过真实 Codex 与 Electron 复验。

复验命令为 `JANUSX_TEST_REAL_CLIS=1 npx vitest run tests/unit/agent-hook-cli.test.ts --maxWorkers=1`，以及 `JANUSX_DESKTOP_ENTRY=artifacts/build-check/main/index.js npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-session-continue.spec.ts -g "restore native history"`；Windows PowerShell 用 `$env:` 设置前述环境变量。主 Agent 对高风险启动引用、会话串线、旧绑定和停用竞态进行了自检，发现的问题已修复；没有独立审阅者，不宣称独立审阅 PASS。

真实 CLI 成功回合和应用内故障／中断回归不等于四 CLI 全交互 TUI、真实账号登录、每种审批、跨平台打包或长期多实例验收。这些场景及 OpenCode 1.19.5 是明确限制；P6 再做长期与跨环境验证，不以 mock 冒充真实 CLI。原探索 artifacts/hook-launch-review 被忽略且可清理，正式可重复测试才是维护入口。

## P6 真实 CLI 与恢复复验

2026-10-30 在 Windows 隔离临时 home、localhost 模型上设置 `JANUSX_TEST_REAL_CLIS=1`，运行 `npx vitest run tests/unit/agent-hook-cli.test.ts --maxWorkers=1`，四项均通过、没有按默认跳过计数。实测版本为 Claude 2.1.312、Codex 0.165.0、Pi 0.85.1、OpenCode 2.1.4。覆盖旧全局条目主动清理后用户 Hook 保留、Codex 原生主动审阅、单次注入及移除后脱离、Pi 用户扩展保留、OpenCode 双终端独立服务与会话归属；本机报告为 `artifacts/workspace-storage/p6-real-cli.json`。本轮未复测 OpenCode 1.x，既有 1.19.5 未通过边界不变。

新构建上运行 `tests/e2e/desktop-session-continue.spec.ts -g "restore native history"` 一项通过，覆盖三引擎新建、恢复和后续回合；使用真实 Electron 与本地 CLI fixture，不声称真实提供方历史恢复通过。真实 WSL／SSH 的断线用例单独开启后通过，保持原 PTY PID 并读回断线期间输出；远程 fixture 不携带真实凭据，也不意味着远程数据迁移或远程各引擎 Hook 已验收。完整原生审批／中断、跨平台和长期多实例仍归[总计划剩余出口](../planning/workspace-data-lifecycle-plan.md#p6-本机代表验收与剩余出口)，生产接入与阈值没有变化。

## Consequences

运行中的旧终端不被切换；需在更新后的应用中新建／恢复终端加载新入口。P4 回收不能删除仍被活动终端引用的 sender／插件；P5 删除旧全局条目时必须保留用户内容及旧运行实例需要的资源。未来原生参数、事件或信任契约变化时按相同隔离集成测试复核，未知版本应保持终端可用并报告 Hook 降级。
