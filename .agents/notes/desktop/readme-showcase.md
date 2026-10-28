---
{
  "schema": "harness-note/2",
  "id": "7b4800da-0ea0-4f63-9f15-7ce60e721bd7",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-03",
  "class": "simplification",
  "updated": "2026-10-27T12:01:13.611Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---

# README 演示按功能维护，共用录制与合成参数

## Problem

README 演示需要独立调整单个功能的步骤、文案与节奏。分屏脚本独有的启动和鼠标逻辑、集中存放所有字幕的 HTML，以及硬编码的本机编码工具路径，使修改一个功能时还要追踪其他入口。录制参数与 GIF 编码器的延时单位不一致，也会让预期停留时间失真。产物工作区需要在基础功能区提供可复现的真实操作演示。

## Decision

2026-10-27：副黑板已退役，S2 录制及验证脚本改为 tools/switch/return 三个检查点，移除蓝图 fixture 与黑板交互依赖。README 已撤下旧 S2 动图，历史素材与下方来源/哈希保留，尚未重录，不用旧成品证明当前 UI。

每个功能的 `record-*.mjs` 拥有示例文件、操作序列和字幕；[共享配置](../../../scripts/showcase/showcase-config.mjs) 注册唯一功能入口和输出名，集中保存主题、背景、鼠标与节奏参数。`run.mjs` 按指定功能顺序执行录制或合成，失败即停止。总览是独立入口，各功能片分别对应 README 的功能章节。

### 静态素材与发布条件

八组静态素材现已齐备。F/R/M 分别展示文件代码对照、双标签本地浏览器和 Markdown 编辑预览；A 使用真实 CPA 管理页与连接设置；U0 从成功用量录制的原始 PNG 导出抽屉和统计；C0 展示外部会话来源、两轮只读转录及续接入口。H 和 B0 分别沿用总览与 B1 海报。README 工具四格直接显示 F/R/M/A，用量与外部会话以折叠区链接承接细读，CPA 设置另有链接。

[capture-tools](../../../scripts/showcase/capture-tools.mjs)、[capture-cpa](../../../scripts/showcase/capture-cpa.mjs)、[capture-external-session](../../../scripts/showcase/capture-external-session.mjs) 驱动真实 Electron 界面。[static-lib](../../../scripts/showcase/static-lib.mjs) 固定当前主窗口，按实际边界捕获已挂载的原生网页，逐像素装入公共底板。整组先暂存在录制目录，所有断言成功后再发布成品和 latest；这是针对失败重拍部分覆盖成品、导致成功记录与磁盘哈希不一致的修复。不增加产品内的展示模式。

Markdown 浅色编辑区当前使用固定浅色文字，已有图中可读性不足；正式 F/M 使用 dark，R/A/U0 使用 planche，C0 使用 dark。未通过改 CSS 美化截图，浅色 Markdown 编辑对比度问题仍属产品后续工作。CPA 使用官方后端 v8.0.31 与管理页 v1.26.5 的固定组件和哈希，新实例 0 账号、0 调用，密钥不入图；不以空实例证明账号额度可用。外部会话由示例 Claude JSONL 经真实扫描导入，验证转录与续接按钮可用但未执行 Resume。U0 不从 GIF 解码，保留示例数据和预估费用边界。

重拍命令、组件版本与来源条件见 [脚本说明](../../../scripts/showcase/README.md#静态图片-frmau0c0)。后续修改保持该组失败不发布，并用 `node scripts/showcase/verify-stills.mjs` 核对全部当前资产；缺少本地原始缓存时需先重录，不将 PNG 本身当作来源证据。

`record-motion.mjs` 管理连续鼠标位置，定格保留指针，移动与拖拽从上一帧衔接；移动可按距离分配帧数。点击遵循移动、悬停、点击圈、结果帧；拖拽帧记录 pressed，释放不再生成假点击圈。输入通过 `insertText` 支持中文。录制辅助方法使用百分之一秒，manifest 与 GIF 编码使用毫秒，浏览器就绪等待独立于播放时间。

成功录制将字幕与帧一起写入 manifest，并更新本功能的 latest 指针。合成只读取该 manifest 和公共样式，不执行录制脚本；背景、鼠标和整体播放速度可单独重合成。字幕模板只承担样式，编码工具从系统临时目录或 `SHOWCASE_GIFTOOLS` 加载。编码器按时间线采样调色板、逐帧读取原图，避免同时保留全部 1080p 帧。

首图与演示共用 [showcase-background.png](https://github.com/TreeX-X/JanusX/blob/v0.9.3/wiki/assets/readme/showcase-background.png)，源文件为同目录 SVG。底板为原创 macOS 壁纸感的雾银灰、烟青与少量香槟灰流动曲面；低饱和、中等明度兼顾经典黑与石板色，不随应用主题或帧内容改变，取色见 [brand-spec](https://github.com/TreeX-X/JanusX/blob/v0.9.3/wiki/assets/readme/brand-spec.md)。`style.background.asset` 是合成器唯一背景来源，校验 1920×1080 尺寸；修改 SVG 后通过 `node wiki/assets/readme/render-hero.cjs` 生成底板和首图。10 条 README 功能 GIF 均已新 UI 重录，默认 planche 八条，dark 的会话与产物两条；`showcase/` 旧资产仅保留追溯。

README 功能区采用核心左文右图、Worktree/产物并排、工具集成 2×2。全部新片从无损帧直接生成 1784×908 GIF 与同名海报，四边各留 12px，完整应用窗口为 1760×884；输出至 `wiki/assets/readme/features/`，功能图可点击放大。[compact-readme.mjs](../../../scripts/showcase/compact-readme.mjs) 默认跳过新 GIF 和全部静态图，仅显式 `--legacy-stills` 才覆盖旧静态衍生图。F/R/M/A/U0/C0 六组九张补图已验证并接入，H/B0 沿用现有首图与 B1 海报；当前 README 无图片占位引用。本轮不改首图或品牌动画。

S1 终端分屏现已通过 [record-split-quad.mjs](../../../scripts/showcase/record-split-quad.mjs) 在新 UI、默认 planche 下重录。四种真实 CLI 为 Claude、Codex、OpenCode、Pi，均使用新建配置和回环占位模型地址，只展示未发送的任务草稿。Windows fixture 放在 Public 下的随机 janusx-split 目录，项目名 Atlas，不加载实际仓库父目录中的上下文，也不展示个人路径；结束后受路径检查保护地清理。创建全部标签后再处理各 CLI 首次设置，避免启动重绘干扰菜单；不修改产品菜单实现。

正式操作为单窗、左右分屏、2×2、拖动分隔线、Pi 合入 Codex 标签栏。录制断言检查窗格数 2/3/4/4/3、四个标签持续存在、四格草稿均可见、分隔比例减小和合并后的归属。40ms 运动帧、按距离移动、300ms 悬停与结果定格共用同一指针状态；按下时指针反色，释放无点击圈。末尾保留结果，以 0.8 秒淡出/淡入真实窗口及鼠标重置循环，外围底板不动。当前片仅验证分屏能力，不展示模型执行或评估 CLI 回答。

`compose.mjs` 支持 compact 装帧、逐帧 opacity 和 posterFrame，S1 从原始无损 PNG 直接合成 `features/feature-split.gif`，海报取调整比例后的四格，取消画面内字幕。合成与旧衍生脚本均固定边框索引，保持全局 palette、透明差分和 dispose 1。旧衍生脚本跳过已配置 compact 的功能，避免把新 S1 覆盖成旧母版。仅 compact 支持循环淡出；其他旧脚本默认仍使用标准画布。

新合成器使用 [palette.mjs](../../../scripts/showcase/palette.mjs) 按完整 RGB 值缓存最近色，整个全局调色板共用同一映射，不再让同一 RGB565 区间的首个像素决定后续近色。每次合成额外固定使用 32MiB 缓存，换取颜色映射与扫描顺序无关；若后续多片并行或受限内存场景出现压力，再评估稀疏缓存。旧 `compact-readme.mjs` 不变，仍显式固定边框。

S2 特色协同分屏由 [record-workspace-layout.mjs](../../../scripts/showcase/record-workspace-layout.mjs) 在默认 planche 下实录，沿用 S1 窄边、指针和循环方式。Atlas、Beacon 各有 OpenCode/Pi 双终端与未发送草稿；打开全局工具区，将 Markdown 拖至浏览器下方、切为预览，再下拉胶囊展开副黑板。选中搜索约定后通过真实平移、缩放与滚动读正文，将板高从 400 调至 320，再切 Beacon、返回 Atlas、收起黑板。浏览器实例、加载标识、筛选、滚动位置、文稿归属/正文、工具窗格和内外比例逐项验证保留；不声称蓝图选择或画布视角跨项目保留。

浏览器使用本地 HTTP 任务看板，蓝图来自通过 harness-note/2 校验的三篇 fixture 文档。原生截图固定主窗口句柄，内容区与 1760×884 视口匹配，从其实际挂载的 WebContentsView 读取截图和边界；此前仅取未固定窗口的视图会漏拍网页，此轮已通过截图像素与真实页面状态共同检查。拖拽使用产品自己的冻结画面。窄窗样式显式保留 `article[hidden]`，避免 flex 覆盖筛选隐藏；断言检查实际显示条目，不能只检查 hidden 属性。隔离配置不复制账号、不调用模型，临时项目退出后清理。

紧凑脚本依赖仓库外的 `gifuct-js` 解码旧片，仅支持现有尺寸、完整不透明首帧和 disposal 1；逐帧重建后两遍采样、编码，保留帧数、逐帧延时、无限循环与透明差分。单片全局调色板不足以保证背景一致：gifenc 的 RGB565 缓存由扫描中首个近色决定，Worktree 第 181 帧曾让 16 个边框像素变色。衍生脚本将窄边独立固定映射后再做差分，避免随应用帧变化；这不是对旧版明显背景突变根因的确认。PNG 窗口像素原样复制，GIF 再量化有轻微损失；后续新 UI 重录仍需验证完整流程、鼠标衔接与循环。

[产物脚本](../../../scripts/showcase/record-product.mjs) 使用真实文件发现、Island 提醒与预览组件，展示 HTML 交互、拉宽面板、JSON 标签和磁盘重新加载。报告由真实 Node 测试结果生成：新增第四项测试后，HTML 从 3/3 更新至 4/4；JSON 保留第一版 3 项结果。不调用模型、不复制账号。成品位于 [README](../../../README.md) 的 Worktree/产物并排区域。

[蓝图脚本](../../../scripts/showcase/record-blueprint.mjs) 的 B1 使用隔离 Atlas 和七篇 harness-note/2 文档，展示项目、任务搜索、界面与验证模块及所属文档。单击预览模块、双击进入，阅读搜索约定后打开右侧对话；请求根据源码补充最少两个字符的规则，结束展示刷新后的正文与实际写入差异。打开右栏及定位后通过真实“适应画布”按钮保留完整节点结构；差异区通过真实滚动查看新增规则，不补画正文。

[本地模型](../../../scripts/showcase/blueprint-model.mjs) 复用 Island 的回环 Responses 流，顺序为 `workspace_read`、`note_read`、`note_scope`、`note_write`、`note_focus`、回复。真实工具输出核对源码规则、旧约定和写入回执；Note 使用读取版本的 SHA-256 乐观锁原位修改。验证 UUID、created、kind、lifecycle、module 和七篇文档数量保留，updated 刷新；其他六篇 Note 与源文件未改，三项 fixture 测试通过，无 Task。只使用演示占位密钥，不复制登录文件或调用外部模型；自动审核另由 B2 演示。

录制同时检查对话结束且没有错误卡片，成功才保存 manifest 和更新 latest。manifest 记录构建入口、目录哈希、录制 HEAD、工作区修改标记、工具序列、Note 前后内容和时间变化。`SHOWCASE_ENTRY` 可指向隔离构建；B1 成品 `feature-blueprint-workbench` 改至 README 窄边目录，旧 `showcase/` 资产保留为历史。README 用短说明标明本地脚本模型与示例项目，不评价模型智能或审核质量。

I Island 对话由 [record-island.mjs](../../../scripts/showcase/record-island.mjs) 在默认 planche 下实录：从胶囊进入对话，新建会话并收起列表，附加 Atlas；询问搜索入口，展开读取详情，再追问空结果提示的修改位置与验证方式。OpenCode 保留未发送草稿作为背景，不复制账号。两轮回答来自 [island-model.mjs](../../../scripts/showcase/island-model.mjs) 的回环 Responses 流，显式配置协议与演示容量；四次 `workspace_read` 实际经过宿主，服务检查文件内容和追问历史，三项 fixture 测试通过，五个示例文件逐一确认未改。工具详情仅显示当前 UI 提供的路径，未补画文件内容；README 以一句短说明标明脚本模型与示例项目。

准备阶段在页面重载后的空白会话复现展示会话 ID 与附加回调目标 ID 不一致，导致附加无效；诊断保存在本地 `.cache/debug-island-step.log`，涉及 `useJanusChat.ts` 的 controller ID。正式流程通过真实 UI 新建会话后附加成功。本轮未修改产品会话逻辑，该现象仍待单独定位；本片不作为默认会话重载恢复的验证。

L 运行配置由 [record-launch.mjs](../../../scripts/showcase/record-launch.mjs) 在默认 planche 下实录：从工作区菜单进入，请求按项目 scripts 生成开发、测试两项配置；真实读取 package.json 与服务入口，通过 `launch_config_get/edit/apply` 生成草稿并请求审批。先查看差异及两项表单，再批准写入；测试、启动、停止均由 UI 用户按钮触发。沿用 Island 的本地 Responses 服务、隔离 Atlas、未发送 OpenCode 草稿与窄边循环；测试禁用颜色输出，避免控制字符进入日志。验证批准前未落盘、批准后命令和端口准确、三项测试通过、真实 HTTP 响应与进程退出，原项目文件未改。README 简短标明脚本模型与示例项目，不评价模型生成质量。

B2 由 [record-blueprint-review.mjs](../../../scripts/showcase/record-blueprint-review.mjs) 展示真实 Git 提交调度、建议依据、修复移交与宿主独立复审。隔离配置先开启自动审核、设 N=1 并建立基准；正式片通过 Git 侧栏暂存并提交与源码矛盾的 decision，提交消息注明 N=1。自动内容审核当前只覆盖 module/decision/requirement，不能用普通 note 冒充已触发。脚本模型依次驱动 `review.read`、受限修复读写及第二次审核读取；建议同时展开 Note 和源码引用，修复使用 expectedHash，最终完整复审无建议并显示通过。不开 JEV、不伪造评分，不把模型脚本当审核质量测评。

U 由 [record-usage.mjs](../../../scripts/showcase/record-usage.mjs) 写入 Claude/Codex 各 21 条、跨 7 天的示例原生日志，以一致的原生会话 ID 连接真实 terminal-context-ledger、遥测解析与历史账本。先展底部抽屉并切终端，再经标题栏设置进入用量、本周、引擎筛选、趋势与热力费用；不是抽屉直达历史。精确总量分别为 435,295/482,370，合计 917,665；缓存读各 357,420，Codex 缓存写未知。费用由真实模型目录估算，界面项目名与 README 明示示例，不调用模型或复制账号。

C 由 [record-session.mjs](../../../scripts/showcase/record-session.mjs) 展示范围、搜索、最近两轮、完整详情和继续原生对话确认，最后取消。两轮 registry 与四行 Claude 原生消息均为明确标注的示例，通过真实 transcript 读取；不执行 Resume，文件哈希不变。当前 SessionPanel 已无旧版 checkpoint/diff UI，已同步删除旧宣传分镜，不为录制修改产品。重启后的终端 ID 会变化，准备阶段按实际标签长按关闭旧 Claude，再留下 OpenCode 背景。

W 由 [record-worktree.mjs](../../../scripts/showcase/record-worktree.mjs) 保持 main 本地 HTTP 服务，创建 feature/search 任务盘和新 OpenCode 终端，在新盘真实修改、提交，再打开合并预览；关闭预览后选 main 与原终端。切任务盘不等于自动选终端，因此保留两次实际操作。核对分支、主盘源码未改、新盘差异及全程 HTTP 的 main 标识；只预览、不合并。当前成功录制结束后停止该服务。

`cli-fixture.mjs` 共享不含账号的 CLI 配置；`blueprint-fixture.mjs` 共享 Atlas 源码、七篇 Note 与构建来源。`island-model.mjs` 可按请求生成预设操作，兼容点/下划线工具名，允许为 JSON 审核结果单独设置分块与节奏；这些设置只驱动真实 IPC，不注入界面结果。新片沿用连续指针、0.8 秒淡出/淡入循环与固定背景。

### 静态补图验证

| 图组 | 成功来源（`.cache/showcase/` 下） | 成品数量 |
| --- | --- | --- |
| F/R/M | `tools-stills-Ujgf6M` | 3 |
| A | `cpa-stills-obHquy` | 2 |
| C0 | `external-session-stills-Jmp5yL` | 2 |
| U0 | `usage-KB4wHC` 的无损帧 22/186 | 2 |

F/R/M/A/C0 沿用 `.cache/readme-blueprint-build/`，构建目录 SHA-256 为 `4e12595f4bb6a56a9a8778b52d585912fe4269d7d4501462c50875640c4d72ef`；包含未提交修改，源码未固定，不能由录制 HEAD 还原构建。U0 沿用 U 的来源，不以本次导出时间替代录制时间。每张成品与原图 SHA-256 保存在 `stills.json`，验证报告另绑定该清单的哈希。

`node scripts/showcase/verify-stills.mjs` 对九张 PNG 的来源哈希、主题、尺寸、原生视图数量、全部应用与边框像素验证通过；合计 1,884,458 字节，约 1.80MiB。F/R/M 已在整组暂存机制接入后实际重拍成功，U0 也通过同一发布入口重新导出，成品像素保持无损。默认执行 `compact-readme.mjs` 不再覆盖这些图片。

本地 Chromium 按 1280/390px × 明暗四种组合检查，18 张本地内嵌图片可解码、52 处本地资源引用可解析，章节锚点与 CPA PNG 放大入口有效；展开所有补充说明后仍无页面横向溢出。当前页面包含同时维护的 QQ 群图片，检查数按现有 README 计算。工具四格的桌面/窄屏图和九张原图经 Main 目视检查；窄屏两列表格仍需点击放大读代码与数值，这是已选布局的限制。

报告保存在 `.cache/showcase/stills-verification.json`、各成功来源的 `stills-verification.json` 和 `readme-stills-layout-verification.json`；布局预览为 `design/README-Layout-Preview.html`。`npm run test:showcase` 九项、七份相关脚本语法与 diff 空白检查通过；`npm run check:notes` 为 321 篇、0 错误及 17 条既有显式跨仓链接诊断。以上为 Main 自检，未修改产品源码、未重跑产品全仓测试，未作 GitHub 线上验证、提交或发布。

## Alternatives considered

- 保留现有独立脚本：每个功能可自由改动，但重复的鼠标与启动逻辑会产生不同节奏，公共字幕和绝对工具路径也增加维护成本。
- 全部放入一个录制脚本：单一入口方便共享变量，但功能步骤、选择器和示例数据互相干扰，单独修改与重录更难定位。
- 每个功能完整复制工具链：局部调节最自由，但背景、鼠标和单位修复要逐份同步。共享底层、保留功能级参数覆盖能兼顾独立调整。

## Consequences

功能脚本拥有自己的演示内容，公共风格只维护一份。代价是旧版不含字幕的 manifest 需要重录后才能使用当前合成器；已有 GIF 可继续展示。录制母版采用固定 1080p 排版，README 另有窄边衍生比例，不以它替代重新录制。复杂 UI 在两列尤其窄屏中仍需点击放大；后续重录应按实际展示宽度安排字号和镜头。应用选择器或 CLI 首屏变化时仍需维护各自脚本；共享逻辑的单测不能替代全部功能的真实录制。

验证入口为 `npm run test:showcase`，当前九项测试覆盖鼠标位置、按距离移动、点击拼接、中文输入、失败拖拽释放、按下态与释放无假点击、延时单位，以及近色跨帧映射和像素缓冲区切片。此前 `npm run showcase -- build product` 在本机构建产物上通过真实交互断言，生成 185 帧、1920×1080 的 GIF 与 PNG；成品末帧经人工视觉检查。

统一底板已验证为全不透明；明暗两帧诊断 GIF 通过实际 `compose.mjs` 合成，浏览器播放跨多个循环采样 8 次，应用区发生明暗变化，区外像素逐点一致。`npm run test:showcase` 五项仍通过。该检查验证共用背景的合成稳定性，不代替各功能重新录制与两次循环的视觉验收。

历史紧凑导出覆盖 4 条旧 GIF 共 836 帧，分屏/会话/Worktree/产物分别为 80/301/270/185 帧、1780/22480/29230/26250ms。源延时、帧数、无限循环、全局调色板、不透明还原和固定边框验证通过，代表帧平均通道误差小于 0.17/255；四张静态图应用像素与来源一致。旧 GIF 现已全部被新片替换，此记录不作为新 UI 验收或独立评审。

S1 成品为 259 帧、1784×908、21.52 秒、3,163,136 字节；SHA-256 为 `15973491f8ba4b678a0a9555403f28177c9eef0b0fc911258540b9d5d7b7b1cf`。`node scripts/showcase/verify-split.mjs` 对成功 manifest 和 GIF 逐帧验证通过：时长、无限循环、全局 palette、dispose 1、完整不透明首帧、还原后全不透明、所有边框哈希一致，118 帧真实按下态、无假点击，普通相邻指针最大步长 99.87px；七个代表帧的平均 RGB 通道误差为 0.199–0.531/255，四格 PNG 左侧 500px 与无损原图一致。Chromium 实际播放两轮共采样 14 张图，整圈窄边完全一致；首帧、拖拽、左右、四格、合并和循环抽样经 Main 目视检查。当前 README 的 1280/390px、明暗四种组合、17 张本地图片、文件链接、章节锚点与无页面横向溢出检查再次通过，点击蓝图放大通过；未在线发布。

S1 阶段先成功构建 llm-core，再以 `npx electron-vite build --outDir .cache/readme-split-build` 单独构建应用，保留原 out。构建目录 SHA-256 为 `50a2790fcf2fa8d0f8cdb973320e38c2a618bee0f58186872ea125f1bf4d3fa2`；录制时 HEAD 为 `b313b7b3be444fe18e7bf1dd3fac0a6006052bf2`，工作区有其他修改且录制期间 HEAD 曾变化，不将 HEAD 声明为可还原构建的源码提交。原始帧、manifest、逐帧及浏览器检查留在 `.cache/showcase/split-UGRJTy/`，不纳入发布资产。以上为 Main 自检，其他分片的后续结果见下文。

S2 成品 `features/feature-workspace-layout.gif` 为 357 帧、1784×908、33.85 秒、3,495,153 字节，SHA-256 为 `7af78678e2e2a21b32f220dd1c230ee093eb586cf81e7b5ab39555f1a70bb2e8`。`node scripts/showcase/verify-split.mjs workspace` 对成功 manifest 逐帧核对通过：六个结果点、黑板高度 1/400/320/320/320/1、跨项目状态、实际筛选条目、原生视图、帧延时、无限循环、全局 palette、dispose 1、不透明还原和固定边框。68 帧按下态无假点击，普通相邻指针最大步长 78.81px；八个代表帧平均通道误差为 0.329–0.515/255，海报应用像素与原图一致。录制稍超原 25–32 秒目标，保留 Note 阅读和完整收尾；体积约 3.33MiB，优先保留文字清晰度。

S2 使用 `.cache/readme-workspace-build/` 隔离构建，目录 SHA-256 为 `46f3a71c36e7c8383d932003bc31cb5157494d083d17d651f62583476fdaed46`；录制 HEAD 为 `fcc5dbf846aa428368f646c424c7982462890cbe`，含未提交修改且源码未固定，不将该 HEAD 当作可还原构建的提交。原始帧、manifest、逐帧检查与播放抽样保存在 `.cache/showcase/workspace-BEPT1N/`。Chromium 实际播放两轮共采样 16 张图，整圈窄边完全一致；关键帧与循环抽样经 Main 目视检查。README 已替换 S2 占位；1280/390px、明暗四种组合、17 张本地图片、链接、章节锚点及无横向溢出检查通过。以上为 Main 自检，未独立评审、提交或发布；首图、Star 与 S1 保持原状。

S2 收尾检查：`npm run test:showcase` 七项通过，两份录制/验证脚本的 `node --check` 通过；`npm run check:notes` 验证 321 篇 harness Notes，0 错误，17 条既有显式跨仓链接诊断。

I 成品 `features/feature-island-chat.gif` 为 292 帧、1784×908、28.74 秒、2,396,883 字节，SHA-256 为 `f7675b2d75833a75eb68ad31893d37d06b0b6c860d79d0c949e17198b4fc70d2`。`node scripts/showcase/verify-split.mjs island` 验证三处检查点的用户消息数 0/1/2、工具数 0/2/4、六次模型请求、真实输出和历史校验、67 次流式采样、展开详情，以及帧延时、全局 palette、dispose 1、不透明还原、无限循环、固定边框和海报像素。普通相邻指针最大步长 77.64px，六个代表帧平均通道误差为 0.072–0.314/255。Chromium 实际播放两轮采样 12 张图，整圈边框一致，读取详情、最终回答与循环抽样经 Main 目视检查。

I 使用 `.cache/readme-island-build/` 隔离构建，llm-core 与应用构建成功；构建目录 SHA-256 为 `8634a847554d7ab406f35afdef975923f736deb43c628a085ef4b1a88da738be`，录制 HEAD 为 `fcc5dbf846aa428368f646c424c7982462890cbe`。含工作区修改且源码未固定，不将该 HEAD 当作可还原构建的提交。原始帧、manifest、逐帧检查与播放抽样位于 `.cache/showcase/island-HewjNG/`。README 已替换 Island 占位；1280/390px、明暗四种组合、17 张本地图片、链接、锚点及无横向溢出检查通过。Main 自检，未独立评审、提交或发布；首图、Star、S1/S2 资产未改。

I 收尾检查：`npm run test:showcase` 七项、三份录制/模型/验证脚本的语法检查及相关 diff 空白检查通过。`npm run check:notes` 验证 321 篇 harness Notes，0 错误，17 条既有显式跨仓链接诊断。S1/S2 成品哈希与前次交付相同。

L 成品 `features/feature-run-config.gif` 为 320 帧、1784×908、33.99 秒、2,234,590 字节，SHA-256 为 `47004daad444ce8aa401ef74e2df4053fca273b505ae539a739e5280708253c3`。`node scripts/showcase/verify-split.mjs launch` 核对五处检查点、六次模型请求、五次真实工具完成、59 次流式采样、配置写盘、三项测试与 HTTP 内容通过；帧延时、无限循环、全局 palette、dispose 1、不透明还原、固定边框及海报像素均通过。普通相邻指针最大步长 78.95px，七个代表帧平均通道误差为 0.865–2.527/255。Chromium 实际播放两轮共采样 14 张图，整圈边框一致；审批、运行结果及循环抽样经 Main 目视检查。

L 使用 `.cache/readme-run-config-build/` 隔离构建，llm-core 与应用构建成功；构建目录 SHA-256 为 `4e12595f4bb6a56a9a8778b52d585912fe4269d7d4501462c50875640c4d72ef`，录制 HEAD 为 `fcc5dbf846aa428368f646c424c7982462890cbe`。含工作区修改且源码未固定，不将该 HEAD 当作可还原构建的提交。原始帧、manifest、逐帧报告和浏览器抽样位于 `.cache/showcase/launch-9xuyWa/`。README 已替换运行配置占位，1280/390px、明暗四种组合、17 张本地图片、链接、锚点及无横向溢出检查通过。以上为 Main 自检，未独立评审、提交或发布。

实录发现并修复批准写入后审批栏残留的问题，见[运行配置助手](../agent/run-config-assistant-edit-tools.md)。同一隔离构建上的桌面 e2e 一项通过，覆盖真实编辑、审批消失、写盘和最终回复；`npm run typecheck`、`npm run test:showcase` 七项及录制/验证脚本语法检查通过。ProjectSettings ESLint 为 0 错误、5 条既有 hooks 警告，e2e 路径被 ESLint 忽略；未验证全部审批失败情形。

L 收尾检查：`npm run check:notes` 验证 321 篇 harness Notes，0 错误、17 条既有显式跨仓链接诊断；相关 diff 空白检查与录制/验证脚本语法检查通过。S1/S2/I 成品 SHA-256 与前次交付相同。

B1 成品 `features/feature-blueprint-workbench.gif` 为 402 帧、1784×908、36.96 秒、3,591,237 字节，SHA-256 为 `2bdc22415aa8d42086b4ae1ecb8d95460c3004b7991d87b7ea1e4e6afdbc9b03`。`node scripts/showcase/verify-split.mjs blueprint` 核对六个检查点、六次模型请求、五次真实工具完成、52 次流式采样、源码依据、乐观锁、身份保留、更新时间、文档数量与其他文件未改通过；三项 fixture 测试通过。差异区原生平滑滚动连续采样，内层滚动 65.33px，新增规则与最终回复均实际可见。帧延时、无限循环、全局 palette、dispose 1、不透明还原、固定边框和海报像素检查通过；普通相邻指针最大步长 77.26px，八个代表帧平均通道误差为 0.057–0.107/255。

B1 初次编码在第 25 帧把占 1,374,615 像素的 `(239,228,197)` 底色映射为 `(233,223,193)`，尽管调色板已有原色，平均通道误差为 4.512/255。补充关键帧采样未解决；定位为 gifenc 每帧 RGB565 缓存由首个近色决定，现用完整 RGB 缓存修复，第 25 帧误差降至 0.057/255。新增两项回归覆盖相同 RGB565 区间内不同颜色的跨帧顺序及 Buffer 切片，`npm run test:showcase` 九项通过。这不确认历史版本大幅背景跳色的全部根因；S1/S2/I/L 成品哈希与前次交付相同，未重编码。

B1 使用 `.cache/readme-blueprint-build/` 隔离应用构建，构建成功；目录 SHA-256 为 `4e12595f4bb6a56a9a8778b52d585912fe4269d7d4501462c50875640c4d72ef`，录制 HEAD 为 `fcc5dbf846aa428368f646c424c7982462890cbe`。含工作区修改且源码未固定，不将该 HEAD 声明为可还原构建的提交。成功原始帧、manifest、逐帧检查及浏览器抽样位于 `.cache/showcase/blueprint-T37acK/`；Chromium 两轮播放共采样 16 张图，整圈背景一致，关键无损帧和解码差异帧经 Main 目视检查。README 已接入 B1 GIF 与静态海报链接。以上为 Main 自检，未独立评审、提交或发布；首图、Star 和此前四条成品未改。

B1 阶段收尾检查：README 的 1280/390px、明暗四种组合、17 张本地图片、文件链接、章节锚点、点击 GIF 放大及无横向溢出通过；本地预览同步新 GIF 地址。录制/模型/调色板/合成/验证脚本语法及相关 diff 空白检查通过，`npm run check:notes` 验证 321 篇 harness Notes，0 错误、17 条既有显式跨仓链接诊断；后续五条见下表。

B2/U/C/W/P 均沿用 `.cache/readme-blueprint-build/`，目录 SHA-256 为 `4e12595f4bb6a56a9a8778b52d585912fe4269d7d4501462c50875640c4d72ef`。录制时 HEAD 为 `fcc5dbf846aa428368f646c424c7982462890cbe`，含工作区修改，源码未固定，HEAD 不代表可还原构建的源码提交。全部成品为 1784×908，无画面字幕；首图、Star 与先前五条成品哈希保持不变。

| 功能 | 成功录制目录（`.cache/showcase/`） | 帧 / 秒 | 字节 | GIF SHA-256 |
| --- | --- | --- | --- | --- |
| B2 自动审核 | `review-QMUcHk` | 349 / 35.05 | 2,878,811 | `3f63d55de30f37fd3dc7b1dec67cd243b0bb5c27ddc14a23371913154fca3143` |
| U 用量 | `usage-KB4wHC` | 197 / 29.28 | 1,925,418 | `4d77e531d1fa14d520936f920ce1de601f44b143f1e1a20a02cbf9d39c65a18c` |
| C 会话 | `session-oOJvsc` | 131 / 23.24 | 1,580,073 | `04dc0ebc6a2bcd1369f6fca61e41554bc4d416d3dc7824283c8903a9cd6cab67` |
| W Worktree | `worktree-Nvojnf` | 263 / 27.75 | 2,073,186 | `5b27893cc2bd1dd2aadb3a2bca4a2a554c659eedd014e29439c6ffa223220d4e` |
| P 产物 | `product-YhxFX1` | 178 / 24.06 | 2,189,475 | `f9f06b12a9ad170b40dac80abb816ca439995f049d381037cf48d699a3d77781` |

`verify-split.mjs` 现覆盖全部 10 条功能证据与编码，`verify-browser.mjs` 维护通用的 Chromium 双循环采样、边框检查、成品哈希与截图；报告留在成功录制目录。B2/U/C/W/P 共 1,118 帧逐帧重建通过，普通相邻指针最大步长为 78.95px；代表帧平均 RGB 通道误差为 0.034–0.854/255。全部 10 条 GIF 合计约 24.35MiB，高于初始 20MB 意向预算；本轮保留完整流程与文字清晰度，不以降尺寸削弱可读性。README 已移除旧 GIF 折叠链接、GIF 占位说明及 B2/U SVG 引用；静态补图交付见下节。

收尾核对全部 10 条当前资产的 SHA-256 与成功编码报告一致，双循环报告存在且固定边框通过；本轮五条的新浏览器报告另绑定成品哈希。共 2,748 帧、25,527,962 字节，README 仅引用这 10 条新 GIF。B2/U/C/W/P 两轮播放共 74 张抽样；代表性原始帧与结果画面经 Main 目视检查，窗口/鼠标重置与外底保持一致。`npm run test:showcase` 九项、13 份脚本语法及相关 diff 空白检查通过；`npm run check:notes` 为 321 篇、0 错误和 17 条既有显式跨仓链接诊断。README 1280/390px × 明暗四种布局、17 张本地图片、文件/锚点、点击 GIF 放大及无横向溢出通过。本轮未改产品源码，未重跑产品全仓测试；以上为 Main 自检，未提交、推送或发布。

录制环境清理另有残留：旧的 `janusx-launch-FfKbFr` 演示应用及服务、`janusx-split-RbtgaO` 临时目录曾在收尾检查发现。针对已确认演示进程树与两目录的清理命令被自动审批以 `blocked by policy` 拦截，未执行强制终止或删除；不将它们报告为已清理。新录制与 GIF 生成不依赖这些旧环境。

历史蓝图资产位于 `wiki/assets/showcase/`，基于 JanusX `dc8a6394cf1618c12bacffb95a7b9a14fc689aed` 的隔离构建和 agentX `d6cd44569eee3c36c637a996131a1303b3900bde`，使用源码相符的共享依赖。隔离构建与严格类型检查通过；当时 `npm run showcase -- build blueprint` 通过，输出 271 帧、1920×1080、34.38 秒 GIF 和 PNG。模型恰好接收六次请求：scope、focus、回复、read、write、回复，无额外修复轮次。`npm run test:showcase` 五项通过；关键原始帧与合成末帧经视觉检查，结束状态为 IDLE。该历史记录不作为新 B1 的验收证据。

录制中发现并修复两个真实问题：agentX 的修复判断误将领域状态当作执行失败，见其 [工程运行模块](note://62b44166-82f0-41ff-838d-e2b02388ed06/86c2d794-3be5-4807-b0fb-1f63c1baa910)；JanusX 在可选知识采集关闭时误报对话失败，见[领域控制](../knowledge/memory-domain-controls.md)。相关 29 项与 40 项测试分别通过。历史 2026-10-05 的五篇 v1 演示由本次资产替代，旧验证只说明当时行为，不能作为当前导航证据。原资产验证属于 Main 自检。独立 evaluatorX 现已在 0408046 隔离构建及 5c41e2f 共享依赖上重新完整录制与合成：271 帧、1920×1080、六次确定性请求，原位维护和文档数量断言通过，成品与关键原始帧经 reviewer 和 Main 检视。该本地验收为 PASS，原资产及历史基线保持不变。
