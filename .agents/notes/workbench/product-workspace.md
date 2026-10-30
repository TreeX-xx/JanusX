---
{
  "schema": "harness-note/2",
  "id": "034fb695-ff94-5476-b085-9818bcbef5c1",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-13",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-13-agent-note--034fb695.md",
      "sourceHash": "0bd18ce08a79210135bd8a8bfefa0882eb25db9c485276095d30601ebe437ea4",
      "originalBodyHash": "81582fef1879c468739e17fb58cbe8c460cfbdee4e180480358fd5aabf5f8764",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents 产物工作区彻底重构. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-13-product-workspace.md",
        "sourceHash": "0bd18ce08a79210135bd8a8bfefa0882eb25db9c485276095d30601ebe437ea4",
        "originalBodyHash": "81582fef1879c468739e17fb58cbe8c460cfbdee4e180480358fd5aabf5f8764"
      }
    }
  },
  "updated": "2026-10-30T09:34:45.522Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# 产物工作区、预览格式与通知矩阵

后续已确认、尚未实施的[统一文件窗口设计](./unified-file-window.md)将移除顶部 Island 的产物提醒与跳转，并将 OfficeCLI 预览接入默认内嵌、可整体浮出的统一文件窗口。下文记录现有产物列实现与历史取舍，统一设计实施后再更新现状。

## Problem

当前适用性：旧独立产物工作区已于 2026-10-30 删除；下文实现、通知与验证描述保留为历史记录。当前文件查看入口为统一文件窗口，Office 与共享 viewer 继续使用，旧面板及 store、发现／尺寸工具和专用测试不再维护。
JanusX 的生成文件预览是一条只为 Office 写的特例链路。中部终端列与右侧 `RightDock` 之间插着一列写死的 Office 预览列，类型锁死在 `docx/xlsx/pptx`，文件监听遇到 `md/html` 直接丢弃，`useOfficeStore` 的 Tab 容纳不下本地直读的种类。灵动岛一级展开与监控界面的产物分区同样只认识 Office 文件，外部六终端（`shell/claude/codex/opencode/janus/pi`）没有统一的上台协议。不重构的代价是每加一种文件类型就要复制一条 Office 链路。

### 产物工作区 P0 预览格式扩展
产物工作区只索引并渲染 `office/markdown/html`，`src/shared/product.ts` 把其余扩展一律判为 `unsupported`，`src/main/office/office-artifact-index.ts` 的跟踪集合与 `publicFileEntry` 守卫随之丢弃图片与数据文件，`ProductWorkspacePanel` 对 `unsupported` 只显示占位文案。AI 会话高频产出 `png/svg` 类图形与 `json/yaml/csv/txt/log` 类数据，中央编辑器经由 `file-classification.ts` 与 `ImageViewer` 可以手动打开这些文件，产物列却无法自动上台，生成即找的循环依然存在。

### 产物通知矩阵（新增/覆盖/基线修改三分）
产物通知目前只认「本会话新增文件」（`added`），两类修改事件完全静默：本会话产物被覆盖、基线文件（历史会话产物）被修改。其中基线文件被改后已会进入监控区列表（`mtime > baseline` 过滤器放行）却不发通知——列表与通知口径分裂；用户未开预览时对覆盖事件无感。同时用户确认了分级需求：修改不应抢屏（写入中间态会连续触发，弹岛即噪音），但需要可发现的最低限度提示。

### 产物工作区关闭竞态修复与 peek 胶囊满宽对齐
两个用户可复现缺陷：

1. **peek 胶囊左右大留白**：`.janus-peek-core` 是 flex 内容宽度（`min-width:180px`，不撑满），在 380px 宽的一级胶囊里居中——文本挤在中间，两侧是大片空玻璃，与 hifi 设计稿（`cap-row` 满宽：LED 贴左缘、meta 贴右缘）不符。
2. **工作区关闭后点监控区文件只开面板不显示文件**：`ProductWorkspacePanel` 的卸载清理会 `releaseWorkspace` 清空该工作区全部 tabs + 停租约。dev 模式 `StrictMode`（main.tsx 开启）对每次首挂载执行 mount→cleanup→remount：工作区关闭后首次点文件，`openPreview` 在挂载前同步创建的 tab 被清理周期 `releaseWorkspace` 清掉；office 分支还因 epoch 被 bump 而放弃就绪回填。工作区已打开时点文件不触发 remount 所以正常——与"没打开时点文件只开面板不显示文件"的现象完全吻合。


## Decision
正交模块“产物工作区”（代码标识 `productWorkspace`）是生成文件唯一的中间展示列，UI 名统一为“预览”。`src/shared/product.ts` 拥有种类映射（`office/markdown/html/unsupported`），`stores/productWorkspace.ts` 拥有 Tab 与工作区级产物列表，`components/product-workspace/` 拥有面板、文件列表、本地渲染与发现逻辑。Office 种类经由 office 引擎租用 `watch` 端口渲染（`OfficePreviewFrame` 复用），`md/html` 经由 `window.electron.file.read` 从磁盘直读渲染，零端口。主进程改动只放开产物索引的扩展名集合（`office-artifact-index.ts` 与 `publicFileEntry`），`startPreview` 的 Office 守卫、`watch` 租约池、安装器、`buildPrompt` 后端保持原样。

触发协议以文件落盘为唯一事实源，不解析任何终端输出。索引产出统一事件经由既有 `office:files:changed` 通道，隐式自动上台沿用基线加增量通知语义。记录粒度只到工作区，不做终端级归因。产物工作区打开时中央终端列压缩至下限，`RightDock` 进入强制收起态（`getRightDockLayout` 的 `stageRendered` 条件），列宽 `320~640px` 可拖拽。灵动岛一级展开（`product-notice/product-consume`）单击直接打开产物工作区并触发两侧收缩。监控界面的 Office 分区改名为产物工作区，按工作区列出生成文件，点击加载链路与灵动岛单击一致。

预览面形态（同日同步）：产物目录的唯一展示位是灵动岛一级提醒与监控界面产物分区，预览列顶部不再重复全量文件列表——预览列只承载用户点开过的文件，水平 tab 即开即显，空态提示前往岛/监控打开（`editor:product.emptyStage`）。监控界面与岛通知点击文件即直接加载预览：tab 创建与文件读取和舞台挂载在同一提交内完成，无延迟队列。md/html 直读 iframe 沙箱放开 `allow-forms/allow-modals/allow-popups` 允许页内点击交互，仍禁 `allow-top-navigation` 防劫持主窗口；预览滚动条改走黑灰谱系（thumb 亮灰、track 近黑微透），与岛通知胶囊同调，弃用橙色。

旧 UI 壳（`OfficePreviewPanel`、`OfficeFileList`、`officeDiscovery`、`stores/office`、`officeResize`、`OfficePromptPreview`）随本次删除，不保留兼容分支。`json` 暂不纳入范围。

预览界面的标题、关闭提示、岛入口与监控分区统一显示“预览”（英文 Preview），内部 productWorkspace 标识保留。Markdown／文本底色和文字、加载／错误状态、Office 外层按钮、滚动条与加载圈读取语义主题变量；HTML 与 Office iframe 的页面底板保留白色，生成文档自身的样式不被应用主题覆盖。共享 Markdown 复制反馈使用已定义的 --accent-mid。

主题资源仍由 src/shared/theme/definition.ts 集中管理；npm run theme:audit 输出 renderer 的硬编码颜色、主题专属 CSS 和无法找到静态定义的变量的文件／行／列，历史项按文件、种类和值计数保留为迁移清单，必要固定色登记次数和原因。npm run theme:check 校验生成 CSS 与新增扫描项，已接入 verify。静态扫描不证明变量作用域、每种主题的对比度或外部文档适配，新增主题仍需完整性与实际界面验证；维护说明见 [主题系统](../../../src/shared/theme/README.md)。

验证：`npx vitest run tests/unit/theme-audit.test.ts tests/unit/product/product-workspace.test.ts tests/unit/theme-registry.test.ts tests/unit/planche-theme.test.ts` 49 项通过。`npx playwright test tests/e2e/product-preview.spec.ts --project=island --workers=1 --output=artifacts/product-preview` 3 项通过，使用真实预览组件与替身文件 IPC，覆盖双主题底色和文字、打开文档后切换主题、复制反馈、加载圈、Office 错误按钮及 HTML 自身背景；截图已人工查看。CLI 负向探针验证新增颜色／缺失变量与过期生成 CSS 均被拒绝。`theme:check`、类型、构建、翻译、Note 校验及改动组件 ESLint 通过；未运行完整 verify 或 Electron 实机 Office 渲染，Note 校验保留 17 条既有外部链接诊断。

### 产物工作区 P0 预览格式扩展
`src/shared/product.ts` 拥有全部本地产物映射。`PRODUCT_IMAGE_EXTENSIONS` 覆盖 `png/jpg/jpeg/gif/svg/webp/ico/bmp`，`PRODUCT_TEXT_EXTENSIONS` 覆盖 `txt/log/json/jsonc/yaml/yml/xml/csv/tsv/toml`，`PRODUCT_LOCAL_EXTENSIONS` 是 `markdown/html/image/text` 四组的并集。`ProductKind` 增加 `image` 与 `text`，`productKindForPath` 按 `office > markdown > html > image > text` 的优先级判定，未命中者仍为 `unsupported`。主进程 `office-artifact-index.ts` 的 `isTrackedExtension` 与 `office-handlers.ts` 的 `publicFileEntry` 不改代码，经由 `isProductLocalExtension` 自动放行新增扩展，扫描预算与忽略目录保持原样。

`stores/productWorkspace.ts` 把 `image/text` 与 `md/html` 同等视为本地零端口 Tab，`openPreview` 不申请 `previewLease`，`reloadTab` 与 `watch` 覆盖只递增 `revision`。`ProductWorkspacePanel` 不分支新增种类，`unsupported` 以外的本地种类统一落入 `LocalFileStage`。`LocalFileStage` 按加载器分支：`image` 经由 `window.electron.file.readBinary` 取 `base64/mimeType` 并复用中央 `ImageViewer` 渲染，`svg` 以 `<img data:>` 承载且脚本永不执行；`text/markdown/html` 经由 `window.electron.file.read` 取文本，`text` 在 `PreviewScrollArea` 内以等宽 `<pre>` 只读呈现并在 512KB 处截断，`markdown/html` 走既有渲染链路且行为不变。产物列保持只读预览定位，编辑仍由中央编辑器拥有，`在编辑器打开`是跨列的唯一写入口。

共享 ImageViewer 的默认显示按图片区域的可用宽度和高度同时等比约束，底部文件名与 MIME 信息栏单独保留高度；小图不强制放大。原先图片高度受内容撑开，窗口放大导致图片随宽度增长而纵向溢出；现在图片使用有明确剩余高度的独立容器，不参与撑高 flex 布局。独立编辑器、嵌入编辑器和产物列共用此修复。


### 产物通知矩阵（新增/覆盖/基线修改三分）
通知矩阵（用户确认版）——**不变量：每个文件每个会话只通知一次**：

| 事件 | 一级胶囊（弹岛） | 托盘/徽标 | 已开预览 |
|---|---|---|---|
| 本会话**新生成**文件 | ✅ 上台（sticky，点击直达右侧） | 通知行「已生成」 | — |
| 本会话产物被覆盖（无论通知是否已消费） | ❌ | ❌ 不通知 | revision++ 自动刷新 |
| 基线文件**首次**被修改 | ❌ | ✅ 托盘「已更新」行 + 徽标脉冲 | revision++ 自动刷新 |
| 基线文件再次被改（已入列） | ❌ | ❌ | revision++ 自动刷新 |

一句话规则：**一级胶囊只属于「本会话新生成的产物」；托盘承载「本会话内一切产物落盘变化」；每个文件只通知一次，此后静默刷新。**

实现要点：

1. **三态分类**（`reconcileProducts`）：`lastKnown = previousByPath.get(path)?.mtimeMs ?? baseline[path]`；`path ∉ lastKnown` → `added`；`entry.mtimeMs > lastKnown` → `modified-first`（基线首改）或 `modified-subsequent`（已入列，仅 revision++）。注意不能用 baseline 单独判——连续写入会丢中间态。
2. **notice 槽带 kind**：`ProductNotice` 增加 `kind: 'added' | 'modified'`；`added` 优先——槽被未消费的 added 占据时 modified 不落位（不顶掉新生成通知）；槽空闲或槽内为 modified 时 modified 落位。
3. **上台只认 added**：Titlebar 上台判定（`shouldPresentProductNotice` + `presentedProductNoticeIdRef`）只对 `kind === 'added'` 弹岛；modified 仅进托盘投影。
4. **id 引入版本**：`product:{relPath}:{mtimeMs}`——同文件连续写在单槽内原位刷新（托盘行时间/文案更新），天然节流零重复行。
5. **文案分叉**：新增 `janus:island.peek.title.productUpdated`（zh「产物文件已更新」/en `Product file updated`）+ meta `PRODUCT // UPDATED`；`productNotification` 按 kind 切 title/meta，subtitle 仍为 relPath。
6. **生命周期**：modified 通知与 added 同构——进槽驻留，点击（`openProductFile` 消费）或被新事件覆盖才消失；托盘行被点击同样走 `onOpenProductFile` 直达。


### 产物工作区关闭竞态修复与 peek 胶囊满宽对齐
**peek 满宽**（`08-janus-peek-capsule.css`）：`.janus-island-shell[data-stage="peek"] .janus-peek-core { width:100%; min-width:0 }`，胶囊行铺满 380px——LED 贴左、meta 贴右，空态舱同样满宽。

**关闭语义上移**：`closeProductWorkspace` 从纯 `visibleWorkspaceId: null` 升级为「置空 + `releaseWorkspace(workspaceId)`」（tabs 清空 + 租约停止），即关闭产物工作区的会话清理职责由显式关闭动作承担；面板卸载清理删除（附注释说明 StrictMode 原因）。工作区切换的 `releaseWorkspace(previous)`（prop-change effect）保留——切换不触发 remount，无 StrictMode 风险。App 层补一个守卫：`productVisible` 变真时取消 pending 关闭定时器并复位 `productClosing`——否则关闭动画期间点监控区文件重开，200ms 前的关闭定时器会把刚打开的工作区再次关掉（timer 判等 `visibleWorkspaceId === closingWorkspaceId` 对同工作区重开恒真）。



## Alternatives considered
- 在 Office 链路上打补丁（加 `md/html` 分支，保留 `office:` IPC 与 `useOfficeStore`）——最强理由是零删除、风险最小。否决驱动是类型与布局全部写死，每加一种类型都是一次特例复制，维护成本随类型数线性增长。
- 把预览做进右侧 `RightDock` 新 tab，而非中间独立列——最强理由是复用宽度持久化与收起逻辑。否决驱动是文档类内容需要 `480px+` 宽度，`RightDock` 上限 `420px` 且与 `files/git` 共用单活 tab，打开文档会挤掉用户正在看的上下文。
- Do nothing / reuse 手动打开——维持文件树手动寻找，零新增 IPC 与 store。成本是生成即找的循环永久存在，外部终端与 `janus-cli` 的生成物依然不可见。

### 产物工作区 P0 预览格式扩展
- 产物列 `text` 复用 `MonacoViewer` 只读编辑器——最强理由是与中央 `code` 观感完全一致。否决驱动是窄列无需游标、查找与模型生命周期，`<pre>` 足以承载只读浏览且无额外内存开销。
- 图片自写一套产物专用渲染——最强理由是可定制缩放工具条。否决驱动是用户明确要求两列同底层机制，复用 `ImageViewer` 让加载、空态与样式只有一个实现。
- Do nothing / reuse 手动打开——维持文件树手动寻找，零新增 IPC 与 store。成本是图片与数据产物的自动上台承诺落空，产物工作区退化为 Office 专用列。

### 产物通知矩阵（新增/覆盖/基线修改三分）
- 修改也弹一级胶囊——否决：终端写文件是 create→write→close 连续 mtime 变化，逐次弹岛即噪音，摧毁 sticky 通知的信任感。
- 完全不通知修改（现状）——否决：基线文件被改后用户未开预览则完全无感，跨会话迭代产物（agent 续作上一轮的 report）恰是高频场景。
- 区分写入方（agent 改 vs 用户自己保存）——不可行：落盘为唯一事实源、不解析终端输出是既定决策；区分需等 agent 原生文件事件落地（既定重访信号）。托盘级噪音是已接受取舍。

### 产物工作区关闭竞态修复与 peek 胶囊满宽对齐
- 面板卸载清理改为只停租约不清 tabs——否决：office tab 持死端口引用，重开需依赖 openPreview 的 existing 分支旁路，错误状态会跨会话残留；清理职责放显式关闭动作语义最干净。
- openProductFile 延迟 openPreview 到面板挂载后——否决：违反产物工作区 Note 的「tab 创建与舞台挂载同 commit、无延迟队列」决策。
- App 守卫改为 timer 触发前二次确认 productVisible——与现有 `visibleWorkspaceId === closingWorkspaceId` 判等冲突（同工作区重开恒真），必须显式取消。


## Consequences
产物侧新增一个 store、一个面板目录与一个共享类型模块，旧 UI 壳的六个文件被删除，`App` 布局、`Titlebar` 发现订阅、灵动岛、`RightDock` 布局参数随之改名。预览列改为纯 tab 形态时 `ProductFileList` 与列表骨架屏一并退役，`editor:product` 的 `refreshHint/selectFromList/noProducts/fileListUnavailable` 键同批移除。获得的是单一展示列与按工作区的自动上台，所有六终端与外部 MCP 终端走同一条文件事件通道。代价是主进程 `office:` 通道名与 `main/office/` 目录名保留了 office 字样，`buildPrompt` 后端无人调用但继续维护；`md/html` 的索引复用了 Office 产物索引的扫描预算。`main/office` 改名与 `product:` 通道拆分是明确的后续重访信号，触发条件是 `janus-agentX` 原生事件落地或 MCP 产物工具需要独立版本时。`json` 纳入同样走新增 `Renderer` 一行映射，不碰现有结构。

### 产物工作区 P0 预览格式扩展（前言）
- **Gains**: 产物索引、岛通知、监控分区与预览列对 P0 格式端到端打通，新增格式只需在 `src/shared/product.ts` 加一行映射并在 `LocalFileStage` 注册已有加载器组合，无需触碰索引、store 与面板。
- **Costs and limits**: `text` 预览不支持语法高亮与表格语义，`csv/tsv` 按纯文本呈现；图片默认完整适应窗口，尚无独立缩放平移控件；`pdf/audio/video` 仍为 `unsupported`，`main/office` 目录名与 `office:files:changed` 通道名的历史包袱保留。`csv` 表格化、`pdf` 嵌入与 `shared/preview.ts` 单一映射是明确的后续重访信号，触发条件是 P1 需求立项。

### 产物工作区 P0 预览格式扩展
修复前，`image-preview.spec.ts` 在 800×480 窗口复现长图底部达到 1206px，未通过完整显示断言。修复后执行 `npx playwright test tests/e2e/image-preview.spec.ts tests/e2e/product-preview.spec.ts --project=island --workers=1 --output artifacts/image-preview-verified`，5/5 通过：覆盖直接打开 SVG 长图、PNG 横图、JPG 方图及小图，在 800×480、1600×900、600×700 间改变窗口大小，检查完整边界、宽高比、信息栏可见与不放大小图；同时检查产物区共用图片预览及既有浅深主题预览。浏览器测试使用真实预览组件与图片解码，IPC 为测试替身。`npm run typecheck`、ImageViewer ESLint 与 `npm run check:notes` 通过；未重跑 Electron 或安装包构建。

### 产物通知矩阵（新增/覆盖/基线修改三分）（前言）
改动面：`reconcileProducts` 三态分类、`ProductNotice`/`productNotification` 带 kind 与版本化 id、Titlebar 上台判定加 kind 门、i18n 双语 +1 键组、单测覆盖四行矩阵。获得：列表与通知口径统一（基线修改可见）、跨会话迭代可发现、修改零抢屏。代价：`product:{relPath}` 的旧 id 语义作废（内容寻址升级为路径+版本寻址）；托盘可能出现「已更新」行与「已生成」行并存（同一文件先新增后修改的边界——added 未消费时 modified 不落位，已消费后 modified 落位，故同文件同时最多一行）。

### 产物通知矩阵（新增/覆盖/基线修改三分）
托盘可能同时存在多条 alive 通知（product + knowledge + maintenance），而一级胶囊原先只显示栈顶一条。参照 iPhone 灵动岛的 split compact 模式落地：

- **触发条件**：知识面（召回/空态）**未**在场 且 `visibleNotifications.length >= 2` → `data-peek-layout="split"`，壳高 52px；知识面在场时维持既有让位规则（知识拥有胶囊，product/maintenance 只在托盘）——知识召回是用户刚发起的交互，优先占有胶囊。
- **渲染**：`.janus-capsule-split` grid 列布局（`grid-auto-flow: column; 1fr`），每列一个 `<button>` 单元 = LED + kicker(8.5px) + 标题(12px 截断)，列间 1px 中缝分隔线，hover 白 .05 底。subtitle/meta 在半区内不显示（空间不足）。
- **点击直达**：列单元是真实 button，被 `isInteractiveIslandDescendant` 从岛手势中排除，click 直接复用 `runNotificationAction`（open-product → `onOpenProductFile`，open-knowledge/maintenance → 各自工作台 + dismiss），点击后该通知入 `clearedIds`——裂位随之收敛（3→2→1 时退回单满宽形态）。
- **a11y**：split 时岛体 `role="button"`/`tabIndex` 摘除（避免 button 嵌套 button），焦点落在各列；`data-peek-kind` 置 `'split'`。
- **动画**：split 容器复用 `capsule-content-in` 入场，key 绑定通知 id 集合（集合变化重播）。

**刻意不移植**：iOS 的 minimal 退化位与 8s 自动轮换——JanusX 通知是 sticky 语义且并发上限为 3（product/knowledge/maintenance 各一），3 列并排即可全部容纳，轮换对 sticky 集合只机动效噪音。若将来出现非粘性活动流（实时状态类），轮换再议。

### 产物工作区关闭竞态修复与 peek 胶囊满宽对齐
获得：peek 内容满宽与设计稿一致；工作区关闭→点监控文件 → 面板打开 + 文件即显（StrictMode dev 与 production 一致）；关闭动画期间的重开不再被吞。代价：`closeProductWorkspace` 变为含异步副作用（停租约 fire-and-forget）的动作，单测补 `closeProductWorkspace releases tabs and leases` 覆盖；面板不再承担卸载清理，若未来有第三处关闭入口（非 closeProductWorkspace 路径）必须走该动作才能清理会话（明确约定）。
