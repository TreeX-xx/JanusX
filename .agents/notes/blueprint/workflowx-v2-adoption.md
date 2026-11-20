---
{
  "schema": "harness-note/2",
  "id": "7359ef5b-8cbb-4e30-a727-9a4907ac5fa0",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-10-08",
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "packages/note-tools/src/authoring.ts", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "plugins/blueprint/src/ui/graph/module-browsing.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/ipc/harness-handlers.ts", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/unit/workflowx-v2.test.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/e2e/blueprint-local.spec.ts", "role": "test"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "tests/e2e/desktop-harness-runtime.spec.ts", "role": "test"}
  ]
}
---

# WorkflowX v2 在 JanusX 的接入

## 当前设计

JanusX 使用 agentX 的共享读取、写入、wiki、工程工具和 Task 执行契约，固定 WorkflowX 2.0.0。原接入验收时的共享包来自 agentX `5c41e2fc693a0f1fd6014a7893fa4a39616f1790`；规则源为 WorkflowX `4af8c1b`。版本摘要为 `b76f1d5e98fce7a8fa56f5f60b023b457640e7036c32096e430a8481ef83c5e8`。主程序与 renderer 通过同一 Note 快照显示元数据、正文、诊断和更新时间。

蓝图使用统一浏览入口：单根项目首次即展示根模块页，包含根节点、直属子模块和直属文件，采用模块页的三列分行布局，面包屑从项目名开始；多根项目保留聚合入口。模块包括 planned、partial、implemented。单击模块在左侧预览共享来源的 module.md；双击进入模块页面，保留该模块自身作为本页父节点，下方显示直属文件和子模块入口。返回恢复范围、选中、正文与视口，重复进入当前根节点不增加层级。模块为带页签的容器卡片，普通文件按类型放入灰色虚线分组；不同归属的同类文档不合并。搜索和 Chat 从完整来源定位所属模块；未归属、历史文档和解析诊断保留入口。具体行为及自检证据见 [模块浏览交互](./navigation/requirements/module-browsing.md)。布局属于视图，不生成第二份文档身份。wiki 按 module 归属组织目录，历史 parent 仍可作为关系阅读。模块状态、文档生命周期和 Task 执行结果分别显示。

Chat 的 Note 工具复用共享服务，并保留 workspace.read、workspace.edit、command.run 等工程能力。普通 xdo 不创建 Task。Task 绑定执行仅由 Main 更新 Task 全文，子执行上下文拒绝写入 `.agents`，返回 Change Summary 与 Note 草稿。每次交接前更新同一 Task 的 Handoff，保留作者进展与证据。xdel 只自审；既有独立评审义务保留为 pending，桌面接口返回草稿、回执和未完成原因。xdo 绑定独立评审 Task 时仍履行该义务；xflow 保留独立评估与固定 AC。

维护入口、圆桌产物和旧蓝图导入依据目标仓库的 profile 和所属 module 写入稳定路径。选择的目录必须与目标 repoId 一致。v2 通用创建入口不把简略行动项伪装成可执行 Task；Main 需补齐正式契约。旧 JSON 的功能描述和任务清单作为普通 Note 导入，保留历史类型、关系与报告；同名文档分配不同路径。缺失的决策后果明确记为待评估，不制造历史验收。

## 文档迁移

[独立迁移任务](./documents/tasks/migrate-notes-v2.md)覆盖 257 份原始文件：254 份转入模块目录，保留 UUID、created 和原始 Git 来源，刷新 updated；3 份用户正在修改的知识 Note 原样保留。九个模块均使用 module.md；已有验收编号继续可引用。旧执行证据保留在迁移报告和原始 Git 版本，不重新签发 v2 回执。

[迁移清单](../../../docs/migrations/note-v2.json)记录源哈希、目标、类型变更与保护例外。3 个保护文件中的 3 处旧相对链接暂未改写，检查器只对清单明确映射且目标存在的链接报告 deferred，其余错误仍使检查失败。后续维护这些用户文件时再完成迁移与链接修复。

## 模块层级现状与后续整理

接入提交 9c49dba 使用项目根与八个粗粒度模块，没有二级子模块；当时 Note 与蓝图有 53 份直属文档，会话与工作区有 39 份。格式和 UI 已支持递归，缺少深层节点来自内容组织尚未细分。

本轮完成职责核对与两批迁移：Note 与蓝图新增文档读取、模块导航、维护对话、工作区组合四个子模块；会话与工作区新增会话记录、检查点、对话线程、工作树四个子模块。当前共 17 个模块入口，项目到子模块形成三层真实结构。77 份 Note 移动到直接职责目录，跨子模块的总计划留在父模块；四份通用工作台界面文档纠正旧归属。其余区域保持现有一级职责，不为等深额外建模块。

所有原文档保留 UUID、created、历史 AC 和执行证据。三份用户知识 Note 保持原字节。[职责目录整理](module-responsibilities.md)说明边界与验证，[映射清单](../../../docs/migrations/note-responsibilities.json)固定本轮源哈希及旧新路径；原 v2 迁移清单不改写。后续维护继续从模块文档和宿主搜索发现内容，迁移清单只作历史证据。

## 后续实施顺序

七项计划的本地实现与独立验收均已完成，结果为 PASS。Main 维护同一跨仓 Task；完整桌面演示、迁移、配置保护和跨仓引用已补齐独立检查，历史证据限制保留在验收报告中。推送和发布属于后续独立动作。

| 顺序 | 工作 | 状态与出口 |
| --- | --- | --- |
| 1 | 统一模块浏览与单根首页 | 已实现并通过独立验收，保留父节点和逐层返回，见[浏览需求](navigation/requirements/module-browsing.md)。 |
| 2 | 关注工具适配 | 已实现并通过独立验收，预览、进入、定位复用导航，见[关注需求](navigation/requirements/module-focus-navigation.md)。 |
| 3 | 真实职责层级与文档归属 | 两批迁移已完成并通过独立核对，身份、相对链接、代码反向引用和语料验证见[整理记录](module-responsibilities.md)。 |
| 4 | README 示例和演示资产 | 完整录制与独立验收通过：三层目录、关注定位、xdo 原位维护与 Main-owned Task 交接；271 帧真实宿主演示使用本地脚本模型。构建来源、修复和验证见[演示记录](../desktop/readme-showcase.md)，跨仓完成情况见[演示需求](note://d2499d5b-4ceb-4d46-aa3b-18e5c9b86034/ca370eb7-05a0-4bde-9539-4f9fddf77b2c)。 |
| 5 | 补齐共享评估执行能力 | 已实现并通过本轮独立评审。WorkflowX 双端规则已同步；agentX 和桌面两个入口复用测试计划与宿主执行，拒绝没有执行的独立通过结论。实现边界和证据见[共享运行时](note://62b44166-82f0-41ff-838d-e2b02388ed06/0b2e7c13-8ae0-42d9-b185-1dd575c43a19)及[桌面评估](../agent/independent-review-repair.md)。 |
| 6 | 架构师 Note 机制与蓝图识别解析 | 已实现并通过本轮独立评审。跨模块需求、决策、依赖、验收和正文引用保留唯一归属及关系来源；纯 Note 工作区可直接浏览。首次双击的相邻节点与空白落点均已修复。实际 v2 语料与双界面证据见[架构师工作区](workspaces/architect-workspace-model.md)。 |
| 7 | 最终独立评审与修复 | 本地集成验收 PASS。双击修复及完整桌面测试均通过独立复验；两处旧测试协议/窗口就绪问题已修复。结果和历史证据限制见[接入验证](../../../docs/migrations/workflowx-v2-verification.md)。 |

第 6 项按“跨模块 Note 与 xarch 约定 → 共享解析/蓝图关联 → 导航与关注工具回归”完成。复用标准模块和已有关系，不增加必填架构师字段；架构师能力按内容解析，专用用途标签不作为读取门槛。代码、拥有者 Note 与验证一起提交，历史回执保持原基线。

本轮 Main 验证：agentX 93 项 core、10 项真实测试执行和 27 项 Task/交接/宿主测试通过，相关包构建通过；JanusX 66 项桌面评估与 IPC、19 项架构/组合单元测试通过。11 项浏览器场景通过，新增两项纯 Note 场景另各重复三次通过。严格类型检查、build:check、双语检查及三仓文档/规则同步检查通过；修复后再次通过严格类型、构建和语料检查，267 份 v2 加 3 份保护文档，零错误、27 条可接受读取诊断。浏览器测试替换 Electron 传输，评估模型使用受控回复；没有声称外部模型或生产发布验收。

独立 evaluatorX 检查 WorkflowX `4e96135`、agentX `b40d1eb` 和 JanusX `7257fa9`，运行 41 项 agentX、137 项 JanusX 单元测试、21 项浏览器场景，以及 Electron 35.7.5 / Node 22.16.0 下七项真实评估执行探针。评审发现的双击 R1 由 Main 在 `34388af` 修复；16 项浏览器回归、四项固定样式复现和八项手势边界探针均通过，得到本轮实现 PASS。任务快照、规则和语料检查、剩余发布覆盖见[跨仓接入 Task](note://d2499d5b-4ceb-4d46-aa3b-18e5c9b86034/2ce416be-b118-40c4-bddc-87da25a8fe02)。这次原生子 Agent 评审没有生成内嵌运行时的正式验收回执。

完整验收补充：60 份 agentX 原文、254 份 JanusX 迁移来源与 3 份保护来源、261 份职责基线及 77 次移动全部核对；40 条跨仓引用解析通过。五种桌面运行模式通过，两个独立模式在就绪修复后各复验两次通过。271 帧完整录制、三仓规则同步与重复应用通过。5 份旧 Note 的原始工作区哈希未重现，agentX 旧个人配置无完整备份；正文、身份、历史验收与当前配置保护已验证，不将这些限制记成历史字节一致的证明。

## 验证与边界

验证命令、独立验收结果与历史证据限制见 [接入验证](../../../docs/migrations/workflowx-v2-verification.md)。桌面测试使用本地确定性 HTTP 模型驱动真实 Electron、IPC、工具与回执；它验证集成路径，不代表外部真实模型的质量或生产发布。演示追加采用 agentX `d6cd44569eee3c36c637a996131a1303b3900bde` 的工具修复判断，以及 JanusX `dc8a639` 的关闭采集收尾修复；原接入基线和回执不改写。已完成的本地验收与发布边界由 [跨仓接入 Task](note://d2499d5b-4ceb-4d46-aa3b-18e5c9b86034/2ce416be-b118-40c4-bddc-87da25a8fe02)跟踪。
