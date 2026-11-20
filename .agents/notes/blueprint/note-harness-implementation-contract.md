---
{
  "schema": "harness-note/2",
  "id": "537de6bf-7fb0-585f-99a8-531fcae192ed",
  "kind": "decision",
  "lifecycle": "proposed",
  "created": "2026-09-16",
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e7c03317-8bb8-4d1d-a1b2-832be6c5a3c5",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-16-agent-note-note-harness-agent--537de6bf.md",
      "sourceHash": "9497dc7165aa16560f9a5dcf6428480aa4091bf6d8bc43284d08acebc62e44bc",
      "originalBodyHash": "31b814a5f940731b3ada8e1c962e56c6f585d0b63940f09ea8c89f1b6eacb122",
      "category": "formal",
      "reason": "Retains the source decision in proposed lifecycle; body documents 统一 Note Harness 的实施契约与 Agent 交接. No age-based archival.",
      "edits": [
        "Rebased Markdown destination: ../../../../../WorkFlowX/standards/harness-note/1/execution-persistence.md -> ../../../WorkFlowX/standards/harness-note/1/execution-persistence.md",
        "Rebased Markdown destination: 2026-09-16-roundtable-chat-harness-loop.md#当前实施状态与下一步 -> ./2026-09-16-roundtable-chat-harness-loop--f8f6586b.md#当前实施状态与下一步",
        "Rebased Markdown destination: ../note://62b44166-82f0-41ff-838d-e2b02388ed06/a25708f4-6a09-4c18-a3d2-e0e02be42885 -> ../../../janus-agentX/.agents/notes/implemented/architecture/2026-09-19-harness-profile-namespace.md",
        "Rebased Markdown destination: ../../implemented/architecture/2026-09-19-desktop-delegated-modes.md -> ./2026-09-19-desktop-delegated-modes--fbac0251.md",
        "Rebased Markdown destination: ../../implemented/architecture/2026-09-18-harness-s9-readiness.md -> ./2026-09-18-harness-s9-readiness--28ce4fe4.md",
        "Rebased Markdown destination: ../../implemented/architecture/2026-09-18-harness-s9-readiness.md -> ./2026-09-18-harness-s9-readiness--28ce4fe4.md",
        "Rebased Markdown destination: 2026-09-16-roundtable-chat-harness-loop.md -> ./2026-09-16-roundtable-chat-harness-loop--f8f6586b.md",
        "Rebased Markdown destination: 2026-09-16-unified-note-blueprint-harness.md -> ./2026-09-16-unified-note-blueprint-harness--1b210a76.md",
        "Removed redundant Agent Note title prefix",
        "Removed lifecycle duplicated by frontmatter"
      ],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/architecture/2026-09-16-note-harness-implementation-contract.md",
        "sourceHash": "94a009056f577174ff564fffe8345f3a0a94d2e9afdebbbe0038700b968379c6",
        "originalBodyHash": "abd1f84b9747452a65aaaf4a8ba2f8e58f95d5c3a2526f8baec5a9cbbc13702f"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd"
}
---
# 统一 Note Harness 的实施契约与 Agent 交接


本文是第一版设计的提案及验收输入。JanusX 现行写入规则以仓库固定的 [harness-note/2](../../../standards/harness-note/2/standard.md) 为准。旧 bundle、回执和 C4 条款仍按当时的输入解释，接入验证见[接入记录](workflowx-v2-adoption.md)。

## Problem

[统一资产标准](./unified-note-blueprint-harness.md) 与 [圆桌聊天闭环](../agent/roundtable-chat-harness-loop.md) 定义了产品目标，但仅凭叙述不足以决定解析器、任务校验、事务恢复、接口和交付边界。实现 Agent 若自行补齐这些语义，三个仓库可能产生不同格式或把 Hybrid Tree 换名重建。本文固定第一版实现契约与执行入口；两篇设计负责动机及产品行为，本文负责具体字段、算法、错误和实施验证。冲突应按字段拥有章节回修，不能静默选择有利于当前实现的一篇。

审阅定位的主要缺口为：执行范围只有 prose、AC 引用与状态门禁缺少机器形状、合同哈希没有确定算法、closeout 提前声明提交成功、同名来源包缺少重试规则、轻量 CLI 依赖闭包不成立，以及缺少按仓库分配的可验证交付步骤。本文固定这些契约；设计条款本身不表示已实现或已测试。各阶段实际证据见 [S9 readiness](../agent/harness-s9-readiness.md)。

当前实现与验证边界以 [S9 readiness](../agent/harness-s9-readiness.md) 为总账。CLI、Ink 与桌面支持单任务 xdel/xflow 实施、自审或独立评审，以及对应的修复策略；具体行为及构建后 Electron 验证见 [桌面委派模式](../agent/desktop-delegated-modes.md) 及其引用的共享策略。Ink 的普通消息和命令均进入任务控制器，CLI 与桌面共用历史 Note 分类和 [标准 profile 门禁](note://62b44166-82f0-41ff-838d-e2b02388ed06/a25708f4-6a09-4c18-a3d2-e0e02be42885)。后续验收范围由 [闭环提案](../agent/roundtable-chat-harness-loop.md#当前实施状态与下一步) 维护。标准仍为 `harness-note/1`、`1.0.0-s1.1` candidate；实际发行组合与三仓规则切换尚待验证。

2026-09-18 批次仅修改 JanusX，基线为 `902b7bb`；验证时 janus-agentX HEAD 为 `d93b557`、WorkFlowX HEAD 为 `c36309d`，后两仓本批无修改。标准仍是 `harness-note/1`、`1.0.0-s1.1` candidate；WorkFlowX profile 记录摘要 `62e2ae8b674dd5510c9e7b8a2526e4b81710c1b6ad8d075837673708eb3c4a7a`，本批未重新生成标准 bundle 或验证发行组合。

2026-09-18 批次实际检查为 `npm run typecheck`、`npm run build`、`npm run check:package-boundary`、`npm run i18n:types`、`npm run i18n:check` 及修改源码的 ESLint（0 error、5 条既有 warning）。相关回归命令 `npm run test:unit -- --run tests/unit/blueprint-maintenance tests/unit/maintenance-harness-apply.test.ts tests/unit/harness tests/unit/janus-chat tests/unit/llm/chat-turn-guard.test.ts tests/unit/llm/janus-agent-ports.test.ts tests/unit/task-contract-adoption.test.ts tests/unit/roundtable-artifact-bundle.test.ts` 通过 25 suites / 139 tests；旧维护用例仍输出知识处理和审计写入警告。设置 `JANUS_E2E_PORT=41739` 与 `NO_PROXY=localhost,127.0.0.1,::1` 后，`npx playwright test tests/e2e/project-conversation.spec.ts` 通过 2 项，无页面脚本错误，桌面与 390px 表单截图已检查。未运行完整 `verify`、真实模型 Electron、发行包和跨平台用例，因为本批只验收共享 controller、合同采纳与共享执行内核的集成边界。

## Decision

### 接手顺序与不可改变的边界

接手 Agent 先读取三个仓库各自 AGENTS.md、CLAUDE.md 和当前 noteX/orchestrateX，记录 HEAD 与脏文件，不覆盖已有修改。先读本文，再按任务涉及范围查阅两篇设计。当前工作仍遵守旧规则；只有标准、基础工具与双端规则验证完成后才启用新入口。此处的实施分段是交接清单，不是新增 Parent/Child 或计划格式。

确定的边界：一种 `harness-note/1` 格式、五种 kind、同一 note URI；移除 Hybrid Tree 强制机制；task 是实施资产；基础 WorkflowX 无新增运行依赖；AGENTS/CLAUDE 同步；共享内容无本机路径；个人与项目会话隔离；圆桌和内置引擎输出同一资产。旧格式不兼容，但旧数据不得自动删除或批量改写。无 Harness schema 声明的历史文件作为 foreign 保留，不参与图、覆盖率或执行；声明未知 harness-note 版本的文件返回 UNSUPPORTED_SCHEMA，声明当前版本但损坏的文件继续报告校验错误。扫描不删除或改写原文，受管写入与执行要求仓库 profile 与安装的标准版本及摘要一致。

第一版不实现多人实时协同、CRDT、团队服务端同步、旧资产转换器或圆桌算法整体迁移；分享以只读文件包完成，团队入口可调用相同资产服务。图、Markdown/表单编辑、外部更新、圆桌成果、统一聊天、外部终端执行、内置有限执行闭环均在范围内。内置线程跨进程恢复可通过重读固定任务和证据重新派发；不以实现完整持久多层子线程为本次完成前提。

### C1 文件与元数据

Note 使用 UTF-8，可读取 BOM、LF、CRLF；编辑保持原换行，不改未触及区块。仅接受首段 `---` YAML frontmatter，不接受自定义 YAML tag、重复键或 alias/anchor。正文必须有且只有一个文档标题 H1；代码围栏中的标题不计。用 AST 识别节名与范围，禁止正则跨代码块替换。建议使用 `yaml` 的 Document/CST 与 `mdast-util-from-markdown` 的位置 AST，版本在实现时锁定并用 round-trip fixture 验证；不可无损处理的字段拒绝表单保存，原文编辑仍可用。

| 字段 | 类型 / 缺省 | 规则 |
|---|---|---|
| schema | 必填，`harness-note/1` | 不支持版本只能只读 |
| id | 必填，小写 UUID | URI 内使用完整值；禁止编辑身份，复制资产须新 ID |
| kind | 必填，idea/initiative/requirement/decision/task | 类型变化只支持尚无 execution 的 idea -> requirement；其他变换以新资产和 derived-from 表达 |
| lifecycle | 必填 | draft/proposed/accepted/rejected/archived；decision 额外允许 implemented |
| created | 必填，`YYYY-MM-DD` 字符串 | YAML 必须解析为字符串；首次创建日期不自动改变 |
| class / tags | 可选枚举 / 字符串数组，缺省空 | class 沿用六类；tags 去重，不作为授权条件 |
| parent | 可选 Note URI | 单一组织父节点；可移除，不决定任务依赖 |
| relations | 可选数组，缺省空 | `{type,target,criteria?,scope?,reason?}`；criteria 仅 implements 使用；scope=full/partial 仅 supersedes 使用且必填 reason |
| repositories | 可选对象 | `{primary?:repoId,related?:repoId[]}`；无路径；task 准备执行后 primary 必须明确 |
| codeRefs | 可选数组 | `{repoId,path,symbol?,role}`，role=entry/implementation/test；path 为相对 POSIX 路径 |
| work | 仅 task 可选 | C3 定义；执行前必填 |
| execution | 仅 task 可选 | C3 定义；draft 不得包含活动 execution |
| disposition | rejected/archived 必填 | `{reason:string}`；其他状态禁止 |
| extensions | 可选命名空间对象 | 保留未知内容；第一版不得靠扩展字段增加执行权限或改变验收语义 |

未知顶层键报 `SCHEMA_INVALID`，但保留原文。文件名为首次日期、可读 slug 与至少 8 位 id 前缀；前缀冲突时延长，URI 不受影响。扫描只接受 `.agents/notes/` 下普通 `.md` 文件，可递归以便用户分组；禁止符号链接逃逸、绝对路径、`..` 与大小写碰撞。路径不是身份，重命名不改 ID。

`harness.json` 固定 `{schemaVersion:1,repoId,name,profile:{id:'workflowx',version,digest},repositories?:RepositoryDescriptor[]}`。RepositoryDescriptor 为 `{repoId,name,remotes?:string[],providerIdentity?:{provider,host,repositoryId}}`。摘要为标准发行 manifest 的 SHA-256，不包含机器路径。基础模板随插件携带固定值，初始化不要求联网。`.local/workspace-map.json` 为 `{version:1,bindings:[{repoId,checkoutId,path,selected}]}`，同 repo 仅一个 selected；不存在绑定不影响浏览已收到资产。

视图文件固定 `{schema:'harness-view/1',id,name,repositories,roots,filters}`；roots 为 URI 数组，filters 只允许 kind/class/lifecycle/tags，多个过滤维度取交集。执行态筛选在客户端根据证据计算，不持久化到共享视图第一版。分享包可以缺少某些根，必须显示 unresolved。拖动只写 `.local/ui/<view-id>.json`。

### C2 正文、生命周期与关系校验

| kind | proposed/accepted 所需二级节名 | draft 最小要求 |
|---|---|---|
| idea | Background、Idea、Open questions | Background 或 Idea 至少一段非空内容 |
| initiative | Goal、Scope、Acceptance criteria | Goal 非空 |
| requirement | Problem、Expected behavior、Scope、Acceptance criteria | Problem 非空 |
| decision | Problem、Proposal、Alternatives considered、Risks | Problem 非空 |
| task | Scope、Acceptance criteria、Verification | Scope 非空 |

implemented decision 使用 Problem、Decision、Alternatives considered、Consequences，并禁止 Proposal；转正要有代码定位和验证依据。其他 kind 不借此状态表达执行完成。Open questions、Evidence、Results 可作为可选节；空未决问题写“无”，不能用 TODO 占位通过 proposed 的必填内容检查。方案具体质量仍需语义审查，机器不推断文字足够好。

draft -> proposed -> accepted；draft/proposed 可 rejected；accepted 的 idea/initiative/requirement 可 archived；accepted task 仅在无 execution 或 execution=done/cancelled 时可 archived；accepted decision 可 implemented 或 archived，已实施 decision 可 archived，不能直接改回 proposed。accepted -> proposed 仅在没有运行任务且显式撤回采纳时允许；引用方基线随之失效。archived/rejected 冻结内容，只能修复定位等非合同字段；重新考虑时新建 Note 并引用原资产。采纳动作校验现有授权，不要求每次都额外弹窗。

每条本地 AC 写成 `- [ ] AC-1: ...`，续行直到下一个同级条目；编号唯一且永不重新编号。复选状态仅用于阅读，不作为验收事实，不计入 AC 哈希。task 的继承 AC 在 work.acceptanceRefs 保存 URI+AC ID，正文 Acceptance criteria 可写“继承条款见元数据”，不得复制原文；独有 AC 正文定义后同样通过本任务 URI 引用。所有将要执行的任务至少有一条可解析 AC。

work.acceptanceRefs 是验收选择的真源；implements 是图上的覆盖意图。准备执行时，两者中指向 requirement 的 URI/AC 集合必须相等；缺省 criteria 只允许尚未准备的草稿，准备时展开为具体 ID。任务自身 AC 不生成 implements 自环。initiative 的整体 AC 通过引用它的集成 task 验证，不扩展 implements 的目标类型。重复同名必需 H2、重复 AC ID 和空 AC 正文均返回 SCHEMA_INVALID。

关系 type 闭集按统一标准；parent 可跨 kind，implements 只允许 task -> requirement，governed-by 允许 initiative/requirement/task -> decision，depends-on 两端仅 requirement/task，derived-from 允许任意 kind，supersedes 同 kind，related-to 任意。自指一律拒绝；对 parent、depends-on、derived-from、supersedes 分别检查有向环。related-to 只在完整 URI 字典序较小一端保存。跨仓库未加载目标返回 unresolved，不伪造存在；关系规范化绝不静默删除边。

task 执行必须检查其目标需求的 depends-on：task 前置项须有效 done，requirement 前置项须全部 AC 当前有效通过。第一版不支持带环的迭代依赖；需要拆分验收范围或重新组织需求。组织 parent 不自动授予依赖、完成或授权语义。

### C3 任务合同、哈希及执行状态

任务 prose 提供原因与边界，机器执行配置保存在 work，不从自然语言推断允许路径或运行命令：

```typescript
interface WorkContract {
  scope: Array<{ repoId: string; paths: string[] }>
  acceptanceRefs: Array<{ uri: string; criterionId: string }>
  verification: Array<{
    id: string
    kind: 'command' | 'manual'
    required: boolean
    repoId: string
    cwd: string
    program?: string
    args?: string[]
    description?: string
  }>
}
interface TaskExecution {
  mode: 'xdo' | 'xdel' | 'xflow'
  state: 'queued' | 'running' | 'verifying' | 'blocked' | 'paused' | 'done' | 'cancelled'
  baseline: { taskContractHash: string; inputs: Array<{ uri: string; contentHash: string; criteria?: string[] }> }
  attempt: number
  receipts: string[]
  closeout: 'commit-required' | 'working-tree-authorized'
  blocker?: { code: string; summary: string }
  authorizationRef?: string
}
```

scope 路径只接受文件或以 `/` 结尾的目录前缀，不支持 glob，禁止 `..`、驱动器、UNC 和根目录空字符串；允许整个仓库必须显式 `./` 且符合授权。cwd 为仓库相对路径，`.` 表示根。command 必须有 program/args，不能使用 shell 拼接字符串；manual 必须有 description。scope 是允许修改范围，不等于自动权限；实际权限取它与宿主授权的交集。同一 task 第一版只允许一个写 repo，跨仓库用多个 task，其他仓库仅作为只读输入。执行 task 与其收据必须存于 primary 仓库；讨论阶段可先在其他资产根起草，准备执行前应在目标仓库创建派生 task。此限制针对代码实施，UI 的跨仓库资产变更包仍按 C5 分仓库事务应用。

`fileHash` 为原始字节 SHA-256，保存用 expectedHash。`taskContractHash` 的输入是对象 `{schema,id,kind,title,repositories,relations,work,sections}`，relations 只取 implements/depends-on/governed-by；sections 固定取 Scope、Acceptance criteria、Verification 原文。递归按键名排序，集合型关系与 acceptanceRefs 按完整键排序，verification 数组保留命令顺序；字符串仅统一 CRLF 为 LF，AC 勾选符统一为空格，不做其他去空白；UTF-8 JSON 紧凑编码后 SHA-256。缺失可选字段省略。execution、tags、parent、Results、provenance 不参与该哈希。此算法必须有固定 expected hash fixture，不能由各宿主自行拼接。

输入哈希对 requirement 固定包含 lifecycle、Problem、Expected behavior、Scope 和被引用 AC；对 decision 包含 lifecycle 和全部必需正文；对依赖 task 包含其合同哈希及所采用 receipt 的内容哈希。任务模式在 run 与 receipt 固定，修改模式必须暂停重定界，不得把 xdel 收据改标签视作 xflow。写状态不会改变合同，修改仓库、范围、关键关系或 AC 会使基线过期。

规范化补充：sections 是节名到正文原文的对象，正文从 H2 行结束至下一 H2 前，保留嵌套标题；title 是唯一 H1 的行内源文本。集合排序使用规范化 JSON 字符串的 Unicode 码点序，不使用本地 locale；scope 按 repoId 排序、paths/related/criteria 排序去重，verification 保持声明顺序。criterionHash 为规范化 AC 条目全文（含稳定 ID）的 SHA-256；只改正文真实 checkbox 标记，不改代码围栏内容。输入哈希统一采用 `{uri,kind,lifecycle,sections,criteria,dependencies}` 的规范化 JSON：不存在的字段省略，criteria 为 ID 到 criterionHash 的对象，dependencies 为依赖任务 URI、合同哈希和采用收据哈希的数组。initiative 使用 Goal/Scope 和被引用 AC；task 自身 AC 已进入合同，不额外递归引用自身。通过任务及目标 requirement 的 governed-by 收集有效 decision，通过 depends-on 收集传递前置结果，去重后固定输入；unresolved 或循环阻止 prepare。所有算法由 harness-core 独占实现。

| 操作 | 前态 -> 后态 | 前提与失败结果 |
|---|---|---|
| prepare | 无 execution -> queued | accepted、work 完整、固定输入；未满足返回 NOT_READY，不自动采纳 |
| start | queued -> running | 校验基线、依赖、授权并取得本机 lease；attempt 加 1，首次从 0 变 1 |
| verify | running -> verifying | 记录实际变更与受验代码清单，停止同任务代码写入 |
| finish | verifying -> done | required checks 全通过、AC 全覆盖，xflow 有不同执行身份的只读评审且 approved |
| repair | verifying/blocked -> running | 同合同、固定失败收据、修复预算与授权有效；attempt 加 1，默认只一次自动修复 |
| pause | queued/running/verifying -> paused | 记录恢复前态在本地 run，取消或等待活动工具停止，不声明已停仍存活进程 |
| resume | paused -> queued/running/verifying | 重查基线/lease，恢复已记录前态；从未启动的任务回 queued，首次 start 才增加 attempt |
| rebaseline | blocked/paused -> queued | 所有旧执行已停止、重新确认范围与授权后重建输入；保留旧收据与 attempt，下一次 start 增加 attempt |
| cancel | 非 done/cancelled -> cancelled | 结束所属运行，保留文件和证据；不自动回滚代码 |
| stale/restart | running/verifying -> blocked | 合同变化或重启后执行拥有者不明；显式重定界或恢复，禁止猜测成功 |

跨机器读到 running 但没有本地 lease，显示“其他执行位置/状态待确认”，不自动写 blocked；仅认领本机遗留 run 时应用 restart 规则。done 历史状态保留，代码变化后 validity=stale 的只读投影表示证据失效；依赖不得把 stale done 当作已满足。准备下一次不同范围工作创建新 task；同范围未完成返修维持 ID。

queued 检查发现基线失效时也转 blocked；检查失败或预算耗尽时 running/verifying 转 blocked 并填写 blocker。done/cancelled 为执行终态。表外转换拒绝；取消后重新实施创建新 task。

### C4 收据、覆盖率与落地

正式执行状态写入 task Note 的 execution，收据写入任务 primary 仓库的 `.agents/evidence/<id>.json`；本地 run、租约和对话不作为可分享结果的真源。受管宿主使用同一仓库锁、文件 expectedHash、本地 run 修订号和恢复日志更新 Note、收据引用及本地记录；任何目标出现外部新内容时停止恢复。详细规范与固定摘要 fixture 见 [执行持久化规范](../../../../WorkFlowX/standards/harness-note/1/execution-persistence.md)。缺少本地运行记录只能重建结果，不能自动认领其他位置的活动执行。

收据内容摘要使用对象键递归按 Unicode 码点排序的紧凑 UTF-8 JSON，数组顺序和字符串内容保持原样；文件缩进、对象键顺序和 JSON 文件的 LF/CRLF 不影响摘要。依赖 task 的 receiptHash 及 Git 中的收据身份比较均使用此摘要；代码清单仍比较原始字节。任务收据必须由同 mode、attempt 的 done task 正式引用才提供覆盖，不能用孤立收据或本地缓存提前宣告完成。

Receipt 为 `harness-receipt/1`，创建后不可修改，字段为 id、taskUri?、mode、attempt、taskContractHash?、inputs、codeManifest、checks、coverage、review、createdAt、actor。codeManifest 每项含 repoId、path、sha256 或 deleted=true；必须覆盖任务修改的代码/配置/构建输入及实现者声明的关联验证输入，不包含本收据与会变化的 execution 元数据。coverage 每项为 `{uri,criterionId,criterionHash,checkIds}`，checkIds 必须非空且指向同收据内实际通过的检查。sha256 与 deleted=true 互斥，删除项验证目标不存在。taskUri 与 taskContractHash 同时存在或同时省略；仅无 task 的 xdo 允许省略，仍需固定 inputs 与实际检查。

checks 为 `{id,kind,required,status,repoId,command?,exitCode?,summary,performedBy}`，status=passed/failed/not-run；command 复用 program/args/cwd，passed 命令需 exitCode=0，manual 需操作者与实际观察。review 为 `{kind:'self'|'independent'|'manual',verdict:'approved'|'needs-fix'|'blocked',reviewedManifestHash,actor}`。xflow 要 independent 且 actor 与实现者不同；身份只是宿主日志可核验的本地标识，非密码学证明。没有可运行检查时必须记录已接受的具体人工验收，不能自动填 passed。

当前有效性要求合同、输入、被覆盖 AC 与代码清单都匹配。每条 AC 可以由一份有效 receipt 证明；单条 AC 不允许把多个部分证据自动拼成通过，若需联合验收须有集成 task 收据。需求覆盖率=有效通过 AC 数/全部 AC 数，空集合显示未定义；initiative 通过自身 AC 衡量，不能用所有后代任务平均值冒充整体完成。

closeout 是策略，不是成功标记。commit-required 的完成投影必须在当前分支可达历史中找到包含相同任务合同、receipt 及受验代码清单的提交，同时工作树相关内容仍匹配；定位失败显示待落地，当前清单漂移显示 stale。不同仓库分别检查，不以一个仓库提交代替另一个。working-tree-authorized 需引用用户授权记录并展示“仅工作树”；无 Git 时也可据该策略验收，但不能宣称已提交。第一版用显式关闭动作触发 Git 检查并缓存，状态重载时重新验证缓存所指提交，不每次绘图扫描完整历史。

### C5 资产服务、错误及事务

共享 API 定义为异步 scan(root)、get(uri)、search(query,filters,limit,cursor)、neighbors(uri,types)、prepare(input)、apply(preparedId,selection,grant)、status(operationId)、watch(root,listener)。prepare 只产生不可变候选与诊断，不写正式资产。写服务从宿主解析根与授权，不接受客户端指定的绝对路径；多仓库包拆成各仓库事务。

NoteChangeSet 固定 `{id,revision,source,operations}`。第一版操作采用 create/replace/delete：`{operationId,type,uri,expectedHash,relativePath?,afterMarkdown?,dependsOn,reason,evidenceRefs}`。create 的 expectedHash=null 且要求 ID/目标文件不存在；replace/delete 必须 exact hash。rename 是 replace 的可选 relativePath，由服务验证目标不存在。afterMarkdown 只有一份，ArtifactBundle 的 artifacts 只引用 operationId 与来源映射，预览派生于操作正文，禁止 artifacts 和 changeset 各存一份可分叉正文。

type 为 create/replace/delete；create/replace 必须有 afterMarkdown，delete 禁止携带正文。relativePath 相对 `.agents/notes/`，create 省略时服务按文件命名规则生成，replace 省略时保持原路径。source 与 bundle.producer 使用相同 `{type,id,revision}`，type 为 roundtable/chat/harness/manual。id/operationId/artifactId 均由宿主生成 UUID；revision 为从 1 开始的正整数。dependsOn 是同变更集中 operationId 数组，禁止环；evidenceRefs 是来源标识数组，只供解释，不授予权限。

部分选择应用时先求 dependsOn 闭包，在 UI 显示最终选择；删除必须在明确删除授权集合内，若闭包引入未授权删除则返回 APPROVAL_REQUIRED，不静默加入。所有引用关系在预期最终图校验；并发新建可能改变全图，因此第一版同 checkout 的受管写统一短时锁，锁内重新扫影响图及所有读前提。expectedHash 校验无误才能写。

统一错误形状为 `{code,message,uri?,path?,retryable,details?}`。固定 code：UNSUPPORTED_SCHEMA、SCHEMA_INVALID、NOT_FOUND、UNRESOLVED_REFERENCE、INVALID_RELATION、CONFLICT、NOT_READY、STALE_BASELINE、DEPENDENCY_UNSATISFIED、APPROVAL_REQUIRED、PERMISSION_DENIED、BUSY、RECOVERY_REQUIRED、IO_ERROR、CAPABILITY_UNAVAILABLE。文件不存在不与解析失败混同，失败默认不写；只允许受管事务 recovery 完成前存在显式中间状态。

事务流程：获取独占锁 -> 恢复未完成事务 -> 校验读集与最终图 -> 写入 journal（before bytes/hash、after hash、操作顺序）及临时文件 -> durable prepared -> 依次 rename/delete -> 记录 committed 与 operation result -> 释放锁 -> 通知。journal 存 `.local/transactions/<id>/`，运行结果存 `.local/operations/<id>.json`。操作结果键为 changeSet.id/revision/operationId；同键同请求摘要重试返回已存结果，同键不同摘要报 CONFLICT。跨仓库重试只执行未成功操作；已成功项即使文件后续变化也返回原结果，不再覆盖。rename 使用同目录临时文件，Windows 占用目标时返回明确失败并按 journal 恢复。

崩溃恢复按每个文件分类为 before/after/neither：全 before 可以重新应用，全 after 补记 committed，混合 before/after 可以继续到 after，任何 neither 均停止为 RECOVERY_REQUIRED，不覆盖外部修改。共享读取器只发布无未决事务的完整扫描结果。锁用独占创建并写 host/process/start-token，存活不明时不凭固定秒数删锁；仅确认进程已死或用户明确处理后恢复。非受管编辑器的竞态边界沿用主设计，不能宣称绝对无丢失。

标准 Note 原文和新资产 ID 即使没有安装增强工具也能被基础 WorkflowX 维护；上述事务与自动状态门禁仅是增强实现的保证。CLI `--json` 返回 `{ok,data?,errors:[]}`，退出码固定 0 成功、2 输入/校验错误、3 冲突/过期、4 授权不足、5 IO/恢复错误、6 依赖或能力缺失；diagnostic 定位文件/字段，stdout 只写结果，stderr 写运行日志。

### C6 生产者、聊天与启动边界

圆桌 ArtifactBundle 使用 `{schema:'harness-bundle/1',id,revision,producer:{type,id,revision},artifacts,changeSet,coverage,unresolved}`，artifacts 为 `{artifactId,operationId,sourceRefs:string[]}` 数组，无独立正文；coverage 为 sourceRef -> operationId/section 或 excluded+reason。源快照在提案前持久化，重试使用同 bundle，重新讨论产生新 revision。模型以 JSON structured output 生成提案内容，宿主分配身份与填充版本，schema 不通过只返回诊断；不把不完整 JSON 作为正式 Note 保存。draft 可以缺内容，不能缺 frontmatter 结构。

janus-chat 的新增持久字段为 engineeringContext、artifactRefs、activeRunRefs、pendingActions；和 messages 分开裁剪。主进程以 conversationId 建单 turn 锁与 requestId 幂等记录。renderer 的 noteRefs/repoIds 只作选择请求，主进程使用 Note repository 和 workspace registry 解析；授权变更增加 contextRevision，当前流继续固定旧范围或取消，不能扩大权限。项目入口 domain=project，即使没有绑定本地源码，也不得因空 workspaceResources 回落个人采集。

宿主端口增加可选 `engineering` 分组：resolveContext、artifactTools、taskTools、execution、events；chat-turn 无该端口时维持普通助手。API 不接受 renderer 自写 grant，宿主执行每次变更的批准检查。维护模式仅开放 read/search/prepare/apply 资产工具，实施模式按 scope 开放代码工具。任务 transition 由状态服务处理；通用编辑绕过后也必须在 finish 重新校验证据。

拟新增 IPC 集合：`harness:context-resolve`、`harness:artifact-query`、`harness:artifact-prepare`、`harness:artifact-apply`、`harness:task-start`、`harness:run-command`、`harness:run-status` 和 `harness:event`。全部写操作校验 sender、资源授权、requestId、文件/上下文修订；preload 只暴露类型化方法。能力查询返回 unavailable 原因，UI 不将不可用的执行入口显示为已启动。

内置启动返回 `{runId,taskUri,state,executor:'internal'}`；外部终端使用同一 Task URI、固定基线及模式生成 handoff 文件 `.local/runs/<runId>/handoff.md`，通过已有 CLI resolver/runner 与参数数组启动。provider 若不能验证支持 prompt 参数，则打开终端并显示可复制的入口指令，run 标 awaiting-launch，不宣称运行成功。进程退出只是事件，不代表任务 done；检测文件与收据决定结果。handoff 不成为长期任务正文，删除本地 run 后 Note 仍可从新宿主继续。

内置 xdel/xflow 要求可调用的子执行器/评审能力；没有能力时返回 CAPABILITY_UNAVAILABLE（CLI 退出码 6），不由主代理冒充 evaluator。xdo 可直接执行。桌面 xdo 宿主驻 JanusX 主进程：以中立运行内核推进状态，以桌面命令运行器执行已声明的 command 校验，以项目会话的只读自审轮次生成覆盖映射；不得调用 `@janus-agent/janus-agent` 的 CLI 任务执行宿主，两个宿主只共享内核与收据校验，不共享对方的运行时。自动启动多任务仅限授权的任务集合及已允许的并发；默认串行依赖调度。失败不自动改写其他任务的 scope。

### C7 包边界与具体文件落点

现有 node-hosts/package.json 依赖 agent-core，不能作为轻量 CLI 的持久化依赖。确定新增以下三个包，实施时使用仓库现有 TypeScript/Vitest 约定：

| 包 | 拟新增模块 | 允许依赖 |
|---|---|---|
| `packages/harness-core` | `src/schema.ts`、`parse.ts`、`serialize.ts`、`relations.ts`、`hash.ts`、`lifecycle.ts`、`task-state.ts`、`receipt.ts`、`changeset.ts`、`index.ts` | 纯数据/schema/YAML/Markdown 库，无 fs/Electron/agent/LLM |
| `packages/harness-node` | `src/repository.ts`、`resolver.ts`、`transaction.ts`、`journal.ts`、`watcher.ts`、`git-evidence.ts`、`index.ts` | harness-core 与 Node 内置模块，无 agent-core |
| `packages/notes-cli` | `src/cli.ts`、`commands.ts`，bin=`wfx-notes` | harness-core/harness-node；不导入 janus-agent、cli、node-hosts 的 barrel |

janus-agentX 现有 `packages/janus-agent/src/ports.ts`、`orchestrator/chat-turn.ts` 接入可选工程能力。运行内核（`dispatcher.ts` 与 `run-store.ts`：状态机、租约、收据生命周期）只依赖 `harness-core`、`harness-node` 与 Node 内置模块，不依赖 `agent-core`、`chat-core`、模型或 Electron；它是中立内核，随 `harness-node` 发行，CLI 宿主与桌面宿主都调用它，宿主之间不互相调用。`packages/janus-agent` 只保留 CLI 宿主的任务执行适配（`prepareTaskTurn`/`verifyTaskExecution`，依赖 `ChatTurn` 与终端命令运行时）；JanusX 执行链禁止复用该 CLI 任务执行宿主，对话编排继续复用 `runChatTurn` 不在此限，那是聊天能力，不是执行内核。`packages/cli/src` 增 notes 命令路由与 harness 命令适配；`janus notes` 必须调用 notes-cli 导出的命令函数，不能复制实现。打包先 core -> node -> notes-cli，再构建运行宿主，发布依赖不得保留兄弟目录 file 路径。

JanusX 新增 `src/main/harness/{service,conversation-context,execution-adapter,artifact-producer}.ts` 和 `src/shared/ipc/harness.ts`，调整 `src/preload/index.ts`。`src/main/janus/blueprint-store.ts` 退出 JSON 内容写入，renderer 读取共享图投影；共享类型保留 UI 视图类型，不在两仓库重复定义 Note schema。`src/main/team/local-blueprint-repository.ts` 接入相同服务，团队服务器不在第一版范围。

roundtable 调整 service/events/parchment/export、JanusRoundtablePane 和 roundtableExport；新增原生产物 producer 与成果卡，原 export 只用于明确的会议日志导出。聊天调整 janus-chat IPC/chat-store、chat-orchestrator、janus-agent-ports、JanusChatProvider/useJanusChat/JanusChat。蓝图调整 BlueprintWorkbench/MaintenancePanel、stores/blueprint 与 blueprint-maintenance；后者只保留选择和展示状态，移除独立会话/loop/消息真源。没有等价测试前不得删掉维护应用和撤销能力。

WorkFlowX 新增 `standards/harness-note/1/{manifest.json,note.schema.json,receipt.schema.json,changeset.schema.json,templates,fixtures}`、`scripts/verify-harness-standard.mjs`、`scripts/sync-harness-rules.mjs`。同步模板采用显式受管区块，保留项目内容。双端 noteX、proseX、orchestrateX、socratesX、specX、engineeringX、auditX、agents、commands 和根入口都纳入受管清单；删除 hybrid-template 与 Parent/Child 强制字段，保留原始历史设计说明但标为非运行规范。

proseX 的“implemented 决策正文不放流水账”继续适用于 decision，task 的 Results/Verification 允许执行摘要；不能把旧禁词正则套在全部 Note 上。coder 只读 task 合同、返回结果及 Note 变更集；主协调者/状态服务负责 task.execution。只有显式授予合同修改范围时 coder 才可改 task 的 work/AC，否则返回 scope-change 请求。evaluator 只读，输出基于固定 manifest 的 verdict/findings。新 specX 不得同时写“任务 Note 为真源”与“禁止读取/维护任何 Note”。

### C8 执行分段、验证与交付

| 分段 / 依赖 | 实施范围 | 完成证据 |
|---|---|---|
| S1 无 | WorkFlowX schema/模板/fixtures 与本文契约转正候选 | 最小五类 Note、完整 task、全部错误 fixtures；先不替换运行入口 |
| S2 S1 | harness-core | 解析无损、哈希固定值、关系闭环、生命周期及 receipt 判定通过 |
| S3 S2 | harness-node 与 notes-cli | 两进程并发冲突、各 journal 阶段崩溃注入、只读错误不丢数据、无模型离线 CLI |
| S4 S3 | JanusX 图仓库、编辑、绑定、分享 | 终端 -> UI -> 终端往返；本机路径不进入导出，1000 文件刷新测试 |
| S5 S3 | 圆桌原生产物 | source 覆盖、稳定 ID、部分失败重试、已有节点更新与冲突 |
| S6 S3、S4 | 统一聊天、工程端口、蓝图维护 | 同会话双入口、权限域、取消/steering、撤销等价测试；移除重复 loop |
| S7 S2、S3 | WorkflowX 双端规则和独立使用 | 无 Janus 环境 xdo/xdel/xflow；受管区块同步检查；无 Hybrid 强制文件 |
| S8 S6、S7 | 外部/内置执行与证据回流 | Task URI 交接、独立评审、失败修复上限、closeout、重启和接管 |
| S9 全部 | 打包与发行矩阵 | 三仓库锁定版本、一致性用例、实际桌面闭环；然后启用新标准 |

S4/S5/S7 依赖允许独立实施，但是否派发并行 Agent 遵守用户与当前仓库规则，不因表格自动授权。每段提交前先报告本段实际验证和已有失败，不把旧失败归为通过。所有段落完成才可称全方案完成，不以做完 UI 或库代替内置与外部闭环。

实际可用的现有命令：janus-agentX 根目录 `npm run typecheck`、`npm run build`、`npm test`；单包可用 `npm run test --workspace=@janus-agent/<name>`。JanusX 根目录 `npm run typecheck`、`npm run test:unit -- --run`、`npm run i18n:check`、`npm run check:package-boundary`；完整集成用 `npm run verify`，需有相应桌面测试环境。不能在尚未创建新包时声称新包测试已运行。

拟新增测试命令：WorkFlowX `node scripts/verify-harness-standard.mjs` 校验 fixtures/manifest/模板；`node scripts/sync-harness-rules.mjs --check --repos <repo-list-file>` 检查受管区块与摘要，退出非零表示漂移，不自动修复。notes-cli 打包用既有 pack 流程新增独立目标，安装到无兄弟 checkout 的临时目录，断网运行 list/show/check，检查运行依赖闭包不含模型或 Electron。

| 用例 ID | 必须断言 |
|---|---|
| F01 | 有效五类、draft 最小字段、完整 task；未知键、重复 YAML 键、无 H1、重复 AC、越界路径拒绝 |
| F02 | 改 execution/Results 后 taskContractHash 不变；改 work、执行关系或 Scope 后 taskContractHash 改变；改目标 AC 后 inputs 哈希改变并使基线失效；LF/CRLF 归一后一致 |
| F03 | A/B 同 expectedHash 同时替换只一方成功；另方 CONFLICT，原文和草稿可恢复 |
| F04 | journal 每步中断；before/after 可恢复，neither 停止且不覆盖；重试相同操作不重复节点 |
| F05 | repeated bundle、部分跨仓库成功、源修订变化产生新提案；卡片截断不丢源要求 |
| F06 | done 缺收据不算有效；xflow 自审不替代独立评审；代码/AC 漂移无效；同一 AC 的部分证据不能拼成通过 |
| F07 | closeout 在 commit 前后、失败、dirty tree、无 Git 和明确工作树授权下分别正确 |
| F08 | 同会话双入口只一 turn；节点选择变化不扩权；项目空 workspace 也不进入个人采集 |
| F09 | 外部 runner 退出 0 但无收据不完成；重复启动返回同 run；无子执行器时如实 unavailable |
| F10 | 相同 fixture 经圆桌、Chat、CLI、内置 harness 形成同 schema；删本地索引后仍可重建目标与结果 |
| F11 | 仅 WorkflowX + 宿主可检索与维护资产，未安装 CLI 不提示必装；真实校验失败不能靠降级掩盖 |
| F12 | Windows/Linux 异路径共享快照可读，不导出 `.local`；同名 repo/多 worktree 要求明确绑定 |

接手 Agent 的最终报告必须包含：三个仓库的改动与 commit、标准版本/摘要、完成段落、实际运行的命令和结果、未运行项及原因、已知限制、打包与 GUI 验证结果。发布/推送按用户授权处理，不把“可移交实施”理解为本次已授权发布。

可直接用于移交的任务指令：

> 依据本文件和它链接的两篇设计实施统一 Note Harness。先检查三个仓库的实际指令、HEAD 和脏文件，以 S1 为起点按 C8 依赖推进；每段交付应包含实现、对应 fixtures、实际验证结果和决策 Note。保留他人修改，不自行增加兼容层、Parent/Child 或计划存储。WorkFlowX 独立可用、Codex/Claude 同步、跨仓库共享、蓝图适配、圆桌原生产物和统一 janus-chat 均为交付要求。尚未启用新标准时遵守旧 Note 规则；完成发行矩阵验证后才切换三仓库入口。任何与协议有关的新增选择先在本契约明确并保持三篇一致，不能仅留在聊天中。不能将未运行测试、缺失评审能力或只完成部分阶段报告为全方案完成。

## Alternatives considered

- 保留现有叙述，由实现 Agent 自定字段：开始最快，但状态、哈希和幂等一旦分叉，会跨三个仓库返工；本契约固定持久与跨宿主边界，内部辅助函数仍由实现者决定。
- 为每个页面或函数编写完整规格：能减少局部决策，但会把本提案变成难以同步的代码副本；只固定数据、接口、失败语义和验收，不限定所有内部命名。
- 不做额外契约，复用旧 Hybrid 模板：旧模板成熟，但与移除 Hybrid、统一资产的目标直接冲突；保留质量要求并映射至 task Note。

## Acceptance criteria

- [ ] 接手 Agent 能按 S1–S9 确定范围、依赖、文件和检查，不需从聊天历史猜测当前选定方案。
- [ ] C1–C6 能转为共享 schema、类型、状态测试和错误 fixture；实现不引入第二套计划真源或重复 afterMarkdown。
- [ ] 三篇文档对包边界、closeout、任务合同、执行状态和 Hybrid 移除保持一致；相对链接有效，拟新增项不冒充现有实现。
- [ ] 实施时 F01–F12 和各仓库相关现有检查实际通过；未执行的桌面/宿主检查明确列为未验证，不能以文档校验替代运行结果。

## Consequences

实现时仓库可能继续变化，本文的文件落点是已核实入口和建议新增模块，不允许据此覆盖其他 Agent 的修改。接手时必须重新确认实际导出、测试脚本与依赖，若路径变动则更新本文的定位而不擅自改变协议含义。

纯文档 WorkflowX 无法提供与受管客户端相同的锁、身份和验收强制性；标准保证表达一致，实际保证随能力层明确展示。测试必须同时覆盖基础流程和增强流程，不能只在全量 JanusX 环境验证后宣布独立使用成立。

协议细节增加后容易把基础使用变重。执行前才补 work/execution，想法草稿保持轻量；模板由 Agent 按需填写，禁止要求用户手工填写哈希或操作 ID。若 schema 实现迫使普通讨论也创建运行记录，应视为违反独立使用要求。
