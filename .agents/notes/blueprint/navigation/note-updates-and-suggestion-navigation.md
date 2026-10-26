---
{
  "schema": "harness-note/2",
  "id": "77bf944c-de24-4d59-8568-bea35aa30cd4",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-10-10",
  "updated": "2026-10-26T02:44:28Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/17bbe20e-f05c-470c-aee1-3f92a86369ab",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/5d28b582-d905-4aa6-bfc8-8aa33ac17cdd" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c28b6fb3-5cb4-4ebc-895d-0e8dab6c1725" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/9a1a80ef-5f36-474a-905b-c12a902f9b2f" }
  ],
  "codeRefs": [
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/blueprint/review/note-repair.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/blueprint/review/note-repair-turn.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/llm/janus-agent-ports.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/llm/chat-model-budget.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/blueprint/NoteRepairCard.tsx", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/note-repair.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/note-repair-ui.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/note-repair-live.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/blueprint/note-reading.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/blueprint/review/git-scheduler.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/blueprint/BlueprintAttention.tsx", "role": "entry" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/blueprint/BlueprintNodeCard.tsx", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/blueprint/NoteReviewPanel.tsx", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/blueprint/BlueprintCanvas.tsx", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/features/blueprint/useNoteNavigationMotion.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/blueprint-note-reading.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/blueprint-review-retry.test.ts", "role": "test" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/e2e/blueprint-attention.spec.ts", "role": "test" }
  ]
}
---

# Note 更新提示与建议定位

## 目标与实现状态

蓝图以“尚未查看的新版本”发现 Note 变化，提供更新、当前建议、自动审核详情三个入口，共用列表与定位。用户要求首版就具备丝滑的加载与聚焦效果，已落实到内嵌蓝图和独立工作台。实现覆盖本机版本记录、筛选批量已读及撤销、指定意见和失败原因定位；验证范围与桌面限制见末节。

“建议节点”是持有当前待处理意见的原 Note 节点。建议状态继续由[建议管理](../maintenance/suggestions/module.md)持有，阅读与导航不生成审核、不处理意见。

## 插件界面恢复

插件保留原注意列表的 JSX、CSS 和纯数据投影，使用公开插件调用替换宿主 store。列表恢复搜索、模块筛选、固定尺寸、滚动条目、上下篇、筛选已读／撤销；读过的行保留在本次浏览序列里，重扫后再建立新序列。批量版本只提交 noteId、hash、path，避免把展示字段传入严格 native schema。弹层优先消费 Escape，翻到末篇后禁用按钮丢焦也不会关闭整个工作台。

左侧接回原目录／章节、关系预览和折叠审核卡，建议跳转展开指定意见、正文跳转确认实际呈现版本。后台刷新保留当前同身份正文，避免审核卡被重复卸载；旧访问不会在后续刷新强制切回正文。跨笔记链接等待新正文到达后定位章节。完整原文与字段分别按需展开，诊断入口在加载工具栏，不在底部另占一行。具体文件边界、复制／外链限制及实测由[官方插件专项](../../planning/blueprint-official-plugin.md#阅读卡与注意列表恢复)维护。

## 更新与已读

更新是相对于首次观察基准或上次主动查看版本的净变化，包括 Janus 关闭期间发生、重开后发现的变化。首次完整接入静默建立基准，既有 Note 不全部亮起。活动工作区注册时开始观察，蓝图刷新复用建议服务已经同步的来源快照；不为更新计数另起正文扫描定时器。

范围是当前工作区中所有有效 Note，包含普通 Note、idea、Task 和归档内容，不限当前画布或有审核资格的三种类型。更新、当前建议和自动审核详情只订阅当前工作区；其他工作区即使已绑定或被引用，也不汇入入口、计数和活动区。切换工作区后订阅对应来源，加载期间沿用所选工作区路径。同一 Note 多次保存只计一篇。真实 sourceHash 变化均可提示；同一身份的纯路径变化标为移动，不伪装成新增。排序依据本机发现时间，不声称是真实编辑时间。

用户主动打开正文，且正文和视口就绪后，仅确认本次访问绑定且实际呈现的版本。数字在持久化成功后减少。后台重读、Agent 访问、仅打开建议或失败原因均不算正文已读；建议直达提供“查看当前正文”动作。正文打开后再次修改仍需主动查看，新内容不会因旧访问的异步回调而消除提醒。

更新列表的次级菜单提供“将当前 N 篇标为已读”，作用于点击时整个筛选结果中可用的未读版本，不限屏幕可见行；按钮数量与可提交数量一致。提交给主进程的每个版本只含 Note 身份、hash 和相对路径，不把列表的未读、可用性等展示字段传入严格校验的 IPC。无需确认框，成功后有 8 秒撤销。撤销只恢复仍属于该操作的记录，不覆盖之后的主动查看或其他窗口确认；点击后到来的版本仍未读。按钮只在提交中或没有可用未读条目时禁用，不以整库同步状态拦截已列出的版本。点击后仍重新读取真实来源并逐一确认选中身份可读；与本批无关的格式错误不阻塞确认。选中项有任何不可读目标时整批报错且不写入，不静默部分成功；首次观察基准仍必须来自完整扫描。写入失败显示原因并保留真实计数。提交时显示正在标记，完成后保留原行显示已读；缓存首屏操作后也不因后台补齐而清空浏览位置。

阅读状态保存在 Janus 用户数据目录的 blueprint/note-reading.json，按仓库身份、规范 checkout 路径和分支隔离，以原子写入和主进程序列化维护。初始基准与最后查看 hash 分开保存，IPC 通知使多个窗口共享计数。短期撤销凭据只在内存中保存，不记录正文、不回写源 Note；首版不做跨设备同步。

此前确认过两处已读缺口，其中来源观察顺序已在整体同步调整中修复。仍需处理的自动确认路径如下：BlueprintCanvas 自动确认先将访问标为已处理，再比较访问绑定的图谱 hash 与实际正文 hash；图谱快照落后于原文时，即使正文已呈现也直接跳过提交。显式正文确认使用实际 sourceHash，不经过此比较。应以当前访问实际呈现的版本确认，继续由宿主保护随后产生的新版本。

此前另有来源观察竞争：review/runtime 在阅读状态队列外取得建议快照，再把 observed 传给 NoteReadingService.read。迟到的旧观察可在新版本已读之后执行 sync，把当前 hash 倒退，同时保存更高 revision；前端仅拒绝低 revision 无法阻止计数再次变为未读。隔离调用实际服务已复现新版本确认为 revision 2、unread=false，旧观察随后成为 revision 3、unread=true。当前 runtime 在来源读取前记录 reading.observationEpoch；排队落地时若已经发生更晚的确认或宿主写入观察，返回已保存的新状态，不再应用旧快照。旧访问不得确认新内容的规则继续保留。

本次只读 dev 记录为 revision 152，当前仓库 295 个身份中有 60 个保存过确认、5 篇仍未读。剩余均为 remote 模块文件，实际文件最后更新为北京时间 10:08:47；其中 4 篇 readHash 早于当前字节 hash，1 篇尚无 readHash。记录说明批量确认曾持久化，后续更新继续未读符合版本规则；现有记录没有每次确认时间和点击轨迹，不能据此认定用户每次数字未变都由上述竞争造成。列表为保留浏览位置而留下已读行，行总数与顶部未读数也分别解释。

## 卡片类型与更新提示

卡片顶部只显示真实文档类型，中文界面使用模块、说明、想法、计划、需求、决策、任务；项目/模块导航卡继续显示对应架构角色。旧投影的 EPIC/FEATURE/TASK/ISSUE 不作为第二套类型标签显示。当前工作区的卡片移除重复的工作区名称和 No workspace 占位，来源路径仍可在详情中查看；未绑定旧工作区 ID 不代表 Note 没有来源。

未读版本在顶部右侧固定显示菱形标记与“有更新”，位于进入/折叠控件之后，不占用标题。悬停和辅助技术说明为“内容已变化，尚未查看最新版本”；缩放低于 0.5 时只保留菱形。待处理建议继续使用左侧圆点，形状和位置区分这两种提醒。标记只订阅当前 Note 的未读版本：主动查看最新正文或手动标记已读后消失，查看建议、处理建议和审核完成均不清除它。

## 列表与返回

顶部“更新 N”和“有建议 N”都从列表同一份已知记录按 Note 篇数计数，列表逐项显示意见数量和摘要。同步失败或暂时不完整不再把已有数字替换成省略号；这些状态单独提示，批量已读由点击时对选中目标的真实来源校验决定。没有任何可用记录时明确显示“加载中”。自动审核仍展示本轮摘要；摘要是运行结果，当前建议数是尚未处理集合，两者不能互相替代。

列表支持标题/模块/路径搜索、模块筛选、上一篇/下一篇和刷新。主动刷新按列表分别读取：更新与建议等待当前范围的来源/建议视图，自动审核只等待轻量活动状态，不再互相阻塞。按钮旋转、显示正在刷新并禁用重复点击；15 秒未返回时停止旋转，保留已有结果、显示超时并允许重试，迟到响应不能覆盖后续结果。建议首次读取显示来源同步中，成功读取后才展示空列表。失败显示对应原因，不触发模型；工作区、分支或列表切换后，迟到响应不能重排新列表。三种列表统一限制在 480px 或视口高度减 24px，以较小者为准；标题、筛选和底部操作保持可见，Note 条目在内部滚动。更新与建议列表一次浏览期间顺序稳定，已读行原位显示“已读”，后台新增项通过刷新提示进入；自动审核列表按当前保留集合即时同步分类与成员，重试和轮次淘汰无需主动刷新。关闭重开或主动刷新移除已读行；计数归零不会自动关闭浮层。Escape 关闭并返回触发按钮，入口可用键盘激活。

快速跳转按 checkout 和 Note 身份解析，进入所属模块、选中节点并打开左侧原文与审核详情，再将目标聚焦到画布；指定 findingId 时展开对应意见。卡片建议灯也可触发同一导航。自动审核的快速状态先到时，分支身份可从该状态校验，完整详情稍后到达继续更新左侧原因。目标不在当前画布时加载所属模块；有效未归属 Note 仍可看正文。目标删除或来源不可用时说明状态，不按同名或同路径猜测替代目标。

快速跳转记录当前模块、选择、预览、视口、画布筛选、预览滚动和已展开意见，同模块访问不同 Note 也支持返回。普通单击预览保持原有模块历史行为。列表筛选和顺序在连续访问中保留，返回恢复原阅读现场。卡片“更新”文字仅指本 Note 未读；建议灯仅指本 Note 待处理意见，首版不做递归模块汇总。

## 右上角审核入口

自动审核开启后活动区持续可见，已知的“提交 X / N”始终保留，失败数量以独立徽标显示，不再由“需处理”覆盖；自动运行进度与提交次数并列，加载中不展示未知计数。关闭后仍有保留的完成记录、需要重试项或手动活动时也可访问。轻量状态独立于 Note 正文加载，已有真实目标即可列出，完整详情到达后继续更新。列表只有“审核完成”和“需要重试”两个可点击筛选，显示各自 Note 数量；打开时有重试项则先显示需要重试，否则显示审核完成。用户选择的分类不会随后台处理自动切换，搜索和模块筛选继续有效。

审核完成表示流程完成且覆盖完整，是否产生意见不改变分类；意见概要仅在现有“有建议”入口展开。失败和覆盖不足进入需要重试，条目与左侧详情给出阶段、原因和手动恢复动作。排队及正在执行的进度保留在顶部活动区，不增加第三个结果分类；已有重试项在自动或人工恢复中仍在需要重试分类并显示当前阶段。工作区级 Git 或来源异常显示原因，不虚构 Note。

### 完成记录两轮保留与重试持续保留

范围按仓库身份、工作区和分支隔离。实际有覆盖完整结果的自动批次结束后进入最近两轮成功窗口；无差异检查、轮询、刷新、全失败或只有覆盖不足结果的批次不挤占成功窗口。批次中已经发布的完成结果可即时查看，批次结束时淘汰窗口外的完成引用。关闭自动审核中断剩余目标时，该批次以现有结果结束，未完成对象成为重试项；重开仍待续跑的批次延续原身份，后续输入替代剩余对象时结束其原批次。

调度器按 Note 身份维护轻量目标、提交与报告版本，同一 Note 在两轮重复出现只显示最近状态。完成引用过期不清理报告或未处理建议，现有建议入口独立维护当前意见；不复制两轮建议正文，也不建设完整运行历史。最新一次运行摘要单独保留，摘要中的当次失败数与当前重试数量具有不同语义。

失败工作项和覆盖不足目标不受两轮窗口限制，跨后续批次、关闭开关和重开应用持续保留。查看、刷新、来源版本变化和清理建议均不算恢复。重试仍失败则更新原因与阶段；覆盖仍不足则更新报告版本并继续保留。成功且覆盖完整的手动恢复形成新的一轮完成记录，移出需要重试，避免沿用过期失败轮次而立即消失。新自动审核失败优先于同 Note 的旧完成记录。目标删除、退出审核类型或暂时不可用均不清理未完成记录，列表保留数量并说明不可访问；只有该 Note 后续产出覆盖完整的结果才移出重试。

旧状态没有轮次字段时，将已经保存的最新目标视作第 0 轮；只迁移实际持有的数据，不从非零 reportRevision 重建历史，因为该版本号也会在来源变化和意见清理时递增。旧失败和覆盖不足同样保留。当前实现只保留两轮完成引用与当前重试集合，不还原旧应用已经丢弃的轮次。

### 重试后的列表同步

自动审核列表来自调度器的完成目标与独立持久化重试集合。首次读取每个上下文时，将旧建议库中真实失败、覆盖不足或中断记录合并到重试集合，按 Note 身份去重，已有失败/覆盖不足调度状态优先；真实未完成报告可替代旧完成目标。恢复发生在来源同步可能清除旧错误之前。没有提交来源的旧记录不虚构提交或自动轮次，不从上轮失败总数或非零 reportRevision 推断身份。迁移标记与集合一起持久保存，完整恢复后即使旧报告残留也不会重新导入；后续手动失败继续写入集合。意见全部清空不生成“需要重新审核”条目。新目标状态优先于旧建议缓存中的错误与覆盖状态，成功恢复立即改变已打开列表的分类、数量与错误详情，当前筛选保持不变。完成后直接接收持久结果通知并补读保存报告，不等待旧完整读取；各状态域的版本比较防止旧响应覆盖新结果，工作区和分支身份继续校验。

查看原因不触发审核、不处理意见、不确认正文已读。手动新审核的进度由活动区和左侧预览显示；没有自动记录的手动完整结果不充当自动审核轮次，失败和覆盖不足则加入持续保留的重试集合。

## 左侧建议置顶与阅读

审核摘要常驻正文之前。普通卡片或正文访问默认收起详细内容，仍显示建议数量、状态和审核动作；摘要和页签工具栏入口都能展开详情，收起后摘要仍可继续操作。从建议入口、卡片建议灯或自动结果进入时直接展开，指定 findingId 则同时展开并定位对应意见。

阅读卡片将标题和关闭按钮放在内容滚动区之外，滚动区稳定预留滚动条空间。只有正文/关联笔记页签与紧凑审核状态入口吸顶；审核摘要、动作和完整意见均随正文滚动。通过 ResizeObserver 实测页签工具栏高度，定位正文锚点、意见与原因时预留空间。保留原文引用定位、取消审核、处理意见与返回阅读位置及建议展开状态；返回时还恢复章节折叠。点击紧凑审核入口只展开并定位详情，不调用模型。内容审核与关联笔记使用统一卡片，左侧箭头和标题控制折叠，右侧图标保留审核/取消动作；章节目录与控件布局见[阅读面板设计及验证](../documents/module.md#note-阅读面板)。

## 首版加载与聚焦

工作区加载时同时预读更新与建议。首次进入先按当前仓库、checkout 和分支读取本机保存的建议/阅读记录，再由完整来源校验替换；保存记录标为 sourcesPending，不扫描 Note、不建立首次基准；可发起已列出版本的批量确认，但持久化前必须重新校验本次目标。完整读取完成后，已打开且仍在首次加载的列表自动补齐；迟到的保存记录不能覆盖新来源结果。未保存过的记录仍需首次读取，格式诊断也在当前来源校验后补齐，不承诺首次冷解析零等待。

切换 Note 详情只重置本篇交互状态，不额外刷新整库列表；同一根目录新增组件订阅也不重复读。已读/撤销事件直接携带持久化回执，各窗口按上下文与版本更新计数，不再把事件转为一次完整列表读取。已读操作本身的真实来源校验仍保留；来源文件变动和审核完成由事件补读，10 秒轮询兜底。

跳转开始即保留原界面上下文并加载目标，原文未到时显示骨架；超过 120 ms 显示轻量进度提示，避免快速读取时闪烁。等待画布几何稳定后，按目标卡片实测尺寸和 React Flow 可视区计算缩放，用约 380 ms 将卡片中心移至画布中心；缩放上限为 1.1，窄画布留出卡片周围空间。动画期间若工具栏换行等导致可视区或卡片尺寸变化，按最终几何重新定位后才算完成。原文和移动都完成后给目标约 1.1 秒聚焦轮廓，并滚动正文或精确意见到可读位置。

连续点击以最后一次为准，旧加载结果和旧聚焦回调不能覆盖新目标或误确认已读。用户拖动/滚轮接管画布时停止自动移动；返回时清理忙碌状态。12 秒内无法完成定位或正文读取失败则显示失败与重试，未读保持。重试保留原导航意图，不能把“查看失败原因”变成“确认正文已读”。

系统偏好减少动态效果时移除平移时长和循环动画，保留选择与可读详情。浮层、骨架和聚焦颜色使用当前主题，内嵌和工作台复用同一实现。

## 审核反馈与阅读布局

### 左侧原因与加载

审核面板的紧凑摘要分为两行：第一行是折叠入口、意见数量和审核动作，第二行是当前状态。空闲时三类语义目标提供“审核当前 Note”，普通 note/idea/task 提供结构检查；运行时原位置显示取消和真实阶段，并以旋转标识提供加载反馈。收起后保留摘要及工具栏状态，详细原因与意见按需展开。审核仍作用于当前 Note，不扩大为目录批量操作。

### 手动与自动活动

右上角标题、可访问名称和进度跟随实际活动来源。手动与自动并行时优先显示手动审核阶段，自动开启状态留在次级提示；手动运行不使用自动提交计数或自动完成篇数。手动结束后回到自动运行或开关状态。列表继续只有“审核完成”和“需要重试”，没有自动记录的手动审核不生成自动轮次，其失败与覆盖不足仍统计为需要重试。

### 显式标记已读

对已呈现的正文，显式按钮直接提交实际显示的 noteId/hash/path，不再创建导航访问或重读正文。点击显示正在标记并限制重复提交，持久化回执直接更新计数和按钮；失败保留计数并显示原因。普通正文访问仍等待原文和视口就绪。旧版本提交、分支/工作区隔离、撤销与迟到响应的校验继续由已有阅读服务负责，不以点击时的乐观数字替代持久化结果。此变更缩短提交前链路，未对大型工作区的后端校验耗时作量化承诺。

### 自动展开栏与轮次

分类切换沿用设置页“用量 / 终端类型”的下划线 Tab 样式：28px 高、透明底色、选中项文字加深和主题色下划线，数量随标签显示，键盘焦点保持清晰。两个分类继续承担当前完成/重试计数。本次样式调整通过 attention 浏览器回归 2 项（视口内滚动及重试恢复筛选），并核对纸面/深色主题与 380px 窄视口的两种选中状态截图。列表不再堆叠当前失败和覆盖不足的零值摘要、上轮意见/失败数、通用未完成提醒与原始英文错误。单个重试条目显示简短原因，技术错误按需展开；工作区 Git/来源异常保留独立入口。上轮摘要放入默认折叠的运行详情，仍与当前待恢复数量区分。

完成列表明确分为“最近一轮”和“上一轮”，展示各轮当前筛选后的篇数和实际结束时间，同一 Note 的完成结果被后续失败替代时，可以保留已有成功轮次的空组。进行中批次已发布的完成项单列为进行中的轮次。调度器持久化轮次结束时间，保留规则为最近两次产生完整结果的实际执行批次；轮询、无差异检查和结构快照刷新不占轮次。同一 Note 只显示最新状态，失败/覆盖不足持续保留到该 Note 产出覆盖完整的结果。旧数据没有时间时显示“时间未记录”，没有轮次身份时归入早期记录，不推算历史。

### 左侧目录、搜索与宽度

左侧阅读面板移除工作区“Note 目录 · N 篇”和查找输入，不再在每篇详情重复完整目录。正文按章节阅读，关系、反链与按需上下文预览合并到关联笔记页签，代码引用保留。顶部节点搜索补充 Note URI、原始相对路径和代码引用路径，继续沿用标题/标签匹配和既有结果定位；未新增全文检索。工作区有效 Note 总数与结构诊断可在数据来源中查看，格式损坏文件可直接打开编辑，诊断不因有效目录过滤而隐藏。

独立工作台左侧从 260–300px 调至 320–360px，右侧从 360–420px 调至 300–360px，侧栏总宽上限仍为 720px，最小值仍为 620px。内嵌左侧从 280–320px 调至 300–380px。保留原有展开动画与画布响应布局，便于阅读正文和审核状态。

## 修复闭环与左侧界面

内部 Janus 调整 Note 后，以实际写入版本重新审核，完整新结果替换旧建议；仍有问题也使用新版原文的描述与证据。发布语义由[建议管理](../maintenance/suggestions/module.md#修复后的整批替换)持有，数字评分由[审核专题](../maintenance/note-content-review.md#jev-辅助评分)持有。正文交付、待复审及最终报告分别通过共享状态更新，界面按下表呈现。

| 阶段 | 右侧修复卡片 | 左侧建议、节点与顶部 |
| --- | --- | --- |
| 正在调整 | 显示读取与修改进度 | 原建议标为处理中，防止重复修复。 |
| 确认写入，正在复审 | 展示实际修改摘要与复审进度 | 正文更新；旧建议退出当前有效集合，明确显示待复审。 |
| 完整复审无问题 | 已修复，审核通过 | 清除旧建议，同步列表、数量与节点提示。 |
| 完整复审仍有问题 | 已调整，复审发现 N 项问题 | 展示本轮针对新版正文的新建议，不拼接旧描述。 |
| 复审失败或材料不足 | Note 已调整，复审未完成；提供重试审核 | 保留新版正文和待复审状态，说明原因；不把零条建议当作通过。 |

顶部计数、节点标记、左侧列表和右侧结果必须来自同一轮结果。正文/建议已同步只作辅助信息，主反馈回答改了什么、复审结论和下一步。JEV 评分可随后补充，失败仅提示评分暂不可用，不改变本轮建议或审核结果。

左侧界面以下三项一起调整，内嵌与工作台、深浅主题及窄面板保持一致，保留键盘焦点与明确的交互反馈：

- 每条建议的“已处理”“不采纳”重新设计为一组靠右的次级操作，与问题描述、证据和评分分开；保留提交中反馈和防重复点击。它们仍针对该条建议显式处理，不等同于自动修复或审核通过。
- “正文”“关联笔记”采用自动审核界面的 Tab 切换设计，沿用其下划线选中样式、间距和悬浮/焦点反馈；原上下文页签合并为正文分段阅读和关联笔记按需预览。
- “完整源文”“复制原文”靠右分组，重新设计控件外观，悬浮时必须有可辨认反馈；保留完整源文切换状态及复制成功/失败反馈，窄面板不得挤压正文或遮挡操作。

上述界面与状态流转已接入共用组件。正文修改摘要使用宿主核对后的正文增删行数，查看修改入口在卡片收起时也可用；完整差异仍来自真实回执。待复审采用空心节点提示并进入“需要重试”；建议列表实时跟随当前集合，更新列表仍保留阅读顺序。Tab 支持方向键和 Home/End，原文切换保留 aria-pressed，操作区保留悬浮、焦点和提交禁用反馈。工作台聊天的全局 Tab 快捷键在 Note 阅读区有焦点时让位，避免阻断左侧控件间的键盘导航。

## 建议定向修复

建议列表与 Note 预览提供“修复本篇 · N 条建议”和整篇只读讨论；结构诊断提供按原始路径修复格式。点击修复即授权本次调整，使用当前工作区独立内部修复会话，普通 Janus 对话可同时使用。点击讨论只读取与分析，继续普通对话。每次只调整一篇 Note 的当前问题，不创建 Task、不派发外部终端，也不因缺少业务决策改写需求迎合现有代码。

点击时保留问题卡片的概要与实际位置，右侧顶部预留同一张修复卡片；等待面板布局稳定后，以约 440ms 的位移和缩放完成转移。卡片紧凑显示交接、读取、调整、复核与真实终态，详细内容可展开。减少动态效果时直接呈现状态。修复不等待普通对话，只读讨论在该对话忙碌时等待；切换工作区取消未发出的交接，并沿用对话既有的在途取消。状态按 checkout 隔离，另行订阅宿主终态，停止聊天后仍能收到已经写入的证据。

主进程在交接时核对工作区、分支、Note UUID、当前建议修订号与所选 findingId；结构问题另核对原文 hash。只有当前固定的 workflowx 2.0.0 与 harness-note/2 来源可以进入修复。执行前再次核对附加的工作目录和原文版本，同篇 Note 不并行领取修复。模型可读取必要证据，专用写工具只接受选定 Note 的完整原文与对应 hash，不提供任意文件、代码写入或命令。必须完整分页读取后才能修改；UUID、创建时间、类型、生命周期及 Task 合同保持稳定，描述修复保持其余元数据。

格式修复允许 frontmatter 语法损坏但仍可唯一恢复 UUID 的原始文件。新正文须通过共享格式与模块组织检查，再通过共享受管事务写入；无法确认身份、重复身份、不可解析的 Task 合同或 unsupported profile 保留可见原因。写入后使用实际提交版本复核，不能把写入器更新时间导致的规范化误认成外部编辑。来源中途变化则停止覆盖。结构结果按当前原始来源重查，描述修复由同一内容审核引擎复核；完整有效的新报告替换旧集合，零项即本次通过；失败或覆盖不足显示待复审，不重新挂回旧描述。

修复卡片提供真实修改差异及按当前版本校验的撤销。回执记录于用户数据的 blueprint/note-repair，保存该次前后文件与事务身份，不复制建议历史。普通写入复用 NoteService，损坏文件使用同一资产锁与可恢复日志；扫描在释放锁后进行。撤销恢复精确原始字节，描述修复随后重新审核当前原文；若撤销成功但复核失败，分开反馈这两个结果。撤销后显示“已撤销修改”，不沿用撤销前的通过状态。

界面每个 checkout 保留最近一张交接卡片，运行状态不进入永久建议历史。独立工作台与内嵌蓝图都能由建议动作打开右侧。外部终端派发、圆桌、跨重启恢复这张运行卡及桌面多窗口验收仍在首版范围之外。

### 整篇修复、紧凑卡片与独立对话

以一篇 Note 为操作单位，主入口为“修复本篇 · N 条建议”，默认将本篇全部当前待处理建议交给 Janus 综合调整，逐条只保留详情和人工处理动作，整篇保留讨论入口。有新问题时重新处理读取整篇当前建议；复审未完成时“重试审核”只运行审核，不再次调用 Janus 写入。点击授权修改；冲突、缺少依据及未解决项继续保留并说明。结果的剩余数统计整篇当前建议，不能在上次所选项消除但出现新问题时显示全部通过。

保留卡片转移到右侧顶部的动画，默认收成紧凑状态卡，常驻标题、实际修改摘要、复审结论及运行时停止。点击标题展开问题、阶段、执行消息和工具结果，完成后可查看真实差异与撤销；详情最多占 32vh，内部滚动，普通聊天输入框保留可用。左侧审核头部与展开内容共用背景、边界、宽度和缩进，整篇动作集中显示；头部随正文滚动，紧凑审核状态入口吸顶，保留原文定位和阅读恢复。

修复复用现有 Janus runtime，以 workspace-note-repair 视图身份绑定独立内部会话，不是子代理。普通 workspace-dialog 的消息、轮次、清空、发送和停止保持独立；普通聊天繁忙也能开始修复。修复卡片展示其内部会话的执行内容，关闭面板再打开仍可查看当前会话。只读讨论仍进入普通对话，忙碌时等待该对话空闲。切换工作区沿用内部面板会话的取消规则；宿主保持分支校验与同篇 Note 排他领取，普通聊天或外部编辑造成版本变化时阻止覆盖。

宿主区分未写入、正文无需修改且审核通过、已调整且有新问题、复审未完成和修复通过。完整读取并提交相同正文可直接进入独立复审，仅更新时间的提交也保持原字节，不强制无意义改写；只读了部分原文、未提交任何写入确认、写工具拒绝或具体阻塞仍保留原建议。每次结束在 blueprint/note-repair/<id>.status.json 保存目标、开始/结束时间、实际 afterHash、正文增删行数、执行轨迹与终态；修改另有真实差异回执。重试审核从记录核对工作区、分支和当前 hash，防重复运行，原文再次变化时要求从当前 Note 审核。记录保存失败单独反馈，不卡住 stream_end；UI 仍只保留本 checkout 最近卡片，不承诺跨重启恢复卡片。

写入通知直接交付单篇原文；报告提交通过 resultsChanged 立即更新顶部、节点与左侧，终态仅补读已保存建议。正文与建议分别显示同步状态、独立重试，不等待旧的全库读取。右侧结果也接收同一 hash 的后续完整复审，因此在左侧重试成功会同步解除右侧“复审未完成”。源码 hash 不匹配时保留实际最新正文并说明，不把旧响应当作成功证据。

### dev 修复未写入的取证与执行缺口（2026-10-12）

当前 dev 终态记录已明确目标，不再只是候选：blueprint/note-repair/9eed4124-af09-4ad7-ab57-2a4a0315e284.status.json 指向本仓库 refs/heads/develop 的 session-mgmt-orca-restore.md，授权 intent 为 repair，包含 L1/L2 与 AC-1/AC-2/AC-10 的层级矛盾、AC-4 验证归属两项问题。该轮北京时间 09:08:49 开始、09:10:35 结束，终态为 unchanged、changed=false，提示“模型没有提交有效修改”，没有 lastWriteError、afterHash 或成功差异回执。原文件最后修改仍为 2026-10-11 22:38:02，SHA-256 仍为 96447670b29885f48cdc3cc2255c065787d452274875902e7ed7e8ca6e5fa9c0；这轮没有成功改变该 Note。

终态记录不包含工具调用与模型最终说明，因此不能进一步确认本轮是未调用 note.repair_write、提交相同正文返回 unchanged，还是在写工具之前受到工具门控；没有 lastWriteError 表明没有留存专用写工具执行拒绝原因。界面的 reading 阶段在宿主 claim 后即发布，不证明已读完整来源。原文有 13,147 个 UTF-16 字符，默认每页 6,000、最多 12,000，必须继续 nextOffset；普通 note_read 或上下文访问不累计专用修复读取进度。写工具若被执行且因未完整读取被拒，终态应保存具体原因。

修复前源码与隔离模拟确认宿主缺少修复完成约束。chat-orchestrator 只在提示词中要求专用读取与写入，runChatTurn 正常返回后立即调用 repairs.finish；finish 遇 session.changed=false 直接返回 unchanged，不重试、不运行复核。依赖 @janus-agent/chat-core 的 WORKSPACE_MUTATION_TOOLS 只包含 workspace、project、git、command 修改工具，未包含 note.repair_write。修复又移除普通修改工具，因此 @janus-agent/janus-agent 的 canMutateOffered=false，通用“用户要求修改却未尝试修改”的补救不会触发。实际隔离模拟提供专用读写工具及明确修复请求，模型第一轮读取、第二轮仅给分析，结果为 2 次模型调用、只有 note.repair_read 被执行、cancelled=false；没有追加要求提交修改。此复现解释了可重现的提前结束路径，不能替代缺失的该次模型轨迹。

修复前详情入口存在独立 UI 缺陷：NoteRepairCard 的“点击查看详情”位于无 onClick 的 span，只有上方 bp-note-repair__toggle 标题按钮调用 setExpanded。点击提示文字无效不是后端加载失败。现有 UI 用例点击标题，未覆盖提示文字；后端成功链路用例按脚本主动调用写工具，也未覆盖读后只输出分析的恢复行为。

上述两处缺口已修复。详情文字改为真正的按钮，共用 expanded 状态并支持键盘。JanusX 新增 note-repair-turn，复用同一领取会话、读写端口与模型上下文，在没有实际修改、未提交同文复审确认且未报告阻塞时最多追加两次执行；已写入、只读讨论、取消、分支或原文变化及模型错误均不重放写入。继续执行明确指出下一读取 offset 或拒绝原因，要求提交受限写入；已完整读取并提交同文时交给独立审核判断。新的 note.repair_block 工具保存具体证据缺口或缺失业务决定，问题继续保留。修复上下文不再混入普通 Note 写入与提案提示；完整读取、稳定身份、格式与并发版本校验仍由原写工具执行。

该历史轮次的建议保留规则不属于当时写入失败原因：旧 SuggestionService.publish 只有有效 resolvedFindings 才消除旧项，JEV 开启时还需通过核验。旧 00:58:07 报告与原文件 hash 一致，两项核验均为 uncertain，其中 AC-4 引文已不在当前正文而标为 stale；未写入分支直接结束，也未开始新的修复复核，不能把旧 JEV 状态视为此次写入被阻止。当时成功写入后的显式销项规则现已由上文完整复审替换。

终态区分原文未读完、未提交修改、正文相同、写工具拒绝和具体阻塞，另保存专用读取进度、执行尝试次数、最后至多 4,000 字符的模型说明以及工具状态/摘要。继续执行携带真实工具输出作为非指令数据，保留至多 120,000 字符；超大输出或较早证据被省略时明确要求重新读取，不放松写入校验。新编排属于 JanusX 的产品修复义务，未修改通用 Agent 依赖或全局修改恢复规则。先前终态摘要、实际 afterHash 核对、旧蓝图读取结束后补读与 NoteWikiPanel 按 sourceHash 重读仍保留。实际历史目标需求 Note 未被本轮手动改写。

后续 dev 记录 e9f5a899-8f5c-45c8-ada9-a5e9fabc60c3.status.json 显示，北京时间 09:56:55 至 10:01:05 同一目标完整读取 13,147/13,147 字符，实际执行 3 次；轨迹只有读取和搜索，note.suggestions 一次参数校验失败，没有 note.repair_write 或 note.repair_block。最终说明均为 Agent 空响应兜底。有限继续执行已生效，但不能解决每轮自身的输出截断。该历史记录未保存模型 finishReason/usage，不能追认三轮各自的供应商结束原因。

修复前 dev 默认 Gemini 3.8 Flash 的配置有 contextWindow=1,000,000。janus-agent-ports 将显式上下文额度作为跳过模型元数据查询的条件；Vertex 列表不返回输出额度，内置模型匹配置信度低，chat-model-budget 因此把 maxOutputTokens 回落到 4,096。上下文容量与生成额度混用，导致 note.repair_write 要求回传完整长篇正文时额度不足。短合成 Note 的既有真实模型用例另行指定 12,000 输出额度，不能证明此生产预算下的长 Note 成功。

本次在隔离配置中读取真实目标和当前建议，向真实 dev 默认模型提供同一完整源文与引文，强制返回专用写入参数但不执行任何工具。4,096 输出额度得到 finishReason=length、completionTokens=3,933，没有完整工具调用；12,000 得到 tool-calls、completionTokens=10,982，返回 13,199 字符完整修改稿和正确 expectedHash。结果保存在 artifacts/note-repair/dev-budget-analysis.json 与 long-note-output-probe.json，命令为 NOTE_REPAIR_OUTPUT_PROBE=1 npx vitest run --config .cache/note-repair-analysis.config.ts -t 'probes the real'，另以同配置 -t 'reports actual|late source observations' 取得修复前预算和已读竞争两项证据。旧诊断断言描述修复前行为，不能作为当前策略的回归用例。修改稿没有提交受管事务或复核，不记作实际修复成功；原目标 hash 保持不变。

输出额度解析现已修复，普通对话、蓝图与专用修复共用自动优先检测；上下文和最大输出完整时覆盖旧手动配置，缺少输出也会触发目录更新。两个入口先提示更新，尝试更新后仍缺资料或更新失败才支持填写双额度。生产路径不再用未确认的估算额度开始推理。策略由[模型目录决策](../../agent/model-registry.md)维护。当前代码只读验证真实 dev 缓存，得到 1,048,576 上下文与 65,536 最大输出；实际编排回归另验证 maxTokens=65,536 传到模型请求。读取/修复单元用例 32 项及额度界面 7 项通过，目标 Note 未写入。图谱旧 hash 下的自动已读确认仍有缺口，runtime 来源观察顺序已受 epoch 保护；模型结束原因的持久记录和长篇局部替换也未实施。

## 修复后的整体同步

定向修复继续由宿主执行完整闭环：读取并修改原 Note，校验实际写入版本与结构，再对修改后的来源独立复核。仅写入成功不清理建议；没有完整复核、复核失败或仍有问题时，保留实际待处理集合。顶部“有建议”按持有意见的 Note 篇数计数，单篇还有其他意见时仍计一篇。

审核运行时在建议持久化后立即通过 resultsChanged 发布当前分支的完整建议集合，不等待 Git 调度收尾或下一次整库读取。手动、自动、修复后的复核以及显式关闭意见都复用这条结果通知。顶部入口、画布节点提示和左侧建议面板订阅同一份状态，同 checkout 的大小写及分隔符别名同步更新；其他仓库或分支的通知不覆盖已显示结果。

前端分别比较建议、审核活动和阅读状态的 revision；较旧建议通知携带较新阅读版本时仍接收该阅读版本，保存结果补读也同步同 checkout 的路径别名。完整读取晚于结果通知返回时保留较新建议，避免旧问题复现；启动缓存晚于建议通知时仍补齐阅读计数，同时保留新建议版本。写入事件携带实际 afterHash，立即读取并交付这一篇原文，同时更新当前节点与瘦快照的对应版本；无须等待整库图谱。正文缓存只保存最近 16 篇交付结果，普通访问仍读真实文件；修复或来源变化可替代旧读取，迟到正文不覆盖新交付。当前正文也订阅同一来源事件，整库刷新失败时仍可单篇恢复。宿主已验证的写入与撤销通过 observeVersion 更新该 Note 的阅读记录并推送，不扫描整库、不代替首次完整基准，也不把 Agent 读取当作用户已读。

修复终态仅补读已保存建议，不再等待建议来源对账、审核活动或画布刷新。卡片分别展示正文和建议状态的同步进度，失败只重试对应部分；重试开始清除旧提示并禁用重复点击，后台成功交付也会清除对应旧错误，较晚的失败不能恢复已消除的错误。写入成功、复核仍有建议和界面同步是三个独立事实，不能互相覆盖。重新修复前只刷新当前建议，分支变化或刷新失败不从旧意见重新发起修改。

blueprint-sync 统一来源事件订阅与同一轮通知，建议读取按规范 checkout 合并，并在读取期间发生变化时至多合并为下一次读取；画布重新加载不再附带重复的建议来源请求。自动审核完成补读保存结果，完整来源对账继续由来源事件、显式刷新和兜底轮询维护。读展示与写入/审核的严格校验分开，后者仍校验实际来源和引文。

主进程完整读取与共享索引请求的等待上限为 12 秒，前端列表、正文和画布为 15 秒；BUSY 重试也受画布总期限约束。超时任务从合并表移除，重试可以启动新任务；建议对账、阅读状态落地和历史状态恢复在提交前检查取消信号，防止已失效的读取再应用观测。底层已经发出的文件 I/O 不保证强制终止，但失效响应不得发布到界面。工作区切换、新卡片以及版本变化继续隔离旧刷新结果。

## 实现与取舍

后端由 src/main/blueprint/note-reading.ts 维护阅读状态，review/runtime 复用同步快照并通过 IPC 发布结果；git-scheduler 提供自动审核目标。定向修复由 review/note-repair 校验并执行，note-repair-tools 装配受限工具，chat-orchestrator 在模型轮次结束后继续等待宿主复核再发送 stream_end。note-repair-turn 负责未写入的有限继续执行，note.repair_block 表达具体阻塞。前端 note-repair store、NoteRepairCard 与 BlueprintMaintenancePanel 维护交接与反馈。前端 BlueprintAttention、attention-model 与 blueprint-navigation 组织入口，BlueprintCanvas 和 useNoteNavigationMotion 协调来源、历史与视口，NoteWikiPanel/NoteReviewPanel 负责正文和精确详情。

使用既有列表、来源和阅读面板，避免另建通知历史与文档副本。hash 方案能发现外部编辑与离线净变化，但不能还原每次保存，也不能仅凭旧 hash 提供逐行差异。机械元数据变化同样产生更新，由批量已读处理；若实际噪声明显再评估变化分类，不能削弱审核输入版本校验。逐行差异、递归模块汇总与跨设备同步不进入首版。

## 验证与边界

### 修复展示与超时恢复回归（2026-10-12）

本轮定向 Vitest 按文件分组运行 npx vitest run tests/unit/<文件>.test.ts --maxWorkers=1 --minWorkers=1，去重 195 项取得通过结果：review-status 10、review-ipc 6、review-ui 34、note-repair 23、note-repair-ui 13、review-git 20、review-retry 7、review-engine 18、suggestions 17、note-reading 10、workspace-selection 15、workspace-init 14、note-refresh 6、note-source-sync 2（review、suggestions、note-reading、workspace 文件均有 blueprint- 前缀）。新增用例覆盖宿主超时释放与迟到观察隔离、写入和撤销的单篇版本通知、正文早于复审完成、两个同步域独立恢复、阅读与建议版本独立合并、路径别名和分支隔离，以及持续 BUSY 在 15 秒总期限内结束并可重试。最后三个文件 review-ui、workspace-selection、note-reading 共 59 项全量重跑通过，repair-ui 13 项通过。

Chromium 的 blueprint-attention.spec.ts 全套 17 项与 note-wiki.spec.ts 的两项正文场景通过，共 19 个不同场景。最终以 JANUS_E2E_PORT=42353、NO_PROXY=127.0.0.1,localhost 运行 npx playwright test tests/e2e/blueprint-attention.spec.ts tests/e2e/note-wiki.spec.ts --project=island --workers=1 -g 'committed re-review|repaired source|late source'，3 项通过；验证旧完整读取阻塞期间的计数、节点与正文同步，以及切换正文的迟到响应和新版本重读。使用模拟 IPC，未运行本轮真实供应商修复或完整 dev 桌面验收。

npm run build:check、npm run i18n:check 与改动源文件 ESLint 通过（0 错误；NoteWikiPanel 的 24 个既有中文直写警告保留，生成类型文件按规则忽略）。npx tsc --noEmit --pretty false 仍只有 note-mcp-server.ts:48 的 expectedHash 依赖类型错误。Note 链接与 corpus 校验为 296 篇、0 错误，保留 17 个既有外部链接提示与 24 个读取诊断。按 Windows CRLF 检查本次增量无空白错误。主进程改动需完整重启 dev；源码与文档保留在混合工作区，未将既有改动混入提交。

底层已发出的文件 I/O 与共享 NoteService 内部缓存更新不保证强制终止；超时隔离的是调用等待、后续持久观察和界面发布。图谱旧 hash 导致自动已读确认跳过的既有缺口仍见上文，不把本轮同步回归视为该路径已验收。

### 修复结果同步回归（2026-10-12）

定向 Vitest 五文件去重 80 项取得通过结果：blueprint-review-status 9、blueprint-review-ipc 6、blueprint-review-ui 32、note-repair-ui 10、note-repair 23；按文件分组运行 npx vitest run tests/unit/<文件>.test.ts --maxWorkers=1 --minWorkers=1，最后启动缓存合并改动使用 -t 'saved|committed' 重跑受影响的 5 项。运行时验证持久结果先于调度完成发布且不增加来源扫描；IPC 验证主进程、preload 与退订；Chromium 验证旧响应、路径别名、分支隔离、早到结果与启动缓存、慢建议读取不阻塞画布及同步失败提示。

JANUS_E2E_PORT=42345 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1 的原有 16 项通过；新增 -g 'committed re-review' 场景通过，共 17 项。新增场景使用真实画布与模拟 IPC，断言写入后的正文自动更新而建议暂时保留，独立审核结果发布后顶部计数、节点圆点与左侧建议一起清空，旧读取返回后保持新状态。未调用真实供应商，也未替代用户 dev 或多窗口桌面验收。


本轮 build:check、改动源文件 ESLint、Note 链接和 corpus 校验通过；296 篇 Note、0 错误，保留 17 个既有外部链接提示与 24 个读取诊断。增量差异无空白错误。tsc --noEmit 仍只有 note-mcp-server.ts:48 的 expectedHash 依赖类型错误。主进程与 preload 通知接线需要完整重启 dev 才生效；本次源码与文档保留在工作区，未将既有混合修改一起提交。

### 更新列表批量已读可用性（2026-10-12）

原按钮以整库 updates.complete 和最近读取无错为前提，后端 mark 也拒绝全部不完整快照。保存记录提前可见后，这条全局限制会让可用的更新一直不能提交；一篇无关 Note 格式错误也能阻塞全批。现改为按明确选中的身份校验，保留分支、请求版本与撤销隔离。

blueprint-note-reading 与 blueprint-review-ui 两文件 39 项通过（npx vitest run tests/unit/blueprint-note-reading.test.ts tests/unit/blueprint-review-ui.test.ts --maxWorkers=1 --minWorkers=1）；新增目标校验在旧实现上先失败，修改后通过，覆盖部分来源可读、首次基准限制、整批失败不写入、后到版本及撤销。浏览器专项使用 JANUS_E2E_PORT=42341 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts -g "acknowledges listed|bulk read is filtered|explicit mark-read" --project=island --workers=1。3 项通过，覆盖缓存/不完整/读取失败后的可点击、计数更新、保留已读行、筛选及撤销。首次新增用例的菜单标签定位错误已修正；后续暴露的缓存首屏已读行消失由冻结操作时列表顺序修复。build:check、两项改动源文件 ESLint 与 Note 校验通过；296 篇 Note、0 错误，17 个既有外部链接提示保留。类型检查仍仅有 note-mcp-server.ts:48 的 expectedHash 依赖类型错误。源码与文档留在混合工作区，未混入此前改动提交。

### 计数、首屏与节点切换回归（2026-10-12）

本轮五文件定向回归去重 65 项取得通过结果：blueprint-review-ui 30、blueprint-review-status 8、blueprint-review-ipc 5、blueprint-note-reading 8、blueprint-workspace-selection 14，使用 npx vitest run tests/unit/<文件>.test.ts --maxWorkers=1 --minWorkers=1 分组运行。新断言覆盖保存记录先于阻塞的全量读取可见、打开的列表随后补齐、同步错误和不完整状态下计数与保留内容一致、详情切换及回执不新增来源读取、迟到保存结果不覆盖新分支，以及工作区预读与画布请求同时发起。

JANUS_E2E_PORT=42337 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1 的原有 14 项通过；新增 -g "retains discovery" 场景通过，共 15 项。新增场景在真实 Chromium 画布点击两个可见节点，验证同步失败后的已有计数、列表内容和来源读取次数。使用模拟 IPC，未宣称完成用户 dev 数据或安装包验收。

本轮 npm run build:check、改动源文件 ESLint、双语与两项 Note 校验通过，296 篇 Note、0 错误，17 个既有外部链接提示和 24 个读取诊断保留；本轮差异无空白错误。npm run typecheck 仍只有 note-mcp-server.ts:48 的 expectedHash 依赖参数类型错误。i18n 标准生成器遇到 Windows UNKNOWN 写入错误，使用同一键展开/排序算法 r+ 原位生成并通过双语检查。主进程与 preload 的新读取/回执接口需完整重启 dev；未改动用户数据或将混合工作区提交。

### 列表刷新与启动读取回归（2026-10-12）

定向 Vitest 八文件去重 100 项通过：blueprint-review-status 7、blueprint-review-ui 26、blueprint-review-git 20、blueprint-review-retry 7、blueprint-workspace-init 14、blueprint-suggestions 17、blueprint-suggestion-query 1、blueprint-note-reading 8。按上述文件分组运行 npx vitest run tests/unit/<文件>.test.ts --maxWorkers=1 --minWorkers=1。覆盖三类刷新超时及恢复、迟到响应、来源事件补读、自动状态不等待全库读取、历史重试迁移、分支状态竞争、并发读取合并，以及启动预热/投影/审核共享一次冷索引构建。旧 retry 测试原先依赖空状态读取创建 checkpoint 文件，现改由 tick 建立夹具，7 项重跑通过。

JANUS_E2E_PORT=42329 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1，14 项通过，使用真实 Chromium 界面和模拟 IPC，未调用真实模型。来源读取的诊断样本与性能边界见[蓝图性能专题](../requirements/blueprint-performance.md)。本次不宣称已解决前述图谱旧 hash 与迟到观察导致的已读竞争。

npm run build:check、改动源文件 ESLint、npm run i18n:check、npm run check:notes 与 node scripts/verify-note-corpus.mjs 通过；296 篇 Note、0 错误，保留 17 个既有外部链接提示与 24 个读取诊断。相对于本轮备份的差异无空白错误。npm run typecheck 仍只有 note-mcp-server.ts:48 的 expectedHash 参数与依赖类型不符。改动和专题保留在工作区，未将这些路径中的既有修改混入提交。

### 读取后继续修复与详情入口验证（2026-10-12）

机器验证覆盖：note-repair.test.ts 的既有 17 项与新增 6 项通过，新增场景为分析结束后继续实际写入、部分分页读取后接续并修正相同正文、明确阻塞保留文件与建议、无进展最多三次执行、只读讨论/取消不继续、模型错误保留工具证据并释放端口。note-repair-ui.test.ts 9 项通过，包含提示按钮鼠标展开与键盘收起。janus-agent-ports.test.ts 23 项和 project-chat-context.test.ts 6 项通过。chat-turn-guard.test.ts 的四项修复专用链路通过，验证追加执行与终态先于唯一 stream_end。新增代码 lint 通过，build:check 通过。

真实模型隔离验证使用 dev 配置的 vertex-ai-1782113380280 / gemini-3.8-flash，通过生产专用编排、真实读写事务与审核引擎修复队列 Note，结果 resolved、changed=true、remaining=0；原始代码保持相同，文件、快照和差异回执的 hash 均为 db7b71e5f18abe6e45b1f3b5eb23d407b6b99c998af549cbb44e8c3b686a7573。验证持续约 60 秒，临时仓库已清理，结果写入 artifacts/note-repair/live-result.json。此次 JEV 关闭：尝试读取当前 dev 的加密 JEV 凭据时 helper 报 Credential unavailable，尚未完成带 JEV 的真实修复验证；没有修改 dev 的设置或凭据。

全量 typecheck 仍被 note-mcp-server.ts:48 的既有 expectedHash 参数类型不匹配阻止。本次聊天守卫全套运行涉及三项记忆捕获/访问断言失败；用修复前 chat-orchestrator 内容通过只读 Vite 加载替换复跑，同样三项失败，属于当前工作区既有状态。本轮只针对修复专用断言完成回归，不宣称整库验证通过。

### 整篇修复闭环验证（2026-10-12）

真实模型验证在独立临时仓库进行，使用 dev 当前配置的 vertex-ai-1782113380280 / gemini-3.8-flash。通过生产 Agent facade、专用读写工具、共享 Note 写事务和原 NoteReviewEngine：先对错误的队列描述产生 1 项意见，模型读取实现后实际改为内存队列描述，宿主复核返回 complete 并明确解决原问题，最终建议数为 0。原始代码不变，UUID/创建时间等稳定字段保留。实际文件、复核报告、Note 快照和差异回执的 after hash 均为 211fd0336f4b79bdab2696846fdf77e56464321120d8e63d8afa278fba285b51。临时仓库和测试会话已清理，未修改用户候选 Note。可复跑 tests/unit/note-repair-live.test.ts，需显式设置 NOTE_REPAIR_LIVE_CONFIG/PROVIDER/MODEL；结果在 artifacts/note-repair/live-result.json。

真实模型用例 1 项通过，运行 109 秒。独立 Electron 凭据助手读取 JEV 凭据失败，本次供应商闭环关闭 JEV，不把它记为真实 JEV 通过；开启 JEV 的审核发布由确定性端口测试覆盖，原 dev 设置未更改。只有真实 JEV 得到支持分数时才清理意见的生产规则保持有效，未放宽阈值。

定向测试去重 55 项：note-repair 17、blueprint-workspace-selection 14、note-repair-ui 8、janus-chat-conversations 12、chat-turn-guard 的 repair 专项 3 与真实模型 1，均取得通过结果。实际文件测试新增完整 facade→受限写工具→原审核引擎→发布→新快照链路，以及未写入、不完整读取被拒、持久终态和记录保存失败仍可收尾；开启 JEV 的确定性核验验证通过后清理两项。蓝图真实 store 测试验证写入前读取结束后补读新 hash，切换工作区不回跳；浏览器组件验证整篇、独立聊天发送/停止、详情折叠、输入框可见、减少动态效果、失败与重试。Janus 会话绑定另有 distinct viewId 的定向回归。

JANUS_E2E_PORT=41987 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts tests/e2e/note-wiki.spec.ts -g 'suggestion handoff|repaired source hash|late source responses' --project=island --workers=1，4 项通过：工作台/内嵌转移加载、迟到原文响应和现有预览在新 hash 下重读新正文。已查看 artifacts/note-repair 的真实工作台紧凑卡片与深色展开卡片截图，聊天输入框保留在底部。npm run build:check、改动源文件 ESLint、npm run i18n:check、npm run check:notes 与 node scripts/verify-note-corpus.mjs 通过。Note 检查为 294 篇、0 错误，保留 17 项既有外部链接提示与 24 项读取诊断；没有新增无法解析的引用。npx tsc --noEmit --pretty false 仍仅有既有 note-mcp-server.ts:48 的 expectedHash 依赖类型阻断。i18n 类型按原 flatten/sort 算法经 r+ 原位生成。未验收桌面安装包、多窗口与真实 JEV。受影响路径混有此前未提交/未跟踪实现，源码与文档留在工作区，未将既有内容混入提交。

### 卡片标签与更新提示验证（2026-10-12）

npx playwright test tests/e2e/blueprint-attention.spec.ts -g 'updates navigate smoothly|bulk read|suggestions precede' --project=island --workers=1，使用 JANUS_E2E_PORT=41981 与 NO_PROXY=127.0.0.1,localhost，现有 4 项通过，覆盖两个入口的已读确认、建议独立状态、批量已读与新版本保留。另以 Chromium 实际缩放检查：旧类型与工作区标签为 0 个，“有更新”右沿与头部右沿距离为 0，中文类型为“决策”，低缩放只显示菱形并保留完整悬停/辅助说明。已查看 artifacts/card-labels 的纸面、深色及低缩放截图。

BlueprintNodeCard 的 ESLint、npm run i18n:check 与本次增量空白检查通过。双语键保持同步；i18n:types 的普通文件写入在当前环境失败，已使用相同 flatten/sort 算法通过 r+ 原位生成。npx tsc --noEmit --pretty false 仍仅由既有 note-mcp-server.ts:48 的 expectedHash 依赖类型错误阻断。npm run check:notes 通过，292 篇 Note 为 0 错误，保留 17 项既有外部链接提示；未运行安装包验收。源码与专题保留在工作区，未混入此前改动创建提交。

### 定向修复首版验证（2026-10-11—12）

定向 Vitest 去重 117 项取得通过结果：note-repair 13、note-repair-ui 8、note-chat 24、blueprint-review-engine 18、blueprint-review-status 3、blueprint-review-ipc 4、llm/janus-agent-ports 23、blueprint-review-ui 21，以及 llm/chat-turn-guard 的修复专项 3 项。组合使用 --maxWorkers=1 --minWorkers=1，新增用例按文件或 -t 单独收尾。真实临时文件覆盖单项/多项、部分解决、空结果/覆盖不足/失败保留、讨论只读、完整分页、身份与分支、交接竞争、读取后外部编辑、取消、损坏 JSON、修改差异、精确撤销与撤销后重新复核。宿主专项验证最终结果先于唯一 stream_end 发布，以及复核失败与取消后已写入证据；前端验证重试不能重新绑定其他分支。模型通过真实 Agent facade 的测试传输调用受限工具，未调用真实供应商。

Chromium 的 blueprint-attention 与 note-wiki 共 16 个不同场景取得通过结果。收尾命令为 JANUS_E2E_PORT=41975 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts -g 'suggestion handoff|workbench gives|updates navigate smoothly' --project=island --workers=1，5 项通过。验证卡片实际位移、读取/调整/复核、单项计数、整篇修复、讨论、忙碌等待、切换工作区、减少动态效果、格式入口及取消后的宿主写入反馈。真实工作台和内嵌 BlueprintView 都断言卡片位于右侧顶部；artifacts/note-repair 保存动画途中、完成差异、深色及两个实际入口的加载截图，均已查看。

npm run build:check、改动源文件 ESLint、npm run i18n:check、npm run check:notes 与 node scripts/verify-note-corpus.mjs 通过。Note 校验为 292 篇、0 错误，保留 17 个既有外部链接提示与 24 个既有读取诊断；本次改动的空白检查为 0 错误。严格类型检查仍有 note-mcp-server.ts:48 的依赖参数类型与 janus/maintenance/service.ts:20 的未使用导入两项既有阻断。chat-turn-guard 全文件的三项记忆捕获/项目访问回调断言失败，在本次开始前的测试文件隔离重跑复现；修复专项 3 项通过，不把全文件记录为通过。

真实模型供应商、桌面安装包、多窗口与重启卡片恢复未验收。受影响路径包含此前未提交/未跟踪实现，本次源码与专题保留在工作区，未混入这些既有修改创建提交。

### 历史重试、提交次数与刷新反馈回归（2026-10-11）

本次在 Git、retry、UI、status、IPC 五文件分组运行，去重覆盖 54 项，全部通过；新增 7 项 retry 夹具以及自动完整恢复、来源同步前恢复和刷新等待两条读取的断言。Git 全文件 19 项先通过，新增自动恢复用例单独通过，调度与手动状态调整后重跑受影响的 7 项；retry/status 最终 10 项通过，UI/IPC/status/retry 的前次组合 31 项通过。具体命令为 `npx vitest run tests/unit/blueprint-review-git.test.ts --maxWorkers=1 --minWorkers=1`、`npx vitest run tests/unit/blueprint-review-retry.test.ts tests/unit/blueprint-review-status.test.ts --maxWorkers=1 --minWorkers=1`，以及相同 Worker 参数的 UI/IPC/status/retry 组合；Git 的新增与重跑范围使用 `-t` 限定。

`JANUS_E2E_PORT=41963 NO_PROXY=127.0.0.1,localhost npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1` 的 12 项通过。Chromium 组件断言确认 380px 顶栏提交计数在边界内、刷新旋转与禁用持续到两条读取都结束，失败可见且没有启动审核。

只读读取 dev 的 Git 状态与建议数据库，在临时隔离状态文件调用实际调度器：当前分支原有 1 个失败工作项，合并真实未完成报告后恢复 4 篇；模拟其中一篇覆盖完整且有意见后剩余 3 篇，重开并保留旧报告仍为 3 篇。模型调用 0 次，未手工修改正在使用的数据。已经丢失身份与报告的历史汇总无法还原，不由“上轮失败数”虚构 Note。

构建、改动源文件 ESLint、双语和 Note 校验通过，Note corpus 为 292 篇、0 错误、24 项既有读取诊断，链接检查保留 17 项既有外部提示。严格类型检查仍只有 note-mcp-server.ts:48 的 expectedHash 参数与依赖不符、janus/maintenance/service.ts:20 的未使用导入两项既有阻断。源码与专题已同步，因受影响路径含有本次之前的未提交/未跟踪实现，未将这些基线内容一起提交。

### 反馈、布局与结构审核回归（2026-10-11）

本轮运行 `npx vitest run tests/unit/blueprint-review-engine.test.ts tests/unit/blueprint-review-ui.test.ts tests/unit/blueprint-review-git.test.ts tests/unit/blueprint-note-reading.test.ts tests/unit/blueprint-review-ipc.test.ts tests/unit/blueprint-review-status.test.ts --maxWorkers=1 --minWorkers=1`，六文件 69 项全部通过。补充文件级诊断可操作性后，对三个文件运行 `-t 'keeps malformed known|manual feedback|shows two completed|retains only two actual rounds|distinguishes incomplete'`，4 项通过；两次去重覆盖 70 项。最终单独重跑 UI 文件，20 项全部通过。夹具缺少 project role、仓库名称和类型适用字段的问题已修正，不放宽共享校验规则。

`npx playwright test tests/e2e/blueprint-attention.spec.ts tests/e2e/note-wiki.spec.ts --project=island --workers=1` 的 14 项全部通过。环境使用 JANUS_E2E_PORT=41889、NO_PROXY=127.0.0.1,localhost。覆盖显式已读直接更新计数且不重复读取正文、旧版本/撤销、两轮/重试列表更新、建议置顶、目录移除后的关系/反链/上下文，以及 1500px 工作台左右各 360px 的实际网格宽度。已查看工作台与固定摘要截图，未调用真实模型。

`npm run build:check`、`npm run i18n:check`、改动源文件 ESLint 均通过；ESLint 0 错误、25 项既有中文直写警告。`npm run check:notes` 为 292 篇、0 错误、17 项既有外部链接提示；`node scripts/verify-note-corpus.mjs` 为 292 篇、0 错误、24 项读取诊断，未绑定外部引用不当作本地格式错误。严格未使用项类型检查仍有两项既有阻断：note-mcp-server.ts:48 的 expectedHash 参数与依赖类型不符，以及 janus/maintenance/service.ts:20 的未使用导入。保留大量既有未提交源码与文档，不将其混入提交。


已执行的定向运行时/组件用例去重共 57 项：

- `npx vitest run tests/unit/blueprint-note-reading.test.ts --maxWorkers=1 --minWorkers=1`：8 项通过，覆盖真实文件外部修改、归档 idea、重开、移动、分支/checkout、批量版本竞争、撤销和损坏状态。真实来源夹具补齐正式归档说明和 Intent 后通过。
- `npx vitest run tests/unit/blueprint-review-git.test.ts tests/unit/blueprint-review-ipc.test.ts --maxWorkers=1 --minWorkers=1`：本轮与 reading 文件一同执行，Git 11 项和 IPC 2 项通过；增加逐目标身份、失败阶段/原因、关闭自动后的保留、手动恢复及最新一轮引用持久化断言。
- `npx vitest run tests/unit/blueprint-suggestions.test.ts tests/unit/blueprint-suggestion-query.test.ts tests/unit/blueprint-review-engine.test.ts tests/unit/blueprint-review-ui.test.ts --maxWorkers=1 --minWorkers=1`：本轮与 reading 文件一同执行，这四文件共 36 项通过，覆盖复用来源快照后的现有建议、审核及设置行为。

`npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1` 的 9 项通过：内嵌和工作台的加载骨架、连续视口变换、卡片居中及缩放、聚焦和计数；窄画布重新定位；指定意见与失败原因、自动审核分组；读取失败后延迟重试和阅读位置返回；严格 IPC 版本参数下的筛选批量已读、全部更新批量已读、撤销及新版本；快速切换和减少动态效果。未调用真实模型。已查看两种主题的截图，确认浮层和聚焦呈现。

收尾运行 `npx playwright test tests/e2e/blueprint-attention.spec.ts tests/e2e/blueprint-v2.spec.ts tests/e2e/blueprint-module-focus.spec.ts --project=island --workers=1`，19 项全部通过。模块浏览与 Agent 定位回归由后两文件覆盖。首次双击 Reader 模块曾偶发未进入，未将复测通过解释为已修复根因；保留点击对象诊断，双击与延迟重试组合连续三轮 15 次通过。旧 note-wiki.spec.ts 有 1 项仍断言本次改动前面板已没有的 Knowledge wiki references 区域，相关源码和测试与任务前备份核对；该既有错配不冒充本轮通过。

`npm run build:check`、`npm run i18n:check`、`npm run check:notes` 已通过。Note 检查为 287 篇、0 错误，保留 17 个既有跨仓链接诊断。改动源文件 ESLint 为 0 错误，31 个既有中文直写警告。`npx tsc --noEmit --pretty false` 仍由 src/main/blueprint/note-mcp-server.ts:48 的 expectedHash 与已安装依赖的 readPage 选项类型不匹配而失败，该文件与本次开始前备份字节一致；未删去版本检查来掩盖错误。

桌面安装包、真实多窗口 IPC、大型多 checkout 性能及跨设备行为未验收；本轮证据是运行时测试、真实文件来源读取与 Chromium 交互，不能替代完整桌面验收。首版不提供历史逐行差异和跨设备同步。


### 两类筛选、两轮保留与建议置顶验证（2026-10-11）

本次定向用例去重 41 项取得通过结果：Git 调度 19 项、Chromium 组件 17 项、IPC 3 项、状态通道 2 项。组合命令为 `npx vitest run tests/unit/blueprint-review-git.test.ts tests/unit/blueprint-review-ui.test.ts tests/unit/blueprint-review-status.test.ts tests/unit/blueprint-review-ipc.test.ts --maxWorkers=1 --minWorkers=1`；组合运行中发现类型退出夹具不满足正式 Note 的字段/正文要求，修正夹具后以 `-t 'retires retry records'` 单独通过。随后新增的中断批次完成引用与自动重试期间保留用例分别定向通过，恢复读取竞争组件用例也再次通过；不把一次组合失败写成整轮绿色。

Git 用例覆盖第三轮淘汰、无变化检查不消耗窗口、失败和覆盖不足跨轮次/重开/关闭保留、失败原因更新、完整覆盖手动恢复成为新轮次、重复 Note 去重、旧状态迁移、提交确认类型退出或删除、中断剩余输入被替代，以及自动恢复运行期间重试入口持续存在。组件验证两类筛选、带意见/无意见统一完成、版本号不伪造审核记录、旧缓存不倒退成功状态，以及完成事件到达时等待旧读取后补读新详情。

`npx playwright test tests/e2e/blueprint-attention.spec.ts --project=island --workers=1` 首次 9 项通过，新增建议置顶用例因入口名称写错超时；修正定位后该项通过，10 个场景均取得通过结果。最后定向重跑 `-g 'suggestions precede|return restores reading position'` 的 2 项通过，覆盖正文前位置、普通访问折叠、摘要贴合标题下沿、建议直达展开、返回恢复建议展开与阅读位置。未使用真实模型。已查看固定摘要截图。

双语检查和 Note 检查通过，292 篇正式 Note 为 0 错误、17 个既有外部链接诊断。新增核心源文件 ESLint 为 0 错误；旧 NoteWikiPanel 的中文直写警告保留。严格未使用项类型检查仍被 src/main/blueprint/note-mcp-server.ts:48 的 expectedHash 参数类型和 src/main/janus/maintenance/service.ts:20 的未使用导入阻断，本次新增错误已清除。桌面安装包、真实多窗口和大规模工作区性能未验收。工作区有大量既有修改及未跟踪源码，本次保持改动和文档在工作区，未创建提交。

## 修复闭环实施验证（2026-10-12）

本轮以任务开始时的逐文件备份核对增量，保留工作区既有混合修改。源码、双语文案与上述设计已同步；用户 dev 数据和示例需求 Note 未被手动改写。

Vitest 使用 `--maxWorkers=1 --minWorkers=1` 分组验证：`note-repair` 既有 24 项通过，新增仅更新时间的零修改复审 1 项单独通过；`note-repair-ui` 15 项、`blueprint-review-ui` 34 项、`blueprint-review-engine` 20 项、`blueprint-suggestions` 20 项、`blueprint-suggestions-process` 2 项、`blueprint-review-git` 20 项、`blueprint-review-status` 10 项、`blueprint-review-ipc` 6 项、`blueprint-review-retry` 7 项和 `janus-chat-shortcuts` 4 项取得通过结果。`llm/chat-turn-guard` 的修复专项 4 项另行通过。覆盖完整空报告清旧项、新版建议替换、持久待复审、零修改确认、复审独立重试与字节不变、来源/分支冲突、低分/失败/迟到 JEV 不改变结果，以及发布时只有代码依据不同的 Git 报告立即过时。

Chromium 命令 `npx playwright test tests/e2e/note-wiki.spec.ts tests/e2e/blueprint-attention.spec.ts --project=island --workers=1` 使用 `JANUS_E2E_PORT=42361` 和 `NO_PROXY=127.0.0.1,localhost`，21 个场景通过；随后新增内嵌/工作台操作区的 2 个场景通过，并复跑原文/Tab 场景。合计 23 个不同场景取得通过结果。验证真实布局、右对齐、悬浮颜色、Tab 焦点、390px 源文控件、复制成功/失败与切换状态。已查看深色/纸面截图，保存在 `artifacts/blueprint-repair-flow`。测试同时发现并修复工作台聊天拦截左侧 Tab 的问题。

构建检查、双语检查和 Note 检查通过。全局类型检查仍由既有 `src/main/blueprint/note-mcp-server.ts:48` 的 expectedHash/readPage 依赖类型错误阻断。改动源文件 ESLint 无错误，NoteWikiPanel 保留 24 项、JanusChat 保留 4 项既有中文字面量警告。额外运行整个 chat-turn-guard 文件发现 3 项记忆捕获/上下文断言失败，使用 `.cache/blueprint-baseline-vitest.config.mts` 只读加载本轮之前的备份代码后，相同 3 项失败复现；未扩展到记忆模块修复。未调用真实 Gemini/JEV，未验证安装包、桌面多窗口或大型工作区总耗时；主进程和 preload 修改需要完整重启 dev 后才生效。
