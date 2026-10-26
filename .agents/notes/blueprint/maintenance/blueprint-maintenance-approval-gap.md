---
{
  "schema": "harness-note/2",
  "id": "a1b2c3d4-2990-4ec4-b1d2-c825b30fa9da",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-29",
  "class": "bug-fix",
  "tags": ["blueprint","maintenance","approval","janus-chat"],
  "updated": "2026-10-24T18:05:11.031Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/a09981f4-1a94-42ce-9255-2e1127cfa37b"
}
---


# 蓝图对话提案与文件审批

## Problem

蓝图讨论包含假设、追问和未决定的方案，聊天文字不能充当文件修改授权。节点操作摘要也不足以说明真正写入哪些 Note：多个操作可能合并到同一文件，关系修改可能落在关系拥有者的文件，新增 Note 还需要确定身份和文件名。如果审批后重新翻译操作，用户看到的预览与实际写入可能不同。

整理若将全部讨论、节点正文、Note 原文和最多约 240 KB 的仓库证据拼为一条当前用户消息，聊天预算器不能裁剪其中的辅助材料，小 Note 也会被拒绝。仅在适配器的常用模型列表中查窗口，会让自定义模型错误地回退到 16K；将所有预算计算异常翻译为 Note 过大，还会隐藏实际故障。

## Decision

蓝图复用 JanusChat 的消息、模型调用和流式能力，使用独立的项目会话。普通发送采用 discuss 意图及后端读取工具白名单，不携带 maintenanceTaskId；“确认”“帮我修改”等聊天文字不能启动写入。会话生命周期由[工作区对话任务](./tasks/blueprint-workspace-dialog.md)约束。

用户点击“整理修改”后，宿主创建绑定会话、工作区和范围的维护任务，通过现有结构化生成链取得提案。画布焦点提供 Note URI、原始文件哈希和 checkout；组合节点先回源解析。用户继续普通讨论时，宿主驳回尚待批准的提案、清除其文件预览，并保留讨论内容，不自动生成替代提案。

审批使用[主动作栏](./blueprint-dispatch-panel.md)与 MaintenanceFileReview。默认显示批量选择对应的文件路径、修改类型、原因和修改后完整正文；展开差异可读修改前后的完整内容。部分批准仍使用分组、依赖闭包和删除确认，选择变化重新预览。预览失败时确认按钮禁用，错误和重试入口保持可见。

审核依赖解析失败时，主动作栏显示具体异常，不吞掉异常后返回空白审核区。界面展示错误不会授权任何写入。

整理沿用聊天传输的模型选择、停止、错误与重试，但不向历史追加自动指令及提案摘要。提案生成器接收宿主已授权读取的 Note 原文，并比对选中引用的预期哈希与本轮投影，防止两次读取间源变化。失败重试仍绑定整理任务，不能降为普通讨论；[持续讨论需求](./requirements/blueprint-review-conversation-loop.md)定义交互循环。

整理的完成凭据是当前 requestId 下的 maintenance_result，其中携带绑定当前任务和会话的完整提案。主进程先发送结果，再发送 stream_end；前端接收结果直接更新审核状态，独立维护广播不承担唯一交付责任。仅收到结束事件而没有有效结果时，前端保留明确错误与整理重试入口，不能将空白界面当成完成。完整讨论进入整理请求，不使用普通聊天的历史条数截断。

生成器通过 update-node.after.sections 表达 Note 的 Markdown 章节修改，保留原有验收编号和未涉及正文；映射由[Note 操作桥接](../../agent/maintenance-harness-apply-s6.md)持有。生成提示不得要求 Note 写入层拒绝的 features、progress 或 type。宿主在发布成功提案前执行无写入的文件转换，并检查至少一个文件存在差异；真正审核仍重新读取并冻结预览字节。空操作、无差异或转换失败保留具体原因，不发布新的成功结果，不伪造修改。停止和源变化在转换后再次检查。

proposal-context 为单次提案建立独立预算，避免重复装载共享聊天的摘要与已读证据。目标、完整讨论、当前提案的操作、节点结构和已授权 Note 原文属于必要上下文；提供原文时节点结构不重复携带 description、notes 等正文。知识召回和各工作区代码证据按完整段落逐项尝试装入，超预算段落不发送，并向模型及任务状态明确说明省略，不能据此推断文件事实。真正传给生成器的是预算器返回的内容，系统提示参与计算，结构化 schema 与 JSON 包装另保守预留 4096 tokens，输出和安全余量沿用预算器规则。

窗口优先采用适配器已给出的有效值；模型未列出时，通过仓库已有模型目录的精确或高置信匹配补全。未知模型不使用聊天预算器的 16K 默认窗口；应用按单次请求 65536 tokens 控制体积，包括系统、结构化格式、输出及安全余量。这是应用请求上限，不是服务商模型容量，模型元数据仍保持未知，实际能否接收由服务商判断。只有排除所有辅助材料后必要上下文仍无法容纳，才拒绝生成并报告模型、已知窗口或应用上限及各部分 token 估算。非预算异常保留原错误。完整 Note 和早期用户约束不进行静默截断。

主进程 preview 验证会话、工作区、提案版本、范围和源哈希，再调用 prepareMaintenanceSelection。翻译器合并同文件操作，并一次确定新 Note 身份、文件名和待写入字节。宿主保存这份准备结果，前端仅接收预览与 previewId。后端以任务为单位保留当前预览，较早的异步预览不能覆盖后发请求。

项目会话的 apply 必须提交当前 previewId 和相同的操作选择。宿主核对完整提案内容、授权、工程证据、源哈希与路径，再通过 applyPreparedMaintenanceSelection 将同一份字节交给已有 Harness 事务。确认不再调用模型或重新生成 Note 身份。取消任务、替换提案、继续讨论、工作区变化或源文件变化均使旧批准失效。事务开始前取消仍会拒绝写入；已经进入事务的应用遵循现有事务提交与恢复语义。

Note 的 delete-node 沿用归档映射，预览明确显示文件保留及 lifecycle 修改。成功应用刷新蓝图，审计保存实际选择、身份映射与前后快照；已有撤销链继续使用源哈希和工程证据校验。

章节修改的 before 值从本次选中操作翻译时读取的真实 Markdown 保存，不能取自去除了正文的画布投影。同文件多操作按实际执行次序记录；只批准后一项时重新读取其真实基线。章节解析复用共享 Markdown 视图，忽略 fenced code 内的假 H2；重复 H2 明确拒绝，保留缩进和嵌套标题。内部撤销以 null 表示移除本轮新建章节，模型 proposal 仍只接受字符串；撤销事务也保存真实基线，因此再次撤销可以恢复正确内容。源哈希检查继续阻止覆盖外部修改。

## Alternatives considered

- 复用现有节点审批、不增加文件预览：界面与后端改动少，但用户无法核对真实文件及合并后的内容，新增身份在批准时才确定。
- 在前端由模型摘要拼接文件列表：可以快速展示路径，但不能保证关系归属、同文件操作合并及新文件名称与事务一致。
- 批准时重新生成修改：可以吸收更新的上下文，但批准对象会变化。宿主保存准备结果付出内存成本，换取预览与写入一致。
- 仅使用独立维护广播展示结果：复用消息少，但聊天结束与审核交付之间没有可检查的对应关系。请求内结果增加一次提案传输，换取广播丢失时仍可展示、结果缺失时明确失败。
- 独立实现第二套聊天引擎：组件边界直接，但模型、流式、停止和重试需要重复维护。独立会话复用 JanusChat 已足以隔离讨论。
- 继续复用未知模型的 16K 硬限制：本地可提前拒绝小窗口请求，但约 11507 tokens 的必要内容加格式和输出预留就会阻断未知别名的大窗口模型。应用采用独立的 64K 请求体积上限并明确容量未知，接受服务商可能拒绝的代价；已知模型仍采用真实窗口。
- 截断 Note 正文或只保留最近几轮讨论：减少输入直接，但可能丢失验收边界与早期约束。必要内容完整保留，超限时报告具体规模。

## Consequences

用户可以先自由讨论，再明确整理和确认文件修改。预览接口增加一份有界于当前任务选择的主进程内存状态；预览和待应用任务不跨主进程重启保留。文件预览展示完整前后内容，不提供行级补丁编辑器。长 Note 使用可滚动内容区，审阅成本随文件长度增长。

支持范围仍是现有 Note 变更语义；任意源码修改和跨仓库原子应用需要单独设计。旧的无会话内部维护路径与撤销保留现有调用方式；生产项目会话必须通过文件预览。后续若需要跨重启恢复批准，必须持久化并重新验证准备结果，不能仅保存按钮状态。

辅助证据以工作区为完整单元取舍，可能留下未用满的窗口，换取不截断文件上下文。必要 Note 与讨论本身超过真实窗口仍需要缩小范围或更大模型。未知模型的应用上限限制单次发送成本，但仍可能超过供应商容量；服务端最终拒绝时不写入 Note。若必要内容超过应用上限，应补齐可靠模型元数据或另行设计分阶段整理。schema 预留是保守估算，操作结构扩展时应重新核对。预算复现与真实 Note 应用验证见[实施任务](./tasks/blueprint-review-implementation.md#verification)。

## Verification

蓝图插件迁移期间新增 blueprint-maintenance-sections 2 项，以及 harness-routing 中的多操作／部分选择／新增章节／再次撤销回归；相关两文件共 35 项通过。blueprint-native 的真实独立后台同样完成“生成章节提案 → 预览 → 应用 → 撤销”并核对原文。模型响应为确定性测试数据，不代表真实模型质量验收。

2026-10-02：单元测试按文件或分组运行，累计 70 个不同用例通过。maintenance-harness-apply 与 blueprint-maintenance-harness-routing 共 37 项，使用真实临时 Note 验证预览零写入、确认后的字节与新增身份一致、外部文件修改拒绝、取消时不恢复旧任务、部分批准及审计撤销。chat-turn-guard、janus-chat-conversations、blueprint-bulk-approval 另 27 项通过；blueprint-maintenance-service 的 6 项覆盖旧维护链回归。以下命令用于复验这些文件。

```text
npx vitest run tests/unit/maintenance-harness-apply.test.ts tests/unit/blueprint-maintenance-harness-routing.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/janus-chat-conversations.test.ts tests/unit/blueprint-bulk-approval.test.ts tests/unit/blueprint-maintenance-service.test.ts
```

project-conversation、blueprint-maintenance、blueprint-workbench 的 30 项浏览器测试通过，覆盖独立会话、面板卸载期间工作区切换、预览失败阻止确认、继续讨论取消提案、部分选择和过期源拒绝。随后新增的两个工作台布局用例单独运行通过，累计 32 项；1440×900 与 1280×720 下，文件内容展开后确认按钮与讨论输入框均在窗口内，截图经人工检查。浏览器运行生产 React 和聊天控制器，IPC 与模型使用测试替身；真实模型供应商未验证。

```powershell
$env:NO_PROXY='127.0.0.1,localhost'
$env:JANUS_E2E_PORT='41907'
npx playwright test tests/e2e/project-conversation.spec.ts tests/e2e/blueprint-maintenance.spec.ts tests/e2e/blueprint-workbench.spec.ts --workers=2
npx playwright test tests/e2e/blueprint-workbench.spec.ts --grep 'file review fits' --workers=1
```

npm run typecheck、npm run typecheck:strict-unused、npm run build、npm run i18n:check 与变更源码 ESLint 已通过；生成的 i18n 类型文件由 ESLint 规则排除。git diff --check 无错误。

npm run check:notes 的全库检查失败：dsh-integration.md 有 6 个格式问题，涉及 updated 字段、lifecycle 及缺少 Problem、Proposal、Alternatives considered、Risks。该文件属于本次范围外的工作区改动；本次三份 Note 没有结构或链接错误。standards/harness-note/1 未包含在当前 checkout，Note 检查使用仓库脚本和已安装的 Harness 校验库。
