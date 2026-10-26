---
{
  "schema": "harness-note/2",
  "id": "bd7fd0c6-48d1-4d1c-8c6b-b675d7e489bd",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-04",
  "class": "architecture",
  "tags": [
    "harness",
    "agentX",
    "janus",
    "blueprint"
  ],
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/harness/service.ts",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/llm/chat-orchestrator.ts",
      "role": "implementation"
    }
  ],
  "relations": [
    {
      "type": "related-to",
      "target": "note://62b44166-82f0-41ff-838d-e2b02388ed06/ac75da81-9c0e-4ad2-964b-4919d924fe0e"
    }
  ],
  "updated": "2026-10-25T03:58:12.226Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f12d99b4-c116-48dc-96d9-e3ac74ae41cd",
  "repositories": {
    "primary": "972afef3-2fc7-49de-a3ee-7e041225d28c",
    "related": [
      "62b44166-82f0-41ff-838d-e2b02388ed06"
    ]
  }
}
---

# agentX 维护工程能力，Janus 复用并保留产品扩展

## Problem

两个宿主分别维护 Note 写入、工具适配和压缩逻辑，会让缺陷修复与校验规则漂移。只引用基础包却另写服务，无法保证用户在 CLI 与 Janus 得到同一工程能力。蓝图关注、高亮、画布组合及后续圆桌能力又属于 Janus 的软件需求，必须有独立扩展入口。

## Decision

agentX 拥有通用工程开发能力，Janus 通过共享包复用。Note 创建与结构化编辑由 harness-core 提供，读取缓存、事务、监听、共享导入和撤销由 harness-node 提供。Janus 的 HarnessNoteService 直接继承 NoteService，保留并发读取合并和空闲预热，不再导入蓝图插件。Note provider、索引增量更新和撤销模块直接导出共享实现；artifact-producer 仍兼容蓝图字段翻译，notes-cli 消费同一 Note 创建逻辑。

蓝图投影、组合、画布布局与折叠状态由 plugins/blueprint/src/main/notes/projection.ts 持有。插件的 BlueprintNoteService 将自身共享引擎接入这一投影；桌面旧入口通过 src/main/blueprint/note-service.ts 将同一 harnessNoteService 的索引、版本和证据覆盖接入投影。旧维护流程通过窄接口委托回这一实例，不建立第二份桌面 Note 缓存、监听或事务服务。该适配仍将蓝图代码编入旧宿主消费者；只有共享服务入口已脱离插件，主包拆分继续由[官方插件计划](../planning/blueprint-official-plugin.md)跟踪。

HarnessNoteService 的兼容函数导出通过共享模块命名空间上的本地常量绑定提供。`assertNoLocalLeak`、`claimsHarnessSchema` 和 `stripRemoteCreds` 与 agentX 导出的函数保持对象身份一致。当前主进程打包链路在动态导入命名空间时，会为直接转导出的外部函数生成缺少导入的引用，造成模块求值阶段的 ReferenceError；本地常量绑定使生成的命名空间具有真实运行时值。类型检查与构建成功不能替代产物加载验证。

命令与 Git 工具从 node-hosts 注册；Janus 的后台命令通过 ProjectRunner 适配以保留进程界面。MCP 使用 agentX 的连接和 runtime 审批。ManagedChatSession 与上下文类型从 chat-core 导入，Janus 不维护独立压缩实现。通用 IPC 契约从 agent-core 的浏览器安全入口导入；Janus 仅增加子会话事件归属字段，审批仍保留实际子会话身份。

工程会话默认执行 WorkflowX xdo，通过 /xdo、/xdel、/xflow 主动切换。Janus 在历史压缩前解析用户选择，将可信模式交给共享入口；项目会话允许共享工程工具，蓝图维护讨论继续按自己的工具限制执行。xdel 和 xflow 使用共享任务执行器，Janus 提供隔离子会话、审批与取消接线。

note.focus 和 note.scope 属于 Janus 的产品扩展。Note 读取及修改后的关注、高亮、撤销通知也由 Janus 适配，不进入跨端 Note frontmatter。工具清单支持动态注册，新增产品工具无需修改共享引擎中的工具名称白名单。

[agentX 运行机制](note://62b44166-82f0-41ff-838d-e2b02388ed06/ac75da81-9c0e-4ad2-964b-4919d924fe0e)记录模式、回执检查、MCP 和最小初始化的实现契约。[整体优化方向](note://972afef3-2fc7-49de-a3ee-7e041225d28c/24617149-0dfb-498e-96a6-c0fe23ea90b3)保留启动设置和蓝图空态的后续范围。

## Alternatives considered

- Janus 自建 harness 与工具：能够快速定制界面，但通用行为需要在两个仓库分别修复，不符合单一维护位置的要求。
- 禁止 Janus 扩展：共享边界最简单，但蓝图关注和圆桌等产品需求没有归属，容易产生隐式旁路。
- Do nothing / reuse：只复用既有基础包与提示词，成本最低，但不能保证共享服务、默认模式与实际任务执行的一致性。

## Consequences

Janus 的构建依赖 agentX 修订 6feb575bab1b067e6e4d8abc54d1f1d11a7bee23，CI 固定同一来源提交并按依赖顺序构建。桌面安装不再修补 agentX 的构建产物。通用服务修复在 agentX 完成，Janus 通过消费测试保证蓝图和 IPC 兼容；应用启动配置和进程界面的适配仍在 Janus。

[外部 WorkflowX 导入检测](./workspaces/requirements/workflowx-onboarding.md)消费 agentX node-hosts 的检测接口，Janus 负责注册工作区解析、IPC、刷新和 Island 展示。

xdo 采用回执提示，不把提示消失等同于完整验收。委派模式的验证与 Git 落地各有证据，无法提供子会话或结构化评审时明确失败。最小初始化提供共享预览、应用与撤销 API；启动检测、设置中的完整接入、蓝图空态和圆桌扩展不属于本决策的实现范围。

验证包括 Janus 的 harness-service、harness-note-index-patch、harness-share-import、harness-undo、note-chat、command-tools、git-tools、janus-agent-ports、managed-chat-session 和 janus-runtime-state，共 101 项通过。追加的蓝图维护与 harness 分组有 221 项通过、1 项按环境跳过，裸模式切换与记忆召回回归也通过。千 Note 场景的 projectView 实测约 3.3 秒，位于原测试预算内。严格未使用检查与生产构建验证宿主接线；共享层测试证据见 agentX 决策。

`tests/unit/harness-bundle-load.test.ts` 使用仓库的开发与生产主进程配置，实际打包含静态和动态服务导入的入口，再用原生 Node ESM 加载产物并校验共享函数身份。开发产物还通过 Electron 的 `scripts/dev-entry.mjs --smoke-test=module-graph` 检查，成功标记为 `[module-graph-smoke] ok`；此检查使用隔离用户目录且不打开应用窗口。SQLite 的 ExperimentalWarning 不影响模块加载检查的成功退出。

当前服务拆分的产物加载测试还检查两种构建的模块图都不包含 plugins/blueprint；这只证明共享服务入口的边界，不代表整个应用已排除蓝图。shared-note-service 的三项真实文件测试覆盖冷读合并、预热版本稳定、外部更新与写入冲突、投影复用及失败后重试；与维护、共享导入、撤销、Note 对话和读取分组共 15 文件 172 项通过，命令与后续完整应用验证归官方插件计划。

`npx vitest run tests/unit/harness-bundle-load.test.ts tests/unit/harness-service.test.ts tests/unit/harness-share-import.test.ts tests/unit/harness-s9-acceptance.test.ts --maxWorkers=1 --minWorkers=1`：25 项通过，包含开发与生产配置下的两项产物加载测试。
