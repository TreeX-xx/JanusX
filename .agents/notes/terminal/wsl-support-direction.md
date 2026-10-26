---
{
  "schema": "harness-note/2",
  "id": "621a4a1f-dba1-49b5-82f9-68e87ff5f66f",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-24T06:35:44.093Z",
  "class": "architecture",
  "tags": ["wsl", "ssh", "terminal", "workspace"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "relations": [
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/55fdeb68-aab4-437a-8802-36d53c13bf52"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/8ac68f05-8b94-52c1-809a-b75176904195"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c247d96c-7810-4fdf-9f73-d1893d423701"}
  ],
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/shared/shellProfiles.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/terminal/manager.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/git/service.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/workspace/types.ts", "role": "implementation"}
  ]
}
---

# 工作区运行时方向：WSL 与 SSH 连接途径

## Problem

开发工作大量发生在 WSL 中，用户要求 JanusX 能直接拉起 WSL 终端，不再借助外部终端额外操作 WSL；并追问工作区（仓库在 WSL 侧）能否一并适配。同日用户继续追问 SSH 工作区：远端机（云开发机、内网机）上的仓库能否作为工作区接入，手机远程时能否看到 SSH 工作区。两者同属「工作区目录不在 Windows 本地」的运行时形态问题，应共用一条架构主线而不是各做各的。问题分两层：应用本身要不要部署进外部运行时（WSL 发行版、远端机）；Windows 原生宿主下工作区如何适配外部侧仓库。2026-10-13 shell-profiles 收敛留下的「WSL 首版不做专门支持」边界由此过时。

## Decision

JanusX 保持 Windows 原生运行，WSL 与 SSH 作为终端与工作区的外部运行时接入，不把应用部署进外部运行时。`Workspace` 以运行时标记区分连接途径：`kind: 'windows' | 'wsl' | 'ssh'`；终端、CLI/agent 会话、git 与文件访问按标记走对应派生，上层（分屏、蓝图、会话、用量、远控）完全复用，不感知连接途径。

2026-10-24 用户进一步明确导入后的首版范围为文件编辑预览、终端、Git、蓝图和会话管理。[跨来源工作区实施计划](../sessions/workspace-runtime-import.md)在此方向上细化身份、接口迁移、蓝图事务、目标侧历史与原生续接及阶段验收；该计划仍为草案。下述终端/文件/Git 分阶段是底层适配步骤，不代表完成后即可宣称五项能力整体交付；蓝图和会话仍需各自完成存储与执行边界适配。

同日用户确认 SSH 首版目标为 Linux，关闭 JanusX 后远端任务必须继续执行，文件预览应与本地体验一致。因此 SSH 进程与 PTY 由 Linux 端独立服务持有，桌面负责连接和呈现，重连附着原终端；远端服务的准备与升级由应用管理。预览复用本地已有格式和交互，包含 Office；具体渲染路径与持久执行验收归上述实施计划。该服务不包含远端桌面 UI，也不改变手机经桌面授权中转的边界。

**当前实施路径**：`Workspace.runtime` 为 windows / wsl / ssh 联合类型，旧无 runtime 记录继续按 Local 处理。WSL 经所选发行版的 `wsl.exe --exec`，SSH 经系统 OpenSSH，均连接 Linux 工作服务；文件、Git 与持久 PTY 复用该服务。记录保留 native root，renderer/IPC 使用带 workspaceId 的资源 URI，避免不同主机同路径串缓存以及 Linux 目录进入 Windows fs/cwd。

左侧共用导入面板已接入发行版探测、SSH Host 候选及连接后目录浏览。远端创建终端提前分派，不执行 Windows Hook、检查点及 Office 环境准备；终端管理器区分显式 end 与应用退出 detach，冷恢复使用原 ID 和 attachOnly。Git 基础操作、HTML/Markdown/Office 共用预览已接入，真实 WSL/SSH 验证范围见实施记录。

蓝图读写/初始化/撤销和提供方会话扫描/正文/原生恢复已接入目标侧 Node 后端，按需准备校验过的私有 Linux Node。远端 worktree 通过目标 Git 管理；根外文件访问需验证属于该仓库的已登记 worktree，有活跃终端时拒绝删除。真实服务测试覆盖事务冲突、撤销和两通道 worktree 操作。

**尚待完成的连接与业务能力**：完整屏幕快照、远端 Hook/回合遥测、维护 Agent、提供方真实账号恢复验收、交互认证与无中断升级。目前仍依赖目标已有 Python 3.9+、tar/xz 及兼容 glibc，使用私有 Unix socket。SSH 采用 BatchMode 并复用配置/密钥/known_hosts，不默默接受未知指纹；应用内密码、密钥口令及首次信任确认尚未完成。

普通 [shell-profiles](./shell-profiles.md) 自由命令入口保留，不会把 Local 工作区自动转换为 WSL/SSH。CLI 安装与登录态留在目标，不自动代装 CLI。手机 workspace-registry/mobile-host 的运行时适配属于后续工作，不能由桌面终端连通推导已可用。

**手机远程形态**：手机经桌面转发看到 SSH 工作区，不直连 SSH。与[远程控制方向](../remote/remote-control.md)既定信任边界一致——桌面是唯一事实源与信任边界，远端侧只传授权意图，不直接接触 shell 与文件系统。SSH 密钥与连接生命周期留在桌面；内网/跳板拓扑下手机只需可达桌面。终端级 SSH 在专门支持前已有逃生口：shell-profiles 自由命令可自填 `ssh user@host`，手机远控同样可见该终端。

## Alternatives considered

- **整包部署进 WSL（WSLg 显示）**：技术可行——Windows 11 自带 WSLg，Electron 界面可显示；但 node-pty 需 linux 重编（`npmRebuild: false`，ConPTY prebuild 为 win32 专用）、Electron+WSLg 的中文输入法与渲染折扣、自动更新链路仍指向 Windows 产物、大量 win32 分支需重新冒烟。仅当要把 JanusX 作为 Linux 桌面应用分发时才值得，届时按 Linux 构建（AppImage 已在 electron-builder 声明）另立交付。
- **维持现状、依赖外部终端**：与「终端即工作台」的产品定位冲突，用户明确要求应用内拉起。
- **仅做共享工作区（仓库放 C:\，WSL 经 /mnt/c 访问）**：是形态 B 的低成本路径而非独立方案，见 Consequences。
- **手机直连 SSH 工作区**：手机自持 SSH 客户端与凭据直连远端机。被否：破坏桌面唯一信任边界、密钥装手机扩大失守面、需在 Android 端重写 SSH/SFTP 与终端仿真、内网拓扑下手机常不可达；工作区上下文（蓝图、会话、用量）本就长在桌面。Orca 的 SSH worktrees 同为笔记本持有运行时、手机遥控。若出现「电脑关着、手机直连远端机」需求，属通用 SSH 客户端（Termius 类）场景，另立产品评估，不进本方向。
- **SSH 维持自由命令逃生口**：零开发即可用，但只到终端级；文件树、编辑器、git 仍指向本地路径，不构成 SSH 工作区。作为普通 shell profile 入口保留。

## Consequences

- WSLg 只说明「部署进 WSL 可行」，决策不选它；界面显示问题仅在重新评估 Linux 分发时才相关。
- 各子系统适配难度：终端拉起（易）；目录选择器（Win11 对话框已可导航 `\\wsl.localhost`）；CLI/agent 会话派生（中，WSLENV 显式转发已有 mergeWslenv 铺垫，见 `src/main/notifications/agent-hook-config.ts`）；git 面板（中，含路径分隔符审改）；文件树 + `fs.watch` recursive（难，9P 上不可靠，故列阶段 4 并降级）。
- WSL 导入的 ext4 与 `/mnt/c` 目录均使用所选发行版的文件/进程服务；Local 导入继续使用 Windows 服务。不会仅因 Local 的 shell profile 启动 WSL 就混用两侧文件和 Git 语义。
- 自由命令手填 `wsl -d Ubuntu` 的逃生口继续存在，但专门支持后不再「不承诺行为」；[gitbash-shell-terminal-management](./tasks/gitbash-shell-terminal-management.md) 的 AC-6 保留为 2026-10 首版交付的历史证据，不改写。
- SSH 线最大风险包括全仓「path=本地目录」的隐含假设（`realpath`/`stat`/`execFile cwd` 散布 git、blueprint、notes、harness 等处），以及桌面退出与远端进程生命周期耦合；须先立 FS/Process 和持久 PTY 边界。连接优先复用 OpenSSH 的 known_hosts 与 agent，通道与服务按 Linux 兼容实验定型；断线与半死连接需要生命周期管理及工作区状态徽标。文件树高延迟链路按需拉一层，可照搬 remote-view 的 RemoteFileNode 逐层约定。
- 手机端仍需注册校验、终端创建与会话身份的运行时适配；当前桌面服务测试不构成手机端验收。remote-view 的只读快照与相对路径约定保留。
- 发行版探测可参考 cc-switch 的 WSL probing 机制设计（[cc-switch-port](./requirements/cc-switch-port.md)），按 Electron/TS 栈重实现。
- 重访条件：出现原生 Linux 桌面分发需求时，重评整包进 Linux 构建（node-pty linux 预编译、AppImage 更新通道、WSLg IME 冒烟）；SSH 线若被要求手机离桌直连，另立产品评估，不改写本决策。
