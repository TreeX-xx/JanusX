# 主题系统（M1 统一结构）

主题资源集中在 `definition.ts`，CSS、终端和编辑器从这里生成或派生。组件使用语义令牌；历史硬编码和主题专属 CSS 尚未全部迁移，可通过统一扫描定位。

## 加一个新主题（3 步）

1. 在 `definition.ts` 仿 `PLANCHE_THEME_DEFINITION` 写一份 `ThemeDefinition`
  （`tokens` 必须覆盖 `tokens.ts` 的 `SEMANTIC_TOKENS` 全表，`xterm` 全量 21 键，
   `monaco.colors` 只允许 `#RRGGBB[/AA]`，测试会卡）。
2. 在 `registry.ts` 注册内置主题，使 renderer 和 CSS 生成入口都能看到它。
   仅在 renderer 启动时调用 `defineTheme()` 的运行时主题不会自动写入生成的 CSS。
3. 跑 `npm run theme:css`，提交生成的 `themes.generated.css`。

完成后主题选择自动出现：设置通用页读 `listThemeDefinitions()`，
未知 id 经 `getThemeDefinition()` 回落默认（经典黑），永不白屏。

## 约定

- 组件文字/背景/边框只用 `var(--shell-*)` 等语义令牌（CSS）或
  `useThemeTokens()`（JS 动态色，如 Canvas 绘制）。
- `onMouseEnter` 改色迁到 CSS `:hover`；迁不掉的走 hook，不要写死 hex。
- 展开主岛与备忘录外壳共用 `island-panel-background/border/radius/shadow` 四个令牌，新增主题一并提供；备忘录内容分隔仍走弱边框，主岛运行态保留状态反馈。
- 右侧工具区使用 `tool-canvas/card/chrome/hover`，分别承载底板、卡片、控件与悬停色；RightDock 内映射到现有 shell 令牌。石板色主题底板与中央暖纸面同色，卡片和浮层只略提亮，避免右侧形成大块白色分区。
- 工作区菜单、文件右键菜单、终端预设菜单及通用下拉浮层共用 `popover-background/hover/shadow`，描边用 `control-border`。新增主题需同时提供这些令牌，避免在组件中按主题 id 写死颜色。
- 瞬态与语义色（红绿灯、扫描束、状态点）保留原值，只校验新主题下的可见度。
- 结构性皮肤（如灵动岛眼形、胶囊几何）不进 definition，手写 CSS 覆盖，
  选择器与 DOM 对齐（参考 `13-janus-planche.css`）。
- 改完 definition 必跑：`npm run theme:css && npx tsc --noEmit`
  + `npx vitest run tests/unit/theme-registry.test.ts`。

## 定位遗留与检查新增问题

- `npm run theme:audit`：扫描 renderer 的 CSS 与 TS/JS 字符串，逐项输出文件、行、列、种类和值。
- `npm run theme:audit -- --json`：输出结构化结果，方便筛选模块或生成迁移清单。
- `npm run theme:check`：比对生成 CSS，并拒绝超出历史基线和例外预算的新增项；已接入 `npm run verify`。

扫描覆盖 hex、数值 rgb/hsl、黑白 Tailwind 类、直接黑白色值、`[data-theme=...]` 专属 CSS，以及找不到静态定义的 `var(--...)`。`themes.generated.css` 是允许的集中颜色来源，仍参与变量定义收集。JS/TS 经语法树提取字符串和模板片段，CSS 注释跳过。

`scripts/theme-audit-baseline.json` 的 `legacy` 按文件、种类、值记录存量次数，这是待迁移清单，不代表颜色已获批准。迁移时减少或删除对应预算；不要重新生成基线来吞掉新增问题。行移动不改变预算，同一值增加次数仍会失败。`exceptions` 列出固定色的文件、值、次数和原因；目前仅给本地 HTML 与 Office iframe 的白色页面底板登记例外，文档自己的配色不由应用主题覆盖。

这是静态候选扫描：不会判断 CSS 作用域、明暗对比度，也不覆盖 JS 中按主题 id 分支、运行时拼接颜色或外部 iframe 内容。自定义属性找到某处定义不等于在每种主题下都可用；新增主题仍需令牌完整性测试和界面验证。历史项保持可见，新增的必要固定色应逐项说明理由。
