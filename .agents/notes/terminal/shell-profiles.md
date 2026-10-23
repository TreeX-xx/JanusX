---
{
  "schema": "harness-note/2",
  "id": "55fdeb68-aab4-437a-8802-36d53c13bf52",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-11",
  "updated": "2026-10-23T16:36:37Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# 可选择的普通终端 Shell

## Intent

用户希望“打开终端”支持 Git Bash，并允许自行指定 shell。当前 Windows 默认 shell 由 `src/main/terminal/presets.ts` 与 `src/main/ipc/handlers.ts` 固定为 `powershell.exe`；终端选择页只提供一个 `shell` 预设，没有 PowerShell、Git Bash 等独立选项。建议“新建终端”的主操作使用全局默认 shell，旁边的菜单可临时选用已安装的 PowerShell、Git Bash、CMD 或 WSL；设置页允许选择默认项及填写自定义可执行文件路径、启动参数。可按需要再考虑工作区级覆盖，不预设为首版要求。

Git Bash 应检测 Git for Windows 的 `bash.exe` 并在嵌入式 PTY 中启动；`git-bash.exe` 通常打开独立窗口。未检测到的选项需明确提示安装状态。启动前应验证路径和参数，并沿用当前 worktree 工作目录；现有终端不因默认值变化而被替换，恢复会话时保留原 shell。手动 shell 选择不应隐式改变 Claude、Codex 等直接启动 CLI 的预设或项目运行器。

## Agreed direction

v0.9.4 的 Windows 启动修复取消打包层强制管理员清单，终端继承应用的调用者权限，普通桌面启动时不再自动提权。用户已确认候选包在故障 Windows 10 上可以打开，并授权同步到正式 v0.9.4；发布与启动验证见 [桌面分发记录](../desktop/reproducible-verification.md)。下文 2026-10-14 的固定提权记录描述替换前的包，不代表当前行为。

用户已认可扩展现有第一个 Shell 卡片的方向。卡片保留 Shell 名称和图标，并显示当前默认 shell；点击主体直接启动默认项，始终可见的下拉箭头提供具体 shell 的临时选择。Git Bash 作为普通终端的 shell 选项，不新增与 Claude、Codex 并列的终端类型卡片。空白页卡片与已有终端的“新建终端”菜单提供一致的选择入口，创建后的终端显示实际 shell 名称。

临时选择只作用于本次新建终端，不修改全局默认值；默认项与条目内容由设置中的“终端管理”维护。这是已认可的交互方向，功能尚未实现。

shell 的扩展设置与工作区上方的添加控件也要记得适配。工作区 pane 标签栏的新建终端 + 按钮（`TerminalPresetCapsule`）展开的预设菜单属于适配范围，与 Shell 卡片、空白页提供一致的默认 shell 显示和临时选择入口。

终端类型不限死。设置的“终端管理”由用户自建 shell 条目：名称、图标（可选）、自由命令、启动后缀、显隐开关、默认标记，不写死 PowerShell、Git Bash、CMD、WSL 清单。CLI 预设卡片（Claude、Codex、Janus 等）同样纳入显隐管理；隐藏只影响新建入口，已有终端与会话照常显示运行。

自由命令允许用户随便写（`bash --login -i`、`ssh user@host`、`docker exec -it foo zsh` 等），Janus 不解析、不限制；启动后缀由用户自填，启动时默认带上。工作目录固定沿用当前 worktree，由 PTY 机制承担，与命令内容无关。

设置面包含两个区块：已配置列表维护命令、后缀、显隐与默认标记，可执行名丢失时标红；候选区收纳检测发现的 shell 与 CLI，默认隐藏，用户确认后入库并预填命令与建议后缀。Shell 卡片、空白页与 `TerminalPresetCapsule` 三处入口只展示“已配置 + 显示”的项，并显示当前默认 shell。

## Decisions

2026-10-13 收敛原三条开放问题：

- 默认 shell 只保存全局默认，首版不做工作区覆盖。
- WSL 首版不做专门支持；自由命令下用户可自填 `wsl -d Ubuntu`，不承诺其行为。（2026-10-23 修订：升级为专门支持，方向与工作区适配路线见 [WSL 支持方向](./wsl-support-direction.md)。）
- 自定义条目不设环境变量与登录模式的专门字段；自由命令与启动后缀已覆盖（如 `env FOO=1 bash --login`）。
- 首版预置 PowerShell 一条默认种子项；其余 shell（含 Git Bash）经检测候选区确认添加。
- 检测发现的 shell 与 CLI 预设默认隐藏，用户确认才入库；显隐管理范围含 CLI 预设卡片。

## Pending validation

- 命令 + 启动后缀的拼接以 PTY 直启为目标：命令按可执行名与参数解析，后缀追加为尾参；引号、管道等复杂串由用户写入命令本身，必要时用系统 shell 包裹。
- Git Bash 的 `bash.exe` 检测、worktree 落位与 `--login -i` 建议后缀以 Windows 实测定型。

## Open questions

无。原三条已于 2026-10-13 收敛，见 Decisions。

## Implementation

Janus CLI（用户所称 AgentX）暂时采用默认隐藏：首次使用、缺少合法显隐列表、renderer 首帧与加载失败回退均将 janus 放入默认隐藏列表，空白终端卡片与标签栏新建菜单共用既有过滤。设置 → 终端管理仍保留 Janus 管理项，用户可以开启显示，保存后跨启动保留。已有合法 hiddenCliPresets（包括空列表）继续尊重，不强行迁移覆盖用户偏好；已运行终端、会话恢复与内置聊天／Agent 底座不受影响。主进程默认配置、共享归一化及 renderer 回退共用 DEFAULT_HIDDEN_CLI_PRESETS。

验证：shell-profiles 与 shell-profile-launch 既有两份单测共 37 项通过，日志 artifacts/janus-default-hidden-unit.log；未新增 UI 测试或运行桌面实测。

2026-10-15 「已配置 Shell」改为通栏概览列表：每行显示名称与完整启动行摘要，显式文字按钮管理默认项与显隐；终端字形只承担识别，不再兼任显隐开关。点击名称/命令所在主体展开名称、自由命令与可选启动后缀，字段各占整行，删除位于展开区底部；新建空命令条目自动展开并聚焦名称。默认项唯一、即时保存及失败回滚继续沿用既有 store。取舍是修改既有条目需多一次展开，换取多 Shell 时更紧凑的扫读和长路径编辑空间；外部 CLI 与候选区布局保持原实现。样式独立于共享设置 CSS，沿用设置令牌适配纸面/深色主题；窄容器将操作组换行。验证：`npx playwright test tests/e2e/shell-settings.spec.ts --project=island --workers=2` 9 项通过（双主题、1100/640/390px、键盘展开、默认/显隐、新增/删除、保存失败回滚），`npx vitest run tests/unit/shell-profiles.test.ts tests/unit/shell-profile-launch.test.ts tests/unit/planche-theme.test.ts` 51 项通过，`npm run typecheck`、`npm run i18n:check` 通过。浏览器验证使用隔离 fixture，未对正在运行的 Electron 会话做人工点击。

实现排期见 [Git Bash 与自定义 Shell 终端管理实现](./tasks/gitbash-shell-terminal-management.md)（Task，accepted，P1–P5 分阶段），与 Docker 管理入口任务相互独立，可分开执行。

2026-10-13 已落地 P1–P5：条目 schema 与全局持久化（PowerShell 种子）、自由命令 + 后缀的 PTY 直启与启动前路径校验、检测候选区（Windows 上 Git Bash 优先取 Git for Windows 的 `bash.exe`）、设置「终端管理」三区块、空白页 Shell 卡片 / `TerminalPresetCapsule` / 空白页三处一致入口与 CLI 预设显隐。Pending validation 的 `--login -i` 建议后缀与 worktree 落位仍只是候选区预填值，Windows 实测未做，详见 Task 的 Results。

2026-10-13 界面修订（用户反馈后）：Shell 卡片初版把默认 shell 的完整启动行作为第二行文字、并用"卡片 + 拼接按钮"两件套承载下拉箭头，轮廓与其他 preset 卡片不一致。现改为卡片与其余卡片完全同构（同边框、同圆角、同单行标签，标签即条目名），临时选择收敛为卡内右上角一枚常驻但低对比的箭头；完整启动行改走原生 tooltip，下拉菜单内仍以第二行等宽字显示并截断。菜单定宽 252px，条目为「名称 + 默认标记」一行、启动行一行。

2026-10-13 设置面合并（用户反馈后）：「通用」里的「外部终端」（版本检测、一键安装/升级）移入「终端管理」，与原来的「CLI 预设卡片显隐」合并为同一组 6 行 —— 每行同时承担版本/状态/操作和「显示」勾选，不再用两份列同样 6 个 CLI 的清单。整个面板改用设置界面既有的 label + control 两栏（`generalRow`）与 `lsCard` / `lsButton` / `lsStateBadge` / `lsToolRow` 词汇，删掉自建的 CSS 模块；此前自建样式把 `rgba(0,0,0,…)` 硬编码底色用在卡片上，在纸面主题下失真，而该色本应是输入框专用的"下沉黑"（`--so-field`）。条目编辑改为就地编辑：名称输入框即卡片标题，不再另设只读摘要行。控件缺口（文本输入、字段标题、勾选、图标按钮、链接按钮）补在 `AppSettingsModal.module.css`，与既有令牌一致。

2026-10-13 显隐改「图标即开关」（用户反馈后，第三次界面调整）：眼睛图标撤掉，改为**条目左侧的图标本身就是显隐开关** —— shell 条目用固定终端字形，外部 CLI 用各自品牌图标，点一下就置灰（opacity + grayscale）表示不从新建入口显示，再点恢复。shell 条目的字形选择器（预设面板 + 自定义输入）整个移除，`ShellProfileEntry.icon` 字段随之从 schema 删除，不再有用户字形。默认项仍是星标（实心/空心）。候选区的「检测」按钮改为纯图标（RefreshCw，检测中自顾旋转），文字只留在 label 栏与 aria-label。撤掉这些后 `ExternalCliManager` 的 `visible`/`onVisibleChange` 变为必填，可选分支是死代码。

2026-10-13 「新增条目」改整宽虚线行（用户反馈后，第四次界面调整）：原来是个借用了 `.lsCardActions`（卡片内部操作行类）的小按钮，孤零零浮在面板底色上，和上面的卡片列表脱节。改为与条目卡同宽的虚线添加行（`.lsAddRow`），读作"下一张空卡位"；空列表时它和 `.lsEmpty` 提示并存，仍是唯一行动点。

2026-10-13 `+` 菜单分区（用户反馈后，第五次界面调整）：`TerminalPresetCapsule` 的浮层原来是 shell 条目与 CLI 预设混在同一个 2 列网格里，既读不出"这里能换 shell"，shell 之间也只靠名字区分。现分为两组：上部 **Shell** 区把每个已配置且显示的 shell 整行陈列（终端字形 + 名称 + 默认徽章，启动行进 tooltip），下部 **CLI 预设** 区保持 2 列网格。分区标题用 `terminal-menu-section`（小号大写、弱化，只分隔不抢项），样式落在 `theme-hovers.css` 与既有 `terminal-*` 命名一致处。面板预估高度随分组上调到 240（仅影响首帧视口钳位，实测后由 useLayoutEffect 纠正）。

2026-10-13 Shell 区改折叠 + 输入框字体（用户反馈后，第六次界面调整）：Shell 区不再默认铺开，改为**折叠头** —— 头部一行即默认 shell（点主体直接开终端，与空白页 Shell 卡片同一套交互），右侧箭头展开后才铺开全部已配置 shell（展开项左缩进一档从属于头部）；只有一条 shell 时不出现箭头。头部与箭头是两个兄弟按钮，不嵌套。另外 `--font-mono` 在整个样式表里没有定义，`var(--font-mono, monospace)` 一直回落到系统默认等宽（Windows 上即 Courier New），自由命令/启动后缀因此和名称输入框不同字体；删除 `.lsInputMono`，三个输入框统一走 `.lsInput` 的继承字体。箭头提示原本想用原生 `title`，被 `planche-theme.test.ts` 的"TerminalArea 禁止 title="契约拦下，改用 `ThemedTooltip`。

2026-10-13 管理员权限（用户要求"设置里开一次，之后全部提权"）：嵌入 pane 的 PTY 无法单独提权 —— ConPTY 伪终端设备不跨 Windows 完整性级别通信（Windows Terminal 同样无法在标签页里跑提权 shell），而子进程默认继承父进程令牌，所以唯一路径是**让 app 自身提权**。实现为 `src/main/terminal/admin-mode.ts`：`whoami /groups` 解析 Mandatory Label SID（S-1-16-12288 高完整性命 / S-1-16-16384 系统级，SID 后不接数字以防 122880 误判）判断实态；`Start-Process -Verb RunAs` 触发 UAC 提权重启，保留原始 argv；非 Windows 用 `getuid() === 0`。偏好落 `ShellProfilesSettings.runAsAdmin`，IPC `admin-state` / `relaunch-elevated` / `relaunch-normal`。UI 在「终端管理」顶部一张卡：盾牌图标开关（与本面板星标同套路）改偏好，**偏好与实态不一致时才出现显式重启按钮** —— 不让一个开关悄悄重启整个 app，因为提权的是整个 app（git 操作、文件写入同样受影响）。顺带修了两个既有缺陷：`.lsButton` 缺 `white-space: nowrap` + `flex-shrink: 0`，长文案按钮在 flex 行里会被挤压折行；`.lsCheck` 早前当死类删掉后管理员行又在引用，改为用盾牌图标而非把它加回来。

2026-10-13 管理员权限 dev 重启修正（用户提出"dev 下重启就起不来了"）：dev 下 `process.execPath` 是 `node_modules/electron/dist/electron.exe`、`argv[1]` 是相对路径 `scripts/dev-entry.mjs`，且**渲染端 Vite 服务是 `electron-vite dev` 的子进程，Electron 一退它就死**，所以只重启 Electron 会拿到死的 `ELECTRON_RENDERER_URL` 而白屏；提权进程经 ShellExecute 启动时工作目录还被重置为 System32，相对入口也解析不到。改为 `buildRelaunchPlan` 按 `app.isPackaged` 分流：打包后重启 app 可执行文件本身（带原 argv），**dev 下重启整条 `npm run dev` 并显式带 `-WorkingDirectory`**。经 `cmd.exe /c npm` 转一手让 PATH 解析 npm —— 一开始想用 `dirname(execPath)/npm.cmd`，但 execPath 在 `electron/dist/` 下，npm.cmd 不在那儿，被单测抓住。`adminState` 增报 `dev`，UI 据此换重启按钮文案并在状态行补"dev 下将重启 npm run dev"。

：嵌入 pane 的 PTY 无法单独提权 —— ConPTY 伪终端设备不跨 Windows 完整性级别通信（Windows Terminal 同样无法在标签页里跑提权 shell），而子进程默认继承父进程令牌，所以唯一路径是**让 app 自身提权**。实现为 `src/main/terminal/admin-mode.ts`：`whoami /groups` 解析 Mandatory Label SID（S-1-16-12288 高完整性命 / S-1-16-16384 系统级，SID 后不接数字以防 122880 误判）判断实态；`Start-Process -Verb RunAs` 触发 UAC 提权重启，保留原始 argv；非 Windows 用 `getuid() === 0`。偏好落 `ShellProfilesSettings.runAsAdmin`，IPC `admin-state` / `relaunch-elevated` / `relaunch-normal`。UI 在「终端管理」顶部一张卡：盾牌图标开关（与本面板星标同套路）改偏好，**偏好与实态不一致时才出现显式重启按钮** —— 不让一个开关悄悄重启整个 app，因为提权的是整个 app（git 操作、文件写入同样受影响）。顺带修了两个既有缺陷：`.lsButton` 缺 `white-space: nowrap` + `flex-shrink: 0`，长文案按钮在 flex 行里会被挤压折行；`.lsCheck` 早前当死类删掉后管理员行又在引用，改为用盾牌图标而非把它加回来。

2026-10-14 提权改为打包层固定（用户选 A，撤销 app 内提权开关）：在 `electron-builder.yml` 的 `win` 加 `requestedExecutionLevel: requireAdministrator`，让 exe 自带 requireAdministrator 清单 —— 每次启动即管理员，所有终端天然继承。**app 内的提权开关整套删除**（`admin-mode.ts`、其测试、三个 IPC、`runAsAdmin` 配置位、「管理员权限」设置行及全部 i18n），因为在 requireAdministrator 下它不只是多余、而且是坏的：「以普通身份重启」会再次 UAC 然后照样以管理员起来，按钮承诺的事做不到。机制上 `app-builder-lib` 的 `winPackager.signAndEditResources` 会把 `--set-requested-execution-level requireAdministrator` 交给 rcedit 写进 exe 资源，且不依赖代码签名。代价记在此处：每次启动弹一次 UAC；非管理员用户无法运行本 app；整个 app 常驻高完整性（git、文件写入同样提权），不只是终端。dev 不受影响 —— electron-vite dev 不走打包清单，dev 下仍是标准权限，要验提权行为就从管理员终端跑 `npm run dev`。
