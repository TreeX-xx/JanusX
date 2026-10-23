---
{
  "schema": "harness-note/2",
  "id": "b1f1f77c-5233-470b-a3fb-b60f044c47e3",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-23T09:53:40Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---

# 预览选元素 → AI 按元素改（element picker to AI edit）

## Expected behavior

内置浏览器与 HTML 预览都提供「选择元素」模式：悬停高亮页面元素、点击选中、Esc 退出。选中结果以元素引用进入会话输入框作为附加上下文，用户补一句自然语言指令后一同交给 AI；AI 以该元素为锚点定位项目源码并修改，用户在同一预览面刷新验证，全程不离开工作区。

两条面共用一份元素引用协议与同一条送达通道，取元素前端各自实现：

- **内置浏览器**（[browser-surface](../browser-surface.md)）：面向整段跑起来的项目（dev server、路由、脚本页）。取元素脚本仅在用户主动进入选取模式时注入，退出即撤；这是 surface 注记留白的「protocol, switch, and audit pass」的用户主动形态，不开放 agent 自由操作页面。
- **HTML 预览**（[file-editor-experience](../../workbench/file-editor-experience.md) 的 `HtmlPreviewFrame`）：面向单个 HTML 文件与产物。选取脚本随 shell 拼装的文档串注入，iframe 沙箱策略不放宽；`documentPath` 已知，元素可直接落到该文件。附加红利：选中后可在 Monaco 侧高亮元素所在源码段。

元素引用 payload 两面一致，DOM 引用为主：selector（含祖先层级链）、outerHTML 片段、计算后 CSS（实际尺寸、margin/padding、颜色、字体、对齐等计算值）、bbox、页面 URL、来源面标识，并默认附带高亮圈选后的局部截图供多模态理解（超限可省略并声明）。bbox 计入 HTML 预览的视口缩放变换。「改」指改项目源码，不做运行中 DOM 的即时改写。送达走聊天输入框附加上下文，不给 agent 开「读取当前选中元素」类工具面。

元素到源码的映射分档：目标态是源码映射——经 sourcemap／AST 组件树给出 `file:line`（如 `src/components/Navbar.tsx:35`）；本期验收走文本线索——AI 拿 selector／outerHTML／计算后 CSS 在工作区检索定位，`file:line` 映射留二期，做不稳前不进验收。

## Boundary

- 跨域 iframe、shadow DOM、canvas 内容覆盖不全，本期声明边界，不做覆盖保证。
- 注入只服务用户主动手势：选取模式外不注入、退出无脚本残留；[browser-surface](../browser-surface.md) 记录的「无 agent 页面脚本、无宿主接口暴露」立场不变。
- HTML 预览 iframe 沙箱（`allow-scripts` 等）不因本需求放宽或增补 `allow-same-origin`；注入经 shell 掌握的文档串进入。

## Acceptance criteria

- [ ] AC-1: 内置浏览器页内可进入选取模式：悬停高亮、点击选中、Esc 退出；退出后页面无脚本残留，选取模式外无注入。
- [ ] AC-2: HTML 预览提供同一交互与同一 payload 格式；选中后可在 Monaco 打开的同一文件中高亮元素所在源码段。
- [ ] AC-3: 选中结果以元素引用芯片进入会话输入（含 selector、outerHTML、计算后 CSS、bbox 与高亮截图），与用户指令一同送达 AI。
- [ ] AC-4: AI 以元素引用在工作区定位对应源码并完成修改；本期定位手段为文本检索。
- [ ] AC-5: 修改后可在同一预览面刷新看到效果，闭环不切换到外部浏览器。

## Alternatives considered

- 只做内置浏览器（需求原话的字面范围）——最强理由是忠实原话、零多余入口。划掉它的理由是 HTML 预览上映射近乎免费（文件已知），两边协议同构，同批只增约两成成本，换来产品内交互一致。
- HTML 预览先行再攻内置浏览器——最强理由是便宜地先跑通闭环。划掉它的理由是核心诉求（看运行中项目说不清元素名）交付最晚，两套注入拆两批做重复上下文切换。
- 改运行中 DOM（DevTools 式即时改）再落盘——最强理由是体验即时。划掉它的理由是与「无页面脚本写通道」的既有边界正面冲突，审计面大，收益可用「改源码＋刷新」逼近。
- 元素上下文做 AI 可调用工具——最强理由是 agent 能主动索取选中元素。划掉它的理由是等于给 agent 开页面读通道，属 surface 注记里需独立 protocol／switch／audit 的范围，本期以用户点选的推模式满足。
- 源码映射 `file:line` 提进本期验收——最强理由是定位一步到位，业界对照描述将其列为标配传输物。划掉它的理由是 sourcemap／组件树解析是独立工程，框架覆盖不全时给错行比不给更糟；目标态保留、二期交付。

## Reference

需求短语由用户 2026-10-23 提出（「内置浏览器功能希望能有选择元素功能，我可以让AI按照这个元素位置改」），两面都做的范围经当轮讨论敲定。同日用户提供业界对照描述（痛点／传输物／产品对标），对齐后 payload 补入计算后 CSS、祖先层级链与默认高亮截图，源码映射明确为目标态（本期文本检索、`file:line` 留二期）。对标产品：Cursor Design Mode（内置浏览器点选生成 Diff）、Bolt.new／v0.dev／Lovable（预览圈选锚定组件改写）、Stagewise 类 AI Inspector 扩展（DOM＋CSS 打包进 prompt）、Builder.io Visual Copilot（可视化点选编辑）。模式先例：`stablyai/orca` 的 Chromium element picker（HTML＋CSS＋截图进 prompt），见 [desktop-ade-mit-survey](../desktop-ade-mit-survey.md) 借用表；本篇即该借用在预览面的落地点，补上其 landing 列此前未单独命名的缺口。

相关设计：[browser-surface](../browser-surface.md)（内置浏览器载体与注入边界）、[artifact-preview](../../agent/requirements/artifact-preview.md)（HTML 产物自动预览，点选的典型对象与来源）、[file-editor-experience](../../workbench/file-editor-experience.md)（`HtmlPreviewFrame` 视口／缩放与 Monaco 分栏）。`HtmlPreviewFrame` 见 `src/renderer/src/components/viewers/HtmlPreviewFrame.tsx`，原生视图管理见 `src/main/browser/surface-manager.ts`。
