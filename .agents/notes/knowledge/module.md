---
{
  "schema": "harness-note/2",
  "id": "c1c04881-a2fb-430f-bc26-528027d0e5cf",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-10-03",
  "class": "architecture",
  "tags": ["memory","knowledge"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/memo/store.ts",
      "symbol": "MemoStore",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/memory-domain-controls.ts",
      "symbol": "installMemoryDomainControls",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/processing-queue.ts",
      "symbol": "KnowledgeProcessingQueue",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/knowledge/retire-engineering-assets.ts",
      "role": "implementation"
    }
  ],
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8688b5ab-1f7f-5ff9-ba1b-ef75b7fd5917"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/844bc2f1-3be4-4b47-83ca-0ef792bc5c1d"}
  ],
  "updated": "2026-10-30T09:35:54.334Z",
  "moduleState": "partial"
}
---

# 个人记忆与共享来源

## Responsibility

维护个人记忆的采集、可靠写入、候选确认、纠正、遗忘、来源审计、画像和对话召回，以及应用内持久备忘录的内容组织与 Chat 联动。工程知识以[原始 Note 与蓝图](../blueprint/module.md)为准；旧工程知识提取、Wiki 生成/历史、图谱、检索和独立知识 MCP 已退出。

## Design

备忘录入口与新 Chat 轮次工具默认可用，不受旧实验开关控制；具体行为由[备忘录专题](user-todo-janus.md)维护。

备忘录与展开主岛的外框共用集中主题令牌，纸面主题采用一致墨线与硬偏移影，深色采用一致暗底与弱边框；内部画布取消重复外框。实现与双主题验证见[Chat 联动备忘录](user-todo-janus.md)。

PersonalMemoryWorkbench 保留个人卡片、资料编辑、搜索、来源和审核；右侧助手只消费个人候选。persona 与个人子设置控制采集、处理和召回，关闭功能保留已有个人数据。人工确认不受蓝图模型或工程开关控制；具体策略见[分域控制](memory-domain-controls.md)。工作台扩展和全终端自动 Hook 接入仍按[个人方向](personal-memory-workspace.md)后置。

KnowledgeProcessingQueue、观察存储、候选事实锁、审计、撤销与恢复服务继续服务个人记忆。确定性处理不再从项目事件生成工程事实，工程 recall 端口返回空结果，Chat 已移除旧项目记忆访问计数；个人 BM25 召回仍在内存使用。显式个人保存、替代、纠正和遗忘沿用现有来源与版本检查。

共享终端 Hook 的状态处理继续运行。只有个人画像开启且既有 inferEngineeringHabits 选项允许时，工程对话的可归因用户消息进入习惯证据；CaptureInbox 在持久化与重放前筛选，助手正文、工具结果和状态摘要不再作为新工程知识积累。个人会话的已有近期记录策略保持，其扩展讨论不混入本次退出。

retireEngineeringAssets 在创建窗口前清理明确由旧工程业务生成的 Wiki、graph、旧索引、automation-tasks 和提取中间文件；混合事实按 scope/provenance 保留 user 与不明记录。路径限制在知识存储根内，不跟随链接；原始观察、审计、个人 profile、blobs、模型下载和配置保留。该迁移幂等，失败保留来源并在以后启动重试，不删除整个 knowledge 根。

旧知识模型生成与审核封装、本地模型安装／检测／运行时及其四个控制接口已删除，旧凭据封装不再加载；已有模型文件和加密凭据不自动删除。蓝图审核与 MCP 配置由蓝图插件负责，通用 llm/model-json 保留。旧知识审计、撤回历史与状态栏组件及专用测试已移除，个人审核和来源撤回后端继续保留。旧 Wiki 历史／关系工具和知识卡片转换模块退出，共享数据结构中仍被事实存储、迁移与审计使用的历史字段继续可读。

[Chat 联动备忘录](user-todo-janus.md)以独立文件组织星节点与记录，人工编辑和模型工具共用局部操作及修订检查。renderer store 维护每个文件的当前选星；发送与流式追加分别捕获选择，上下文按消息归属，已删目标不自动改投。真实 Electron 的 Chat 增／改／删、切星后新增及落盘回显已由脚本化 HTTP 模型验证，真实模型的指代理解仍待验收。

Laya 已于 2026-10-30 按用户决定退出：删除 Python sidecar、模型清单和依赖、运行时及校准、IPC、设置组件、翻译和打包规则。旧配置的 Laya 字段在标准化时丢弃，不再注册或启动该评分器。个人人工审核、来源校验、遗忘和 BM25 保留。专用测试和评测入口退出，固定样例与历史报告仅作研究记录；其他评测提供方不再依赖 Laya。旧二进制需重新构建，用户自选模型与 Python 环境不自动删除。历史范围见[统一记忆记录](requirements/unified-memory-laya-primary.md)。

## Validation

2026-10-30 旧模块清理验证：删除旧本地模型接口后 Knowledge IPC 共 33 个，回归确认旧部署接口未注册、未暴露；个人写入和撤回首轮 47 项通过，后续主题／个人资料／纠正／遗忘／资产退出及任务 IPC 9 个文件 69 项通过。类型、源码 ESLint、i18n、打包边界和排除规则检查通过。3 项 Chromium 回归覆盖现用图片预览和两类 Chat 的隔离及工作区切换。Note 校验 0 错误、保留 17 条跨仓库链接诊断；删除前源码与专用测试通过固定 Git 链接保存，不再把测试夹具挂载旧界面视为生产功能。未执行真实模型、完整 verify 或重新分发 EXE。

2026-10-30 Laya 退出验证：`npm run typecheck`、`npm run build:app`、`npm run check:package-boundary`、`npm run i18n:check` 和变更源码 ESLint 通过。8 个相关单元测试文件最终共 124 项通过，覆盖 IPC、配置旧字段丢弃、迁移、打包边界、决策与精修、人工审核。Python 比较脚本 `--validate-only` 读取 52 条样例通过；未运行真实模型。Note 检查 0 错误，保留 17 条跨仓库链接诊断；主题审计因已有桌面通知和存储面板样式的 9 处新增颜色违规失败。未重新生成便携发布包，已清理用户指定旧发布目录中的三个 Laya 适配文件。

个人记忆、来源撤销、旧资产迁移、Hook、Chat ports 与蓝图建议的组合回归通过。实际数量、命令范围、真实模型结果及未验收项统一见[实施基线](../blueprint/implementation-baseline.md)。迁移测试使用隔离数据，未手工清理真实用户存储。

## Related documents

[个人工作台](personal-memory-workspace.md)维护后续产品边界；[个人与工程分离](personal-engineering-separation.md)保留隔离依据；[记忆演进研究](requirements/memory-knowledge.md)、[统一内核研究](requirements/unified-memory-laya-primary.md)与[旧方案资料](history/reconstruction-index.md)保留历史要求和实验，不再描述当前工程生成管线。[旧知识审核交付 Task](tasks/knowledge-review-status-audit-plan.md)已是 archived，仅保存原验收契约和执行记录；保留 tasks/ 路径不表示仍在排期。

[Chat 联动备忘录与线性里程碑](user-todo-janus.md)提供人工与模型共用的持久化、局部编辑和修订检查。v3 不保存工作区或未归入字段；旧 v1／v2 首次读取时按用户确认原子升级并删除未归入记录，修订增加一次，保留星内身份和来源；Chat 资源只服务会话上下文。备忘录入口嵌入 Chat 输入区的工具栏，以小图标唤出；模型参数提供无共享引用的 Vertex 兼容声明，写入仍使用严格操作校验。MemoPanel 在 Chat 左侧按 CSS 视口联合分配并排、上下排列或单工作面，手动收缩文件栏只改变岛内分配，两岛外框保持固定。下方用星点、连接和引线标题表达有序节点，文字和引线由同一星按钮定位，星间连接在屏幕坐标中为标注及引线留白，四向标签择位，星和连接由同一帧位置更新；未归入入口及记录已移除，所有记录必须归属某颗星，空态先建星；点击空白就地输入并预览插入／追加，保存成功后新星从点击处飞入，稳定布局仅局部让位；选中星菜单可排序或一次原子删除星及全部记录。上方逐条显示选中星记录，隐藏重复文件名并保留数量信息，右上角行内添加，编号文本行、保存反馈及行菜单支持连续编辑，正文滚动条采用稳定槽位和中性滑块，节点下拉复用共享 Select 并适配深浅主题及键盘操作；星座通过滚轮缩放、中键平移浏览，保留键盘及冲突草稿。memo 与圆桌已接线附岛共用展示生命周期、可见内容编排和最终几何。会话一一绑定备忘录，切文件或主动退出开新会话，旧回复可后台完成；展示隐藏及同文件切星不退出。memo_read/edit 与未绑定会话的 memo_create 已通过 janus-agentX 宿主工具端口并入正常 Chat 轮次，有／无工作区均可使用。明确的新建请求创建应用内文件并绑定发起会话，保存／重载保留 memoId；备忘录目标标记排除项目 Note 写入，混合目标需分开处理，不能用 Note 替代不可用的备忘录。[设计评审](milestone-design-review.md)维护取舍及结果，命令与证据由专题维护。新交互的实际单元、浏览器和桌面验证结果由专题当前验证节维护；真实模型整理质量、完整发布 verify、系统 DPI、多显示器和真实输入法仍待专门验收。生态读取、提醒、项目代码核对及归档／移除继续后置。

## Acceptance criteria

- [x] AC-1: 队列与个人召回职责可定位到当前代码，工程专用生成和检索入口已退出。
- [x] AC-2: 当前能力、后置个人建设与未验收项分别说明，不以旧模型实验替代新审核验收。
