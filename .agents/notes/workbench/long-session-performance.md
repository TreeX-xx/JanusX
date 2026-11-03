---
{
  "schema": "harness-note/2",
  "id": "08cd6022-8126-450f-808d-b2c99e90bb37",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-15",
  "updated": "2026-11-02T08:01:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/80f207b2-591b-5a1d-824e-e169dc5b80c0" }
  ]
}
---

# 长时间使用后的交互卡顿与便携版进程负载

## 长对话显示与滚动（2026-11-02）

用户反馈同一应用中长对话输入、上下滚动迟钝，切到短对话立即恢复。共享显示层此前一直挂载历史正文和折叠的工具/diff；输入隔离只避免草稿更新重算历史，不能降低这些常驻节点的布局成本。本次参考 [ZCode ConversationTimeline](https://github.com/zai-org/ZCode/blob/a60ba6a7e5a06742270ca605f5d2cc2766afa7e1/packages/ui/src/v4/ConversationTimeline.tsx) 的历史窗口、正常流最新内容和阅读锚点方向，在 JanusX 公共层实现，未复制其业务控制器。

`VirtualHistory` 供 `AgentSessionPane` 与 `JanusChat` 共用，后者覆盖 Chat、项目讨论与 Launch。超过 20 个显示单元后，只挂载可视历史及前后各 2 项缓冲，最新单元保持正常文档流；终端以轮次为单元，Chat 以消息/业务卡为单元，正在生成的 Chat 内容继续由原实时区域展示。测量实际高度，旧消息前插按稳定 key 保持位置；只补偿视口上方的估算误差和高度变化，当前阅读行内部增长不拉动位置。窗口宽度变化重测可见节点，不清空所有历史高度估算。正在编辑的消息额外保留挂载，底部跟随继续服从原有阅读状态。

`WorkDisclosure`、工具明细、文件列表和逐行 diff 在展开时才构建子树；按显示单元保存展开选择，滚出再滚回恢复。会话切换或记录删除时释放相应状态。`createConversationTurns` 在终端 IPC 边界比较快照值并复用未变轮次的分组和文件统计，避免流式每次重新解析旧补丁；这仍需扫描快照内容，不是增量传输。JanusChat 的历史合并排序改为随消息/卡片变化计算。

自动验证使用真实组件与模拟 IPC：`conversation-virtual-history.spec.ts` 覆盖 100 轮/400 条终端记录和 205 条 Chat 消息，检查终端挂载轮次少于 15、Chat 历史单元少于 20、关闭 diff 无逐行节点、离屏后恢复展开、上滑时新增输出、窗口变窄、加载更早页面和底部跟随。`conversation-typing-isolation.spec.ts` 检查同一 400 条记录下逐字输入的历史正文读取增量为 0，保留草稿重建与发送。`conversation-turns.test.ts` 检查克隆快照复用、补丁更改失效、重写删除和会话隔离；原有时间线、文件变更与上下文回归继续覆盖业务内容。浏览器命令使用 `JANUS_E2E_PORT=41866`，避免占用已有开发服务。

验证结果：27 项单测、65 项不重复浏览器用例通过；新增历史编辑测试确认滚出视口时草稿和焦点保留，返回后可取消。Vitest 文件为 `conversation-turns`、`conversation-output`、`conversation-file-changes`、`chat-timeline`、`janus-reasoning`、`tool-call-group`，命令 `npx vitest run tests/unit/<name>.test.ts`。Playwright 文件为 `conversation-virtual-history`、`conversation-typing-isolation`、`conversation-file-changes`、`chat-work-timeline`、`janus-context`、`codex-conversation`、`conversation-context`，分批执行 `npx playwright test tests/e2e/<name>.spec.ts --project=island --workers=2 --timeout=60000`。类型检查通过；定向 ESLint 为 0 errors，保留 JanusChat 既有 4 条中文文案警告；Note 检查为 321 篇、0 errors、17 条既有外部链接诊断。窄窗与长 Chat 截图分别位于 `artifacts/conversation-virtual-history.png`、`artifacts/chat-virtual-history.png`。未重打安装包或测试用户实际运行实例。

边界：完整已接收数据仍在内存中，原生历史分页和全量 IPC 传输未改。单个超大且展开的最新轮次仍有渲染成本；原生浏览器查找及跨离屏记录的长距离文本选择不能覆盖未挂载 DOM。测试证明显示树有界和交互语义，尚未测用户实际 Electron 会话的长时帧率、输入延迟分位数或内存曲线，不能据此承诺所有软件卡顿已消除。

## Intent

记录 2026-10-16 对运行中 0.9.2 便携版的只读采样，以及用户反馈的左侧悬浮、输入框与输入法候选栏、右侧点击一起变慢。版本差异与现场证据支持下述优化，已在工作区实施并通过定向验证；新版便携包的长时交互仍未验收。

便携程序位于 JanusX 仓库的 `release/0.9.2-fixed`，从临时目录解压运行，userData 位于 `release/0.9.2-fixed/data`。注册工作区包括 JanusX 仓库。通过 `@electron/asar` 核对实际安装包实现，没有将未打包的工作区改动当成运行事实，也未关闭应用或修改运行配置。

2026-10-16 继续复核后，最值得优先验证的回归链是：0.9.2 新增的用量数据库访问与后台历史扫描产生负载和 profile 文件事件，经两版共有的工作区监听、目录展开和 Git 查询放大。原文列出的机制大体存在，但“问题存在”“本版新增”“已解释用户卡顿”是三种不同结论。用户反馈 0.9.1 未出现同类卡顿；尚未在相同数据和操作下运行两版长时 A/B，不能据此把所有旧机制排除，也不能把它们列为新增缺陷。

## 当前架构复核：启动内存与全局交互延迟

2026-10-19 用户确认安装版和开发版均有启动内存大、终端输入/画面偶发卡顿，并补充工具箱点击后迟迟才显示展开栏。本轮只读检查源码、安装包及运行进程，未修改产品代码、关闭进程或重启真实工作区。下文的当前复核与后面的 10 月 16 日历史实验分别计量，不能混作同一次现场。

### 当前运行证据

安装版入口是 `D:\janusX\JanusX.exe`，主进程 PID 52108；开发版主进程 PID 48624。读取实际 `D:\janusX\resources\app.asar`，版本为 0.9.2，主进程产物已经包含账本连接复用、`busy_timeout=100`、快照缓存和全语料扫描。因此旧版的重复连接初始化与 3 秒锁等待不是本轮可直接沿用的根因。

06:25:17 UTC 结束的一次约 5.009 秒采样如下。内存为 Windows Private Bytes，包含提交但未必驻留的内存，不等于 JS heap 或物理内存占用；CPU 以一个逻辑核心为 100%。采样没有控制用户操作，不称为空闲基准或冷启动结果。

| 实例/进程 | 私有内存 MiB | 单核 CPU |
| --- | ---: | ---: |
| 安装版 main | 598.2 | 13.4% |
| 安装版主 renderer | 378.8 | 83.3% |
| 安装版 GPU 进程 | 169.8 | 37.7% |
| 安装版其余两个 Electron 进程 | 23.8 | 0% |
| 开发版 main | 275.5 | 10.3% |
| 开发版两个 renderer | 455.2 | 0% |
| 开发版 GPU 进程 | 285.7 | 0% |
| 开发版其余两个 Electron 进程 | 27.2 | 0% |
| Vite 所在 node / esbuild | 350.0 / 57.2 | 0% / 0% |

安装版 Electron 自身私有提交约 1,170.6 MiB，开发版约 1,043.6 MiB；这两个数均不包含外部 CLI/MCP 与开发构建工具。开发版位于安装版的后代进程树内，直接对两棵树求和会重复统计。现场也存在 Codex、MCP 等子进程，不能把它们归入 JanusX JS 堆。开发版两个 renderer 的具体用途本轮未确认。GPU 进程 CPU 不代表硬件 GPU 利用率。

可复跑的采样脚本与原始数据位于被 Git 忽略的 `artifacts/performance-review-20261019/sample.ps1`、`processes.json`，安装包检查结果为同目录 `package.json`。命令为 `powershell -NoProfile -File artifacts/performance-review-20261019/sample.ps1`；脚本中的 Vite PID 是本次现场值，重启后需重新识别。约 5 秒采样只能证明当时 renderer 工作较重，不能证明泄漏或锁定某个函数。

### 启动与常驻机制

主进程在 `index.ts/importBootstrapModules` 一次加载 IPC、知识库、Agent、遥测、远程通知等模块；`ipc/register.ts` 又静态导入各域实现并启动知识队列恢复、维护到期检查和精炼循环。这些职责虽然有模块边界，却仍共用 Electron main 的事件循环。`Promise.all(import(...))` 不是把模块初始化送到独立 CPU 线程，`async` 也不让随后的 JSON 解析、哈希和同步 SQLite 自动离开主线程。以下预热与整 store 订阅描述是本轮优化前基线；当前变化见“检测与首批优化”节。

renderer 的 `App.tsx` 在 idle callback（timeout 2500 ms）中无条件预热 Monaco、shell 和终端创建路径。`monaco-runtime.ts` 引入完整 `editor.main`，所以动态分包避免首包载入，却没有避免启动稍后常驻。安装包中 App 分块约 3.19 MB，editor-find 分块约 7.74 MB，TS worker 约 13.26 MB（十进制磁盘字节）；这些数不是运行内存，也不能据此认定所有 worker 已启动。worker 构造仍由实际语言请求触发。

`useWorkspaceBootstrap.ts/scheduleIndexWarmup` 顺序预热所有非活动工作区的 Note 索引；renderer 的空闲时刻不能保证 main 空闲。活跃项目还会加载蓝图、文件树、Git 并恢复 shell。`TerminalContextCoordinator` 启动 20 秒后开始全历史扫描，此后每 5 分钟再扫，零终端也运行。功能预热和后台恢复叠加，使“首屏已出现”不等于“启动工作结束”。

### 卡顿的三条竞争路径

1. **主进程争用。** 输入路径是 renderer → preload IPC → main → PTY；输出再经 main 合批回 renderer。绑定终端每 10 秒轮询；缓存减少未变化文件的解析，但变化中的历史仍完整读取，单文件允许到 64 MiB。读取后同时存在 Buffer、字符串、行数组和解析对象，整文件 JSON 预校验、后续解析及哈希都可能制造长任务和分配峰值。语料扫描已在文件之间让出事件循环，但单个文件内部的 CPU 工作没有因此被切片。账本连接已复用，SQLite 操作仍是 main 上的 DatabaseSync。
2. **renderer 输出争用。** `CLITerminal` 每实例配置 5000 行 scrollback；隐藏实例继续订阅并解析输出。每实例 scheduler 有 16 Ki 字符分块、8 次/8 ms 单轮预算、4 Mi 字符排队上限；计量实际为 JS `string.length`，不是严格字节内存预算。main 已做 16 ms IPC 合批和 100 万字符重放限制，但这些都不是跨终端总预算，也不是 renderer 消费确认驱动的端到端背压。重放完成前的 `queuedLiveOutput` 另有数组，未使用该 scheduler 上限。四个热工作区不等于四个终端，全局工具还独立于此缓存。
3. **React 与布局争用。** `TerminalArea` 对 global-tools 使用整 store 订阅；工具焦点、折叠和比例变化会触发该大组件更新。项目树与工具树通过内联函数传给 `GlobalToolsLayout`，父级更新会改变函数引用，因此内部 `useMemo` 不能隔离这类更新。普通隐藏 Chat 仍保留子树，聊天 registry 的流式状态约 16 ms 合批并通过 context 发布，相关消费者会更新。粒子动画、布局测量和浏览器 native view 避让也在同一交互链中；独立贡献必须用 trace 判断，不能凭代码规模定罪。

工具入口需区分三种交互：`TitlebarToolGroup` 的下拉按钮直接 `setMenuOpen`，无异步加载等待，菜单 CSS 无展开延迟；展开会在 layout effect 中更新 browser-occlusion store。`GlobalToolsLayout` 的工具区展开直接更新 store，但有动画与布局变化（当前工作区为 240 ms）。选择“浏览器”首次打开则要等待 `createBrowserSurface` 成功后才 attach pane，存在真实异步等待。如果用户指的是第一种下拉菜单，优先定位 renderer 排队/长任务；不能把工具区动画当作它的解释。

### 检测与首批优化

已建立[可重复检测说明](../../../scripts/performance/README.md)：历史扫描实现先打包冻结基线，五个独立 Node 进程处理固定语料并比较完整观测摘要；真实 React 工具区通过 Playwright/Profiler 量化点击显示机会、长任务与布局更新；基线/候选独立 Electron 构建分别使用空白 profile 测 5/30 秒内存和 main 定时器滞后。真实配置、CLI 历史和运行中的应用不参与测试，不发送通知。产物位于 Git 忽略的 `artifacts/performance-current/`。

当前实施三项：

- Codex 全语料扫描的 event 模式使用 `projected-jsonl.ts` 按 256 KiB 读取并在批次之间让出事件循环，全部行仍校验，只保留 session_meta、turn_context 和 token_count。统计事件身份、模型分段、fork 继承和去重继续复用原 collector/ledger。旧 cumulative 模式及异常/非标准文件回退保留原完整源/哈希路径。未实现跨重启增量游标；Claude/Pi 与活动终端读取也未迁移。
- `TerminalArea` 对 global-tools 改为浅比较的字段订阅，外层分区宽度/折叠由 `GlobalToolsLayout` 消费，不再让宽度变化带动全部终端树重算。焦点、pane 树及命令仍订阅，保留工具区操作和项目切换语义。
- 取消 App 无条件 Monaco 预热，并将 `ProjectSettings` 的 JSON 编辑器改为进入高级页后加载。构建发现原静态导入把 Monaco 带入首屏公共分块，单删 idle 预热不能消除该依赖。保留文件悬浮/打开意图预热和首次编辑加载；代价是第一次进入编辑功能需要加载等待。蓝图、知识库、统计功能和后台队列继续保留。

功能先验与主代理自审覆盖：UTF-8/CRLF/长行边界、无换行完整尾行、半写尾行、坏行、超限文件、取消、统计去重、fork 继承、模型变化、累计模式源改写；工具区折叠、拖动、窄窗、项目切换、浏览器实例与 Markdown 归属；实际编辑器打开、查找、编辑和磁盘保存。自审额外补了“合法但没有任何记账记录”的回退测试，避免把正文文件误判为不可用。不是独立子代理审查。

冻结基线与候选对同一 57,620,148 字节合成文件的完整统计摘要相同。五进程中位数：总扫描约 94.0 → 71.4 ms，最大事件循环延迟约 44.7 → 15.8 ms，采样堆峰值约 49.6 → 7.3 MiB，进程高水位 RSS 约 206.7 → 59.1 MiB。该场景包含较大消息正文、200 个统计事件，账本是摘要替身，未计入真实 SQLite 提交；不应外推为所有引擎、所有文件分布的收益。

工具区相同 40 次比例更新的 React actualDuration 总和约 288.8 → 19.2 ms，提交数 102 → 83；菜单点击到两次 rAF 的 p95 约 34.7 → 34.3 ms，双方未观察到 Long Task。此空载 fixture 没有复现用户现场迟钝，不能称“菜单延迟已经消除”；下降的是无关 React 工作量。

隔离空白 profile、生产构建各三次成功采样，启动后 30 秒 renderer Private Bytes 中位数 232.1 → 167.7 MiB（约 -27.8%），`app.getAppMetrics()` 所列进程私有提交总和中位数 540.5 → 476.9 MiB（约 -11.8%）。renderer JS heap 中位数 54.2 → 29.8 MiB；该 API 可能量化，作为辅助指标。候选 renderer 三次分别 167.7、127.2、169.7 MiB，报告中位数而非选最低值。首个 root 内容中位数 6.52 → 6.10 秒，但首屏可能是加载层，且首次基线与构建有重叠，不能把该时间作为严格冷启动加速承诺。真实用户多工作区约 1 GiB 的现场与此空白 profile 不是同一负载，不能直接套用节省比例。

验证结果：99 项定向单测、8 项工具区交互回归及 1 项 UI 性能测量通过；TypeScript 和生产构建通过，定向 ESLint 为 0 errors、5 个 ProjectSettings 既有 hooks 警告。额外隔离 Electron 检查确认高级 JSON model → onChange → 校验/审批 → 配置落盘，以及文件查找、键盘编辑与磁盘保存通过。高级配置的整文档注入最初因键盘自动配对/缩进和旧 textarea 定位导致测试失败，最终改用真实 model 更新验证保存链路；未据此宣称覆盖 JSON 编辑的所有键盘/输入法行为。构建产物独立保存在 artifacts，没有替换运行中的开发版或安装版；没有运行完整 verify 或用户真实长时负载。

本地 cmd PTY 实验首次回显基线/候选约 2.76/2.74 秒，后续单字符 IPC→PTY 回显约 16–32 ms，未见本轮改善。首个字符可能落在 shell/终端初始化阶段，当前检测不含 xterm 绘制，也未定位这段等待的调用栈。该问题保留，不能被内存指标掩盖。

### 多终端标签切换的局部优化，2026-10-19

用户补充多个终端标签之间切换也会等待画面。源码和 20 xterm／每实例 2,000 行历史的真实组件 fixture 确认，普通标签激活原先每次触发两次适配与整屏刷新，并带动未变化标签、终端和变更浮岛参与父层渲染。当前同尺寸激活只请求一次绘制，尺寸变化保留两帧后的完整恢复，工作区返回保留 64ms 复核；App 根只订阅 pane 存在性，内容区仍订阅实际树。12 次切换的适配从 24 降至零，刷新从 24 降至 12，没有重读 replay 或发送 PTY resize；单次基线 React actualDuration 总和 154.5ms，候选约 58–73ms。两帧显示机会仍约 30–32ms，未复现现场长停顿，不能将 React 工作量下降等同于真实桌面延迟已经消除。实现、恢复时序与专项检查归[工作区标签](./pane-tab-reorder.md)。本轮不改变隐藏输出解析、跨终端总预算或主进程负载。

### 后续优化顺序与约束

用户进一步明确：蓝图、知识库、历史统计均为必需功能，优化不得依靠关闭功能或丢弃历史。通知维持桌面默认开启、远程默认关闭且可配置。第一项已落地调整是远程控制 SDK 按启用条件加载，具体行为与验证见[通知决策](../agent/agent-notifications.md)；它不等于隔离全部远程模块，也不能解释或消除整个应用约 1 GiB 的内存占用。

后续应分别解决常驻量、瞬时分配峰值和交互阻塞。下表保留完整方向；仅上述 Codex event 分块读取、工具区订阅和编辑器加载已落地，其余尚未实施：

| 必需功能 | 内存与计算优化 | 保真边界 |
| --- | --- | --- |
| 历史统计 | 持久化每文件解析游标及累计状态，正常追加仅解析新完整行；分块读取、单次解析并直接累计，避免 Buffer/全文字符串/所有行/对象数组同时常驻；限制并发与每批字节量；页面按需读取数据库聚合结果 | 首次历史导入仍完整但分批进行；处理半行、截断、重写与版本迁移；用量去重、压缩计数及旧数据覆盖与现有实现对照，不能只读取尾部当作全历史 |
| 蓝图 | 活动工作区优先；保留已有精简传输，在版本未变化时复用图投影，变化时按 Note 更新；冷工作区持久化摘要后释放可重建索引，按总内存预算管理缓存；大图减少不可见节点的 DOM | 跨工作区引用仍可按需解析；编辑、分支变化与外部写入须失效缓存，不返回过期关系 |
| 知识库 | 处理队列保留，但按批消费、检查点续跑；后台维护分片；检索先取索引命中与摘要，再加载必要正文；限制同时在途任务和结果缓存，UI 隐藏时暂停展示层刷新 | 保留持久数据、待处理队列和必要采集；界面隐藏不等于关闭知识功能或放弃后台任务 |
| 终端与聊天 | 前台优先的总输出预算；冷热视图分离，按总字符/模型数量而非只按工作区个数设限；历史列表虚拟化并缩小流式订阅范围 | 保留运行中任务、未保存编辑、输出序列与 ANSI 恢复；销毁视图不能顺带杀终端 |

先用增量、分块和有界缓存减少实际工作量，再将仍较重的历史/数据库任务放入共享后台 worker；worker 本身增加堆和通信成本，不应每项目各起一个，更不能向 worker 复制整个大对象后宣称节省内存。只把耗时逻辑换成 `async` 或延迟启动不会自动降低常驻量。蓝图/知识列表可以立即显示持久摘要并显式标记刷新中，待校验后更新；这种方式需要版本一致性，不能以旧摘要冒充最新事实。

| 顺序 | 改动 | 预期作用与代价 |
| --- | --- | --- |
| P0 | main 事件循环延迟、renderer long task/Event Timing、点击→首帧、输入→回显、IPC 队列/输出积压统一时间戳；采集故障窗口 CPU profile | 先分清 JS、布局、GC 与 native view 等待，避免将同步阻塞、动画时长和磁盘 I/O 混为一谈；诊断按需开启并限量 |
| P1 | 全历史扫描、JSONL 解析/哈希与用量数据库交给一个有界后台 worker/service，main 仅协调和传摘要 | 优先保证输入 IPC 不被历史任务阻塞；避免每工作区启动一个进程。需保留去重、最终采集、取消、文件截断/重写识别及数据库耐久性；worker 会增加基础内存，主要收益是延迟 |
| P1 | renderer 全局终端输出调度，前台优先、后台降频；限定总排队量和重放阶段积压 | 避免 N 个独立 8 ms 预算共同挤占交互；不能静默丢 ANSI 数据或暂停用户命令。涉及 PTY 背压时明确 shell 输出阻塞语义，冷却需有完整状态恢复策略 |
| P1 | 菜单/面板外壳立即响应；拆 global-tools selector、稳定项目树边界；聊天按会话订阅、历史与输入分离，隐藏 UI 停止高频视觉更新 | 解决工具区状态更新牵动整个工作区；浏览器首开先显示有状态的外壳，再等待 native surface，不能伪装加载完成 |
| P2 | Monaco 改为首次编辑意图触发；仅预热活动/近期工作区；知识/历史恢复分批并服从交互优先级；重型域实现按首次调用加载 | 降启动后常驻和短时峰值，代价是首次打开功能需轻量 loading。只延迟几秒仍会回到原常驻量，不能当作内存优化验收 |
| P2 | 给终端、编辑模型、Note/会话缓存、浏览器页签建立统一生命周期和总量预算 | 将 active / hidden / cold / closed 区分，保留任务运行和未保存内容，释放可重建视图；不能单凭固定数量缓存认定内存已受控 |

建议在同一发布构建、隔离 profile 和相同数据集上测：空白启动、恢复工作区后 5/30/120 秒、1/4/8 终端持续输出、工具菜单/工具区/浏览器首开、聊天流式、扫描期间和 30–60 分钟运行后。分列 main/renderer/GPU/CLI/MCP 的 Private Bytes 与 Working Set，renderer 另量 JS heap 与 DOM/编辑模型数量。单次高内存不是泄漏证据；关闭可回收功能后的 retained heap 和长期斜率更有意义。

可先设产品目标：工具菜单点击到首帧 p95 < 50 ms、p99 < 100 ms，固定本地 shell 的输入回显 p95 < 50 ms、p99 < 100 ms；外部 CLI 自身处理时间另列。后台重任务期间也应满足交互预算。它们是待验收目标，当前没有事件级测量结果。内存节省比例需要冷启动 A/B 后制定，不能从当前进程快照承诺减少多少 MB。

### 数据增长与缓存回收

首批空白 profile 的总私有提交中位数 476.9 MiB 不是架构下限，也不能说明有大量历史、多工作区时的剩余空间。用户进一步授权本阶段实施两个高优先级项：Chat 日志流式恢复与编辑器缓存上限。下述机制已从源码确认，2A 的隔离测量见后文；其余没有逐组件堆归因，不能据此称为泄漏或承诺节省比例。

| 对象与源码依据 | 当前机制及影响 | 下一阶段方向 |
| --- | --- | --- |
| Chat 日志，`src/main/janus/chat-store.ts` | 优化前整读日志并保留所有有效快照，最后只使用一个；2A 已改为流式恢复最新有效快照及身份集合。保存仍追加全部会话快照 | 后续再做耐久检查点/轮换或会话级增量，降低重复序列化与磁盘增长 |
| Chat 展示，`useJanusChat.ts`、`janusChatConversations.ts` | 启动取回全部会话正文；保存随会话变化传递完整集合。`MAX_CHAT_MESSAGES` 常量不构成实际裁剪，`capChatMessages` 返回原消息 | 列表先取摘要，当前会话按需取正文，长历史分页。保留完整持久历史，不用消息截断换取内存下降 |
| 编辑器，`src/renderer/src/stores/editor.ts` | `loadedFileCache` 保存磁盘文本和图片 base64；2A 已加每 renderer 的估算 16 MiB/128 项 LRU，总量包括打开文件的磁盘快照，单项超过 2 MiB 不缓存 | 打开/未保存内容继续由 openFiles 持有，淘汰不关闭 tab；真实大项目下再调整预算，不将缓存上限当作整个编辑器内存上限 |
| Note 索引，`../janus-agentX/packages/harness-node/src/note-service.ts`、`useWorkspaceBootstrap.ts` | 所有非活动工作区顺序预热；共享服务按 root 保留 indexes/overlayCache，`unwatchAll` 关闭 watcher 而未清空这两类缓存，未发现总量淘汰 | 活动/近期工作区优先，加入显式释放和总预算；失效与跨库解析仍按需执行。涉及共享依赖，应在其维护边界内实施并验证 JanusX 集成 |
| 终端与浏览器 | xterm、输出队列和重放按实例限量，尚无全局内存预算；浏览器非活动 tab detach 后仍存活，关闭 tab 则正常关闭 webContents | 先量化实例数和保留对象，再设计冷热视图与总预算。后台页面冻结主要减少 CPU；销毁重载可能损失表单及页面状态，应单独设计恢复策略 |

Map 中多个索引可能引用同一文档，React ref 与 state 也可能共享对象，不能把每条引用都算作一份内容。编辑器缓存保留不代表 Monaco model 已泄漏；浏览器隐藏保留亦是既有生命周期选择。知识库尚无足够堆证据指向某个具体缓存，继续保留检索投影、任务批量上限和有界结果缓存作为候选，不将其列为已证实根因。

实施顺序以本次内存目标为准：

1. **2A：缓存边界与恢复峰值，已实施。** 编辑器磁盘快照字节预算与 Chat 日志流式恢复分别针对关闭文件后的常驻量和启动峰值。日志保持坏行、半写尾行、重复 ID、孤立 parent、合法修订链和旧格式回退语义。
2. **2B：减少无关数据常驻。** Chat 摘要/正文分离，Note 工作区按需预热与释放；再评估日志检查点或增量存储。涉及 IPC、存储迁移及崩溃恢复，需独立验证，不与第一批混成一次大改。
3. **2C：多实例与后台工作。** 扩展历史读取的增量/分块覆盖，建立终端和浏览器总预算。仍存在主线程长任务时再评估共享 worker；线程隔离主要改善响应，也可能增加基础内存。

每批先冻结同数据基线，再审查功能变化和跑定向回归，最后比较性能。检测应增加：缓存估算字节/命中/淘汰、已加载会话数及正文大小、工作区索引数量、编辑模型数、终端队列和浏览器存活数；计数按需采样，避免诊断本身持续扫描全部对象。Private Bytes、Working Set 与 JS retained heap 分开报告；测试环境可用受控 GC 辅助定位，但同时保留正常 GC 的实际进程曲线。

测试矩阵覆盖小/大历史与不同修订次数、反复打开关闭多批文本/图片、工作区往返切换、会话切换和重启恢复。固定负载重复循环后，检查可淘汰缓存是否满足预算、保留堆是否趋于稳定，以及 30–60 分钟内存斜率；仅瞬时峰值降低不能代替长期回收验收。日志最新有效快照须与旧实现一致，未保存编辑不丢失，外部改写后重新打开不得返回陈旧内容，蓝图跨库引用、知识任务和历史统计结果保持一致。冷热切换的首次打开延迟与终端输入/菜单 p95、p99 同时记录，防止把内存压力转成更明显的等待。

#### 2A 实现与验证

Chat 使用 256 KiB UTF-8 流读取、按 LF 切行并在批次之间让出事件循环，仅保留最新有效快照和所有已接受修订 ID；保持原有规范化和链校验。多块长行用片段列表拼接，不累计全文或所有旧对象。单条全量快照仍必须解析，极长单行可能阻塞；身份集合仍随修订数增长。未修改磁盘格式、原日志内容或全量保存协议，未新增消息裁剪。

编辑器在原读取/保存路径的缓存上增加 LRU，载荷按字符串长度 × 2 加路径和固定元数据估算；上限为每 renderer 16 MiB、128 项，单项超过 2 MiB 跳过。命中刷新次序，失效/删除同步扣除预算，重命名失效旧路径缓存。打开 tab 和脏内容不靠缓存存活，淘汰只使下次打开重新读取。没有在关闭时重新缓存，以免复活已被外部事件失效的内容；关闭/工作区失效取消在途读取的缓存资格，旧请求不能清掉新请求，较旧读取结果不能覆盖新读取或期间的编辑。

主代理自审覆盖上述失效竞态及关闭时回填风险，并补回归用例；不是独立代理审查。11 个相关测试文件共 **79 项通过**，TypeScript、两处改动源码 ESLint（0 警告/错误）和独立生产构建通过。实际隔离 Electron 的高级 JSON model 修改/审批/落盘及文件打开、查找、键盘编辑、磁盘保存通过。没有替换运行中的安装版/开发版，没有运行完整 verify 或真实 30–60 分钟长会话测试。

`scripts/performance/retention-benchmark.mjs` 在编辑产品代码前冻结旧实现；双方分别用五个新 Node 进程，完整恢复快照/文件内容 SHA-256 一致。最终按同一检测节奏复跑冻结 bundle，结果位于 `artifacts/performance-retention/{baseline,candidate}.json`。下表是五次中位数，包含测试进程本身，不能叠加成整机节省量：

| 指标与场景 | 基线 | 优化后 |
| --- | ---: | ---: |
| Chat：44,634,409 字节、128 个全量修订，采样堆峰值 | 262.2 MiB | 47.3 MiB |
| 同场景进程高水位 RSS | 398.3 MiB | 111.1 MiB |
| 同场景恢复耗时 / 最大事件循环延迟 | 155.2 / 104.3 ms | 131.5 / 15.8 ms |
| 同场景恢复后 GC 堆 | 6.0 MiB | 6.2 MiB |
| 编辑器：240 个文本/图片开关，最终 GC 保留堆 | 125.8 MiB | 13.3 MiB |
| 编辑器：每批 80 个后的 GC 堆 | 45.7 → 85.8 → 125.8 MiB | 13.2 → 13.3 → 13.3 MiB |
| 编辑器：批量总耗时 | 154.1 ms | 157.5 ms |

Chat 收益主要是恢复峰值，最终会话正文仍保留，恢复后的堆未下降。编辑器 fixture 每项是独立 512 KiB 字符串，四分之一为图片 base64；模拟读取且每批强制 GC 仅用于隔离测量，不能外推为用户点击时间。双方均执行 240 次底层读取，随后 200 次最近文件重开均命中；单次初开 p95 约 0.343/0.333 ms，热重开 p95 约 0.017/0.014 ms。批量总耗时包含生成、哈希、采样和 GC，未据此宣称运行更快。被淘汰或大文件重开需要实际 I/O，延迟代价仍需真实项目验证。

## 版本基线与差异

源码对比固定为 `v0.9.1` → `v0.9.2`，提交分别为 `ffd4a1cb3cf864f0c5e9241993bdf90c38f1164d`、`cda5805fed094c65689385dadf9b89a568c018c3`。同时读取本地 `release/0.9.1`、`release/0.9.2-fixed` 的 `win-unpacked/resources/app.asar`，核对 package 版本及全部 `out/main` JavaScript 分块：两版均有便携 data 路径；仅后者含用量账本、全语料扫描和重复 JSON 校验实现。该核对确认相关实现已打包，不声称本地产物逐字对应标签或代表用户当时使用的每个包。

| 路径或行为 | 0.9.1 | 0.9.2 与复核结论 |
| --- | --- | --- |
| 便携 data、递归 watcher、每目录 check-ignore、重复审查注册 | 已存在 | 属于既有放大机制，不能单独解释版本差异 |
| Codex 绑定会话读取与目录枚举 | 已整文件读取，先全目录枚举再筛选 | 继续整读，新增逐行预校验、SHA-256 与账本访问；不是从尾读改为整读 |
| Claude 绑定会话读取 | 首 16 KiB + 尾 256 KiB | 改为整读，逐行预校验、遥测解析、事件收集重复解析 |
| 10 秒终端轮询 | 已挂载 CLITerminal 驱动 | 移至主进程，覆盖仍受跟踪的终端；热工作区卸载不再停止该终端轮询，退出/销毁才释放 |
| 持久用量账本 | 无此账本 | 新增主线程 DatabaseSync，每次查询亦重开、初始化和关闭连接 |
| 全历史用量扫描 | 无此扫描 | 启动约 20 秒首次执行，此后每 5 分钟执行；零终端仍运行 |
| 会话面板同步 | 已有启动/面板触发扫描 | 新增面板活跃且窗口可见时约每 5 秒扫描，保留解析缓存和请求合并 |
| Chat 不可见时的渲染树 | 直接 return null | 普通会话保留 hidden 子树及新增 MemoPanel；隐藏不是暂停 React 更新 |

主要引入提交是 `f3b5aaf`（用量账本及历史解析）、`e06a500`（全语料扫描与无 hook 归属）、`dc60c70`（会话面板周期同步）。提交说明不能代替源码：全语料扫描器实际枚举 Claude/Codex/Pi；OpenCode 仍走绑定终端路径。

## 实测证据

| 对象 | 采样结果 | 边界 |
| --- | --- | --- |
| 主进程 PID 10056 | 一次约 5 秒采样占单核 CPU 95.9%，私有内存约 480 MB | 一个逻辑核心为 100%，不是整机占用率 |
| 主界面 PID 52868 | 同次采样占单核 CPU 65.3%，私有内存约 518 MB | 未取得 JavaScript 调用栈 |
| GPU 进程 PID 15388 | 同次采样占单核 CPU 41.5% | 是该进程 CPU 时间，不是 GPU 硬件利用率 |
| 第二 renderer PID 32012 | 同次采样约 0% | 不是所有 renderer 都异常 |
| Git 子进程 | 主进程下曾同时存在 150 个 check-ignore；另一次采样前后各 122 个，PID 交集为 0 | 持续创建退出的进程风暴，不足以证明永久进程泄漏 |
| 可用系统内存 | 约 16 GB | 当前不支持系统内存耗尽是主因 |
| 仓库递归监听 | 10.017 秒共 61 个事件，56 个来自便携版 data，5 个来自 artifacts | 文件事件数不等于应用刷新次数 |

profile 事件主要来自用量数据库 WAL/SHM、本体、审查状态及其临时文件。使用 Win32_Process 父 PID、创建时间、CPU/I/O 计数配合 Get-Process 采样；进程累计 I/O 不能直接解释为物理磁盘读写量。

## P0：应用数据位于被监听工作区

`src/main/bootstrap/session.ts` 将便携版 userData 放在可执行文件旁，而 `src/main/ipc/handlers.ts` 递归监听工作区。当前 profile 在工作区内部，原版广播前没有排除该真实路径。活动 scope 命中时，`useWorkspaceBootstrap.ts` 会从文件事件刷新文件树、Git 状态与编辑器；应用自己的用量与审查写入也能成为刷新源。

上述 profile 路径与刷新链在 0.9.1 已存在。0.9.2 的新增点是 SQLite 等周期负载。Git 忽略 release/data 不会让 `fs.watch` 自动忽略它们；文件树的忽略标记也不等于监听排除。若实际便携包在所监听工作区外，该自监听解释便不成立，仍需分别调查遥测本身和 renderer。

提交 `f0c5995` 已合并刷新、限制目录/Git 并发，并过滤 Git 锁/对象/日志与根层 `.janusX` 事件，但没有按 userData 真实路径排除 release 内 profile。它限制放大量，尚未切断该触发源；采样时旧便携版也未包含该提交。

本轮已按规范化绝对路径排除实际 userData、sessionData 与显式 disk-cache-dir 子树；默认 Chromium 缓存位于 sessionData 内。Electron 不提供 cache 这个 getPath 名称。没有硬编码版本目录或屏蔽用户全部 data 文件夹；原始订阅者仍接收所有事件，未知文件名仍保守广播。

## P1：遥测重复扫描与主线程同步 SQLite

`runtime-telemetry/coordinator.ts` 每 10 秒读取受跟踪终端快照；`history.ts` 先递归列举 Codex 会话文件再按绑定 ID 筛选。为精确压缩计数整读 Codex 绑定文件在 0.9.1 已存在；0.9.2 新增读取器逐行 JSON 校验后解析器再次解析，并计算 SHA-256。绑定文件未变化也重复工作。Claude 的整读则是本次新增，还为事件收集再次解析全部行。

清理前本机 Codex sessions 有 1,115 个 JSONL，合计约 1,539.9 MB；Claude projects 有 95 个，约 165.3 MB。这不代表每轮读取全部内容。两个 Codex 绑定文件约 5.71 MB 和 1.36 MB，采样时均非刚写入。

`usage-ledger.ts` 每次 record、sessionState、sourceCheckpoint 均打开/关闭 DatabaseSync，重复 PRAGMA 与表/索引检查，配置 busy_timeout=3000、synchronous=FULL。尤其 `open()` 无条件执行 `PRAGMA user_version=1`，查询入口并非只读连接；未增加用量记录也会有数据库文件事件。全语料扫描即使全部命中未变化游标，仍逐文件执行这条同步打开路径。同步工作在 Electron 主线程执行，遇锁或大量历史可能阻塞 IPC。

### 隔离验证

本地诊断脚本 `artifacts/performance-review-092/review.mjs` 从两个标签读取源码并用 esbuild 编译，在系统临时目录生成合成 profile 和 JSONL，不访问真实会话或运行中应用的账本。命令为 `node artifacts/performance-review-092/review.mjs`，机器结果保存在同目录 `results.json`；artifacts 由 Git 忽略。历史读取只增加字节/JSON.parse 计数，五次热读取中位数；计时包含计数开销，不是 Electron 长时交互基准。

| 实验 | 0.9.1 | 0.9.2 |
| --- | --- | --- |
| 同一约 8.02 MiB Codex 文件，每轮实际读取 | 8,410,778 字节 | 8,410,778 字节 |
| 同文件每轮 JSON.parse 次数 / 中位耗时 | 4,502 / 14.47 ms | 9,004 / 20.54 ms |
| 同一约 8.02 MiB Claude 文件，每轮实际读取 | 278,528 字节 | 8,410,664 字节，约 30.2 倍 |
| 同文件每轮 JSON.parse 次数 / 中位耗时 | 149 / 1.85 ms | 13,503 / 24.38 ms |

在 Node 24.15.0/Windows 中，0.9.2 的 1,000 次连续同步 `sessionState` 查询约耗时 14,352.97 ms；10 次相隔 200 ms 的查询产生 90 个原始 watcher 事件，涉及数据库、WAL、SHM。用量记录仍为零，证明“记账幂等”不等于“未变化查询无磁盘活动”。连续 1,000 次调用时 watcher 还收到空文件名，不能将缓冲合并后的事件数当作实际写入次数。语料扫描在文件之间有异步等待，这个压测不表示真实扫描连续冻结 14 秒。

另一 worker 人为持有写锁后，一次 `sourceCheckpoint` 查询约 3,358.25 ms 后报 database is locked；调用期间零延迟定时器未执行，复现同步初始化能阻塞事件循环。尚无证据表明用户现场确实发生锁竞争，不能把合成写锁实验作为现场根因。

以上支持新增数据库成本、文件事件触发源和解析放大量，不能独自解释之前 5 秒样本中的 95.9% 主进程单核占用。两个几 MB 的绑定文件每 10 秒解析一次的耗时不足以直接推出持续满核；需测刷新次数、Git 启动率、全历史扫描和主线程调用栈。

本轮已实施连接复用与有界未变化快照缓存，保留账本幂等、事务与精确压缩计数。源文件变化后仍完整解析与哈希；未实现增量解析或 worker 隔离，单个持续变化的大文件仍可能占用主线程。是否进一步隔离由调用栈与长时交互测量决定。

## P1：每个目录重复进入审查注册

`handlers.ts` 根 load 与每次 children 都调用 registerWorkspaceWatcher，再调用 trackBlueprintReviewWorkspace。`blueprint/review/runtime.ts` 随即读取 context、automatic.watch 和 reading.read；context 含根解析、身份读取与 Git 分支查询。watcher 已存在不会跳过这些业务工作。调用链已核对，独立性能贡献未量化。

该调用链在两个标签之间未变，应归为放大器。`reading.read` 没有传入 snapshot 时还会 `sources.capture`，其中再次解析 context、读取两次 Note 快照并复核分支；内部缓存是否命中会影响代价，不能声称每次必定完整重解析所有 Note。`NoteReadingService` 只有内容状态改变时才保存，不能把每次目录读取描述成必定写入审查状态、形成无限反馈。

本轮已将首次工作区注册与目录读取分离，合并同根在途注册；根重新加载仍检查分支和重试，关闭或 shutdown 使迟到的 context 结果失效。

## P2：隐藏终端、聊天与动画更新

`CLITerminal.tsx` 隐藏终端仍接收解析输出；四个热工作区上限不等于四个终端上限，每终端预算也不等于总预算。多个持续输出可能共同挤占输入；尚无 trace 将 renderer CPU 精确归因于 xterm。

`JanusChatProvider` context 随 runtimeStates 重建，流式按 16 ms 合批，相关消费者可能连带更新。JanusChat 输入与历史仍在同一组件；本次已缓存消息合并排序并虚拟化历史，逐消息工具过滤只作用于挂载消息。历史 MarkdownContent 已 memo，不能称为每次输入都重新解析全部 Markdown。

`JanusIslandExpandedShell` 展开态定时增删粒子 React state，活跃时约每 200 ms 新建粒子，CSS 存在持续动画和滤镜；需要隔离对照，GPU 进程 CPU 高不能证明动画是主因。ThemedTooltip 默认 350 ms 延迟是设计行为，数秒延迟需另查事件循环。

版本对比中，隐藏终端解析和粒子定时机制已在旧版存在。新增且值得测量的是普通 Chat 从隐藏时 return null 改为保留 hidden 树与 MemoPanel；流式 context 更新仍可让隐藏内容参与协调。另一个新增放大量是 ThemedTooltip 把全局 scroll/resize/keydown 监听从显示期间移为每个实例挂载期间，并增加 pointerdown；有清理函数，不构成已证实的监听泄漏。尚无 renderer trace 将两项增量与输入延迟关联，优先级低于已有数据库与进程风暴证据。

## 补充：会话面板的周期扫描

`dc60c70` 新增 `startExternalSessionSync`：会话面板 active、文档可见时每次完成后约 5 秒重新扫描，并在 focus/visibilitychange 时唤醒。`collectCandidates` 在截取每引擎 200 个候选之前会遍历整个目录并逐文件 stat，因此候选上限没有限制枚举成本；该循环也不按当前 scopePath 限定原生会话库。

解析结果按 mtime/size 缓存，主进程合并同时请求，批量导入合并通知。因此不能称为每 5 秒重新全文解析所有历史或重复启动无界扫描。活跃会话文件变化会失效缓存并重新读取，和遥测扫描可能重复处理；只在会话面板开启时出现/显著加剧的卡顿应重点对照此项。面板关闭时不应据此解释持续负载。

## 已实施的安全优化

保留真实用户 profile、历史数据和既有未提交改动；优化覆盖触发源、重复工作和释放流程，不关闭统计或降低压缩计数精度。

1. `workspace-event-filter.ts` 在注册时解析绝对路径与 junction 别名，过滤工作区内实际应用数据子树的 renderer 广播。原始订阅、未知文件名、普通同名 data 与相邻前缀路径保持正确；过滤不阻止底层 watcher 接收事件。
2. UsageLedger 复用连接，提供幂等 close；路径切换关闭旧连接。仅新库在事务内初始化 schema/version；普通查询不再执行初始化写入。WAL、FULL、原子提交、模式锁与分页快照保留，查询异常显式回滚。同步 busy_timeout 从 3000ms 降至 100ms，写锁失败报告并在下一轮重试，持续争锁时采集会延后。
3. coordinator 最多缓存 128 份轻量遥测投影，不持有完整 JSONL 或待记账观测。按引擎、绑定、cwd、自定义 home 隔离，每次命中异步 stat 比较 dev/ino/birthtime/size/mtime/ctime，最长 30 秒强制全文复核。增长、改写、替换、删除、重绑、解析和记账失败不复用旧观测；缓存不替代账本源前缀 SHA-256 校验。
4. 同根审查注册合并在途调用，children 不重复扫描已注册根。语料扫描保持不重叠，文件间让出事件循环并响应取消；退出时取消扫描与定时器、清缓存并排入最终完整采集，等待在途读取后关闭账本。补正 Codex 累计模式在终端与语料扫描交替时的源字节/身份传递，半写尾行不进入已完成前缀哈希。
5. Tooltip 仅在等待展示或展示期间订阅全局关闭事件，保留延迟取消、键盘与点击关闭行为。隐藏 Chat、xterm 与动画是否需要调整仍待 trace。

### 优化前后隔离对比

命令为 `node artifacts/performance-review-092/compare-optimized.mjs v0.9.2`，完成后再执行同命令的 `workspace` 参数。Windows/Node 24.15.0，使用相同约 8.02 MiB 合成 Codex 文件和临时账本，不访问真实会话。2026-10-16 顺序运行结果保存于同目录 `final-comparison.json`；该脚本与产物位于 Git 忽略目录。

| 实验 | 原始 0.9.2 | 优化后工作区 |
| --- | --- | --- |
| 1,000 次未变化 sessionState 查询 | 13,658.48 ms | 7.53 ms |
| 10 次相隔 200ms 查询的原始文件事件 | 90 | 0 |
| 另一连接持写锁时 sourceCheckpoint 查询 | 3,367.55 ms 后报锁错误 | 0.12 ms，成功 |
| 预热后 100 次未变化绑定会话查询 | 5,673.78 ms | 18.95 ms |
| 上述 100 次 JSONL 读取 / JSON.parse | 841,077,800 字节 / 900,400 次 | 0 字节 / 0 次 |

这些是隔离路径计时，不能换算为全应用加速倍数。首次完整解析未缩减，变化中的大文件仍需全读；缓存测量在 30 秒复核期内。事件数、字节数和解析次数直接支持消除重复工作；真实 UI 延迟和 Git 启动率仍需新版包测量。

### 回归验证

21 个定向 Vitest 文件、161 项用例通过，覆盖账本压力/写锁重试/回滚、历史与累计守恒、源改写与半写尾行、缓存变化/删除/重绑/失败重试、最终采集、扫描取消、watcher 过滤与原始订阅、审查注册和文件树压力。两个 `right-tool-tooltips.spec.ts` 浏览器用例通过（纸面/深色）；严格未使用检查 `npm run typecheck:strict-unused`、生产文件定向 ESLint 与 `npm run build:check` 通过。浏览器使用 IPC 替身，隔离压测使用 Node 24；它们不代替 Electron 35 实机长时输入验收。

单测命令为 `npx vitest run --maxWorkers=2`，文件集合为 `tests/unit/` 下的 `usage-ledger.test.ts`、`usage-ledger-pressure.test.ts`、`usage-ledger-client.test.ts`、`runtime-telemetry.test.ts`、`runtime-telemetry-history.test.ts`、`runtime-telemetry-accounting.test.ts`、`runtime-telemetry-coordinator.test.ts`、`runtime-telemetry-corpus-scan.test.ts`、`runtime-telemetry-attribution.test.ts`、`session-attribution.test.ts`、`office/workspace-watcher-coordinator.test.ts`、`workspace-event-filter.test.ts`、`blueprint-review-registration.test.ts`、`file-tree-ignore-pressure.test.ts`、`file-tree-refresh-pressure.test.ts`、`file-tree-load-pressure.test.ts`、`blueprint-note-reading.test.ts`、`app-shutdown.test.ts`、`external-session-sync.test.ts`、`external-session-scanner.test.ts`、`blueprint-review-status.test.ts`。浏览器命令为 `npx playwright test tests/e2e/right-tool-tooltips.spec.ts --project=island --workers=1`。`npm run check:notes` 验证 312 篇 Notes、0 错误、17 条既有跨仓链接诊断；定向 `git diff --check` 无空白错误。

### 本地便携包交付

2026-10-16 从当前工作区重新构建 Windows x64 便携版，版本保持 0.9.2，输出为 `release/0.9.2-performance-20261016/JanusX-0.9.2-x64-portable.exe`，约 162.2 MiB。执行 `npm run package:prepare`，再执行 `node scripts/package-win-portable.mjs --release-dir release/0.9.2-performance-20261016`；准备步骤刷新一个本地 sibling 发布包。交付包含当前未提交改动，未改写旧版目录、真实 profile 或发布远端版本。

独立重跑 `node scripts/check-packaged-runtime.mjs --portable --release-dir release/0.9.2-performance-20261016`，确认退出码 0；依赖闭包、体积预算、隔离目录中的 unpacked/portable payload 两种启动检查及 portable 启动器通过。逐文件核对 app.asar 中全部 213 个 out 文件与本次构建 SHA-256 一致。新目录附 `BUILDINFO.json`、`SHA256SUMS.txt` 与 `README-local.txt`，验证日志位于 `artifacts/portable-performance-20261016/verification.log`。这些检查确认构建与启动，尚未测新版包的长时输入延迟。

## Open questions

后续对照需固定同一份可恢复 profile/原生历史快照、工作区、终端数量和操作，不同时打开两版写同一账本。先比较便携包位于工作区内/外，再比较全历史扫描、会话面板、可见/隐藏终端及 Chat；记录 10 秒/5 分钟节奏附近的事件、IPC、Git 进程速率及输入 p50/p95/p99。诊断开关或 bisect 应在隔离构建中实施；当前未关闭用户功能、移动包或改写真实数据。

仍缺新便携版长时对照、IPC/刷新次数、主线程/renderer 调用栈和输入/悬浮延迟分位数。应比较空闲/持续输出、单/多终端、可见/隐藏及流式/动画开关。当前不能证明内存长期不增长，也不承诺已有补丁消除全部卡顿。

既有刷新合并与 Git 并发边界由[文件树刷新说明](./file-tree-reveal-race.md)维护；遥测正确性与生命周期由[会话源单源化](../terminal/requirements/usage-telemetry-single-source.md)维护。本文不创建 Task；已实施项与待测 renderer/包内长时问题分开陈述。
