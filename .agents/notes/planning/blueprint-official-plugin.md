---
{
  "schema": "harness-note/2",
  "id": "85162391-c49a-4d64-b5fa-75d915489d51",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-10-24",
  "updated": "2026-10-26T09:10:38.226Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1aef97e6-77fe-4bae-af51-ff560a737282",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/607e1d4b-8bf4-43c7-af1f-97da9ae9e30b" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/96a2f5cd-166e-4982-a444-7640858f0a5f" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd" }
  ]
}
---

# 蓝图官方可下载插件实施计划

## 目标与当前状态

用户要求将蓝图作为按需下载的官方功能，并整理代码维护位置、下载安装来源、扩展设计及缺陷防护任务。目标是新安装的主程序不包含蓝图专属业务包；用户安装后获得原有蓝图工作台、文档浏览、维护、审阅与 Note MCP 能力。未安装或停用时不启动蓝图自己的监听、调度或模型任务；项目原始 Notes 不因插件卸载而删除。

本文维护实施范围、现有代码和剩余出口。用户已授权完整实施，主 Agent 按普通 xdo 顺序执行，不创建 Task。正式分发、native 服务和蓝图独立包已有局部实现，主安装包拆分与发布尚未完成。验收集中维护在[插件架构需求](../workbench/requirements/plugin-architecture-forms.md) AC-20–26，原 AC-17／18 继续有效，以上条目保持未勾选。

当前已增加 official 签名来源、目录验证、下载、原子安装、更新和回退，以及“已安装／发现插件／开发者”管理页。正式来源不要求开发模式；10-26 本地交付已在生产 trust.json 中预置 janusx-blueprint-20261026 公钥及 official.blueprint native allowlist，目录未上线。蓝图后台已迁入 plugins/blueprint/src/main，独立 UI 已接入 dist/ui 和 manifest。宿主启动与普通聊天已退出旧分析器、审阅、建议、维护和修复运行时，渲染入口已移除旧蓝图 store 及工作台；兼容 CRUD、投影和纯数据模块仍被主进程引用，主包瘦身未完成。原功能基线见[蓝图验收记录](../blueprint/implementation-baseline.md)，已有未验收项继续保留。

## 已确认的迁移回退与首次加载故障

独立 UI 最初重新实现，造成原设置页和工作台的外观与交互回退。原三分区设置卡片、共享下拉交互、JEV 行内字段、自动连接检测、提交阈值步进及同页 MCP 已搬入插件。工作台现改用 location=workbench，恢复悬浮卡片外壳、左侧阅读、中央画布及默认关闭的右侧讨论，移除新增长驻 Note 列表和内部设置分页；工具箱只保留“打开蓝图”，设置中心保留蓝图设置，工作台设置按钮走公开 views.open 跳到同一页。原节点卡片、语义缩放、模块计数、未读／建议灯、浏览条、分组、两类连线、主题样式与 Janus 图形在插件内保留原展示结构，仅适配状态及数据来源，不导入宿主私有源码。左侧现搬入原 Wiki、Markdown 章节和关系卡片结构，以及默认收起的内容审核卡；顶部建议／更新搬入原注意列表结构。来源读取和操作通过插件后台适配，未回接宿主私有 store。宿主聊天渲染器和全部 Wiki 来源操作仍未宣称逐项等价。旧源码入口已移除、旧业务 IPC 明确拒绝调用；原始 Notes 不因界面迁移删除。

插件页恢复 JEV 密码输入、查看本次输入和清除操作。已存密钥仅返回 configured 状态，不恢复旧宿主 credentialGet 的明文回读；替换／清除走已授权 native 回调，只能写自身已声明槽，按原 safeStorage 存储，普通 KV 与草稿不承载密钥。重新打开使用“已配置，输入可替换”占位；这一点仍与旧宿主显示已存明文值的行为不同。设置设计与当前差异归[内容审核配置](../blueprint/maintenance/note-content-review.md#设置与-llm-配置前置条件)。

用户报告打开蓝图立即显示 `PluginError: INTERNAL_ERROR`。使用 JanusX 当前 Notes 的隔离副本、禁用模型调用，在已安装 `1.0.0-local.4` 的实际 native 服务包复现：311 节点的 `blueprint.graph` 返回 4,732,724 字节，超过 native 通道 4,194,304 字节上限。`workspace.status`、`settings.snapshot` 和 `review.read` 均通过同一服务调用，失败集中在图响应。收据为 `artifacts/plugins/blueprint-error-diagnosis.json`，诊断入口为 `artifacts/plugins/diagnose-blueprint.ts`；均为忽略的本地产物，不作为分发文件。

首次加载并行读取图和审阅。旧服务直接返回完整 `notes.projectView`；图中 `nodes` 为 2,445,959 字节，另有 1,903,644 字节的 `noteSnapshot`。协议校验拒绝过大结果后返回 `SERVICE_FAILED`，宿主未将该 native 错误转换为公开可识别错误，最终降为 `INTERNAL_ERROR`。该复现与远端 Release、模型凭据或插件未启用无关。现由 blueprint.graph-open／part／close 传输不可变序列化快照，每片 128 Ki 个 UTF-16 单元，保留跨片 Unicode、JSON 和所有图字段；页面拼接后一次替换图，详情仍经 notes.read 按需读取。没有提高全局 4 MiB 上限，也不为减包截断原 Note。

分片缓存绑定实际项目根和页面 owner，120 秒到期，同一 owner 的新快照替换旧快照；显式完成、页面释放和服务停止清理。最多 16 份，每份最多 64 Mi 个 UTF-16 单元，超限明确返回 FILE_TOO_LARGE。选择分片而非手工删减字段，是因为模块所有权、引用和组合读取依赖完整投影；代价是仍有整份序列化及浏览器解析内存，达到此限或首次加载明显变慢时再设计专用图 DTO。读取期间的刷新通知合并为一次后续刷新，不再反复取消大图传输；页面退出取消读取，阻止旧结果覆盖新页。未知 native 失败映射 SOURCE_UNAVAILABLE，保留脱敏错误码，不再统一掉进 INTERNAL_ERROR。

完整桌面还复现宿主预热与插件冷扫描争用同一 Notes 文件锁：单次 BUSY 立即转为 RATE_LIMITED，导致初始空白。插件的索引读取／重扫仅对 BUSY 每 100ms 等待重试，单层上限 10 秒，普通索引读取仍受原 12 秒超时约束。事务提交后的重扫也使用该入口，避免短暂扫描竞争被误报为文件写入失败。没有重试提交的写操作、抢占文件锁或修改共享包；持续占锁与非 BUSY 错误仍明确失败。页面刷新合并减少同一进程里的重复扫描，但不能替代跨进程锁。

工作台按原设计覆盖整个主窗口，包括主界面顶栏；插件绘制原两栏：第一栏项目选择、更新／建议、可选审核活动、Janus 和关闭，第二栏搜索、状态／类型筛选及画布操作，下面为左阅读／中画布／右 Janus 卡片。设置、刷新和前进／后退收进“更多”，浏览条保留返回。来源诊断在第二栏原生弹层，更新／建议／审核详情在第一栏固定弹层，Escape 或外部点击关闭，不额外占行、不推动画布。左侧标题固定、正文独立滚动，右侧固定标题和底部输入区，中间滚动呈现讨论与修改预览；画布恢复原内层圆角卡片，外壳透明。窄宽度工具栏横向滚动，不换行挤占卡片；初始化读取显示原加载卡片及阅读骨架屏；卡片以 180ms 间隔、260ms 时长入场，节点使用原索引 CSS 延迟（320ms + capped index × 70ms，最多 8），分支边随子节点显现，刷新不重挂相同节点。关闭按 60ms 反向错峰后通知宿主，减少动画模式直接完成。右侧恢复原最简输入框、安静问候与固定底部输入区，模型与维护范围可折叠。

主 Island 入口被全屏工作台覆盖，若 Island 经宿主操作展开，则暂隐整个工作台及 native 内容，收起后恢复同一实例。右侧讨论首次打开后保持挂载，收起不取消运行中任务或清空草稿。工作台和 Island 仍是不同会话，不宣称已合并。为避免 native 子视图与宿主标题控件不能正常重叠，新增通用 frame=plugin 工作台声明及必需能力 views.workbench.frame，宿主省略自己的标题及内边距。views.getFrame 只读已授权项目的名称／ID，views.requestFrame 只请求关闭或切到已授权项目；上下文、当前工作台、根与撤销状态由宿主复核，不暴露任意根／窗口控制。切项目沿用原工作台作用域变化关闭行为。代价是旧宿主不识别必需能力时拒绝加载，包声明变化需重新授权。该契约用于保持原布局，不含蓝图 ID 特判；原文操作与聊天呈现仍有下述插件边界。测试在隔离目录／profile 执行，未改动运行中的开发 profile 或重启用户应用。插件完整功能及生产发布仍未验收。

设置往返回归曾出现画布正常但全部节点隐藏：刷新图 DTO 时丢失 React Flow 已测量尺寸，而不变的节点盒子未必再次触发 resize。现按同 ID 保留 measured，数据内容、布局与筛选仍按新投影替换；不使用强制 visibility 覆盖或重建页面规避。完整桌面已验证设置返回后节点恢复，定向 Chromium 回归另覆盖相同尺寸的数据刷新后继续选择与缩放。

本轮回归：navigation、graph-transfer、settings-ui、plugin-surfaces、plugin-runtime、plugin-native-service、host-boundary 与 native 共八份文件，首轮 71 项通过；加入文件锁竞争用例后，native 14 项重新通过。真实仓库图响应超过 4MiB、节点超过 300，验证逐片传输与组装，不调用模型；Unicode／JSON 跨片与越权／释放拒绝有独立用例。原设置三分区、键盘下拉、连接检测、阈值步进、凭据显隐／清除和窄宽度继续通过。

本次 UI 恢复验证：宿主及插件严格未用类型检查、修改宿主文件 ESLint 通过；plugin-runtime、plugin-surfaces、blueprint-plugin-navigation 共 3 文件 51 项通过，覆盖框架声明／权限、已授权项目名单、越权与撤销后的迟到切换拒绝，以及图刷新尺寸和模块导航。完整桌面 `npm run test:blueprint:local -- --output artifacts/blueprint-local-results` 一项通过，使用真实仓库 Notes 隔离副本，验证覆盖主顶栏、两栏布局、左右卡片、来源弹层、设置返回节点、Escape 关闭及退出后独立 MCP。最终截图等待有限入场动画结束并确认 Janus 问候已加载，另断言左右卡片均在机身边界内，无裁切。

`npm run plugins:blueprint:check` 以八个锁定公开归档在仓库外重新构建，同包的一项签名 Electron 回归通过，验证首次等待时骨架／加载卡片、两栏、180ms 卡片／320ms 首节点延迟、减少动画、插件关闭、设置冲突、流式讨论收起恢复、实施交接、文件应用撤销和卸载重装。收据为 artifacts/plugins/blueprint-build.json，初始与加载截图在 artifacts/plugins/blueprint-restored-initial.png、blueprint-restored-loading.png。依赖复核仅 SDK 归档变化，七个共享归档不变，见 artifacts/plugins/frame-dependency-lock-review.json。全仓 Note 校验仍只有 entrance-choreography.md 的两项既有错误（缺 AC、更新时间早于创建），本次四份 Note 无新增错误。临时签名与确定性模型不代表生产发布或真实供应商验收。

## 阅读卡与注意列表恢复

加载时的来源诊断与正常工具栏共用弹层入口，不再在底部渲染“来源诊断 · N”独立行；初始化和失败态仍可检查诊断。左侧恢复类型／生命周期／标签、折叠关联文档、正文／关联笔记、审核快捷入口与同行原文菜单。内容审核卡默认收起且位于正文前，建议定位自动展开指定意见。目录、章节折叠、关联笔记预览、来源字段折叠及引用定位沿用原结构和样式；滚动条恢复宿主原样式。

更新／建议弹层恢复原 440px 宽、480px 高上限，包含搜索、模块筛选、刷新、滚动条目、上一篇／下一篇、当前筛选批量已读及撤销。已读条目保留在本次更新浏览序列中；提交只携带身份、hash 和路径，避免展示字段触发 native 严格参数校验。Escape 由打开的弹层优先处理，即使翻到末篇后焦点按钮禁用，也不误关闭工作台。

现有 notes.read 在后台用公开 readMarkdownView 从同次 fresh read 的正文生成目录／链接模型，与原文一起返回；浏览器不导入含 Node 模块的运行时代码。没有新增 native 方法、宿主接口或文件权限。原文菜单保留完整原文／正文预览和按 hash 打开原文件；插件页禁止 clipboard-write，因此未提供旧宿主的直接复制按钮，可选择原文手动复制。外部 URL 和图片维持离线展示限制，代码落点没有可验证版本时不开放文件读取；不以 UI 还原绕过权限。

本轮验证：插件严格未使用项类型检查通过；native、plugin-navigation、note-wiki、note-reading 四文件 34 项通过。签名载体覆盖加载时 33 项诊断入口、440px 弹层、搜索与筛选、上下篇选中／已读行保留、批量已读／撤销、Escape 回焦、指定意见展开／处理、目录／章节折叠和原文切换。原五份 CSS 与旧版对应文件逐字节一致。完整桌面回归一项通过，使用真实仓库隔离副本验证关系卡原文预览、原三卡布局、设置往返及退出后 MCP；已查看深色建议截图与 Planche 三卡截图。

最终 npm run plugins:blueprint:check 通过：八个原锁定归档在仓库外构建，完整签名载体一项通过，收据 artifacts/plugins/blueprint-build.json 的 runtime.status 为 passed；本轮未更新依赖锁。截图为 artifacts/plugins/blueprint-restored-suggestions.png、blueprint-restored-updates.png、blueprint-restored-loading.png，以及完整桌面输出目录的 blueprint-side-cards.png。Notes 校验仍只有 entrance-choreography.md 的两项既有错误，本轮维护文件无新增错误。独立载体首轮在应用修改后读取维护记录出现一次 RATE_LIMITED，随后同包复跑与最终完整 gate 两次通过，原因未确认，不将复测解释为已修复该偶发问题。未操作运行中的本地 profile 或发布 Release。

右侧“维护范围”展开曾被继承的 max-height:38% 再次限高：旧控件原是面板直接子项，迁入底部输入区后形成嵌套百分比高度，范围选择和说明被裁切。现仅由输入区保留 55% 总高度上限，配置区取消旧百分比限制并允许 flex 收缩、内部滚动；输入框和操作行不参与收缩，模型字段使用两个 minmax(0,1fr) 列防止窄卡片溢出。未改变维护范围绑定、模型配置和任务禁用规则。签名 Electron 载体回归一项通过，覆盖正常高度展开模型／范围、字段边界、520px 高度滚动后说明可读、输入框不重叠、收起后输入位置不变，以及后续讨论／应用撤销。截图 artifacts/plugins/blueprint-maintenance-scope.png 与 blueprint-maintenance-scope-compact.png 已查看。全仓 Notes 校验仍只有 entrance-choreography.md 的两项既有错误。

## 中部画布恢复

中部继续使用插件内的原模块卡片、浏览条、文件分组及连线，不更改图投影来源或插件权限。画布承载恢复原 24px 点阵、Planche／深色背景、0.05–4 倍缩放、底部图例、空模块提示及右键节点详情。模块页移除迁移时添加的 React Flow 默认缩放控件；原非模块图在 250 节点以内保留缩略图。主题变化同步 React Flow 的颜色模式。单击节点重新打开左侧正文，双击沿用首次点击的身份，避免阅读卡展开导致第二次点击落到相邻节点。

模块自动适配使用原 padding 0.2、最高 1 倍缩放。左右卡片开合改变画布尺寸后，等待尺寸稳定及节点测量再适配；历史进入仍恢复已保存视口。同模块选中操作若视口已一致则不重复延迟适配，避免覆盖用户紧接着的滚轮缩放。刷新继续保留同 ID 的节点测量，入场 CSS 及原布局样式未重构。

验证：插件严格未使用项类型检查通过；tests/unit/blueprint-plugin-navigation.test.ts 七项通过，新增 Chromium 回归覆盖主题／点阵、无默认控件、图例、右键详情、空模块提示、侧卡尺寸适配及选中后的滚轮缩放，保留模块进入／前后退和刷新验证。npm run test:blueprint:local -- --output artifacts/blueprint-center-local-results 一项通过，真实 Notes 隔离副本验证完整桌面，新增断言右侧卡片展开后所有渲染节点位于画布内；已查看 Planche 两卡和三卡截图。npm run plugins:blueprint:check 通过，八个原锁定公开归档在仓库外构建，同包签名 Electron 载体一项通过，收据 artifacts/plugins/blueprint-build.json 的 runtime.status 为 passed。本轮未更新依赖锁或操作运行中的开发 profile。全仓 Notes 检查仍只有未修改的 entrance-choreography.md 缺 AC 和更新时间早于创建两项错误。

## 无 Release 的本地使用

仓库根目录运行 `npm run dev:blueprint` 即可构建、签署并安装本地包，然后打开完整桌面。先添加项目，再在“设置 → 插件 → 已安装”审阅权限、选择项目并授权启用；工具箱可打开蓝图。阅读原有 Note 不需要模型，审核与讨论使用测试配置中自行添加的真实模型。`--prepare-only` 只准备产物，不打开应用。操作说明同步在 [插件 README](../../../plugins/blueprint/README.md) 和[开发指南](../../../docs/development.md)。

本地包走原有签名验证及安装器，不开放 unsigned native 目录。专用构建只信任本地生成的 blueprint-local 身份及 official.blueprint ID，不替换正常构建的生产 trust。签名身份、不可变版本目录和 profile 留在忽略的 `.cache/blueprint-local`；知识库也隔离在 profile/knowledge。每次重跑递增 `1.0.0-local.N` 并保留数据，更新后等待重新启用，不自动授予权限或调用模型。并发启动锁拒绝覆盖运行中的开发产物；修改代码后先退出再重跑。该入口不需要远端仓库、Release 或生产目录。

本地启动和独立分发是两条验证路径：`test:blueprint:local` 验证完整宿主、实际授权和桌面关闭后的 MCP；`plugins:blueprint:check` 验证仓库外锁定依赖构建及同包签名载体。前者不调用模型，后者的供应商回复是确定性 fixture；均不证明生产供应商质量或正式发布。

## 代码维护与发布归属

建议首版同 Git 仓库维护，插件拥有独立包边界、版本、构建和发布产物。这样可以在同一变更中审阅宿主契约与蓝图消费方，同时通过干净的仓库外构建证明插件没有偷用私有实现。以后需要独立团队或发布权限时再拆仓库，公开接口不因源码位置改变。

| 责任 | 当前位置 | 建议目标位置与约束 |
| --- | --- | --- |
| 插件 SDK、类型、schema 与消费测试 | `packages/plugin-sdk/` | 保留；只公开已实现接口，不导出宿主 React、store 或通用 IPC 通道。 |
| 安装、授权、隔离、任务与更新生命周期 | `src/main/plugins/`、`src/main/ipc/plugin-handlers.ts` | 保留宿主所有；新增分发子模块，不能包含蓝图专属审阅或画布算法。 |
| 通用插件入口和管理 UI | `src/renderer/src/extensions/`、`src/renderer/src/components/plugins/` | 保留；蓝图通过贡献注册进入，不添加按插件 ID 分支的业务容器。 |
| 蓝图 UI、投影、建议与审阅策略 | `plugins/blueprint/src/{main,ui,shared}/`，宿主仍有兼容消费者 | main 持有后台、共享引擎适配及 MCP，ui 持有隔离 React 页面，shared 持有插件内部 DTO。继续移除宿主旧入口与业务导入；完整功能矩阵未验收。 |
| 共享 Note／Agent 引擎 | 外部 `janus-agentX` 共享包及宿主适配 | 保留[既有归属](../blueprint/agentx-harness-inheritance.md)。解析、身份、事务、缓存、监听和撤销不在插件复制第二份；若其它功能仍依赖，不为减包而移除。共享实现修改应回到其所属仓库，并固定消费修订。 |
| 官方目录及发布脚本 | `plugins/catalog/`、`scripts/plugins/` 已有本地签名／目录工具 | 10-26 交付签名公钥已预置；生产目录及独立发布 workflow 待配置，插件产物独立于应用 Release。 |

`plugins/blueprint/` 已有独立 manifest、package.json、tsconfig 和 build.mjs，分别输出 service.cjs、note-mcp.cjs 和 ui/index.html；构建元数据拒绝宿主 src 输入，并检查单文件 5 MiB 限额。package-lock.json 固定安装树，build-dependencies.lock.json 固定八个公开包归档的版本、哈希及完整性。`plugins:blueprint:verify` 按 npm 发布文件规则打包公开依赖，在仓库外临时项目执行 `npm ci --ignore-scripts`、类型检查和构建，并检查依赖锁可迁移且构建输入未越出临时项目。本地插件构建仍可解析根 node_modules，只作为快速迭代。依赖不通过宿主私有别名、源码相对导入或修改 node_modules 获得。

同仓库不代表同安装包。electron-builder 已显式排除整个 plugins/，覆盖源码、dist、vendor 及构建缓存；配置门禁拒绝漏排除和显式重新包含。实际打包运行检查还拒绝 asar、smart-unpacked 和外置目录中的插件包。该保护不移除已经编入宿主 JavaScript 的蓝图业务，不能代替 main／renderer 依赖图清理或最终安装器的体积实测。共享依赖保留真实消费者，不承诺整个 Electron 或 Agent 基础体积都能减少。

## 单文件包与本地导入

用户已明确优先补齐安装接口，Release 上传与目录上线暂缓。本地交付使用一个自包含 .jxp 文件，包含签名发布描述和压缩资源；不要求用户同时选择 .release.json 或自行解压。发布工具保留描述文件作为目录生成输入，在线下载与本地导入使用相同 .jxp。普通 ZIP 未实现，不将 ZIP 改后缀视为合法包。

已安装页增加“导入插件包”。无路径 IPC 由主进程文件选择器选取，读取上限为原 70 MiB 归档加 32 KiB 描述和固定头；读取期间增长或缩短拒绝。取消不改变安装记录。导入验证包内签名、原归档哈希、内容摘要和宿主／SDK／平台兼容性，复用原子安装、停用后更新及上一版本回退；不启动页面／native／模型，不自动启用或授权。未知发布者或缺少 native signer allowlist 拒绝，损坏／不兼容包不替换已安装版本。开发目录入口不变。

新 jxp/2 用固定头、描述长度、签名 JSON 与原 gzip 归档封装。签名中的 packageFormat 绑定新封装，bytes／sha256 继续绑定内层压缩归档，避免自引用签名；目录下载预算和展示体积按外层总字节计算。在线安装同时核对包内描述与目录描述，不允许替换发布身份。旧 raw JXP 与配套签名目录仍兼容；本地导入只接受新自包含包，因此要求更新宿主。单文件导入实施时生产信任尚未配置；后续 10-26 本地交付已预置配套签名公钥及蓝图 native allowlist。运行中的开发 profile 未改动，Release 与目录未部署。

验证：分发／目录／配置草稿／独立 MCP 四文件 35 项通过，发布工具与本地递增签名构建两项 Node 测试通过。新增真实文件用例覆盖单包离线安装、同包在线下载的总字节预算、未知签名、损坏包／头长度／平台兼容拒绝、超限文件限量读取、停用后更新与回退，以及 native signer allowlist 和项目授权不被绕过。npm run test:blueprint:local -- --output artifacts/blueprint-import-local-results 一项完整桌面通过：真实主窗口导入按钮、取消保留原记录、损坏包不替换、拒绝页面自报路径、仅复制 .jxp 无 sidecar 导入、默认停用、授权及真实仓库 Notes 阅读、设置往返、退出后 MCP；文件选择仅在测试中替换原生对话框返回路径，生产仍调用原生 picker。npm run plugins:blueprint:check 通过，八个锁定归档独立构建，同一新封装包的签名 Electron 载体一项通过，runtime.status 为 passed。严格未使用项类型检查、修改文件 ESLint 与 i18n:check 通过；本轮两份 Note 无新增错误，全仓仍为 entrance-choreography.md 的两项既有错误。未更新依赖锁或执行远端发布。

## 从哪里发现、下载与安装

用户入口为“设置 → 插件”的“已安装”和“发现插件”。发现页首版只展示官方精选目录；蓝图显示用途、官方来源、下载体积、兼容平台／宿主版本、权限和安装状态。未安装时不占用日常蓝图入口，已安装后允许固定入口。开发目录和桥日志进入开发者区，正式安装不要求开发模式。

蓝图已从“创新功能”开关和宿主内置设置项移除，旧工作台切换器也不再提供内置蓝图按钮。市场卡片支持安装与卸载；授权启用后设置导航才出现插件声明的“Blueprint settings”并加载包内页面；仅安装未启用时不显示入口。停用或卸载移除入口和当前页面，卸载保留用户数据。旧设置快捷事件和旧蓝图工作台状态引导到插件管理，不自动下载。通用 location=settings 的接口、上下文、授权及遮挡边界归[首版插件契约](../workbench/plugin-contract-v1.md)，宿主没有按蓝图 ID 特判设置页面。

建议首版使用现有 GitHub 基础设施，无需先建设社区市场服务器：

| 内容 | 建议来源 | 发布规则 |
| --- | --- | --- |
| 目录源文件 | 本仓库 `plugins/catalog/` | 审阅后生成带版本、有效期和签名的目录元数据。 |
| 目录服务 | 拟发布至现有 GitHub Pages 站点的 `/plugins/index.json` | 此地址尚未上线；BP-3 核对站点部署与实际可达性。主程序只缓存小型元数据，不随目录刷新下载插件。 |
| 插件包 | 拟用独立分发仓库 `treex-x/JanusX-plugins` 的 GitHub Releases | release.json 已指向 blueprint-v1.0.0；仓库与资产尚未创建或验证。发布后不覆盖同版本资产。 |
| 用户侧安装位置 | 既有 `userData/janusx/plugins/` | 正式版本目录与开发来源、配置、数据、凭证、下载缓存分开；用户无需手动操作目录。 |

插件 Release 使用独立分发仓库，避免 electron-updater 读取应用仓库 Atom feed 时命中插件预发布。tag 命名或 latest 标志不足以证明隔离。生产发布前仍须验证实际目录、资产地址及应用更新结果。

正式目录至少绑定插件 ID、发布者、版本、包 URL、字节数、内容哈希、签名信息、SDK／宿主兼容范围、平台、必需能力和依赖。官方标识由宿主验证来源后生成，插件自行写 publisher 或名称不能获得标识。哈希只能证明与元数据一致；信任根、签名密钥保管／轮换、撤销、目录防回退和有效期策略须在发布前落地，不能把同源下载的裸 hash 当作身份验证。

安装按“用户选择 → 检查兼容与依赖 → 下载暂存 → 验签与内容校验 → 安全解包 → 原子登记 → 授权 → 激活”执行。限定压缩／解压体积和文件数，拒绝目录穿越、危险链接、大小写路径冲突及包外引用。依赖固定到经过验证的版本，检测缺失和循环；不自动运行 npm install、postinstall 或插件提供的安装脚本。

网络复用宿主代理设置，提供取消、进度与可重试错误。断网可管理和使用已安装兼容版本；过期目录不授权新的安装，刷新失败不自动停掉本地可用包。离线单文件包导入已接入同一校验链，不访问目录，不绕过正式来源验证。镜像若后续增加，沿用同一受信元数据和包身份。

更新先暂存新版本，保留旧版本和数据；有活动草稿／任务时延后切换或明确处理，权限扩大先重新授权。激活和数据迁移纳入同一可恢复流程，故障或断电后启动可以恢复到一致状态。代码回退不意味着覆盖用户新数据：迁移必须有旧版本可读策略或安全备份和冲突恢复，不能在用户继续编辑后盲目还原数据目录。缓存和旧包按预算清理，仍被桌面或外部 MCP 进程使用的版本不能删除。

## 扩展能力与蓝图拆分边界

采用“公开契约、明确能力、按作用域授权”的方式。每个新接口先定义输入输出、错误、版本、资源范围、取消及释放规则，再实现宿主和 SDK；不能靠调用内部 IPC 或扩大通用执行权限填补缺口。

| 能力 | 蓝图需求 | 设计约束 |
| --- | --- | --- |
| 工作台与导航 | 画布、模块浏览、详情、返回与布局恢复 | 使用稳定贡献 ID；宿主处理入口、遮挡和关闭，插件处理业务 UI；旧入口映射不保留第二套实现。 |
| Note 读取与受控写入 | 快照、分页、修改、审阅、撤销 | 受信 native 插件复用共享 Note 引擎和已有事务、并发检查及审批规则，插件不持有第二份正文真源。普通隔离插件仍没有该 native 权限。 |
| 变化订阅与 Git 上下文 | 当前建议刷新、分支／工作树变化、审阅调度 | 按真实 checkout、项目、插件和激活代次绑定；限制负载、订阅数与频率；丢事件可用版本快照补齐，迟到响应失效。 |
| 业务后台计算 | 图投影、建议组织、蓝图审阅策略 | 专属策略随插件交付；宿主保留通用任务监督。已有声明式任务不能覆盖的部分先做运行时试验，失败则继续拆分，不把整套蓝图后台永久内置后宣称已独立。 |
| Agent 与模型 | 维护讨论、审阅、变更提议 | 复用公共会话／模型／审批能力，限制工具范围、取消和预算；不能取得任意共享会话或原始凭证。对话嵌入所需接口仍是待实现能力。 |
| 配置与数据 | 应用默认、项目覆盖、建议状态和布局 | 普通参数、业务数据、凭证分别存储；保留草稿、版本冲突、迁移与撤销。 |
| 独立 Note MCP | 外部终端读写 Note、处理建议 | 保留桌面关闭仍可使用、全局注册和逐次明确项目定位的既有契约，不能改成必须调用运行中的桌面 IPC。 |

当前采用隔离 WebContentsView 加受信官方 native utilityProcess。UI 无 Node／完整宿主桥，后台具有当前用户的真实 OS 权限，不能称为文件或网络强制沙箱。宿主要求受验证 official 包、单独 signer allowlist 和明确 native 授权；linked／copied 来源不开放 native。启动清理偶然继承的环境密钥，双向 RPC 限负载、时长、代次和取消，页面关闭释放该页面任务与监听，停用停止自有进程。Windows Electron 已有独立进程、SQLite、宿主回调、取消、退出与崩溃试验；其它平台未验收。

Agent 与模型复用宿主引擎，原始凭据留在宿主。native Agent 仅注册只读工具、独立会话，限制并发、启动频率和轮数。修复先只读完整取证并生成带 expectedHash 的返回稿，再由用户选择的修复操作经过原 NoteRepairService 事务落盘和复审；讨论不允许写入，失败不自动重放已尝试的提交。

Note MCP 的 Node 入口与桌面隔离页面属于不同载体。建议使用稳定启动入口解析本地已验证、兼容的插件版本，保持桌面关闭时可独立启动；不在调用时静默下载或修改工作流。未安装时返回可操作提示。安装、更新、卸载需识别仍在使用旧版本的 MCP 进程，不强杀用户终端或删除使用中的包。用户选择移除客户端配置时只移除 Janus 管理的条目，保留其它 MCP 配置；具体启动器和运行时复用由 BP-1 验证。[既有 Note MCP 契约](../blueprint/note-mcp.md)的工作区定位与既有权限规则不改成桌面项目白名单。

## 生命周期、数据与兼容性

分开记录安装状态、授权状态、启用状态与运行状态。运行状态至少能区分未激活、运行中、暂停和故障，不以“安装成功”代替“运行可用”。初次安装按用户操作激活；重启只恢复仍兼容且授权有效的启用包。

每次激活持有可释放的资源集合：页面、任务、订阅、监听、计时器、请求和自有进程。停用、卸载、项目失效、窗口崩溃及应用退出都走幂等释放路径；超过取消时限的自有计算可终止，但不能终止宿主共享会话或撤销已经提交的文件变更。控制重试次数和错误熔断，提供用户可读错误及脱敏诊断。

SDK 采用版本范围与能力探测；必需能力缺失拒绝激活，可选能力明确降级。插件依赖解析、数据 schema、事件版本与运行时协议分别版本化，新增字段不破坏旧消费方。稳定版与试验能力分开，宿主升级／降级前后验证已安装插件，显示不兼容原因并提供兼容版本选择，不只在首次安装校验。

升级现有用户时保留 Notes 身份、正文、建议、设置和布局，建立可重复执行且有版本检查的迁移。旧蓝图入口说明需要安装官方插件，保留后续安装时可恢复的数据；未经选择不后台下载，也不静默启用模型审阅。未安装场景的空态和旧布局恢复必须可用。缺少插件不影响普通终端、文件、Git、Agent 或共享 Note 引擎的既有消费者。

## 顺序工作包

各项由主 Agent 顺序推进；编号是工作包，不是 Task。BP-0 已有依赖清单，资源基线待补；BP-1 已有 native／MCP 真实进程验证，完整场景待补；BP-2 已迁移后台、接入独立 UI 并通过仓库外构建，宿主清理与完整功能验收待续；BP-3／BP-4 已实现本地分发及管理流程，生产发布待续；BP-5 已增加插件树排除和旧数据导入，宿主旧业务与最终包迁移仍未验收；BP-6 未验收。P8 分发与蓝图迁移保持独立验收，Mermaid 案例不构成蓝图通过的证据。

| 工作包 | 依赖 | 主要交付与代码责任 | 交付出口 |
| --- | --- | --- | --- |
| BP-0 依赖与行为基线 | 无 | 盘点 UI、store、IPC、Note／Agent、审阅、维护、MCP、数据目录和构建依赖；记录冷启动、安装体积和资源基线；列出现有未验收行为。 | 每项消费者有保留／迁移／废弃说明，明确完整功能矩阵和首发 Windows 范围；绑定 AC-20／26。 |
| BP-1 接口与运行方式试验 | BP-0 | SDK／宿主接口设计；验证“读 Note → 提议变更 → 原有受控提交 → 订阅刷新”、后台取消以及桌面关闭后的 MCP 调用；解决 UI 对话嵌入和任意后台逻辑缺口。 | 固定运行模式、权限、兼容和数据契约；崩溃、切项目、撤权、延迟输出有真实载体证据；绑定 AC-22／25。失败不进入完整迁移。 |
| BP-2 独立包与迁移 | BP-1 | 建立 `plugins/blueprint/`；按浏览／导航、维护、审阅与建议、MCP 顺序搬迁；宿主只保留通用服务及必要的旧入口兼容适配。 | 仓库外独立构建与本地导入，全功能矩阵有结果；共享引擎不复制、不 patch node_modules；绑定 AC-20／23／25。 |
| BP-3 官方发布与安装更新 | BP-1、BP-2 的可构建包 | 发布目录、签名、CI、资产、下载暂存、安全解包、版本登记、取消恢复、更新回退；更新器独立性和可达性验证。 | 从真实测试发布源安装到干净用户目录，故障注入和应用更新回归通过；绑定 AC-17／21／24。未通过前不发布稳定目录。 |
| BP-4 插件中心与设置 | BP-3 | 已安装／发现页、详情与权限说明、启停／设置／更新入口；开发工具收纳；修复配置切作用域丢草稿、页底确认不可见的问题。 | 新用户无需开发模式完成下载安装，键盘焦点、错误恢复和未保存草稿场景通过；绑定 AC-18／21／23。 |
| BP-5 主包瘦身与旧用户升级 | BP-2、BP-3、BP-4 | 调整应用构建／打包依赖，移除蓝图专属业务入口与资源，迁移原设置、状态与稳定 MCP 启动路径，保留按需安装提示。 | 对比 asar／外置资源，未安装无蓝图自有后台活动；旧版本数据和卸载／重装验证通过；绑定 AC-20／23／25／26。 |
| BP-6 发布候选与故障演练 | BP-5 | 真实安装器／便携包、干净账户、旧用户数据副本、断网与损坏包、宿主／插件版本矩阵、性能和长时间生命周期回归。 | 按 AC-20–26 保存可复现证据及未覆盖项；稳定目录只收录实际支持平台，严重数据／隔离／更新缺陷阻断发布。 |

不承诺固定工期；BP-0／BP-1 完成后根据后台运行时和共享依赖缺口估算。该工作不要求先完成 P7 所有个性化能力，也不要求所有官方功能同时拆包。外部仓库如需改共享接口，记录其待交付依赖和消费验证，不能只更新本仓库便宣称跨仓库完成。

## 发布前的验证矩阵

“保障不会出现 bug”不能成为可信承诺。目标是提前发现已知缺陷、限制故障影响，并让更新和用户数据可以恢复。类型检查、源码单测、组件测试、真实 Electron、安装产物验证各自承担不同证据，不互相替代。

| 风险 | 必测情形 | 阻断发布的结果 |
| --- | --- | --- |
| 包边界失效 | 仓库外构建、禁用宿主源码别名、扫描应用产物、未安装冷启动 | 偷用私有代码、主包残留蓝图专属模块、未安装仍起业务监听。 |
| 下载安装损坏 | 断网、取消、磁盘满、断电恢复、并发安装、损坏签名、解包越界、超额包 | 执行未验证内容、覆盖旧可用包、登记半安装状态。 |
| 版本与权限漂移 | 宿主升级／降级、旧 SDK、新必需能力、依赖循环、权限扩大 | 不兼容包执行、静默扩大授权、插件 Release 干扰主程序更新。 |
| 资源和异步串用 | 连续启停／切项目／切 worktree、崩溃、超时、迟到模型返回 | 资源持续增长、跨项目写入、停用后启动新任务、共享会话被结束。 |
| 数据丢失 | 未保存草稿、外部并发编辑、重复迁移、迁移中断、更新回退、卸载重装 | Notes 身份／正文被误改、草稿消失、配置覆盖、回退覆盖用户新数据。 |
| 独立 MCP 回归 | 桌面关闭、客户端全局配置、项目切换、插件升级／缺失、旧进程使用中卸载 | 要求桌面在线、定位到错误项目、破坏其它配置、删除使用中的包。 |
| UI 与资源收益 | 无插件／已安装停用／启用三态，真实安装器和便携包，正常使用流程 | 功能矩阵退化无说明，实测主包未排除专属资源或停用未释放自有资源。 |

`verify` 与 Windows PR workflow 已接入 `plugins:check`、`plugins:distribution:check` 和 `plugins:blueprint:check`。最后一项先执行仓库外构建，再将同一个临时项目通过 JANUS_BLUEPRINT_PACKAGE 交给真实 Electron 签名安装及页面回归；独立 Playwright 配置不启动无关的 Island Vite 服务。artifacts/plugins/blueprint-build.json 记录公开依赖、锁和产物哈希及 runtime 成败，CI 上传该目录。稳定发布仍须记录宿主和插件源修订、包哈希、数据 schema、平台及性能实测，不把确定性供应商或 Windows 开发载体扩大为生产及全部平台已验证。

## 已实现的保护与实际验证

分发采用 Ed25519 精确 payload 验签、目录序号／有效期／防回退、安装前刷新和 HTTPS 限额下载，网络复用宿主代理；归档拒绝路径穿越、链接、Windows 保留名和超额内容。版本采用 UUID 包目录与原子 registry，更新与回退要求停用，native dataVersion 不同且无已实现迁移时拒绝切换。旧包清理预算为 512 MiB，并保留当前／回退版本及所有存活 MCP lease。SQLite 事务锁协调安装和独立客户端；仍存活的历史代次也阻止删除共享数据。显式删除同时覆盖 KV 与 native 数据目录，项目 Notes 不在删除范围。

稳定 plugin-mcp 启动器解析已安装、已签名、已授权的 MCP 贡献，note-mcp 保留兼容入口；不在调用时下载。MCP 客户端注册、检测、移除和真实握手迁入插件。独立启动不需要桌面在线，外部客户端逐次指定工作区，不能强杀仍使用旧包的用户终端。

维护章节撤销改为记录真实原文的 H2 基线，正确区分新增章节与原有章节；部分选择、多次修改同文件、撤销与再次撤销均不从瘦身投影猜正文。原理及证据归[文件审批决策](../blueprint/maintenance/blueprint-maintenance-approval-gap.md)。

旧数据导入在桌面和独立 MCP 打开存储前执行，用 SQLite 跨进程锁及逐目录收据恢复中断。已覆盖旧设置、已读、Git 审核状态、修复记录、当前建议 WAL 一致性快照、维护审计和旧蓝图；保留原文件及插件新数据，自动审核在导入时关闭。JEV 凭据由宿主加密存储导入，保留密文原件，不覆盖用户新值；显式删除私有数据后重装不再次导入旧数据。布局继续读取项目 .agents/.local/ui/project.json。此范围不代表所有历史版本数据均已验收。

真实页面快速操作曾触发宿主 30 次／秒的请求上限，使审核失败并留下正文加载态。插件现为自身使用的 SDK 请求共享有界队列：启动间隔 60 ms、最多 8 个在途和 64 个排队，排队可取消，不自动重试已提交的操作。宿主权限、次数及并发限制未放宽。代价是突发操作需等待队列，满额时保留显式错误；后续新增 SDK 调用也须纳入此预算。

本地 Windows、Node 24.15.0 的机器证据：`plugins:check` 19 文件 337 项；`plugins:distribution:check` 1 项发布工具测试及 28 项单元；native／旧数据导入／独立 MCP 定向 38 项；维护章节、路由、凭据及包边界 51 项；请求预算 3 项均通过。宿主和插件 typecheck、`build:check` 通过。仓库外构建和真实载体覆盖草稿冲突、切换语言、批量已读／撤销、审核、源文件交接、流式讨论、终端简报、确认应用／撤销；生产供应商、完整旧 UI 矩阵及安装器尚未验收。

CI 配置已接入，不表示远端运行通过。当前 workflow 固定 janus-agentX 8baa18e5db8ca641871c139a5b76904bedc88dda，本地来源 HEAD 为 25397cad9cb898973e84492ecfe50599201e902c 且有未提交改动；锁验证只能证明本地公开归档字节与当前锁一致。共享仓库需先完成所属变更并固定可消费修订，再核对干净 CI 的归档锁；不能用关闭哈希检查或随意重生成锁掩盖来源漂移。本次没有改写共享仓库及其未提交工作。

### 设置安装生命周期验证

Windows 本地验证覆盖安装后导航、授权启用、停用提示、卸载撤页与资源释放，官方生产下载仍未交付。新增 AC-27 记录本次用户要求并保持未签收；AC-20–26 的完整迁移／发布出口不变。

| 路径与命令 | 实际证据与范围 |
| --- | --- |
| `npx vitest run` 定向插件设置、SDK、注册、运行时、配置、目录、分发与外壳回归 | 14 文件 190 项通过；命令及结果见 artifacts/plugins/settings-unit.log、settings-regression.log，覆盖必需能力、应用／单实例限制、声明变更重新授权和安装状态导航。 |
| `npx playwright test tests/e2e/plugin-settings.spec.ts tests/e2e/settings-layout.spec.ts --project=island --workers=1` | 10 项通过。市场数据明确为隔离合成 fixture，只证明真实设置组件的安装／卸载导航、无蓝图创新开关及布局回归，不证明下载或签名。 |
| `npx playwright test tests/e2e/desktop-plugins.spec.ts --project=desktop --workers=1 --grep 'installed settings pages follow'` | 1 项通过，使用 artifacts/build-check/main/index.js、临时本地插件和用户目录；覆盖真实原生设置页边界、保存重开、重复导航、普通／减少动画、通知叠加遮挡、停用／启用及当前页卸载。 |
| `npm run plugins:blueprint:check` | 锁定公开归档在仓库外构建，再对同产物完成 1 项真实 Electron 签名安装／重装回归；额外打开蓝图 application settings 入口，确认没有项目工作台、设置可保存并重开恢复。临时签名与确定性模型响应不代表生产服务；收据为 artifacts/plugins/blueprint-build.json。 |
| SDK 依赖锁复核 | 与前次独立构建包逐项比较，八个公开归档中仅 SDK 变化，package-lock 也仅 SDK 条目变化；其它共享包未改写，详见 artifacts/plugins/settings-dependency-lock-review.json。 |

严格未用类型检查、`build:check`、修改宿主文件 ESLint 和 `i18n:check` 通过。全仓 Note 门禁仍只有 entrance-choreography.md 的两项既有错误（缺 AC、更新时间早于创建）；本次维护的八份 Note 单独核验通过，收据为 artifacts/plugins/settings-note-review.json。Playwright 在本进程对 localhost 直连，隔离代理影响；没有改变用户全局代理或生产信任配置。

## 剩余交付出口

| 范围 | 未完成或未验收内容 |
| --- | --- |
| 功能一致性 | 已补模块范围／选择／视口历史、跨模块定位、未归属入口和意见提示；关系与来源呈现、完整维护范围、错误恢复及全部旧 UI 仍需矩阵核对。设置自动保存已补，自动连接检测、对话模型独立选择及其余设置交互仍未对齐。 |
| 设置与数据 | 配置并发、页面草稿、旧状态和凭据导入已有定向证据；历史版本矩阵、真实旧用户副本、升级与回退冲突待验收。 |
| 包边界 | 主进程兼容 CRUD、投影、迁移／圆桌共用的作者工具仍待剥离；未安装冷启动和真实安装器需做完整资源测量。旧分析器及 review／suggestions／maintenance 运行时已退出宿主启动，渲染入口旧 store／画布已脱离。 |
| 发布 | 配置真实密钥／allowlist、目录服务、独立分发仓库及 workflow；目前无真实下载源或发布资产。 |
| 验收 | 安装器／便携包、升级迁移、故障演练、主包大小与资源测量、宿主／插件版本矩阵；原蓝图真实 JEV 与客户端兼容缺口继续保留。 |

未创建远端仓库／Release，未修改用户真实模型、自动审核开关或客户端全局配置。定向测试使用临时项目、临时签名密钥及确定性供应商响应，不代表生产供应商质量或完整功能已发布。

src/main/harness/service.ts 已直接继承共享 NoteService，不再转导出插件服务。共享服务只保留冷读合并、稳定预热，以及供桌面适配使用的索引和证据覆盖读取。图投影、组合与布局状态集中在插件 projection.ts；旧桌面入口通过 src/main/blueprint/note-service.ts 的显式适配复用原 harnessNoteService，维护写入仍委托同一事务实例。插件自身服务接入同一投影实现，不复制图映射或共享引擎。兼容消费者仍会打包蓝图代码，完整应用尚未完成拆分。

服务拆分验证命令：`npx vitest run tests/unit/shared-note-service.test.ts tests/unit/harness-bundle-load.test.ts tests/unit/harness-service.test.ts tests/unit/harness-share-import.test.ts tests/unit/harness-undo.test.ts tests/unit/harness-run-handlers.test.ts tests/unit/harness-ipc-contract.test.ts tests/unit/blueprint-maintenance-harness-routing.test.ts tests/unit/blueprint-composition.test.ts tests/unit/blueprint-workspace-init.test.ts tests/unit/note-read-snapshot.test.ts tests/unit/note-watch-startup.test.ts tests/unit/note-chat.test.ts tests/unit/note-repair.test.ts tests/unit/maintenance-harness-apply.test.ts --maxWorkers=1 --minWorkers=1`，15 文件 172 项通过。新增真实文件用例验证同一索引、稳定版本、并发冲突与失败重试；开发／生产服务产物加载同时拒绝模块图中的蓝图输入。

消费方回归命令：`npx vitest run tests/unit/harness-execution-adapter.test.ts tests/unit/harness-s9-acceptance.test.ts tests/unit/roundtable-artifact-bundle.test.ts tests/unit/task-contract-adoption.test.ts tests/unit/workflowx-v2.test.ts tests/unit/blueprint-maintenance-discussion.test.ts tests/unit/blueprint-store.test.ts tests/unit/blueprint-native.test.ts tests/unit/harness-note-index-patch.test.ts tests/unit/note-focus.test.ts --maxWorkers=1 --minWorkers=1`，10 文件 65 项通过。`npm run typecheck`、`npm run typecheck:strict-unused`、插件独立 typecheck、`npm run build:check` 及修改宿主文件的 ESLint 通过。修改后的 `npm run plugins:blueprint:check` 从锁定公开归档完成仓库外构建，同一包的签名安装与真实 Electron 页面用例通过，收据为 artifacts/plugins/blueprint-build.json；它继续只覆盖已列代表流程。

全仓 `npm run check:notes` 未通过：未改动的 workbench/requirements/entrance-choreography.md 缺少 AC 条款且 updated 早于 created。本次维护的三份 Note 单独核验；保留全仓失败，不修改无关需求或放宽校验。`plugins:audit-blueprint` 当前报告 92 个候选文件、41 个宿主消费者和 76 条入边，新增显式兼容入口也计入清单；这些数量不构成包体积或迁移完成度指标。

### 宿主启动与普通聊天隔离

主进程不再装配旧 BlueprintReviewRuntime、建议 MCP 工具或 BlueprintMaintenanceService，普通聊天也不再加载修复／维护工具及其专属 turn。旧 review IPC、maintenance IPC 与聊天的 noteRepairId／maintenanceTaskId 在业务或模型启动前返回 BLUEPRINT_PLUGIN_REQUIRED。旧审计导入改用纯读取函数，保留历史数据迁移，不实例化维护服务；共享 Note 工具与索引预热仍属于宿主。

工作区启动不再预载蓝图投影，Note 变更事件不主动刷新旧蓝图。Island 不订阅旧维护或蓝图 store，继续显示宿主运行状态和插件 Island 贡献；旧维护／蓝图动作和恢复的旧工作台状态打开插件管理。副黑板列出已启用插件并经通用导航打开其原有槽位，收板不创建第二份插件页面；项目视图必须先选项目。容器手势、拖高与 Esc 保留，取舍见[副黑板决策](../workbench/island-blackboard.md)。

普通聊天保留共享 Note working set、证据、变更卡与撤销。证据链接通过 noteRead 定位原文并打开宿主编辑器，不依赖蓝图画布；来源不可读时显示错误，可重试。旧宿主聊天中的修复与整理方法只打开插件管理，插件自己的 Agent 讨论和事务继续由下载包执行。圆桌父文档选择改用 noteSnapshot，应用后刷新共享索引，不再加载旧蓝图 store 或投影。

| 验证入口 | 本轮实测与边界 |
| --- | --- |
| `tests/unit/blueprint-host-boundary.test.ts` | esbuild 遍历真实 main.ts 与 renderer main.tsx 的依赖图；2 项通过。主图拒绝 review／suggestions／maintenance 运行时，渲染图拒绝旧蓝图 store、服务及画布工作台，确认共享 Note 与工作区启动入口保留。它不拒绝全部插件目录输入，不代表主包已清空蓝图代码。 |
| `artifacts/plugins/host-detach-unit.log` | 8 文件 90 项通过：上述边界、review／Janus／harness IPC、普通聊天 turn guard、插件 native 及维护事务路由。旧调用明确拒绝，并验证释放 turn 后同会话能继续普通聊天。 |
| `artifacts/plugins/host-detach-chat-regression.log` | 10 文件 100 项通过，覆盖聊天持久化／上下文、timeline、共享 Note 读写与撤销、focus、圆桌产物、插件命令和 Island 通知。 |
| `tests/e2e/blackboard-plugins.spec.ts` | 真实黑板、Titlebar 与启动 hook 的 5 项浏览器用例通过；合成扩展验证入口及单实例，不证明生产下载。共享 Note 原文失败与重试、未安装不调用旧投影、旧布局恢复、停用撤入口、下拉开合和下缘回收均有证据。 |
| `artifacts/plugins/host-detach-browser.log`、`host-detach-gesture.log` | 首轮新增 4 项入口、4 项 memo 选择与 steering、1 项圆桌辅助岛通过；手势用例补齐过渡落定等待后单独通过。初次完整 Island 回归另有三项既有失败，已通过保存的修改前源码复现；辅助岛几何断言初次失败，修改前与当前单独复跑均通过，不标记完整套件全绿。 |
| `npm run plugins:blueprint:check` | 锁定公开依赖在仓库外构建，再用同包完成 1 项真实 Electron 签名安装、草稿、文件应用／撤销及重装；收据 artifacts/plugins/blueprint-build.json，日志 host-detach-blueprint-check.log。仍是临时签名及确定性供应商。 |

宿主严格未用类型检查、插件独立 typecheck、build:check、修改宿主文件 ESLint 与 i18n:check 通过。全仓 Note 门禁仍因未改动的 entrance-choreography.md 缺 AC 及 updated 早于 created 失败；本轮维护文件单独核验。`plugins:audit-blueprint` 现在报告 92 个候选文件、29 个宿主消费者和 46 条入边，包含保守类型边；数量只帮助定位依赖，不能换算迁移百分比或包体积。

### 本地使用与交互补齐

旧 analyzer 已退出主进程依赖图；Git 状态／日志／提交、终端退出、节点创建／设焦点／绑定终端均不再调度旧分析。兼容 CRUD 和历史分析采纳仍保留，旧手动分析明确返回 BLUEPRINT_PLUGIN_REQUIRED，不静默替用户启用插件。

插件设置取消保存按钮，文本改动合并 350ms 后串行写入，开关立即排入提交。每次带预期 revision；冲突或草稿落盘失败后暂停自动提交并保留输入，需显式重新载入。校验失败不生效，保存成功不表示连接检测通过。恢复原设计后，首次载入、有效配置保存及提供方刷新后延迟 800ms 检测；修改或关闭取消过时结果，仍保留手动重新检测。自动审核仅在生成连接可用时允许从关闭转为开启，检测不会自行启用自动审核。工作台隐藏设置时不挂载该页面，避免浏览 Notes 时触发连接探测。

模块浏览统一为默认入口，单击预览、双击或进入按钮切换范围；历史同时记录选中对象、模块和视口。画布关闭默认双击缩放，恢复历史时不再用初始自动适配覆盖已保存视口。搜索及关系定位使用模块归属，未归属文档有独立入口；模块／文件采用文件夹／文档图标与 8px／4px 圆角，意见使用静态提示灯、不显示数量，点击只定位当前建议，不调用审核。这里只补代表交互，不签收完整视觉、来源及关联阅读矩阵。

| 验证 | 实际范围 |
| --- | --- |
| `npm run test:blueprint:local` | 完整桌面 1 项通过：隔离 profile／知识库、本地签名包默认停用、真实设置页授权及自动保存、工具箱打开完整仓库 Notes 副本、全屏覆盖主标题栏、诊断弹层不推动画布、左右卡片及设置返回后节点可见，桌面退出后同配置的独立 MCP 读取。无模型调用；超 4MiB 图响应另有真实 native 回归。 |
| `node --test tests/plugins/blueprint-development.test.mjs` | 1 项通过：连续构建版本递增、签名及解包验证、数据与原 manifest 保留，生产 trust 不改写。 |
| `tests/unit/blueprint-plugin-navigation.test.ts` | 5 项通过，包含 Chromium 实际卡片操作：嵌套模块、选择／缩放恢复、前进后退、跨模块定位、未归属入口、静态意见灯及相同尺寸的图数据刷新后节点可见。与 settings-ui 3 项、plugin-surfaces 6 项组成的本轮 14 项定向回归通过。 |
| 定向单元与集成回归 | `npx vitest run` 对 navigation、settings-autosave、janus-ipc-contract、host-boundary、native、maintenance-harness-routing、maintenance-sections、request-budget、plugin-mcp-launcher 九份文件执行，70 项通过。设置覆盖写入期间的无效输入、串行 revision、冲突停止与关闭取消；其余覆盖真实 native、受控文件事务与独立 MCP 生命周期。 |
| `npm run plugins:blueprint:check` | 锁定八个公开依赖在仓库外构建，再由同产物通过 1 项签名 Electron 回归；自动保存、并发冲突、讨论、写入／撤销、卸载重装均覆盖。收据 artifacts/plugins/blueprint-build.json。未重生成依赖锁，来源修订风险继续保留。 |

宿主 `typecheck:strict-unused`、插件独立 typecheck、`build:check` 及本轮修改宿主文件 ESLint 通过。全仓 Note 检查为 312 篇、2 错误，仍只来自未修改的 entrance-choreography.md；本轮五份 Note 无新增错误。没有提交混合工作区或执行远端发布。

剩余主包清理优先处理 janus-handlers 的兼容 CRUD、harness projectGraph 的兼容投影，以及迁移和圆桌仍使用的作者工具。随后补真实安装器／便携包、无插件冷启动、资源基线、完整旧功能与版本矩阵。正式签名与目录发布继续单列；AC-20–27 不因本轮定向通过而签收。

## 10-26 本地交付签名

用户授权提交当前版本并交付 Windows x64 安装器与独立蓝图包。主程序版本保持 0.9.4，交付目录为 release/2026-10-26；蓝图版本为 1.0.0。正常宿主预置 janusx-blueprint-20261026 的 Ed25519 公钥，native allowlist 只授权 official.blueprint。公钥 PEM 的 SHA-256 为 c2f30435d698a9f067a45b26f2b227fad3ba49c522f0a966ca7ac6d8fdcc141f；私钥保存在忽略的 .cache/delivery-signing，后续同发布身份签名需保留该文件，不进入 Git、安装器或插件。

插件来自 artifacts/plugins/blueprint-build.json 所指仓库外独立构建，沿用八个锁定公开依赖及已通过的同产物载体验证。实际正常打包桌面已验证无预装蓝图、单个 .jxp 原生入口导入、默认停用、授权启用、设置页面、真实仓库 Notes 与节点渲染；仅文件选择器在测试中返回指定路径。收据与截图在 artifacts/delivery-2026-10-26，未修改运行中的开发 profile，未上传 Release 或部署目录。

最终安装器的仓库外模块图、LLM runtime 及可见 GUI 检查通过，包体积预算通过。单元测试全量仍有失败，明细归[可复现验证](../desktop/reproducible-verification.md#october-26-delivery-checks)，不据本地交付将完整功能或远端分发验收标记完成。
