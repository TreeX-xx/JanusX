---
{
  "schema": "harness-note/2",
  "id": "41a64d3c-2811-4dc8-a1ab-2c5c541ec123",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-11-03",
  "updated": "2026-11-03T12:05:47.716Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/144067d8-ab32-445a-bef0-d5e0c2075cc3" }
  ]
}
---

# 主题机制与白色主题

主题 definition 统一拥有应用表面、文字、状态、图表、身份、材质和辉光配色，同时提供终端、Monaco 与上下文用量刻度。`white` 为独立纯白主题，使用白色内容区、浅灰导航和控件、深色正文及加深的橙色强调；`dark` 保持默认，`planche` 继续表达暖纸与墨色结构。

## 扩展入口

新增主题需要完整语义令牌；TypeScript 契约与 CSS 生成器均校验完整性。生成器同时输出 renderer 样式和公开 SDK 的 `theme.css`，包含原生控件明暗、选区和终端 palette 变量。运行时注册主题由主题服务应用完整令牌、明暗基底和终端变量，更新或撤销活动定义也会刷新文档；切回内置主题时只清理该服务写入的变量。未知 ID 继续回退经典黑，保存的偏好不被擦除。

组件不再用主题 ID 选择颜色。通用 CSS、内联状态、Git 标记、灵动岛、知识界面、弹窗、用量图表和官方插件都读取语义颜色。石板色专属选择器仍负责几何、阴影形态和动效；这些不是新增纯白专属覆盖。独立浏览器窗口也在创建时读取已缓存主题，与主窗口和独立编辑器的首漆方式一致。

插件上下文传递完整语义令牌、明暗基底和完整终端 palette。三个官方插件通过 `@janusx/plugin-sdk/theme.css` 使用同源默认值；Blueprint 状态及 React Flow 的明暗读取活动主题，Docker ANSI 色随主题切换。声明式调色板允许以纯白为基底，继续保留六色限制、授权与遮挡保护。API 使用方法归 [主题维护说明](../../../src/shared/theme/README.md) 和 [插件契约](./plugin-contract-v1.md)。

Blueprint 的画布、阅读区和讨论区分别使用 `workbench-canvas`、`shell-pane` 与 `shell-card`，避免把 `shell-void` 的凹陷底色铺在正文区。辅助文字直接使用 muted／dim，不再叠加全局透明度；强调按钮使用 `on-accent`。MCP 设置的 Codex 复用主题图标滤镜，OpenCode 与 Janus 的中性笔画通过 SVG 读取文字令牌，切换主题无需替换资源或复制白色样式。

主应用终端、设置、会话、通知与用量页统一使用 `TerminalPresetIcon`，由组件管理中性笔画和 Codex 滤镜，调用方不再额外反色。文件图标、被 Git 忽略的行、备忘录编号及标签、输入提示、运行配置说明和运行时间直接使用主题文字色，避免叠加透明度后在白底上失去对比度。Markdown 阅读面与编辑器共享内容底色。Git 状态边框和上下文用量徽标使用 `color-mix()`，不能为 CSS 变量或 `rgb()` 拼接十六进制透明度。CPA／Docker 同步主题 ID，原生控件明暗由主题令牌决定，与操作系统外观独立。

## 选择与代价

将组件实际绘制颜色迁入语义角色，避免复制一套白色 CSS 覆盖。原来相近但不一致的灰阶与状态色会收敛，暗色界面的局部色阶也随之统一；结构、交互和布局没有因此另建实现。材质与身份仍保留独立令牌，不能用正文色替代所有装饰色。白色主题降低眼部辉光强度，避免深色投影在白底上显脏。

SDK 额外携带一份生成 CSS，因此主题变动需要更新 SDK 生成物及相关归档锁；`theme:check` 与单测校验它和应用版本一致。插件可独立打包，无需导入应用私有源码。未来若独立插件要求兼容更老的 SDK，应明确版本边界，不再回到插件手写宿主颜色。

## 审计与验证

审计覆盖 renderer、公共 UI 包与 Blueprint、Docker、CPA 的 UI 源码。历史预算目前仅保留 1,063 处既有主题选择器；绘制颜色及失效变量不再占历史预算。14 处固定色例外保留平台按钮、二维码、文档及导出 HTML 的独立语义；CSS 选择器中的 SVG 色值只用于匹配，不作为绘制颜色。静态扫描仍不等于级联或全部界面无障碍证明。

相关 15 个单测文件共 178 项通过，运行时变量补齐后另复跑注册、白色主题及插件调色板 34 项通过。`tests/unit/white-theme.test.ts` 检查主要文字与状态的对比度、ANSI palette、运行时主题清理和 SDK 一致性。浏览器共 31 项通过，覆盖设置选择、portal 下拉、实时切换、三个 Island 视图、真实 Blueprint 节点及三种主题的 640／900／1440 像素设置布局；检查过的主要截图在 `artifacts/white-theme/visual-final/`。这些场景使用真实组件与测试 IPC，不代表真实模型、容器执行或完整 Electron 安装包验收。

蓝图补充了真实签名插件的 Electron 回归：`npx playwright test --config playwright.blueprint.config.ts --workers=1` 验证 white／dark／planche 连续切换而不重建画布、MCP 图标与内容区颜色，并在纯白下走通设置、阅读、审核、讨论和重装数据保留；1 项综合场景通过。图像证据在 `artifacts/plugins/blueprint-theme-*.png`、`blueprint-mcp-theme-*.png` 和 `blueprint-maintenance-scope*.png`。插件构建与独立类型检查通过；模型响应来自 fixture，未执行真实模型调用。

后续覆盖检查补充了白色主题浏览器场景：终端／文件图标实时切换、Git 边框、备忘录与输入提示对比度、Markdown 阅读面、设置／用量品牌入口，以及与系统明暗相反的 CPA／Docker 原生控件。`white-theme.spec.ts` 共 9 项通过，设置布局、终端管理与用量另有 25 项通过；主题相关 5 个单测文件共 57 项通过。截图检查覆盖设置、侧栏、用量、备忘录、对话及编辑预览，证据在 `artifacts/white-theme/recheck/`，不代表全部交互状态的无障碍验收。CPA／Docker 的本轮新增验证使用实际插件 CSS 与浏览器原生控件，未重跑真实容器或 CPA 服务端业务。

应用生产构建、类型、i18n、主题审计和三个官方插件的独立构建均完成验证。Blueprint 独立构建使用更新锁模式验证当前公开归档；本机相邻 janus-agentX 的四个归档已有字节漂移，当时只保留 SDK 的归档锁更新，不重钉无关依赖。严格按原锁复现仍受该外部状态限制。文档校验为 0 错误、17 条既有外部链接诊断；lint 为 0 错误、51 条既有中文直写警告。完整桌面安装包回归未执行。

与 dev 的 Git 面板、工作区切换和对话问答整合后，相关 11 个单测文件共 109 项通过；旧 Git 样式断言更新后，14 项石板主题用例单独复跑。白色主题、Git 工作台、工作区切换和问答卡片的 35 项浏览器回归通过，截图在 `artifacts/white-theme/merge-browser-results/`。旧 worktree 的其他插件截图与临时开发配置保留到 dev 的 `artifacts/white-theme/retained/`，主题验证目录保留原相对路径。

共享设置控件迁入 `@janusx/ui` 后，主题审计同时覆盖 `packages/ui/src`；公共控件、菜单阴影与图标底板只读取宿主／SDK 的主题变量，不另设暗色兜底。蓝图的中性图标及 Codex 滤镜由图标组件管理，避免控件样式迁移后丢失。推理强度保持 dev 的六档色相与原生设置确认行为，文字、辉光、高光和彩色装饰统一归入 `effort-*` 令牌，浅色使用更深的文字与边界色。手机远控沿用新增右栏入口；二维码的固定白色扫描底板属于既有例外，随文件迁移更新审计路径。

本轮与 dev 的共享设置、模型用量、手机远控和推理强度改动整合后，7 个单测文件共 91 项通过；`white-theme`、`settings-controls`、`settings-layout`、`conversation-settings`、`usage-stats` 和 `mobile-remote-rail` 共 49 项浏览器回归通过。签名蓝图插件的 Electron 综合场景再次通过，包含主题切换、MCP 图标、设置、讨论与重装数据保留。类型检查、应用生产构建、主题及 i18n 检查、蓝图独立类型检查和 CPA／Docker 构建通过；lint 仍为 0 错误、51 条既有警告。新截图与日志在 `artifacts/white-theme/dev-adapt-*`，真实插件及推理强度截图在保留资料的 `final-integration/artifacts/` 下。已复核纯白 MCP、推理强度与共享设置界面。SDK 与公共 UI 归档锁随本次修改更新；未重跑外部 janus-agentX 归档的严格复现或完整安装包验收。
