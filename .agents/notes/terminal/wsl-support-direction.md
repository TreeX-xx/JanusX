---
{
  "schema": "harness-note/2",
  "id": "621a4a1f-dba1-49b5-82f9-68e87ff5f66f",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-23T15:14:08Z",
  "class": "architecture",
  "tags": ["wsl", "ssh", "terminal", "workspace"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "relations": [
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/55fdeb68-aab4-437a-8802-36d53c13bf52"},
    {"type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/8ac68f05-8b94-52c1-809a-b75176904195"}
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

**WSL 线**分四阶段适配，每步独立可验：

1. **WSL 终端 profile**：shell profile 增加 WSL 条目（`wsl.exe -d <发行版> --cd <路径>`），探测 `wsl.exe -l -q` 生成发行版候选；归入 [shell-profiles](./shell-profiles.md) 已定稿的自建条目与候选区机制。
2. **Workspace 运行时标记**：`Workspace` 增加 `kind: 'windows' | 'wsl'` 与 `wslDistro`，终端与 CLI/agent 会话按标记经 `wsl.exe -d ... --cd ...` 派生，路径双向转换（Linux 路径 ↔ `\\wsl.localhost\<distro>\...`）。
3. **git 面板切 wsl.exe**：`execFile('git', {cwd})` 改经 `wsl.exe ... git`，porcelain 输出路径按 posix 分隔符处理。
4. **文件树降级**：WSL 工作区不做 live 文件监视，先轮询或仅事件后刷新；后续再评估 WSL 内 inotify 辅助进程推事件。

**SSH 线**与 WSL 同构展开（截至记录日未实施，`kind` 扩为三态）：

1. **连接配置与凭据**：Workspace 增加 `ssh` 连接描述（host、port、user、remotePath、authRef）；凭据不进 workspace JSON，走 ssh-agent / OpenSSH config / Windows 凭据管理器，沿用凭证类私有文件不入普通读写的敏感文件原则。
2. **SSH 终端**：终端派生按 `kind` 分支 spawn `ssh -t user@host`，最小可用即通终端流与手机远控（PTY 在桌面侧，既有管线零改动）。
3. **文件树与编辑器**：main 进程经 SFTP（ssh2 或 OpenSSH sftp 子进程）服务 `filetree:*` / `file:*`，handlers 收敛 FS 抽象（LocalFS | SftpFS）；文件监视降级轮询，照 WSL 阶段 4 策略。
4. **git 面板切 ssh**：`execFile('git', {cwd})` 改经 `ssh host git -C <remotePath> ...`，porcelain 输出同样按 posix 分隔符处理。
5. **远控接入**：companion workspace-registry 对 ssh 标记改「连接可达 + 远端目录存在」校验取代本地 stat；mobile-host 创建终端按 `kind` 分支；remote-view 契约不变，相对路径约定不外泄远端绝对路径。
6. **远端 agent/CLI 会话**（可选）：`ssh -t host 'cd <path> && claude'`，CLI 安装与登录态留在远端机。

**手机远程形态**：手机经桌面转发看到 SSH 工作区，不直连 SSH。与[远程控制方向](../remote/remote-control.md)既定信任边界一致——桌面是唯一事实源与信任边界，远端侧只传授权意图，不直接接触 shell 与文件系统。SSH 密钥与连接生命周期留在桌面；内网/跳板拓扑下手机只需可达桌面。终端级 SSH 在专门支持前已有逃生口：shell-profiles 自由命令可自填 `ssh user@host`，手机远控同样可见该终端。

## Alternatives considered

- **整包部署进 WSL（WSLg 显示）**：技术可行——Windows 11 自带 WSLg，Electron 界面可显示；但 node-pty 需 linux 重编（`npmRebuild: false`，ConPTY prebuild 为 win32 专用）、Electron+WSLg 的中文输入法与渲染折扣、自动更新链路仍指向 Windows 产物、大量 win32 分支需重新冒烟。仅当要把 JanusX 作为 Linux 桌面应用分发时才值得，届时按 Linux 构建（AppImage 已在 electron-builder 声明）另立交付。
- **维持现状、依赖外部终端**：与「终端即工作台」的产品定位冲突，用户明确要求应用内拉起。
- **仅做共享工作区（仓库放 C:\，WSL 经 /mnt/c 访问）**：是形态 B 的低成本路径而非独立方案，见 Consequences。
- **手机直连 SSH 工作区**：手机自持 SSH 客户端与凭据直连远端机。被否：破坏桌面唯一信任边界、密钥装手机扩大失守面、需在 Android 端重写 SSH/SFTP 与终端仿真、内网拓扑下手机常不可达；工作区上下文（蓝图、会话、用量）本就长在桌面。Orca 的 SSH worktrees 同为笔记本持有运行时、手机遥控。若出现「电脑关着、手机直连远端机」需求，属通用 SSH 客户端（Termius 类）场景，另立产品评估，不进本方向。
- **SSH 维持自由命令逃生口**：零开发即可用，但只到终端级；文件树、编辑器、git 仍指向本地路径，不构成 SSH 工作区。作为 SSH 线阶段 2 之前的过渡基线保留。

## Consequences

- WSLg 只说明「部署进 WSL 可行」，决策不选它；界面显示问题仅在重新评估 Linux 分发时才相关。
- 各子系统适配难度：终端拉起（易）；目录选择器（Win11 对话框已可导航 `\\wsl.localhost`）；CLI/agent 会话派生（中，WSLENV 显式转发已有 mergeWslenv 铺垫，见 `src/main/notifications/agent-hook-config.ts`）；git 面板（中，含路径分隔符审改）；文件树 + `fs.watch` recursive（难，9P 上不可靠，故列阶段 4 并降级）。
- 两种工作区形态：**A 真 WSL 工作区**（仓库在 ext4，如 `/home/.../proj`）需全部四阶段，收益是 Linux 原生性能与 agent 运行环境一致；**B 共享工作区**（仓库在 `C:\`，WSL 经 `/mnt/c/...` 访问）在阶段 2 后即基本可用（文件树/监视/git 照旧走 Windows 原生），代价是 9P 反向 IO 慢与两侧同碰工作树的 autocrlf/filemode 冲突。B 在阶段 2 完成即完整可用，A 要到阶段 4。
- 自由命令手填 `wsl -d Ubuntu` 的逃生口继续存在，但专门支持后不再「不承诺行为」；[gitbash-shell-terminal-management](./tasks/gitbash-shell-terminal-management.md) 的 AC-6 保留为 2026-10 首版交付的历史证据，不改写。
- SSH 线最大风险不是协议本身，而是全仓「path=本地目录」的隐含假设（`realpath`/`stat`/`execFile cwd` 散布 git、blueprint、notes、harness 等处）；须先立 FS/Process 抽象再铺功能，避免散改。终端建议走 OpenSSH 子进程（复用 known_hosts 与 agent），SFTP 走 ssh2 等可控通道；断线与半死连接需要连接生命周期管理及工作区状态徽标。文件树高延迟链路按需拉一层，可照搬 remote-view 的 RemoteFileNode 逐层约定。
- 手机看到 SSH 工作区分两级：SSH 终端在 SSH 线阶段 2 完成后即经桌面转发可见；SSH 工作区条目要到阶段 5（注册校验与创建分支）完成后进入远控工作区列表。remote-view 契约（只读快照 + 相对路径）无需改动。
- 发行版探测可参考 cc-switch 的 WSL probing 机制设计（[cc-switch-port](./requirements/cc-switch-port.md)），按 Electron/TS 栈重实现。
- 重访条件：出现原生 Linux 桌面分发需求时，重评整包进 Linux 构建（node-pty linux 预编译、AppImage 更新通道、WSLg IME 冒烟）；SSH 线若被要求手机离桌直连，另立产品评估，不改写本决策。
