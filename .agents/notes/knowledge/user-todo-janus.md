---
{
  "schema": "harness-note/2",
  "id": "37470903-f9ec-427c-8dad-78c4ef01e3d8",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-10-09",
  "updated": "2026-10-28T06:07:03.626Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf",
  "tags": ["memo","todo","milestone","assistant","workspace"],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/constellationLayout.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/useConstellationMotion.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/MemoEditor.tsx","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/island/islandLayout.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/janus/useAuxiliaryIslandLayout.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/constellationGeometry.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/shared/memo.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/MemoConstellation.tsx","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/island/islandMotion.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/useMemoIslandLayout.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/memo/memoLayout.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/memo/store.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/memo/chat-tools.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/stores/memo.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/janus/useJanusChat.ts","role":"implementation"},
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/memo/MemoPanel.tsx",
      "role": "entry"
    }
  ],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/ec7c6199-3c36-49b4-9b41-d06c3e11e724"}
  ]
}
---

# Chat 联动备忘录与线性里程碑

## Description

备忘录承载应用内持久背景、用户想法和讨论结论，人工与 Chat 模型共用同一个编辑服务。文件内按人工顺序组织节点，每个节点包含记录点；版本和时间是自由文本标注，修改标注不排序，节点不维护完成状态。在工作区解耦和共享 Chat 轮次工具整合的基础上，本轮已实现固定外岛的文件栏折叠、共享附岛动效、星座画布、逐条记录及滚轮／中键相机。人工插入选中新星；删除星同时永久删除所含记录。本篇维护当前事实与后续边界，不作为 Task 实施契约。

## 存储与编辑

MemoStore 在 userData/janusx/memos 保存独立 JSON 文件，使用串行读改写、原子落盘、稳定 UUID 和 expectedRevision 检查。人工与模型均提交局部操作；批量操作完整校验后一次写入，迟到写入不能覆盖已经变化的修订。removeNode 在一次原子编辑中删除节点及全部所含记录；界面与模型工具使用相同语义。界面确认显示星名和记录数，取消不写入，成功后清理对应草稿并选中剩余第一星，无星时显示先建星的空态。删除文件要求最新修订号。

备忘录 v3 不含 workspaces 或 unassigned，也不提供 mapWorkspaces。用户明确要求删除未归入入口及其中全部记录；所有新增、移动记录必须指向节点 UUID，空备忘录先建星再记录。创建、选中文件、绑定会话及 Chat 添加或移除工作区均不再写入备忘录映射；Chat 资源只服务当前会话的上下文。文件仍保存在应用内，不随项目仓库复制。

旧 v1／v2 文件先完整校验，再移除未归入记录及废弃字段。MemoStore 首次读取时在串行队列内原子写入 v3，增加一次修订并发送变更事件；文件、星内记录的身份、来源和创建时间保留。重复读取不再写盘或增加修订，旧修订的迟到编辑报冲突。此迁移按用户确认永久删除未归入记录，不转入其它星；此前 v1 只读投影、成功编辑才迁移的策略已由本次删除要求替换。结构损坏的旧文件明确报错并保留原字节，不猜测正文或重建记录。废弃工作区字段不会变成生态关系；未来项目核对需要单独设计执行上下文或外部关系。

正文单行字段失焦或非输入法组合中的回车保存；多行记录失焦或 Ctrl／Cmd+Enter 保存，回车换行；Esc 撤销当前修改。草稿按文件与字段稳定身份留在 MemoPanel 生命周期内，节点、文件和面板展示切换后可恢复；保存失败保留草稿，修订冲突刷新后允许显式重试。暂时隐藏保持编辑器挂载与光标。删星成功清理该星标题、标注及所含记录的草稿；取消或冲突保留原内容。持续输入防抖、应用重启后的草稿恢复及完整修改来源历史仍后置。

## 会话与共享工具轮次

备忘录入口与 Chat 工具默认可用，不受旧配置中的 memo 开关控制。Chat 工具仍要求模型支持工具调用，配置兼容见[创新功能管理](../workbench/experimental-preview-features.md)。

会话记录的 memoId 是绑定唯一真相。未绑定的会话首次选中文件直接绑定，也可按明确的新建请求通过 memo_create 创建并绑定；已有绑定后切换文件、主动退出或删除绑定文件，新开会话并继承 Chat 资源，旧会话仍在列表中。流式回复在原会话后台完成，可以回到原会话查看和继续。同文件切换节点不调用 bindMemo，不新开会话。

Chat 的备忘录入口是输入区模型／权限工具栏中的 26px 书本图标，保留悬停提示、键盘可达、展开状态和后台更新圆点；不再单独占用上方一行。会话侧栏可见时隐藏空会话工具栏，主岛收窄隐藏侧栏时恢复会话选择器。没有已附加或可附加工作区时不渲染空资源栏。入口点击只切换展示，会话绑定规则不变。

退出按钮表示离开备忘录；触发器、Escape、切到其他 island 视图或空间不足的自动隐藏只改变展示，不解除会话绑定。没有独立 Chat 开关、后续消息排队或跨文件归入。

attachMemoChatTools 将 memo_read、memo_edit，以及未绑定轮次的 memo_create 注册到共享 ChatTurnPorts.localTools，在正常 Chat 上下文与步数预算内执行。janus-agentX 的宿主本地工具入口已补齐，无工作区和有工作区都可使用；工作区工具仍走原有资源与会话路径。本地工具同样消费调用者的工具选择、轮次 gate 与取消信号，不与内置或工作区注册名重名。独立模型阶段、五步上限、最近八条消息截断和结果拼接阶段已移除，普通回复产生的结论可以在同一轮整理。

未绑定轮次由 renderer 发送原始 memoMessageId。memo_create 首次成功后在原轮次内固定文件，通过 memo_created 事件将绑定交给发起会话；后台回复不改投当前可见会话，不覆盖期间人工选择。重复调用返回同一文件，绑定已有文件时不提供创建工具；需要另一个文件时在 UI 新建／切换。创建也检查队列内取消信号。会话规范化持久化有效 UUID 格式的 memoId，保存、加载及重载后保持绑定。已有缺失绑定的历史快照不猜测恢复；文件仍可从左侧重新选择。创建不会强制展开用户关闭的面板。

项目 Note 与应用内 memo 使用不同存储和工具。普通 Chat 始终说明目标边界，备忘录工具不可用时说明限制，不把 Note 作为替代。消息含“备忘录／memo／星座／当前星”等明确标记时，Note 工具不提供写入，执行层也拒绝直接调用；项目 Note 仍可作为参考读取。排除规则只收窄权限，不把关键词视为写入授权。混合两种目标的请求保守要求分开 Note 写入，可能影响包含这些词的 Note 维护请求；代价是避免再次误投，后续若引入显式目标选择可替换该排除规则。未带目标标记的自然指代仍依赖会话上下文和工具提示，不能将此规则声称为完整语义分类器。

memo_edit 的模型参数使用无共享引用的单一操作对象，op 枚举从 memoOperationSchema 派生，各可选字段说明适用操作；执行前仍用原 discriminatedUnion 严格检查必填字段、无关字段及修订。AI SDK 3 默认把复用的 Zod 类型生成 $ref，当前 Google/Vertex 转换未展开该引用，原来导致 afterId／nodeId／pointId／title 共 12 处缺少 type。模型侧声明每个字段一次，afterId 明确 string + nullable，避免工具声明在请求阶段被拒绝；null 插最前、省略追加和 UUID 锚点语义不变。代价是模型参数不再逐分支表达必填组合，字段描述负责引导，服务端严格 schema 保留最终约束。

工具按页读取点，按最新修订做局部编辑，写入附带来源会话与用户消息 ID；缺少文件、冲突和取消返回真实失败，不能声称保存。模型不支持工具调用时继续普通回复并说明限制。工具只管理当前会话绑定的备忘录，不读取项目内容；项目读取沿用 Chat 能力。memo_read 无 nodeId 时只返回概览，指定节点 UUID 才读取分页记录；目标或分组不明确时先向用户确认，不能再写入 null 节点。模型建议不能记成用户决定。memo 用于持久记录，todo_write 用于当前轮次的执行步骤。

选中节点统一由 renderer memo store 按文件和 UUID 保存，面板与 Chat 使用同一选择解析规则。普通发送在异步准备前捕获 memoId、messageId 和 selectedNodeId；同一会话后续切星会生成新的上下文，进行中的旧请求不跟随切换。主进程只在绑定文件中解析选择，并在概览、读取和编辑结果中返回选中／无选择／旧客户端未提供／目标已删除状态。界面删星后选剩余首星只影响新消息，旧请求的已删目标保持失效，不能自动改写到其它星。选中状态保留于应用内存，不随 memo 文件落盘。

流式中追加的消息各自捕获选择；steering 只附带当前绑定文件内的 UUID 快照并标记 unverified，模型需通过 memo_read 验证该节点仍存在，再按最新修订编辑。选择上下文按消息归属，不更改原轮次的目标；工具结果仍标明原轮次消息 ID。追加失败并回退为新轮次时保留原发送快照。明确命名节点优先于界面选择；没有有效选择、节点已删或目标不明时提示询问。来源仍沿用轮次发起消息，不在本次扩展逐追加消息的写入来源。

## 星座画布与逐条记录

矩形画布上部为可折叠文件栏和独立滚动的逐条记录，下部星座横跨整个左侧 island。MemoConstellation 用原生星形按钮、SVG 连接和星旁引线标题／标注表达节点，业务顺序与展示坐标分离，按稳定 ID 作不等距、方向变化的布局，连接使用浅曲线。插入只调整相邻星，删除保留其余坐标，排序重用原位置。未归入入口、独立星、记录区与归入选项均已移除。星点、局部引线 SVG 和文字由同一星按钮定位；标题在横向引线上方 4px，标注在下方 4px，文字对应端与引线末端对齐；标签按四个方向择位，降低交叠。标题／标注字号为 11px／10px，长文字省略并可通过提示查看全文；缩放和平移使用同一元素锚点，不再由全局画布线条和另一组文字偏移分别定位。星间连接在相机投影后按所有标题、标注与引线的屏幕区域留出 4px 余量，裁掉重叠线段；文字、引线和避让计算共用 STAR_ANNOTATION 尺寸。绘制、命中和裁切共用轻弧几何，插入按未裁切逻辑连接判定，标注留白不制造命中断层。裁切仍留下连接空隙，四向择位不保证高密度时全部文字互不重叠。

选择按文件与稳定节点 ID 保留。首次或原选择失效时选首节点，无节点时进入先建星的空态；后台新增或编辑不抢选中，重排保留原 ID。点击空白显示临时星、连接预览及就地标题输入；回车确认、Esc 取消，再点空白保留标题并换目标。逻辑相邻连接附近 34 CSS px 优先插入，明确首部区域插最前，其余空白追加；工具栏和星菜单保留显式入口。提交使用原文件、修订和 afterId；成功按新 ID 选中新星，取消不写入。冲突保留输入并刷新修订供显式重试，前后锚点失效报错并要求重选，不悄悄改成末端。保存成功后新星从点击处以 380ms 短弧接入，邻居让位、连接逐帧跟随；减少动效直接到位，关闭／切文件取消过期展示。布局按文件缓存在 MemoPanel 中，文件切换和隐藏／重开保留，宿主卸载或应用重启后按 ID 和当前顺序重建。左右键、Home 与 End 仅操作实际星，End 到末星。

上方选中星后隐藏重复的备忘录文件名，保留整个文件的节点数量和信息数量；文件栏仍可重命名，无星时保留文件名编辑。按选中星逐条显示可自然增高的文本行，以分隔线区分记录；记录以编号和细分隔呈现；来源在悬停或聚焦时可达，移动／排序／删除放入行菜单，点击外部收起。标题与版本分层，版本可清空，编辑显示未保存、保存中、成功或失败反馈。添加记录点固定在正文标题栏右上角，不随记录滚走，目标始终是当前星，无星时没有添加记录入口；按钮打开正文内多行输入，Ctrl／Cmd+Enter 保存、Esc 取消，跨节点切换恢复草稿；星的菜单与记录操作分开。

上方正文与文件列表使用原生滚动，10px 拖动槽内以透明边框保留 4px 可见滑块；悬停／聚焦加深，滑块悬停增宽，stable gutter 避免出现滚动条时正文横移。滚动到边缘不传递到外层。记录菜单的“移动到节点”复用共享 Select，使用独立 body 浮层，保持当前选项标记和主题色，避免系统原生菜单材质跳变。浮层点击不关闭所属记录菜单或岛；上下方向键、Home／End、Enter 选择，Esc 只关闭下拉，Tab 返回正常焦点顺序。共享组件保留原默认按钮角色，备忘录显式使用 combobox；节点和记录操作菜单统一留白、圆角、阴影与禁用状态。

滚轮仅在星座视口缩放，以指针位置为锚点；中键按住用指针捕获平移，拖动期间屏蔽误点击。缩放范围为 0.4–2.4，平移有界；文字和按钮保持屏幕尺寸可读。按钮提供缩放和回到选中星，键盘 +／-／0 等价；聚焦画布后方向键平移。选星只作必要的可见性调整，同文件手动相机不因正文编辑重置，切文件重新建立相机。记录列表继续正常滚动，外岛大小不受相机影响。

首次显示、切文件或重新进入工作面时，共享 useIslandReveal 编排可见星与连接；180ms 显现与最多八级 18ms 错峰合计约 324ms。快速切换取消旧动画，同文件选星和连续 resize 不重播整图；减少动效关闭编排。

## 开合与联合布局

memo 和圆桌羊皮纸、角色结果、问题池共用 islandMotion.ts 的 useIslandPresence、useIslandReveal 和 createIslandGeometryMotion，基础开合时长统一为 220ms。退场保留 DOM，快速反向开合取消旧定时与帧回调；减少动效直接稳定呈现。圆桌缓存退场内容并在关闭后恢复主岛和焦点，旧 auxiliaryClosing／独立清理计时与固定主岛偏移已移除。业务状态、会话、字体材质仍由各自宿主管理，动画完成只清理展示。文件栏、抽屉和遮罩有开合反馈；IPC 读取状态、错误重试与动效独立。

layoutMemoIslands 与圆桌 useAuxiliaryIslandLayout 共用 layoutCompanionIslands，按左右方向和 CSS 视口一次求解最终位置，不根据动画中的主岛矩形反算。主岛按最终几何短过渡让位和复位，resize 立即满足边界。手动折叠只把岛内文件栏变为窄轨，释放空间给正文，同视口下两岛外框和最终位置不变；自动紧凑与抽屉独立于手动偏好。备忘录和圆桌附岛 portal 到 body，层级 10052；圆角外壳内保持 16px 留白。

| 模式 | 条件与工作面 |
|---|---|
| 完整并排 | 至少 1056px CSS 宽度，备忘录 460px；手动折叠不改变外框 |
| 紧凑并排 | 至少 916px CSS 宽度，备忘录 320px、可打开文件抽屉 |
| 上下排列 | 横向不足、剩余高度至少 652px，备忘录最低 280px，星座高度 112px |
| 单一工作面 | 并排与上下均放不下，切换对话／备忘录且保持会话、草稿和文件 |

原生最小窗口仍为 1000×600；页面放大可能进入单工作面。完整 Titlebar 留出窗控空间；主体、附岛、弹窗和快捷键的事件归属保持原有修复。自动折叠不修改手动偏好，恢复模式有 32px 余量。

## 验证与限制

以下先保留第一版实施时的验证证据；本轮新交互验证另列。2026-10-14 Main 执行，模型与浏览器 IPC 使用替身；Electron 用隔离用户目录和真实 memo IPC。没有使用真实凭据，不将工具执行通过等同自动整理质量通过。

- `npx vitest run tests/unit/memo.test.ts tests/unit/memo-chat.test.ts tests/unit/memo-layout.test.ts tests/unit/memo-workspaces.test.ts tests/unit/llm/janus-agent-ports.test.ts tests/unit/janus/island-chat-window.test.ts --maxWorkers=2 --reporter=dot`：6 文件、53 项通过。覆盖 v1 读取不写盘、成功迁移、冲突不改写、内容来源保留、共享循环读写、取消及删除后不重建。
- janus-agentX：`npm run test --workspace=@janus-agent/janus-agent -- tests/chat-local-tools.test.ts tests/chat-turn.test.ts tests/chat-turn-maintenance.test.ts`：3 文件、33 项通过；`npm run build --workspace=@janus-agent/janus-agent` 通过。覆盖本地工具入口、能力和调用者选择、名称冲突及工作区场景的同一轮次 gate。
- `npx playwright test tests/e2e/memo.spec.ts tests/e2e/memo-island.spec.ts tests/e2e/memo-workspaces.spec.ts tests/e2e/memo-navigation.spec.ts --project=island --workers=1`：21 项通过。覆盖真实组件的窗口边界、节点正文、长线键盘导航、减少动效、冲突草稿跨节点和文件恢复、快速开合、资源解耦及合成输入法 Enter。
- `npx playwright test tests/e2e/memo-desktop.spec.ts tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1`：2 项通过。旧 setChatAccess 用例已修复；真实桌面持久化、重启恢复、删除、事件、1000×600 最小窗口、窗控命中及 renderer 125% 缩放通过。
- `npm run typecheck`、范围内 ESLint、`npm run i18n:types`、`npm run i18n:check`、`npm run build:app` 通过。截图在 `artifacts/memo-analysis/constellation-{dark,planche}.png` 和 `layout-desktop-1000.png`。

首次浏览器组合运行 14 通过、2 失败，定位为自动文件栏宽度过渡短暂挤窄正文，以及静态间距断言读取入场中间帧；修复自动布局路径和测量等待后，最终 21 项全部通过。此前主体 island 的四项旧断言失败记录由设计评审保留，本轮没有为那些断言改写产品行为。完整发布 verify、系统 DPI、多显示器及真实中文输入法组合尚未专门验收。

### 星座第二版验证（历史）

2026-10-14 Main 在此 worktree 执行：

- `npx vitest run tests/unit/memo.test.ts tests/unit/memo-chat.test.ts tests/unit/memo-workspaces.test.ts tests/unit/memo-layout.test.ts tests/unit/memo-camera.test.ts`：5 文件、31 项通过。包含指针锚定缩放、缩放上下限、有界平移、两岛布局、修订冲突及一次删除含 80 条记录的节点；删除仅增加一次修订，未归入保持原内容。
- `npx playwright test tests/e2e/memo.spec.ts tests/e2e/memo-island.spec.ts tests/e2e/memo-workspaces.spec.ts tests/e2e/memo-navigation.spec.ts tests/e2e/memo-constellation.spec.ts --project=island --workers=1`：27 项通过。新增覆盖固定外岛折叠、首位／中间／末端插入及正确选中、冲突保留锚点、删星取消与永久删除、滚轮／中键及记录滚动归属。羊皮纸快速关开、1280×720／1000×600／800×900／800×600 两岛边界、12px 间距、单工作面 inert 恢复及焦点返回通过。
- `npx playwright test tests/e2e/memo-desktop.spec.ts tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1`：本轮 2 项通过，使用构建后的 Electron 验证持久化、重启、真实 IPC、最小窗口和 renderer 125% 缩放。
- `npm run typecheck`、范围内 ESLint、`npm run i18n:types`、`npm run i18n:check`、`npm run build:app` 通过；最终构建保留既有 Vite 分块提示。深色与 planche 新星座截图经查看：`artifacts/memo-analysis/constellation-v2-{dark,planche}.png`。

首次新交互浏览器组合 26 通过、1 失败，失败为持续浮动的羊皮纸按钮使 Playwright 等待稳定；改为按实际屏幕位置点击后，最终组合 27 项通过。自检另发现运行球 CSS 的旧位移会覆盖共享几何，已删除并补上主岛边界和间距断言。角色结果与问题池已迁移共同外壳与接线，完整业务流程未另做端到端验收。

npm run check:notes：297 篇 harness Notes、0 错误，保留原有 17 条跨仓链接诊断。旧 useMemoPresence 源码引用已修复，当前主题与模块入口已同步。

浏览器服务运行时仅在测试进程设置 `NO_PROXY=localhost,127.0.0.1,::1` 与 `JANUS_E2E_PORT=12529`，使本地服务避开环境代理；未修改全局代理。真实模型整理质量、完整发布 verify、系统 DPI、多显示器及真实输入法仍未专门验收。

### 移除未归入与文字对齐（历史）

用户明确选择删除未归入入口及其中全部记录；本次实现 v3 与首次读取时的原子迁移，仅在隔离测试目录验证迁移，用户实际旧数据将在应用读取时清理。

2026-10-14 Main 沿用上节五文件单元命令：5 文件、33 项通过。新增验证 v1／v2 旧记录移除落盘、星内身份和来源保留、修订只增加一次、旧修订冲突、不可读旧文件不改写，以及共享工具拒绝 null 节点、概览与节点分页读取。此前“v1 读取不写盘”与未归入保留属于历史证据，不再描述当前升级策略。

同一五文件浏览器命令：28 项通过。覆盖删除末星的空态、剩余星及其记录保持、无未归入入口／移动选项，以及长中文标题和标注在缩放、平移、文件折叠、主题切换后的实际 DOM 测量：标题底边与引线相距 4px，标注顶边相距 4px，文字末端与横线对齐。深色与 planche 截图已查看：`artifacts/memo-analysis/constellation-v3-{dark,planche}.png`。

同一桌面命令：2 项通过。构建后的真实 Electron 验证 v3 IPC、星内记录持久化、重启及最小窗口／125% renderer 缩放。typecheck、范围内 ESLint、i18n:types、i18n:check、build:app 通过。平台及真实模型限制沿用上节说明。

本 worktree 的 node_modules 原先指向主工作区。为消费新共享接口，当前链接改指向本仓 artifacts/memo-runtime/node_modules：其余包引用原安装，janus-agent 引用相邻仓库已构建产物；未修改主工作区依赖安装或 lockfile。交付需要同时带上 janus-agentX 的本地工具入口变更，并按既有流程构建、刷新依赖；旧安装不具有该接口。

### 正文标题与连接避让（历史）

2026-10-14 Main 沿用上节五文件单元命令：5 文件、36 项通过。新增覆盖重叠避让区域合并、反向连接、无可用连接，以及 24 星蛇形布局在 0.4／0.7／1／1.6／2.4 缩放下的可见线段检查。

同一五文件浏览器命令：31 项通过。新增覆盖选星后无重复文件名、数量信息保留，14 星跨行场景中连接与实际 DOM 文字框及 SVG 引线零相交；覆盖 0.4／2.4 缩放、中键平移、文件栏折叠、上下布局及主题切换。缩放后的上行连接可悬停插入，并保持原 afterId 和正确选中新 ID。

补充插入检查首次组合为 30 通过、1 失败：短可见段的中点落在星按钮点击范围，悬停没有激活。插入命中路径进一步避开星按钮后，星座专项 10 项和最终组合 31 项均通过。深色与 planche 截图已查看：`artifacts/memo-analysis/constellation-clearance-{dark,planche}.png`。

最新 `npm run build:app` 后，`npx playwright test tests/e2e/memo-desktop.spec.ts tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-analysis/desktop-check`：2 项通过。正文草稿检查改为选中星标题，真实 Electron 的最小窗口、125% renderer 缩放及持久化仍通过。`npm run typecheck` 与三个受影响 renderer 文件的 ESLint 通过；本轮没有新增翻译项，i18n 检查沿用上一轮证据。

浏览器测试进程使用 12529 端口，桌面服务使用 12530，均仅在进程内设置 NO_PROXY。连接周围留白可以减少高密度时的可见连接；不会承诺全部文字互不重叠。

### 空白创建、自然星座和文档式编辑（当前）

用户已采纳星座交互并授权改善上方编辑区。MemoConstellation、constellationLayout、useConstellationMotion 和 MemoEditor 已实现相关行为；取舍与缓存边界见[设计评审](milestone-design-review.md)。保持 memo v3 存储结构及两岛外框。

单元：`npx vitest run tests/unit/memo.test.ts tests/unit/memo-chat.test.ts tests/unit/memo-workspaces.test.ts tests/unit/memo-layout.test.ts tests/unit/memo-camera.test.ts tests/unit/memo-constellation-layout.test.ts`，6 文件、40 项通过。

`npx playwright test tests/e2e/memo.spec.ts tests/e2e/memo-island.spec.ts tests/e2e/memo-workspaces.spec.ts tests/e2e/memo-navigation.spec.ts tests/e2e/memo-constellation.spec.ts tests/e2e/memo-editor.spec.ts --project=island --workers=1`：6 文件、40 项通过。新增覆盖空白创建／取消、相邻插入、锚点失效重选、单星逐帧运动、迟到保存、稳定布局缓存、行内多行草稿／失败重试、保存反馈和菜单互斥。

最新 `npm run build:app` 后，`npx playwright test tests/e2e/memo-desktop.spec.ts tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-analysis/desktop-check` 首次为 1 通过、1 失败：原生请求 1400px 时返回 1401px，旧断言要求完全相等。窗口测试改为允许 1px 原生取整，仍按实际视口严格检查两岛边界；随后 `npx playwright test tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-analysis/desktop-layout-final` 通过。合计两项桌面用例均已通过，覆盖持久化／重启、最小窗口及 125% renderer 缩放。

`npm run typecheck`、范围内 7 个 renderer 文件 ESLint、`npm run i18n:types`、`npm run i18n:check` 与最终 `npm run build:app` 通过；保留既有 Vite 分块提示。`npm run check:notes` 为 297 篇、0 错误、17 条既有跨仓链接诊断。Git diff 空白检查通过。

深色与 planche 正文截图已查看：`artifacts/memo-analysis/editor-v4-{dark,planche}.png`。本轮修正了行菜单遮住星菜单；旧测试改为先打开菜单，取消删星后重新打开星菜单。自然布局中离开视口的星通过键盘／相机浏览。缓存坐标经 CSS 小数序列化存在亚像素误差，使用 0.01px 精度比较。

测试仅使用隔离数据，系统 DPI、多显示器、真实输入法与真实模型质量的验证边界保持不变。

### 浅色纸面配色

用户认为亮白背景不协调，随后明确否定与主体色差过大的独立暖灰方案。最终 memoIsland.css 沿用主体 shell-pane，文件栏／星座混入少量 shell-pane-chrome，正文仅轻微提亮；文字和边线也使用共享主题变量。

`npx playwright test tests/e2e/memo-editor.spec.ts --project=island --workers=1 -g "document rows and composer fit both themes"`：最终配色 1 项通过。成品截图已查看：`artifacts/memo-analysis/background-unified-planche.png`。`background-paper-planche.png` 为已放弃的暖灰尝试；`background-before-planche.png` 为调整前截图。本次只改 CSS，未重跑上一节完整工程与桌面回归。

### Chat 当前选中星与编辑链路

2026-10-14 Main 先复核明确命名节点的真实 Chat 增／改／删链路，再按用户授权补齐“当前这颗星”上下文。前次只传文件与消息 ID 的 P2 缺口已修复；本次为 Main 自检，不替代独立评审。桌面脚本从临时 artifacts 验证提升为 tests/e2e/memo-chat-desktop.spec.ts，纳入 desktop 项目。

- 单元：`npx vitest run tests/unit/memo-chat.test.ts tests/unit/memo.test.ts tests/unit/llm/janus-agent-ports.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/janus/island-chat-window.test.ts --maxWorkers=2`，5 文件、71 项通过。覆盖选中快照、无选择、旧客户端、失效 ID、删星后不改投、明确节点仍可编辑、同一缓存会话更新选择、追加消息隔离、冲突、取消及来源。
- 浏览器：`npx playwright test tests/e2e/memo-chat-selection.spec.ts tests/e2e/memo-navigation.spec.ts --project=island --workers=1` 首轮 8 项通过。补上追加消息拒绝回退测试后，`npx playwright test tests/e2e/memo-chat-selection.spec.ts tests/e2e/memo.spec.ts tests/e2e/memo-workspaces.spec.ts --project=island --workers=1 -g 'snapshots|per-file selections|late steering|visible fallback|switching memos|manual draft|resources change|persistence failure|closing the memo'`，9 项通过；合计覆盖 14 个不同用例。验证切星、切文件、隐藏保留、空文件、删星、新旧请求隔离，以及原有手工草稿和工作区解耦。
- 桌面：最新 `npm run build:app` 后，`npx playwright test tests/e2e/memo-chat-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-review/selection-desktop`，1 项通过。隔离用户目录中的真实 Electron 从 Chat 输入框发送“当前星”请求；localhost 脚本化 HTTP 模型从实际收到的上下文取得节点 ID，经 memo_read／memo_edit 新增、修改、删除，再切到另一星新增。验证真实文件、修订 1→5、来源及左侧自动刷新；当时退出备忘录后不再提供 memo_edit（现已由下述未绑定创建流程替代）。测试未使用真实用户数据或外部模型凭据。
- `npm run typecheck`、9 个受影响生产文件 ESLint、最终构建通过；保留已有 Vite 分块提示。第一次类型检查发现共享类型引用及 renderer 服务参数未同步，补齐后通过。单独执行 chat-turn-guard 两次遇到本地链接依赖解析错误，文件实际存在；使用上述包含共享工具的五文件组合执行 71 项通过，未更改相邻仓库或依赖链接。

普通发送的选择由主进程核对；追加消息的快照由工具读取核对，不提前承诺目标仍存在。模型遵循指代、先读后写及目标不明询问的质量仍需外部真实模型验收，脚本化模型仅证明工程链路。历史队列溢出或重启后的未消费消息沿用原有历史恢复行为，本次没有新增持久化的逐消息选择历史。

### 入口收敛与 Vertex 工具声明

2026-10-14 用户报告“备忘录”入口单独占一排，以及工程排期请求被 Vertex 拒绝，报 memo_edit.operations.afterId 缺少 type。使用当前 AI SDK 3、llm-core 兼容层和 Google Vertex SDK 的实际序列化路径，在拦截 fetch 的隔离测试中复现 12 处无类型字段；复用的 Zod schema 被编码为 $ref，Google 转换忽略引用而只留下 nullable 等元数据。错误发生于工具声明提交阶段，与 092／093 节点文本无关。已改为单一操作对象的无共享引用声明，保留执行前严格分支校验；入口已合并至输入区工具栏，移除空会话栏及没有可用工作区时的空资源栏。

- 单元：`npx vitest run tests/unit/memo-provider-schema.test.ts tests/unit/memo-chat.test.ts tests/unit/memo.test.ts --maxWorkers=2`，3 文件、23 项通过。新测试通过真实 runChatTurn → AI SDK → Vertex 请求序列化，以模拟响应完成读取、创建 092／093、读取新 ID、写入 5／3 条记录，再核对文件修订、顺序、来源与每份 memo 工具声明的类型。首节点使用 afterId:null，第二节点省略锚点。额外验证模型侧可解析但缺少操作必填项／包含无关字段的请求在实际写入前被拒绝。
- 浏览器：`npx playwright test tests/e2e/memo-trigger.spec.ts tests/e2e/memo-island.spec.ts tests/e2e/memo-workspaces.spec.ts tests/e2e/chat-conversation-delete.spec.ts --project=island --workers=1` 中原有 14 项通过。新入口测试补齐 1000px 窗口的文件抽屉步骤与准确按钮名，并将几何读取改为同一帧后，`npx playwright test tests/e2e/memo-trigger.spec.ts --project=island --workers=1 --output=artifacts/memo-analysis/trigger-verified` 2 项通过；合计 16 个用例，覆盖双主题、同行图标、无独立入口行、绑定保留、自动布局、焦点与资源操作、会话删除。截图 `artifacts/memo-analysis/trigger-inline-{dark,planche}.png`，浅色成品已查看。
- 桌面：最终 `npm run build:app` 后，`npx playwright test tests/e2e/memo-chat-desktop.spec.ts tests/e2e/memo-layout-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-analysis/trigger-desktop`，2 项通过。真实 Electron 验证 Chat 新增／修改／删除／切星写入及回显，原生最小窗口和 renderer 缩放下入口与面板保持可用。

最终 typecheck、构建及受影响文件 ESLint 通过；ESLint 保留 JanusChat 中 4 条既有中文字符串警告。测试未连接 Google 云端；Vertex 请求序列化和模拟响应循环已验证，真实云端模型对用户分组与工具使用的质量仍待 dev 复试。本次未更改 Provider 全局 schema 转换或放宽持久化校验。

### 备忘录与项目 Note 的目标隔离

2026-10-14 同一工程排期请求误改 Note。确认原实现只在 memoBinding 存在时提供编辑工具，没有 Chat 创建入口；项目提示把一般修改指令引向 Note，Note 授权仅判断变更意图。补齐未绑定创建、两种目标的提示和 Note 写入排除。进一步桌面回归发现会话 normalizeConversation 未保留 memoId，修复后保存与加载保留绑定。先前 Vertex 测试预建并绑定文件，没有覆盖这些入口，不能证明自然模型选择正确。

- 单元：`npx vitest run tests/unit/memo-chat.test.ts tests/unit/memo-provider-schema.test.ts tests/unit/note-chat.test.ts tests/unit/project-chat-context.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/llm/janus-agent-ports.test.ts --maxWorkers=2`，6 文件 98 项通过。验证已绑定／未绑定两条真实 Vertex 序列化链路，创建 092／093 与 5／3 条记录，取消／重复创建及消息来源；强制错误 note.write 调用失败，实际 Note 字节和变更记录不变；显式 Note 请求的原有写入测试仍通过。首次组合测试遇到本地链接依赖解析失败；重跑通过，未改动外部依赖。
- 持久化：`npx vitest run tests/unit/janus-chat-store.test.ts tests/unit/janus-chat-conversations.test.ts tests/unit/memo.test.ts --maxWorkers=2`，29 项通过，包含重新实例化存储后的 memoId 保留与无效身份丢弃。
- 浏览器：`npx playwright test tests/e2e/memo-chat-selection.spec.ts --project=island --workers=1 --output=artifacts/memo-analysis/routing-selection`，4 项通过，保持选择快照、切文件、删除目标和追加回退语义。

- 桌面：`npx playwright test tests/e2e/memo-chat-desktop.spec.ts --project=desktop --workers=1 --output=artifacts/memo-analysis/routing-final`，1 项通过。在原有增／改／删／切星流程后，退出绑定并从 Chat 输入用户原句，实际 HTTP 工具响应创建“工程排期”、两个节点与 5／3 条记录；打开左侧确认回显，读取会话持久化后重载窗口，无需重选即显示 092 和五条记录。前两次扩展测试分别纠正了关闭面板后的打开步骤、发现并修复 memoId 持久化遗漏。
- Typecheck、两次受影响文件 ESLint、构建、diff 空白检查通过；Note 校验 297 篇、0 错误，保留 17 项既有显式外链诊断。

测试采用隔离数据和脚本化模型；没有读取、撤销或改写用户测试误改的真实 Note。外部真实模型对指令的路由质量仍待 dev 复测。

### 正文滚动与节点下拉细节

2026-10-14 将正文、文件列表及节点下拉统一为中性滚动条；原生拖动槽 10px，默认可见滑块 4px，悬停增宽，正文使用稳定槽位。节点下拉复用共享 Select，body 浮层使用不透明主题底色、选中勾线及键盘焦点；共享组件补齐方向键、Home／End、Enter、Tab，备忘录显式使用 combobox 角色，保留其它调用方原默认角色。

- `npx playwright test tests/e2e/memo-editor.spec.ts --project=island --workers=1 --output=artifacts/memo-analysis/controls-tests` 的原有 5 项编辑回归通过。新增双主题用例初次发现伪元素勾号进入选项可访问名称，改为纯边框装饰；随后实际拖动检查揭示 headless 默认隐藏原生滚动条，测试显式移除该启动参数。
- `npx playwright test tests/e2e/memo-editor.spec.ts --project=island --workers=1 --grep "record scrolling" --output=artifacts/memo-analysis/controls-final`，2 项通过。实际滚轮与拖动滑块、正文宽度稳定、选中标记、Esc 保留岛、键盘与鼠标跨节点移动均验证。共 7 个用例；双主题成品截图 `artifacts/memo-analysis/controls-{dark,planche}.png` 已查看。
- 类型检查、受影响 TSX 的 ESLint 与构建通过。样式仅位于 memoIsland.css，保留原 memo.css 字节；本轮没有改变备忘录数据格式和会话绑定。

### 主岛与备忘录外框统一

展开主岛与备忘录共用主题定义中的 `island-panel-background/border/radius/shadow`：planche 为纸底、墨线、26px 圆角与 3px 硬偏移影，dark 为同一暗底、弱边框与层次阴影，主岛运行态保留状态反馈。备忘录不再维护独立的柔和投影，旧 memo.css 仅保留壳的结构规则；内容画布取消重复描边并使用 12px 内圆角，保留文件栏、记录与星座的必要分隔，关闭按钮改为无框交互。新增主题通过四个令牌同时适配两岛。

`tests/e2e/memo-frame.spec.ts` 的双主题验证检查两个实际组件的背景、描边、圆角及阴影一致，覆盖文件栏收起不改变外框与 1000×600 紧凑边界，截图在 `artifacts/memo-frame/final`。原有 memo-island 六项中五项通过；正文宽度断言要求大于 175px，当前为 168px，恢复修改前 memo 样式后仍以 166px 失败，属于既有约束缺口，本轮没有调整该断言或改变布局分配。

最终组合 `npx playwright test tests/e2e/memo-frame.spec.ts tests/e2e/memo-editor.spec.ts --project=island --workers=1 --output=artifacts/memo-frame/final` 9 项通过，包含记录编辑、滚动、下拉与双主题外框验证；`theme-registry/planche-theme/theme-audit` 三文件 26 项单元测试、类型、构建、theme:check 与 Note 校验通过。此次未另跑 Electron 或完整 verify。

## 后置建设

原生生态读取、执行提醒、项目代码核对和生态归档／移除继续后置。现有人工删除已实现；生态能力需要定义触发条件、订阅、来源、提醒去重、恢复和一次性项目上下文。只读取记录不代表执行记录中的动作，核对结果也不自动决定删除。两星之间插入已实现；拖拽排序、点批量归入、更深入的个人记忆联动和长期来源历史仍按[个人画像与记忆工作台](personal-memory-workspace.md)评估。

真实模型的目标节点选择、去重、多轮整理、误记模型建议以及延迟／成本仍待真实凭据试跑。本轮交互工程验证已完成，不以替身结果承诺模型质量。
