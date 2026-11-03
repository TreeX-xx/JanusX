---
{
  "schema": "harness-note/2",
  "id": "35775a71-6b34-4a93-aaf5-55f6a65500b9",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-15",
  "updated": "2026-11-03T11:14:00.000Z",
  "class": "feature",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 设置界面共享控件、布局与主题预览

## Problem

设置子页分别实现按钮、下拉框和表单样式，宿主、蓝图与 CPA 又各自复制开关 CSS，导致尺寸、强调色、对齐和保存栏逐渐分化。蓝图导入操作仍使用橙色，部分简单设置挤在半列，复杂内容嵌套卡片。仅修改各页颜色无法持续保证一致性。

## Decision

宿主与官方插件统一消费公共 React 包 `@janusx/ui`，实现位于 `packages/ui`。包提供 Button、Input、Textarea、Select、SettingsCheckbox、InputGroup，以及 SettingsSurface、SettingsSection／SettingsFieldset、SettingsRow／SettingsLabel、SettingsFooter 和共享排版类。包只负责展示和基础交互；设置状态、校验、保存及权限继续归业务组件。宿主 Select 包装器只提供本地化空态，SettingsCheckbox 直接转出公共实现，蓝图 Select 同样只保留本地化适配。

采用中性前景与背景对比表达操作：主按钮使用文字色填充，次按钮细描边，辅助操作使用 ghost，页签使用 tab，结构性导航和可展开列表使用 plain。默认控件高 34px、圆角 8px；错误和成功信息保留语义色，终端品牌图标与主题缩略图保留自身颜色。设置操作不再使用橙色。开关统一为 36×22px 轨道和 14px 圆点，选中态为中性色；原生 checkbox 保留标签、空格键和禁用语义，已有 switch 角色保留。

设置行使用弹性文字列与固定控件列，开关靠右。复杂内容使用 stacked 全宽行；凭证、搜索和数值步进器使用 InputGroup 共用边框与焦点。分区以留白和细线组织，移除重复卡片轮廓。页面 CSS 负责宽度、位置和业务布局，控件外观及状态由公共包提供。公共属性选择器在迁移期间优先于旧页面类，避免残余 hover／主题规则重新染色。

共享 Select 保留原有浮层定位算法及 Arrow、Home、End、Enter、Space、Escape 操作，跳过禁用选项，跟随滚动和窗口尺寸变化重新定位。Escape 只关闭当前菜单。数据为空、加载、选择及保存的行为继续由调用方决定。它同时供宿主其他既有 Select 使用方消费，因此 Git 等既有调用方也获得一致的中性下拉样式。

应用设置保留左侧分组导航、右侧独立滚动内容及现有功能门控。通用、终端、插件管理及声明式配置、通知、个人记忆、模型与用量、Agent、团队、托管、实验和关于均接入相应公共控件。蓝图模型配置、自动审阅、MCP 接入及旧数据导入，CPA 连接配置也使用同一包。第三方自行绘制的插件界面需要主动采用公共包，宿主不强制改写隔离页面。

### Plugin build boundary

插件不导入宿主私有组件。蓝图通过 `vendor/janusx-ui-0.1.0.tgz` 固定公共包的 SHA-256、npm integrity 和可移动 lock 路径；CPA 本地开发使用公共包路径，仓库外构建检查打包 SDK 与 UI 后安装。修改公共包后需重新构建并更新蓝图归档及相关依赖锁，不能仅修改宿主副本。旧的宿主／插件 checkbox、Select 和表单 CSS 副本已移除。

### Settings footer

共享 SettingsFooter 在两种主题中都读取实色 `--shell-canvas`，以细线分隔，不再复制深色毛玻璃和纸面覆盖规则。sticky 页脚使用 `--so-body-pad-x/y` 配对负边距和 bottom，贴合滚动区域；宿主默认横向 28px、纵向 24px，CPA 显式匹配自身 24px 内边距。嵌套的 CLI 表单使用 inline 页脚，避免套用外层负边距造成溢出。独立 LLM 弹窗保留自己的外壳，嵌入配置的操作区使用共享控件。

### Configuration behavior

通用页“会话启动习惯”只选择新会话先显示终端或对话，默认终端并即时保存；支持范围内的会话始终具备两种形态，运行中的会话保持当前视图。引擎边界与启动控制归[终端与对话双显示模式](./terminal-dialog-dual-mode.md)。手机远控同其他简单偏好一样保持说明在左、开关在右。

通知总开关关闭时收起远程字段及飞书分区，飞书关闭时收起关联配置；折叠保留草稿，高级参数在 details 中按需展开。通知与 Agent 权限仅在修改后启用保存和撤销，失败保留草稿。模型测试和保存继续沿用现有显式提交语义，不把凭证和配置写入改成自动保存。

外部 CLI 保留通栏终端列表：品牌图标、名称与状态、版本说明以及右侧操作；窄内容区操作换行。安装、升级、重新检测、入口显隐、Shell 默认项和展开编辑不变，业务规则归[Shell 配置](../terminal/shell-profiles.md)。

关于页集中产品介绍、版本与更新，采用最大宽度 440px 的居中单列。自动检查左文右开关，操作居中；GitHub Star 入口保留金色图标。点击由固定 URL 的主进程入口打开仓库，不记录或宣称已 Star，失败可重试。版本、下载、更新说明和重启安装语义归[自动更新](../desktop/app-auto-update-win.md)。标题栏更新入口仍直达关于页，已下载时仍触发安装。

### Theme selection previews the workspace

通用页的 ThemePreviewPicker 使用主题令牌绘制标题栏、侧栏、工作区、终端及状态缩略图，每个预览的令牌独立作用于自身。主题名称使用已有翻译并回退注册名称，未知保存值选择注册表默认项。选中态使用弱底色、描边和勾标记，原生 radio 支持键盘选择和可见焦点。

主题行将说明放在最多 520px 宽的预览网格上方，两个 140px 卡片放不下时换为单列。加载或保存期间禁用；保存成功后应用主题，失败保留原主题并显示既有错误。预览不加载真实终端或浏览器，其结构需要随工作台布局维护。

## Alternatives considered

继续复制 CSS 的初始改动较少，但尺寸、状态和主题规则仍会分叉，因此改为宿主和插件共享公共包。没有引入自动生成业务表单或集中保存状态的框架，避免把不同配置的权限与持久化边界混在视觉组件中。

统一实色保存栏便于两种主题保持一致的可读性。保留各页既有 sticky 结构，避免将所有业务保存状态提升到设置外壳。主题预览使用令牌绘制而非静态截图，以免新增主题或改色后图片失效。

## Consequences

控件调整只需维护公共实现，官方插件通过公共依赖获得同样的交互与样式；发布插件时需同步构建和归档。简单设置易于扫读，复杂配置有全宽编辑空间。完整页面仍可能需要纵向滚动，未提交草稿不承诺跨页恢复，也未新增关闭确认流程。

## Verification

2026-11-03：`settings-layout`、`about-settings`、`mobile-remote-rail`、`plugin-settings`、`llm-configuration`、`model-catalog`、`theme-settings`、`shell-settings`、`external-cli-settings` 和新增 `settings-controls` 的 Playwright island 回归共 **73 项通过**。覆盖保存／撤销／失败保值、远控与更新开关、CLI 操作、主题切换、模型渠道、下拉键盘和 Escape，以及宿主和插件的深浅主题与窄窗口。最终截图位于 `artifacts/settings-system-final/`，人工复核通用、LLM、蓝图与 CPA 页面。

插件 fixture 挂载真实 React 视图，通过公共 SDK MessagePort 桥模拟服务，验证蓝图下拉选择、MCP 导入调用及 CPA 保存。蓝图从 10 个校验过的固定归档在仓库外离线 `npm ci`、类型检查和打包通过，输入均留在独立目录内；凭据见 `artifacts/plugins/blueprint-settings-build.json`。本次只更新 UI 归档，没有重置其他 9 个固定依赖；当前宿主公共包已有的字节漂移不属于此次依赖升级。CPA 的 `npm run plugins:cpa:check` 通过独立安装、类型检查、打包与插件包检查，凭据见 `artifacts/plugins/cpa/external-build.json`。

`npm run typecheck`、`npm run build:app`、`npm run check:package-boundary`、`npm run check:notes` 和变更范围 ESLint 通过；通知与用量保留 2 条既有 Hook 依赖警告，蓝图保留 llm-core 的 3 条 JSON import assert 兼容警告。Note 检查另报告 17 条既有外部链接诊断，没有本次未解析引用。主题 CSS 生成检查通过；全仓 theme audit 的 38 项新增报告均位于其他会话、Git 等文件，未通过的全仓检查不记为本次通过。`planche-theme.test.ts` 的 13 项通过、1 项因既有 GitPanel 类名断言过时失败；设置断言已改读公共 CSS。浏览器和独立构建不证明真实 Electron 重启持久化，也未发布官方插件更新。
