---
{
  "schema": "harness-note/2",
  "id": "6e9c114d-2b74-40b4-9dbf-a24163328e61",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-04",
  "class": "architecture",
  "tags": ["memory","persona","right-dock","ui"],
  "updated": "2026-10-25T05:40:28.892Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf"
}
---

# 右侧助手合并入口与个人画像完整布局

## Problem

工程知识检索、个人画像与审核属于连续的查看和更正流程，分别占据右侧入口会增加寻找成本。个人工作台复用窄侧栏单列布局时，展开文字不能充分利用宽屏，也缺少分类、搜索与完整来源阅读层级。

工程与个人使用不同工作台外壳时，领域切换会改变导航位置、卡片边界与内容起点。工程入口内的“全部／工程知识”筛选重复顶层领域选择；审核使用侧栏分隔线样式时，不能形成与完整画像一致的卡片布局。

现有领域授权与保留期语义由[领域控制决策](./memory-domain-controls.md)维护，界面合并不能改变它们。

## Decision

右侧仅注册文件、Git、助手、会话四类工具。助手内部提供工程知识、个人画像、待审核，关闭某域后仅显示仍启用领域的内容与审核；双域关闭隐藏入口。无工作区时个人功能仍可使用。旧 persona/review 调用转为助手的对应分区，旧打开集合规范化为一个助手；启动仍遵守既有仅恢复宽度、保持栏关闭的规则。

助手图标显示启用领域中需要人工审核的候选数量，排除后台当前正在排队或执行的自动审核候选。首次挂载、窗口获得焦点、审核完成及可见页面每十五秒刷新；候选或自动状态读取失败时数量未知，不伪装为零条。审核仍复用 MemoryReviewTool，保留来源、快照校验及人工确认语义。个人更正完成后按当前承载界面打开审核，完整工作台不会意外跳到侧栏。

工程知识与个人画像共用 KnowledgeWorkbench 外壳、领域导航、状态栏、左侧导航和关闭动效。状态栏保留相同最小高度，领域切换保持内容起点。个人资料、已确认、待确认、近期记忆分类位于卡片区顶部，完整视图铺满剩余区域。中央网格按空间排列卡片，详情按需展示完整文字、来源、更新时间或到期信息，以及编辑、更正、遗忘操作。窄屏详情占用内容区，通过返回按钮恢复列表。长期确认记忆与近期记录的语义独立，来源编号放在详情折叠区。

MemorySurface.module.css 提供两域共同的卡片边框、圆角、内边距、主题底色及自适应网格。摘要卡片保持 216px 高度；审核卡片为完整操作内容自适应高度，避免裁掉证据与确认控件。完整个人审核使用网格，侧栏审核保持单列。工程审核详情与个人审核复用 MemoryReviewCard，沿用快照和冲突校验。工程工作台直接限定工程候选，不显示重复领域筛选；统一助手内的跨领域审核仍保留必要的领域筛选。

领域和页签切换使用 180ms 内容过渡，实际数据读取显示 CardSkeleton；减少动态效果偏好禁用新增过渡。工程刷新通过请求代次丢弃过期响应，返回时按当前页签选择记录，避免跨领域切换或异步加载覆盖新视图。切换动画不增加人为等待时间。

侧栏保留摘要，完整工作台使用 PersonalMemoryBoard；两者复用 UserPersonaTool 的读取与写操作。共享导航状态使助手打开工作台时落到相应领域。个人设置继续复用独立设置面板，工程模型配置不混入个人卡片。

工程知识和个人画像均在工作台内提供“功能设置”，分别复用 KnowledgeSettingsPanel 与 PersonalMemorySettingsPanel，避免另建一套设置状态。工程设置页不依赖知识快照读取成功，已有知识内容读取失败时仍可调整配置；打开设置时收起记录详情。

右侧助手画像使用资料摘要卡、偏好标签及记忆分组。已确认记忆默认展开，未确认和近期记忆按需展开；来源折叠但完整保留，更正与遗忘按钮继续使用内容哈希。助手分区、画像阅读与编辑切换复用 MemorySurface 的短过渡及减少动态效果规则。资料编辑器按身份、表达偏好、工具偏好分区，正文独立滚动，保存与关闭固定在底部；初次读取显示骨架，快照过期、失败重试、清空覆盖与显式遗忘语义保持独立。

待审核卡片突出范围、正文、来源入口和审核动作，使用两域共用卡片表面；用途说明置于来源详情。评分、精炼与旧记录导入收进“更多操作”，降低窄侧栏的按钮密度。冲突检查、旧值展示和替换确认仍直接可见，不因视觉精简跳过确认或降低审核条件。

自动处理区分别显示配置模式和当前活动：未开启、已开启、部分自动与审核待配置，以及等待新资料、排队、当前执行环节和等待人工处理。颜色与文字共同表达状态，执行图标遵守减少动态效果偏好。环节详情区分自动、人工、配置未完整和规则提取；关闭可选的模型辅助提取保留自动规则提取，不使整体降为部分自动。配置模式表示选项完整性，不证明模型服务可达。

主进程的 automationStatus 使用自动调度相同的当前计划、来源版本、配置哈希与历史资料范围，返回 stages 和 queue；读取不写处理任务或触发模型。queue 包含全部当前有效工作，历史 tasks 仅展示最近 200 项，counts 保留历史任务统计。来源撤回、已处理内容和旧配置任务不冒充当前待办；同一候选的新配置或新依赖以当前计划为准。历史任务数不等于入库条数。

MemoryReviewTool 将候选分成“需要你审核”和默认折叠的“自动处理中”，后者提供正文、来源和排队／执行状态。个人记忆始终人工确认；工程条目与受管理 Wiki 只有匹配当前自动计划时进入自动组，人工环节、冲突、失败、历史范围外的内容及图谱候选留在人工列表。范围筛选数量表示该领域全部候选，分组标题与助手角标使用人工候选数量。切换到个人记忆隐藏工程自动化区域，显示个人确认说明。自动状态读取失败时恢复展示全部候选并标为待确认内容，避免隐藏待审资料；候选读取或提交失败仍禁用旧列表操作。

调度由主进程在启动、队列处理后及约每 60 秒触发；界面每五秒读取状态。手动“立即运行一次”位于“更多操作”，仅提前执行一次既有队列流程，不修改开关或替代后台调度；运行中、状态读取失败和未启用时禁用该操作，设置页仍允许保存配置后触发。自动处理区与审核列表之间保留 14px 外间距、12px 内留白及主题分隔线。

工作台左侧“功能设置”统一承载工程配置；顶部自动处理卡片通过 `showSettingsEntry={false}` 隐藏设置按钮，未开启或审核待配置时的文字提示指向左侧入口。顶部继续显示状态、处理环节和任务记录。右侧助手复用同一组件，默认保留未开启、部分自动或审核待配置时的设置快捷按钮，通过标题栏打开知识设置。设置页内的自动处理组件使用保存回调，不展示设置快捷按钮。

设置页面按功能使用有边框、内边距、标题分隔和主题背景的卡片。知识库分为采集、自动处理与 MCP 接入，自动处理内部的四环节和连接配置有独立边界。个人设置分为记忆积累、对话使用和近期记忆保留三张卡片，保留即时保存与原有开关语义。卡片共享 KnowledgeSettingsPanel.module.css，完整工作台中的个人设置也使用同一布局。

设置导航按应用设置、知识与记忆、模型与用量、代理与协作分组，组内统一使用图标、标题和选中指示；条目为单行索引，不带说明副行，页面说明由内容区标题下的副标题承担。个人画像按创新开关显示，关闭时隐藏空分组；正在查看时关闭则回到通用设置。工程知识与蓝图不再内置为设置项，改由[官方插件安装状态](../planning/blueprint-official-plugin.md)生成独立插件设置分组，卸载撤下当前页并回到插件管理。模型配置、模型目录与用量处于同组。桌面导航独立纵向滚动，窄窗口保留组名与分隔并横向滚动，键盘聚焦可到达末尾项目。

知识工作台两域的左侧导航与设置导航共用交互规范：未选中使用弱化文字，悬停显示浅底色，选中使用主题底色、正文色及左侧 2px 强调条，选中项悬停保持选中状态。键盘焦点使用向内 1px 描边，颜色和背景以 160ms 过渡；planche 使用纸面底色和朱红强调条。工作台保留单行导航与数量角标，窄窗口横向滚动仍使用同一组选中和焦点样式。

导航滚动条在 Chromium 中使用明确的 4px 宽高、透明轨道与圆角滑块，颜色由 shell-muted 混合透明度生成，悬停时提高可见度。scrollbar-width 保持 auto，让 WebKit 伪元素的尺寸生效；设置 thin 会优先使用浏览器预设，无法保证四像素。

创新功能入口在统一分组中仅保留星光图标与强调色文字“实验”徽标，深色使用琥珀色，planche 使用主题强调色，不做整行边框或渐变色块。该标识用于区分实验能力；选择其他页面后仍可见，不使用持续闪烁动画。

创新功能当前六项开关的开启和关闭均先展示确认框，确认后才调用保存接口。弹窗展示对应功能影响及注意事项，蓝图已退出此开关列表。原生 dialog 通过 showModal 进入浏览器顶层，使用独立样式，不依赖蓝图工作台样式加载。取消或 Esc 不提交，Esc 不关闭父级设置窗口；保存期间禁止重复操作，失败保留原状态并显示错误，用户可重试。

确认框显式设置 fixed、inset: 0 和 margin: auto，避免 globals.css 的通用 margin: 0 重置覆盖浏览器默认居中。宽高受视口安全边距约束，长内容在弹窗内滚动；组件测试加载真实全局样式，否则会遗漏应用外壳造成的定位差异。

## Alternatives considered

保留知识工作台的蓝色整框选中样式能维持独立视觉识别，但同一应用的导航反馈不一致。直接引用设置按钮类可减少样式重复，却也引入设置侧栏的高度和响应式尺寸约束。工作台在自身 CSS 模块中使用相同状态规则及主题令牌，各自维护密度；若更多导航需要这一规范，再提取独立状态样式。

顶部与左侧同时保留设置入口便于就近操作，但同名按钮使状态区与导航职责重叠。全局移除共享组件的设置按钮能减少一个呈现条件，却会使右侧助手缺少配置异常时的直达入口。由工作台关闭顶部按钮，保持共享状态读取和右侧快捷入口，只增加一个按位置控制呈现的参数。

保留所有候选平铺并沿用“处理待办”能减少界面逻辑，但用户无法判断哪些内容已由自动化接手。只按最近任务记录分组成本更低，却会遗漏超过 200 项的当前工作，并让旧模型配置的失败记录影响当前状态。采用宿主当前计划投影需要读取当前资料快照，换取调度和展示相同的归属依据；不维护第二份队列或独立审批状态。

保留三个入口具有一步直达优势，但不能减少右侧种类。只合并 Assist 和画像减少改动，但审核仍割裂更正流程。合并三者增加分区切换，因此保留数量提示和审核直达。

直接拉宽单列表格复用最多，却缺少分类和宽屏阅读层级。完全复制工程卡片有利于外观一致，但工程评分不等于个人确认状态；本实现复用视觉与操作模式，按个人数据语义组织卡片。

保留两套工作台外壳最省迁移成本，但持续造成切换跳变。共享外壳与卡片样式减少视觉分歧，领域数据和操作语义仍由各组件负责。将所有审核卡片强制为摘要卡高度会裁掉来源与确认控件，因此只统一表面和间距，审核正文保留自适应高度。

侧栏直接套用完整工作台网格可减少组件，但在 320px 空间中无法保留稳定的编辑与审核区域。紧凑摘要按需展开资料，完整工作台承担分类搜索；代价是部分来源和辅助动作多一次展开。所有正文保持可读，折叠只作用于来源及次要动作。

沿用平铺设置导航保留现有位置，但不能表达知识与画像、模型与用量的关联。折叠分组能缩短导航，却增加展开步骤和状态维护；固定组名与按需滚动让全部启用项目保持可达，代价是低高度窗口需要滚动。

仅在开启蓝图时确认减少点击次数，但其他开关直接改变运行行为，不能满足双向确认要求。复用蓝图 PromptDialog 可减少样式代码，但把设置确认与蓝图样式及父层键盘事件耦合。局部原生 dialog 提供顶层显示和焦点约束，代价是维护一份设置确认样式，适用范围限定创新功能开关。

## Consequences

工作台与设置导航具有一致的选中、悬停和焦点反馈。状态样式存在于两个 CSS 模块中，后续调整交互规范时需要同步；布局尺寸仍由各自界面维护。

工作台以左侧导航提供稳定的设置入口，右侧助手可以独立进入配置。共享组件需要分别维护顶部与侧栏的提示文案；若工作台导航位置改变，左侧指向文案需要同步调整。

自动处理的健康提示与人工审核数量各有来源，用户可直接定位需要介入的内容。代价是状态轮询读取当前资料快照，侧栏与助手角标分别刷新，显示可能有短暂时间差；当大库测量显示开销明显时再合并订阅或缓存，当前不增加持久索引。状态投影只服务展示，审核与自动发布继续执行宿主原有快照核验。

右侧种类减少，完整画像具备分类和详情阅读能力。代价是两个尺寸的呈现组件和旧入口别名需要维护。审核数量是定期更新的显示信息，不是事务授权依据；真实操作仍读取并校验最新快照。卡片正文可截断，详情必须完整可读。

## Verification

2026-10-14 设置导航扁平化同步：设置导航收成单行索引（约 32px 行高、去说明副行、侧栏 220px→190px），实验入口去整行边框与渐变、只留文字徽标；页面说明仍由内容区副标题承担。`npx vitest run tests/unit/planche-theme.test.ts tests/unit/laya-settings-ui.test.ts` 20 项通过，`npm run typecheck` 通过，strict-unused 对两个变更组件无告警。未运行桌面端到端测试、打包与真机目检。

2026-10-06 导航状态验证：`npx vitest run tests/unit/assistant-ui.test.ts tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge/workbench-selection.test.ts --maxWorkers=2 --reporter=dot` 三文件 35 项通过，覆盖工作台两域切换、设置入口、记录选择及窄窗口布局。人工检查 `artifacts/memory-domain-acceptance/unified-engineering.png` 与 `unified-review-narrow.png`，确认深色纵向导航及 planche 横向导航显示主题选中底色和左侧强调条。浏览器使用真实组件与 IPC 替身；未运行桌面端到端测试或打包。变更文件 `git diff --check` 通过；`node scripts/check-agent-notes.mjs` 检查 249 篇 Note，0 结构错误、27 项既有显式链接诊断。

2026-10-05 设置入口验证：`npx vitest run tests/unit/assistant-ui.test.ts tests/unit/knowledge-automation-ui.test.ts --maxWorkers=2 --reporter=dot` 两文件 17 项通过，覆盖左侧工程设置打开与保存、右侧助手设置事件和自动处理操作。人工检查 `artifacts/memory-domain-acceptance/unified-engineering.png` 与 `automation-paused-sidebar.png`，确认工作台顶部无设置按钮且提示指向左侧，侧栏保留快捷按钮。严格未使用项类型检查、两个变更组件 ESLint、中英文键检查及变更文件 `git diff --check` 通过。Note 检查为 242 篇、0 结构错误、27 项既有显式链接诊断。浏览器使用 IPC 替身，未运行真实桌面端到端测试或生产构建。

自动与人工审核分组验证：`npx vitest run tests/unit/memory-review-ui.test.ts tests/unit/knowledge/automation-service.test.ts tests/unit/assistant-ui.test.ts tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts tests/unit/right-tool-dock.test.ts --maxWorkers=2 --reporter=dot`，六文件 56 项通过。宿主测试验证 205 条当前候选不受历史记录分页限制、个人与历史范围隔离、只读投影、运行中状态和配置替换；浏览器测试验证人工角标、自动候选只读、领域筛选、历史失败与当前任务分离，以及状态失败后的可见性和恢复。浏览器 IPC 与模型推理使用替身，不作为真实模型质量证据。人工检查 `artifacts/memory-domain-acceptance/review-automation-queued.png` 和 `review-automation-running.png`，覆盖 320px 深色与浅色侧栏，无横向溢出，减少动态效果时执行图标静止。

`npm run typecheck`、`npm run build:check`、六个变更源码文件 ESLint、`node scripts/i18n-check.mjs` 通过。`node scripts/check-agent-notes.mjs` 检查 240 篇 Note，0 结构错误、27 项既有链接诊断。命令日志位于 `artifacts/review-automation-{tests,types,build,lint,i18n,notes}.log`，产物不入库。

后台状态呈现与审核间距：npx vitest run tests/unit/assistant-ui.test.ts tests/unit/knowledge-automation-ui.test.ts tests/unit/memory-review-ui.test.ts --maxWorkers=2 --reporter=dot，三文件 24 项通过。验证默认不显示手动运行按钮、展开后执行一次检查、未启用时禁用检查及设置请求、自动处理区与首张审核卡片间距至少 13px；设置页保存后执行流程保持可用。类型、构建、i18n 和变更组件 ESLint 通过，Note 检查为 240 篇、0 结构错误、27 项既有链接诊断。日志位于 artifacts/memory-domain-acceptance/automation-background-*.log，深浅主题截图为 automation-background-sidebar.png 与 automation-paused-sidebar.png。

设置快捷入口与右侧助手精简：npx vitest run tests/unit/assistant-ui.test.ts tests/unit/personal-profile-editor-ui.test.ts tests/unit/memory-review-ui.test.ts tests/unit/knowledge-automation-ui.test.ts --maxWorkers=2 --reporter=dot，四文件 28 项通过。覆盖工程设置直接打开和保存、个人领域保持启用、320px 侧栏编辑保存、快照过期阻止提交、遗忘失败恢复，以及展开辅助操作后的评分和旧记录导入。类型检查、隔离构建、i18n、六个变更组件 ESLint 通过。Note 检查为 240 篇、0 结构错误、27 项既有链接诊断。日志为 artifacts/memory-domain-acceptance/assistant-refine-*.log，截图为 assistant-profile-compact.png、assistant-profile-editor.png 和 assistant-review-compact.png；浏览器 IPC 使用替身。

工作台变更的严格类型检查、隔离构建和四个变更组件 ESLint 通过，证据为 artifacts/memory-domain-acceptance/memory-unified-{types,build,lint}.log。Note 检查为 237 篇、0 结构错误、27 项既有链接诊断。

工作台统一验证：npx vitest run tests/unit/assistant-ui.test.ts tests/unit/knowledge-automation-ui.test.ts tests/unit/memory-review-ui.test.ts --maxWorkers=2 --reporter=dot，共三文件 21 项通过。真实组件加载 globals.css，验证切换前后外壳尺寸、工程读取骨架、领域隔离、移除旧筛选、两域审核卡片表面一致、完整审核网格、窄屏无横向溢出和减少动态效果。截图 unified-engineering.png、unified-personal-review.png、unified-review-narrow.png 与 personal-board-*.png 位于 artifacts/memory-domain-acceptance/；IPC 数据使用替身，不作为真实桌面端到端证据。

居中回归在加载 globals.css 后复现修复前水平中心偏移 380px；修复后 npx vitest run tests/unit/knowledge-automation-ui.test.ts --maxWorkers=2 --reporter=dot 的 10 项通过，覆盖 1200×850 和 640×720 中心误差小于 2px、六项双向确认及 1200×520 导航滚动到末尾。证据位于 artifacts/memory-domain-acceptance/experimental-centering-before.log 和 settings-scroll-centering-tests.log；滚动条深浅主题截图使用 settings-scrollbar-*.png。

创新入口及确认流程：npx vitest run tests/unit/knowledge-automation-ui.test.ts tests/unit/experimental-features.test.ts --maxWorkers=2 --reporter=dot，共两文件 14 项通过。其中浏览器测试遍历六项功能的双向切换，检查确认前零写入、取消与 Esc、父窗口保留、原生顶层显示、保存失败原值保留及重试、保存中防重复提交。严格类型、隔离构建、i18n 与变更组件 ESLint 通过；截图 experimental-confirm-*.png 和 settings-groups-dark.png 位于 artifacts/memory-domain-acceptance/。

设置分组与 Shell MCP 排除的定向检查：npx vitest run tests/unit/knowledge-automation-ui.test.ts tests/unit/assistant-ui.test.ts tests/unit/knowledge/external-mcp.test.ts tests/unit/knowledge/mcp-client-config.test.ts tests/unit/knowledge-ipc-contract.test.ts --maxWorkers=2 --reporter=dot，共五文件 34 项通过。分组测试检查领域四种组合、当前页禁用回退、模型与用量切换，以及 640×720 窗口末尾导航可达且没有页面横向溢出。截图 settings-groups-dark.png 与 settings-groups-narrow.png 位于 artifacts/memory-domain-acceptance/，使用真实导航组件与内容面板替身；截图不代替完整桌面验收。

分组最终复验中 knowledge-automation-ui 的 8 项通过；npm run typecheck:strict-unused、npm run build:check、npm run i18n:check 与变更源码 ESLint 通过。npm run check:notes 检查 237 篇 Note，0 个结构错误、27 项既有链接诊断。日志位于 artifacts/memory-domain-acceptance/settings-groups-*.log。

设置卡片与图标调整使用现有 assistant-ui、knowledge-automation-ui、laya-settings-ui 三个浏览器测试文件复验，共 16 项通过，覆盖独立保存、禁用、本地控制与 MCP 更新操作。截图检查深色、planche 和窄窗口；类型检查与 i18n 检查通过。知识库四环节、个人三张设置卡片与 MCP 图标沿用实际组件，未增加仅比对样式常量的测试。

2026-10-04：tests/unit/assistant-ui.test.ts 使用真实 React 组件与浏览器 IPC 替身，检查三个助手分区、四种开关组合、无工作区画像、旧审核跳转、1440×900 完整工作台、搜索及来源详情、640×720 窄屏与主题布局。截图在 artifacts/memory-domain-acceptance/personal-board-*.png，人工检查正文、操作入口和横向溢出；测试产物不入库。

最终定向测试覆盖 assistant-ui、right-tool-state、right-tool-dock、knowledge-automation-ui、memory-review-ui、knowledge-ipc-contract 以及 knowledge 下 external-mcp、mcp-client-config、mcp-access、knowledge-mcp-tools，共十文件 85 项通过；命令为 npx vitest run 后接上述 tests/unit 路径，参数 --maxWorkers=2 --reporter=dot。真实桌面命令 JANUSX_DESKTOP_ENTRY=artifacts/build-check/main/index.js npx playwright test --config playwright.desktop.config.ts tests/e2e/knowledge-pipeline.spec.ts 通过一项，覆盖真实采集、审核、画像操作及四种开关组合，耗时 8.7 秒。

全仓 npm run test:unit -- --run --maxWorkers=3 --reporter=dot 为 2712 项通过、1 项失败、5 项跳过；唯一失败仍为既有六处跨仓 Note 源码链接失效。后续新增的客户端配置测试与独立进程测试另行执行，不计入这一全仓数字。严格类型、隔离构建、i18n、包边界与排除检查通过；变更源文件 ESLint 无错误，KnowledgeWorkbench 既有 refresh effect 依赖警告保留。MCP 接入和真实客户端验证由[终端覆盖决策](../terminal/mcp-terminal-coverage.md)维护。
