---
{
  "schema": "harness-note/2",
  "id": "5b300170-6b75-400d-998e-1d699dd7d591",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-11-12",
  "updated": "2026-11-12T10:46:05Z",
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
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"electron-builder.yml","role":"implementation"}
  ]
}
---

# macOS 部署兼容性与机制冲突

## 范围与当前结论

JanusX 已有 Electron、POSIX 子进程、平台数据目录及 macOS 窗口生命周期分支，但尚不能作为经过完整验证的 macOS 发行版交付。OfficeCLI 资源适配仅解决依赖定位、资产准备和身份校验这一层，不能推出终端、窗口恢复、签名、公证和升级链均可用。

本次审查于 2026-11-12 在 Windows 主机进行，应用基线为 `5b142293507d7133f06a645655537e07beaf0f07`。范围包括当前源码、已安装依赖、构建发布配置及上游官方资料；用 Node 的 TypeScript 转译和 VM 隔离执行复现了三个逻辑边界。没有启动 Mac 应用、执行 Mach-O 二进制或构建 Mac 安装包。本文记录问题和建议，未实施下列修复，不作为完成验收的 Task。

[OfficeCLI 内置决策](./officecli-bundled.md)维护已完成的 arm64/x64 路径、平台哈希、执行权限准备、签名排除及 Windows-hosted 验证证据。[发布解耦设计](./release-delivery-design.md)维护通用构建与发布阶段；本文拥有 Mac 兼容性问题、复现边界和建议实施顺序。

## 已确认的问题

| 编号 / 优先级 | 触发场景与影响 | 代码原因与证据 | 建议处理；当前状态 |
| --- | --- | --- | --- |
| MAC-01 / 高 | 关闭主窗口后保留 Mac 进程，再重建主窗口时抛出重复 IPC handler 错误，恢复流程中断 | [启动入口](../../../src/main/index.ts)每次 `createWindow()` 都调用 [registerWindowIpc](../../../src/main/windows/register-window-ipc.ts)，后者直接执行 `ipcMain.handle`，没有幂等守卫。连续调用两次已在隔离执行中复现。`registerApplicationIpc` 有守卫，不能因此推定窗口 IPC 也安全 | 应用级 handler 只注册一次，窗口引用与监听按生命周期更新；未修复 |
| MAC-02 / 高 | 显示过通知后关闭主窗口，点击 Dock 可能没有主界面；独立编辑窗口存在时也有同类条件 | `app.on('activate')` 只在 `BrowserWindow.getAllWindows().length === 0` 时创建主窗口；[通知窗口](../../../src/main/notifications/desktop-toast-window.ts)超时后只 `hide()`，仍计入窗口集合。主窗口为空、隐藏窗口数量为 1 时已模拟复现不创建主窗口 | 直接检查主窗口引用，分别创建、显示、恢复最小化或聚焦；未修复 |
| MAC-03 / 高 | 设置页能检测到 Homebrew 安装的 CLI，从终端预设启动却找不到命令 | [检测器](../../../src/main/external-cli/cli-detector.ts)的已知目录包含 `/opt/homebrew/bin`；[启动解析器](../../../src/main/janus-runner/cli-resolver.ts)的 `COMMON_PATHS` 不包含，且缓存查找失败。模拟 GUI PATH 不含 Homebrew 时，检测成功而启动解析返回 `null`；回退裸命令仍依赖同一 PATH | 统一检测、安装、启动的目录和执行环境解析；明确环境改变后的缓存失效；未修复 |
| MAC-04 / 高 | 开启 Claude 终端／对话双模式后无法启动 | [ClaudeConversation.launch](../../../src/main/terminal/claude-conversation.ts)明确在 `process.platform !== 'win32'` 时抛错；[supportsConversation](../../../src/shared/conversation-display.ts)只判断引擎，没有平台维度 | 适配桥接、Hook、登录与信任流程；完成前按平台禁用入口并解释原因。此限制指 Claude 双模式，不能扩大为所有 Claude 普通终端都不支持；未修复 |
| MAC-05 / 中 | Mac 版即使成功安装，也不能沿用当前应用内自动更新 | [更新守卫](../../../src/main/updater/guards.ts)对非 Windows 返回 `non-windows-p0`，主动禁用更新 | 补 Mac 更新能力、附件和渠道验证；属于现有产品边界，未实施 |
| MAC-06 / 中 | 生成 Mac 包后，没有等价的包运行及发布验收入口 | [verify](../../../.github/workflows/verify.yml)与 [release-win](../../../.github/workflows/release-win.yml)使用 Windows runner；[包运行检查](../../../scripts/check-packaged-runtime.mjs)硬编码 `win-unpacked`、`JanusX.exe`、`7za.exe`；[发布脚本](../../../scripts/publish-win.mjs)面向 Windows 附件。`package:mac` 已有本地产包入口，不等于 Mac 验收流程已完成 | 在 Mac 上增加实际安装包检查与按需构建入口，复用通用输入规则；未实施 |

### GUI 启动环境与默认 Shell

Finder/Dock 启动不应假设继承用户终端初始化后的 PATH。当前 [Shell 种子](../../../src/shared/shellProfiles.ts)对非 Windows 默认使用没有登录参数的 `bash`，[终端进程](../../../src/main/terminal/manager.ts)主要继承应用环境；未发现统一恢复用户登录 Shell 环境的入口。用户在 Zsh、Homebrew 或 nvm 中配置的工具可能在系统终端可用，却在 JanusX 的直接子进程中缺失。[VS Code 官方 FAQ](https://code.visualstudio.com/Docs/supporting/faq)也说明了 GUI 启动与 Shell 环境的差异。

MAC-03 已复现两套目录规则的冲突；nvm、不同 Shell 初始化文件、实际 Finder 启动的组合尚未实测。建议 Shell、CLI、项目任务和 Agent 工具共享明确的执行环境策略，避免只补一个 Homebrew 路径后宣称所有环境问题已解决。恢复 Shell 环境需有超时和失败提示，不能无限等待用户初始化脚本。

## 待目标系统验证的风险

| 编号 / 优先级 | 已确认的结构事实 | 风险、验证与处理边界 |
| --- | --- | --- |
| MAC-07 / 高，交付前验证 | 本机安装的 `node-pty 1.1.0` 带有 `darwin-arm64`、`darwin-x64` 的 `pty.node` 和 `spawn-helper`，Unix 源码使用 `NODE_API_MODULE`；[打包配置](../../../electron-builder.yml)已解包 node-pty，但 `npmRebuild: false` 与 [beforeBuild](../../../scripts/electron-before-pack.cjs)跳过构建器依赖重建并复制现有依赖树 | 不能断言 node-pty 不支持 Mac，或一定要重新编译。需验证最终包的目标架构、native module 可加载性、`spawn-helper` 执行权限、实际解包路径及签名后 PTY 启动。不同平台或架构的工作目录不能视为等价依赖来源；当前未做 Mac 验证 |
| MAC-08 / 高，公开分发前验证 | OfficeCLI 的重新签名会改变 Broker 固定校验的字节，现有 Mac `signIgnore` 已仅排除对应内置二进制；应用使用 electron-builder 25，签名／公证依赖构建机身份与凭据 | OfficeCLI 的上游签名不能代替整个 JanusX.app、Electron Helper、原生模块的签名和公证。需要检查签名后的 Office 哈希、整包签名、公证及下载后 Gatekeeper 启动；产出 DMG 不构成通过证据。也不能仅因仓库没有自定义 entitlements 文件就断言必然失败，构建器有默认处理；当前未验证 |
| MAC-09 / 中 | [私有运行时目录](../../../src/main/external-cli/managed-paths.ts)包含平台、架构，但 npm 工具前缀统一为 `cli-runtime/tools` | 同一用户在 Apple Silicon 上切换原生 arm64 与 Rosetta x64 应用时，可能继续使用另一架构安装的 CLI 或原生依赖。按架构隔离工具安装，或在切换时检测与修复；此为目录设计推导的风险，尚未复现实机故障 |
| MAC-10 / 中 | [终端整树清理](../../../src/main/terminal/manager.ts)的兜底仅对 Windows 执行 `taskkill /T`；[Codex 清理](../../../src/main/terminal/codex-conversation.ts)的非 Windows 分支只终止直接子进程并等待；node-pty Unix kill 默认向直接 PTY 进程发 SIGHUP | 普通前台任务可能正常退出，但忽略挂断、后台或自行脱离的后代可能残留并占用端口。针对应用拥有的进程组设计 TERM／等待／KILL 回收，不能杀用户其他同名进程；需要在 Mac 关闭终端、删除工作区和退出应用时验证 |
| MAC-11 / 中 | 应用声明 Electron 35；固定 OfficeCLI `1.0.135` 的[上游项目](https://github.com/iOfficeAI/OfficeCLI/blob/v1.0.135/src/officecli/officecli.csproj)使用 `net10.0`、`SelfContained=true`；当前 Mac 配置没有明确的 `minimumSystemVersion` | 用户无需另装 .NET，但自包含不消除运行时的 OS 约束。最低 macOS 版本应覆盖 Electron、OfficeCLI 和 native 依赖的共同范围；不能用 Electron 的门槛代替 Office 引擎支持声明。需核对实际二进制与目标系统，不把上游“官方支持”边界直接等同于旧系统必然无法启动；最低版本尚未确定 |

[Node-API 官方文档](https://nodejs.org/api/n-api.html)解释其 ABI 稳定性；这不替代 MAC-07 的架构、系统库和完整安装包验证。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)与 [Developer ID 说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)是 MAC-08 的发行依据。[.NET 10 支持矩阵](https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md)是 MAC-11 的参考，支持列表随上游维护变化，应在声明最低系统版本时重新核对。

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

尚需确定最低 macOS 版本、首批公开支持的架构、可用 Mac／签名身份、Claude 双模式的首发支持策略，以及正式更新渠道。目前只完成调查与记录，上述修复和 Mac 发布均未执行。后续修复应按问题编号维护本篇状态，并将完成证据落到对应功能的 owning Note，避免将风险清单长期保留成过期结论。
