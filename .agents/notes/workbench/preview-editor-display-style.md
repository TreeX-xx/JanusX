---
{
  "schema": "harness-note/2",
  "id": "dfdaad8f-cf1b-40f5-8509-9a5d97bfb876",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-20",
  "updated": "2026-10-23T15:27:38.390Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 预览编辑窗口显示风格与外壳 UI 对齐方向

## Intent

用户认可 opencode 的文件编辑显示风格，希望双击预览编辑窗口（`StandaloneFileEditor` 双宿主）的编辑器与差异显示向其靠拢，正常编辑显示与差异显示同批适配、不只 diff；同时窗口外壳自身的 tab 与控件设计和应用整体语言有出入，一并 UI 优化。本文记录 2026-10-21 的调研结论、差距清单、落地映射与裁决。外壳 UI 对齐（tab、控件、MonacoViewer 主题字面量）与显示风格 A–D 均已落地，视觉效果待应用内确认。不改动 [文件编辑窗口与预览体验](./file-editor-experience.md) 与 [统一文件窗口与内嵌／浮窗路由](./unified-file-window.md) 的已确认设计。

调研对象为 anomalyco/opencode（GitHub，dev 分支源码）的双端文件编辑显示实现：TUI 侧 `packages/tui/src/component/patch-diff.tsx` + `@opentui/core` 的 `DiffRenderable`；Web/Desktop 侧 `@pierre/diffs` + `packages/session-ui/src/pierre/index.ts` 风格覆写 + `packages/ui/src/data-display/diff-changes/`；主题推导在 `packages/tui/src/theme/system.ts`。

## opencode 文件编辑显示风格

| # | 特征 | 细节 |
|---|---|---|
| 1 | 行号列是独立色带 | gutter 有自身背景（added/removedLineNumberBg），重于正文行底色；正文行底色极淡（亮 5% / 暗 10% alpha） |
| 2 | 2px 变更指示条 | pierre `diffIndicators: "bars"`，行号列前 2px 竖条（绿/红），是主变更信号而非大面积填充 |
| 3 | 词级高亮 | `lineDiffType: "word-line"`，词强调底色约为行底色 4 倍（20%/40%） |
| 4 | 行号文字着色 | 默认 text-faint；增删行号分别染绿/红（亮 green-900 / 暗 green-400 系） |
| 5 | 不变区折叠 | `expansionLineCount: 20` + `hunkSeparators: "line-info-basic"`，超阈值未变上下文折叠为可展开分隔行 |
| 6 | +N/−N 计数徽标 | `DiffChanges` 组件 mono 小字（11–14px），绿 +N 红 −N，配 A/D/M 16px 状态字母 |
| 7 | 分栏/统一双模式 | 默认 unified 可切 split；TUI 分栏时每栏各自单列行号 |
| 8 | 主题由调色板推导 | `tint(bg, green/red, alpha)`：暗 0.22 / 亮 0.14 行 tint，gutter 在 context bg 上再 tint 一层 |
| 9 | 排版 | mono + font-feature-settings、行高 24px、tab 2、行号最小 3ch、hover 双高亮、无 minimap |

## JanusX 现状对照

链路：`StandaloneFileEditor` → `FileViewerContent` → `MonacoViewer`（Monaco 0.55.1；普通编辑默认，显式"与 HEAD 比较"才进 DiffEditor）。

已对齐（[Monaco diff single line number](../terminal/monaco-diff-single-line-number.md)）：分栏各自单列行号，窄于 800px 默认合并显示；`ResizeObserver` 跟随容器尺寸，手动“合并／并排”选择持久保存并优先于自动布局。合并模式通过 `compactMode` 去掉旧行号栏，当前行保留当前行号，原生删除行边栏补上旧行号；关闭 true inline 保留旧行在前、新行在后的比较顺序。此前只启用 `useTrueInlineView` 并未消除双列数字。工具栏提供上一处／下一处变更，并排标注原版本／当前版本。`lineNumbersMinChars: 3`、minimap 关闭、差异视图为显式选择。删除行号适配依赖 Monaco 原生 margin DOM，升级时需复核；浏览器回归覆盖换行、折叠、多块删除与编辑同步，未做打包桌面验证。

差距：

| 差距 | JanusX 现状 | opencode |
|---|---|---|
| 底色权重 | 正文行 ≈18%、gutter ≈20% 两者接近 | 正文 5–10%、gutter 明显更重，色带在 gutter 不在正文 |
| 2px 指示条 | `renderIndicators` 仅小三角 | 竖条是主变更信号 |
| 行号着色 | 单色（`#444`） | 增删行号染色 |
| 不变区折叠 | 无 | 20 行阈值折叠成分隔行 |
| +N/−N | 无 | 文件头/tab 常显 |
| 词级强调 | 有（33%） | 行:词 = 1:4 层级 |
| 行高/tab | 默认（~20px / tab 4） | 24px / tab 2 |

## 落地映射

正常编辑显示与差异显示同批适配：B 档排版同时作用于两种模式，A/C/D 的变更色带、指示条与计数属于差异呈现，普通编辑沿用同一排版与令牌基础。会话流文件改动卡与 TurnChangeIsland 的 diff 呈现与编辑器同源；文件树既有红绿 git 状态设计保持独立，不被本风格覆盖。

- **A 纯主题 token（已落地）**：`src/shared/theme/definition.ts` 两主题 monaco diff 色重排——正文行 tint 降至 8%（alpha `0x14`）、gutter 色带提至 30%（`0x4D`）、词强调 32%（`0x52`，行:词 = 1:4），形成"色带在 gutter、正文薄纱"。
- **B Monaco 选项（已落地）**：`MonacoViewer.tsx` `lineHeight: 24`、`tabSize: 2`（配 `detectIndentation: false` 保证打开即生效）同时作用于普通编辑与 diff；diff 启用 `hideUnchangedRegions`（enabled，reveal/minimum/context 均 20）折叠不变区。竖线零容忍：文件编辑界面的竖线来源为 Monaco 默认缩进/括号参考线与 overview ruler，视觉复核确认后全部禁用（`guides` 全关 + `renderOverviewRuler: false`），planche 契约防回潮。TS/JS 语义校验关闭（`noSemanticValidation`）：文件窗口无工程上下文，导入解析与 JSX 类型假错误曾把文件全线标红，保留语法校验兜真错误。Unicode 可疑字符高亮整项关闭（`unicodeHighlight` 三项 false）：该项给全角标点等易混淆字符套 1px 金黄边框盒（`editorUnicodeHighlight.border` 默认取 warning 金 `#CCA700`/`#BF8803`，我方主题未覆盖），中文字符串与 Markdown 满篇全角标点即满屏黄框；其 locale 豁免键为 `zh-hans`/`zh-hant`，standalone Monaco 用 `Intl` 解析出 `zh-CN` 对不上号、回退 `_default` 把全角标点全算混淆，属上游 locale 键不匹配、本地修不动。文件窗口不需要防同形攻击提示，与 `noSemanticValidation` 同一裁决口径；planche 契约防回潮。
- **C 装饰注入（已落地，竖条撤除）**：`MonacoViewer` diff 行号染色以 Monaco decoration API 实现（`getLineChanges()` + `onDidUpdateDiff` → `lineNumberClassName`，增绿删红，走 `--shell-diff-*` 令牌）。2px 变更竖条上线后经视觉复核**撤除**——文件预览界面不要竖线；变更信号由 gutter 色带、超淡行底色与行号染色承担。退出比较时主动清理装饰，避免残留到普通预览（模型在 diff 退出后仍被复用）。
- **D 组件层（已落地）**：同源徽标 `shared/DiffCounts`（TurnChangeIsland 原 Counts 迁入共用；零变更隐藏、11px tabular、绿 `+N` 红 `−N`、`toLocaleString`）。落位**文件窗口外壳**：tab 内 per-file 常显，工具栏不再重复活动文件计数；数据取 git 变更统计（`git status` 行统计，随 fileTree 变更刷新），文件树红绿不被覆盖。

A–D 与外壳 UI 验证：`npm run typecheck`、`npm run theme:check`（0 new）、planche 契约（同源徽标、行号染色、无竖条防回潮、外壳图标钮与 filetab-close）与全量单测通过（workflowx-v2 在并行负载/跨进程 note 锁竞争下偶发失败，单独复跑 8/8 通过）。视觉复核已消化一条：竖条撤除；余下 planche 下的行号染色、滑动指示块与色带权重待真机过目。

与无色块方向同构：opencode 的 bars 指示条 + 行号色带 + 超淡行底色，正是"选中/变更 = 文字 + 2px 强调条、不靠加深填充"的 diff 表达。JanusX 现在的 diff 反而填充偏重、条缺失，此轮学习同时是把 diff 显示收敛进既有视觉语言。不搬的：TUI tree-sitter 虚拟化 PatchDiff（Monaco 自带虚拟化）、pierre 的 `!important` 语法色覆写（破坏主题语法一致性）、文件树 + reviewed 勾选的多文件审阅套件（属另一产品决策）。

## 外壳 UI 对齐（tab 与控件，已落地）

[辅助面板与预览控件精简](./requirements/auxiliary-panels-preview-controls.md)已实施：标题行保留标签、更多与内嵌收起，文件操作行接收共享 viewer 控件；HTML／Markdown 使用图标单选组并移除重复标题带。480px 以下查找／比较进入更多，迁移和浮窗置顶也在更多中，保存保持可达。内嵌文件收起保留模型、草稿与模式，右侧固定入口恢复；沿用本篇令牌与标签基线，不重做 Monaco 正文或 diff 色带。

窗口外壳与应用整体语言的断层已按既有规则收敛：

1. **tab 形态（已裁决并落地）**：`StandaloneFileEditor` 标签从 `rounded-t-md` 折页形 + 激活填充 `--shell-canvas` + 底部 1px 强调线，收敛到**滑动指示块体系**：浮动 pill（7px 圆角）配滑动指示块（`SlidingSelection` + `theme-hovers.css` 的 `.filetab-indicator`，与 `TerminalArea.module.css` 的 `.tab`/`.tabIndicator` 同参，指示块随选中项 160ms 平移），激活项仅文字提亮加粗。未采用 configTab 的 2px 强调条方案。标签条横向滚动条隐藏，滚轮驱动横向滚动（`lib/wheel-scroll-x.ts`：竖向滚轮换轴成横向位移，触控板横向手势与平台已换轴的 shift+滚轮走原生不叠加；只在真正滚动时接管事件，到边放行父级链，无溢出条完全不拦截），与工作台 pane 条同规（`TerminalArea` strip 同一接线）。选中/打开的 tab 以最小位移滚入可视区（`revealStripItem`，不触碰祖先滚动容器）。此前"由滚轮/触控板控制"只有触控板原生生效，竖向滚轮换轴于 2026-10-21 补齐。标签关闭钮补齐可见性与悬浮反馈：常态清晰可见（Lucide X + 命中膨胀），悬浮转删除色并亮出底色反馈；内联 color/opacity 曾压制 hover 规则，已移除。
2. **控件选中态（已落地）**：比较开关、钉住、保存按钮的 `--shell-accent-soft` 填充块已移除；激活 = 图标染 `--shell-accent-strong` + 底部 2px 强调条（`theme-hovers.css` 的 `.shell-icon-btn[data-on]::after`），即"选中 = 文字 + 2px 强调条"。图标钮统一 `h-7 w-7` + 6px 圆角，回归卡片圆角体系；`::before` 以 `inset: -1px` 把命中膨胀到约 30px，对齐 [Workbench close controls keep a stable 30px hit area](./workbench-close-hit-slop.md)。
3. **主题字面量（已落地）**：`MonacoViewer.tsx` 加载态、容器与错误浮层不再硬编码 `#0a0a0a`/`#555`/`#d4d4d4`/`#202024`/`#45454d`（含加载点 `#ff7830`），改走 `definition.ts` → 生成 CSS 令牌：容器/加载底 `--shell-canvas`（与 Monaco `editor.background` 两主题一致）、浮层 `--popover-background`/`--shell-text`/`--shell-border`，planche 黑底闪断消除。planche 契约测试补上 MonacoViewer 无字面量断言与外壳图标钮契约。
4. 一致的部分保留：标题栏 38px 与主 `Titlebar` 同高、发丝线底边、`--shell-pane-chrome` 令牌用法。

验证：`npm run typecheck`、`npm run theme:check`（0 new）、`npm run check:notes` 与全量单测 3638 项通过（`npm run test:unit -- --run`）；planche 契约新增 MonacoViewer 无字面量与外壳图标钮断言。未跑桌面 e2e 与真实窗口视觉确认；滑动指示块与 2px 强调条在 planche 下的渲染效果待真机复核。2026-10-21 标签条滚轮补齐同轮验证：typecheck、theme:check（0 new）、check:notes、全量单测 3670 项全绿；`wheel-scroll-x` 单测 7 项覆盖换轴/到边放行/最小位移入视口，planche 契约钉住文件窗口与 pane 条两处 `attachWheelScrollX` 接线。滚轮手感待真机复核。同日黄框清零（`unicodeHighlight` 三项 false）：planche 契约新增整项关闭断言，typecheck 与契约测试通过；黄框消失待真机过目。

## 裁决

- C 档实现载体用 Monaco decoration API，不注入 CSS 覆写 `.monaco-diff-editor`。
- +N/−N 跟随 opencode 桌面 `DiffChanges` 语义：有变更常显、零变更隐去。落位（设计裁决）：tab 内 per-file 徽标 + 工具栏比较开关左侧跟随活动文件——计数即比较将展示的量，微落位随视觉确认微调。JanusX 文件树的红绿 git 状态设计保持独立，任何情况下不被覆盖。
- 显示风格延伸到会话流文件改动卡（[Post-turn changed-file card across external CLIs](./turn-change-card-external-cli.md)）与 TurnChangeIsland，两处 diff 呈现与编辑器同源。
- 实施拆分：A/B 先行看效果，C/D 在视觉确认后排期。

opencode 桌面 `DiffChanges` 参考事实（dev 分支源码核对）：组件渲染 `+N`/`−N` 两个 span，总变更为 0 时不渲染；`compact`（默认）11px 常规字重配 success/danger 前景色，`standard` 14px mono 配 diff 专用色；输入可为多文件变更数组并求和。桌面挂载点为 SessionReview 头部全局汇总（有 diff 常显）与逐文件行（状态徽标旁内联计数，changeSummary 模式移到展开汇总块）；v2 界面通过 `stats` 槽位挂在侧栏标题旁，侧栏收起时移入工具栏并附 n/m 文件计数。
