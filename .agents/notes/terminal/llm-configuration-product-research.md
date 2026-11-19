---
{
  "schema": "harness-note/2",
  "id": "e2a9b560-4e29-4f8c-a62b-c014461fd70e",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-11-16",
  "updated": "2026-11-16T08:21:11Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570"
}
---

# LLM 配置产品研究：CC Switch、Magpie 与 JanusX

## Intent

用户希望将 LLM 配置作为 JanusX 的重要功能，并考虑服务商推广这一收入渠道。本研究读取 CC Switch、Magpie 的公开源码，检查官方截图，再对照 JanusX 当前工作树，提炼功能和交互改进。建议尚未成为实施决策；不替代[当前共享渠道设计](./terminal-provider-collections.md)及[原生登录实现](./native-login-first.md)。

研究固定于 2026-11-16 取得的提交：

| 项目 | 研究版本 | 实际阅读重点 |
| --- | --- | --- |
| CC Switch | `fc3eb797c72e054d554eea6a2e7a8b93933c6ac5`；package.json 为 4.0.33 | React 预设选择、供应商卡片、切换模式、推广元数据、深链接导入；Rust 配置写入和恢复、连通检查 |
| Magpie | `56c988cb5e5aa25ca6306cb4b723c60bcf753733` | Go 的 provider、agent、gateway、profile、导入和合作伙伴机制；GUI 的 app.js、模型选择器及官方截图 |
| JanusX | 当前工作树，包含用户已有的未提交修改 | LlmConfigModal、CliSyncSection、配置服务、ConnectionProjector、JanusChat、ComposerOptions、模型目录 |

上游源码克隆保存在系统临时目录 `janusx-llm-source-research`，未安装或运行上游应用，也未对其网关、账号授权和协议转换做端到端验证。官方截图用于观察层级和布局，可能落后于对应提交；当前行为以源码为准，尤其不能把 CC Switch 旧添加页截图当作最新预设选择器。

JanusX 使用现有 `tests/e2e/island-harness/settings.tsx` 在浏览器中渲染真实设置组件，以模拟 IPC 和虚构凭据完成操作。验证了前端路径，不代表真实网络连通、凭据有效性或 Electron 写盘成功。源码和 Notes 通过限定目录的原文件检索读取；没有使用共享 wiki 服务，阅读范围内未发现阻塞本研究的未解析 Note 引用。

## 核心功能：两款产品的重心与共同基础

CC Switch 当前以应用为入口：先选择要配置的 CLI 或桌面客户端，再管理该应用的供应商及工作模式。它不仅有配置文件切换，还具有本地路由和聚合模式。界面需要同时表达“正在查看哪个模式”和“哪个模式实际生效”。Rust 写入层包含关键字段补丁、应用写锁、操作记录及未完成操作恢复；保留用户其他配置，是可见的一键切换成立的基础。见 [C1]、[C2]、[C3]。

Magpie 以统一模型资源和本地网关为基础：用户添加供应商、订阅或本地服务，再将模型提供给不同 Agent。provider 记录不同协议入口、凭据及对外展示的模型；agent 适配器处理各工具的配置；gateway 接受不同协议并承担请求转发与转换。GUI 的 Agent 行直接提供模型选择和接入状态，托盘面板复用日常操作；profile 保存一组 Agent 字段、模型列表及资源库配置。见 [M1]、[M2]、[M3]、[M4]。

| 功能层 | CC Switch 的主要实现 | Magpie 的主要实现 | 对 JanusX 的意义 |
| --- | --- | --- | --- |
| 服务接入 | 按应用组织预设，含套餐、地区、协议、获取 Key 页面 | 供应商统一接入，区分订阅、API、第三方及本地来源 | 添加入口应先帮助用户找到正确服务，再显示必要字段 |
| 日常选择 | 供应商列表直接切换；卡片按模式呈现操作和当前状态 | Agent 行直接选择模型；跨来源搜索、收藏、分组 | 设置表单和高频选择应分工；保留来源身份 |
| 配置可靠性 | 关键字段补丁、写锁、pending 操作及恢复 | 每种 Agent 的适配、接入与解除接入处理 | 成功提示必须建立在实际写入确认上 |
| 模型组织 | 应用专用配置、模型元数据和聚合列表 | 模型发现、筛选暴露、显示名、推理档位、Agent 自有列表 | 已发现、已加入、被当前凭据验证可用，是不同状态 |
| 请求运行 | 可选本地路由、聚合及故障转移 | 网关、协议转换、账号与路由组 | 属于单独的运行时工程，不能由 UI 暗示已经具备 |
| 辅助生态 | MCP、Skills、提示词、授权、用量、会话等 | 资源库、插件、用量、会话、隐私处理等 | 都已超出基本模型配置，不宜一次纳入 JanusX 改版 |
| 推广接入 | 合作标记、Key 获取链接和可确认的配置导入 | 独立合作伙伴区、远程列表、获取 Key 页面、导入及计数 | 商业入口可以贴近用户接入动作，不必先完成网关和账号池 |

两者共同值得提炼的基础是：接入服务、验证结果、选择连接与模型、明确生效范围、失败后仍保留可理解的状态。不能从功能存在推断其用户转化率、收入或稳定性优于 JanusX。

## 值得学习的 UI 交互

### CC Switch：分阶段添加，列表承担日常操作

最新 `AddProviderDialog` 和 `ProviderPresetSelector` 明确区分 `pick` 与 `form`。预设阶段常驻搜索，按来源分类；同一家服务商的多个套餐或地区可归成一行，再在表单内切换具体版本。选完后，完整目录收为预设摘要条；用户可以返回更换。切换版本可能覆盖已编辑表单时，会询问是否继续。这样浏览服务目录和填写连接参数不再争夺同一屏空间。见 [C1]。

预设搜索匹配名称、显示名、域名及别名。当前源码按名称排序，明确不再按官方或赞助商置顶；旧截图中的星标不能据此解释为当前排序规则。合作关系仍通过 `isPartner`、`partnerPromotionKey`、`apiKeyUrl` 等字段表达。见 [C1]、[C4]。

供应商列表把当前状态、主操作和编辑放在同一行，复制、检查、用量和删除等放到更多菜单。卡片呈现由 `presentation.ts` 根据模式和应用能力计算，避免所有条目一律出现同样的按钮。`ModeTabs` 的选中外观表示正在查看，模式色和圆点另行表达实际生效；这一细节值得学习，但三种模式会引入新的概念成本。见 [C2]。

### Magpie：围绕 Agent 行上的“当前模型”操作

`openPicker` 在字段旁打开选择器，保留当前值、来源分组、收藏入口和手动模型 ID。搜索同时利用名称和来源信息；键盘支持方向键、Enter 和 Escape。当前模型被提到靠前位置，同名模型仍显示来源信息，避免用户误以为相同名字代表相同连接。见 [M1]。

`setPick` 先显示本次选择，再异步写入；后端拒绝时恢复旧值。序列号避免较早请求的结果覆盖较晚选择。这种立即响应的体验依赖明确的失败回退和并发处理，不能只给下拉框增加动画。JanusX 可以借鉴，但外部写配置仍应清楚显示写入中、已写入和需要重启的区别。见 [M1]。

供应商添加区按用户拥有的资源组织：订阅登录、API 服务、第三方和本地服务。官方截图可以看见这种分组；当前源码还增加了独立 Partners 区。供应商编辑页可展示正在使用它的 Agent，并从该位置进入模型调整，让“服务从哪里来”与“谁在使用”之间可以直接导航。见 [M1]、[M5]。

模型列表支持检索、挑选加入、全选与清除、手工 ID、单模型测试及批量测试。协议检测会发起小请求，按 API 和模型报告结果；支持某一种协议不能直接推广到该服务的所有模型。测试和自动检测会产生真实请求，应由用户明确触发。见 [M6]。

### 不能直接复制的前提

Magpie 将各种来源放进同一个可选列表，背后是完整网关。JanusX 目前 `supportsChannel` 按单渠道协议限制 Claude、Codex 等消费者，没有对应的跨协议转换能力。界面应提供兼容过滤和原因说明，直到运行时真的支持转换。

CC Switch 的多个模式、托盘与授权中心适合独立管理工具；JanusX 已有工作区、设置、模型目录和会话菜单，直接叠加相同导航会加重层级。应提炼操作方式，并复用现有组件。

## JanusX 当前交互诊断

下表的“观察”来自本地源码及浏览器夹具，影响程度属于设计判断，没有用户行为统计支持。

| 优先级 | 观察与证据 | 对用户的影响 | 建议 |
| --- | --- | --- | --- |
| P0 | 空状态落在 Agent 使用页；添加入口进入渠道页，保存后返回列表，Janus 绑定仍为未配置。浏览器完整走过添加、获取模型、测试、保存后确认此状态 | 配置信息保存成功，却没有完成用户希望的“开始使用” | 从目标 Agent 发起添加，保留目标；提供明确的“保存并用于 Janus/此 Agent”，同时保留仅保存选项 |
| P0 | `native` 同时表达沿用已有配置与官方登录；检测 `logged-out` 时禁用应用。夹具确认禁用状态 | 已有 API 或外部网关配置的用户可能被官方登录条件挡住 | 将“沿用 CLI 当前配置”“官方登录”“由 JanusX 配置连接”作为独立意图；凭据文件缺失不能代表所有连接都不可用 |
| P0 | 新渠道初始化为 OpenAI / Responses；用户尚未选择服务就进入填满预设的表单，名称非空还使添加页面显示“编辑渠道” | 用户容易把默认值当作已作出的选择；创建与编辑反馈不准确 | 先选服务；区分创建/编辑身份；自定义服务让用户确认实际协议 |
| P0 | 渠道保存、Agent 应用、模型可调用、运行会话使用什么，是不同状态；目前主要依靠提示文案和待重新应用标记 | 用户难以判断“现在到底能不能用、正在用谁” | 分开显示已保存、验证结果、已写入、新会话生效；运行状态未知时保留未知 |
| P1 | 配置页先选渠道，再用文本框输入模型；少量模型是按钮，多于八个变下拉；模型编辑又是多行文本框 | 用户需要在多种控件之间切换心智模型，跨来源比较也不方便 | 统一搜索型模型选择器，以连接 ID + 模型 ID 作为身份；支持来源筛选和手动输入 |
| P1 | 获取模型把结果并入文本框；发现、挑选常用和证明可调用没有明确分工 | 返回大量模型时难以整理；列表中出现容易被误解为可用 | 展示可搜索的发现结果，选择加入常用；模型测试结果单独显示 |
| P1 | `choosePreset` 更换地址和协议、清空模型，但沿用旧 Key。浏览器验证了 Key 保留和模型清空 | 新服务可能带着上个服务的凭据进行测试；用户编辑内容也可能突然消失 | 同服务切地区与跨服务切换分别处理；保留草稿，明确确认哪些字段会变化 |
| P1 | 全局设置侧栏、Agent/渠道页签、Agent 列表、右侧编辑表单多层并存；当前新增页在 1280×800 中主要操作位于滚动区域下方 | 重要操作被导航和长表单分散，用户反复寻找下一步 | 保留整体设置导航；服务目录与编辑分阶段，压缩重复标题；主操作在编辑区可持续找到 |
| P1 | `LlmConfigModal` 顶部状态主要描述内部默认模型，但页面还可配置其他 Agent | 容易把内部模型状态当作当前所选 CLI 的状态 | 明确“Janus 内部连接”，其他 Agent 各自展示状态与检查范围 |
| P2 | 正文及辅助信息使用 13px、12px、11px 等多级小字号；存在 LLM 引擎、模型目录、渠道、Agent 使用等术语 | 层级依赖较小文字，用户需要先理解内部分类 | 沿用设计 tokens 提升关键文字可读性；解释模型资料目录与已连接服务的区别，验证术语理解 |

已有优势应保留：共享渠道加独立绑定、凭据遮罩、真实模型测试、配置日志及恢复、协议兼容限制、引用中的渠道删除保护、跨页草稿保留。主问题集中在这些能力没有串成顺畅的任务路径。

Janus 对话区也已经存在搜索、来源信息、分组和键盘选择：`JanusChat.tsx` 与 `ComposerOptions.tsx` 负责相应呈现。不同 composer 分支的范围有所区别，配置页应优先对齐现有选择模型，而不是另写一套独立系统。模型目录当前提供模型资料，并非当前凭据可调用清单。

## 已明确的共享配置、独立选择与混用要求

用户明确希望保留 Magpie 式“一次维护连接、多个 Agent 可使用”的配置方式，同时每个 Agent 由用户独立选择是否使用 JanusX 的连接。添加渠道不等于启用所有 Agent；为 Claude Code 选择渠道不得连带改变 Codex、OpenCode 或 Pi。多个 Agent 可以在分别选择后共享同一连接和凭据，各自选择兼容模型。

支持混用是明确要求：例如 JanusX 配置 Claude Code，Magpie 配置 Codex。外部工具的连接无需导入 JanusX，JanusX 不因刷新设置、编辑其他渠道、启动或退出应用而接管外部管理的 Agent。用户还希望评估两个 Claude Code 会话分别使用不同渠道，技术方向见[会话模型连接隔离](./session-model-connections.md)。

### 补充发现的问题

当前配置文档已经使用共享 providers 与逐 Agent bindings，ConfigurationService.apply 接收单个 consumer，ConnectionProjector 按 consumer 生成对应文件计划。这为按 Agent 类型隔离提供基础，但目前仍写该 CLI 的共享配置文件，尚不能据此宣称同一 CLI 不同会话独立。

从 JanusX 管理切回 native 会调用恢复原值流程；如管理字段已被外部修改，ConnectionProjector 拒绝恢复，并提示先重新应用 JanusX 渠道。这保护了外部值，却缺少直接交接控制权的路径。应支持“保留当前配置，停止由 JanusX 管理”，不要求用户先覆盖外部设置。它与“恢复接管前配置”是两个不同动作。

共享渠道的编辑也有现存语义差异：内部 Janus 按 provider ID 直接读当前连接；外部 CLI 在重新应用前仍使用上次写入值。因此“修改连接会影响谁、何时生效”必须表达清楚。运行会话采用连接快照属于建议方案，不能把共享服务的额度、凭据吊销和故障宣传为彼此隔离。

### 已讨论的交互调整项

| 项目 | 拟调整行为 |
| --- | --- |
| 每个外部 Agent 的来源 | 先选择“由 JanusX 配置”或“沿用已有配置”，再在前者中选择渠道与模型 |
| 官方登录 | 作为独立操作；沿用外部 API/网关配置不以官方凭据文件存在为前提 |
| 保存并使用 | 只应用于当前明确选择的目标，默认不选中全部 Agent |
| 外部管理状态 | 显示沿用已有配置；仅凭 URL 不强行认定由 Magpie 或其他工具管理 |
| 外部改动处理 | 提供保留外部现状并退出管理、主动重新接管等明确操作；不自动修复或覆盖 |
| 共享服务 | 展示正在使用它的 Agent；地址、Key 和模型列表编辑后明确受影响对象与应用时机 |
| 多协议服务 | 评估同一服务连接下组织多个协议入口，减少同一家服务重复填写凭据；协议转换另行评估 |
| 会话选择 | 评估新建时选择本会话渠道/模型，在会话处持续可见，并与该 Agent 的新会话默认值分开 |

Magpie 可借鉴的是显式接入/解除接入、记录外部漂移、保留现状与重新应用分开的控制权表达。其 Agent.Disconnect 持久记录用户退出意图，避免后续自动同步把该 Agent 再接入。具体证据见 [M9]；不是对其所有同步行为作无冲突保证。

## 推广与变现：源码可以支持的结论

CC Switch 预设直接保存服务官网、获取 Key 链接、合作标记和优惠文案 key。深链接将服务商控制台接到配置导入，导入确认与是否立即应用分开。这里的商业价值来自减少从推荐到实际接入的操作，而不只是增加展示位。源代码证明这些机制存在，不能证明每家合作的收费方式或收入金额。见 [C4]、[C5]。

Magpie 使用独立合作伙伴来源：远程列表定义服务预设、介绍、多语言和展示时间，缓存保留已退出合作服务的资料，以便既有配置继续解析。添加页面明确独立分区；源码还按天统计展示、打开、Key 页面打开、从预设添加等事件，并受统计开关控制。它说明商业运营资料可以独立于应用发版维护，但也引入远程内容验证、缓存、失败降级和计数维护成本。见 [M7]。

Magpie 还能解析 CC Switch 的供应商导入链接：只提取可表示为 provider 的地址、协议、模型与凭据等字段，放弃不属于 provider 的任意客户端设置，并经过自己的确认流程。这是复用既有渠道分发入口的具体例子。见 [M8]。

JanusX 可先采用服务商预设 + 清楚标注的合作入口 + 获取 Key 链接，再建设结构化配置导入。是否兼容 `ccswitch://` 的数据格式可以单独评估；即使兼容格式，也不应抢占他人 URL scheme，优先使用自己的导入协议、粘贴导入或文件导入。导入只接受声明的连接字段，展示将新增/更新的内容及应用对象；不自动执行任意配置或静默接管已有 Agent。

要衡量完整路径：推荐展示、访问服务商、完成添加、首次成功调用，以及可获得可靠回传时的注册或付费。点击和添加不能当作已经获得收入。统计范围和开关应明确，不需要收集提示词或 Key 来完成这些计数。

## 建议的开发顺序

### 第一阶段：补齐接入流程和状态表达

保留统一渠道与外部 Agent 管理，但区分默认沿用 CLI 配置和主动托管。将设置的主要任务表述为“连接服务”和“给 Janus/Agent 选择模型”，不要求用户先理解存储结构。

建议的完整路径为：从目标 Agent 或 Janus 发起添加 → 搜索选择服务商/自定义服务 → 填必要凭据 → 获取并选择模型，或手动输入 → 测试选中模型 → 保存并用于目标。跨阶段保留目标和草稿，失败停留在能够修改问题的位置。仅保存同样可用，测试不成功不应强迫丢弃草稿。

服务商目录中将合作服务、官方 API、本地服务及自定义接入清楚组织；协议和地址可以由可信预设填写，高级参数逐步展开。首次为内部 Janus 配置时，可让保存并启用成为明确主操作；外部 Agent 首次接管则说明影响的应用和配置范围。

成功以实际能力表达：测试响应仅证明测试时该模型可调用；配置写入成功仅证明相应文件已确认；旧会话是否采用新配置以运行时证据为准。编辑共享渠道后列出受影响的 Agent，提供按对象重新应用及分别显示结果，避免用户逐个寻找。

这一阶段完成的判定：首次用户能从空状态走到模型可调用；已有外部 API 配置的 CLI 不被官方登录强制挡住；保存、应用与新会话生效彼此可辨；失败后用户仍保有填写内容。

### 第二阶段：统一日常选择，承接推广导入

复用对话区已有模型选择呈现，统一来源、搜索、键盘操作和当前状态，再增收藏/最近使用。模型显示名称可友好化，但不能改变真实 model ID，来源不确定时不得假装它已确认。

服务管理提供发现模型、选择加入、单模型测试、使用对象和编辑入口。添加成功后提供直接开始 Janus 对话或新建相应 Agent 会话的下一步。官方 API、用户自定义连接和合作服务遵守相同的可用性判断。

合作接入先做准确的获取 Key 页面和可确认的结构化导入；存在实际运营需求后，再将合作目录做成远程数据源。商业标签独立于验证结果、模型质量和可用性排序。

### 后续独立评估

配置方案快照适合确实需要整组切换的用户，可参考 Magpie profile。多个协议入口也值得评估：当前一个渠道一个协议，会把同一服务商的多协议能力拆成多条记录；可逐步演进为服务连接下的明确协议入口，但须保留既有绑定身份和迁移语义。

协议转换网关、多账号授权及令牌刷新、自动故障转移、余额与额度适配、自动路由是长期运行时能力，各有独立成本。JanusX 已有 CPA 插件边界，评估这些能力时先考虑复用其接口或外部兼容网关，再决定自建部分。推广接入不依赖一次实现全部能力。

## Open questions

本研究没有确定最终视觉稿、默认服务商、推广合作排序、收费形式、远程目录信任方式、数据统计方案或网关自研范围。也没有数据证明目标用户更喜欢按 Agent 还是按服务商进入；建议以“已有 Key 首次接入”“寻找服务商接入”“日常切模型”“外部改动后的处理”四个任务验证信息架构。

下一步适合围绕空状态、添加服务、模型选择器和 Agent 总览制作可操作设计草稿，并以这些任务检验。此前不必为尚未确认的完整功能矩阵重写配置底层。

## 固定源码与图像索引

以下均指向实际读取的固定提交；一个编号可对应同一职责的少量文件。

- C1：CC Switch [添加外壳](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/AddProviderDialog.tsx)、[预设选择器](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/forms/ProviderPresetSelector.tsx)、[分组](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/forms/presetGroups.ts)。
- C2：[卡片呈现](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/presentation.ts)、[卡片操作](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/ProviderCardActions.tsx)、[模式切换呈现](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/components/providers/mode/ModeTabs.tsx)。
- C3：[操作及恢复](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src-tauri/src/mode/operation.rs)、[Claude 字段写入](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src-tauri/src/services/provider/claude_direct.rs)、[连通检查](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src-tauri/src/services/stream_check.rs)。该检查收到 HTTP 响应即判断地址可达，不证明 Key、模型或协议正确。
- C4：[预设与合作字段](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src/config/claudeProviderPresets.ts)。
- C5：[导入实现](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/src-tauri/src/deeplink/provider.rs)、[站长接入指南](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/docs/guides/deeplink-site-integration-guide-zh.md)。
- M1：Magpie [GUI 主实现](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/gui/assets/app.js)：`openPicker`、`filter`、`setPick`、`drawEditor`，以及添加服务与模型发现流程。
- M2：[Provider](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/provider.go)、[Agent](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/agent/agent.go)。
- M3：[网关入口](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/gateway/gateway.go)、[路由策略接口](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/routes/routes.go)。协议转换行为同时参考已阅读的 subsystem 文档，未运行实测。
- M4：[方案快照](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/profile/profile.go)。
- M5：[供应商 API 和呈现数据](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/gui/providers.go)、[模型显示设置](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/modelprefs.go)。
- M6：[真实请求测试](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/test.go)、[协议检测](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/detect.go)。
- M7：[合作目录](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/partners.go)、[合作事件计数](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/partner_events.go)。
- M8：[导入协议](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/importurl.go)、[CC Switch 格式转换](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/provider/importccswitch.go)、[导入确认交接](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/gui/importlink.go)。
- M9：[逐 Agent 接入、解除接入和漂移记录](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/agent/applied.go)、[模型目录同步边界](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/internal/agent/sync.go)。
- 已查看的官方截图：[CC Switch 主界面](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/assets/release-notes/v4.0.0/main-zh.png)、[CC Switch 旧添加页](https://github.com/farion1231/cc-switch/blob/fc3eb797c72e054d554eea6a2e7a8b93933c6ac5/assets/screenshots/add-zh.png)、[Magpie 添加页](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/site/public/img/add-zh-light.png)、[Magpie Agent 页](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/site/public/img/agents-zh-light.png)、[Magpie 模型选择器](https://github.com/yetone/magpie/blob/56c988cb5e5aa25ca6306cb4b723c60bcf753733/site/public/img/picker-light.png)。

## 本轮验证记录

浏览器夹具在 1280×800 视口下完成添加、获取模型、测试及保存，保存后 Agent 行文本仍为 `Janus / 未配置`。另外确认：原生模式检测未登录时禁用应用；新建页面显示编辑标题；更换预设保留 Key 并清空模型。以上使用虚构凭据与模拟响应，没有发送真实模型请求或修改用户 CLI 配置。

临时目录保留 `capture-janus.cjs`、`janus-empty.png`、`janus-add.png`、`janus-after-save.png`，仅用于本机复核，本文结论不依赖它们作为永久资源。只记录本轮实际执行的检查，不将上游测试文件的存在记作测试通过。

文档检查覆盖 349 篇 harness Notes，零错误，另有 17 条既有跨仓库链接诊断；本报告的 32 个固定源码及截图引用均核对了提交值和本地文件存在性。模块入口仅增加本研究链接并更新时间，已对比修改前快照，保留原有工作树修改。
