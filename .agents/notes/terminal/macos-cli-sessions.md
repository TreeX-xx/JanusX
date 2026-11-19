---
{
  "schema": "harness-note/2",
  "id": "740aaee0-02b5-40e3-85ec-11088db634a1",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-11-14",
  "updated": "2026-11-18T16:38:31Z",
  "class": "architecture",
  "tags": ["macos", "cli", "sessions", "compatibility"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/5b300170-6b75-400d-998e-1d699dd7d591"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935"}
  ],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/system-install.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/unit/external-cli/system-install.test.ts","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/installer.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/login-environment.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/managed-install.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/package-location.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"scripts/probe-macos-cli-chain.mjs","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/e2e/desktop-cli-chain.spec.ts","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/managed-runtime.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/external-cli/service.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/ipc/terminal-handlers.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/terminal/extension-conversation.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/notifications/agent-engine-capabilities.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/sessions/external-session-scanner.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/sessions/transcript-reader.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/sessions/session-recovery.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/sessions/session-registry.ts","role":"implementation"}
  ]
}
---

# macOS 终端安装、启动与会话读取

## 结论与范围

CLI 检测、安装与启动的已确认源码缺口现已修复，并完成 Windows 真实链路和 Mac 两架构模拟；真实 Mac 仍未验收。会话定位与正文解析整体可以处理 POSIX 路径，但并未覆盖所有引擎、配置和续接入口。读取既有历史不需要启动 CLI，正文读出也不代表登录、原生续接和模型执行成功。

对象为 JanusX 0.9.9、HEAD `453e0872d12e1597a340c113d526c73940302d40` 的当前工作区，包含此前窗口修复及原有未提交改动。2026-11-14 先只读分析，随后按用户要求修复 CLI 链路；测试使用隔离文件和配置，不读取真实用户会话。跨平台资源、窗口与签名交付状态归[Mac 兼容性总览](../desktop/macos-compatibility.md)。

“终端安装”需要分开理解：内嵌终端由 node-pty 创建系统 Shell，不负责安装 Terminal.app、iTerm2 或 Zsh；终端管理里的安装动作安装 Claude、Codex、OpenCode、Pi、DSH 等 CLI。

后续[跨平台重构 P0—P5](../desktop/platform-runtime-boundaries.md)已经实施：local 旧数据兼容、路径比较、目标环境、普通进程、PTY 驱动和 CLI 链路形成共用入口。迁移后 261 项回归通过、1 网络项默认跳过；显式启用的官方私有运行时 5 项、Windows Electron 安装／检测／PTY／退出链路及 16 项 Mac 源码模拟通过。真实下载暴露的代理遗漏已复用应用下载服务修复；完整证据和初次失败保留在计划专题。真实 Mac、第三方账号及模型调用仍未测试。

P6 桌面回归还发现 Windows 多副本优先级问题：裸命令启动曾把所有候选交给原生入口排序，后续目录的 exe／全局包可能抢先于检测选中的 PATH 首个安装。现先按同一搜索顺序选定安装位置，再解析该位置的 shim／原生入口。五种 CLI 的回归在修复前 5 failed，修复后连同相关套件 195 passed、1 网络项 skipped；证据 `artifacts/platform-runtime/p6-cli-priority-before.json` 与 `p6-cli-priority-after.json`。此修改没有把同名命令的不同安装目录合并成一个身份。

最终 Windows 构建的安装／检测／PTY 交互／退出链路通过；会话套件三项通过，覆盖交接输入、失败不留空记录、外部历史增长、Claude／Codex／OpenCode 恢复和后续回合。删除 fixture 后误命中系统 Pi 的测试隔离缺口已修复，原断言保留。证据 `p6-desktop-final.log`、`p6-session-isolated.log`；均使用隔离 provider 夹具，不是真实账号和模型执行。Windows 目录包另在仓库外启动通过，完整工程检查仍有两项其他 UI 断言失败，见跨平台专题。

## 检测、安装与启动的当前实现

| 环节 | 已实现行为 | 验收边界 |
| --- | --- | --- |
| 执行环境 | Mac 在单实例锁之后、配置和会话模块初始化之前，以用户 SHELL 的登录交互模式读取 NUL 分隔环境；5 秒超时、1 MiB 输出上限，忽略初始化噪声。保留显式启动环境，合并登录 PATH；失败记诊断并保留已知目录兜底 | 启动时读取一次；修改 Shell 初始化配置后需重启 JanusX。Finder、Zsh/nvm 和代理组合尚未实机测试 |
| 命令定位：MAC-03 | detector 与 resolver 共用 search-paths，包含 /opt/homebrew/bin、用户 bin、npm-global、Bun/Cargo 等目录；Mac 子进程 PATH 补存在的已知目录，让脚本的 env node 找到解释器。POSIX 不缓存命中或缺失，重新检测也清除 Windows 缓存 | 优先继承 PATH，再查已知目录；不再自动注入 JanusX 私有目录。首个候选损坏会报告不可运行，不悄悄切换副本 |
| 安装目标与权限 | 本地新装使用当前系统 npm 的 global prefix，查询 prefix/root 并显式固定安装目标。已有 npm 命令须属于该 prefix；已确认的 Claude／OpenCode 原生安装及 Homebrew 安装按原来源更新 | 不再下载私有 Node 或创建私有 CLI 副本。缺少 npm 时提示安装 Node.js LTS；权限不足、不同 Node prefix 或来源未知时返回原因，不另建副本。Homebrew 不支持界面的 npm 精确版本选择，需使用 brew 更新 |
| 安装后核验 | 读取目标 prefix 内的 package.json，核对包身份、实际版本和命令文件；以该绝对路径 --version 比较回报版本，再确认默认解析仍指向同一目标。锁覆盖准备、安装和核验；OpenCode 切包遇到 npm 或核验失败时清理目标并尝试恢复旧包精确版本 | npm exit 0 和另一个旧副本可运行均不能作为成功。没有承诺所有工具安装均可事务回滚 |
| 旧私有运行时：MAC-09 | 原下载、校验与架构隔离辅助代码保留，但本地安装入口不再调用；现存目录不清理。用户显式配置的 PATH 仍被尊重 | SSH／WSL 用户 CLI 也已改用目标系统安装；仅文档后端保留独立内部运行时，见[工作区运行时](../sessions/workspace-runtime-import.md) |
| 启动与平台：MAC-04 | IPC 启动解析出的绝对命令，缺失返回修复指引；终端、后台登录和 Agent 子进程共享系统基础 PATH。PTY 归一化 Windows Path／PATH。Mac 本地 Claude 支持终端与对话双视图，后端校验会话身份 | 同一基础环境中的外部终端和 JanusX 复用同一安装；Shell 自行修改 PATH、切换 Node 版本或应用尚未重启时仍可能不同。Mac PTY、登录、协议和模型调用仍需实测 |
| 扩展包：MAC-14 | package-location 解析真实命令路径与 package.json 身份，兼容 Windows prefix/node_modules、POSIX prefix/lib/node_modules、链接和提升依赖。DSH 必需 dsh-llm 缺失时在创建桥之前报错；Pi 可选命令来源仍可降级 | POSIX 与提升依赖文件夹具通过，没有执行 Mac Pi/DSH 原生进程。目录约定见 [npm 文档](https://docs.npmjs.com/cli/v11/configuring-npm/folders/#node-modules) |
| DSH 完整安装 | npm 同装 dsh、dsh-tui 和 pnpm@10；读取 TUI 版本，调用 dsh plugin --profile dsh-tui add 包@精确版本，再核对 profile 版本和入口文件。仅 dsh 存在而 profile 不完整时报告待修复 | profile 安装会联网；依赖脚本、上游组合和已有复杂 profile 尚未真实安装验收。方式见 [dsh-TUI README](https://github.com/ccch1mneyyy/dsh-TUI#command-line-installation)，另核对 npm 0.20.0 启动器源码 |

系统 Shell 仍由用户条目配置，CLI 安装不安装 Terminal.app、iTerm2 或 Zsh。登录环境恢复让直接子进程继承同一基础环境，但各引擎的历史目录支持仍由下文说明。Claude CLI 的 Mac 分发与 JanusX 双形态能力是两层，见[官方安装说明](https://code.claude.com/docs/en/setup#install-with-npm)。Janus CLI 已退出通用安装 registry，未在本轮重新加入。

多位置列表尚未接入来源选择 UI；安装前核对命令归属，避免升级另一份安装。终端管理和首次安装弹层已移除私有副本提示。没有新增旧安装清理或系统配置重写。CLI 提高 Node 要求、包布局改变、WinGet 等未识别来源需要自动更新时，应扩充来源识别，而不是回退到私有副本。命令依据为 [npm prefix](https://docs.npmjs.com/cli/v11/commands/npm-prefix)、[Claude 安装与更新](https://code.claude.com/docs/en/setup)和 [OpenCode upgrade](https://opencode.ai/docs/cli/commands/)。

## macOS 本地 CLI 的系统代理

启动本地 CLI 时保留显式代理环境变量。缺少显式代理时，从 macOS 当前全局静态代理配置读取启用的 HTTP、HTTPS 地址、端口和可用 NO_PROXY 表示的例外。查询结果最多缓存一秒，新进程可以跟随代理端口变化或关闭；既有 CLI 需新开会话。PAC、SOCKS 专用配置和仅接口范围的代理不映射到 HTTP 变量。

2026-11-18 在 Apple Silicon 打包应用中用隔离配置启动真实 Claude Code 2.1.327。检查 PTY 子进程环境，确认 Clash Verge 的 HTTP、HTTPS 和例外列表生效。用相同代理设置访问 Anthropic 模型目录，无凭据请求返回 401。此项验证不包含账号登录和模型调用。

## macOS 的 npm 全局命令目录（2026-11-18）

从 Finder 启动时，登录 PATH 可能只包含指向 node 和 npm 的软链接。JanusX 在恢复登录环境后查询当前 npm 的全局前缀，将其 bin 目录追加到应用内的命令搜索路径。安装器验证前缀与包目录后也会刷新这个位置。已有 PATH 命令保留优先级；验证安装目标时，指向同一实际文件的软链接视为同一安装。

在 Apple Silicon Mac 的 0.9.9 打包应用中，通过桌面 IPC 将真实 Claude Code 2.1.327 安装到隔离的 npm 前缀，安装后与重启后的版本和路径一致。桌面 CLI 链路测试另用隔离的 Pi 夹具验证 PTY 启动、输入、输出和退出。

## 系统安装策略验证（2026-11-15）

外部 CLI 17 套件 154 项通过、1 项旧运行时网络测试默认跳过；随后补充同一 prefix 原地升级用例，system-install 套件 10 项通过。覆盖系统 prefix 新装、原地升级、损坏 shim 修复、不同 Node prefix 拒绝、未知来源拒绝、权限失败及两种 Homebrew 路径。安装进程在这些单测中为替身，不改真实全局安装。

Windows Electron 桌面测试 1 项通过：真实 npm 将本地夹具装到隔离的系统 prefix，外部 PowerShell 与 JanusX 检测、PTY 启动和交互均使用同一命令，退出后确认进程消失。终端管理／首次安装／启动状态浏览器回归 29 项通过，深浅主题窄屏截图检查通过。Mac 源码模拟 16 项通过，真实 Mac、实际第三方 CLI 下载与账号登录本轮未运行。构建、严格未使用项类型检查、目标源码 ESLint、双语键检查通过；Notes 检查为 0 错误和 17 项既有跨仓库链接诊断。构建与差异检查日志位于 `artifacts/system-cli/`。

## 历史私有安装策略验证（2026-11-14）

| 验证 | 实际结果 | 命令与证据 |
| --- | --- | --- |
| 回归 | 25 套件，237 passed、1 skipped，退出 0；跳过的网络测试在下一行独立开启并通过 | vitest run tests/unit/external-cli tests/unit/agent/cli-resolver.test.ts tests/unit/agent/stream-manager.test.ts tests/unit/terminal-launch.test.ts tests/unit/terminal-launch-program.test.ts tests/unit/terminal-officecli-path.test.ts tests/unit/llm/native-login.test.ts tests/unit/llm/native-login-runner.test.ts tests/unit/cli-readiness.test.ts tests/unit/shell-profile-launch.test.ts --maxWorkers=2；artifacts/cli-chain/unit-tests.json |
| 官方运行时与 npm | 5 passed，退出 0；从残缺目录下载官方 Windows Node、校验并替换，真实私有 npm 安装本地包，检测／解析同一副本，重复准备复用；另有坏哈希保留旧内容的用例 | JANUS_TEST_RUNTIME_DOWNLOAD=1 后运行 managed-runtime.test.ts；artifacts/cli-chain/runtime-integration.json，约 181 秒，没有改系统 prefix |
| 桌面链路 | 1 passed，退出 0；真实 npm 安装隔离 pi 命令夹具，构建后的 Electron 经 preload 检测，IPC 解析／PTY 启动该副本、收发标记，kill 后确认进程不存在，复检路径不变 | JANUSX_CLI_TEST_ENTRY=artifacts/build-check/main/index.js 后运行 desktop-cli-chain.spec.ts，配置 playwright.desktop.config.ts；artifacts/cli-chain/electron-final.json。脚本夹具不代表真实 Pi 模型和扩展握手验收 |
| Mac 两架构模拟 | 16 passed、0 failed，退出 0；真实 TS 模块、POSIX 路径和隔离文件覆盖 Homebrew、登录环境、架构目录、缓存、安装目标／版本、Pi/DSH 布局和 profile 核验 | node scripts/probe-macos-cli-chain.mjs；artifacts/cli-chain/mac-simulation/report.json，记录 9 个源码 SHA-256。npm／CLI 执行与 Darwin process 是替身 |
| 设置／安装界面 | 三个文件的 29 项最终通过，退出 0；首轮 28 passed／1 failed，因旧测试仍期待包含已退休 Janus 的 6 行。修正为实际 5 行后，external-cli-settings 全部 16 项通过，另两文件的 13 项此前已通过 | Playwright --project=island：local-cli-setup.spec.ts、external-cli-settings.spec.ts、terminal-startup.spec.ts；artifacts/cli-chain/browser.json、browser-retry.json。包含安装／升级／失败重试与窄屏两主题布局，使用 API 夹具 |
| 集成与静态 | typecheck、build:check、修改范围 ESLint 通过；E2E 文件按仓库配置默认不在 ESLint 范围 | artifacts/cli-chain/typecheck.log、build.log、lint.log；构建位于 artifacts/build-check |

完整 Mac 总探针为 45 passed、1 failed、2 blocked、0 error、5 not-run，仍退出 1：失败为最低系统版本未声明，阻断为 managed Worker 平台门。结果归[总览](../desktop/macos-compatibility.md)，不能用上述绿色结果覆盖。

**真实 Mac 未测试（not-run）**：Finder/Dock 登录环境恢复、arm64/x64 Node Mach-O、真实 npm 下载／postinstall、五种第三方 CLI 全新安装／升级与 DSH profile 联网初始化、原生 PTY／中文交互／退出、Claude TUI 与其他引擎协议握手、账户登录和模型执行、Rosetta 切换、TCC 权限、签名安装包。Windows 测试不能替代这些交付前验收项。


## 会话文件定位、读取和续接

目录定位统一从传入 home 或 os.homedir()、app.getPath('userData') 及 app 环境变量计算，没有把全部会话存储固定在 C 盘。以下是当前程序实际读取的布局，不是承诺自动兼容任意上游版本或任意自定义目录。

| 类型 | 当前默认位置／格式 | Mac 读取与续接边界 |
| --- | --- | --- |
| JanusX 自身会话账本 | `<userData>/janusx/agent-sessions.json`；布局另存 shell-restore.json | 随 Electron userData 选取平台目录；序列化、原子写、加载均无 Windows 分支。Mac 风格 Library/Application Support 路径的保存／重新加载夹具通过；冷启动恢复布局不等于恢复 AI 原生对话 |
| Claude | `~/.claude/projects/**/*.jsonl`；遵循 CLAUDE_CONFIG_DIR | 递归发现、流式正文读取、精确 ID 恢复前置检查通过 Mac 路径夹具；目录来自记录 cwd／原生字段，不要求 Windows 盘符。新建本地双视图会话与读取既有 JSONL 各自校验 |
| Codex | `~/.codex/sessions/**/*.jsonl`；遵循 CODEX_HOME | 恢复以 `resume <id>` 续接并定位历史所属 CODEX_HOME。共享历史位置已使本机会话发现与用量采集同时扫描 sessions 和 archived_sessions；已知 ID 的前置检查也支持归档。真实 Mac 续接仍待验证 |
| OpenCode | `~/.local/share/opencode/opencode.db`；遵循 XDG_DATA_HOME、OPENCODE_DB | 用内置 node:sqlite 只读查询 session/message/part；没有依赖 Windows sqlite.exe。POSIX 路径、现有支持 schema 的查询与精确 ID 检查通过宿主 SQLite 夹具。真实 Mac 内置 SQLite、活跃库锁/WAL 和实际 v1/v2 schema 仍需验证 |
| Pi | 默认 `~/.pi/agent/sessions/**/*.jsonl`；遵循自定义 agent 根、session 环境、settings 和启动参数 | 带 session header cwd 的正常文件和自定义目录夹具通过，详见 MAC-15。外部记录有 `--session <file>` 参数映射，但不在 Claude/Codex/OpenCode 共用的 native preflight 集合，不能宣称内部 Continue 全覆盖 |
| Janus CLI | 已知记录路径，或 `~/.janus/history/<id>.jsonl` | reader 实际要求文件是带 messages 数组的完整 JSON 文档；此 legacy 格式在 Mac 风格路径下可解析，但不参与外部自动发现，也无同引擎原生恢复映射。当前 CLI 保存／删除历史的其他限制归[引擎能力专题](../sessions/records/session-engine-capabilities.md) |
| DSH | capability 的 sessionStore/transcript 均为 null | 会话管理尚无外部发现与正文 driver，reader 返回 null。这是现有产品缺口，Windows 也没有；双形态运行时投影与持久历史发现不能混为一项 |

Claude 的自定义目录包含历史，见[官方配置说明](https://code.claude.com/docs/en/settings)；OpenCode 数据库和 OPENCODE_DB 见[官方诊断文档](https://opencode.ai/docs/troubleshooting/#service-files)。变量须进入 JanusX 才会被使用；Mac 启动现会尝试恢复登录环境，失败时仍可能只看到默认存储。Pi 启动与发现已共用配置优先级，能力边界与实测范围见 MAC-15。

详情 IPC 按账本 sessionId 找到已记录路径，再调用 reader，不由前端自由指定文件。读取使用标准 Node 文件流／UTF-8／JSON 或 SQLite，和能否启动提供方 CLI 相互独立。恢复仍会检查 cwd、历史身份、活动数据库并重新进入终端启动链，因此可能出现“能读历史，但不能继续”的合理分层故障。

## 目录、筛选与迁移的剩余边界

| 编号／优先级 | 已确认的事实 | 影响与处理方向 |
| --- | --- | --- |
| MAC-15／已修复源码 | P4 共用 provider-paths，按 Pi 0.85.1 源码核对参数 > 环境 > 项目 settings > 全局 settings；支持自定义 agent 根和 session 目录 | 隔离项目配置→启动参数→扫描→配置变化后保留原 store 的链路通过。缺失 cwd 的 POSIX legacy 目录仍不猜测反解；真实 Pi/Mac 历史未测 |
| MAC-16／已修复源码 | 注册表 scope、excerpt 和知识正文共用路径身份，保留 POSIX 大小写／Unicode；冲突记录保留且禁止含糊续接 | 两个大小写不同项目隔离的夹具通过，原始路径不变；真实大小写敏感 APFS 未测试 |
| 已知发现范围 | 共享来源包含本机 Codex 原生归档目录；会话列表仍每引擎最多取 200 个最新候选 | 用量扫描与会话列表共用来源，但数量上限不同；未出现在列表不等于未计入用量。已知原路径的详情与原生恢复另行判断 |
| 环境来源 | P4—P5 已把 CLI 启动、会话发现、用量统计和本仓配置消费者接入共用 provider-paths；自定义 Pi store 由项目上下文和记录保留 | 外部 engine／提供方内部读取仍由其自身实现；真实提供方与 Mac 环境组合尚未验收，不能由夹具通过推导所有外部版本同步支持 |
| 跨系统迁移 | 账本保留原绝对 cwd、转录路径、Shell 和提供方配置来源 | 复制 Windows 的账本到 Mac 并不会把 C:/... 自动映射为 /Users/...。JSON 能加载不等于原项目和转录可恢复；需要显式迁移／重新发现策略，不能自动猜测同名目录 |

MAC-03、MAC-04 的入口降级、MAC-09、MAC-14、MAC-15 和 MAC-16 已有源码修复。P4 的 195 项回归通过、2 项原有用例跳过，含 Windows 活动 SQLite/WAL 原位只读验证；详细证据见[运行时计划](../desktop/platform-runtime-boundaries.md)。后续[共享历史位置](./requirements/usage-telemetry-single-source.md#历史数据位置)已补入本机 Codex 归档发现；managed Worker 平台门保持独立范围。

## 修复前分析证据（保留）

以下为 CLI 修改之前的分析快照，不能作为当前失败计数。2026-11-14，15 个现有套件 **143 passed、1 skipped**，Vitest JSON success=true、退出 0。范围包括 CLI detector/installer/managed-runtime/resolver、shell-profile-launch、engine-capabilities、external-session-scanner/sync、transcript-reader/kernel/excerpt、opencode-sessions、session-recovery、session-continue-resume、session-store。当时跳过了需显式开启的官方 Node 下载／真实 npm 测试；本轮已开启并通过，见前表。

另在真实源码 VM 中注入 darwin/arm64 与 darwin/x64、POSIX path，把 `/Users/Mac 中文/...` 文件操作映射到隔离 Windows 临时目录，得到 **26 passed、10 gap、0 error**，进程退出 0。10 条 gap 为五类边界各两架构：Homebrew 检测／启动分歧、Pi 自定义目录、Pi/DSH 扩展包布局、大小写 scope、Codex 归档发现范围。gap 表示已观察并记录的缺口或范围限制，退出 0 仅表示分析探针自身完成，没有宣称产品全通过。

通过项包括四引擎默认发现和中文正文、配置目录覆盖、Claude/Codex/OpenCode 精确恢复前置检查、JanusX userData 账本保存／重载、Mac npm 命令构造和 Janus legacy JSON 读取。JSONL 流与 SQLite 查询实际运行于宿主文件夹具；npm 执行使用替身，SQLite 是 Windows 宿主内置驱动，不是 Mac SQLite 实机证据。扩展包路径只执行从真实 AST 提取的表达式，没有运行 DSH／Pi 原生进程。

本地证据在 `artifacts/macos-cli-sessions/`：`unit.json`／`unit.log`、`unit-command.txt`，以及可重跑的 `probe.mjs`、`probe.json`／`probe.log`。探针记录读取源码的 SHA-256，不随 Git 提交；首次扩展 AST 遍历漏判零参数调用的工具错误已修正，保留于 `probe-attempt1.*`，不计为产品故障。

仓库固定 harness-note/2 校验 347 篇 Note，0 错误，17 条既有外部链接诊断；本篇及新增模块入口引用均可解析。没有可用共享 wiki reader，本次通过仓库原始 Note 和限定源码搜索完成核对。

**Mac 实机均为 not-run**：真实 npm 安装／postinstall、私有 Node Mach-O 执行、PTY helper 权限和交互、Finder/Zsh/nvm 环境、CLI 登录／模型调用、提供方真实历史与活跃 SQLite/WAL、账户和精确版本原生恢复、大小写敏感 APFS、TCC 对桌面／文档等项目目录的授权、Windows→Mac 历史迁移、签名安装包。环境、能力提示、POSIX 扩展定位、历史目录和路径身份的源码迁移已完成；下一步需要目标系统的完整链路证据，具体未测矩阵由跨平台计划和 Mac 总览维护。
