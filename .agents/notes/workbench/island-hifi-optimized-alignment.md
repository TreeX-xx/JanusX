---
{
  "schema": "harness-note/2",
  "id": "e22d4cdb-c2aa-5a6c-ae54-945ea26e91ce",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-13",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-13-agent-note-hifi-optimized--e22d4cdb.md",
      "sourceHash": "c07a5cb2cc96671c30033bc90907ecec4d20626916844402f8eec7e933273f18",
      "originalBodyHash": "a3131824606ff8a82e1529230aab75392ede3d7e32973b7a581036f1b1152533",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents 灵动岛运行态/一级展开/通知面高保真对齐（hifi Optimized）. No age-based archival.",
      "edits": [
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-13-island-hifi-optimized-alignment.md",
        "sourceHash": "c07a5cb2cc96671c30033bc90907ecec4d20626916844402f8eec7e933273f18",
        "originalBodyHash": "a3131824606ff8a82e1529230aab75392ede3d7e32973b7a581036f1b1152533"
      }
    }
  },
  "updated": "2026-10-22T11:50:27.038Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# 灵动岛运行态、通知胶囊与高保真对齐

## Problem
`design/Janus-Island-交互与通知形态高保真总览-Optimized.html` 定稿了三处 UI 升级，与现行实现存在断层：运行态折叠胶囊只有 radial 绿雾与白眼 EQ，缺少翡翠绿 Conic 流光环与眼睛本身的绿光；一级展开胶囊直接继承岛体不透明皮肤，没有设计稿的 20px 级毛玻璃质感，LED 无光晕、success 仍用橙色（设计稿定稿为翡翠绿）；托盘通知行没有 severity 左缘细线与任务型微进度条，钉条 banner 还是中性药丸形而非暗金玻璃条。

### 灵动岛一级展开重设计为通用通知胶囊
灵动岛一级展开（单击折叠胶囊后的 peek 态，300×74 胶囊界面）与全局 UI 风格割裂，且内容分发不可扩展：

1. **风格割裂**：peek 用 `janus-peek-sigil + halo + 双眼` 的人格化神眼语言与近黑不透明底，不消费 `--shell-*` 令牌，也没有全局浮层统一的玻璃磨砂质感（`docs/ui-style-guide.md` §6/§8.7），排版不符 §3 的 kicker 层级规范。
2. **动效平淡**：形变用 `cubic-bezier(0.16,1,0.3,1)` 纯 ease-out，无 iPhone 灵动岛式的弹性加载观感。
3. **内容硬编码**：`JanusIsland.tsx` 中 `peekTitle/peekSubtitle/statusText` 三条 if-else 链（maintenance → product → knowledge）串行判断，每新增一种通知都要改 Island 主组件。
4. **空态死路**：知识召回无命中时单击只显示"Knowledge / 无知识匹配 / KNOWLEDGE // NO MATCH"，无行动出口。
5. **二级展开通知缺口**：`double-activate` 时 `hideKnowledgePeek` 直接丢弃通知；`stage === 'expanded'` 期间新通知被 `receiveKnowledgeTrace` 静默吞掉，无任何展示面。

同时需适配"产物工作区"（Note: `implemented/feature/2026-09-13-product-workspace.md`）与知识库两条已上台链路；一级展开后续将承载更多通知来源，必须先建立通用模型。

**术语约定**：**一级展开** = 单击折叠胶囊后的 `peek` 态（`janus-peek-shell`），保留胶囊形态；**二级展开** = 双击后的 `expanded` 态（`JanusIslandExpandedShell`，monitor/chat/roundtable 三视图）。


## Decision
按设计稿三个 scenario 对齐，零结构改动、纯表达层：

**S1 运行态**：Island 的历史 running 皮肤仍由 `01-janus-foundation.css` 定义，当前项目进程状态由独立运行指示器表达。运行入口与指示器现行设计见[顶栏运行入口与紧凑运行指示器](run-orb-budding.md)：常态为紧凑刻度组，无常驻项目名称、旋转轨道或子芽；Island 长按蓄力、Snap 回弹与涟漪已移除。

**S2 一级展开**（`08-janus-peek-capsule.css`）：胶囊本体脱离岛体皮肤继承，改为毛玻璃——`rgba(22,22,27,.82)` 半透底 + `backdrop-filter: blur(20px)` + 24px 圆角 + 深投影，白字在繁杂工作区上方可读；double 档 74→76px；内容入场换非对称形变（scaleX(.85) scaleY(.8)）；排版升档（kicker 9.5/1.5、title 13.5 w700、subtitle 10.5、meta 9/.5，meta 隐藏断点 900→700）。LED 重做：7px + `::after` 光晕（inset -4px blur 3px inherit），success 定稿翡翠绿 `#00ff88`、attention 亮橙 `#ff9159` 带缩放呼吸（1.15 双相位）、info 亮灰 `#a1a1a6`。

**S3 通知面**：托盘 350px/最高 360/radius 16/blur 24/`capsule-tray-in` 位移+缩放入场；通知行加 `data-severity` 左缘 3px 细线（failed 红/attention 橙/success 绿，默认灰 .3 hover 提亮）+ 中性悬停（白 .03 底+阴影，弃橙色 tint）；行排版升档（title 12.5 w700 #f8f9fa 等）。徽标 24px 高、pop 单次 1.22 带光晕。钉条 banner 由药丸改 12px 玻璃条：橙 tint 边框/渐变底/blur 16/`translateY(-8px) scaleY(.9)` 入场。任务型微进度条：`IslandNotification` 新增可选 `progress` 字段，`maintenanceNotification` 两个分支均携带 `task.progress`，托盘行 subtitle 下方渲染 2px 橙渐变进度条（`capsule-progress-pulse` 脉动），其余通知源不带该字段零影响。行动按钮 hover 增加上浮 1px。

reduced-motion：新增光环/进度条/托盘入场动画全部纳入 0.01ms 降级。

**修订（同日，用户驱动）**：二级通知面去橙收敛——① 徽标（提醒交互控件）弃橙描边/橙底/橙字，改灰系（边 `rgba(255,255,255,.12)`、底 `.04`、字 `#9fa0a6`，hover/active 同步灰化，pop 光晕改中性白）；② 徽标、托盘行、钉条内的 LED 光球一律去光晕（`::after` display:none），光晕保留给一级胶囊 LED 独享；③ 托盘行左缘 severity 灯条 3px → 2px。托盘行动按钮与清除按钮维持 hifi 既有配色未动。

### 灵动岛一级展开重设计为通用通知胶囊
**A. 通用通知模型**：`src/renderer/src/components/janus/islandNotifications.ts` 是纯内容模型层（可单测）。`IslandNotification { id, kind, severity, copy, actions, createdAt }`，kind 封闭集（knowledge/product/maintenance/agent），action 为纯 id 描述符（open-knowledge/open-product/open-blueprint/open-maintenance），执行绑定在渲染层。`assembleNotifications` 按 severity rank（failed > attention > success > info）降序、同秩按 createdAt 降序、同秩同刻保持插入序稳定排序，并按内容寻址 id 去重。三个投影函数（`knowledgeNotification/productNotification/maintenanceNotification`）从既有 props 派生通知，`capsuleTier` 决定胶囊档位，`mayAutoBanner` 决定二级到达行为。id 内容寻址（`knowledge:{requestId}` / `product:{relPath}`）保证新内容天然重新上台。

**B. 一级展开视觉与动效（iPhone 灵动岛式，黑橙灰调）**：保留胶囊形态与三态宿主 morph 骨架，内部重构为 `.janus-capsule-*` 结构——背景不覆盖，直接继承 `.janus-island` 的近黑皮肤渐变（`#161619 → #08080a`，与二级展开同底），调色以黑橙灰为主：kicker 橙（`#ff9159`）、title 近白（`#f4f4f5`）、subtitle/meta 灰（`#a1a1a1`/`#737373`）、LED 语义色映射到同谱系（info=灰、success=橙 `#ff7830`、attention=橙呼吸、failed=红呼吸）、宽度 `min(380px, calc(100vw - 48px))` 自适应、圆角保持 28px。CSS 落新文件 `styles/08-janus-peek-capsule.css`（编号缺 08 正好补位），并删除 01/02/07 中随旧 sigil/copy/statusline DOM 退役的死规则。动效：宽高同时形变 0.38s 换用 §7.1 弹性回弹曲线（overshoot），内容层延迟 70ms 后 `scale(0.85) → 1` + 淡入 0.24s 同曲线（内容从胶囊里长出来），内容按通知 id 作 React key 使变更重放入场动画，收起反向由既有 stage 过渡承接；`prefers-reduced-motion` 降级为 0.01ms。

**C. 一级展开两档形态**（`data-capsule-tier` 驱动同一胶囊的身高）：single ~48px（LED + kicker + title + mono meta）、double ~74px（加 subtitle 或空态副行）。一级展开**不承载任何跳转 action**——单击语义维持收起，无按钮、无 hover 显现行动区（评审后简化决策：唤出工作台的入口在二级托盘/banner，一级保持纯通知展示）。空态舱（无任何通知时单击）：kicker `JANUS` + "一切就绪" + 灰色副行提示，double 档。

**D. 二级展开通知面**（徽标 + 托盘 + 钉条三层，与一级同调的黑橙灰：近黑底 `rgba(8,8,10,.92–.96)`、橙 kicker/徽标/行动按钮（与 `.janus-expanded-action-button` 同源）、灰副文；均在 `JanusIslandExpandedShell.tsx`）：

- **托盘**：topbar 右侧通知徽标（LED + 计数，count=0 不渲染），点击展开 340px 玻璃托盘；行 = LED + kicker + 相对时间（复用 `formatRunAge`）+ title + mono subtitle + action 药丸；新行 `message-in` 入场；"全部清除"将当前 id 批量记入 `clearedIds`。
- **钉条 banner**：peek→expanded 携带的通知（T1）与 attention/failed 新到达（T2）钉在 topbar 与 body 之间成 banner 细条，action 执行或 ✕ 关闭才撤；替代旧 `hideKnowledgePeek` 的丢通知行为。
- **到达规则**：`info/success` 仅徽标脉冲（0.9s pop 动画 ×2）；`attention/failed` 额外自动亮 banner；永不自动打开托盘；ESC 优先关托盘再收岛。
- **收起双向连续性**：expanded 收起后未消费通知仍由活跃 props 派生，下次单击 peek 重现（TTL 由 Titlebar 既有 timeout 机制接管）。
- **桌面 Toast 分工**：岛在场（peek/expanded）→ 岛内各形态；岛不在场 → 桌面 Toast 兜底（既有 Toast 链路未动，分工语义由岛内呈现的排他性保证）。

**E. 交互规则**：peek 态胶囊单击维持收起（`single-activate`），胶囊内无任何可点元素；产物/知识等跳转入口只存在于二级托盘与 banner 的 action 按钮，执行后按 kind 分流（产物走 Titlebar `openProductFile` 自带消费+收拢，其余 `setActiveWorkbench` + `onDismiss` 让位）；TTL 维持 4.2s（Titlebar 既有 timeout 接管）。产物到达可打断知识 peek：`product-notice` 自 `collapsed` 与 `peek` 两态均可上台（`shouldPresentProductNotice` 同步含 peek），胶囊内容切到产物、知识隐藏、TTL 重新计时；`expanded` 态维持仅徽标脉冲不变。

**E+. 产物通知粘滞化（同日修订，用户驱动）**：产物通知从「TTL 即焚」改为「点击消费」——4.2s TTL 只收起胶囊（控制器动作由 `product-consume` 更名 `product-expire`，语义仅为 peek→collapsed），`productNotice` 在 store 中保持 alive 直到被点击打开（`openProductFile` 内 `consumeProductNotice`）、被更新产物覆盖、或工作区清理。配套三件事：① 单击意图收敛为纯函数 `getSingleActivationIntent`（`islandInteraction.ts`）：产物 alive 且知识面未在场时，collapsed 与 peek 两态单击岛都直接在右侧打开产物工作区（collapsed 单击不再只是 replay 知识），expanded 不劫持；知识面（召回结果/空态舱）在场时单击维持收起语义——胶囊顶层同步让位（JanusIsland 拆分 `capsuleNotifications`，知识面在场时产物通知退出胶囊排序但保留在托盘/banner），保证「显示什么点开什么」。② Titlebar 以 `presentedProductNoticeIdRef` 按 id（relPath 内容寻址）去重上台，避免粘滞通知在每次岛收起后被 effect 重新顶起造成 peek 永动；通知被消费（id 变 null）时重置，允许后续新产物重新上台。③ collapsed 态 aria-label 同步：胶囊顶层为产物时播报 `openProductPreview`，与单击直达一致。双击进 expanded 与 ESC 仍消费通知（进监控即有产物分区入口，通知使命完成）。

状态机（`islandController.ts`）与 Titlebar 派发协议未动——通知模型是 Island 渲染层的投影，控制器状态机保持原测覆盖。



## Alternatives considered
- 运行态光环同时挂 peek/expanded——否决：expanded 面板是主控台容器，旋转环喧宾夺主，设计稿的 ring 只演示在折叠胶囊上。
- LED success 维持橙（旧 Note 的黑橙灰调色决策）——否决：本次以设计稿定稿为准，success 归入"完成=翡翠绿"语义（与 running 同谱系），attention/failed 保留橙/红语义通道。
- 微进度条做成通用 `progress` 通知协议——本次只给 maintenance 投影携带，其他通知源没有进度语义；等第二个任务型通知源出现再抽象。

### 灵动岛一级展开重设计为通用通知胶囊
- **保留现有 peek 结构，仅换 CSS 皮肤**——最强理由是改动最小。否决驱动是三条硬编码 if-else 链不解决，每加一种通知仍要改 `JanusIsland.tsx`；视觉重做和模型抽象是同一刀。
- **复用桌面 Toast 栈做岛内通知（同一 store 双渲染）**——最强理由是零新增模型。否决驱动是 Toast 生命周期（右上角栈、自动消失、无 action 模型）与胶囊语义（栈顶单条、TTL 可常驻、可点击直达工作台）不匹配。
- **通知面板嵌入 monitor 右列（与产物/运行时面板并列）**——最强理由是复用面板栅格。否决驱动是仅 monitor 视图可见，chat/roundtable 下通知不可达；topbar 层托盘对三视图通用。
- **神眼微缩保留在 peek + LED 共存**——最强理由是保签名。否决驱动是神眼发光色承载 mode 语义、LED 承载 severity 语义，合并会打断 mode 色读取通道；微缩神眼在 48–96px 高度内辨识度不足。
- **Do nothing**——风格割裂永久存在，产物/知识之外每个新通知源都放大 `JanusIsland.tsx` 的耦合，空态死路损害单击手势的可发现性。


## Consequences
改动集中在两个 CSS 文件 + `islandNotifications.ts`（可选字段）+ `JanusIslandExpandedShell.tsx`（data-severity/进度条渲染），无状态机与交互回归面。获得：运行态"量子流光"识别度、peek 毛玻璃质感、托盘卡片级 severity 可扫读性与任务进度无感呈现。代价：peek 背景改为半透毛玻璃后，旧 Note「背景继承岛体皮肤」的决策作废（以设计稿为准）；01-janus-foundation.css 的历史中文注释本身是乱码字节，本次新增注释一律用英文避免再踩编码坑。

### 灵动岛一级展开重设计为通用通知胶囊
新增 `islandNotifications.ts` 模型层 + `08-janus-peek-capsule.css` + `tests/unit/janus/island-notifications.test.ts`（10 测试）；`JanusIsland.tsx` 退役三条文案链改为订阅投影栈顶并新增托盘/banner/pulse 状态；`JanusIslandExpandedShell.tsx` 新增徽标/托盘/banner 三块渲染与对应 props；01/02/07 的旧 peek 样式随之删除；i18n 双语新增 `janus:island.capsule.*` 键组并重生成 `types.ts`。获得：新增通知源只需在 `islandNotifications.ts` 加一个投影函数并入列 `assembleNotifications`，Island 组件零改动；一级/二级共用同一套令牌，读作同一系统的两级。LED 后续扁平化：移除光晕伪元素与 box-shadow 发光，语义色与呼吸动效（缩放+透明度）保留，小尺寸下可读性优先于辉光质感。

代价与边界：一级展开移除全部跳转 action 后，`IslandNotification.actions` 仅由二级托盘/banner 消费，模型字段保留以保证两层共用同一数据形状；若未来一级需要恢复轻量直达，恢复 hover 显现按钮即可（行动钮基类样式已在托盘侧验证）。知识"无相关召回"特化空态暂以通用空态舱替代——`receiveKnowledgeTrace` 本就只上台 eligible 命中，零命中 trace 不留存，特化空态需先让空 trace 上台（重访信号：产品需要区分"没查"与"查了没有"时）。通知列表由活跃 props 派生而非累积 store，跨会话历史不存在（托盘"全部清除"只作用于当次会话 id）；`clearedIds` 只在组件生命周期内持久，岛卸载后清空。桌面 Toast 链路本次未加 `isIslandPresenting` 守卫——当前桌面 Toast 与岛通知的事件源无重叠（Toast 走 agent 完成事件，岛走知识/产物/维护），双发风险未兑现；两链路事件源出现交集时须先落守卫（明确的重访信号）。E+ 修订的代价：粘滞通知存活期间，expanded 顶栏 statusText 持续显示 `PRODUCT // OPEN PREVIEW`（提示可点击直达，可接受）；同文件重复落盘不重复提醒（id 内容寻址），产物重开需经监控分区或新产物上台。`main/office` 命名与 `product:` 通道拆分沿用产物工作区 Note 的既定重访信号，本次未触碰。
