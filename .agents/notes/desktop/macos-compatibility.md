---
{
  "schema": "harness-note/2",
  "id": "5b300170-6b75-400d-998e-1d699dd7d591",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-11-12",
  "updated": "2026-11-18T08:48:15Z",
  "class": "architecture",
  "tags": ["macos", "compatibility", "distribution"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8bda71ec-1f76-4d89-aabc-f193b2579438"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/02b7c101-50c6-5501-a4be-262dd867ba7c"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8d37d89b-3921-4b59-abcb-572c6cc0185c"}
  ],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/index.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/windows/register-window-ipc.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/janus-runner/cli-resolver.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/terminal/claude-conversation.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"scripts/probe-macos-compatibility.mjs","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/unit/window-ipc-lifecycle.test.ts","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"tests/e2e/desktop-window-reopen.spec.ts","role":"test"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"electron-builder.yml","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"scripts/check-macos-resources.mjs","role":"test"}
  ]
}
---

# macOS 部署兼容性与机制冲突

## 范围与当前结论

JanusX 已有 Electron、POSIX 子进程、平台数据目录及 macOS 窗口生命周期分支，但尚不能作为经过完整验证的 macOS 发行版交付。OfficeCLI 资源适配仅解决依赖定位、资产准备和身份校验这一层，不能推出终端、窗口恢复、签名、公证和升级链均可用。

2026-11-15 的[跨平台运行时重构](./platform-runtime-boundaries.md)已完成 P0—P5，并执行 P6/P7 可在 Windows 完成的检查。平台判断集中到运行时、进程／PTY、路径及能力边界；CLI 检测／安装／启动与会话目录共用策略。最新总探针为 **46 passed、0 failed、2 blocked、0 error、5 not-run**，退出码仍为 1；两个 blocked 为两架构的 managed Worker 已知限制。五项真实 Mac 验收保持 not-run，不能把模拟通过理解为产品完整支持 Mac。

最新证据：`artifacts/platform-runtime/p6-macos-source.json`（真实源码 + 系统替身）、`artifacts/cli-chain/mac-simulation/report.json`（16 passed）、`artifacts/platform-runtime/p7-macos-resources.json`（两架构 Mach-O／部署目标／哈希静态核对）。以下早期日期章节保留为历史证据，当前状态以本段、问题表与跨平台专题的 P6/P7 验收记录为准。

初次审查于 2026-11-12 在 Windows 主机进行，基线为 `5b142293507d7133f06a645655537e07beaf0f07`。2026-11-14 核对 JanusX `0.9.9`、HEAD `453e0872d12e1597a340c113d526c73940302d40` 的工作区，保留已有改动。按用户要求先修复窗口 MAC-01／02，再修 CLI 链路 MAC-03、MAC-04 入口降级、MAC-09 和 MAC-14；宿主与模拟验收通过。managed Worker 能力门仍保留，没有启动 Mac 应用、执行 Mach-O 或构建 Mac 安装包。

[OfficeCLI 内置决策](./officecli-bundled.md)维护已完成的 arm64/x64 路径、平台哈希、执行权限准备、签名排除及 Windows-hosted 验证证据。[发布解耦设计](./release-delivery-design.md)维护通用构建与发布阶段；本文拥有 Mac 兼容性问题、复现边界和建议实施顺序。

[终端安装、启动与会话读取专项](../terminal/macos-cli-sessions.md)维护五类 CLI 的环境、固定私有安装目标、安装后核验、运行时恢复、DSH profile 与 POSIX 包定位，以及最新回归、真实 npm／Electron PTY 和两架构模拟证据。默认历史可处理 POSIX 路径，Pi 自定义目录和大小写 scope 的已确认源码缺口已在 P4 修复；真实提供方数据和 APFS 仍待测试，读取、启动和原生续接分别验收。

架构和分阶段证据见[跨平台运行时边界](./platform-runtime-boundaries.md)：根据 Orca 固定源码分析，把环境、命令执行、PTY 与路径身份收口，并用导入门禁防止业务分支继续扩散。P0—P5 已实施，P6/P7 的可用宿主验证与原生未测项分别记录，不据此扩大 Mac 支持声明。

## CLI 修复后的总体验证（2026-11-14）

完整探针现为 **45 passed、1 failed、2 blocked、0 error、5 not-run**，退出 1 保留。命令为 `node scripts/probe-macos-compatibility.mjs`，日志在 `artifacts/cli-chain/compatibility.log`，报告在 `artifacts/macos-compatibility/source-probes.json`。相较窗口修复后的 39 passed、7 failed，Homebrew 解析、Claude 入口能力与 tools 架构目录共六条失败已通过；剩余失败是 MAC-11 最低系统版本，阻断是 managed Worker 平台门。另有专项 Mac 模拟、Windows 真实安装与 PTY 验收，细节归上述专题。

当前 CLI 修复状态是源码和宿主／模拟测试通过；真实 Finder 环境、五类 CLI 的 Mac 安装／postinstall、Mach-O、原生 PTY、账号和模型调用仍为 **not-run**。Claude 默认走 TUI，只解决新建入口被双形态平台门拒绝的问题，未开放 Mac Claude 双形态或 managed Worker。

## 窗口恢复修复与验收（2026-11-14）

MAC-01／02 已实施源码修复。窗口 IPC 在 bootstrap 装配 `EditorWindowManager` 后注册一次，处理器继续通过 getter 读取当前主窗口；每次重建仍调用原有 `registerApplicationIpc` 更新业务窗口引用。Dock activate 与 second-instance 共用 `showMainWindow`：主窗口缺失／销毁时在 app ready 后创建，存在时恢复最小化、显示隐藏窗口并聚焦，不再依据所有窗口的数量推断主窗口是否存在。退出意图建立后不创建或恢复窗口。

| 验收 | 实际结果 | 命令／证据 |
| --- | --- | --- |
| Mac arm64/x64 窗口模拟 | 18 项通过；每架构含 10 次关闭重开与 IPC 定向、隐藏辅助窗口、隐藏／最小化主窗、重复启动、ready 前及退出中激活 | `node scripts/probe-macos-compatibility.mjs artifacts/macos-window-fix/after.json`。完整探针 39 passed、7 failed、2 blocked、0 error、5 not-run，退出 1 保留；剩余失败为 Homebrew、Claude 能力、工具架构目录及最低系统版本，阻断为 Worker，均不属于本轮窗口修复 |
| 窗口与退出回归 | 21 项通过，进程退出 0 | `node node_modules/vitest/vitest.mjs run tests/unit/window-ipc-lifecycle.test.ts tests/unit/editor-viewed-ipc.test.ts tests/unit/editor-routing.test.ts tests/unit/editor-window-manager.test.ts tests/unit/app-shutdown.test.ts --maxWorkers=2`；`artifacts/macos-window-fix/unit.json` |
| 真实 Electron 重开 | 1 项桌面 E2E 通过，进程退出 0：隐藏辅助窗口保留时连续重开 3 次，查询和切换最大化并观察真实标题栏状态，最小化后 activate 恢复、隐藏后 second-instance 显示；4 个编辑器事件通道监听始终各 1 个 | 新增[桌面用例](../../../tests/e2e/desktop-window-reopen.spec.ts)已进入 desktop suite。本轮设置 `JANUSX_WINDOW_TEST_ENTRY=artifacts/build-check/main/index.js`，执行 `node node_modules/@playwright/test/cli.js test tests/e2e/desktop-window-reopen.spec.ts --config=playwright.desktop.config.ts`；报告 `artifacts/macos-window-fix/electron.json`，截图在 `electron-results-attempt2` |
| 静态与构建 | typecheck、build:check、`eslint src/main/index.ts` 均通过，进程退出 0 | `artifacts/macos-window-fix/typecheck.log`、`build.log`、`eslint.log`；独立构建目录仍为 `artifacts/build-check` |

Electron 测试在独立 Windows profile 中临时拦截该测试进程的 `app.quit`，保留原生平台并手动触发 activate，以覆盖 Mac 风格的关窗保活；退出前恢复并清理。它没有更改真实用户实例，也没有把 process.platform 改为 Mac。首次桌面探针未等待旧窗口 closed 就激活，且按尚未完成导航的 URL 筛选新页面，导致等待超时；改为等待真实 closed 并排空辅助窗口创建事件后通过，首次失败证据保留在 `electron-attempt1.*`。

状态为“源码已修复、Windows Electron 与 Mac 边界模拟通过”；真实 Mac 的红色关窗、Dock 点击、原生焦点／全屏行为和签名安装包重开仍为 **not-run**。本轮不修改 CLI 环境、Claude／Worker 支持或自动更新。

## 修复前链路验证（2026-11-14，Windows 主机）

本轮覆盖开发前置检查、构建、窗口生命周期、CLI 检测与解析、终端输入输出、Hook、Office 资源与预览、Worker 平台门和退出。证据由源码模拟、宿主文件检查、Windows 实际运行分段组成，尚未形成真实 Mac 端到端通过结论。VM 只运行选定的真实模块或 AST 边界，Electron 窗口／IPC、文件系统、PATH、进程信号和 PTY 均使用显式替身；不会加载宿主原生模块来冒充 Mac 执行。

| 验证层 | 本轮实际结果 | 边界与本地证据 |
| --- | --- | --- |
| 可重复 Mac 源码探针 | 23 passed、13 failed、2 blocked、0 error、5 not-run；退出码 1 | `node scripts/probe-macos-compatibility.mjs`，报告在 `artifacts/macos-compatibility/source-probes.json`。包含 arm64/x64 两组，13 条失败对应六类检查各两条及最低系统版本缺项，不是 13 个独立故障。脚本保留非零结果，不能用全绿回归套件覆盖它 |
| CLI／Office／Hook／退出／Worker 回归 | 419 passed、6 skipped；JSON `success=true` | `vitest.json`、`vitest.log`；45 文件。涵盖检测安装、私有运行时、Office、Shell、Hook、退出、Worker 临时 Git 与协议夹具；真正的 native Worker 条件测试没有运行 |
| 启动与 Hook Shell 专项 | 44 passed、4 skipped；JSON `success=true` | `launch-tests.json`、`launch-tests.log`；7 文件。包括 terminal-launch、terminal-launch-program、terminal-officecli-path、agent-hook-shell、agent-hook-cli、codex-startup、claude-startup。实际 Windows PowerShell／Git Bash Hook 事件回传通过，需显式原生 CLI 环境的测试跳过 |
| 开发与构建 | `check-dev-environment`、`build:check`、`typecheck` 通过 | `build.log`、`typecheck.log`；构建输出 `artifacts/build-check`。未改写正在使用的 `.cache`，也未生成发行安装包 |
| Windows 真实模块启动 | module-graph 与 llm-runtime 均退出 0 | `host-runtime.json`；直接启动本轮构建入口，使用独立 HOME／配置／知识目录。LLM smoke 只加载适配器，不调用真实模型 |
| Windows 真实桌面与负载退出 | 窗口／preload、工作区创建、真实 PTY 输入输出、真实 DOCX 预览 HTTP 200、`app.quit()` 退出码 0；随后所测 PTY 进程不存在、预览端口关闭 | `host-runtime.json`、`host-desktop.png` 及其独立 profile 的 `logs/shutdown.log`。退出日志约 6.6 秒完成；通过 preload API 驱动业务，截图显示首次入门弹层，不作为所有界面按钮操作的验收。属于 Windows 开发构建，未做安装器升级或 Mac Cmd+Q |
| POSIX Hook 命令实际回传 | Claude、Codex 两个 UTF-8 事件通过，中文、会话 ID、terminalId 和 matcher 一致 | `host-hook-node.json`。实际 macOS 命令生成函数 → Windows Git Bash → 转译后的真实 Node Hook client → 真实鉴权 HTTP Bridge；路径含空格、单引号和中文。不是 Mac Electron 可执行文件验收 |
| 实际 Mac 资源与打包边界 | arm64/x64 OfficeCLI 下载、固定 SHA-256、Mach-O CPU、beforePack 目标、运行时路径／哈希和签名排除规则一致；node-pty 两套 `pty.node`／`spawn-helper` 的 Mach-O CPU 检查通过 | `source-probes.json`、`officecli-*.log`。arm64 首次下载超时，重试成功；Windows chmod 调用通过不能证明 POSIX 执行权限。未执行这些 Mac 二进制，也未重签名或构建整包 |

两组 Vitest 合计 463 passed、10 skipped。PowerShell 的 `*>` 包装因故障注入测试写 stderr 而报告退出码 1，两个 Vitest JSON 均明确为 success=true、零失败；包装退出码与用例结果分别保留，未将该命令记录为干净的进程退出 0。

汇总在 `artifacts/macos-compatibility/summary.json`；结束时重算探针记录的 25 个源码／资源哈希，均未变化。`check-agent-notes` 校验 346 篇 harness Note，0 错误，17 条既有外部引用诊断保留于 `notes-check.log`；相关专题的新增脚本链接与 codeRef 已通过当前仓库固定格式校验。

诊断脚本绑定每个实际读取的源码和原生文件 SHA-256，可在修复后重跑；入口见[探针源码](../../../scripts/probe-macos-compatibility.mjs)。CLI→PTY 通过项使用检测到的绝对路径，不能证明裸命令启动的 MAC-03 已修复；更新守卫通过项仅确认 Mac 被明确禁用更新。未运行的 Worker 启动、登录、模型执行及下游审批／取消不能由夹具测试替代。

宿主探针准备阶段的错误保留：CJS 启动器异步 import 应用错过 Electron privileged scheme 注册时机，已改用正常入口，失败文件为 `host-runtime-attempt1.*`；Bridge 替身的 default import 错误已修正。macOS 风格 Hook 命令直接调用 Windows Electron 时虽然到达 Bridge，却未保留 stdin 会话字段，记录为 `host-hook-electron.*` 的宿主边界失败；后续 Node 路径成功只验证通用命令／UTF-8／HTTP 链，不能据此判定 Mac Electron stdin 成功或失败。所有记录位于本地 `artifacts/macos-compatibility/`，不随 Git 提交；未使用真实用户配置或终止用户实例。

真实 Mac 验收统一为 **not-run**：Finder 环境恢复与 nvm/Homebrew 组合、Dock 和原生窗口行为；Mach-O 加载与 PTY helper 权限；CLI 登录／真实模型／Worker 审批和恢复；Office 创建编辑及预览刷新；Cmd+Q 的后代进程与端口回收；最低系统版本、原生 Intel／Rosetta、签名公证、Gatekeeper、DMG/ZIP 安装和版本升级。取得 Mac 环境后必须重新执行这些项目。

## 已确认的问题

| 编号 / 优先级 | 触发场景与影响 | 代码原因与证据 | 建议处理；当前状态 |
| --- | --- | --- | --- |
| MAC-01 / 高 | 修复前关闭再重建主窗口会重复注册 IPC handler | 原因是注册放在 `createWindow()` 内；现在移到应用 bootstrap 一次性注册，getter 跟随当前窗口 | 源码已修复；10 次重开模拟、真实 Electron 3 次重开及监听／按钮回归通过，Mac 实机 not-run |
| MAC-02 / 高 | 修复前隐藏辅助窗口阻止 Dock 重开，最小化／隐藏主窗口也不恢复 | 原因是 activate 只判断全部窗口数；现在和 second-instance 共用按主窗口引用恢复的 `showMainWindow`，保留 ready／退出状态门 | 源码已修复；隐藏辅助窗口、最小化、隐藏、重复启动和退出边界通过，真实 Mac Dock／焦点 not-run |
| MAC-03 / 高，源码已修 | 检测和启动共用已知目录与基础环境，包含 Homebrew；POSIX 不缓存命令路径 | 启动尝试有超时的登录环境恢复，Mac 子进程 PATH 补已存在目录；新建终端启动解析出的绝对命令 | 两架构 Homebrew 解析模拟和 Windows 私有 CLI 桌面链路通过；真实 Finder/nvm 尚未验证 |
| MAC-04 / 高，入口已降级 | Mac 新建 Claude 默认走普通 TUI，平台能力判断不再自动开启 Windows 专属双形态 | 前端 supportsConversation 传入平台，后端同样校验；ClaudeConversation 的原平台门保留 | Mac 入口降级回归通过；Claude 双形态桥、登录／信任流程和真实 TUI 仍待 Mac 验收 |
| MAC-05 / 中 | Mac 版即使成功安装，也不能沿用当前应用内自动更新 | [更新守卫](../../../src/main/updater/guards.ts)对非 Windows 返回 `non-windows-p0`，主动禁用更新 | 补 Mac 更新能力、附件和渠道验证；属于现有产品边界，未实施 |
| MAC-06 / 中 | 生成 Mac 包后，没有等价的包运行及发布验收入口 | [verify](../../../.github/workflows/verify.yml)与 [release-win](../../../.github/workflows/release-win.yml)使用 Windows runner；[包运行检查](../../../scripts/check-packaged-runtime.mjs)硬编码 `win-unpacked`、`JanusX.exe`、`7za.exe`；[发布脚本](../../../scripts/publish-win.mjs)面向 Windows 附件。`package:mac` 已有本地产包入口，不等于 Mac 验收流程已完成 | 在 Mac 上增加实际安装包检查与按需构建入口，复用通用输入规则；未实施 |
| MAC-13 / 高 | 受管 Worker 的平台能力按架构和引擎开放 | Apple Silicon 的 Codex 0.169.0 和 Claude Code 2.1.327 已实测会话、MCP 报告、审批、续接和进程组收尾。 | Apple Silicon 上通过 LaunchServices 启动本地 .app，验证无插件历史读取。Intel 两种驱动与生产签名发行包待验收。平台结果与复验命令见[迁移计划](../agent/superagent-plugin-migration.md)。 |
| MAC-14 / 高，源码已修 | Pi/DSH 扩展定位解析真实命令和包身份，兼容 POSIX 全局布局、链接与提升依赖 | DSH 必需组件缺失时在创建桥前报错；安装补齐 TUI、pnpm 与精确版本 profile 核验 | 两架构文件夹具通过；DSH/Pi Mac 原生扩展握手与联网初始化未验证，详见专项 |
| MAC-15 / 中，源码已修 | Pi 自定义会话目录与启动同源 | provider-paths 统一参数、环境、项目与全局 settings 优先级；扫描已注册工作区及历史保存的 store，配置错误有诊断 | P4 目录／启动／历史夹具通过；真实 Mac Pi 与自定义目录未运行 |
| MAC-16 / 中，源码已修 | POSIX 路径不再无条件转小写 | 路径身份区分 Windows 与 POSIX，比较 key 不改写实际读写路径；冲突会话单独保留并禁止歧义继续 | 大小写、Unicode、旧记录及冲突夹具通过；大小写敏感 APFS 实机未运行 |

### GUI 启动环境与默认 Shell

Finder/Dock 不应假设继承终端初始化后的 PATH。[登录环境入口](../../../src/main/external-cli/login-environment.ts)现于单实例锁之后、模块初始化之前执行用户 SHELL 的登录交互命令，读取 NUL 环境，限制 5 秒和 1 MiB；保留显式环境并合并 PATH，失败留下诊断。私有运行时和 Mac 已知 CLI 目录继续只注入子进程。Mac 新配置的 Shell 种子已改为 `/bin/zsh`，保留用户既有条目；环境恢复与选择默认 Shell 是不同职责。[VS Code FAQ](https://code.visualstudio.com/Docs/supporting/faq)说明了 GUI 与 Shell 环境差异。

MAC-03 的目录冲突已修复；nvm、不同初始化文件和 Finder 组合尚未实测。登录环境只在启动时读取，修改 rc 配置后需重启 JanusX；没有承诺热重载 Shell 配置或所有引擎历史 driver 都支持相同自定义目录。

## 待目标系统验证的风险

| 编号 / 优先级 | 已确认的结构事实 | 风险、验证与处理边界 |
| --- | --- | --- |
| MAC-07 / 高，交付前验证 | 本机安装的 `node-pty 1.1.0` 带有 `darwin-arm64`、`darwin-x64` 的 `pty.node` 和 `spawn-helper`，Unix 源码使用 `NODE_API_MODULE`；[打包配置](../../../electron-builder.yml)已解包 node-pty，但 `npmRebuild: false` 与 [beforeBuild](../../../scripts/electron-before-pack.cjs)跳过构建器依赖重建并复制现有依赖树 | 不能断言 node-pty 不支持 Mac，或一定要重新编译。需验证最终包的目标架构、native module 可加载性、`spawn-helper` 执行权限、实际解包路径及签名后 PTY 启动。不同平台或架构的工作目录不能视为等价依赖来源；当前未做 Mac 验证 |
| MAC-08 / 高，公开分发前验证 | OfficeCLI 的重新签名会改变 Broker 固定校验的字节，现有 Mac `signIgnore` 已仅排除对应内置二进制；应用使用 electron-builder 25，签名／公证依赖构建机身份与凭据 | OfficeCLI 的上游签名不能代替整个 JanusX.app、Electron Helper、原生模块的签名和公证。需要检查签名后的 Office 哈希、整包签名、公证及下载后 Gatekeeper 启动；产出 DMG 不构成通过证据。也不能仅因仓库没有自定义 entitlements 文件就断言必然失败，构建器有默认处理；当前未验证 |
| MAC-09 / 中，源码已修 | [私有目录](../../../src/main/external-cli/managed-paths.ts)现将 Mac npm 工具分为 tools-darwin-arm64／tools-darwin-x64；旧 tools 保留但不自动使用 | 两架构路径模拟通过；切换架构需独立准备 CLI，真实 Rosetta、原生依赖安装与磁盘清理策略仍待验收 |
| MAC-10 / 中 | 当前[公共清理](../../../src/main/shutdown/process-tree.ts)已校验 PGID 后对自有组 TERM／等待／KILL，终端与普通 Agent／项目共用；两架构的正常停止、升级强杀、保护非自有组和权限错误上报模拟通过 | 不再记录为完全没有 POSIX 组回收。模拟的 `ps`、信号和存活状态均为替身；父节点先消失、脱离组的后代、PID 复用及 Mac 实际权限尚未覆盖，需要关闭终端、删除工作区和 Cmd+Q 实机验证 |
| MAC-11 / 中，配置已修 | `minimumSystemVersion: '15.0'`；按当前 OfficeCLI/.NET 支持范围选定发行门槛，两架构一致 | 官方支持边界与 Mach-O 技术部署目标不同；15.0 是当前保守发行策略，最低版本真机启动、后续系统兼容及正式包均未验收 |

[Node-API 官方文档](https://nodejs.org/api/n-api.html)解释其 ABI 稳定性；这不替代 MAC-07 的架构、系统库和完整安装包验证。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)与 [Developer ID 说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)是 MAC-08 的发行依据。[.NET 10 支持矩阵](https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md)是 MAC-11 的参考，支持列表随上游维护变化，应在声明最低系统版本时重新核对。

MAC-11 于 2026-11-15 重新核对：[Electron 35.7.5](https://github.com/electron/electron/blob/v35.7.5/README.md#platform-support)列 macOS Big Sur 起；[私有 Node 24.22.2](https://github.com/nodejs/node/blob/v24.22.2/BUILDING.md#platform-list)两架构要求 13.5；当日读取的 .NET 10 支持表（Last Updated 2026/09/28）列 15、26、27，最小值为 15。Windows 实际文件检查得到 node-pty arm64 的部署目标 11.0、x64 的 10.7，OfficeCLI 两架构均为 12.0；这些头部值不证明完整依赖在对应旧系统可用。因此配置选定 15.0，而非由 Mach-O 数值推断支持旧系统。

`scripts/check-macos-resources.mjs` 校验 CPU、完整 load-command 边界、macOS 部署目标、声明的最低版本及 asar 解包。`officecli-before-pack.cjs` 在原 SHA 校验后调用检查，并对 OfficeCLI 与 node-pty spawn-helper 设置执行位；Windows chmod 不能代替实际 POSIX 权限验收。4 项校验器正反例与原 Office 资源 8 项测试通过。手动 `runtime-platform.yml` 使用 macos-15（arm64）和 macos-15-intel（x64），标签核对自 [GitHub runner 文档](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)；工作流未触发，未签名目录包也不构成公证／Gatekeeper／升级验收。

### 窗口交互完善

MAC-12 / 低：红黄绿按钮已按平台调整位置与顺序，但 [WindowControls](../../../src/renderer/src/components/WindowControls.tsx) 的绿色按钮仍调用普通 `maximize/unmaximize`，没有接入 Mac 原生全屏语义。该限制已由[窗口控制决策](./window-controls.md)记录；应在运行正确性和交付验证之后处理，不能将已有 Mac 外观当原生窗口行为验收。

## 隔离模拟证据

以下为 2026-11-12 已执行的源码级模拟，运行平台是 Windows。探针用 TypeScript `transpileModule` 转换当前文件，再用 Node `vm` 注入所需系统边界；没有修改运行时源码、全局系统环境或安装工具。这些探针在会话内执行，未作为持久化测试脚本提交。

| 检查 | 输入与边界 | 实际结果 |
| --- | --- | --- |
| MAC-03 路径分歧 | 模拟 `darwin/arm64`，PATH 为 `/usr/bin:/bin`，私有工具目录为空；POSIX 文件系统替身只允许 `/opt/homebrew/bin/claude` 存在，`which` 返回未找到；分别执行 `CliDetector.findCandidate()` 和 `resolveCLIPath('claude')` | 检测结果为 `/opt/homebrew/bin/claude`，启动解析为 `null` |
| MAC-01 重复注册 | 执行真实 `registerWindowIpc` 函数；IPC 替身记录 channel，重复 `handle` 按 Electron 契约抛错；连续调用两次 | 第二次抛出 `Duplicate IPC handler: getMaximized` |
| MAC-02 Dock 恢复 | 从 `src/main/index.ts` 的 AST 提取真实 `activate` 回调；主窗口缺失，分别令全部窗口数为 0 和 1，后者表示尚存的隐藏窗口 | 全部窗口为 0 时调用 `createWindow` 一次；隐藏窗口为 1 时调用零次 |

其他确认项来自源码与配置阅读，不标记为实机复现。Mac 构建、Mach-O 执行、POSIX 权限生效、Office 预览、安装升级及 Gatekeeper 验证均为 `not-run`。前一轮 OfficeCLI 的 123 项 Windows-hosted 测试与实际资源下载超时由其[原 Note](./officecli-bundled.md)维护，不挪作本次 Mac 全功能通过证据。

## 建议实施顺序与验收

| 阶段 | 修改范围 | 需要取得的证据 |
| --- | --- | --- |
| 一：修复确定冲突 | MAC-01／02 窗口生命周期，MAC-03 统一 CLI 解析，MAC-04 平台能力判断及 Claude 双模式适配／明确降级 | 同一应用进程多次关闭重开不重复注册；隐藏通知或编辑窗口不阻止主窗口恢复；GUI PATH 缺 Homebrew 时检测与实际启动一致；Mac 不暴露必然失败的双模式入口 |
| 二：统一执行环境 | 默认 Shell 与登录环境、CLI／项目／Agent 子进程环境、工具架构隔离、进程回收 | Homebrew 与 nvm 等代表环境下探测、登录、运行一致；切换原生与 Rosetta 不误用工具；停止后应用拥有的后台进程与端口确实释放 |
| 三：建立目标系统验收 | 优先 arm64，再验证 Intel；确定最低系统版本并使用目标平台依赖 | 从 Finder 启动、关闭重开、CLI 登录／执行／取消、Hook 回传、Office 创建／编辑／预览刷新、node-pty 交互及退出均有实际安装包证据。原生 arm64、原生 Intel x64 与 Apple Silicon 上 Rosetta x64 的结果分别记录 |
| 四：完成公开分发 | 整包签名、公证、安装、Mac 更新附件、自动更新和按需 runner | 下载的 DMG／ZIP 通过签名与 Gatekeeper 检查，Office 哈希仍匹配；更新从已安装版本成功升级，失败能恢复；实际验收所声明的平台和架构，不因某个目标失败静默缩小范围 |

Mac 自动更新需签名应用及 ZIP 更新产物，并配套 `latest-mac.yml` 等对应渠道元数据，不能只上传 DMG。[electron-builder 官方更新文档](https://www.electron.build/docs/features/auto-update/)说明了这两个条件；实现时应同时对照仓库固定的 builder/updater 版本，不能把新版本文档特性直接假定为当前版本已有。

## 未决项

MAC-10 的跨平台回收机制及 Windows／SuperAgent 对照已扩展到[退出与资源回收](./application-shutdown.md)。该专题包含实际 Windows 安装副本测试、退出期间重启的故障注入复现、公共清理预算问题及实施顺序；Mac 进程组回收和 Cmd+Q 实机证据仍未取得。Mac 关闭最后一个窗口后的正常保活与真正退出后的非预期残留需分别验收。

当前发行配置最低 macOS 为 15.0，资源按 arm64/x64 分包；两种架构均未获得真实 Mac 验收。窗口、CLI 环境、目录与能力入口的源码修复已落地；Claude 双形态与 managed Worker 的 Mac 驱动、可用 Mac／签名身份、正式更新渠道和安装升级证据仍未完成。后续按问题编号维护本篇状态，并将验证结果落到对应功能的 owning Note。
