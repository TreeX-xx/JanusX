---
{
  "schema": "harness-note/2",
  "id": "810fe6d0-a765-48f1-b89e-b0b3dd7048a8",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-10-25T14:12:54.027Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/17bbe20e-f05c-470c-aee1-3f92a86369ab"
}
---

# 蓝图统一浏览、模块预览与模块内导航

## Problem

此前蓝图保留“系统结构 / 全部 Note”切换，模块单击展开分类文档、双击打开正文详情。用户要求统一蓝图入口，并区分两个目的：单击阅读模块说明，双击进入模块内部浏览。模块和普通文件节点也需要有清晰的外观差异。

单根项目的原概览与根模块页还存在内容重复、布局不同的问题。首页统一为根模块页，使用模块页的分行布局，不再增加一层“蓝图概览”；有多个根模块时才保留聚合浏览层。

本需求已实施并通过 Main 自检，是 [实施顺序](../../workflowx-v2-adoption.md#后续实施顺序)的第一项。[v2 接入记录](../../workflowx-v2-adoption.md)描述当前行为；[旧模块视图需求](./module-structure-requirement.md)的既有验收保留为历史记录，新交互替代其中的双视图切换要求，不回写旧 Task 或执行证据。跨仓最终独立评审仍待完成。

## Expected behavior

| 操作或对象 | 目标行为 |
| --- | --- |
| 进入蓝图 | 单根项目直接进入根模块页，保留根节点，直属子模块按三列分行，直属文件按类型分组。面包屑从项目名开始；多根项目保留聚合入口，无模块来源保留原入口。移除“系统结构”“全部 Note”的模式切换。 |
| 单击模块 | 选中模块，在左侧预览该模块 module.md 的真实正文、职责与相关信息；保持当前浏览范围，主要动作不再是展开或收起文档。 |
| 双击模块 | 进入该模块的浏览界面，内容范围收敛到该模块下的文件和模块入口；双击不再仅打开 module.md 正文详情。 |
| 模块内浏览 | 当前模块节点保留在画布上方，作为本页父节点，下方显示直属文件和子模块；不混入其他模块文件。沿用文档类型分组，分组不跨所属模块。空模块也保留自身节点。 |
| 返回 | 提供明确返回入口，恢复进入前的浏览层级、选中对象、左侧预览和画布视口，不跳回全仓默认状态。 |
| 模块节点 | 使用中性底色、1px 细边框与 8px 圆角卡片，保留文件夹图标、内容计数和进入按钮；普通文件使用文档图标与 4px 圆角。选中以中性边框和浅底色表达，搜索命中使用主题强调色；Chat 关注在卡片外侧显示独立轮廓。移除页签形 SVG 和装饰阴影，状态与缩放不改变布局尺寸。 |
| 来源与诊断 | 画布不再常驻“蓝图信息”或“组合蓝图”。内嵌和工作台工具栏均提供“数据来源”，按需查看当前工作区的来源与文档扫描。其他工作区的 Note 与 checkout 不并入显示，跨工作区引用不列说明、不报错，也不触发“有待处理项”；切换工作区后显示对应来源。本工作区的真实解析与扫描问题仍展示来源 Note 标题并提供定位，原始 URI 与诊断码收进“技术详情”。正常状态不增加画布信息区。 |
| 模块接口与关联 | 左侧详情只呈现当前节点的接口、关联文档及该节点诊断。数据来源只展开当前工作区接口，提供方在其他工作区的接口不列入来源检查。本工作区来源问题与接口提供方保留定位入口。 |

左侧预览和模块内浏览分别承担阅读与导航。模块说明直接来自共享 Note 来源，不另存一份摘要作为真源。双击事件中的单击预览可以保持一致，但不得额外触发旧的展开/收起或把模块浏览替换成正文详情。

“模块下相关文件”首先按 module 归属识别，模块层级按 parent 识别。跨模块引用可在关联信息中访问，不因被引用就列为本模块拥有的文件。本层展示当前模块自身及其直属文件、直属子模块入口；当前模块是页面根节点，直属内容在其下方连接。深层内容通过继续进入或定位访问。单根项目的默认入口与显式进入根模块使用同一范围、布局和导航身份；重复进入不增加历史步骤。多根聚合页显示各根模块和其直属模块。正文从共享来源按需读取；关联信息与来源字段默认折叠，使左侧正文保持可见。

移除模式切换时同步维护搜索与 Chat 定位：检索完整文档来源，选择目标后进入其所属模块并定位、预览；不能继续依赖切到“全部 Note”，也不能只搜索当前可见节点。未归属旧文档、历史内容、解析诊断及尚无模块声明的仓库仍需可访问的文档或初始化入口。

## Scope

本轮实施覆盖蓝图工具栏、选中预览、模块浏览范围、返回导航、搜索与 Chat 定位，以及模块/文件节点样式。沿用共享解析、文档身份和写入边界，不创建第二份内容来源。

模块职责和目录的继续细分属于 [模块层级整理](../../workflowx-v2-adoption.md#模块层级现状与后续整理)。本交互应支持已有和未来的子模块，但本次记录不执行目录迁移，也不修改用户原有样式文件或其他未提交改动。

## Acceptance criteria

- [x] AC-1: 内嵌和工作台蓝图均移除“系统结构 / 全部 Note”切换；搜索与定位不再自动进入旧模式。
- [x] AC-2: 单击模块在左侧显示对应 module.md 的真实内容，保持当前浏览范围；切换选中模块后预览随之更新。
- [x] AC-3: 双击模块进入以该模块为边界的浏览界面，显示所属文件并保留子模块浏览入口，不混入兄弟或无关模块文件；当前范围可辨认。
- [x] AC-4: 模块内浏览可返回进入前的层级，并恢复选中、预览和视口；连续进入子模块后仍能逐层返回。
- [x] AC-5: 模块节点与文件节点具有可辨认的结构或轮廓差异，不只靠颜色或名称；模块可进入的含义清晰，具体视觉方案经交互检查确认。
- [x] AC-6: 完整来源搜索、Chat 文档定位、未归属与历史文档访问、解析诊断和无模块仓库入口保持可用；选择已归属文件能进入正确模块并预览，双击没有旧展开动作的副作用。
- [x] AC-7: 进入模块后，当前模块自身作为本页父节点保留在画布上方，并连接直属内容；进入更深子模块时同样保留该子模块，空模块也显示自身。重复双击本页父节点不增加返回层级。
- [x] AC-8: 单根项目首页直接使用根模块页的范围与分行布局，包含根直属文件；面包屑从根模块名开始，无重复“蓝图概览”。重复进入根节点不增加历史或切换布局，搜索、Chat 与返回使用同一首页；多根聚合页与无模块入口仍可访问。
- [x] AC-9: 两种蓝图入口均移除常驻“蓝图信息”和“组合蓝图”，工具栏按需打开来源窗口；正常状态无异常提示，异常时可读到本工作区诊断，外部工作区引用静默。来源窗口不改变模块范围或画布布局尺寸，Tab 保持在窗口内，Escape 关闭后焦点返回入口且不关闭右侧会话。当前模块接口留在左侧，本工作区提供方仍能定位到准确来源。

## Verification

可下载插件的模块浏览已补选中／范围／视口统一历史、双击进入、跨模块定位和未归属入口。`npx vitest run tests/unit/blueprint-plugin-navigation.test.ts --maxWorkers=1 --minWorkers=1` 的 4 项通过，包含真实 Graph 的 Chromium 操作，验证嵌套进入、返回／前进后的选择与缩放恢复、空模块、单根首页、文件夹／文档卡片及意见提示灯。修复默认双击缩放拦截进入事件，以及初始 fitView 覆盖恢复视口。插件仍未完成来源窗口、关联阅读及全部现行视觉矩阵的对齐；这些定向证据不重写下述旧入口验收，也不签收插件 AC-20–27。完整桌面与剩余出口归[官方插件专项](../../../planning/blueprint-official-plugin.md)。

当前轻量卡片替代下述历史页签方案；缩放、选中、命中及关注的现行验证位于 `tests/e2e/blueprint-module-card.spec.ts`，浏览与返回回归位于 `tests/e2e/blueprint-v2.spec.ts`。

2026-10-15 UI 精简：[阅读模块验证](../../documents/module.md#verification)记录 30 项通过及构建检查。模块浏览 `blueprint-v2.spec.ts` 12 项中 11 项通过；工作台首次双击 Reader module 的坐标/预览重排问题仍复现，与下述 2026-10-13 已记录问题一致，本次未改导航代码。模块单击、进入、嵌套返回、完整搜索及 Chat 关注的独立场景通过，未将该失败标为通过。

2026-10-13 模块接缝修复（Main 自检）：此前清除矩形阴影并增加页签覆盖高度，解决了接缝中部露出的主体顶边；旧的 12 组像素检查只采样页签中部，漏掉右侧肩部下伸的短竖线。现用一条连续 SVG 路径替代页签与主体的边框拼接，肩部以连续切线曲线过渡，关注外圈同步复用几何。使用 React Flow 实测尺寸，保留原布局边框占位和点击区域；背景与描边一起缩放。

`npx playwright test tests/e2e/blueprint-module-card.spec.ts --project=island --workers=1` 的 2 项通过：真实卡片与 React Flow 固定画布覆盖亮暗主题 × 0.38／1／1.62 倍缩放 × 默认／选中／搜索命中／关注共 24 组状态，逐组核对尺寸、描边、指针穿透和接缝中部及右侧肩部像素。查看放大浅色和极简深色截图，肩部与关注外圈连续。主页面回归 `npx playwright test tests/e2e/blueprint-v2.spec.ts tests/e2e/blueprint-module-focus.spec.ts --project=island --workers=1` 为 13 项通过、1 项失败；工作台首次双击 Reader module 的失败用 HEAD 原卡片与 CSS 经临时 Vite 转换再次复现，属于既有导航问题，本次未修改导航。基线配置与失败 trace 在本地 `artifacts/module-card-seam/`。严格类型检查、变更组件 ESLint 与定向 diff 空白检查通过；Note 检查 298 篇、0 错误，保留 17 项跨仓链接诊断。未执行构建、Electron 打包或桌面验收。

2026-10-12 修复选中卡片文字变糊：节点入场动画原先以 both 保留 translateZ(0) 的终态，Chromium 在动画结束后仍将卡片留在独立合成层，缩放和选中抬升层级时可出现文字纹理被放大的模糊。入场现使用 backwards 保留延迟阶段的隐藏效果，结束时恢复 transform: none，释放卡片合成层；选中边框、页签、入场节奏和导航行为保持不变。该规则适用于模块与普通文件节点。

浏览器对比核对约 1.32 倍缩放的修复前后截图。node .cache/card-clarity-verify.cjs 覆盖内嵌/工作台 × 纸面/深色共 4 个组合，约 1.25 倍滚轮缩放后各连续切换选中 3 次，卡片变换恢复为 none、透明度为 1，无入场残留的卡片 3D 合成层；已查看纸面工作台和深色内嵌截图。诊断与截图保留在本地 artifacts/card-clarity/。JANUS_E2E_PORT=42359、NO_PROXY=127.0.0.1,localhost 下运行 npx playwright test tests/e2e/blueprint-v2.spec.ts --project=island --workers=1 -g 'module preview, scoped pages'，两种入口的 2 项现有回归通过。仅改 CSS 与本专题，未重跑类型检查或打包，未将混合工作区的既有修改提交。

2026-10-08 初次交付 Main 自检通过，未调用独立 evaluator。浏览器样例包含项目、子模块、孙模块、跨模块引用、空模块及历史文档；内嵌和工作台均覆盖单击预览、双击进入、逐层返回的选择/正文/视口恢复、完整来源搜索和 Chat 定位。检查了浅色与深色截图；正文在左侧首屏可见，模块容器和文件轮廓可区分。

| 检查 | 命令与结果 |
| --- | --- |
| 模块投影、真实语料、Chat 关注与旧画布回归 | `npx vitest run tests/unit/workflowx-v2.test.ts tests/unit/blueprint-architecture.test.ts tests/unit/note-focus.test.ts tests/unit/blueprint-graph-controller.test.ts tests/unit/blueprint-canvas-navigation.test.ts`：43 项通过。真实来源 260 份文档、9 个模块，所有文档均可通过归属页面或未归属列表访问，来源对象未修改。 |
| 交互与旧入口回归 | `npx playwright test tests/e2e/blueprint-v2.spec.ts tests/e2e/blueprint-architecture.spec.ts tests/e2e/note-wiki.spec.ts tests/e2e/blueprint-workspace-init.spec.ts tests/e2e/blueprint-workbench.spec.ts --project=island --workers=1`：35 项通过；测试端口 `JANUS_E2E_PORT=41837`，本地代理清空。模块浏览不写回布局，旧画布的拖动、重置、撤销仍通过 IPC 持久化。 |
| 类型、构建、语言资源 | `npm run typecheck:strict-unused`、`npm run build:check`、`npm run i18n:check` 均通过；针对变更文件的 ESLint 为 0 error，保留既有布局状态中文字符串的 1 项 warning。 |
| 文档语料 | `node scripts/verify-note-corpus.mjs`：257 份维护中的 v2 文档，254 份已迁移来源、3 份保护文件；0 error，23 项已允许的读取诊断。 |

本轮没有创建 Task、执行全仓目录迁移或改写历史迁移哈希。下一项为 [关注工具与模块浏览适配](./module-focus-navigation.md)，其验收单独记录；之后继续真实子模块职责设计、README 演示和最终独立评审。

父节点保留的补充验收 AC-7：`npx vitest run tests/unit/workflowx-v2.test.ts tests/unit/blueprint-architecture.test.ts` 14 项通过；`npx playwright test tests/e2e/blueprint-v2.spec.ts tests/e2e/blueprint-architecture.spec.ts --project=island --workers=1` 7 项通过（端口 41839，本地代理清空）；`npm run typecheck:strict-unused` 通过。核对浅色内嵌与深色工作台截图，当前模块位于直属内容上方；空模块仍显示自身，重复进入本页父节点不会多出返回步骤。此补充保留原分组和来源归属，页面父子连线不改写 Note。

首页合并的补充验收 AC-8：上述两个单元文件 15 项通过，两个浏览器文件 9 项通过（端口 41841，本地代理清空），`npm run typecheck:strict-unused` 通过。覆盖默认首页与显式根模块投影相等、直属文件显示、四个子模块分行、重复进入不增加历史、搜索/Chat 与返回、多根聚合页往返及无模块回退。截图等待节点入场动画完成，并检查根节点与直属文件进入视口；核对浅色内嵌与深色工作台布局。真实语料仍全部可达；`node scripts/verify-note-corpus.mjs` 报告 258 份维护文档、0 error、23 项允许的读取诊断。变更源码 ESLint 为 0 error、1 项既有 warning；`git diff --check` 通过，八份保护文件哈希不变。本次未重跑全量构建，以上为 Main 自检，独立评审仍待完成。

2026-10-09 来源呈现补充验收 AC-9（Main 自检）：移除常驻来源区，将诊断和全局接口迁入共用“数据来源”窗口；左侧保留节点范围的信息。当时汇总按仓库与 checkout 路径区分快照；当前范围已按下述工作区隔离调整。重复扫描诊断去重，不修改来源对象。上述历史实施顺序与评审状态不由本次界面调整重新验收。

| 检查 | 命令与结果 |
| --- | --- |
| 来源汇总 | `npx vitest run tests/unit/blueprint-source-info.test.ts`：3 项通过，覆盖正常状态、诊断保留与去重、不同 checkout、过期来源和悬空接口提示。 |
| 交互与兼容 | `npx playwright test tests/e2e/blueprint-source-info.spec.ts tests/e2e/blueprint-v2.spec.ts tests/e2e/blueprint-architecture.spec.ts tests/e2e/blueprint-composition.spec.ts --project=island --workers=1` 首轮 18/20 通过；修复关闭窗口的焦点恢复后，来源入口 4 项全部复跑通过，组合蓝图跨仓定位也再次通过。20 个不同场景分批通过，覆盖模块浏览与返回、旧格式、两种入口、键盘操作、正常与诊断状态。测试端口 41870，本地代理清空。 |
| 视觉与布局 | 核对浅色内嵌、浅色工作台、深色来源窗口截图。画布顶部空间恢复；来源窗口不改变画布布局尺寸，尺寸断言使用布局宽高，避免工作台入场缩放影响。 |
| 类型、构建、语言资源 | `npm run typecheck:strict-unused`、`npm run build:check`、`npm run i18n:check` 均通过。变更源码 ESLint 为 0 error、2 项既有中文字面量 warning；构建保留既有混合动态/静态导入 warning。 |
| 文档语料 | `node scripts/verify-note-corpus.mjs`：267 份维护中的 v2 文档，254 份迁移来源、3 份保护文件；0 error、27 项读取诊断。变更文件 `git diff --check` 通过。 |

2026-10-11 工作区显示范围补充（Main 自检）：加载只投影当前根目录，外部绑定及引用不带入其他工作区 Note；数据来源不显示外部 checkout、引用说明、提供方接口或关联诊断。更新、建议与自动审核只订阅所选工作区，切换后显示对应数据。本地扫描、缺失目标和接口问题仍保留。

`npx vitest run tests/unit/blueprint-source-info.test.ts tests/unit/blueprint-composition.test.ts tests/unit/blueprint-workspace-init.test.ts tests/unit/note-refresh.test.ts tests/unit/blueprint-workspace-selection.test.ts tests/unit/blueprint-review-ui.test.ts tests/unit/blueprint-architecture.test.ts --maxWorkers=1 --minWorkers=1` 的七个文件分批运行，去重 72 项通过。覆盖外部 Note 未接入、缺失、已绑定、忙碌、切换根目录、本地真实错误保留，以及审核组件实际订阅路径。`npx playwright test tests/e2e/blueprint-source-info.spec.ts tests/e2e/blueprint-source-info-reference.spec.ts --project=island --workers=1` 的 6 项通过（端口 42913），覆盖内嵌和工作台入口、静默跨仓引用、本地诊断与原文定位。改动源码 ESLint 与双语键校验通过。

`npm run typecheck:strict-unused` 仍由既有 Note MCP expectedHash 类型不匹配及维护服务未使用的 JanusAgentMessage 导入阻塞；本次未修改这两个文件。全仓 `git diff --check` 还报告既有 JanusIsland.tsx:423 尾部空白。未重新打包或验收桌面程序。
