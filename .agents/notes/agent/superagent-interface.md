---
{
  "schema": "harness-note/2",
  "id": "f818911a-9077-46c0-9117-8e1fc1298eb3",
  "kind": "decision",
  "lifecycle": "accepted",
  "created": "2026-11-06",
  "updated": "2026-11-06T10:18:14Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/57c74036-6700-47ea-abcc-1710c3962b5e"
    }
  ],
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/janus/SuperAgentWorkspace.tsx",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/janus/styles/18-janus-conversation.css",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/janus/SuperAgentWork.tsx",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/janus/useSuperAgentNotices.ts",
      "role": "implementation"
    }
  ]
}
---

# SuperAgent 界面、通知与终端分屏

## Problem

P6 的工作卡仍嵌在聊天消息中，完整执行能力尚无常驻工作界面。2026-11-06 用户授权一起实施 P7、P8，明确界面无需参考离线 HTML，Worker 面板必须能够展开收起，并遵守现有分屏规则，让用户继续唤出及操作普通终端。

## Decision

SuperAgent 使用现有全局工具树的单例 pane，复用 JanusChat 和应用级对话控制器。初始终端选择页、Island 中的启动按钮与工具箱指向同一个 pane；重复启动只定位，不新建模型会话或执行。项目的终端树、全局工具树和外层分隔线沿用[全局分屏规则](../workbench/global-tool-layout.md)，切换项目不搬移工具。没有项目 pane 时聊天使用工具区，显示终端入口恢复项目启动区；已有终端保留分屏、比例和实例。

标签使用 Janus 的双眼图形，启动按钮与工具箱入口保持同一形象。首页与 Island 启动入口统一显示「Super Agent」，不再附加 Open／打开动作词。标签下方不再重复显示 Janus／JanusX 标题或空对话品牌图；终端入口与 Worker 开合按钮并入标签栏右侧，不额外占用一行。Worker 使用唯一的「Workers」文字开关，以箭头方向和背景表示展开状态，并通过分隔线与工具区总开关分组；不再复用外层侧栏图标，面板标题内也不重复提供收起按钮。窄 pane 使用同一入口展开 Worker、返回对话，切回后恢复输入框焦点及草稿。当前工作区通过已有项目导航与 Worker 列表识别。

Island 与 SuperAgent 已统一采用现有原生对话模式的视觉风格：14 px 正文、右侧浅底圆角用户气泡、带 Janus 双眼图形的回复署名，以及底部集中放置模型、权限和发送控件的圆角输入框。消息与输入区分别限制阅读宽度，随 pane 宽度缩减留白；深色、浅色和 Planche 均使用现有主题变量。两处 JanusChat 开启同一呈现选项，共用 `18-janus-conversation.css`，工具过程继续使用共享对话组件，移除 SuperAgent 对消息和输入区的独立样式覆盖。底层会话、历史和执行能力继续共享，专属呈现集中于工作安排、真实状态、阶段结果和待确认事项。

Island 对话模式保留会话管理和手动工作区附件。SuperAgent 不呈现会话列表、新建／切换会话入口，也不呈现工作区添加、移除与附件条。其前台注意力自动跟随当前工作区：每条消息和普通项目工具使用发送时固定的同一工作区，无需附加；没有选中工作区时不沿用旧附件。切换工作区不改写已提交消息的归属，也不取消该消息正在建立的工具会话。Island 原有附件选择继续保留。

Worker 侧栏属于聊天 pane 内部，支持独立收起、指针及键盘调宽。空间不足时自动收起但保留用户偏好；窄 pane 显式展开时在本 pane 内查看 Worker，返回对话后草稿仍在，不遮挡其他终端区域。开合、卸载和关闭工具标签都不调用停止接口。聊天快捷键只由当前获得焦点的呈现处理。

状态侧栏展示当前驻留实例和排队安排，按集合扩展，历史仍通过对话查询。原生审批、问题和具体 Git 计划在聊天内回答，待决策项与明确定位的工作不受列表分页截断。状态与决策共用一份订阅和工作视图，卡片不决定下一条自然语言输入的归属。详情保留目录、分支、原生会话及结果来源，并通过已有 Git／Diff 工具查看实际工作目录，不计算虚构完成百分比。

应用级通知订阅独立于 pane。正式报告、原生决策和失败按稳定身份进入 Island 通知历史，普通输出只刷新状态。通知包含来源项目，打开阅读器不导航；用户选择定位后才切到来源项目与原对话。启动 SuperAgent 后，Island 手势只操作通知；其他软件发起的 Janus 对话请求定位同一工作界面。重开应用恢复呈现偏好和历史，不自动启动执行。

P8 联调补齐 `work_git`：同一 Janus 只能根据当前宿主输入和已读工作卡提出受控合并／删除计划，具体审批仍由用户完成。持久操作身份防止相同输入重复生成计划；未知结果不重放。删除保留分支，审批显示实际工作目录、目标分支、未合并状态及忽略内容。

## Alternatives considered

把聊天扩成浮层会覆盖终端，另建项目 pane 则需要在切换工作区时搬移同一 Janus。全局工具树已拥有单例、布局隔离和窄窗恢复能力，因此复用。代价是终端与 SuperAgent 分属外层两个区域，不能混成同一项目 tab；各区域内部继续使用已有分屏和排序。

## Consequences

离线 HTML 保留为历史探索，不作为本轮设计来源或交付产物。执行状态仍由宿主事实决定，界面呈现偏好不能替代停止、批准或继续意图。若未来要求把全局 Janus 放入任意项目 pane，应先重新界定唯一呈现及工作区归属。

代码已接入，联合检查的结果与边界统一维护在[验收证据](superagent-verification.md)，不能以本决策的接受状态推定所有固定 AC 已通过。
