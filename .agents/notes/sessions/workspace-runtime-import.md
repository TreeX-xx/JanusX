---
{
  "schema": "harness-note/2",
  "id": "c247d96c-7810-4fdf-9f73-d1893d423701",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-24",
  "updated": "2026-10-24T10:01:54Z",
  "class": "architecture",
  "tags": ["workspace", "local", "wsl", "ssh", "blueprint", "session"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/dc1aca7c-408f-406d-add4-ba78d556b662",
  "relations": [
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/621a4a1f-dba1-49b5-82f9-68e87ff5f66f"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/0cb931e1-e33c-4e38-a9d9-9d652796d935"}
  ],
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/shared/ipc/workspace.ts", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/ipc/handlers.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/ipc/file-handlers.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/ipc/terminal-handlers.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/service.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/harness/workspace-blueprint.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/sessions/session-registry.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/features/workspace/actions.ts", "role": "implementation"}
  ]
}
---

# Local / WSL / SSH 工作区导入与操作实施计划

## Intent

让用户将本地目录、WSL 发行版目录及 SSH 主机目录导入同一个工作区列表，并在正确的目标环境中完成文件编辑与预览、终端、Git、蓝图和会话管理。这五项是用户明确要求的首版范围；阶段性终端连通不能作为整体交付。

本篇细化[既有运行时决策](../terminal/wsl-support-direction.md)，当前处于实施中，未创建 Task，完整首版尚未交付。延续 Windows 原生桌面宿主；UI 中的 Local 对应既有决策的 `kind: 'windows'`，WSL / SSH 是工作区连接途径。用户已确认首版 SSH 目标支持 Linux；远端 Windows、容器嵌套和跨来源文件搬运另行评估。

2026-10-24 已确认三项产品约束：关闭 JanusX 后 SSH 远端任务继续执行；SSH 首版支持 Linux；Local / WSL / SSH 的文件预览以同版本本地现有体验为一致性基准。它们是实施和发布验收的约束，P0 只验证实现方法及具体平台兼容，不再决定是否包含这三项。

导入表示登记目录与连接信息，不复制仓库、不自动 clone、不自动安装编程 CLI 或系统依赖。SSH 优先复用已有 OpenSSH 配置与密钥/agent，同时提供应用内新增连接，不要求用户预先编辑配置文件。密码、密钥口令等交互认证由连接流程按需请求，支持边界在 P0 验证；不默认持久保存秘密。远端任务需要脱离桌面生命周期，由 Linux 端持有进程与 PTY；JanusX 管理远端工作服务的准备、版本及清理，并在首次使用前说明对远端的改动。无凭据、无权限或目标缺少 CLI 时展示可定位的原因，不默默改用桌面环境执行。

## 当前实现与缺口

以下是当前工作树实现状态。已在用户授权的 NewAPI-WSL（Ubuntu 24.04 / x86_64）验证 WSL 与真实 OpenSSH 通道；服务测试不能代替完整桌面验收。

| 入口 | 当前行为 | 实施需要补齐 |
| --- | --- | --- |
| `Workspace` 与创建入口 | 左侧共用三来源面板、发行版/SSH Host 候选、连接后选目录；侧栏用 WSL/SSH 小标识区分同名工作区；记录保存 native root + runtime，renderer/IPC 使用带 workspaceId 的资源 URI | 连接状态、主动重连入口、最近目录、重复登记判定 |
| 文件树与编辑器 | 目标侧目录树、读/保存、SHA-256 冲突校验、原子替换、增删改移；中文/百分号路径编码；源码有界扫描 | 外部变更轮询/通知、完整链接竞态、大文件策略、跨浮窗通知 |
| 终端与 CLI | Linux daemon 持有 PTY，桌面只连接；退出 detach、显式结束 end；冷恢复枚举原 ID，attachOnly 防止重跑；新建 Agent 已安装直接启动，缺失时在终端内提供安装并打开；远端启动跳过 Windows Hook/快照准备 | 当前为有界原始输出回放，尚无完整屏幕快照；远端 Hook/遥测、离线启动后的主动重连、终端长期保留预算 |
| Git 与 worktree | 基础 Git、worktree 列举/创建/删除与分支操作在目标执行；根外目录需目标 Git 登记证明；有活跃终端时拒绝删除；元数据按来源 URI 隔离 | 创建取消后的残留核对；真实 SSH push/pull 及故障注入 |
| 文件预览 | 共用文本/图片；Markdown 相对资源；HTML capability 代理；Office 单文件缓存复用 bundled OfficeCLI、控件、租约与刷新 | Office 断线状态、隐藏面板暂停、完整内嵌/浮窗视觉交互对照；代码符号导航已随文件窗口精简移除 |
| 蓝图 | 复用独立于 Electron 的文档处理器和 harness-node；Linux 端初始化、读取、画布编辑、哈希冲突检查与事务撤销；来源投影 ID 包含工作区身份 | 外部变更推送、跨来源 bindings、维护 Agent/任务运行器；未适配的远端运行入口明确报不可用 |
| 会话管理 | 在目标解析 Claude/Codex/Pi 文件历史与 OpenCode SQLite，桌面账本按来源隔离；详情按需读取；恢复前校验目标历史、cwd、CLI；仍运行的终端只附着 | 各提供方真实账号/历史的端到端验收；远端 Hook/回合遥测，新建 CLI 自动绑定 provider ID；现有合成历史只验证解析和启动参数 |
| 连接与发行 | 系统 wsl.exe / OpenSSH，源码经 stdin 原子部署；协议 3 拒绝不兼容宿主并保留原任务；蓝图/会话按需准备私有 Node 22.20.0，固定 SHA-256 校验官方 Linux x64/arm64 包 | 目标仍需 Python >= 3.9、tar/xz 与兼容 glibc；仅 Ubuntu 24.04 x64 实测；SSH BatchMode，仅已信任主机与密钥认证；密码/口令/首次信任、跳板和完整宿主无中断升级未完成 |
| 手机远控 | registry 对目录执行本地 realpath/stat；mobile-host 以该路径启动 CLI | 后续复用运行时解析；保留桌面中转边界 |

工作服务在目标用户 `~/.local/share/janusx/runtime-v1` 使用 0700 目录、0600 Unix socket，不监听 TCP。文件/进程/终端/取消/业务通道分开，单文件上限 32 MiB、PTY 输出环 4 MiB、同时活跃终端上限 64。Windows 进程清理不接收远端 PID；写入、命令提交和输入回执丢失时不自动重放。Linux 文档与会话后端是构建时打包的 CJS，和 Python 服务一起作为 main 构建资源发布；长驻子进程保留初始化预览及索引，事务在目标盘完成。Node 下载显式遵循 HTTP(S)_PROXY/NO_PROXY；xz 包约 30 MB，首次准备允许最多 300 秒，后续复用校验缓存和私有安装，不替换用户已有 Node。文档后端变更在前一事务完成后按内容哈希替换 worker，不停止 PTY；完整 Python 宿主的升级仍另行处理。

Office 缓存位于桌面 `userData/janusx/cache/workspace-office`，按工作区与来源路径散列隔离。只有目标读操作更新缓存，预览不写回目标文档；最后租约释放后清理文件。刷新目前依赖 mtime/size，失败退避；断线提示及完整 UI 一致性尚未验收。

### WSL / SSH Agent 按需安装

2026-10-24 用户实测确认：在卸载后重新测试 WSL OpenCode 安装，用户反馈“我测试修复有效”。本次 `workspace-runtime:cli:status` / `Unexpected end of JSON input` 问题记录为已修复、用户复测通过。此证据来自用户反馈，范围为该 WSL OpenCode 安装问题，不扩展为 SSH、其他 CLI 或提供方登录的验收。

2026-10-24 状态查询修复：用户在 WSL 安装 OpenCode 时出现 `cli:status` 的 `Unexpected end of JSON input`；现场状态已为 complete，日志显示 56 秒安装成功，CLI 检测通过。单次传输曾在进程 `exit` 时返回，stdout/stderr 仍可能未排空；现改为等待 `close`，并使用流式 UTF-8 解码。空／残缺 JSON 的只读 status 最多查询三次，安装命令不自动重放；持续查询错误明确提示安装可能仍在后台执行。现场 60 次只读查询未复现原始偶发错误，不能据此断言它是该次事件的唯一根因；确定性回归覆盖了退出先于输出的时序缺陷。

修复验证：`workspace-cli-transport` 5 项（迟到 stdout/stderr、跨块中文、状态重试及上限、安装不重放）、`remote-cli` 4 项和 `terminal-launch` 7 项通过；安装面板 6 项浏览器测试通过。`JANUSX_CLI_WSL_LIVE=1 npx vitest run tests/unit/workspace-cli-transport-live.test.ts` 经生产传输连续读取 30 次真实 WSL 状态并检测 CLI，通过，未安装软件。按用户要求已卸载 `NewAPI-WSL` 当前用户的 JanusX 受管 `@opencode/cli` 并清除该次安装状态／日志，确认未安装，保留配置与会话，供用户重新验收。

新建或重试 Agent 终端时在所选发行版／SSH 用户下检测可执行程序；已安装直接打开，缺失则在原终端区域展示“安装并打开”，保留原 cwd 和启动参数。失败仍在同一面板显示原因、安装输出和重试入口，也可切换到当前目录的普通 Linux 终端；关闭面板后不因迟到结果创建终端。Local 继续走原有启动链路。

`resources/workspace-runtime/cli.py` 独立部署，不升级或重启已有 daemon。检测及启动共用登录 Shell PATH、用户目录和 nvm 候选，过滤 WSL 继承的 `/mnt/<drive>/` Windows PATH。安装包由主进程已有 CLI 注册表选择，renderer 只传 workspaceId/toolId；安装至目标用户 `~/.local/share/janusx/agents/<tool>`，不用 sudo，不修改全局 npm prefix，不迁移桌面凭据。新装 OpenCode 使用注册表的 v2 包。

Linux x64/arm64 可自动安装；Node/npm 缺失或 Node 低于 22 时，在 glibc >= 2.28 的目标复用固定版本、校验和验证的私有 Node 准备流程；不兼容目标保留手动终端入口。当前复用的准备流程也部署文档后端，目标仍需 Python、tar/xz，软件包安装需要目标网络可用。登录及模型配置由各 CLI 在目标自行完成。

npm 安装由脱离连接的 Linux worker 执行，每工具文件锁防止重复提交，状态和尾部日志写入目标目录；退出桌面或关闭面板不终止已启动的 worker。依赖下载／传输准备仍由桌面持有，准备阶段退出需再次点击安装；不能把它描述成完整安装全程脱离桌面。安装完成后重新解析 PATH，旧 daemon 无需重启；原生会话续接也通过这一解析器启动，不再用后端旧 PATH 的 `command -v` 拒绝受管安装。已有终端附着不触发安装或重跑。

2026-10-24 验证：`remote-cli`、`terminal-launch`、`workspace-runtime-terminal`、`workspace-runtime-restore` 共 17 项单测通过；Linux `tests/integration/workspace-cli.py` 4 项通过，覆盖用户目录、nvm、Windows PATH 过滤、损坏程序、重复安装与中断状态。`remote-agent-setup.spec.ts` 与 `terminal-startup.spec.ts` 共 8 项浏览器测试通过，包括安装后自动启动、失败保留日志并重试、普通终端退路、关闭后不误启动。截图为 `artifacts/remote-agent-wsl.png` 和 `artifacts/remote-agent-ssh.png`。

真实测试命令：先启动专用 SSH 夹具，再设置 `JANUSX_RUNTIME_LIVE=1`，执行 `npx vitest run tests/unit/workspace-runtime-live.test.ts -t 'installs missing Agent'`。Windows 经 WSL 实际安装 Codex、经回环 OpenSSH 实际安装 Pi，均经生产 RemotePty 执行 `--version` 成功；安装期间断开桌面传输后继续完成，原 PTY PID 不变。首轮测试末尾误用 `terminal.attach`，改为 `terminal.list` 并使用每轮唯一 ID 后复跑通过。首次私有 Node 下载也已实际完成。这里只验证 Ubuntu 24.04 x64、Codex/Pi 包安装和启动，未验证全部 CLI、arm64、异地网络或提供方登录／模型请求；浏览器安装面板使用替身 IPC，真实安装链路是独立服务测试。

### 已执行验证

| 命令/入口 | 实际结果与边界 |
| --- | --- |
| `npm run typecheck` | 当前改动通过 |
| `npm run build:app` | main/preload/renderer 构建通过；保留既有动态/静态导入提示 |
| `npm run check:notes` | 311 篇，仍为已有 3 处错误和 17 条外部链接诊断；本次未新增校验错误 |
| terminal-launch、terminal-ipc-contract、terminal-officecli-path、agent-session-registry、git-service 单测 | 64 项通过，包含既有 Local Git 与终端回归 |
| `npx vitest run tests/unit/office tests/unit/html-preview-server.test.ts tests/unit/local-asset-resolver.test.ts tests/unit/file-tree-utils.test.ts` | 134 项通过 |
| `npx vitest run tests/unit/workspace-runtime-files.test.ts tests/unit/workspace-runtime-terminal.test.ts tests/unit/workspace-runtime-restore.test.ts tests/unit/editor-cache.test.ts` | 27 项通过，包含文件刷新事件不循环、编辑缓存版本、三种 Office 缓存、重连不重跑与退出只 detach |
| `wsl -d NewAPI-WSL --exec python3 /mnt/c/Users/Tree/Desktop/git/JanusX/tests/integration/workspace-runtime-host.py` | 8 项通过，新增 worktree 根外文件 scope、运行终端阻止删除与主盘删除拒绝 |
| 设置 `JANUSX_RUNTIME_LIVE=1` 后运行 `npx vitest run tests/unit/workspace-runtime-live.test.ts` | 10 项真实 WSL/SSH 测试通过；新增两通道 worktree 创建/保存/删除，以及 Linux 蓝图初始化、哈希冲突与撤销；保留实际三种 Office 渲染验证 |
| worktree-git、worktree-external-sync、blueprint-store、agent-session-registry | 84 项通过 |
| harness-ipc-contract、blueprint-workspace-init、harness-s9-acceptance、workspace-runtime-files/terminal/restore | 36 项通过；文档处理器抽取后 Local IPC 注册与事务回归通过 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | 通过；抽取后的无用导入已清理 |
| external-session-scanner、transcript-reader、external-session-sync | 22 项通过；远端后端复用同一解析器 |
| agent-session-registry 单独复验 | 37 项通过，新增相同 provider ID 的 Local/WSL/SSH 隔离、Linux 大小写和进程退出不增加回合 |
| 设置 `JANUSX_RUNTIME_LIVE=1`、`NO_PROXY=localhost,127.0.0.1` 和空闲 `JANUS_E2E_PORT`，运行 `npx playwright test tests/e2e/desktop-workspace-runtime.spec.ts --project=desktop --workers=1` | Windows Electron 整条流程通过，首次自动下载/安装 Node；真实侧栏 WSL/SSH 导入、文件/Git/worktree/蓝图 IPC、Markdown 内嵌/浮窗/重新嵌入、会话读取与恢复，以及退出并重开后原 ID/PID |

真实链路夹具为 `tests/integration/workspace-ssh-fixture.py`：提取 Ubuntu OpenSSH/libwrap 包到专用用户缓存，独立回环端口、临时密钥、固定 known_hosts、专用 HOME 与工程，不安装系统服务，不改用户 SSH 配置。测试仅隔离 HOME 与 OpenSSH config，其余生产传输、部署、参数引用、资源解析与 Git/预览服务实际执行。测试结束后停止自身 PTY，触发夹具 stop 后关闭临时 sshd/工作服务并删除 Linux 测试目录和凭据；下载包缓存保留供复跑。Office 曾出现 Windows 临时文件 EBUSY，改用字节传输后复跑通过。

桌面测试仅在开发构建且显式 `JANUSX_RUNTIME_LIVE=1` 时允许隔离 HOME/SSH config；没有替换 wsl.exe、ssh 或业务服务。Local 登记通过真实 IPC，WSL/SSH 导入和预览迁移使用实际点击；蓝图与 Git/worktree 的写操作经 preload/IPC 验证，不能称为覆盖全部按钮。会话输入是合成的 Claude JSONL，CLI 是记录恢复参数并持续运行的 Python 夹具，验证身份隔离、原生参数及进程保活，不代表已验证真实 Claude/Codex/OpenCode 账号、服务或模型回答。测试 profile 保留供定位，其中临时密钥仅对本次隔离 sshd 有效。截图在 `test-results/desktop-workspace-runtime--b4f37-d-reattaches-after-app-exit-desktop/`。资源路径和首次下载超时由这次真实桌面测试发现并修复。

## 交互与首版边界

统一左侧“添加工作区”入口选择 Local / WSL / SSH。正常路径只要求选择来源与目标目录，连接信息不能推断时才补充；后台自动预检，五项能力的正常结果收在详情，异常才就地提示。已有空白页、侧栏添加及其它目录导入入口复用同一流程，不为成功导入再增加一页能力检查清单。

导入界面采用 480px 紧凑弹窗，复用共享 `ModalFrame` 的进入／退出动效与原生浏览器遮挡处理。Local／WSL／SSH 使用带图标的分段选择器，当前主题决定中性底色、文字、输入框与主按钮；Local 保留原生文件夹选择，WSL 仅显示发行版与目录说明，SSH 默认只显示主机字段，端口及身份文件收在可选高级连接中。连接后显示目标名称、可编辑目录路径和轻量文件夹列表；返回保留连接输入。忙碌时禁用关闭与提交，错误原位展示；取消、Esc 与成功导入均走共享退出动画，结束后恢复入口焦点。键盘循环只包含可见控件，避免进入折叠的高级字段。该调整参照用户要求的简洁桌面风格，未改变连接协议与远端执行边界。

2026-10-24 界面验证：`tests/e2e/workspace-import.spec.ts` 六项通过，覆盖 Local 原生选择取消／成功、WSL 浏览与手输目录登记、SSH 高级参数／错误恢复／忙碌关闭保护、键盘焦点、无发行版，以及 1280px／390px 深浅主题布局。采用真实 React 组件和模拟 Electron API，未重跑真实 SSH／WSL 服务链路。20 张截图位于 `artifacts/workspace-import-*.png`；类型检查通过，主题审计无新增问题，组件 ESLint 零错误、一项既有 ref cleanup 提示。

| 来源 | 目录选择与预检 | 导入后执行位置 |
| --- | --- | --- |
| Local | 保留原生目录选择；验证目录可读，写权限按实际操作反馈 | 本机文件系统与进程 |
| WSL | 探测发行版，选择发行版后浏览其 Linux 目录；辨认 `\\wsl.localhost\…` / `\\wsl$\…` 导入 | 所选发行版中的 cwd、git、CLI；FS 可经已验证的 UNC 适配 |
| SSH | 选择已保存/OpenSSH 主机或输入 `user@host`，连接后浏览远端目录，自动检查读写与工具可用性 | 远端文件系统与远端进程 |

工作区行保留当前名称与分组，补充低干扰的来源/连接状态，详情中显示完整目录。导入前先预检，失败允许改配置和重试；已登记工作区失联时保留条目、布局及草稿，提供重连，不能因本地 stat 失败而隐藏。

首版文件范围包含目录树、文本编辑、保存、新建/重命名/同源移动/删除。文件预览复用本地文件窗口与查看器，以同版本 Local 的格式和交互作为 WSL/SSH 基准，包含已有 Office 能力，不缩减为文本/Markdown/图片/HTML 子集。HTML/Markdown 相对资源通过受限资源服务读取目标文件，不能把远端绝对路径直接交给 `file://`。独立窗口与内嵌区使用相同资源身份和草稿，沿用[统一文件窗口](../workbench/unified-file-window.md)的打开与迁移规则。开发服务器网页预览涉及端口转发，作为独立能力评估；不影响已支持文件的预览一致性要求。

### 本地预览一致性基准

2026-10-24 静态核对 `FileViewerContent.tsx`、`file-classification.ts`、`shared/product.ts` 与 `shared/office.ts`：

| 文件类别 | 三来源应保留的本地行为 |
| --- | --- |
| 代码、配置、普通文本及数据文件 | 现有编辑器、语言识别、查找、保存、显式差异比较；CSV/TSV 仍按本地已有文本方式呈现 |
| Markdown / HTML | 现有预览与源码切换、相对图片/样式/脚本等资源的受限加载、编辑后更新及已有主题行为 |
| 图片 | 使用同一图片查看器，保留当前尺寸适配、比例与信息展示 |
| DOCX / XLSX / PPTX | 复用 Office 预览能力，保留本地已有翻页、缩放、适合窗口等格式对应控件及只读/可写边界 |
| 本地当前没有专用查看器的格式 | 保持相同的信息/不支持提示，不将本次一致性要求扩张成新增全部格式查看器；如 PDF 在当前内置文件窗口中走二进制信息展示 |

标签去重、内嵌/浮窗迁移、未保存提示、快捷键、错误重试与资源刷新同样属于体验基准。网络增加的加载/重连状态需要清晰，但用户不应手工下载文件、改路径或启动独立预览工具。验收采用同一组文件和操作分别跑 Local、WSL、SSH，而不只检查远端能显示正文。

Office 的实际渲染位置由 P0 验证：可以在 Linux 侧准备兼容渲染能力并经 SSH 代理，也可在桌面采用按需、只读、版本化缓存渲染。后者只用于派生预览，不建立工作区镜像；目标文件仍是真源，外部更新须失效缓存，任何可写操作都回到目标版本校验。文件服务、预览端口/资源代理及租约释放纳入同一工作区身份，避免两台主机同路径串预览。

蓝图范围包含已有工程身份与 Note 的读取、模块导航、组合/绑定、无 Note 项目的显式初始化，以及维护对话产生的变更预览、批准写入、冲突处理与刷新。会话范围沿用现有面板的筛选、历史详情、归档/删除管理与支持引擎的 Continue/Resume；不重新加入该面板已经移除的检查点恢复操作。内置 Agent 的通用远端工具、运行/测试面板和手机接入是邻接范围，但蓝图维护所必需的读写与运行边界属于首版。

### 专业能力与简洁操作

用户于 2026-10-24 明确要求“专业，但是对于用户来说也要操作简洁”。设计目标是让系统承担环境识别、配置复用与连接准备，用户只决定连接哪台机器、打开哪个目录；失败时仍能准确定位问题。以下是对本篇交互的细化建议，尚未实现 UI。

SSH 首次接入建议在同一个添加面板中完成两个步骤：

1. **连接主机**：默认展示可搜索的已保存主机与 OpenSSH 配置候选，也可输入 `user@host`；点击“连接”即开始预检。无需先去设置创建主机，也不把 Test、Save、Connect 做成三个必走动作。端口默认 22，身份选择优先遵循 OpenSSH；无法确定用户名时再要求补充。首次未知主机显示身份确认，需要密码或口令时单独请求。
2. **选择文件夹**：连接成功后显示远端目录浏览、可编辑路径栏和该主机最近目录，点击“添加并打开”登记工作区，并记住非秘密连接信息与目录。保留返回和重试；切回上一步不清空已填内容。

高级连接折叠承载端口、身份文件、跳板和特殊配置；支持粘贴常见 `ssh -p 2222 -i … user@host` 来预填，而不是直接执行用户输入的任意 shell 字符串。解析不支持的选项应明确提示。读取既有 OpenSSH config 时保留 alias/Include/ProxyJump 的有效语义，不把配置展开后丢弃，也不在普通导入时重写用户配置。新增连接默认存 JanusX 自己的连接记录。

再次使用已导入工作区直接点击左侧项目，按需自动连接并恢复文件与布局；同一主机第二个项目复用连接与最近目录。SSH 主机设置页负责重命名、凭据引用和高级维护，属于可选管理入口。不同来源、不同主机可同时保留工作区和运行终端，连接进度不锁住全局界面。

连接过程用“正在连接 → 正在准备工作区 → 已就绪”表达用户需要理解的阶段。失败就地给出原因与下一步，例如重新认证、检查地址、修复缺少的工具；完整日志按需展开。已经打开过的工作区掉线后仍保留条目、标签和草稿，工作区行与内容区提供一致的重连动作，避免重复弹窗。

Local 继续选择目录后直接打开；WSL 自动检测发行版，只有一个可用发行版时预选，多个时展示可辨认的名称，再浏览目录。自动检测可以减少输入，但必须让用户看得见目标发行版/主机。连接成功与五项功能就绪分开判断：缺少 Git/CLI 时其余能力仍可用，受影响入口给出明确原因，不能显示虚假的整体成功。

交互验证至少覆盖：已有 OpenSSH 主机无需重复输入、新用户只填必需信息、默认流程不用展开高级区、连接即完成检测、已导入项目再次点击即可重连、错误后保留输入、无网络时仍可切换其它工作区。首次主机身份确认或认证输入是条件步骤，不计作可省略的成功路径。

### Orca / VS Code 的参考依据

2026-10-24 读取以下官方文档与仓库原文，属于文档核对，没有操作两款应用或验证其连接实现：

| 参考 | 文档描述的方式 | JanusX 采用的设计方向 |
| --- | --- | --- |
| [VS Code Remote-SSH](https://code.visualstudio.com/docs/remote/ssh) | 可输入 `user@host` 或 SSH 命令添加主机；记住配置及最近目录；连接后打开远端文件夹，终端自动在远端运行；远端安装 VS Code Server | 主机输入简短、复用 OpenSSH、最近目录直达、自动准备环境；保留 JanusX 一个窗口内多来源并存的工作区模型 |
| [Orca SSH worktrees](https://github.com/stablyai/orca/blob/1fd50207396c221a813c94f91dca445457187f09/docs/site/content/docs/ssh.mdx) | Settings → SSH 配置目标，支持可视化表单与 OpenSSH config 搜索导入；创建 worktree 时选择目标；高级项折叠；首次安装远端服务，工作区内可重连，relay 承载 PTY 保活 | 借鉴可视化连接、渐进展示高级项、工作区就地恢复；新增连接直接嵌入左侧导入，设置页不作为前置步骤 |

原文可核对 [VS Code 文档源](https://github.com/microsoft/vscode-docs/blob/main/docs/remote/ssh.md)，读取时文件 blob 为 `e53692dbb6c05f9ce9a10db267d149e44fcb2520`；Orca 行固定到读取时的仓库 commit。两者的远端服务是其完整能力与恢复体验的实现基础，不能从界面上的“SSH 连接”推断为只需启动一个 ssh 子进程。

## 建议架构

### 1. 工作区身份与位置

沿用既有 `kind: 'windows' | 'wsl' | 'ssh'` 方向，以判别联合约束必需字段，避免三个布尔开关组合。草案字段如下，最终结构由 P0 定型：

```ts
type WorkspaceLocation =
  | { kind: 'windows'; path: string }
  | { kind: 'wsl'; path: string; wslDistro: string }
  | { kind: 'ssh'; path: string; connectionId: string }
```

`path` 始终表示目标环境中的绝对路径：本地是 Windows 路径，WSL/SSH 是 POSIX 路径。UNC 只是 WSL 适配器的派生访问路径，不持久保存第二份根目录。SSH 连接描述独立保存 host/port/user/config 别名和凭据引用，工作区引用稳定的 connectionId；这是对既有决策中内嵌 ssh 描述的细化建议，尚未替换已确认字段。禁止出现可分别修改的 `path` 与 `remotePath` 两份真源。

缺少 kind 的旧记录归为 windows，保留 UUID、排序、分组、布局及原路径。已用 UNC 导入的旧记录不静默转成 WSL：先辨认并提示转换预览，因为转换会改变 Git 与 CLI 执行环境。通过验证后显式保存；新版远端记录不能再流入仅理解本地路径的旧入口。

运行时身份区分本机、WSL 发行版及 SSH 连接的有效用户环境；修改 SSH 的主机/用户目标要建立新身份或执行显式迁移，不能让旧会话随 connectionId 被悄悄指向另一台主机。路径相等与大小写规则由目标 FS 决定，Linux 的 `/repo/A` 与 `/repo/a` 不经 Windows 小写归一化。

跨进程请求使用 `workspaceId + scopeId + relativePath`，由 main 解析可信根；scopeId 指向已登记的工作区根或 worktree，不能由 renderer 提交任意远端绝对根。编辑器、搜索、预览、Git 和事件键统一包含运行时身份，防止两台主机上的 `/home/dev/app` 共用缓存或历史。会话另保存原始 cwd 与环境身份，满足移出当前 worktree 后仍能准确提示恢复位置的需要。

### 2. main 统一派发，业务按能力消费

拟新增工作区 RuntimeRegistry，负责解析记录、生命周期及能力；文件服务、进程服务分别提供 Local / WSL / SSH adapter。名称与文件拆分可在实现时调整，职责先固定。

| 边界 | 最小职责 |
| --- | --- |
| WorkspaceFS | list/stat/read/write/mkdir/rename/remove、canonicalize、版本与刷新订阅；区分文本/二进制并限制读取量 |
| WorkspaceProcess | 目标 cwd 下的命令/参数、env、超时、输出上限、取消及退出结果；PTY 与非交互执行分开 |
| RuntimeCapabilities | 文件读写/预览、PTY、Git/worktree、蓝图读取/事务、各引擎扫描/读取/续接及事件能力 |
| RuntimeConnection | 连接、认证、探测、就绪、失联、重连、释放；传输生命周期与远端进程生命周期分开 |
| RemoteTerminalHost | Linux 端持有 PTY/任务与稳定终端 ID，提供枚举、重新附着、输出回放/屏幕恢复和显式结束；桌面退出不触发进程清理 |
| SessionSource | 目标用户下提供方历史的位置、增量发现、有界读取、会话 ID 与恢复参数 |

业务入口不能各自拼 `wsl` / `ssh`。旧的纯路径 IPC 先只服务 Local，新入口解析资源引用；逐个迁移使用方后再开放远端能力。main/shared 重复 Workspace 类型同时收敛。启动后的分析、git 自动 reconcile、知识索引、检查点、Hook 安装等副作用也要审计；未适配则按能力停止，不将 Linux 路径交给 Windows 后台服务。

目标文件的 canonicalize/链接边界必须在目标侧校验。用户授权的工作区文件操作与会话转录读取分开：历史通常在工作区外的用户目录，只开放已配置提供方数据源的读取能力，不能借会话扫描开放任意家目录写入。运行时切换复用现有策略授权，并明确展示真实来源与目标。

### 3. WSL 与 SSH 的落地选择

WSL：通过 `wsl.exe` 探测发行版与路径，处理其输出编码及默认发行版变化；终端、Git、CLI 固定绑定选定发行版和目标 cwd。本地 PTY 的 cwd 使用有效宿主目录，不把 `/home/…` 当 Windows cwd。UNC 文件访问先做读写、中文/空格、符号链接、保存冲突和大目录实测；不可靠的能力改走发行版内文件操作。监视首版采用操作后刷新、聚焦补查与有界轮询，不承诺 UNC recursive watch 可靠。

SSH：连接入口优先复用系统 OpenSSH 的 config、agent 与 known_hosts。非交互命令、PTY 和文件通道必须采用一致的目标与信任校验；现有依赖中没有 ssh2，选型不能当作已有能力。关闭桌面后继续执行已是首版约束，P0 必须验证 Linux 端独立持有任务和 PTY 的远端工作服务/监督进程；单独将交互进程挂在桌面 ssh 子进程上不满足交付。文件、事件、结构化进程及蓝图事务可复用该服务，直接 SFTP/命令通道与 SSH 库作为通道选择或补充比较，不能替代持久执行职责。实测 host 别名、交互认证、加密密钥/agent、主机指纹、ProxyJump 与取消，确认首版支持矩阵。不能出现终端能连，但文件服务使用另一套凭据而无提示的情况。

不预设远端有 Node/Python 或已安装 JanusX。远端工作服务的建议目标是提供匹配平台的预构建产物，必要运行时随包准备，经现有 SSH 通道上传，支持远端没有公网下载能力；先探测已有兼容版本。首次在添加面板内简短说明将准备工作服务，提供用途与移除方式详情；正常安装不要求用户手工配 Node、编译原生模块或执行 sudo。实际包大小、架构/系统兼容、安装目录、升级/回退/清理与受限主机行为均由 P0 验证。它承载工作能力，桌面 UI 仍在 Windows，延续原运行时决策。

蓝图事务、结构化进程、SQLite 会话读取若由远端服务承载，必须完成版本协商与事务验证后才能开放对应能力。SSH 服务端命令仍可能经 shell 解释，本地 argv 数组不等于远端参数安全，必须集中处理 POSIX 参数边界，并测试特殊字符路径。首版缺少某种认证或跳板能力时明确报不支持，不能绕过指纹校验。

同一 SSH 连接可承载多个工作区，桌面侧传输按引用计数与空闲超时释放；释放传输不结束远端任务，也不因桌面引用归零关闭仍有 PTY 的远端服务。PTY 与文件/命令通道独立报告健康状态。终端能输出不能证明文件通道就绪，后台扫描也不能长时间阻塞输入。

### 4. 保存、断线与刷新语义

保留现有编辑器基于内容版本的冲突检查。目标 FS 提供读取版本及条件保存；能使用目标侧临时文件与原子替换时采用该能力。SFTP 的 stat/hash 后 rename 并非跨写入者的原子 CAS，若只能做到尽力检测，要明确限制；蓝图多文件事务不能靠这类保存假装获得原子性。

远端版本变化时返回当前版本供用户比较；连接中断保留草稿和待确认状态。写入在断线时可能已经提交而回执丢失，重连后先核对版本/内容，不能自动重放保存、删除、Git commit/push 或蓝图事务。只读请求可在有界策略下重试，写入结果未知必须与明确失败区分。

每次切换捕获目标身份与连接代际；旧连接、旧工作区、旧 worktree 的迟到响应不得覆盖当前界面。手动刷新、操作后失效、可见目录的退避轮询共同工作，面板隐藏或连接失效后暂停扫描；根目录变化保留目前文件树的代际守卫。

SSH 首版必须满足：关闭 JanusX 后远端任务继续执行，正常关闭、桌面异常退出、休眠或网络中断不作为终止任务信号。远端服务独立持有 PTY、cwd、进程与稳定 terminalId；计划默认断开后持续运行，不设置因桌面离线而自动杀任务的短租约。结束远端任务是明确动作，与断开连接分开。远端主机重启、任务自行退出或用户显式结束后的进程复活不在此承诺内。

重新打开应用并连接时，枚举核对远端终端与桌面已存标签映射，附着原 terminalId，恢复有界输出回放和当前终端屏幕；不重复启动任务，也不以提供方 Resume 冒充仍在运行的终端恢复。失联时状态为未知，连上后由远端进程事实确认运行/退出；离线期间已结束的任务显示实际退出结果。终端恢复与 Claude/Codex/OpenCode 的原生对话续接分别验收。

远端服务在无人连接时仍需处理输出背压，以有界内存/磁盘保留策略运行，不能因桌面停止消费而无限积累或停止读取 PTY。运行状态、输出序号和终端归属需能在重连时核对；具体预算由 P0 测量。升级、回退、服务卸载不能悄悄终止活任务，必须保留兼容进程宿主或进入明确的受控处理流程。

### 5. 蓝图与会话属于必需闭环

蓝图继续把目标仓库 `.agents/harness.json`、Note 原件及既有项目数据作为真源。缓存仅为投影，不能先改本地镜像再假定已同步。保持 `note://repo-id/note-id`，同一仓库多个 checkout 作为不同来源实例显式绑定，不能仅凭相同 repoId 合并来源。初始化和维护事务需要目标侧版本复核、写入与撤销/恢复语义；断线后可核对已写集合和事务结果。既有蓝图维护运行器若依赖 Node 本地路径，也要通过工具/存储边界改造，不能仅改读取函数。

本仓使用 `@janus-agent/harness-node` 等相邻仓库包，本次未改动相邻仓库。已选择将既有 Node 文档与事务逻辑打包到目标执行，避免复制一套 Python 事务或本地镜像写回。代价是首次下载约数十 MiB 的私有 Node、额外进程和版本管理；当目标架构/发行版不兼容、运行资源过高或共享包提供合适存储端口时重新评估。维护 Agent 的桌面模型/工具适配仍需单独接入，不能由 Note 写入成功推导已可执行远端维护任务。

会话账本仍在桌面持久保存管理元数据，补充运行时/用户环境、工作区、scope、engine、providerSessionId 和转录来源。会话去重使用环境身份与提供方身份，不用相同 providerSessionId/cwd 合并不同发行版或主机；跨 worktree 连续对话保留原生身份与原 cwd，不复制为新对话。

转录原件留在目标环境，增量发现和详情读取经 SessionSource；面板隐藏暂停扫描，详情按需有界加载。Claude/Codex 的文件历史、OpenCode 的 SQLite 存储分别处理；远端正在写入的 SQLite 不能直接复制数据库文件后假定一致，需只读查询或一致性快照方案。现有支持原生恢复的 Claude/Codex/OpenCode 是首批适配目标，按“环境 × 引擎”验收发现、正文、续接；Pi/Janus/DSH 不凭终端可启动新增原生恢复承诺。

Continue/Resume 必须在原环境检查 CLI、提供方会话与原 cwd，保留当前“不自动发送首条 prompt”的行为。归档/删除沿用现有数据所有权，不附带删除远端提供方原始历史。Hook、遥测、回合与 transcript path 同样携带环境身份；Windows Hook 文件、localhost 地址与环境变量不能直接照搬远端。若需要事件桥接，应经既有 WSL/SSH 授权连接承载，不为此默认暴露桌面服务到网络。

## 分阶段实施

阶段用于降低迁移风险，不改变五项能力同属首版完整交付的范围。下面是工作包草案，未指定发布日期或以无依据的工期代替验证。

| 阶段 | 实施内容与主要落点 | 完成闸口 |
| --- | --- | --- |
| P0 契约与连接实验 | 定型 Workspace、资源/scope/会话身份；验证 Linux 远端服务持有 PTY、关闭桌面后继续运行及重新附着；实测认证、保存、事务和 Office 预览通路；核实共享包接口及运行依赖 | 五项能力有实现路径，本地预览基准无远端格式缺口；持久执行真实实验通过，Linux 架构/发行版兼容矩阵清楚；用户无需手动安装服务依赖 |
| P1 Local 迁移基线 | 新 RuntimeRegistry/FS/Process；workspace IPC/types、preload、actions、缓存、事件与旧记录归一化；所有未适配入口门控 | Local 五项回归通过，旧记录/布局/会话不丢失；外部路径不会进入本地副作用 |
| P2 WSL 基础操作 | 来源选择、发行版浏览、预检；UNC/发行版 FS；PTY、CLI、Git/worktree；保存与共用预览，包括 Office 及资源代理 | ext4 工作区及 `/mnt/c` 形态可编辑、预览、开终端和操作 Git，预览按同版本 Local 样例核对；此时只标阶段可用 |
| P3 SSH 基础操作 | 左侧连接/选目录、OpenSSH 复用、高级项折叠、自动准备、最近目录；FS/Process、持久 PTY、Git/worktree、共用预览、重连及草稿 | 两主机同路径隔离；退出 JanusX 后任务继续、重开附着原终端；预览与 Local 基准一致；默认流程无需高级配置，写入结果未知有明确行为 |
| P4 蓝图与会话贯通 | 蓝图 identity/Note/组合/初始化/维护事务；会话 ledger/scanner/reader/recovery；Hook/转录环境适配 | WSL 与 SSH 均完成蓝图读写和目标引擎会话发现、正文、原生续接；依赖缺失明确可见 |
| P5 整体验收与发布 | 五项跨来源切换、本地预览对照、桌面退出/重开、断线、远端持续输出与资源释放；对应模块更新当前事实 | 下表场景在真实目标环境验证；退出释放桌面连接且保留远端活任务；未完成项不作为整体已交付 |

P2/P3 可用于内部试用，首版完整标记须经过 P4/P5。WSL 与 SSH 复用同一业务契约，但 SSH 的事务/认证实验前置，避免先做完 WSL 后才发现蓝图无法扩展。手机端仍经桌面转发，后续接入时改造 registry/mobile-host，不能以改完它们代替桌面五项验收。

## 拟验收场景

这是实施前的候选验收清单，正式执行时可转入 requirement 并固定 AC 编号；当前无完成勾选。

| 场景 | 必须观察到的结果 |
| --- | --- |
| 旧 Local 工作区升级 | UUID、排序/分组、布局、文件草稿与会话保留；五项能力行为不变 |
| 三来源导入与重启 | 目标目录与来源正确，重复导入按环境与规范目录判断；失联条目可见，重启可重连 |
| 文件编辑与预览 | 同一组代码/文本、Markdown、HTML、图片、DOCX/XLSX/PPTX 和无专用查看器样例在 Local/WSL/SSH 对照；编辑/预览切换、Office 控件、相对资源、主题、内嵌/浮窗及草稿行为一致；中文/空格/特殊字符路径正确 |
| 保存冲突与中断 | 外部修改可发现，草稿不丢；保存回执丢失后先核对结果，不盲目重写；链接目标不能越过已授权根 |
| 终端与 Git | pwd、Git 状态/基线/diff、暂存/取消/提交和 worktree 均指向所选环境；远端缺少 Git/CLI 时无本地回退；push/pull 在专用测试仓库验证 |
| SSH 持久执行与重新附着 | Linux 目标运行带持续输出的任务，关闭 JanusX 后仍执行；重开附着同一 terminalId/进程并恢复输出与屏幕；桌面异常退出、断网、休眠不重复派生任务；离线期间完成的任务显示真实退出结果，明确结束操作才停止任务 |
| 蓝图已有仓库 | 模块/正文/关系来自目标原件，复用原 repoId/noteId；相同仓库多 checkout 的来源绑定清楚 |
| 蓝图初始化与维护 | 空工程预览并初始化到目标；维护变更审批后写回目标；并发冲突、撤销和中断结果可检查，没有本地镜像冒充成功 |
| 会话历史与续接 | 所选环境的已存在与新建会话可筛选、读正文、管理归档；Claude/Codex/OpenCode 原生续接回到同一提供方会话及环境，不自动发送 prompt |
| 同路径与迟到响应 | 两主机及不同发行版同目录名不串文件、蓝图来源、会话、Git 或缓存；切换后的旧响应不覆盖当前界面 |
| 故障与释放 | 发行版停用、网络中断、指纹变化、认证失败、权限不足有准确状态；隐藏面板停止轮询，退出释放桌面连接而保留远端任务；移除登记/卸载服务的处理显式说明活任务影响，原仓库保留 |

验证组合为：适配器契约和身份/参数/冲突单测、IPC 与缓存迁移集成测试、真实 Electron 的五项交互，以及真实 WSL 与受控 SSH Linux 目标的闭环。替身连接可测错误分支，不能代替真实链路与提供方恢复；所有写入/删除/Git 实验使用专门的临时工程与会话数据。

## 取舍与待定问题

直接给 Workspace.path 填 UNC 只能覆盖部分 WSL 文件访问；给终端写 `ssh host` 只能解决终端，都无法满足五项闭环。整包部署到远端/WSLg 增加发行和宿主适配成本，沿用既有决策不选。全量本地镜像会引入冲突与双真源，默认不选；统一运行时 adapter 增加前期迁移量，但能让蓝图、会话和后续入口复用同一身份与执行目标。

需要在 P0 收敛：Linux 架构/发行版与认证/跳板兼容矩阵；UNC 的可用边界；远端服务部署、持久 PTY、回放/屏幕恢复与升级方式；共享 harness 包端口与事务能力；远端 SQLite 一致性读取；Office 及其它已有本地预览的具体适配路径。Linux 首版、关闭桌面后继续执行、预览与本地一致已经确认，不再列为待决定的范围。若实验表明无法同时交付，应调整发布安排或明确返回讨论范围，不静默缩减已确认能力。
