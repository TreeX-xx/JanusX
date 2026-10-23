---
{
  "schema": "harness-note/2",
  "id": "8e370c0f-8280-4778-9d15-e55bc78f4fc8",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-23T15:29:07.823Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/dfdaad8f-cf1b-40f5-8509-9a5d97bfb876"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/57c74036-6700-47ea-abcc-1710c3962b5e"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/a7f6ec51-374b-4d1e-919b-169f19a7e39d"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/faacdaf7-3feb-5b33-90e0-eeb59d6b0c62"}
  ]
}
---

# 辅助面板收起、上下文底栏与预览控件精简

## Expected behavior

工具箱与文件预览可以同时对照，也能分别收起和恢复。工作台按项目实际可用宽度精简用量底栏，并在空间不足时协调辅助面板，保留用户手动偏好和会话。HTML／Markdown 使用图标模式组，文件标题与内容操作分层，低频动作进入更多菜单。

用户已授权 xdo 实施。代码已完成，浏览器回归与 Windows Electron 验证见下文；本篇维护固定验收。[显示风格](../preview-editor-display-style.md)继续拥有 Monaco 排版与 diff 色带，[全局工具布局](../global-tool-layout.md)、[统一文件窗口](../unified-file-window.md)和[用量抽屉](../runtime-drawer-cards-resize.md)维护各自宿主事实。

## 布局与收起

工具箱指浏览器／Markdown／CPA 全局工具区，与 RightDock 的文件树／Git 等工具不同。两类辅助面板的恢复按钮集中在最右侧 48px 入口栏的独立分组，面板内部保留收起动作；App 不再在工具箱与文件窗口之间渲染旧的 29px 恢复条。无项目时也保留全局工具恢复入口。

lib/auxiliary-layout.ts 协调项目分屏、工具箱、文件窗口与 RightDock。项目叶片最低 240px，横向树按已有比例反推所需宽度，中心区至少 320px；工具箱最低 320px、分隔线 9px、文件窗口最低 360px。显式打开、恢复和内容区指针操作更新工具箱／文件优先级。工具优先时先为项目与工具预留空间，再决定文件窗口可见性；RightDock 仍沿用自身约束。放不下时临时收起，恢复需要额外 24px 余量；自动状态不覆盖手动收起或宽度比例偏好。

内嵌文件内容在收起时继续挂载，槽位宽度归零并设置 inert／aria-hidden，查看器收到 inactive，避免隐藏内容继续接管快捷键。标签、草稿、活动文件、Monaco 模型与模式随原实例保留。收起、关闭标签和浮窗迁移是独立动作；浮窗仍使用原生最小化与关闭，关闭未保存内容走原有确认。Office 页码／缩放仍只保存在预览页面内，不新增跨宿主恢复承诺。

底栏改用项目区的 terminal-project 查询容器，外层宽度不变而仅拖宽工具箱也会立即精简。760／560／420／360px 依次隐藏其它终端摘要、项目名、提供商和模型；最窄态保留用量入口与上下文百分比。隐藏规则优先于通用 metadata 的 display，完整统计仍可通过上下文提示和展开抽屉访问。

## 预览控件

文件标题行保留可滚动标签、未保存标记、更多和内嵌收起；迁移与浮窗置顶位于更多。文件操作行通过共享 ViewerToolbar 接收当前 viewer 的模式与预览操作，保存始终可达，查找／HEAD 比较在 480px 以下进入更多。普通代码、图片和 Office 不显示不适用的三模式组。

HTML 与 Markdown 共用代码／双栏／预览图标单选组，提供本地化名称和提示、aria-checked、单个 Tab 停靠点及方向键／Home／End。按文件模式偏好保留，窄态不改写双栏。移除重复 EDITOR／PREVIEW 标题带；Markdown 同步滚动仅双栏显示，HTML 刷新、缩放与选项集中在同一操作区，视口和脚本状态在选项菜单可访问。

控件共用 shell／control 令牌与 28px 图标按钮，浮窗保留拖动区域和平台窗口控件。ToolbarMenu portal 申请原生网页遮挡租约，关闭菜单后恢复；菜单按钮先执行动作再关闭，避免脚本开关在事件捕获阶段被提前卸载。Office 与图片保留专业查看器及必要数值，不重复注入 React 模式工具栏。

## Alternatives and limits

仅换图标无法修复宽度依据和恢复入口；所有按钮同排会挤压标签；强制互斥会损失对照能力。因此保留独立面板和两层控件，代价是低频操作增加一次点击、隐藏编辑器继续占用内存，以及集中几何协调的维护成本。关闭文件才释放内容；若多文件驻留明显增加内存，再评估状态快照与卸载，不能以丢失草稿换取收起效果。

本次不重做 Monaco 配色、不增加编辑能力、不改变脚本默认策略及资源隔离，不合并项目与全局工具会话。验证覆盖 Windows 开发构建和浏览器夹具；不代表打包应用、其它操作系统或桌面帧率验收。

## Acceptance criteria

- [x] AC-1: 工具箱、文件预览、RightDock 的单独及组合展开状态均有清楚的收起／恢复入口；工具箱入口不再夹在终端和文件窗口间造成归属歧义。无项目工具区也可恢复。
- [x] AC-2: 文件预览收起、恢复和反复切换保留标签、草稿、活动文件、宽度及既有支持的查看状态；收起、关闭文件、迁移浮窗三者的图标与提示清楚区分，关闭保护不退化。
- [x] AC-3: 保持外层宽度不变，仅拖宽工具箱使项目区缩窄时，底栏立即按实际可用宽度精简；核心用量与展开入口不重叠、不换行、不被裁切。覆盖长项目名、长模型名、多终端及中英文。
- [x] AC-4: HTML／Markdown 的代码、双栏、预览均为图标单选组，鼠标与键盘可选择，tooltip、可访问名称、选中态正确；默认模式与按文件偏好保留，窄态不静默改写模式。
- [x] AC-5: 文件标签与面板控制、文件操作具有清楚层级；单栏无重复 EDITOR／PREVIEW 标题带，HTML 无重复预览工具栏，低频项经更多菜单仍可访问。未保存标记、标签关闭与保存路径始终可达。
- [x] AC-6: 纸面与深色主题、内嵌与浮窗均使用同一控件基线；窄宽、中宽和宽屏下无工具按钮重叠、标签完全被挤没或无意的工具栏换行，必要页码／缩放值保持可读。
- [x] AC-7: 自动收起不改写手动偏好，空间恢复符合原意；临界宽度无开合抖动；面板会话、浏览器 surface、项目分屏与 worktree 作用域不因布局切换重建或串用。
- [x] AC-8: 回归保存、查找、HEAD 比较、差异导航、Markdown 同步滚动、HTML 脚本开关／刷新／视口／缩放、Office 翻页／缩放及图片查看；不适用的模式不出现，专业查看器不重复显示控件。

## Verification

- 布局与偏好：auxiliary-layout、editor-tabs、editor-session、editor-routing、global-tools、global-tool-entry、planche-theme、browser-occlusion 八个单测文件共 55 项通过；right-tool-dock 另有 7 项通过。覆盖空间优先级、24px 恢复余量、手动偏好、会话与路由。
- 浏览器：npx playwright test tests/e2e/global-tools.spec.ts tests/e2e/office-preview-controls.spec.ts tests/e2e/image-preview.spec.ts tests/e2e/workspace-surface.spec.ts tests/e2e/terminal-usage.spec.ts --project=island --workers=2 通过 29 项；最终隐藏样式修复后 global-tools／terminal-usage／workspace-surface 重跑 26 项通过。新增组合用例固定外层宽度、真实拖动分隔线，验证百分比边界、提供商／模型隐藏、草稿与 DOM 保留、窄窗切换优先级和无项目恢复。
- 内容回归：editor-preview 7 项和 html-preview-diagnostics 5 项通过，覆盖保存失败重试／丢弃、HEAD 比较、差异导航、同步滚动、图标键盘模式、窄菜单、脚本／刷新／虚拟视口／缩放；Office 使用真实 OfficeCLI 引擎，图片覆盖缩放窗口后的适合尺寸。
- npm run typecheck、npm run build:app、主题检查、i18n 检查与触达源码 ESLint 已通过。最终 Electron 回归：unified-file-window 2 项通过；editor-window-tabs 与 editor-find-widget 4 项通过。浮窗受既有最小宽度 820px 约束，验证纸面／深色的 820、1000、1280px，内嵌窄态另覆盖 360px。桌面查找 hover 断言在并发浏览器运行时失败一次，独立复跑通过；不据此宣称消除了该时序波动。

长项目名、长模型名、多终端和中英文组合场景追加复跑 2 项通过（global-tools.spec.ts -g "auxiliary panels"）。已目视复核 usage-stress 的纸面组合布局、final-desktop 的原生网页与文件预览，以及 desktop-confirm 的纸面／深色窄浮窗和宽浮窗截图；未发现控件重叠或底栏核心用量被裁切。截图和运行产物位于 artifacts/auxiliary-panels/。浏览器夹具替代 Electron IPC；原生 WebContentsView 遮挡与 surface 保留另由 unified-file-window 桌面用例验证。没有新增独立审查要求，本轮为主代理自检。

全库 Notes 检查已有三项无关错误：entrance-choreography 缺少可解析 AC 且 updated 早于 created，island-behavior-system 缺少 Evidence；另有 17 条外部链接诊断。本次保留这些进行中工作，定向检查本次维护文档。
