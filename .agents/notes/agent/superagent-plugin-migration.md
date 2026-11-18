---
{
  "schema": "harness-note/2",
  "id": "b57d906f-e3ad-4e69-aa33-6bcbe78404a2",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-11-17",
  "updated": "2026-11-18T06:36:30Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/01f4c269-442b-4a80-8ac1-f4928da6b8d9"
    }
  ]
}
---

# SuperAgent 官方实验插件迁移计划

依据[已采纳的产品决策](./superagent-plugin.md)，迁移目标是让普通 Janus 独立可用，让用户主动启用整套编排体验，并在停用后仍能查看历史。以下分析基于 JanusX 工作树（HEAD 为 `45421735`）及本机安装的 agentX 引擎包。阶段顺序和接口边界为实施建议。

## 实施进度

阶段 1 已接入普通聊天的显式模式判断。即使旧请求带有工作区和输入事件，只要省略模式，也按普通回合处理。升级后首次读取旧偏好时，工作台启动状态与聊天模式恢复为默认值，面板宽度和报告已读记录沿用。用户重新选择的模式可跨重启保留。

主进程注册 IPC 和关闭未使用的宿主时均无需构造执行服务。首次获准访问编排时才构造服务并订阅事件。全局通知推迟首次工作区快照读取，用户主动打开内置工作台后仍可使用 Worker 快捷入口。阶段 1 还需验收不可用提示、输入保留以及其他入口，随后拆分只读历史与执行接口。独立签名包和 macOS 受管 Worker 仍待后续阶段交付。

## 迁移前的源码边界

| 现有路径 | 对迁移的影响 |
| --- | --- |
| 桌面启动时注册 SuperAgent IPC，默认构造记录、环境、Worker 和设置，再绑定主进程单例。[IPC 装配](../../../src/main/ipc/superagent-handlers.ts) | 仅隐藏入口仍会创建执行服务。需要把历史读取与执行服务的构造拆开。 |
| 聊天轮次在条件满足且模式不等于 ordinary 时接入 SuperAgent。旧请求可省略模式，旧 UI 偏好缺失时也会选 SuperAgent。轮中补充、撤回、工具挂载、模型回顾均持有本轮对象。[聊天编排器](../../../src/main/llm/chat-orchestrator.ts) · [桌面适配](../../../src/main/janus/superagent/desktop-chat-turn.ts) · [用户偏好](../../../src/renderer/src/stores/superagent-ui.ts) | 插件页无法单独承担迁移。宿主必须在接受输入时检查启用状态，并将同一回合绑定到同一次插件激活。 |
| service、workers、persistence 等桌面文件转出 agentX 实现。Codex 会话、Git 受控提交等普通功能也使用相关代码。Worker MCP 目前是桌面独立构建入口。[引擎转出](../../../src/main/janus/superagent/service.ts) · [普通终端](../../../src/main/terminal/codex-conversation.ts) · [构建入口](../../../electron.vite.config.ts) | 复用锁定的 agentX 包。按调用者拆分模块，逐一核对普通终端、Git 和项目功能依赖，不能按 superagent 目录名整体移除。 |
| 数据根为 `userData/janusx/superagent`。引擎分别维护 records.json、resources、environments.json、scheduling.json 和 lifecycle.json，桌面另管 Worker 设置。[装配与路径](../../../src/main/ipc/superagent-handlers.ts) · [设置](../../../src/main/janus/superagent/worker-settings.ts) | 建议首轮沿用既有目录和身份。宿主提供按工作区授权的历史查询，执行侧经单一写入接口更新；重开历史不触发调度。 |
| 官方插件已有签名安装、native 白名单、独立进程和消息调用。现有停用流程先撤销激活，再等待 native 收尾。应用退出会并发启动插件停止与 SuperAgent 落盘。[插件服务](../../../src/main/plugins/service.ts) · [native 服务](../../../src/main/plugins/native-service.ts) · [退出流程](../../../src/main/shutdown/AppShutdown.ts) | 长任务需要在撤销激活前处理等待或停止的选择，宿主还要能在插件崩溃后收回自己启动的子进程。 |
| 受管 Worker 目前只对本地 Windows 的 Codex、Claude 放行。Mac 插件打包入口当前只枚举 Blueprint、CPA、Docker。[能力判断](../../../src/shared/runtime/capabilities.ts) · [打包脚本](../../../scripts/plugins/package-mac.mjs) | Windows 提供现有执行基线。macOS 的插件分发、受管 Codex 和 Claude 驱动以及双架构实机验收均纳入本次迁移，按下述阶段交付。 |

## 实施顺序与验收

1. **先把普通模式做成独立可验收的路径。** 在既有实现上增加按需创建的编排入口。新安装、缺失模式或旧偏好残留时，普通聊天可以发送、补充和停止。显式请求不可用的 SuperAgent 时返回可见状态，保留原输入，防止同一条输入被静默转入另一个执行模式。检查启动页、设置、Island、自动化和备忘录的入口。验收用不装插件的新配置及含历史偏好的旧配置，确认普通回合没有创建 Worker、队列或编排工具。

2. **固定历史和执行资源的归属。** 在旧实现仍可运行时，为工作、执行、审批和子进程建立宿主侧身份。提供按工作区读取快照、详情和原文的只读入口。保留 workId、executionId、会话、worktree 关联以及未确认停止的记录。引擎适配描述如何启动或继续，宿主验证平台、CLI、工作区和批准对象，持有进程句柄和停止回执。用旧数据副本验证重启、无插件读取、重复事件及跨工作区拒绝；确认打开历史不会续跑或改写原文。

3. **用签名测试包打通一个真实回合。** 新建候选插件，建议 ID 为 `official.superagent`。复用现有 native 进程和 signer 白名单，以版本化消息完成输入接收、工具调用、轮中补充、取消和状态事件。宿主保留模型连接与凭据，双方传递可序列化的工具描述、调用 ID 和结果；当前进程内的函数、ports、AbortSignal 需映射为明确的请求和取消消息。先在 Windows 与 Apple Silicon 迁移单工作区、单 Codex Worker，串起对话→分派→批准→执行→回报→历史。用固定 eventId 重投、撤回和插件重启验证幂等；旧激活的迟到回报不能改变新执行。兼容版本不足时在安装阶段给出提示。

4. **补齐运行中停用、崩溃与退出。** 由宿主先冻结新派发及队列自动出队，列出运行中、排队和待审批的工作。选择等待时让既有执行完成并保留回答审批的入口；选择停止时取消待执行派发，向正在运行的执行发停止请求并等待回执。未确认退出的执行继续占用容量并显示状态。插件异常退出时由宿主清理进程、落盘中断状态；重启只恢复记录。停用、重载、升级、卸载和应用退出复用同一收尾流程。用等待审批时停用、回执超时、重启后迟到回答、并发退出验证，确保不会误批准、重复执行或遗留失管进程。

5. **迁移完整体验并切换分发。** 将并发队列、工作流、Claude 适配、Worker 视图与专属设置逐项迁入，连接原 Janus 输入框。宿主保留历史入口和审批交互，首派显示负责人、工作内容与停止入口。先在测试配置比较内置和插件实现的可观察结果，每个工作区同时只有一个执行方。Windows 回归原有 Codex 和 Claude 驱动，Apple Silicon 与 Intel 按下表分别验收两种引擎。各平台同时回归普通终端、Git、聊天和其他插件。通过后更新宿主兼容范围、打包清单与发布白名单，移除旧执行装配。Worker MCP 的落点以进程归属和打包后实测为准，需覆盖路径含空格、插件升级及旧进程存活场景。

## macOS 适配与交付

本节承接[桌面兼容性记录中的 MAC-13](../desktop/macos-compatibility.md)，复用宿主的 CLI 检测、登录环境恢复和进程管理。实施顺序建议先在现有 Apple Silicon 开发机打通 Codex，再接入 Claude，并在 Intel Mac 上复验同一套流程。Windows 回归和 Mac 适配沿用同一插件协议。

| 对应阶段 | Mac 工作项 | 验收条件 |
| --- | --- | --- |
| 1–2 宿主与历史 | 让能力查询区分本机架构、引擎和 CLI 可用状态；逐处核对启动、设置、队列恢复的能力检查。复用路径规范化处理工作区和 worktree 身份。 | 从 Finder 启动已打包的 JanusX，普通聊天与旧历史可用。CLI 缺失或该驱动尚不可用时给出具体原因，队列没有新增执行。含空格、中文及 /var 与 /private/var 别名的同一 checkout 可正确识别。 |
| 3 签名包与 Codex | 将 SuperAgent 加入 Mac 插件构建及测试宿主的签名白名单，核对包内 native 入口与已安装宿主的 Worker MCP 实际路径。用宿主解析的 CLI 绝对路径和登录环境启动 Codex。 | 在隔离 profile 导入、授权、启用签名 .jxp，从同一 Janus 对话完成真实分派、MCP 握手、批准或拒绝、执行、报告及历史回读。覆盖从 Finder 与终端启动、插件安装路径含空格，以及 CLI 或 MCP 缺失时的失败回执。 |
| 4 进程与审批 | 明确 macOS 下宿主对 Worker 及其 MCP 子进程的归属和停止方式，处理原生权限提示、待回答请求以及应用退出。 | 分别在执行中、待审批时停用，验证等待完成与立即停止两条路径。另测插件崩溃和 Cmd+Q，核对进程退出、队列占用释放与记录落盘。重开保留历史，迟到批准不能唤起已停止的执行。 |
| 5 Claude 与双架构交付 | 适配现有 Windows 原生 Claude Worker 使用的会话传输、MCP 配置、权限回传和续接。分别检查 Claude 普通终端与受管 Worker 的能力判断。[Claude Worker 实现](../../../src/main/janus/superagent/claude-worker.ts) | 在 Apple Silicon 和 Intel 原生宿主上各验证 Codex、Claude 两项。每项记录主程序与插件版本、宿主架构、CLI 版本、启动、审批、续接、停止和历史结果；另验证签名包升级、停用后历史可读及普通 Claude 终端回归。 |

**发布与回退。** 包的平台声明按架构发布，Worker 可用性按架构和引擎控制。某个引擎未验收时，该组合继续显示不可用；例如 Apple Silicon 的 Codex 通过后可先行试点，Claude 和 Intel 各自保留待验收状态。两种架构的 Codex、Claude 均完成实机验收才关闭 macOS 迁移工作项。若试点回退，先停接新工作并收尾已有执行，再关闭受影响组合，保留普通聊天和历史读取。

## 切换与回退

首次切换前先用旧版本 profile 副本演练升级和回退。活动执行结束或取得停止确认后才移交写入权；每个发布批次只允许一个调度器领取同一队列。若试点失败，停用候选、保留现场与历史，普通 Janus 继续可用。只有旧版本能读取当前数据且旧执行已收尾时，才恢复旧执行入口。若后续确需改变数据格式，将备份、版本标记、可重试迁移和旧版本读取策略单列为切换前置步骤。

## 验证基线

优先复用现有的[路由](../../../tests/unit/superagent-routing.test.ts)、[持久化](../../../tests/unit/superagent-persistence.test.ts)、[生命周期](../../../tests/unit/superagent-lifecycle.test.ts)、[插件分发](../../../tests/unit/plugin-distribution.test.ts)与[native 服务](../../../tests/unit/plugin-native-service.test.ts)测试。桌面集成延用[桌面用例](../../../tests/e2e/desktop-superagent.spec.ts)和[真实引擎用例](../../../tests/e2e/desktop-superagent-live.spec.ts)。本次在 Apple Silicon 上跑前五组，69 项通过、2 项失败、3 项跳过；两个失败均为路由用例对临时目录的字符串比较，实际值带有 /private 前缀。将 TMPDIR 设为同一目录的 realpath 后，单独重跑路由组 12 项全部通过。迁移阶段另需覆盖真实签名包、旧 profile、Windows 回归及上述四项 Mac 架构与引擎组合。当前四项均待迁移实测。
