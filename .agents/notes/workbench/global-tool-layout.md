---
{
  "schema": "harness-note/2",
  "id": "57c74036-6700-47ea-abcc-1710c3962b5e",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-18",
  "updated": "2026-10-23T15:27:38.390Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 全局工具实例与跨工作区分屏

## Problem

浏览器和 Markdown 原来只在当前工作区内查找实例；CPA 虽为应用级扩展，切项目仍将标签插入目标项目的焦点 pane。目标项目已有分屏时，工具位置、比例和宿主随之变化，也可能挤掉原来可见的终端。多个工作区若各自挂载同一个浏览器 surface，会争用原生视图的 bounds。

## Decision

用户确认采用双层布局。外层分隔项目区与全局工具区，内层分别保留项目分屏树和工具分屏树。切到已有两个终端分屏的 B 项目时，显示为 `[B 终端一 | B 终端二] | 工具区`。B 的整棵树及内部比例保留，外层比例和工具树不进入项目快照。

`stores/global-tools.ts` 拥有工具树、焦点、收起状态、外层比例、用户浏览器身份和 Markdown 选中归属。`GlobalToolsLayout` 的项目与工具容器保持稳定，`TerminalArea` 将工具只渲染一次，位于热工作区缓存之外。普通浏览器与 CPA 专用会话仍为不同 surface。无项目、空项目和删除活动项目均不关闭工具。

工具之间可以排序、分屏和合并；项目内容在项目区内操作。指针会话限定在源区域，原生拖拽与 store 落点也校验所属区域，不支持工具与终端同 pane 混排。工具栏不提供创建或结束终端控件。外层分隔线支持指针、方向键、Home/End 和双击恢复默认比例，内层分隔线不受影响。

项目最小宽度按分屏树计算（叶片 240 px，横分按既有比例反推所需宽度、纵分取最大），工具预留 320 px。右侧工作区展开或窗口变窄时，先约束实际呈现比例以满足两区最小尺寸；只有项目最小宽度、工具 320 px 与分隔线 9 px 的总和放不下时，才临时收起工具。该响应式状态不写入 store 的 collapsed 或 projectRatio，空间恢复后还原用户偏好；用户主动收起则持续保持。工具隐藏时清除工具焦点；恢复工具需要额外 24px 空间余量，避免临界宽度反复开合。项目始终可见。App 的恢复入口位于右侧固定栏，显式恢复工具可优先临时收起文件窗口；若连项目与工具最小宽度也放不下，则保留展开意愿、待空间恢复后呈现。独立布局宿主仍可使用原有恢复条和禁用提示。收起同步隐藏原生网页，恢复后复用内容。

工具区、分隔线与项目区处于同一 CSS Grid，开合以 240ms 连续调整网格轨道，内容宽度与边界同步变化。容器身份保持稳定，收起立即设置 inert 和 aria-hidden，退场结束隐藏工具容器；快速反向操作从当前网格尺寸继续过渡。项目与工具 ReactNode 缓存避免动效计时状态更新重渲染内容树。拖动工具分隔线、进入空间不足模式与减少动态效果偏好均禁用网格过渡。原生网页在开合、比例调整及外部容器宽度变化期间通过遮挡租约隐藏，最后一次几何变更 240ms 后恢复，使用现有冻结帧占位。此策略接受开合期间的连续布局成本，以保证真实分屏边界；不能再用固定宽度遮罩替代内容尺寸变化。

顶栏条目带已打开标记但保持可操作：再次点击激活标签并请求展开工具区，空间不足时保留展开意愿，待空间恢复后呈现。浏览器创建中的重复请求共用同一 Promise，额外 URL 打开为网页标签。弹出浏览器后保留全局身份，再次打开恢复并聚焦原窗口；回嵌仅由持有身份的主 renderer 接管，无项目时也可回嵌。销毁通知清理身份与呈现，CPA 通知不影响普通浏览器。

Markdown 全局界面不合并文稿归属。首次打开选择当前项目或全局，此后切项目和关闭重开保持所选归属；通过“文稿归属”显式选择全局、项目或遗留文稿。关闭面板不删除草稿。CPA 关闭页面释放网页呈现，托管服务继续运行；切项目不卸载 CPA。禁用或注销扩展清除全局标签和项目快照中的对应视图。

App 的文件窗口与 RightDock 几何协调由 [辅助面板需求](./requirements/auxiliary-panels-preview-controls.md)约束，工具实例和分屏树仍归本宿主。右侧入口取代旧恢复条，显式打开／恢复及内容指针操作确定辅助区域优先级，不通过悬停改写选择。

## Alternatives considered

沿用项目树搬移标签改动最少，但不能同时保留目标分屏和工具原位。为各项目保存工具落点映射可保留自由混排，但切换会改变工具位置，也需要原生宿主移交。独立工具区明确所有权，并复用已有 pane 渲染和拖拽，因此选择双层布局。

## Consequences

跨区域混排不再是工具入口的能力；对照终端与工具使用外层分屏。持续挂载会保留编辑器和网页占用，关闭标签才释放呈现。跨工作区保留不包含重启恢复：工具布局和草稿仍在内存中，导出才写入文件。本次不增加 Markdown 独立窗口，不改变仓库文件编辑器。

以后若必须将全局工具嵌入任意项目 pane，需重新设计落点映射和原生宿主所有权，不能简单共享 surfaceId。若工具数量或极端嵌套分屏持续导致收起，再评估最小尺寸与导航方式。

## Verification

2026-10-19 网格分屏重构：`npx playwright test tests/e2e/global-tools.spec.ts tests/e2e/right-dock-motion.spec.ts --project=island --workers=1` 通过 11 项；随后新增的 `global-tools.spec.ts -g 'right dock resize'` 通过 1 项。覆盖开合中间帧真实宽度变化、项目与工具边界不重叠、反向操作保留节点、窄窗自动恢复与手动收起偏好、浅色和深色下真实 RightDock 联动、同时收起工具与展开右侧，以及右侧拖宽后最小宽度约束与原比例恢复。相关单元测试 global-tools、global-tool-entry、workspace-pane、workspace-front-surface 共 61 项通过。类型检查、组件 ESLint、i18n 与 Notes 检查通过；Notes 检查另报告仓库现有的 17 条外部链接诊断。页面测试使用原生网页 IPC 替身，Electron 原生视图与实际终端的桌面帧率尚未实机验收。

以下为此前版本的历史验证，不代表当前网格动效的性能数据。

2026-10-19 滑动动效回归：`npx playwright test tests/e2e/global-tools.spec.ts --project=island --workers=1` 5 项通过，验证开合中间位置、连续六帧位移与 ResizeObserver 仅初次通知、反向展开保留节点、减少动态效果即时退出，以及跨项目、窄窗、分屏与拖动回归。收起中间帧内容仍可见且不透明，内容与项目宽度跨帧稳定。人工检查浅色与深色开合的 120ms 中间帧，截图位于 `artifacts/tools-slide-*.png`。同一 Chromium 页面采样 550ms 窗口：旧网格开合布局总耗时约 7.7/7.9ms，平移实现约 2.6/1.9ms；全页仍存在其它布局计算，不能据此保证桌面帧率。`npm run typecheck` 与组件局部 ESLint 通过。页面测试使用原生网页 IPC 替身，未另做 Electron 原生网页动效实机验收。

本次定向单元测试六个文件通过 116 项：global-tools、extensions、browser-surface-manager、workspace-pane、workspace-front-surface、global-tool-entry。global-tools.spec.ts 最终通过 4 项，覆盖 A→B→A、组件身份与非零 bounds、内外比例、文稿归属、跨区拒绝、工具内分屏、窄窗展开与项目导航，以及指针和方向键／Home／End 调整。extensions.spec.ts 通过 6 项，原 pane-tab-drag.spec.ts 通过 21 项。

使用 artifacts/build-check 的独立构建运行 desktop-cpa.spec.ts，Browser／Markdown 长按关闭重开、CPA 登录跨项目与重启保留共 3 项通过；新增浏览器弹出、最小化后定位同一窗口和无项目回嵌通过 1 项。最终响应式细节调整后重跑 4 项布局页面测试及构建。严格 unused 类型检查、局部 ESLint、i18n 检查通过；Notes 校验和 diff 检查随提交完成。

命令：`npx vitest run tests/unit/global-tools.test.ts tests/unit/extensions.test.ts tests/unit/browser-surface-manager.test.ts tests/unit/workspace-pane.test.ts tests/unit/workspace-front-surface.test.ts tests/unit/global-tool-entry.test.ts`；`npx playwright test tests/e2e/global-tools.spec.ts tests/e2e/extensions.spec.ts --project=island --workers=1`。桌面以 `JANUS_E2E_MAIN_ENTRY=artifacts/build-check/main/index.js` 和隔离用户目录启动；相关日志、截图和 traces 位于 artifacts/global-tools 及 artifacts/global-tools-*.log。已检查纸面、深色和窄窗截图；未打包、替换或重启用户正在使用的便携版。

相关事实：[Markdown 入口与草稿](./markdown-pane-entry.md)、[标签拖拽](./pane-tab-reorder.md)、[CPA 服务集成](./service-integrations.md)、[浏览器原生视图](../desktop/browser-surface.md)。
