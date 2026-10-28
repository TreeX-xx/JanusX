<p align="center">
  <a href="https://github.com/TreeX-xx/JanusX" title="喜欢 JanusX？点击仓库右上角 Star 支持项目">
    <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/janus-header.svg" alt="JanusX 头图：圆角双眼胶囊与像素字标；欢迎点击仓库右上角 Star 支持项目" width="620" />
  </a>
  &nbsp;
  <img src="resources/icon.png" alt="JanusX 应用图标" width="148" />
</p>

<div align="center">

# JanusX

### 把项目、终端与 AI 编程助手放进同一个桌面工作区

多项目切换、多终端分屏，蓝图、会话与常用工具随手打开。

[![Release](https://img.shields.io/github/v/release/TreeX-xx/JanusX?include_prereleases=&style=flat-square&color=D43D2A)](https://github.com/TreeX-xx/JanusX/releases)
[![Windows x64](https://img.shields.io/badge/Windows-x64-1C343B?style=flat-square)](https://treex-xx.github.io/JanusX/)
[![Downloads](https://img.shields.io/github/downloads/TreeX-xx/JanusX/total?style=flat-square&color=1C343B)](https://github.com/TreeX-xx/JanusX/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-1C343B?style=flat-square)](./LICENSE)

[下载安装](https://treex-xx.github.io/JanusX/) · [版本发布](https://github.com/TreeX-xx/JanusX/releases) · [使用与架构文档](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md) · [反馈问题](https://github.com/TreeX-xx/JanusX/issues)

> Second test Oct 12 (not v1.0 stable) · 10.12 二测（非正式版）

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/janus-overview.png" alt="JanusX 工作台：Claude、Codex、OpenCode 与 Pi 分屏，左右侧栏，以及右下角蓝图窗口" width="960" />
</p>

[并行分屏](#并行分屏) · [Island 对话](#island-对话) · [运行配置](#用对话生成运行配置) · [蓝图](#蓝图让项目约定持续更新) · [用量统计](#从当前终端到历史用量) · [会话管理](#找回会话接着上次的工作继续) · [工具与集成](#工具与集成)

## 并行分屏

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>终端自由组合</h3>
<p>拖拽标签，上下或左右分屏。调整比例、重新合并，让终端各就各位。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-split.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-split.gif" alt="Claude、Codex、OpenCode 与 Pi：左右分屏、四格组合、调整比例与合并标签" width="100%" /></a></td>
</tr>
<tr>
<td width="30%" valign="middle">
<h3>副黑板与工具区</h3>
<p>下拉胶囊，边看蓝图边工作。终端与全局工具区各自分屏，切项目仍保留工具布局。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-workspace-layout.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-workspace-layout.gif" alt="OpenCode 与 Pi 并行，浏览器与 Markdown 上下分屏，展开蓝图副黑板并切换项目" width="100%" /></a></td>
</tr>
</table>

## Island 对话

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>项目上下文随行</h3>
<p>从胶囊进入对话，询问代码入口、理解实现，再追问修改方向与验证方式。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-island-chat.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-island-chat.gif" alt="Island 附加项目、读取代码、流式回答与连续追问" width="100%" /></a></td>
</tr>
</table>

<sub>本地脚本模型与示例项目，展示真实文件读取和两轮对话。</sub>

## 用对话生成运行配置

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>从描述到启动</h3>
<p>描述启动方式，生成开发和测试配置。检查差异并确认保存，再测试、启动；操作由你控制。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-run-config.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-run-config.gif" alt="对话生成开发与测试配置、批准保存、测试通过并启动服务" width="100%" /></a></td>
</tr>
</table>

<sub>本地脚本模型与示例项目；配置写入、测试和服务启动均为实录。</sub>

## 蓝图，让项目约定持续更新

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>用对话维护 Note</h3>
<p>浏览模块、关注约定，在右侧对话中维护文档，并对照更新后的正文与修改差异。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.gif" alt="浏览搜索模块，通过对话核对实现并更新现有 Note，查看正文与修改差异" width="100%" /></a></td>
</tr>
<tr>
<td width="30%" valign="middle">
<h3>Git 提交，自动审核</h3>
<p>按 Git 提交规则检查 Note 与项目材料。定位建议及依据，通过对话修复，再查看复审结果。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-review.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-review.gif" alt="Git 提交触发审核，查看 Note 与源码依据，修复后独立复审通过" width="100%" /></a></td>
</tr>
</table>

<sub>本地脚本模型与示例项目，真实读取、写入与复审；审核片设为每次提交检查。</sub>

<details>
<summary>开启方式与文档说明</summary>

蓝图需在设置的创新功能中开启，模型维护与审核需要可用的模型配置。自动审核默认关闭，默认每 5 次提交检查；保存文档不等于触发审核。

蓝图读取 `.agents/notes/` 中的模块与主题文档，文档身份、生命周期、模块状态和任务执行结果分别表达。[查看静态图](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-blueprint-workbench.png) · [Wiki](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md)。

</details>

## 从当前终端，到历史用量

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>明细与趋势</h3>
<p>展开终端底部栏，查看模型、上下文与输入输出明细；进入历史统计，按时间与引擎查看趋势、热力分布和费用。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage.gif" alt="Claude 与 Codex 底部用量明细、本周统计、引擎筛选、趋势与预估费用" width="100%" /></a></td>
</tr>
</table>

<sub>示例用量，经真实日志解析与账本统计；缺失数据保持未知，费用为估算。</sub>

<details>
<summary>查看用量静态明细</summary>

两张图片分别取自终端抽屉与历史统计页面，点击可放大。

[终端用量抽屉](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage-drawer.png) · [历史统计、热力与费用](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-usage-statistics.png)

</details>

## 找回会话，接着上次的工作继续

<table width="100%">
<tr>
<td width="30%" valign="middle">
<h3>搜索、回看、继续</h3>
<p>按范围与关键词找到对话，展开最近轮次、回看完整详情，再从入口继续原对话。</p>
</td>
<td width="70%"><a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session.gif" alt="搜索示例会话、展开两轮记录、阅读详情与继续对话确认" width="100%" /></a></td>
</tr>
</table>

<sub>示例对话记录；展示继续对话的确认并取消，未发送模型请求。</sub>

<details>
<summary>查看外部 CLI 会话</summary>

从原生历史文件发现外部会话，查阅只读转录，并使用提供方的续接入口。需要保留可读取的历史文件和可用的对应 CLI。

[来源与最近轮次](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session-external-list.png) · [完整详情与续接入口](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-session-external.png)

示例 Claude 原生记录，经真实扫描与读取；截图未执行续接。

</details>

## 分支独立推进，成果就地查看

<table width="100%">
<tr>
<td width="50%" valign="top">
<h3>Worktree · 多条工作线</h3>
<p>在主分支跑服务，在独立 worktree 开发。查看合并预览，再回到主线，服务持续运行。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-worktree.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-worktree.gif" alt="主分支服务运行、新建任务盘、查看分支合并预览并切回主终端" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>产物 · 结果就在旁边</h3>
<p>从 Island 提醒打开产物，操作 HTML、切换文件标签，内容变化后重新加载。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-product.gif"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-product.gif" alt="本地测试生成报告，Island 提醒、HTML 交互、JSON 标签与重新加载更新结果" width="100%" /></a>
</td>
</tr>
</table>

## 工具与集成

<table width="100%">
<tr>
<td width="50%" valign="top">
<h3>文件与代码</h3>
<p>文件树跟随 worktree，搜索文件、查看变更，打开代码与终端对照。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-filetree.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-filetree.png" alt="深色工作台：搜索文件、查看 Git 变更标记，对照搜索代码与 Pi 终端草稿" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>内置浏览器</h3>
<p>本地预览、文档与多个网页标签留在工具区，和项目工作并排查看。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-browser.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-browser.png" alt="内置浏览器：地址栏、两个网页标签与本地任务看板的搜索结果" width="100%" /></a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>Markdown</h3>
<p>编辑、分栏与预览，随手记录；文稿归属由你选择，切项目保留工具布局。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-markdown.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-markdown.png" alt="Markdown 深色分栏：Atlas 文稿归属、发布检查清单源码与预览" width="100%" /></a>
</td>
<td width="50%" valign="top">
<h3>CPA 服务集成</h3>
<p>打开 CLIProxyAPI 管理页，托管本地或连接已有实例；仅覆盖接入该实例的账号与调用。</p>
<a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa.png"><img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa.png" alt="JanusX 内的真实 CPA 管理页：本地实例已连接，尚未接入账号或调用" width="100%" /></a>
</td>
</tr>
</table>

<sub>工具截图使用本地示例项目；CPA 为未接入账号、无调用的真实本地实例。[查看 CPA 连接设置](https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/features/feature-cpa-settings.png)。</sub>

终端可使用 Shell、Janus-agentX、Claude Code、Codex、OpenCode、Pi 等工具；相应 CLI 的安装、登录与模型配置需另行完成。蓝图、Island 与运行配置中的模型能力也需要可用的模型配置。

<details>
<summary>关于演示素材</summary>

点击功能图可放大查看。10 条功能 GIF 均在新 UI 下重录，以默认主题为主，穿插经典黑，统一背景窄边装帧。终端草稿未发送；对话使用本地脚本模型，会话、用量与报告采用示例数据，真实工具与操作照常执行。静态图用于需要停下来阅读的界面，标为占位的图片仍待更新。

录制入口与使用方式见 [演示脚本说明](./scripts/showcase/README.md)。

</details>

---


## 安装与开始使用

前往 **[官方下载页](https://treex-xx.github.io/JanusX/)**，选择 Windows 10 / 11 的 x64 安装包。

| 版本 | 适合场景 | 使用方式 |
| --- | --- | --- |
| 安装版 `*-x64-setup.exe` | 在电脑上日常使用 | 运行安装向导，选择安装目录，完成后启动 JanusX |
| 便携版 `*-x64-portable.exe` | 希望免安装运行 | 下载后直接运行 `.exe` |

<details>
<summary>便携版的数据位置</summary>

免安装版的数据固定保存在当前用户的 `%APPDATA%\JanusX-Portable`，与安装版、开发版隔离；不提供随身模式，也不会在 exe 同目录新建 `data`。复制 exe 到其他电脑不会携带个人数据。

</details>

目前公开下载面向 Windows；macOS 与 Linux 的构建命令见下方打包说明，公开安装包以 Releases 实际附件为准。普通用户无需安装 Node.js 或克隆源码。

**三步开始**

1. 添加本地项目作为工作区。
2. 打开 Shell 或已配置的 AI CLI，开始工作。
3. 按需要分屏，打开文件、浏览器或蓝图作对照。

---

## 从源码开发

首次开发请按 **[本地开发指南](./docs/development.md)** 准备环境：Node 版本以 `.node-version` 为准，`JanusX`、`janus-agentX` 和验证使用的 `WorkFlowX` 放在同级目录，并按 CI 固定 revision 和依赖顺序构建。仅克隆 JanusX 无法完成依赖准备。

贡献者从上游 `dev` 创建功能分支，向 `dev` 提交 PR；完整步骤见 **[贡献指南](./CONTRIBUTING.md)**。

### 验证

```bash
npm run verify
```

统一检查包含主题、工作区类型检查和测试、未使用符号检查、生产构建、包边界与打包排除清单检查、国际化和 Note 检查、lint，以及 Windows 上的真实 Electron 桌面冒烟。环境准备及单项检查说明见[本地开发指南](./docs/development.md)。

也可以单独运行端到端检查：

```bash
npm run test:e2e:desktop
npm run test:e2e:island
```

### 打包

```bash
npm run package:win
npm run package:mac
npm run package:linux
```

打包产物位于 `release/<version>/`。平台打包需具备对应系统及构建环境。

Windows 迭代验证可运行 `npm run package:win:portable`，只生成 portable，在该打包子进程中使用压缩级别 1，仍执行包边界、依赖排除、体积预算和运行时检查。需要独立输出时可追加 `-- --release-dir artifacts/portable-check`。版本 PR、tag、正式发布及失败恢复见[维护者指南](./docs/maintainers.md)。

打包前须先在同级 `janus-agentX` 仓构建 `dist`。`prepackage` 使用 npm 的发布文件清单核对六个本地包，刷新变动文件和依赖声明，并拦截缺失的 sibling 或构建入口；它不代替 sibling 的源码编译。

架构与模块导航见 [Wiki](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/README.md)，优化状态与路线图见 [架构优化计划](https://github.com/TreeX-xx/JanusX/blob/v0.9.3/wiki/06-architecture-optimization-plan.md)。贡献约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 创新实验功能（开发中）

以下方向仍在开发，功能与交互会持续调整：

- **[Janus-agentX CLI](https://github.com/TreeX-xx/janus-agentX)**：探索终端内的 Agent 对话、工具调用与脚本集成。
- **圆桌**：探索多角色讨论，辅助方案比较、需求澄清与设计推敲。
- **远程**：探索通过 Web 跨设备查看终端、发送输入与管理运行状态。
- **团队**：探索围绕蓝图的项目共享与协同维护。
- **多智能体监控**：探索多智能体运行状态的集中观测、过程跟踪与结果汇总。
- **多智能体编排**：探索多智能体任务的编排调度与协同执行。

---

## 关于

JanusX 是一个真实投入社区使用的开源实验项目，目标是让 AI 辅助开发有一个顺手的桌面落点：项目、终端、AI CLI 与常用工具同处一室，稳定的基础体验在前，激进的协作实验在后。

欢迎讨论、建议与贡献。Fork 本仓库提交 Pull Request，或在 Issues 中分享你的使用场景与问题，贡献约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

如果对你有帮助，欢迎 Star。

**友情链接**：[Linux.Do](https://linux.do/) —— 为技术爱好者和专业人士提供高质量讨论与资源分享的社区。

---

## 联系与交流

- **邮箱**：[740288105@qq.com](mailto:740288105@qq.com)
- **QQ 交流群**：1125733779（JanusX 交流群一），扫描下方二维码加入。进群反馈问题、交流 Agent 开发、讨论 JanusX 功能，以及得到第一手的更新内容与想法。

<p align="center">
  <a href="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png">
    <img src="https://raw.githubusercontent.com/TreeX-xx/JanusX/v0.9.3/wiki/assets/readme/qq-group-1.png" alt="JanusX QQ 交流群一进群二维码，群号 1125733779" width="300" />
  </a>
</p>

---

## 支持

JanusX 免费开源（MIT），由独立开发者长期维护。

---

<div align="center">

[MIT License](./LICENSE) · 自由使用 / 修改 / 再分发 · Made by [@TreeX-X](https://github.com/TreeX-X)

</div>

## Star 历史

<a href="https://www.star-history.com/#TreeX-xx/JanusX&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=TreeX-xx/JanusX&type=date&theme=dark&legend=top-left" />
  </picture>
</a>
