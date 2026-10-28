# README 功能演示录制

一个功能对应一个 `record-*.mjs`：示例数据、操作步骤、断言和字幕都放在该脚本里。所有功能共用启动、鼠标、背景和 GIF 合成逻辑。脚本驱动真实 Electron 应用，截图中保留真实界面；虚拟鼠标和字幕在合成阶段叠加。

## 功能与入口

README 的 10 条功能 GIF 均已适配新 UI，直接输出至 `wiki/assets/readme/features/`。运行 `npm run showcase -- list` 可查看入口；`hero`、`filetree`、`browser`、`markdown` 保留为旧版录制工具，不属于这 10 条新片。

| 功能 ID | 独立脚本 | GIF / PNG 文件名 |
| --- | --- | --- |
| `hero` | `record-hero.mjs` | `hero-planche` |
| `worktree` | `record-worktree.mjs` | `feature-worktree` |
| `session` | `record-session.mjs` | `feature-session` |
| `filetree` | `record-filetree.mjs` | `feature-filetree` |
| `split` | `record-split-quad.mjs` | `feature-split` |
| `workspace` | `record-workspace-layout.mjs` | `feature-workspace-layout` |
| `browser` | `record-browser.mjs` | `feature-browser` |
| `markdown` | `record-markdown.mjs` | `feature-markdown` |
| `blueprint` | `record-blueprint.mjs` | `feature-blueprint-workbench` |
| `review` | `record-blueprint-review.mjs` | `feature-blueprint-review` |
| `usage` | `record-usage.mjs` | `feature-usage` |
| `island` | `record-island.mjs` | `feature-island-chat` |
| `launch` | `record-launch.mjs` | `feature-run-config` |
| `product` | `record-product.mjs` | `feature-product` |

总览使用静态首图；工具集成使用图片。`probe-models.mjs` 是手动诊断工具，不是功能录制入口。旧版资产留在 `wiki/assets/showcase/` 供追溯，README 不再引用旧 GIF。

## 准备与运行

先按根 README 安装项目依赖，再执行 `npm run build`，确保 `out/main/index.js` 是需要录制的版本。合成还需要 Playwright Chromium，以及安装在仓库外的 `pngjs`、`gifenc`：

```powershell
npx playwright install chromium
npm install --prefix "$env:TEMP/opencode/giftools" --no-save pngjs gifenc gifuct-js
```

默认从系统临时目录的 `opencode/giftools` 读取编码工具；其他位置可设置 `SHOWCASE_GIFTOOLS` 为包含 `node_modules` 的目录。录制应用本身不依赖这些编码工具，浏览器演示的原生视图截图合成除外。

```powershell
# 只更新一个功能：录制并合成
npm run showcase -- build product

# 多个功能按顺序独立运行
npm run showcase -- build browser markdown

# 分开执行，调整背景或鼠标后无需重录
npm run showcase -- record product
npm run showcase -- compose product

# 直接使用独立脚本也会更新该功能的 latest 指针
node scripts/showcase/record-product.mjs

# 指定录制目录、另存成品；参数支持空格或等号
node scripts/showcase/compose.mjs --manifest .cache/showcase/product-xxxxxx --out showcase/product-review --tempo 0.8
```

原始帧和包含字幕、鼠标位置的 `manifest.json` 保存在 `.cache/showcase/<功能>-<随机后缀>/`。成功录制才更新 `.cache/showcase/<功能>-latest.json`；失败返回非零退出码，`build` 随即停止，不会拿旧帧合成。合成只写指定功能的 GIF 与 PNG；PNG 使用 manifest 的 `posterFrame`，未指定时采用末帧。旧版缺少字幕的 manifest 需重新录制，已提交 GIF 不受影响。

各录制实例使用独立临时目录。新片需要对应 CLI 已安装：S1 使用 Claude、Codex、OpenCode、Pi，U 使用 Claude/Codex，其余多以 OpenCode 为背景，C 的准备阶段另启动 Claude。共享 `cli-fixture.mjs` 创建演示配置和回环占位地址，不复制账号、不发送终端草稿；Windows 演示项目放在 `%PUBLIC%/janusx-split-*/Atlas`，避免加载真实仓库上下文，退出后清理。I/L/B1/B2 的本地脚本模型只驱动真实工具链；C/U 使用明确标注的示例日志或会话，P 使用实际本地测试生成报告。旧入口若仍调用 `seedFixture`，可能复制本机 CLI 登录文件，不能套用新片的隔离结论。

`blueprint` 使用七篇 harness-note/2 文档，展示项目入口、子模块与所属文档；从搜索模块进入对话，核对源码并原位补充现有约定，展开实际写入差异，再回到更新后的正文。UUID、created、文档数量及其他 Note 不变，updated 刷新；不新建 Task。

蓝图录制的 `blueprint-model.mjs` 复用 `island-model.mjs` 的回环 Responses 流，只驱动预设操作；真实 Electron、IPC、Note 工具和磁盘写入仍照常运行。不复制登录文件，不调用外部模型；这些断言不评价模型质量。录制成功后，manifest 的 evidence 保存工具调用、文档前后内容、身份、时间变化和构建来源。

需要录制隔离版本时，设置 `SHOWCASE_ENTRY` 为该版本已构建的 `main/index.js` 绝对路径。默认入口为当前目录的 `out/main/index.js`；必须自行核对应用和共享依赖来源。新片保存构建目录哈希、录制 HEAD 与工作区修改标记；未固定源码时，HEAD 不表示可还原构建的源码提交。录制会等待对话结束并检查错误卡片，成功写文件但对话报错也会失败。

## 调整公共参数

修改 [showcase-config.mjs](./showcase-config.mjs)：

| 参数 | 控制内容 | 是否需要重录 |
| --- | --- | --- |
| `style.background.asset` | 首图与所有演示共用的固定 PNG 底板 | 否，重新合成 |
| `style.cursor` | 鼠标尺寸、填充、描边、点击圈半径 | 否，重新合成 |
| `style.ink / accent` | 外框、字幕与强调色 | 否，重新合成 |
| `style.theme` | 应用主题 | 是 |
| `timing` | 运动帧时长、悬停、点击、定格、逐字输入、移动步数 | 是 |
| 合成参数 `--tempo` | 整段播放延时倍数，`0.8` 更快，`1.2` 更慢 | 否 |

标准画布采用 `1920×1080` 排版，应用视口 `1760×884`；10 条新片直接从原始 PNG 合成 `1784×908` 窄边画布，不烧录字幕。八条使用默认 planche，会话和产物使用 dark；单片固定主题。可用 `--framing standard|compact` 显式选择装帧；包含循环淡出的 manifest 必须使用 compact。`layout` 集中保存尺寸和落点。

首图及后续 GIF、静态图统一使用 [showcase-background.png](../../wiki/assets/readme/showcase-background.png)。底板源文件是同目录的 `showcase-background.svg`，采用原创 macOS 壁纸感的雾银灰、烟青与少量香槟灰流动曲面；以低饱和、中等明度兼顾经典黑与石板色，不随应用明暗主题改变。修改 SVG 后执行 `node wiki/assets/readme/render-hero.cjs`，重新生成固定底板与 README 首图；公共合成器逐帧复制这同一张不透明 PNG，并校验 1920×1080 尺寸。`showcase/` 旧母版保持现状，README 窄边衍生素材按下节生成；后续录制与合成直接沿用新底板。

`record-motion.mjs` 的延时参数以 **百分之一秒** 为单位，`timing.motion=4` 表示 40ms（运动约 25fps），`timing.hold=120` 表示 1.2 秒。manifest 的 `delay` 与 GIF 编码器统一使用 **毫秒**。应用等待用真实毫秒，等待界面就绪不会自动变成视频停顿。脚本里的显式节奏参数是该功能的局部覆盖；单独覆盖整套默认值可传 `snapper(page, rawDir, frames, shot, { hold: 160 })`。

## README 紧凑装帧

README 核心功能采用左文右图，Worktree 与产物并排，工具集成采用 2×2。运行以下命令，用现有素材生成适合这些布局的窄边衍生图：

```powershell
npm install --prefix "$env:TEMP/opencode/giftools" --no-save pngjs gifenc gifuct-js
node scripts/showcase/compact-readme.mjs
```

脚本沿用 `SHOWCASE_GIFTOOLS`，默认跳过所有已更新的功能 GIF 和静态图。仅在追溯旧素材时显式传 `--legacy-stills`，该参数会用旧图覆盖文件、浏览器、Markdown 和旧蓝图衍生图，使用前需另存当前资产。当前图片用下节的截图入口更新。

旧画布仅取 `(80,28)` 起的完整 `1760×884` 应用窗口，去掉外围装饰与底部字幕区；新 UI 蓝图原图直接装帧。四边各留 12px，成品 `1784×908`，约 96% 的面积用于应用界面。所有窄边共用统一底板，窗口内部不染色、不裁侧栏。占位 SVG 使用相同比例。

GIF 逐帧还原后重编码，保留源帧数、每帧延时及无限循环；每片使用一个全局调色板、透明差分与 `dispose: 1`，背景边框单独固定映射，避免 RGB565 扫描缓存让背景随应用颜色变化。脚本只接受现有尺寸、完整不透明首帧及保留画面的 disposal，其他输入会报错。PNG 的应用像素原样复制，GIF 有再次量化损失；另导出末帧 PNG 供检查。

上述脚本只调整旧素材的装帧；新片由各自的录制脚本直接生成，不能以装帧替代新 UI 重录。

## 静态图片 F/R/M/A/U0/C0

六组补图共九张已接入 README。H 首图沿用现有构图，B0 使用 B1 的结果海报。静态成品同为 `1784×908`，来自 `1760×884` 无损应用截图与四边 12px 公共底板；浏览器和 CPA 另截取当前主窗口挂载的原生网页，按真实边界合入。

| 入口 | 产物与主题 | 来源与检查 |
| --- | --- | --- |
| `capture-tools.mjs` | filetree（dark）、browser（planche）、markdown（dark） | 文件搜索、真实 Git 标记与嵌入代码；两个网页标签与两条筛选结果；Atlas 文稿归属、检查清单与分栏预览。fixture 三项测试通过 |
| `capture-cpa.mjs` | cpa、cpa-settings（planche） | 官方后端 v8.0.31、管理页 v1.26.5；新托管实例，0 账号、0 调用，设置图不显示管理密钥 |
| `export-usage-stills.mjs` | usage-drawer、usage-statistics（planche） | 从成功 U 录制的无损帧 22/186 导出，分别为抽屉与热力图阶段，不从 GIF 解码 |
| `capture-external-session.mjs` | session-external-list、session-external（dark） | 示例 Claude JSONL 经真实扫描与转录读取，验证两轮、外部标记与续接入口；未执行 Resume |

浅色主题的 Markdown 编辑区当前使用固定浅色文字，截图采用产品已有 dark 主题保持可读；未为展示修改产品样式。所有截图使用隔离配置，不复制账号、不发送终端草稿。截图及断言全部成功后才发布整组图片并更新 `<功能>-stills-latest.json`；原始图、哈希、主题、原生视图边界与构建来源保存在同目录 `stills.json`。

```powershell
# 先构建目标版本并设置 SHOWCASE_ENTRY / SHOWCASE_GIFTOOLS
node scripts/showcase/capture-tools.mjs
node scripts/showcase/capture-external-session.mjs
node scripts/showcase/export-usage-stills.mjs
# 默认读取 usage-latest.json，也可传成功 U 录制目录

# CPA 仅复制指定版本组件，不读取原实例配置或账号
$env:SHOWCASE_CPA_COMPONENTS = 'C:/path/to/janusx/components/cpa'
node scripts/showcase/capture-cpa.mjs

node scripts/showcase/verify-stills.mjs
```

CPA 入口固定校验组件 ID `v8.0.31-v1.26.5-28bde34eb33a` 和二进制/页面 SHA-256，并获取对应前端 LICENSE；升级版本须同步校验值。`verify-stills.mjs` 检查全部九张图的成功记录、成品/原图哈希、尺寸、主题、原生视图数量和逐像素无损装帧，验证用量原始帧与 manifest 对应关系，报告写入各录制目录及 `.cache/showcase/stills-verification.json`。原始素材在本地缓存中，干净 checkout 需要先重录，不能仅凭已提交 PNG 重建来源证据。

## 终端分屏 S1

`record-split-quad.mjs` 使用默认 planche 主题，预先创建 Claude、Codex、OpenCode、Pi 四个真实 CLI，再处理首次设置与任务草稿，避免 CLI 启动重绘干扰终端菜单。正式镜头为单窗 → 左右分屏 → 2×2 → 拖动分隔线 → Pi 合入 Codex 标签栏。断言检查窗格数、四个标签持续存在、四格草稿可见、比例变化和最终归属。

运动帧为 40ms，悬停 300ms，结果停留 1.3–2 秒；移动按距离分配帧数并衔接上一指针位置。拖拽用深色指针表达按下，释放不显示点击圈。末尾保留结果后，用 0.8 秒同步淡出/淡入窗口与指针回到开头，外侧背景保持固定。PNG 海报取调整比例后的四格状态。

```powershell
# 从当前工作区单独构建，不覆盖 out
npm run build:llm-core
npx electron-vite build --outDir .cache/readme-split-build
$env:SHOWCASE_ENTRY = (Resolve-Path .cache/readme-split-build/main/index.js).Path
$env:SHOWCASE_GIFTOOLS = "$env:TEMP/janusx-readme-giftools"
node scripts/showcase/record-split-quad.mjs
node scripts/showcase/compose.mjs --feature split
node scripts/showcase/verify-split.mjs
```

编码工具目录需先按前文安装 `pngjs`、`gifenc`、`gifuct-js`。验证脚本将 GIF 与成功录制的本地 manifest 逐帧核对：尺寸、帧数、延时、循环、全局调色板、固定边框、透明帧还原、指针步长及代表帧误差，并检查四格 PNG；结果写回该录制目录的 `verification.json`。首次录制的构建包含工作区修改，manifest 记录录制时的 HEAD、dirty 标记和整个构建目录哈希；源码未在构建时固定，`recordingHead` 不表示可还原构建的源码提交。

## 特色协同分屏 S2

2026-10-27：录制与验证脚本已移除退役副黑板步骤，现为工具布局与跨项目切换三个检查点。旧 S2 素材尚未重录，README 已撤下该旧动图。

`record-workspace-layout.mjs` 使用默认 planche，准备 Atlas 与 Beacon 两个 Git 项目，各有 OpenCode、Pi 两个真实 CLI 和未发送草稿。正式镜头展开工具区，将 Markdown 拖至浏览器下方，折叠笔记列表并切到预览；切换 Beacon、返回 Atlas。

浏览器展示回环 HTTP 服务上的任务看板，保留 `search` 筛选；Markdown 明确归属 Atlas。脚本不复制账号或会话，不发送模型请求，临时项目与配置在退出时清理。

每个结果检查点记录项目终端、工具窗格、内外分隔比例、文稿归属/标题/预览、浏览器实例 ID 和页面加载标识/筛选/滚动位置。切换项目后逐项核对，防止把重新打开的页面误当作原实例保留。录制固定主窗口句柄并匹配内容区与录制视口；原生浏览器截图仅来自该窗口实际挂载的 WebContentsView，按 Electron 返回的真实边界合成，同时检查网页截图像素与筛选结果；拖拽期间使用产品自身的冻结画面，避免网页覆盖拖拽提示。

```powershell
npm run build:llm-core
npx electron-vite build --outDir .cache/readme-workspace-build
$env:SHOWCASE_ENTRY = (Resolve-Path .cache/readme-workspace-build/main/index.js).Path
$env:SHOWCASE_GIFTOOLS = "$env:TEMP/janusx-readme-giftools"
npm run showcase -- build workspace
node scripts/showcase/verify-split.mjs workspace
```

编码、指针节奏、窄边背景与循环方式复用 S1。PNG 海报取终端与工具同时可见的状态。录制检查当前可见项目的窗格，隐藏项目缓存不计入当前布局；Markdown 拖至新窗格会重新挂载，预览模式在分屏后通过真实按钮选择。

## Island 对话 I

`record-island.mjs` 从胶囊进入对话，新建会话、收起会话列表并附加 Atlas；首轮询问搜索入口，第二轮追问空结果提示的修改位置与验证方式。中间展开一次读取详情，结尾保留建议。背景是 OpenCode 的未发送草稿，使用默认 planche 和统一窄边底板。

`island-model.mjs` 在回环地址提供脚本化 Responses 流；显式配置协议及演示模型容量，不调用外部模型或复制账号。四次 `workspace_read` 通过真实宿主执行，模型服务核对文件输出和第二轮历史。脚本验证三项 fixture 测试、两轮消息、工具完成状态、流式中间态、无错误卡片和源码未改；工具详情按实际 UI 展示路径，不补画文件内容。

```powershell
npm run build:llm-core
npx electron-vite build --outDir .cache/readme-island-build
$env:SHOWCASE_ENTRY = (Resolve-Path .cache/readme-island-build/main/index.js).Path
$env:SHOWCASE_GIFTOOLS = "$env:TEMP/janusx-readme-giftools"
npm run showcase -- build island
node scripts/showcase/verify-split.mjs island
```

PNG 海报取第二轮回答结束状态。manifest 保存六次模型请求的工具、真实输出和历史校验结果，以及展开详情的帧号；编码验证复用 S1/S2 的固定背景、指针、循环和海报检查。演示说明仅表明界面及工具链可复现，不评价模型回答质量。

## 运行配置对话生成 L

`record-launch.mjs` 从 Atlas 工作区菜单进入运行配置，请求根据 scripts 生成开发、测试两项配置。复用 `island-model.mjs` 的本地脚本模型，真实读取 package.json 和服务入口，再执行 `launch_config_get/edit/apply`。先看差异、查看两项表单并批准写入，然后由用户点击测试和启动；结束保留测试通过与运行状态。开发服务是本地 Node HTTP 服务，不依赖外部模型或账号。

脚本检查批准前配置文件不存在，批准后两项命令与端口准确落盘、审批栏消失、三项测试通过、真实进程日志及 HTTP 返回内容；录制完成后通过用户工具栏停止服务并核对进程退出。测试进程禁用颜色输出，避免控制字符进入日志面板。manifest 保存流式中间态、五个检查点、模型调用、文件内容、进程与构建证据；这验证产品操作链，不评价模型生成质量。

```powershell
npm run build:llm-core
npx electron-vite build --outDir .cache/readme-run-config-build
$env:SHOWCASE_ENTRY = (Resolve-Path .cache/readme-run-config-build/main/index.js).Path
$env:SHOWCASE_GIFTOOLS = "$env:TEMP/janusx-readme-giftools"
npm run showcase -- build launch
node scripts/showcase/verify-split.mjs launch
```

对应审批回归可用 `JANUS_DESKTOP_MAIN` 指向同一构建，执行 `npx playwright test tests/e2e/run-config-assistant.spec.ts --project=desktop --workers=1`。若环境启用了代理，设置 `NO_PROXY=127.0.0.1,localhost`；可用 `JANUS_E2E_PORT` 指定测试服务器端口。

## 蓝图对话维护 B1

`record-blueprint.mjs` 用 Atlas 的搜索约定演示完整维护：根模块概览、单击预览、双击进入搜索模块、阅读旧约定、打开右侧对话，再请求按实现补充最少两个字符的规则。实际调用 `workspace_read`、`note_read`、`note_scope`、`note_write`、`note_focus`，结束展示正文刷新与真实写入差异。打开右栏及定位后通过产品的“适应画布”按钮保持模块结构可见。

脚本验证三项源码测试、工具读取输出、Note 的 SHA-256 乐观锁、身份与创建时间保留、更新时间刷新、七篇文档无重复、其他 Note 和源文件未改。PNG 海报取收起差异后的更新正文和回答；自动审核与修复由 B2 单独演示。示例源码、Note 和构建来源逻辑由 `blueprint-fixture.mjs` 共享。

```powershell
npm run build:llm-core
npx electron-vite build --outDir .cache/readme-blueprint-build
$env:SHOWCASE_ENTRY = (Resolve-Path .cache/readme-blueprint-build/main/index.js).Path
$env:SHOWCASE_GIFTOOLS = "$env:TEMP/janusx-readme-giftools"
npm run showcase -- build blueprint
node scripts/showcase/verify-split.mjs blueprint
```

## 蓝图自动审核与修复 B2

`record-blueprint-review.mjs` 先配置演示模型、开启自动审核并建立 Git 基准，再通过真实 Git 侧栏提交一篇与源码矛盾的 decision。演示频率为 N=1，提交消息显式注明；产品默认仍为关闭、N=5。普通 note 不在当前自动内容审核的类型集合内，不能替代 decision/module/requirement。

提交实际触发调度器；审核工具读取 Note 与源码，建议同时展示两份引用。点击“修复本篇”后，右侧修复卡片经受限工具读写文件，再由宿主独立读取当前材料并复审；最后显示“已修复，审核通过”和真实差异。不开启 JEV、不伪造评分，脚本模型不代表审核智能质量。manifest 保留提交、活动事件、修复阶段、工具输出与最终审核报告。

## 用量 U、会话 C、Worktree W 与产物 P

| 功能 | 演示流程 | 数据与验证边界 |
| --- | --- | --- |
| `usage` | Claude/Codex 底部抽屉 → 聚焦切换 → 用量设置 → 本周 → 引擎筛选 → 趋势 → 热力与费用 | 7 天各 21 条示例原生日志，真实解析、上下文 ledger 与历史汇总；总量分别为 435,295/482,370，合计 917,665。缺失的缓存写入保持未知，费用由模型目录估算 |
| `session` | 范围/搜索 → 两轮记录 → 详情 → 继续原生对话确认 → 取消 | 隔离 registry 与四行示例 Claude 原生消息经真实读取；不执行 Resume、不调用模型，文件未改。当前会话界面没有旧版还原点/diff 入口，不为录制增加产品功能 |
| `worktree` | main 服务运行 → 创建 feature/search → 新终端开发 → 合并预览 → 回 main 及原终端 | 真实 Git worktree 与提交，主盘文件未变、HTTP 服务保持 main；只预览、不合并。切任务盘与选择原终端是两个真实操作 |
| `product` | 实际测试生成 HTML → Island 提醒 → 交互预览 → JSON 标签 → 更新后重新加载 | 本地 Node 测试 3 项变为 4 项，HTML 从 3/3 更新到 4/4；JSON 保留第一版结果。预览与文件发现均走产品组件 |

每条新片均导出同名 PNG 海报。新片命令可按功能独立运行：

```powershell
# 先按前文构建并设置 SHOWCASE_ENTRY / SHOWCASE_GIFTOOLS
npm run showcase -- build review usage session worktree product
foreach ($feature in @('split','workspace','island','launch','blueprint','review','usage','session','worktree','product')) {
  node scripts/showcase/verify-split.mjs $feature
  if ($LASTEXITCODE -ne 0) { throw "编码验证失败：$feature" }
  node scripts/showcase/verify-browser.mjs $feature
  if ($LASTEXITCODE -ne 0) { throw "播放验证失败：$feature" }
}
npm run test:showcase
```

`verify-split.mjs` 支持全部 10 条，先核对功能证据，再检查 GIF 全帧重建、延时、全局 palette、dispose、无限循环、边框、海报和指针步长，生成 `verification.json`。`verify-browser.mjs` 在真实 Chromium 播放两轮，采样各结果点和循环淡入淡出，保存截图与含成品 SHA-256 的 `browser-verification.json`。报告与原始帧留在本地 `.cache/showcase/`，生成资产位于 README features 目录。

## 修改一个功能

在对应脚本修改 `captions` 和操作序列。字幕与原始帧一起写入 manifest，重合成不读取别的功能脚本；`showcase-caption.html` 只负责字幕样式。

共享的 `snapper` 提供：

- `clickSnap(locator, caption, { double: true })`：移动、悬停、点击、退去点击圈；省略第三个参数为单击。
- `typeSnap(locator, text, caption)`：聚焦后逐字输入，支持中文。
- `dragTo(x1, y1, x2, y2, steps, caption)`：连续移动到起点、按下、缓动拖拽、释放。
- `rest(caption)`：在当前位置定格，保留鼠标。
- `glideTo(...) / snap(...)`：需要特殊镜头时使用；后续移动从上一帧的实际鼠标位置开始。

按「定位 → 操作 → 等待真实结果 → 定格」编排；关键步骤用 Playwright 断言验证，避免录到空面板仍报告成功。浏览器脚本通过 `shot` 参数补拍 WebContentsView，其他功能默认使用 renderer 截图。合成按时间线采样共享调色板，并逐帧编码，避免同时保留所有 1080p 原始图。`palette.mjs` 按完整 RGB 值缓存最近色映射，避免近色共享 RGB565 缓存时受扫描顺序影响；每次合成固定额外使用约 32MiB 缓存。

新增功能时创建一个 `record-<功能>.mjs`，在 `demos` 注册唯一脚本与产物文件名，然后补 README 引用。保存 manifest 时必须提供匹配的 `name`、`captions`、`frames`；`saveManifest` 校验字幕与功能映射，并补齐尺寸、数量和单位。

## 验证

```powershell
npm run test:showcase
npm run showcase -- build product
```

第一条验证鼠标连续性、点击拼接、中文输入、拖拽释放、延时单位及完整 RGB 调色板映射，共九项；第二条在真实应用中验证文件提醒、HTML 交互、拖宽预览、JSON 结果、多标签切换和重新加载，并生成 GIF / PNG。录制后仍需查看成品，检查文字可读性与节奏。
