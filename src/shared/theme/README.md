# 主题系统

主题资源集中在 `definition.ts`，CSS、终端和编辑器从这里生成或派生。内置顺序为经典黑 `dark`（默认）、石板色 `planche`、纯白 `white`。组件绘制颜色使用语义令牌；石板色专属结构继续由 CSS 管理。设计与验证边界见 [主题机制 Note](../../../.agents/notes/workbench/theme-system.md)。

## 加一个新主题（3 步）

1. 在 `definition.ts` 仿 `PLANCHE_THEME_DEFINITION` 写一份 `ThemeDefinition`
  （`tokens` 必须覆盖 `tokens.ts` 的 `SEMANTIC_TOKENS` 全表，`xterm` 全量 21 键，
   `monaco.colors` 只允许 `#RRGGBB[/AA]`，测试会卡）。
2. 在 `registry.ts` 注册内置主题，同步 `BUILT_IN_THEME_IDS`、中英文名称及 SDK 的允许基底。
   运行时 `defineTheme()` 注册的主题由 `applyThemeToDocument()` 应用完整变量，不需要生成 CSS。
3. 跑 `npm run theme:css`，提交应用 `themes.generated.css` 和公开 SDK 的 `theme.css`。两份生成物同源，不手工维护副本；更新 SDK 后按官方插件构建流程更新相关归档锁。

完成后主题选择自动出现：设置通用页读 `listThemeDefinitions()`，
未知 id 经 `getThemeDefinition()` 回落默认（经典黑），永不白屏。

## 约定

- 组件文字/背景/边框只用 `var(--shell-*)` 等语义令牌（CSS）或
  `useThemeTokens()`（JS 动态色，如 Canvas 绘制）。
- `onMouseEnter` 改色迁到 CSS `:hover`；迁不掉的走 hook，不要写死 hex。
- 展开主岛与备忘录外壳共用 `island-panel-background/border/radius/shadow` 四个令牌，新增主题一并提供；备忘录内容分隔仍走弱边框，主岛运行态保留状态反馈。
- 右侧工具区使用 `tool-canvas/card/chrome/hover`，分别承载底板、卡片、控件与悬停色；RightDock 内映射到现有 shell 令牌。石板色主题底板与中央暖纸面同色，卡片和浮层只略提亮，避免右侧形成大块白色分区。
- 工作区菜单、文件右键菜单、终端预设菜单及通用下拉浮层共用 `popover-background/hover/shadow`，描边用 `control-border`。新增主题需同时提供这些令牌，避免在组件中按主题 id 写死颜色。
- 状态、diff、身份、图表分别使用 `status-*`、`shell-diff-*`、`role-*`、`usage-*`；不要把深色主题的亮色复制到组件。实色强调背景上的文字用 `on-accent`。
- 辅助文字使用 `shell-muted/dim`，不要再叠加透明度降低对比度；透明度仍可表达禁用、拖拽预览和过渡。正文阅读区使用 `shell-canvas/pane`，凹陷底色不用于大面积正文。
- 主应用终端品牌统一使用 `TerminalPresetIcon`，组件管理 Codex 滤镜和 OpenCode／Janus 中性笔画；设置、用量与通知不再自行反色或添加品牌专用底板。
- 给动态颜色加透明度使用 `color-mix()`；不要拼接十六进制后缀，因为主题颜色可能是 CSS 变量或 `rgb()`。
- `surface-tint`、`surface-shade` 和 `shadow-color` 区分表面叠色与投影，透明度使用 `color-mix()`；眼部高光和辉光强度使用 `glow-core/strength`，圆桌材质使用 `roundtable-*`。
- `::selection`、Monaco 选区兜底和原生控件 `color-scheme` 由主题管理。不要按主题 ID 分支选色；确需区分明暗行为时读取 `base`。
- 结构性皮肤（如灵动岛眼形、胶囊几何）不进 definition，手写 CSS 覆盖，
  选择器与 DOM 对齐（参考 `13-janus-planche.css`）。
- 改完 definition 必跑：`npm run theme:css && npx tsc --noEmit`
  + `npx vitest run tests/unit/theme-registry.test.ts tests/unit/white-theme.test.ts tests/unit/theme-audit.test.ts tests/unit/monaco-theme.test.ts tests/unit/plugin-themes.test.ts`。

## 插件

官方 Blueprint、Docker、CPA 导入 `@janusx/plugin-sdk/theme.css`，获得同源默认配色。宿主上下文传递完整语义令牌、`--theme-color-scheme` 与 `--terminal-*`，插件覆盖到根元素即可实时切换；Docker 使用后者的完整 ANSI palette。插件不依赖应用私有源码。

插件同时更新根元素 `data-theme`，原生控件的 `color-scheme` 使用 `var(--theme-color-scheme)`；不能用 `light dark` 覆盖应用选择，否则系统深色时纯白插件中的原生菜单、日期控件仍会偏暗。

授权调色板仍限定六个颜色，可继承 `dark`、`planche` 或 `white`；权限、遮挡保护和撤销回退不变。详见 [插件主题指南](../../../packages/plugin-sdk/examples/palette-themes.md)。

## 定位遗留与检查新增问题

- `npm run theme:audit`：扫描 renderer 与三个官方插件的 UI CSS 及 TS/JS 字符串，逐项输出文件、行、列、种类和值。
- `npm run theme:audit -- --json`：输出结构化结果，方便筛选模块或生成迁移清单。
- `npm run theme:check`：比对生成 CSS，并拒绝超出历史基线和例外预算的新增项；已接入 `npm run verify`。

扫描覆盖 hex、数值 rgb/hsl、黑白 Tailwind 类、直接黑白色值、`[data-theme=...]` 专属 CSS，以及找不到静态定义的 `var(--...)`。两份生成 CSS 是允许的集中颜色来源，仍参与变量定义收集。JS/TS 经语法树提取字符串和模板片段；CSS 解析声明，SVG 选择器中的色值只作为匹配标识。

`scripts/theme-audit-baseline.json` 的 `legacy` 按文件、种类、值记录存量次数，目前只保留既有主题选择器。迁移时减少或删除预算；不要重新生成基线吞掉新增问题。扩展到插件的选择器预算来自迁移前清单。`exceptions` 记录固定色的文件、值、次数和理由：平台窗口按钮、二维码扫描面、Office 文档画布以及独立导出的 HTML。

这是静态候选扫描：不会判断 CSS 作用域、明暗对比度，也不覆盖 JS 中按主题 id 分支、运行时拼接颜色或外部 iframe 内容。自定义属性找到某处定义不等于在每种主题下都可用；新增主题仍需令牌完整性测试和界面验证。历史项保持可见，新增的必要固定色应逐项说明理由。

`white-theme.test.ts` 验证主要文字和状态色在白色／灰色表面上的 4.5:1 对比度、ANSI 色、运行时主题清理及 SDK 生成一致性；浏览器测试负责实际选择、切换、聊天和插件节点呈现。
