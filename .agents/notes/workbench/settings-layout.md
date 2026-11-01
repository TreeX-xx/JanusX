---
{
  "schema": "harness-note/2",
  "id": "35775a71-6b34-4a93-aaf5-55f6a65500b9",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-15",
  "updated": "2026-10-31T18:23:45.000Z",
  "class": "feature",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 设置界面层级、主题预览与页脚令牌

## Problem
通用页把偏好、开发环境与应用维护排列在同一级，复杂内容被压在右半列，并出现容器嵌套。通知页在远程提醒关闭时仍展示关联字段；部分中文标题重复英文，各页保存操作的位置和反馈也不一致。

### Theme selection previews the workspace
The general settings theme dropdown names the two built-in themes without showing their appearance. Users must switch to compare the light slate and classic dark palettes.

### Settings footer scrim reads the canvas token in both themes
Every settings panel that owns a save bar renders it as a `position: sticky` footer inside the scrolling `.body` of the settings shell, full-bleed past the body's padding so the bar sits flush with the scrollport bottom. The bar's scrim is the literal `rgba(21, 21, 23, 0.9)`, which is the value of `--shell-canvas` under the `dark` theme and of no theme at all under the default one. `DEFAULT_APP_THEME` is `planche`, where `--shell-canvas` is the paper value `#EFE4C5`.

The consequence is a near-black band across the bottom of the 通知, 知识库, Agent, and 托管 panels, plus the LLM tab through `LlmConfigModal`'s `.embeddedPanel .configFooter`. Because the footer is sticky and carries `backdrop-filter: blur(16px)`, that band holds its place over the tail of the content at every scroll offset instead of scrolling away with it, and on the paper surface it reads as a mask laid over the page rather than as chrome. Without the literal the same bar is invisible, because `rgba(21, 21, 23, 0.9)` laid over `#151517` stays within a rounding error of the canvas — which is why the defect never appears under `dark`.

The settings surface states its own rule in the header of `AppSettingsModal.module.css`: surfaces draw only from the `--shell-*` ramp and introduce no new near-black value. The scrim is the one declaration that breaks that rule, and the planche additive layer of both files carries no `.footer` rule at all.


## Decision
通用页增加“会话启动习惯”，选择新会话默认先显示终端或对话，默认终端并即时保存。该偏好只决定首个可见视图，支持范围内的会话始终具备两种形态，不提供能力启停开关；运行中的会话保持当前视图。具体引擎边界与启动控制归[终端与对话双显示模式](./terminal-dialog-dual-mode.md)。

设置保留左侧分组导航、右侧独立滚动内容和现有功能门控。导航以中性底色表达选中，组间用留白分隔，标题为 18px，关闭入口使用有本地化名称和键盘焦点的中性 ×。通用页分成外观与语言、开发环境，简单设置保持左右对齐，主题预览和复杂配置使用全宽。主题预览仍通过既有 store 即时保存，详见主题预览。通用行、通知共用分区及模型配置去除重复卡片轮廓，以留白和细分隔线组织内容；运行配置的浮岛设计不随本次改动调整。

导航末尾的“关于”集中产品介绍、当前版本与软件更新，复用 `UpdaterSettings` 和主进程更新服务；版本、自动检查、下载进度、更新说明和重启安装语义由[自动更新](../desktop/app-auto-update-win.md)维护。标题栏可用及下载中的更新徽标直达关于页，已下载徽标仍直接触发安装。页面沿用设置主题令牌，以留白、细分隔线和中性按钮组织信息，不添加独立卡片或强调色横幅。关于页采用最大宽度 440px 的居中单列，依次展示应用图标、名称、介绍、更新信息与求赞入口；自动检查开关和操作按钮一并居中。求赞入口顺着内容排列，Star 图标采用黄色实心填充和金色描边，兼顾纸面与深色主题。点击通过固定 URL 的主进程入口打开 JanusX GitHub 仓库，不接入账号授权，不记录或宣称已 Star；打开失败保留重试入口并显示仓库地址。

通知总开关关闭时收起远程字段及飞书分区，飞书关闭时收起其配置。去重与发送超时放入原生 details 的“高级设置”。折叠只改变展示，草稿继续保存在组件状态中，重新展开不清空值。通知与 Agent 权限对比草稿和已保存值，修改后才启用保存与撤销，并显示未保存提示；失败保留草稿供重试，撤销恢复已保存值。模型配置的测试与保存操作移至底部，沿用现有保存语义和按终端的配置服务。

外部 CLI 参考蓝图 MCP 接入的通栏终端列表：36px 品牌图标、名称旁的状态、下方版本或说明，以及右侧操作。窄内容区把操作放到下一行，错误与安装提示对齐到文字列。保留品牌图标控制新建入口显隐、安装、升级与重新检测的语义；Shell 默认项和展开编辑不变。具体终端规则由[Shell 配置](../terminal/shell-profiles.md)维护。

### Theme selection previews the workspace
`GeneralSettingsPanel` uses `ThemePreviewPicker` instead of a theme dropdown. Each registered theme receives a selectable card with a CSS miniature of the titlebar, sidebar, rounded workspace tabs, terminal lines and quiet usage footer. Preview custom properties come from that theme's complete token table and stay scoped to the miniature; changing the surrounding application theme does not recolor the other preview. Labels use existing translations with the registry label as fallback. The selected card has a faint accent fill, weak accent border and check mark. Native radio inputs provide names, checked state and keyboard selection; visible keyboard focus outlines the whole card.

The theme row places the description above a preview grid with a maximum width of 520px, following the settings layout. The card grid wraps to one column when two 140px cards cannot fit. Loading or saving disables the picker; a failed save keeps the previous theme selected and reports the existing localized error through an alert. Unknown saved IDs select the registry default. Theme persistence continues through the existing store and IPC service.


### Settings footer scrim reads the canvas token in both themes
The scrim reads the token. `NotificationSettingsPanel.module.css` `.footer` and `LlmConfigModal.module.css` `.embeddedPanel .configFooter` both declare `background: color-mix(in srgb, var(--shell-canvas) 90%, transparent)`, so one declaration serves both themes and neither file carries a theme-specific color. The paper theme flattens the bar through the existing additive layer: `[data-theme='planche'] .footer` and `[data-theme='planche'] .embeddedPanel .configFooter` set `background: var(--paper, #EFE4C5)` with `backdrop-filter: none`, because the paper surface language is flat fills and hairlines, and a 16px blur over scrolled paper smears into a dirty shadow that mimics the mask this decision removes. The existing 1px `--so-rule` top border keeps the seam in both themes.

The bleed geometry is correct and stays. Measured against the shipped module CSS in Chromium, the matched pair of a negative `bottom` and a negative `margin-bottom` holds the footer flush with the scrollport bottom — 0px deviation — at scroll start, mid, and end, for both long-content and short-content panels. Without the negative `bottom`, a 22px strip opens under the bar and scrolled content runs through it unoccluded. Both numbers stay derived from `--so-body-pad-y` so the bar tracks the body's padding.

`tests/unit/planche-theme.test.ts` strips CSS comments from the five settings surface modules and fails on `#151517` or `rgba(21, 21, 23,`, so the literal cannot return in a declaration while comments stay free to cite it. The same test pins the `color-mix` declaration and the presence of the planche `.footer` rule.



## Alternatives considered
只调整颜色与圆角无法解决复杂内容的列宽和关闭后仍铺开的字段。将全部设置改成自动保存会改变凭证测试及草稿提交的业务边界，因此保留即时偏好与显式提交两类行为。未抽取新的通用表单框架，各模块继续使用现有组件与设置令牌，避免为一次视觉调整增加宿主状态和接口。

### Theme selection previews the workspace
Static screenshots show real details but become stale as workspace chrome changes and require an asset for each registered theme. Token-based miniatures keep the palette current, avoid unreadable tiny labels and support new registry entries without new images. Rendering live workspaces inside cards would load terminal/browser behavior for a decorative preview; the miniature carries no live content.

### Settings footer scrim reads the canvas token in both themes
- Keep one glass bar in both themes and only re-tint it per theme — strongest case is that the frosted read survives on paper and the file needs no additive rule. The driver that rules it out is the paper surface language: flat fills and hairlines, no glass, and a per-theme selector is required either way, so the additive rule costs nothing extra to add.
- Move the footer out of the scroll container into a fixed row on `.content` — strongest case is that the save bar stops overlapping scrolled content at all, which is the only way to remove occlusion instead of dressing it. The driver that rules it out is reach: each panel renders its own footer, so the change reaches five components, the LLM embedded variant, and the standalone `LlmConfigModal` window, while the sticky bleed already keeps the whole bar visible and flush at every offset.
- Do nothing / reuse — staying put writes no code and looks correct under `dark`, where the literal matches the canvas. That is the whole cost, because the default theme is the paper one and every user meets the band on first open.


## Consequences
常用设置更易扫读，复杂配置有更宽的编辑空间。完整通用页仍需纵向滚动；应用维护集中在关于页，其他导航类别与功能归属保持原有组织。未保存提示只覆盖通知与 Agent 权限，不承诺切换页面后恢复未提交草稿，也没有新增关闭确认流程。品牌色用于终端与应用图标识别，Star 星星以黄色强调；页面表面、文字和保存按钮继续读取主题令牌。

### Theme selection previews the workspace
Users can compare both palettes before changing appearance. The preview is a schematic, not an exact screenshot; its structural shapes need maintenance when the workspace layout changes. Selection waits for the existing save service to succeed, avoiding optimistic selection that must be rolled back on failure. There is no separate apply button.

### Settings footer scrim reads the canvas token in both themes
- **Gains**: the 通知, 知识库, Agent, 托管, and LLM footers follow `--shell-canvas`; the default paper theme renders the bar as solid `#EFE4C5` above the existing hairline, and the near-black band is gone. `dark` is unchanged in computed terms — `color-mix(in srgb, #151517 90%, transparent)` with `blur(16px)` yields the same `color(srgb 0.0823529 0.0823529 0.0901961 / 0.9)`.
- **Costs and limits**: the scrim depends on `color-mix`, so the settings footer inherits that browser baseline; Electron 35 and the shipped engines provide it. The `dark` bar keeps its 16px blur, so on that theme it still tints whatever scrolls beneath it. The declaration is duplicated in two modules; revisit when the settings surface consolidates on a single shared footer, at which point it moves to `AppSettingsModal.module.css` and the copy disappears.
- **Verification**: measured in Chromium against the shipped module CSS — under `planche` the footer computes to `rgb(239, 228, 197)` with `backdrop-filter: none`, under `dark` to `color(srgb 0.0823529 0.0823529 0.0901961 / 0.9)` with `blur(16px)`, and the footer's bottom edge sits 0px from the scrollport bottom at scroll start, mid, and end in both themes with a 47px visible bar height. `npx vitest run tests/unit/planche-theme.test.ts` passes the settings-surface assertions; the file's two `janus island` assertion groups fail on a pre-existing mismatch in `13-janus-planche.css` that this change does not touch.


## Verification
浏览器检查覆盖通知展开、折叠保值、保存、撤销、失败恢复和面板重挂载后的已保存值，Agent 修改状态，以及双主题下 1440/900/640px 的设置外壳。外部 CLI 检查覆盖六类终端、安装、升级、检测、显隐与双主题下 1100/640/390px 布局。既有主题预览与 Shell 交互检查通过，相关主题、语言服务和飞书 UI 测试为 21 项通过、1 项跳过。隔离 fixture 的结果不证明真实 Electron IPC、系统安装器或重启持久化。

最终回归命令 `npx playwright test tests/e2e/external-cli-settings.spec.ts tests/e2e/settings-layout.spec.ts tests/e2e/theme-settings.spec.ts tests/e2e/shell-settings.spec.ts --project=island --workers=1` 共 31 项通过。`npm run typecheck`、`npm run build:app`、`npm run i18n:check` 与 `npm run check:notes` 通过；本次组件范围的 ESLint 无错误，保留通知页已有的 Hook 依赖警告。

关于页迁移后，`npx playwright test tests/e2e/about-settings.spec.ts tests/e2e/settings-layout.spec.ts --project=island --workers=1` 共 15 项通过，覆盖更新开关跨页保值、手动检查、更新说明、安装调用、仓库打开失败恢复，以及纸面／深色主题的 1100/640px 布局；截图在入场动画结束后人工检查。`npx vitest run tests/unit/updater` 的 18 项通过，类型检查、应用构建、双语文案、主题与 Note 检查及变更源文件 ESLint 通过。浏览器 fixture 仅验证调用与展示，未执行真实安装升级或系统浏览器打开。测试进程对 localhost 绕过 HTTP 代理，避免代理响应被误识别为测试服务器端口占用。

### Theme selection previews the workspace
`npx playwright test tests/e2e/theme-settings.spec.ts --project=island --workers=1 --output=artifacts/theme-cards-final` passes six browser cases using the real general settings panel and theme store with Electron IPC fixtures. Checks cover 1100/480/320px layouts, preview token isolation, click and arrow-key selection, pending save, rejected save, registered custom themes and unknown saved IDs. Screenshots of both surrounding themes and the narrow layout were manually inspected. Typecheck, scoped ESLint and `npm run build:app` pass. These browser checks do not establish persistence across a real Electron restart.
