# Codex 双显示模式协议探针

验证一个真实 Codex app-server 能否同时服务原生终端 TUI 和结构化对话客户端。这是 P0 独立探针；后续产品已接入同一 pane「终端 / 对话」实验入口，采用原生连接转发方式，实际产品测试见文末。

## 运行

在 Windows、Node.js 和仓库依赖已安装的环境执行：

```powershell
node scripts/codex-dual-mode/probe.mjs
```

默认查找 npm 全局安装的 Windows x64 `codex.exe`。其它安装位置通过 `JANUSX_TEST_CODEX_BIN` 指定可执行文件绝对路径。已验证版本为 **0.166.0**；没有声明其它版本兼容。

探针启动真实 app-server、ConPTY 原生 TUI 和本地 Responses API 模拟服务。独立临时目录保存配置、工作区和会话；子进程使用环境白名单，不继承用户凭证与 Codex 配置。`gpt-5.4` 只是模拟服务使用的模型标识，不调用该模型。探针自动批准自己的固定命令与补丁，命令只输出标记，补丁只在临时工作区创建 `result.html`。

输出 `status: passed` 且退出码为 0 表示断言通过。每次运行在 `%TEMP%/janusx-codex-dual-*` 保存 `report.json`、协议事件、模型请求、TUI 请求、终端原始输出和后端日志；结束时回收本次创建的进程与连接。临时证据保留供检查，可在确认探针已退出后删除对应目录。

## 覆盖范围

- 原生 `update_plan` 调用产生 `turn/plan/updated`，验证主 thread/turn 归属及 pending/inProgress/completed。0.166.0 隔离默认配置不暴露该工具；探针显式设置 `tools.update_plan.enabled=true`，产品只在受管后端进程参数启用。
- 真实 TUI 发送 → 结构化消息；协议发送 → 真实 TUI 显示；再由 TUI 继续。
- 前文保留，七条测试用户输入在同一个主 thread 的历史中各出现一次。
- 流式 delta；流式期间断开结构化客户端、重连 resume 同一 thread，再 interrupt 当前轮。
- 命令审批、请求解决事件、成功退出码和实际输出。
- 补丁审批、`fileChange` 路径和 diff、真实 HTML 文件落盘。
- 原 app-server/TUI 进程保持存活；其它已加载线程必须是临时 `thread_title` 线程。

本地模型缺少正式模型元数据时未暴露独立 `apply_patch` 工具。探针通过 Codex 支持的 `exec_command` 中 `apply_patch` 形式触发原生补丁处理，断言得到的是 `fileChange` 及其审批。它不是由测试脚本写文件后伪造通知。Codex 会警告临时 CODEX_HOME 下无法创建 PATH helper aliases；本次验证的命令与补丁路径仍通过。

## 已知边界

- 这是本地确定性协议测试，未验证真实账户、供应商、JanusX Hook、可视切换、焦点/草稿、审批竞态、崩溃恢复或产物预览 UI。
- `thread/start` 后尚无持久历史的空线程不能直接供原生 TUI resume。探针先完成 BOOTSTRAP 轮；产品已使用原生连接转发与原生创建/绑定流程，不向用户模型自动发送探针消息。
- 原生 TUI 会创建临时标题线程。会话归属必须按主 thread ID 过滤，不能把全部事件混成一条对话，也不能用全局线程数量判断用户会话是否重复。
- 重连后可取消运行已验证；断线期间所有丢失增量的完整重放未验证。产品需要快照与增量去重设计。
- 官方将 app-server WebSocket 方式标为实验性，尚不支持生产负载。本测试不意味着可直接发布该运行方式。
- JanusX 普通 `--no-daemon` Hook 隔离路径不能直接叠加 `--remote`。实验入口已由 JanusX 管理独立后端与 Hook 环境，保留普通路径；真实双会话 Hook 归属和生命周期证据见产品回归。

设计与后续接入边界见 [双显示模式 Note](../../.agents/notes/workbench/terminal-dialog-dual-mode.md)。官方参考：[app-server](https://developers.openai.com/codex/app-server/)、[CLI 参数](https://developers.openai.com/codex/cli/reference/)。

## 产品接入回归

在应用中新建选择 **Codex 双模式（实验）**，完成原生信任审阅后使用同一区域上方的终端/对话按钮。原普通 Codex 入口保留。版本门控 0.166.x，实测 Windows 0.166.0；不迁移旧进程、不接入远程工作区。关闭终端标签会结束此会话，切换显示不会。

`tests/unit/codex-conversation.test.ts` 覆盖投影与控制边界。设置 `JANUSX_TEST_CODEX_BIN` 后运行 `npx vitest run tests/unit/codex-conversation-cli.test.ts --project=integration`，使用真实受管 runtime、TUI、正式 Hook、两条并存会话与本地模拟模型；未设置时跳过。`npx playwright test tests/e2e/codex-conversation.spec.ts --project=island --workers=1` 使用真实 UI 和 IPC 替身。构建后用 `npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-codex-conversation.spec.ts` 验证 Electron 全链路，同样要求指定 CLI；这些测试不会使用真实账户或付费模型。
