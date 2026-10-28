---
{
  "schema": "harness-note/2",
  "id": "ff1fd0c5-c997-4c70-8824-ba13a76d0087",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-27",
  "updated": "2026-10-27T15:52:43.428Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/48db2e15-9318-5068-b300-b1913abf5463"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/bd7fd0c6-48d1-4d1c-8c6b-b675d7e489bd"}
  ]
}
---

# 浏览器与桌面应用控制

## Intent

研究如何让 JanusX 内置 Agent 和外部终端 Agent 操作网页与桌面应用，并把运行时分发、工具发现、登录态、权限引导和故障恢复做成开箱即用的体验。建议先打通现有内嵌浏览器，再增加 Windows 桌面控制。本 Note 记录分析与候选方案，尚未批准技术选型、实施或验收范围。

首个目标流程是：用户安装 JanusX、配置模型后，说“打开项目网页，检查登录表单”，Agent 能打开用户可见的页面、操作并检查结果，返回截图或错误依据。模型服务配置仍是前提；视觉坐标操作还需要模型具备图像理解能力。

## 当前基础与边界

[内嵌浏览器](./browser-surface.md)已有每标签页独立的 WebContentsView、持久 partition、内嵌与独立窗口切换、导航和加载状态。`src/main/browser/surface-manager.ts` 中已有 `capturePage` 调用及 `agentControlled` 状态，`src/shared/ipc/browser.ts` 有导航、标签页和状态事件契约；这些基础不代表 Agent 已能操作网页。当前实现明确不包含 Agent 页面脚本与主进程控制客户端。

[选元素→AI 按元素改](./requirements/element-picker-ai-edit.md)是用户主动点选、把元素上下文送入聊天的独立需求，不等同 Agent 自主控制页面。本探索若进入实施，需要单独明确页面操作协议和授权边界，不隐式放宽该需求的注入限制、HTML 预览沙箱或宿主接口暴露限制。

[agentX 复用边界](../blueprint/agentx-harness-inheritance.md)已有共享工具注册、MCP 与审批接线。通用协议、工具描述和客户端适配可评估放入共享层；Electron 页面实例、窗口生命周期和系统权限引导由 JanusX 宿主持有，具体包归属待定。

## 参考项目观察

2026-10-27 阅读 codeg、Orca 的公开源码与文档；未运行它们的安装包。以下是所读实现的观察，不代表跨平台实测结果。链接指向上游 main，后续实现时需固定来源修订并重新核对许可。

| 方面 | codeg | Orca | 对 JanusX 的启发 |
|---|---|---|---|
| 浏览器感知与操作 | 在页面隔离世界运行脚本，复用 Playwright ARIA 树，提供 snapshot、元素引用和 act | 内嵌 Chromium，通过 CDP 和 agent-browser 桥接自动化，CLI 提供 snapshot、click、fill 等操作 | 控制用户正在看的同一页面，统一语义快照与操作 |
| 桌面控制 | 固定版本 cua-driver，配合 helper、窗口共享授权和停止机制 | 分平台助手；Windows 使用 UI Automation、PowerShell 与系统接口 | 比较复用驱动与维护平台助手的成本 |
| 运行时交付 | 自动获取固定版本驱动，并校验归档、可执行文件摘要；macOS 另有签名检查 | 浏览器桥接优先寻找随包的平台二进制；桌面文档说明分平台原生助手 | 不让用户手装开发运行时，运行时版本由产品管理 |
| Agent 接入 | 通过 Agent 工具体系提供浏览器与桌面能力 | CLI 与技能暴露同一能力给终端 Agent | 内置工具、CLI、MCP 共用宿主服务 |
| 状态可靠性 | 页面快照带 generation，旧引用在导航等条件下失效；宿主参与导航 epoch 管理 | 强调 snapshot→act→snapshot，元素索引属于最新快照 | 操作基于明确状态，执行后验证结果 |

codeg 的 browser-agent 明确将 JavaScript 派发事件标为 synthetic fidelity：合成点击、按键不能完全替代真实用户输入，弹窗用户激活、真实 hover 等存在限制。JanusX 不应把成功派发事件当成业务动作成功，应按动作选择 CDP 输入、语义操作或视觉兜底，并读取后续状态验证。

参考来源：

- [codeg browser-agent：隔离世界、ARIA 快照、引用失效与合成操作限制](https://github.com/spacering-net/codeg/tree/main/browser-agent)
- [codeg 浏览器工具协议与错误分类](https://github.com/spacering-net/codeg/blob/main/src-tauri/src/acp/browser_tools.rs)
- [codeg cua-driver 分发、版本与完整性校验](https://github.com/spacering-net/codeg/blob/main/src-tauri/src/computer/driver.rs)
- [Orca 浏览器：同页自动化、登录 profile 与远程网络归属](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/browser/overview.mdx)
- [Orca Computer Use：能力检查、快照、操作和截图](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/cli/computer-use.mdx)
- [Orca 随包 agent-browser 二进制解析](https://github.com/stablyai/orca/blob/main/src/main/browser/agent-browser-bridge-process.ts)
- [Orca Windows UI Automation 实现](https://github.com/stablyai/orca/blob/main/native/computer-use-windows/runtime.ps1)

## 候选架构

内置 Agent 直接注册工具；外部终端 Agent 通过 CLI 或 MCP 接入。三个入口委托同一个 JanusX 自动化服务，统一会话身份、目标归属、能力发现、取消和操作记录，避免各自维护一套点击逻辑。浏览器服务与 Computer 服务分别实现后端，保持页面元素引用和桌面窗口引用的类型边界。

浏览器第一版候选能力为 `list_tabs / open / navigate / snapshot / click / fill / press / scroll / screenshot / console / network_errors`。优先评估 Electron `webContents.debugger` 在主进程内使用 CDP，快照按需结合隔离世界脚本，复用 Electron 自带 Chromium。是否引入完整 Playwright 或 agent-browser，要以快照质量、iframe 覆盖、维护成本和包体实测决定，当前不预设为依赖。

桌面第一版候选能力为 `list_apps / list_windows / snapshot / click / set_value / screenshot`，随后按需要增加按键、滚动和拖拽。优先操作可访问性元素，画布或自绘控件再以截图坐标兜底。优先评估 cua-driver；若 Windows 兼容性或分发成本不满足需求，再比较 Orca 的 UI Automation 路线。

快照引用至少绑定会话、目标标签页或窗口，以及快照版本。页面导航、目标销毁或其他使引用无效的变化应返回明确失效错误，让 Agent 重新获取快照，不能把旧编号解析到新元素。动作执行后读取状态验证；请求已经发出而响应丢失时，先检查结果，避免重复提交。

## 开箱即用的交付条件

- 运行时由应用负责：浏览器复用 Electron；桌面 helper 随包分发或自动下载固定版本并验证完整性。若要求首次离线可用，所需 helper 必须随包携带；不依赖用户另装 Node、Python 或 Playwright。
- 工具自动可发现：内置 Agent 启动时注册能力；JanusX 启动的终端注入 CLI 路径与受控会话信息；外部 Agent 提供一键接入 MCP/技能，并验证实际连通性，不只写入配置文件。
- 登录态连续：用户和 Agent 使用 JanusX 中同一网页实例和浏览器会话。复用系统 Chrome/Edge 的既有登录态另行设计扩展或显式连接，不视为内嵌浏览器已有能力。
- 可停止和接管：显示页面或窗口的控制状态；取消后阻止排队中的后续动作。桌面前台输入串行，浏览器按页面协调控制，避免多个会话争抢同一目标；单例全局浏览器不代表所有会话都获准操作全部标签页。
- 故障可恢复：区分驱动缺失、系统权限不足、窗口关闭、引用失效和页面超时，给出相应恢复路径。系统权限可能需要用户首次授予，应用负责检测与引导。
- 按能力匹配模型：语义树操作与视觉坐标操作分别声明所需能力，工具不可用时明确说明，不将视觉能力缺失伪装为页面失败。

## 推进顺序与候选验证

以下为建议阶段与验证场景，未创建 Task，也不是已签收的验收清单。

| 阶段 | 建议交付 | 代表验证场景 |
|---|---|---|
| 一 | 内置 Agent 控制现有内嵌浏览器 | 打开本地网页，填写表单、点击并验证页面结果 |
| 二 | CLI/MCP 复用浏览器服务 | 外部终端 Agent 操作同一标签页，保持会话和目标归属 |
| 三 | Windows 桌面控制 | 发现指定窗口，读取控件、输入和点击，并验证结果 |
| 四 | 完整流程与恢复 | 登录、上传下载、弹窗、重启和异常恢复 |

首阶段应在干净安装环境检查无额外开发依赖、重启后登录态保留、导航后拒绝旧引用、两个会话不串页，以及用户停止后不再执行后续动作。驱动完整性与权限不足路径、前台输入竞争及动作结果未知时的恢复，应随对应后端加入实物验证。单元测试和源码接线不能替代安装包及真实应用验证。

## Open questions

1. 浏览器后端直接使用 Electron/CDP，还是组合成熟自动化库；跨域 iframe、Shadow DOM、canvas 与 DevTools 同时连接如何处理？
2. cua-driver 的 Windows 实际兼容性、性能、许可、包体与分发可用性是否满足 JanusX；是否需要维护平台助手？
3. 会话对标签页和应用窗口的授权粒度、控制租约、撤销与记录范围如何与现有审批体系组合？
4. 外部终端 Agent 的 CLI 路径、会话凭据和 MCP 接入如何做到自动发现、隔离、过期与清理；不同 Agent 的图片结果如何消费？
5. 自动下载与随包分发如何取舍，是否要求首次离线可用；远程终端调用时页面、应用和网络分别属于哪台机器？
6. 源码只读调研之后，应固定哪些上游修订，并用哪些真实网站、Windows 应用和模型建立最小兼容矩阵？
