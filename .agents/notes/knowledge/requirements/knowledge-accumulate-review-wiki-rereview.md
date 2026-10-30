---
{
  "schema": "harness-note/2",
  "id": "3944b368-fb79-415f-9159-7dae57ace3bd",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-03",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/736081fc-db55-40cd-b2ab-43c63f1729e9",
  "class": "architecture",
  "tags": ["memory","knowledge","review","wiki","jev","qwen","orchestration"],
  "updated": "2026-10-30T09:31:30.968Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf"
}
---

# 知识库累计后的三段式处理：审核、Wiki 生成、再审核

当前适用性：工程生成 Wiki、图谱、检索和自动化已随蓝图重构退出；下文相关设计及验收保留为当时记录，源码链接固定到退出前 Git 版本。个人及共享能力的当前边界见[模块入口](../module.md)。原验收编号、执行与评审记录不被此次退出改写为新版本通过。

## Problem

JanusX 知识库在 observation 累计后缺少一条用户可理解的三段式处理链，候选长期停留在收件箱，Wiki 停留在人工整理，复核依赖逐条人工触发。现有实现以规则提取加人工审核为基线，[评分器](../../../../src/main/knowledge/decision-scorer.ts)默认 `NoopScorer` 直接回退人工，[提取服务](../../../../src/main/knowledge/extract-service.ts)只支持单一默认模型，[精修任务](../../../../src/main/knowledge/refinement-tasks.ts)与单一默认模型绑定，环节与提供方无法独立选择。用户因此不能按成本、延迟与数据边界自由组合本地部署、Jev 与外部 LLM。

[统一记忆内核需求](./unified-memory-laya-primary.md)确立按环节独立选择提供方的方向，是本文的父约束，本文只收敛其中一条可交付链路，不替代父文的四环节设置与验收。

## Scope

本链路覆盖知识累计完成后的三个阶段，阶段之间以后一阶段读取前一阶段已落盘产物为准，不共享内存中的模型会话。

第一段为知识审核。用户必须能在 Jev、本地部署 Qwen 与外部 LLM 三者中任选其一承担条目审核。宿主按证据有效性、归属、来源级别与截断标记先行过滤，不合格输入不得送入模型；模型只返回判断与理由，写入、替代、版本与冲突约束仍由宿主执行。任一提供方未配置、不可用或返回非法结果时，该候选必须明确暂存或报错，不得隐式切换到用户未授权的另一提供方。

第二段为 Wiki 生成。审核通过的条目必须能用本地部署 Qwen 或外部 LLM 生成 Wiki 正文与整理，Jev 不得承担正文生成。生成结果只进入 Wiki 候选，不直接发布正式页面，来源引用与页面版本约束保持不变。

第三段为生成后的再次审核。该再次审核必须是全自动处理，复用同一套提供方选择（Jev、本地部署 Qwen、外部 LLM 三选一），对生成的 Wiki 候选执行支持度、覆盖度与无依据扩写检查。用户确认知识条目和 Wiki 均应在审核通过且宿主来源、归属、版本与冲突检查通过后自动入库，人工负责异常。模型不得直接修改正式存储；宿主须按审核快照和事务规则提交。人工与自动操作均须进入历史记录。密钥通过应用凭据保存，Note、评测报告与普通日志不得保存明文 Key。

本需求将保留 queue 管线所有权和无向量索引的基础路径。自动入库应提供明确配置，未配置或未启用时继续人工审核；记录目标不表示当前生产开关已开启。

本地部署必须独立启用且默认关闭；没有明确本地启用字段的旧配置也按关闭处理。宿主在用户启用前与每次冷启动前检测运行环境，检测不通过不得启动模型。只有启用后，四环节才能选择本地提供方。用户可随时关闭或取消检测，关闭须立即中断本地调用、释放应用托管进程并持久保存，后台调度和旧设置保存不得重新开启。上下文应按当时可用显存与权重参数自动推荐，主内存作为额外约束；允许手动指定，但不得超出模型与资源预算。托管部署必须选择可用 GPU，缺少 GPU、显存测量或最低容量时明确失败，不自动回退 CPU。

运行程序和模型权重不得放入发布包。用户首次使用时由应用下载并校验，随后复用完整资源；下载动作不等于启用授权。下载中应显示状态与进度，可取消及重试；应用升级和关闭部署须保留已校验文件。

Wiki 应作为持续更新的项目手册，按稳定主题维护当前有效知识；新条目、替代与撤回应触发相关主题更新，并合并短时间内的变化。当前版本与历史版本应分开：当前正文只引用本版本实际使用的来源，旧正文和旧引用留在历史，历史不得进入默认搜索语料、Agent 上下文或工程 MCP 输出。人工提交的页面由人工接管，后续自动生成不会覆盖该主题。默认仅处理启用后的新资料；设置中的“处理历史积压”将现有工程资料纳入处理。

发布历史应保存完整 Markdown 快照、来源标识与哈希、时间、操作主体和修改原因。真正审核通过的发布才应产生版本；内容与来源均未改变的重复提交不应增加版本，失败和重试应保留在处理记录。首版采用完整快照，默认保留每页最近 20 个发布版本，允许标记重要版本长期保留；附件与原始资料继续按引用复用，不能复制到每个快照。未曾保存的旧正文、主体与原因不得补造。仅凭版本号不能声称能还原历史内容；压缩或差量存储应在实际容量需要时再引入。

创新功能的 knowledge 开关必须控制工程知识采集、处理、召回、设置页和工程审核；persona 独立控制个人记忆。任一领域开启即可打开共用工作台和统一审核栏，关闭领域的内容与筛选立即卸载，程序跳转不能绕过门禁。知识库关闭后个人画像仍可独立查看、审核和配置，已有知识和设置保留。该边界由[分域控制决策](../memory-domain-controls.md)约束，替代统一审核栏仅依赖 knowledge 的旧约束。

后续自动处理须以候选和主题任务保证续处理，不能因每批数量上限而推进游标后遗失待审工作；知识规模不能直接成为所有审核的退出条件。来源或依赖版本改变应重新计算，明确撤回和人工拒绝才终止对应任务。Wiki 审核须独立检查必要内容覆盖，不能仅验证生成者自己列出的断言。

## Alternatives considered

设置页的一键测试按当前四环节选择依次验证，每项先检查必填配置，再以固定样本调用所选提供方。复用“立即运行一次”无需新增调用入口，但没有待办时无法验证接口，有待办时又会审核真实资料并触发入库；只做地址或密钥存在检查成本更低，却不能发现鉴权失败和响应格式不兼容。独立测试因此复用模型适配器，不调用自动处理与存储服务。Jev 未保存输入可临时用于测试；外部提供方沿用应用配置，本地执行只接受宿主已检测启用的路径。代价是额外的小样本调用、可用性状态和错误文案维护。

固定 16K 上下文能简化容量判断，但不能适应设备差异；直接设为模型原生 256K 会让 8GB 显卡承受无法满足的缓存预算。本地运行采用 32K、64K、128K 自动档位，手动可选到 256K，所有档位均受 GGUF 元数据与资源预算约束。依赖 llama-server 自动缩小上下文可以提高启动成功率，却会违反用户设置，托管启动因此关闭自动 fit 并核对实际 n_ctx。CPU 回退可以覆盖无独显设备，但内存预算通过不能证明 GPU 可用，且会让用户在不知情时承担明显更高延迟。因此托管部署只接受已测量的 GPU 预算，不足或未知时返回具体错误。

把权重与运行程序放入发布包可以免除首次下载，但每次发行和便携解压都要携带约 3.18 GB 的资源。仅沿用手填路径可复用用户文件，却要求用户寻找匹配的运行程序、DLL 和权重。应用采用按需下载、固定版本校验及持久缓存，并保留手动配置。Windows x64 Vulkan 包约 33 MB，可通过同一后端检测不同厂商显卡；CUDA 专用资源体积与平台选择成本更高，因此首版不自动下载 CUDA 包。

知识库控件沿用浏览器默认字号和外观可以减少样式维护，但默认 16px 的模型环节、自动处理状态与现有 11～12px 的工作台不协调。整体缩小应用字号改动集中，却会影响其他设置页和正文阅读；知识库使用独立样式，只收紧操作控件、配置行和元信息，并复用当前主题颜色。

维持现状（规则提取加人工审核加人工 Wiki 整理）是最省改动的方案，零依赖且今天可用。拒绝将其作为本链路答案的原因是收件箱规模扩大后人工逐条处理不可持续，且 Wiki 沉淀停滞，违背用户已确认的三段式目标。

全部环节固定走单一外部 LLM 是实现最简单的自由度替代，配置与路由成本最低。拒绝的原因是用户明确要求本地与 Jev 可选，纯外部方案不能满足离线、数据边界与成本对照需求，且把判断与生成耦合在同一账单与故障域。

全部环节固定走本地 Qwen 是最符合离线优先的方案，数据不出本机且权重可复用。拒绝的原因是部分用户已有外部接口或只需要低延迟判断，强制本地会引入权重下载、显存占用与常驻进程负担，违背纯外部模式零本地开销的承诺。

Jev 设置仅在状态文字中标记已配置，可以复用最少控件，但重复保存缺少可辨认的反馈。自动读取明文并填入密码框能直接编辑，却让每次打开设置都传输凭证。设置采用固定圆点占位、按钮旁的持久结果提示和显式显示操作；只有用户请求显示已保存密钥时才通过独立接口读取明文，隐藏未修改的密钥时清除临时明文。代价是维护状态读取、保存与显示三条失败路径，保存成功也不证明云端鉴权有效。

## Acceptance criteria

- [x] AC-1: 条目审核环节可在 Jev、本地 Qwen、外部 LLM 三者中独立选择其一，未配置环节保留规则加人工可用。
- [x] AC-2: Wiki 生成环节仅接受本地 Qwen 或外部 LLM，Jev 不可被选为正文生成器。
- [x] AC-3: Wiki 生成后的再次审核为全自动处理，可在 Jev、本地 Qwen、外部 LLM 三者中独立选择其一；通过的条目与 Wiki 由宿主复核来源、归属、版本和冲突后自动提交，人工处理异常。
- [x] AC-4: 任一环节未配置、不可用或返回非法时明确暂存或报错，不切换未授权提供方，不自动批准。
- [x] AC-5: 自动与人工操作均进入历史记录，密钥不落 Note 与普通日志。
- [x] AC-6: Wiki 按稳定主题维护当前有效内容，来源新增、替代、到期或撤回应使受影响页面更新或明确失效；确认过期的内容退出默认 Agent 召回。
- [x] AC-7: 发布时保存完整正文与来源快照，按 workspace 和 slug 隔离；未保存的旧版本不补造。重复发布不增加相同版本，失败审核和回滚不留下成功发布历史。
- [x] AC-8: 每页默认保留最近 20 个发布版本，重要版本可标记保留；历史页可分页浏览正文、来源与修改信息，读取失败显式报错；历史不进入默认召回。
- [x] AC-9: knowledge 与 persona 分别控制对应设置及审核内容；任一领域开启即可使用统一审核栏，两者关闭即卸载且程序跳转不能重新打开。知识库关闭不影响个人审核，设置中的关闭域退回常规页。
- [x] AC-10: 候选超过单批上限、知识超过相关上下文上限时仍可继续处理；任务在重启、预算不足与依赖变化后有明确恢复或重算路径。
- [x] AC-11: 知识库工作台、审核侧栏与知识库设置的控件具有明确字号和尺寸；四环节配置、状态统计和 Wiki 历史可紧凑浏览，深色与 planche 主题、窄窗口、键盘操作及禁用状态可用，创新开关与审核行为继续受原约束。
- [x] AC-12: 本地部署默认关闭，旧配置不自动授权本地运行；宿主在启用和冷启动前检查程序、权重、地址及资源，失败时明确报错且不得启动。
- [x] AC-13: 本地关闭时四环节不提供本地选项；关闭或取消检测即时生效，持久关闭、取消本地请求并等待托管进程退出；旧设置保存与迟到检测结果不能反向启用。
- [x] AC-14: 本地上下文以 tokens 表示，按环境推荐 32K、64K、128K，手动可选到 256K；受实际模型和资源预算约束，启动核对上下文，长中文输入可按实际分词复核，溢出不得静默截断。
- [x] AC-15: 发布包不内置模型与推理程序；Windows x64 可由应用首次下载、校验并自动填入路径，后续复用；进度、取消、失败重试、关闭保留文件及升级复用可用，下载本身不得启用模型。
- [x] AC-16: 托管部署按可用 GPU 显存推荐上下文，明确指定 GPU 启动；GPU 缺失、显存未知或不足时不运行且不回退 CPU。已有外部本机服务的 GPU 配置由外部服务负责。
- [x] AC-17: 设置页一键测试按四环节当前配置调用 Jev、本地或外部模型，显示逐项进度、耗时与结果；缺项提醒补全，关闭环节明确跳过，全关闭不显示测试成功。测试不保存配置或处理真实知识，配置及密钥变更后旧结果失效，失败不泄露凭据。
- [x] AC-18: 页面热更新后若预加载接口或后台处理器仍为旧版，测试须明确提示完整重启应用，开发模式重新运行 npm run dev；应用测试服务调用失败与实际模型请求失败须分别反馈，不能提示用户修改模型配置。
- [x] AC-19: 提取结果须经过独立原始证据覆盖检查，空产出和提纯丢弃同样受检；漏提、误删和失效陈述允许有限修复，不完整或不收敛时不得提交部分批次。提纯理由与检查结果须可追溯。
- [x] AC-20: 条目审核须读取同会话的条件和后续纠正，不限于模型主动引用的消息；上下文与候选快照绑定，提交前发生新增、撤回或变动时审核失效。
- [x] AC-21: 长任务须支持分块细分与中断恢复，最终知识数量不得沿用单次输出上限；历史相关知识须从全工程语料检索，不以最近 30 条或相同类型为入口条件。
- [x] AC-22: 带路径的终端完成通知须在读取原始记录前持久化补读任务，未落盘正文可在重启后继续读取；重复通知须去重，来源撤回须阻止恢复，诊断须显示积压与错误。

## Risks

本地思考请求按环节保留正文空间：Wiki 生成思考上限 1,024 tokens、提取 512、审核 256，使用固定 llama.cpp 支持的 reasoning_budget_tokens 请求参数。非 stop 输出明确暂存为 incomplete-model-output。64K 实机与八主题长手册验证、完整公网下载失败及模型误放行记录见[分域控制与验收](../memory-domain-controls.md)；软件验收勾选不能替代这些尚未通过的网络、硬件和真实质量验收。

模型判断不能替代宿主的来源、归属、版本与冲突校验，同模型自审可能重复同一错误，多模型一致也不保证事实正确。Qwen 思考预算只在审核任务上验证过，Wiki 生成的预算必须另测，不能复用 256 token 结论。Jev 为云端闭源模型，调用带来网络依赖与费用。网络不可用时任务暂存并显示失败原因；用户可显式改选本地模型或关闭该环节，运行时不隐式换用提供方。

## Expected behavior

开发模式的页面热更新可以与旧主进程、旧预加载桥同时存在。配置测试检查 `testConfiguration` 方法是否存在，并识别后台缺少 `knowledge:configuration:test` 处理器的错误；任一情况提示完全重启应用，开发模式重新运行 `npm run dev`，刷新页面不足以加载后台新接口。其他 IPC 拒绝只显示应用测试服务不可用；只有后台返回的模型请求失败才提示检查服务、网络和模型配置。原始 IPC 错误不进入界面，避免携带凭据或内部详情。

[配置测试入口](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/main/knowledge/knowledge-configuration-test.ts)通过 `knowledge:configuration:test` 验证单个环节，设置页串行调用并逐项反馈。输入只包含环节、模型选择、Jev 地址及可选临时密钥；不接受任意本地程序路径或用户知识。未提供临时密钥时只在宿主读取已加密凭据。云端每项请求最多 30 秒，本地最多 120 秒以覆盖冷启动；本地占用时反馈稍后重试，不抢占正在执行的任务。审核环节检查审核响应结构，生成环节检查固定 JSON 样本；通过仅证明短请求的接口与响应可用，不证明完整提取、Wiki 生成或真实审核质量。配置变更和页面卸载会丢弃迟到结果并停止发起后续环节；在途请求按自身超时结束。外部调用可能产生少量费用，测试没有持久结果，也不自动启用后台处理。

[自动处理服务](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/main/knowledge/automation-service.ts)按候选和主题保存任务身份、输入与依赖哈希、所选模型、次数、状态及原因。每次调度最多执行 12 项，剩余任务保持待办；短暂失败最多自动尝试 3 次。模型调用在存储锁外执行，提交前在事实及 Wiki 锁内复核实际依赖，已发布产物可用于恢复中断任务。知识总量不作为整批停用条件。提取按输出与上下文限制细分输入，独立检查证据覆盖，分块恢复及明确预算见[任务提取决策](../hook-evidence-extraction.md)。来源不足、超过恢复边界或审核不通过时进入异常记录；普通故障重试不产生发布版本。

自动入口仅接受有宿主归因的 project 内容；个人记忆、来源不明、显式替代和冲突需要人工审核。条目审核使用来源正文及分块的相关有效条目。主题采用知识类别与明确概念细分，并复用已发布来源的页面身份；具体分组、关系及兼容规则见[知识库优化需求](./memory-noise-progress-audit.md)。按相关条目生成稳定页面，合并 15 秒内的变化。正文由独立落盘的 Wiki 候选承接；复核检查每个完整段落组的支持度，再逐条核对必要知识覆盖。没有剩余有效来源的页面明确失效，管理界面保留页面和历史供人工处理。

[模型适配](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/main/knowledge/knowledge-models.ts)复用外部提供方的已配置模型及凭据；本地兼容服务按环节传递思考开关。可选的 llama-server 由用户提供程序和 GGUF 路径，使用单并发、经环境检测确定的上下文与空闲 180 秒释放；无需自动下载或安装。纯外部配置不启动本地服务，也不需要 Jev 密钥。配置新管线后暂停旧 Laya 与旧自动精修，关闭新管线保持人工审核。Jev 凭据使用系统加密存储；普通配置与状态查询不返回明文，用户点击显示时可通过要求 knowledge 开启的 `knowledge:jev:credential-reveal` 读取已解密凭证。

[密钥控件](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/renderer/src/components/knowledge/JevCredentialFields.tsx)在保存时禁用重复操作并显示等待文字，成功后隐藏明文、显示固定圆点占位和成功提示。重新挂载仅查询是否已配置；用户输入的新值保留为未保存草稿，保存失败允许原值重试，显式删除才清除已有凭证。读取、显示、保存与删除的错误出现在控件旁，已识别的加密不可用、功能关闭与输入非法使用对应说明，未识别错误不回显原始异常。密钥不进入普通设置、日志或 Note。

### 本地部署与上下文


[资源安装器](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/main/knowledge/knowledge-local-resources.ts)在用户点击“下载或复用本地资源”后工作，挂载设置页和启动应用仅允许读取状态。资源位于 Electron userData 下的 `knowledge/local-models`，应用升级复用该目录；dev 与发行版使用各自配置目录。安装入口 `knowledge:local-model:install` 要求 knowledge 创新开关开启且本地部署关闭；状态入口 `knowledge:local-model:resources-status` 返回组件、阶段、字节进度和检测原因。下载完成自动填入路径，用户再点击“检测并启用”。关闭、关闭 knowledge 创新开关和应用退出均取消进行中的准备任务；迟到结果不能启用本地模型。

清单固定 llama.cpp b11277 Windows x64 Vulkan 与 Qwen3.5-4B Q5_K_M 的版本、URL、大小和 SHA-256；权重 revision 为 `e87f176479d0855a907a41277aca2f8ee7a09523`。下载通过 Electron 网络栈使用系统代理，采用流式写入与哈希，逐块限制大小，60 秒无新数据或总时长超过 4 小时会失败。每个文件必须满足长度与哈希后才替换缓存；取消移除当前临时文件，重试复用完整且重新校验通过的组件，不续传未校验片段。可用磁盘必须覆盖待下载文件加 512 MiB 余量。运行程序压缩包校验后检查路径穿越、512 个条目和 256 MiB 解压上限；运行程序及 DLL 的清单与哈希用于后续复用与损坏修复。

安装器先获取约 33 MB 的运行程序，再按固定模型元数据检测 GPU；GPU 通过才下载约 3.14 GB 权重。首次完整下载为 3,176,752,524 字节；保留压缩包、约 94.5 MB 解压文件及模型后的磁盘占用约 3.27 GB，不计文件系统开销。完整资源留在磁盘，关闭不会删除资源，也不会保留模型进程。首版自动下载仅支持 Windows x64；其他平台显示限制并保留手动路径。来源不可达、空间不足、校验失败与解压失败均明确显示，可重试；不放宽校验、不自动替换来源。


[本地设置入口](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/main/knowledge/knowledge-local-settings.ts)负责启用、持久关闭与设置写入串行化。`knowledge:local-model:configure` 只接受程序、权重、地址与上下文参数，环境通过结果由宿主产生；普通知识库 Save 保留宿主的本地配置，不能提交启用授权。`knowledge:local-model:stop` 取消检测并持久关闭，本地环节归为关闭，不自动转用云端。关闭时内存门禁先阻止新调用，磁盘写入与进程退出均完成后操作才返回成功；写入或退出失败须在界面报错。取消信号覆盖读取配置、环境检测与等待写锁期间，迟到结果不得授权。即时操作同步页面已保存配置，Reset 和进行中的 Save 不得恢复旧本地状态。

[环境检测](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/main/knowledge/knowledge-local-environment.ts)检查 loopback 地址、绝对文件路径、空闲端口及可执行程序的 `--list-devices`，程序启动验证同时覆盖系统架构和依赖库是否可运行。GGUF 元数据读取最多 32 MiB，当前资源模型支持 qwen35，读取 context_length、层数、全注意力间隔、KV 头数与维度。Qwen3.5-4B 的 32 层中每 4 层包含一层全注意力，f16 KV 估算为每 token 32 KiB，32K、64K、128K 分别约占 1、2、4 GiB KV。GPU 预算另计权重与 1280 MiB 运行/余量，主内存需保留权重大小加 2048 MiB。GPU 选择取可确认空闲显存最多的设备，排除 CPU、RPC 与软件实现；NVIDIA 的可用显存取运行时预算和 nvidia-smi 空闲测量的较小值。没有有效测量、显卡或最低 32K 容量分别返回独立原因，绝不使用主内存替代显存预算。自动模式每次冷启动重新选档；手动档位不足时明确失败，不降档。

程序和权重路径均为空时，检测只连接已有本机服务，不自动搜索仓库中的模型文件或启动进程。`/health` 连接拒绝、超时和非成功状态统一显示服务不可用，提示实际地址，并说明应用下载资源和自行启动服务这两种处理方式；这不是内存不足结论。`/props` 网络、状态、JSON 或上下文参数异常单独显示上下文无法确认，用户取消仍保留取消语义。dev 使用独立 `JanusX-Dev` 配置，仓库中的实验权重与测试中显式传入的路径不会自动成为 dev 设置。

[运行时](https://github.com/TreeX-xx/JanusX/blob/f2e0194fccab765142b6c58a62e393498ae9c3d2/src/main/knowledge/knowledge-local-runtime.ts)按需加载，托管启动明确指定检测出的 GPU 和全部 GPU 层，`--fit off` 保留用户上下文，加载预热和 `/health` 成功后继续检查 `/props` 中实际 n_ctx。运行失败和请求取消均释放托管进程；同一时间只允许一个本地请求，重启等待旧进程退出。空闲计时仅由本地请求维护，外部模型调用不会延长或误触本地计时。短输入采用 UTF-8 字节保守上界；长托管输入通过 `/apply-template` 和 `/tokenize` 复核真实 token 数，再预留输出与模板余量。外部管理的本机服务须提供 `/health` 与 `/props` 且至少 32K；应用只能限制请求预算和停止调用，不能替它重配上下文或结束进程，其输入仍采用保守字节上界。

[本地控件](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/renderer/src/components/KnowledgeLocalModelPanel.tsx)始终显示本地服务入口，显示关闭或按需加载状态。路径和上下文仅在关闭时可改，“检测并启用”“关闭本地部署”即时保存，不依赖总 Save。检查期间可以取消，即使总设置正在保存也可关闭；通过后显示内存、显存或 CPU 模式及推荐档位。所有生成与审核环节仅在启用后列出本地选项。

资源估算与加载预热不等于满上下文吞吐或生产质量保证。AMD、集成显卡、macOS 和 64K 以上的真实设备运行尚无本次实测；CPU 不属于托管自动部署范围；模型架构、KV 精度或运行时缓冲实现变化时需要重新校准预算。上下文容量不改变自动处理服务的证据分块、单条事实长度与输出预算；这些独立质量边界仍须分别调整和验收。

[发布恢复日志](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/main/knowledge/wiki-review-recovery.ts)把正文、索引、候选和历史的原始字节及目标字节组成一次发布；审计批次是提交标记。中断后按标记恢复全部文件，没有提交标记则恢复旧字节，包括被保留策略裁掉的版本；有外部修改冲突时停止恢复并报错。读者在恢复期间拒绝读取半成品。历史仅保留完整发布快照，最近 20 版以外的未标记版本会被裁剪，重要版本可继续保留。旧版来源正文、附件和模型会话均不复制到历史。

### 知识库控件（2026-10-03）

[知识库设置](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/renderer/src/components/KnowledgeSettingsPanel.tsx)使用独立样式，以分隔线组织采集、自动处理和外部接入；标题与输入正文为 12px，环节及操作标签为 11px，次要状态为 10px。四个环节显示序号、提供方、模型和本地思考开关，输入框高 30px，操作按钮最小高 28px。总开关与思考开关采用同一滑块样式并保留原生 checkbox 的键盘、标签及禁用语义；路径和连接参数在“本地服务”中展开，当前启停状态在收起时可见。设置保存、先保存再处理、纯外部配置与 Jev 生成能力限制沿用原逻辑。

提取环节显示“模型辅助提取（可选）”，关闭选项显示“仅规则提取（自动）”。采集开启后，队列中的规则归一化、去重与高置信候选提取自动运行且无需模型；模型辅助只补充语义提取。候选是否能正式入库仍受审核和宿主校验约束。禁用输入框的透明度仅作用于普通输入，不能覆盖滑块内原生 checkbox 的完全透明样式；否则关闭采集或保存期间会出现原生方框覆盖滑块。滑块轨道自身表达禁用状态，焦点提示和 Space 切换由原生输入保留。

[自动处理状态](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/renderer/src/components/knowledge/AutomationStatus.tsx)以紧凑标题、启停指示、分类计数和操作按钮呈现；需要人工处理与失败用主题强调色提示，含状态文字。近期任务默认收起，展开后列表高度限制为 220px 与 28vh 的较小值，避免大量任务挤占知识正文。工作台的处理状态独占整行；收件箱范围使用横向筛选按钮，选中状态由 `aria-pressed` 表达。[Wiki 历史](https://github.com/TreeX-X/JanusX/blob/c8332f1949dba249d1cec81a72c57746c31bb951/src/renderer/src/components/knowledge/WikiHistory.tsx)按版本列表显示日期、重要标记及选中项，正文与来源在列表下方阅读，分页与标记仍调用原历史接口。正文保持 12px 与独立行距，不随状态文字缩小。

## Verification

2026-10-06 开发运行态回归：本机 dev 主进程与 `.cache/preload/index.mjs` 均为 19:29 启动或生成，预加载产物没有 `testConfiguration` 与 `knowledge:configuration:test`，页面已包含新按钮；失败发生在接口调用前。`npm run test:unit -- --run tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts` 通过 2 个文件、32 项，新增 3 项浏览器用例分别复现缺少预加载方法、后台处理器未注册和其他 IPC 拒绝；验证明确重启提示、原始错误不泄露及没有模型调用。`npm run typecheck`、修改源文件的 ESLint 和 `npm run i18n:check` 通过。未重启用户正在运行的 dev，也未以真实密钥发起模型请求；重启后的模型可用性仍由实际测试结果决定。

2026-10-06 配置测试验证：`npm run test:unit -- --run tests/unit/knowledge/knowledge-configuration-test.test.ts tests/unit/knowledge/knowledge-models.test.ts tests/unit/knowledge-ipc-contract.test.ts tests/unit/knowledge-automation-ui.test.ts` 通过 4 个文件、55 项测试，其中配置测试服务 15 项、浏览器新增交互 3 项、IPC 新增门禁与转发 1 项。覆盖临时与已保存 Jev 密钥、各提供方缺项、HTTP 鉴权与限流、非法响应、云端超时、本地宿主授权与占用、混合环节逐项结果、失败重试、重复点击及配置改回原值后的迟到结果失效。`npm run typecheck`、修改源文件的 ESLint、`npm run i18n:check`、`npm run build:check` 和 `npm run check:package-boundary` 通过。`npm run check:notes` 为 0 错误，保留 27 条既有跨库链接诊断。浏览器截图人工检查覆盖 390px 的深色与 planche 主题，结果区域无横向溢出；截图位于忽略目录 `artifacts/knowledge-configuration-test/`。模型接口使用受控替身，未使用用户真实凭据调用云端或启动真实 GPU 模型。

2026-10-06 补充核查：[知识库优化需求](./memory-noise-progress-audit.md)记录审核详情与旧动作问题，以及用户确认的沉淀流程和 Wiki 主图定位；页间关系审核与同版本发布已由 W1 实现，默认 Wiki 主图和来源追溯已由 G1 实现，审核卡片与详情阅读已由 S2 实现；图谱阅读与布局仍待 G2。本文既有四环节与控件测试不覆盖这些新增场景；后续按[实施任务](../tasks/knowledge-review-status-audit-plan.md)逐项细化并验收，不把已勾选的软件接入条款扩展解释为当前整体体验或 Wiki 关系闭环已经完成。

`npm run test:unit -- --run tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts` 提供浏览器交互与 IPC 替身验证，覆盖等待、成功、失败重试、重新挂载、显隐、清除及读取门禁。密钥交互的两项浏览器测试通过，IPC 合同的 11 项测试通过；原有其余 11 项界面测试通过。`npm run typecheck` 通过。这些验证不证明真实系统加密或 Jev 鉴权可用。

### 首次下载与 GPU 部署验证（2026-10-04）

`npx vitest run tests/unit/knowledge/knowledge-models.test.ts tests/unit/knowledge/knowledge-local-resources.test.ts tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts --maxWorkers=2 --reporter=dot` 通过 4 个文件、33 项。`knowledge-local-resources.test.ts` 集中保留 6 项安装边界测试：完整校验后发布、损坏缓存、长度与 SHA-256 不符、下载取消及临时文件清理、跨实例复用、DLL 修复、GPU 不通过不下载权重、迟到探测与重试。其他验证复用原有文件；没有常驻二进制、截图或模型夹具进入版本控制。IPC 的 preload、fallback 与注册集合为 58 个，安装在读取配置期间被关闭时不会迟到启动。

真实 Chromium 验证显式下载、进度、取消、重试、路径填充与下载不启用模型；用户清空路径后轮询不恢复旧值，640×720 窗口无横向溢出。窄窗口首次断言失败来自测试容器 16px 留白与页脚默认 22px 变量不匹配；容器提供一致的留白变量后完整命令通过。该失败是测试装配问题，不记为产品控件验证通过。

`npx vitest run tests/unit/knowledge tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts tests/unit/app-shutdown.test.ts tests/unit/experimental-features.test.ts --maxWorkers=4 --reporter=dot` 通过 70 个文件、659 项，2 个显式实验跳过；界面路径清空与窄窗口断言由上述最终 33 项复验覆盖。

临时 Electron 入口使用生产 `KnowledgeLocalResourceInstaller` 完成真实 33,095,916 字节 Vulkan 压缩包公网下载、SHA-256 校验和 PowerShell 解压。本机 RTX 4060 Laptop 的可用显存测量为 5,422 MiB，推荐 32K。权重从本机已有的 3,143,656,608 字节文件流式传入，经过相同生产长度与 SHA-256 校验，安装进入 ready；没有重复进行 3 GB 公网传输。另用 Electron 网络栈对固定 Hugging Face 下载地址发出 HEAD，返回 200 与相同 content-length。包含 `../` 条目的临时 ZIP 被生产解压函数拒绝，目标外文件不存在。脚本和安装结果仅位于未提交、打包排除的 artifacts 中。

真实模型复验将 `JANUSX_QWEN_SMOKE=1`、`JANUSX_QWEN_SERVER` 与 `JANUSX_QWEN_MODEL` 指向此次安装结果，运行 `npx vitest run tests/unit/knowledge/knowledge-local-smoke.test.ts --maxWorkers=1 --reporter=dot`，通过 1 项，测试耗时 34.83 秒。启动前可用显存 5,447 MiB，mode 为 gpu；实际上下文 32,768，备份手册生成与复核保留 02:00、7 天和恢复校验条件，长中文输入返回预期 JSON。finally 等待退出，随后 health 不可连接且无 llama-server 进程。此测试不修改真实用户的启用配置，且不代表其他 GPU、较大上下文或生产质量已验收。

`npm run typecheck:strict-unused`、`npm run build:check`、变更源文件 ESLint、`npm run i18n:check`、`npm run check:package-boundary`、`npm run exclusions:check` 与 `git diff --check` 通过。Note 检查为 234 篇、0 errors、27 项既有显式链接诊断。构建使用隔离的 artifacts/build-check；打包规则继续排除 artifacts，资源清单不改变发布包的 extraResources。

### dev 检测提示、提取说明与开关修正（2026-10-04）

现场只读检查发现 dev 配置未保存本地双路径，默认 `127.0.0.1:18791/health` 返回 `ECONNREFUSED`。同一检测函数传空路径明确返回 `local-service-unavailable`，提供仓库现有 llama-server 与 Qwen3.5 GGUF 绝对路径后检测通过；后者仅执行元数据和设备探测，没有加载模型或写入用户启用配置。根因是 `fetch` 抛出的连接错误被外层归入通用环境失败，原先的健康接口非 2xx 处理没有覆盖连接拒绝。既有真实模型测试显式传入路径，不能证明未配置的 dev 可以直接启动。

复用 `tests/unit/knowledge/knowledge-models.test.ts` 检查服务连接拒绝、503、上下文请求失败、非法 JSON 与取消传播；复用 `tests/unit/knowledge-automation-ui.test.ts` 检查规则自动提取说明、五种交互场景及禁用开关。`npx vitest run tests/unit/knowledge/knowledge-models.test.ts tests/unit/knowledge-automation-ui.test.ts --maxWorkers=2 --reporter=dot` 通过 2 个文件、15 项，没有新增常驻测试文件。

临时视觉入口 `node artifacts/knowledge-switch-preview.mjs` 用真实设置组件复现禁用样式：旧规则使原生 checkbox 的计算透明度为 0.45，截图显示原生方框叠加；修正规则后透明度为 0，仅保留变淡的圆形滑块。重新开启采集后，Space 可开关自动处理，焦点外框可见。截图为 `artifacts/knowledge-controls-ui/disabled-switch-before.png`、`disabled-switch-after.png`、`focused-switch-after.png`。`npm run typecheck:strict-unused`、`npm run build:check`、变更组件及检测器 ESLint、`npm run i18n:check` 均通过；构建写入隔离产物，不覆盖运行中的 dev 输出。此修正没有重新加载真实模型。

### 本地启停与上下文验证（2026-10-03）

复用现有测试文件，没有新增常驻 test 文件。`knowledge-models.test.ts` 覆盖默认及旧配置关闭、关闭时拒绝直接调用、内存/显存分档、非法路径和模型元数据、外部管理服务的调用中断与进程所有权，以及中文输入真实 token 数通过和溢出拒绝。`knowledge-ipc-contract.test.ts` 覆盖宿主检测失败不授权、成功启用、持久关闭、旧 Save 无法重新启用、读取设置和检测期间取消；preload、fallback 和注册接口在该次验证中共 56 个。`knowledge-automation-ui.test.ts` 在真实 Chromium 中检查未启用无本地选项、检测失败提示、通过后选择、即时关闭、Reset 和迟到检测结果。

`npx vitest run tests/unit/knowledge tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-ipc-contract.test.ts tests/unit/memory-review-ui.test.ts tests/unit/knowledge-note-ui.test.ts tests/unit/app-shutdown.test.ts --maxWorkers=4 --reporter=dot` 通过 69 个文件、651 项，2 个需显式选择的实验文件跳过。未限制并发的一次运行有两个浏览器套件在 15 秒启动钩子超时；限制并发后的完整命令通过，不把该次超时记为通过。

真实模型命令为 PowerShell `$env:JANUSX_QWEN_SMOKE='1'; npx vitest run tests/unit/knowledge/knowledge-local-smoke.test.ts --reporter=verbose`。使用本机 `artifacts/qwen-review/vulkan/llama-server.exe`（llama.cpp b11277）与 `Qwen3.5-4B-Q5_K_M.gguf`，权重 3,143,656,608 字节。RTX 4060 Laptop 环境检测可用主内存 15,161 MiB、显存 5,514 MiB，模型上限 262,144，推荐并实际加载 32,768 tokens；生成与复核保留备份时间、7 天保留期和恢复前校验条件。超过 32 KiB 的中文输入经模板与分词接口复核后成功返回预期 JSON。完整实验耗时 55,075 ms，通过 1 项；finally 等待托管进程退出，退出后 `/health` 连接失败，随后进程检查无 llama-server。该实验不修改真实用户启用配置，也不代表 64K/128K/256K 或生产质量已实测。

`npx playwright test --config playwright.desktop.config.ts tests/e2e/knowledge-pipeline.spec.ts` 通过 1 项，在隔离桌面配置中使用真实 IPC 检查普通 Save 无法启用本地、非法相对路径检测失败、关闭状态落盘，以及采集至审核、检索和上下文的既有管线。

临时视觉复验 `node artifacts/local-model-controls-preview.mjs` 使用真实设置组件和合成 IPC，在 1280×1000 深色、planche 与 640×720 窄窗口截图，文档与 fieldset 无横向溢出；人工查看深色与窄窗口，按钮、禁用输入、上下文和检测报告保持紧凑。截图位于 `artifacts/knowledge-controls-ui/local-*.png`，不作为常驻测试提交。`npm run typecheck:strict-unused`、`npm run build`、变更源文件 ESLint、`npm run i18n:check`、`npm run check:package-boundary` 和 `npm run exclusions:check` 均通过；Note 检查为 234 篇、0 错误、27 项既有显式链接诊断，`git diff --check` 通过。

### 控件验证（2026-10-03）

浏览器验证方法：用 esbuild 打包真实 React 组件，在 Chromium 中注入合成知识、任务和历史数据以及 IPC 替身，分别检查 1280×900、820×720、640×720 与 360px 历史区域；真实用户数据与模型不参与。聚焦开关后通过 Space 切换思考并保存，检查保存参数；用 Enter 展开本地连接，输入长路径并检查 fieldset 无横向溢出；点击收件箱范围，检查选中属性和同一行布局；展开任务记录，选择历史版本、标记重要版本及关闭历史，核对宿主请求的版本与哈希。以上交互全部通过，截图人工检查深色与 planche 主题，模型环节实测字号从 16px 变为 11px。临时复验入口为 `node artifacts/knowledge-controls-preview.mjs after`，截图位于 `artifacts/knowledge-controls-ui/`；这些本机产物不作为常驻测试提交，方法与结果以本节为记录。

既有审核浏览器测试补齐 `automationStatus` 替身，使审核失败断言不受无关的自动处理接口缺失干扰；没有新增测试文件。

`npx vitest run tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-note-ui.test.ts tests/unit/memory-review-ui.test.ts --reporter=dot` 通过 3 个文件、12 项，包含四环节配置、纯外部模式、保存后处理、创新开关联动、Wiki 审核、冲突替代确认与失败重试。`npm run typecheck:strict-unused`、`npm run build` 通过；变更组件 ESLint 为 0 错误，保留 KnowledgeWorkbench 原有的 refresh effect 依赖警告。`npm run check:notes` 为 234 篇、0 错误、27 项既有显式链接诊断，`git diff --check` 通过。本次未重跑真实模型或桌面 IPC 全链路。

### 自动处理实施验证

2026-10-03：相关知识服务、浏览器交互、IPC 和侧栏回归执行 674 项通过；另补充的人工主题保护和事务路径校验测试通过。命令为 `npx vitest run tests/unit/knowledge tests/unit/knowledge-automation-ui.test.ts tests/unit/knowledge-note-ui.test.ts tests/unit/knowledge-note-sources.test.ts tests/unit/knowledge-ipc-contract.test.ts tests/unit/laya-settings-ui.test.ts tests/unit/right-tool-state.test.ts tests/unit/right-tool-dock.test.ts tests/unit/experimental-features.test.ts --reporter=dot`。常规运行跳过需要显式环境变量的真实模型实验。

`JANUSX_QWEN_SMOKE=1 npx vitest run tests/unit/knowledge/knowledge-local-smoke.test.ts` 使用本机 Qwen3.5-4B Q5_K_M 和 Vulkan llama-server 完成一次思考生成与非思考复核，耗时 29,299 ms。生成保留“02:00 备份、保留 7 天、恢复前校验和”三个条件，复核返回 supported；这是实际调用链的小样本验证，不是生产准确率或长材料质量验收。

完整快照让恢复和检查更直接，代价是每页最近版本的正文重复；人工标记的版本会额外占用容量。任务记录、候选和既有审计仍随操作累计，尚未自动归档；大量工作区及长手册应测量实际占用后再引入压缩或归档。固定主题分类不等于语义聚类；模型审核不保证识别所有跨主题冲突。真实脱敏标注、固定策略与独立留出质量门槛仍由父需求 AC-8 跟踪，不能用功能测试或一次本地调用替代。

桌面真实 IPC 的 `npx playwright test --config playwright.desktop.config.ts tests/e2e/knowledge-pipeline.spec.ts` 通过 1 项。`npm run typecheck:strict-unused`、`npm run build`、`npm run i18n:check`、`npm run check:package-boundary`、`npm run exclusions:check` 均通过；变更文件 ESLint 无错误，KnowledgeWorkbench 的既有刷新 effect 依赖警告仍保留。Note 检查为 0 errors，已有跨仓库链接诊断不作为验证通过的替代。
