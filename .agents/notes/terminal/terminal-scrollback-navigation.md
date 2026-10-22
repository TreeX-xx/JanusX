---
{
  "schema": "harness-note/2",
  "id": "e73d58a8-5464-4351-ab2f-f609a952d43f",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-22",
  "updated": "2026-10-22T10:52:13.448Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bdd26e4e-8207-4c1f-8ea3-21f450ee7570",
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/CLITerminal.tsx","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/lib/terminal-tui-wheel.ts","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/TurnChangeIsland.tsx","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/components/TerminalScrollControls.tsx","role":"implementation"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/renderer/src/lib/terminal-navigation.ts","role":"implementation"}
  ]
}
---

# 终端原生滚动与 island 快速翻屏

## Expected behavior

JanusX 保留各 CLI 的原生终端渲染方式，Codex/Claude 可继续使用原生全屏 TUI 与底部固定输入区。普通滚轮直接可用，现有文件 island 上方独立放置向上、向下两个快速翻屏按钮，点击一次翻屏，按住连续滚动。用户已修订范围：移除此前的滚动历史／全屏模式选择，以及 JanusX 会话阅读、搜索和放大面板。当前按钮表示快速滚动，精确跳转上一条／下一条提交暂缓，不能将二者混称。

## 调查结果

JanusX 使用 node-pty/ConPTY 与 xterm。调查基线的启动管理器继承进程环境并合并终端 env，当时 Codex/Claude 预设没有强制切换滚动模式。前端保留 5000 行普通缓冲历史；`globals.css` 对备用屏幕显式设置滚动条透明和不可命中。备用屏幕本身没有正常的宿主历史范围，所以移除隐藏规则不能恢复 TUI 内部历史。main 的 100 万字符 ANSI 重放缓冲是原始流，不能当作完整会话正文或稳定的历史行索引。

本机隔离配置、虚构 API key、不可用的本地 API 地址、node-pty 与真实 Chromium xterm 对照结果如下。Claude 恢复的是自建 30 轮合成 transcript，没有提交模型请求或读取真实会话；正常启动对照为 100 列 × 30 行，再缩到 45 列 × 18 行。

| 引擎及条件 | 观测结果 | 能说明的范围 |
|---|---|---|
| Claude Code 2.1.308，全屏，`CLAUDE_CODE_NO_FLICKER=1` | 备用屏幕、mouse tracking any、baseY=0；PageUp 改变可见历史，Shift+PageUp 不改变 | 历史归 TUI 管理，不能直接用 xterm 拖动定位 |
| 同版本 Claude，经典，`CLAUDE_CODE_NO_FLICKER=0` | 普通缓冲、mouse tracking none；同一组合成正文产生 baseY=250，缩窄后 baseY=623 | 可以建立真实宿主滚动范围；动态输出、输入区固定、长会话闪烁仍待验收 |
| Codex CLI 0.163.0，默认 | 备用屏幕、mouse tracking any、baseY=0 | 在隔离启动的 Windows sandbox 选择界面确认模式，未进入模型轮次 |
| 同版本 Codex，`--no-alt-screen` | 普通缓冲、mouse tracking none；缩窄后 baseY=16 | 启动选项确实改变宿主缓冲；尚未验证长会话完整滚动与重排 |

官方资料也明确这些模式的区别：[OpenAI CLI reference](https://developers.openai.com/codex/cli/reference/) 说明 `--no-alt-screen`；本机 `codex --help` 明确其保留 scrollback。[Claude fullscreen](https://code.claude.com/docs/en/fullscreen) 说明 `CLAUDE_CODE_NO_FLICKER=0` / `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` 使用经典模式，普通 PageUp/PageDown 在全屏内滚半屏，Ctrl+Home/Ctrl+End 跳到开头/最新。[terminal configuration](https://code.claude.com/docs/en/terminal-config) 提醒经典渲染可能闪烁或发生滚动位置跳动。采用模式前需确认当前版本能力，不全局改写 CLI 用户配置。

调查基线的滚轮转换对鼠标跟踪 TUI 使用对数压缩并限制最多九次报告。在固定 16px 行高下，单次 120px / 1200px 输入分别换算为三次/七次报告；实际报告数还受真实行高和累积余量影响。`scrollSensitivity=1.15` 与 `fastScrollSensitivity=5` 属于宿主滚动路径，不会自动加速这条 TUI 报告路径。

独立 Chromium 探针加载生产 `terminal-tui-wheel.ts` 与 `globals.css` 后确认：普通缓冲上滚有效，Alt+滚轮加速；Windows Shift+滚轮不纵滚。备用屏幕普通 PageUp 发出 `ESC[5~`，Shift+PageUp 被 xterm 消费且无 PTY 输入；Alt+滚轮只改变报告的修饰位，未增加报告数；Shift+滚轮没有报告。因此先前提出统一使用 Shift+滚轮加速、Shift+PageUp 翻 TUI 的建议不成立，不能直接写成通用快捷键。

另有环境边界：当前调查 shell 带 `TERM=dumb`，原样继承时 Codex 先停在终端能力确认，不能把这轮结果算作渲染验证。显式传 `TERM=xterm-256color` 后得到表中结果。JanusX 的 `name: 'xterm-256color'` 不代表 Windows 子进程环境已被覆盖；现已在管理器明确声明子进程能力 env。该现象不证明用户运行中的桌面应用也带 `TERM=dumb`。

外部 PowerShell 窗口的宿主种类、CLI 实际渲染模式及用户 profile 尚未现场对照，不能断言它与 JanusX 保留了同一份历史。已证实的是 JanusX 内部模式差异和输入路径，不是用户外部宿主的唯一根因。

## 当前实现

启动不再注入 Codex 的 `--no-alt-screen` 或 Claude 的经典／全屏切换环境变量，不修改 CLI 用户配置。管理器声明子进程能力 `TERM=xterm-256color`、`TERM_PROGRAM=JanusX`，保留用户其他环境。模式选择、会话正文 IPC 和阅读面板均已移除。已有进程保持当前模式和草稿，恢复原生启动方式作用于之后新建的进程。

`TerminalScrollControls` 在文件 island 上方提供两个 32px 宽胶囊按钮。主指针按下立即翻屏，320ms 后开始每 120ms 重复，松开、pointercancel、丢失捕获、窗口失焦、页面隐藏、切换 pane／标签／工作区或卸载时停止；键盘激活仅翻一次。点击恢复同一 xterm 焦点。普通缓冲通过既有滚动意图控制器调用 `scrollPages`，上滚后保持阅读位置，新输出不拉回底部；顶部／底部根据真实缓冲边界禁用对应按钮。终端未就绪时两个按钮禁用。

全屏备用缓冲不具有宿主历史范围：开启鼠标协议时，在当前 xterm 屏幕中心发送半屏距离的原生 wheel，由已有适配转换为 CLI 鼠标报告；屏幕坐标与行数每次读取，适应分屏缩放。没有鼠标协议时发送原生 PageUp／PageDown。备用缓冲中两方向保持可用，边界由 CLI 决定；不根据 baseY=0 推断没有历史。终端仍决定如何响应，不能保证每个 CLI 都实现历史滚动。

滚轮按真实行高线性换算，每事件最多 48 次报告；Alt 加速 5 倍，总上限 120 次，小幅触控板保留余量。Alt 仅作为宿主手势，不附带到 CLI 鼠标修饰位，Ctrl／Meta／Shift 保留原路径。备用缓冲的 Shift+PageUp／PageDown 在 keydown 转发普通翻页键，避免 xterm 吞掉；普通缓冲仍用 xterm 快捷键。普通缓冲保留真实滚动条；备用缓冲不伪造比例或可拖动范围。

布局及文件面板由 [turn island](./terminal-right-island-turn-history.md) 负责。滚动组和文件岛间隔 8px，全屏 TUI 与无历史终端贴右缘，只有普通缓冲存在历史时才向内避让 22px，保留可拖动轨道。避让依据缓冲事实，不随滚动条的 hover／淡出状态跳动。贴边时仅左侧圆角，避让时使用完整圆角和边框；文件面板展开时滚动组仍独立可操作。收起按钮改为向右箭头，与面板从左向右缩回的动作一致；点击范围 28×28px，点击后恢复原终端焦点。宽度与总高度受当前 pane 约束，窄 pane 可手动打开文件面板；不会修改 pane 树、PTY 尺寸或重启终端。

## 取舍与后续

按缓冲和鼠标能力适配，避免为每个 CLI 维护脆弱的启动模式开关及提示符识别。代价是全屏滚动边界和实际步长由 CLI 决定，JanusX 无法提供可靠比例轨道。精确上一条／下一条提交需要稳定的各 CLI 能力接口；出现可验证的公共协议或适配需求时再设计，不用普通上／下方向键猜测，避免影响输入历史或草稿。

### 上一条／下一条提问能力核查

用户最初认可探索点击按能力跳到上一条／下一条提问、按住继续快速滚动，不支持的 CLI 保留翻页。完成以下核查后，用户明确选择继续保持当前翻页设计与长按持续操作，本阶段不接入提问跳转适配。保留原生全屏、草稿与多分屏适配，不重新引入 JanusX 会话阅读面板。

2026-10-22 使用本机 Claude Code 2.1.308、Codex CLI 0.163.0、自建 30 轮合成会话和独立 home，在真实 node-pty/ConPTY + Chromium xterm 中核查。配置不使用真实凭据，模型端点指向不可用的本地地址；没有提交模型提问或操作现有用户终端。正常尺寸为 100×30，Codex 快捷键面板另外放大到 120×50，随后两者均缩到 45×18。

| 引擎 | 原生能力和实测 | 对拟议按钮的限制 |
|---|---|---|
| Claude Code | `Ctrl+O` 进入原生 transcript 后，`{` / `}` 跳到上一条／下一条提问；宽屏顶部提问按 28→27→28 变化，窄屏按 30→29→30 变化 | transcript 隐藏输入框，退出保留草稿并回到聊天底部；跳转位置不能随退出带回聊天视图，所以不能用“进入→跳转→立即退出”维持固定输入区 |
| Codex CLI | 官方交互说明和本机 `/keymap` 的 153 个可配置动作中未找到对应的提问跳转；原生 pager 列出行／页滚动、首尾定位、搜索。普通全屏翻页在 45×18 下保留底部输入区和草稿 | 当前没有验证到可直接绑定的精确跳转动作，不能将翻页、文本搜索或输入历史恢复宣称为提问跳转；结论限于该版本的已公开及已检查能力 |

Claude 的普通聊天 PageUp 同样保留固定输入区和草稿，但没有验证到同视图的提问跳转。`{` / `}` 仅在 transcript 上下文有上述语义，不能直接向未知状态的 composer 注入。Codex 的输入历史搜索、恢复旧提问或双 Esc 编辑／分叉也不是只读浏览的替代方案。取得会话文件中的消息顺序，不等于取得 CLI 自己管理的历史滚动坐标；扫描 xterm 当前屏、猜测提示符或反复滚动寻文不构成可靠通用接口。

因此，“两个 CLI 均精确跳提问且输入框始终可见”的完整目标目前没有可靠的原生接法。Claude 单独适配其原生浏览视图需要接受输入框暂时隐藏，并可靠识别浏览／编辑上下文及自定义快捷键，本阶段不实施。用户确认优先保留固定输入区与跨 CLI 一致性，现有两个按钮保持点击翻页、长按持续滚动，不能静默改成一套未经支持的按键宏。

官方依据：[Claude fullscreen](https://code.claude.com/docs/en/fullscreen)、[Claude keybindings](https://code.claude.com/docs/en/keybindings)、OpenAI Docs 的 [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-interactive-shortcuts)。调查保存了官方原文、本机帮助及 keymap 截图；没有发现能力不等于证明不存在任何未公开实现。

## Acceptance criteria

用户于 2026-10-22 修订 AC-1～AC-6 的范围，以下是当前验收：

- [x] AC-1: 保留 CLI 原生启动模式，移除模式选择与 JanusX 会话阅读面板；普通滚轮无需先操作 island。
- [x] AC-2: island 上方两个按钮支持点击翻屏和按住连续滚动；松开、取消、失焦及终端切换停止，键盘激活一次。
- [x] AC-3: 普通缓冲按真实边界滚动，全屏优先鼠标协议、无鼠标时翻页；不伪造比例轨道，不宣称精确提交跳转。
- [x] AC-4: 单 pane、左右不足 240px 宽与上下小高度分屏均可操作；面板展开不改变 PTY 几何，状态和输入按 terminalId 隔离。
- [x] AC-5: 按钮保留同一终端实例及输入焦点，普通缓冲新输出保持阅读位置；文件 latest/history 功能继续可用。
- [ ] AC-6: 打包 Electron 内真实 Codex／Claude 及其他 CLI 的持续长输出、原生固定输入区、草稿、复制、缩放和滚动边界通过现场验收；已有会话不静默重启。

## Verification

调查证据位于忽略目录 `artifacts/terminal-scroll-investigation/`：`probe.cjs`、`results.json`、各模式 `.ansi` 为真实 CLI／PTY／xterm 对照；`xterm-controls.cjs` 和 `xterm-controls.json` 为加载生产滚轮代码和样式的浏览器探针。继承 TERM 的受阻结果单独保存为 `inherited-term-results.json`。首次 seeded Claude 探针后本机二进制版本发生变化，下一次启动报 216，该未完成轮不计入矩阵；后续完整四模式结果记录 2.1.308／0.163.0，并在子进程设 `DISABLE_AUTOUPDATER=1`。这些调查没有提交模型请求。

提问跳转核查证据位于其 `prompt-navigation/` 子目录：`native-probe.cjs`、两份 `*-prompt-results.json`、ANSI 与截图记录真实 CLI 状态；`node artifacts/terminal-scroll-investigation/prompt-navigation/verify-observations.cjs` 的八组观测断言通过，结果在 `verified-observations.json`。已查看 Claude 窄屏跳转／返回草稿及 Codex 窄屏翻页截图。这些是隔离合成历史的输入导航证据，未覆盖模型持续输出、所有用户快捷键定制或打包 Electron 现场验收，不改变 AC-6 状态。本轮未修改应用实现。

用户确认保持现有设计后，以 `JANUS_E2E_PORT=41743`、`NO_PROXY=127.0.0.1,localhost` 执行 `npx playwright test tests/e2e/terminal-navigation.spec.ts --project=island --workers=1 --output=artifacts/terminal-scroll-investigation/hold-confirmed`，13 项全部通过。现有长按持续滚动、松开／取消停止、失焦及标签／分屏／工作区切换／卸载停止、窄／短分屏与焦点行为均通过浏览器回归，无需新增生产代码。

当前实施的 Vitest 八文件共 45 项通过，覆盖导航注册与释放、缓冲边界、全屏鼠标／翻页、滚轮加速及上限、滚动意图、轨道同步、子进程能力环境、启动和输出调度。命令：`npx vitest run tests/unit/terminal-navigation.test.ts tests/unit/terminal-tui-wheel.test.ts tests/unit/terminal-scroll-intent.test.ts tests/unit/terminal-scrollbar-sync.test.ts tests/unit/terminal-ipc-contract.test.ts tests/unit/terminal-launch.test.ts tests/unit/terminal-output-scheduler.test.ts tests/unit/terminal-officecli-path.test.ts --reporter=dot`。

浏览器使用生产 React／xterm 和模拟 IPC，环境 `JANUS_E2E_PORT=41739`、`NO_PROXY=127.0.0.1,localhost`。当前导航 13 项与文件 island 回归 10 项由 `npx playwright test tests/e2e/terminal-navigation.spec.ts tests/e2e/turn-changes.spec.ts --project=island --workers=1 --output=artifacts/terminal-scroll-investigation/edge-verified` 全部通过。覆盖点击／长按／取消、失焦和切换停止、真实鼠标报告、无鼠标翻页、焦点与输入流、普通缓冲位置保持、左右不足 240px 宽和上下小高度分屏；新增双主题全屏贴右缘、latest/history 按钮收起恢复焦点及回普通缓冲后实际拖动轨道。布局操作前后创建／关闭／fit／resize／replay 与终端行列数保持一致。已检查纸色／深色、窄／短分屏截图。此前 `native-controls` 中另 4 项标签性能测试通过，本轮样式修复未重复该套件。输入草稿证据来自同一保留的模拟 PTY 输入流，并非真实 CLI 草稿截图。

`npm run typecheck:strict-unused`、`npm run i18n:check`、六个变更实现文件的 scoped ESLint、`npx electron-vite build --outDir artifacts/terminal-scroll-investigation/build-check` 和 `git diff --check` 均通过。`npm run check:notes` 检查 303 个 harness Notes，0 错误，17 条既有跨仓库链接诊断；测试文件由 ESLint 既有 ignore 排除，未计为 lint 通过。已检查窄分屏纸色和小高度深色截图。构建输出在隔离 artifacts，不替换运行中的 portable。未执行真实模型持续输出、外部 PowerShell 宿主对照或打包桌面现场验收，AC-6 保持未验收。
