---
{
  "schema": "harness-note/2",
  "id": "bb19f25e-9321-44e6-9184-e3bd643f92a6",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-11-06",
  "updated": "2026-11-07T12:27:09Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/95ec5f71-33e3-4f71-aa05-d3e725c33b10",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f818911a-9077-46c0-9117-8e1fc1298eb3"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1a7fc604-93b2-4f99-91eb-c0d9f57616ba"
    }
  ],
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "tests/e2e/desktop-superagent.spec.ts",
      "role": "test"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "tests/e2e/desktop-superagent-live.spec.ts",
      "role": "test"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "tests/unit/superagent-routing.test.ts",
      "role": "test"
    }
  ]
}
---

# SuperAgent 一期验收证据与限制

## Scope

P7、P8 于 2026-11-06 按用户 xdo 授权一并实施，Main Agent 直接执行。界面复用现有 JanusChat、全局工具树、项目终端树和通知阅读器；右侧 Worker 独立收起与调宽，窄窗仍保留终端使用空间。原离线 HTML 保留为历史探索；用户后续要求的当前界面演示另行交付，使用明确标识的模拟数据。产品实现与布局边界归[界面决策](superagent-interface.md)，固定编号归[需求](requirements/janus-superagent.md)。

## Evidence

P7 界面已实现，P8 完成集成修复并进行联合验收；以下区分确定性通路与真实模型结果，不以历史阶段通过代替本次检查。

- 全量 `npm run verify` 已完成前半段：主题、插件平台、分发工具、独立 Blueprint 构建及真实桌面运行、类型检查、共享 LLM 构建通过。单元／集成／浏览器首轮为 524 个文件、4618 项通过，5 项失败，49 项跳过；失败使总命令在此停止，不能称整条 verify 通过。
- 4 项失败来自旧文件树测试夹具缺少 React `useId` 和 Escape 事件 `stopPropagation`，修正夹具后相关 13 项通过。1 项原生测试首次未确认 Windows 进程树停止；产品保留占用而未误报停止，增加退出码与有界终止诊断，独立复测 1 项通过，验证后台子进程停止且不再延迟写入。首次异常原因尚未确定，不能抹去首轮失败记录。
- 最新 Electron／真实 Codex 0.166.0／localhost 模型场景通过：长原文读取、实际 Worker 写文件与 MCP 汇报、原生批准和回答、运行中普通项目工具、历史不执行、同工作继续、停止全部、退出重开后显式继续。界面同时验证折叠／调宽、窄窗内切换、终端实际输入、草稿保留、通知阅读与明确定位。截图在 `artifacts/superagent-p7/desktop-chat.png`、`desktop-restored.png`；协议模型夹具不证明真实模型语义准确率。
- 其余已独立通过的检查包括 LLM core 7 文件／80 项、严格未使用检查、应用构建、包边界、15 个翻译命名空间、Notes 336 篇／0 错误，以及 lint 0 错误／51 个已有警告。Notes 的 17 个外部链接诊断原已存在。
- 最新 Worker 组件 2 项通过，覆盖 5 项工作、容量调至 4、13 项分页中的旧待决策工作、请求原身份、工作区过期事件、面板卸载不停止、回收保留历史。最近动作只显示 Worker 回复／工具活动，不显示宿主派发文本。

Island／全局分屏回归首轮 45 项通过、2 项跳过、2 项失败，两个失败单独复测均通过。完整桌面首轮 60 项通过、4 项跳过、5 项失败；Browser／Markdown 三项单独复测通过，另两项旧测试分别仍期望已被 `ISLAND_CHAT_ONLY` 隐藏的插件页、以及旧的 12 px Memo 间距。测试已对齐既有开关、通知阅读器明确选择记录的行为，以及工具栏所需的 56 px 间距，产品行为未为测试回退；两项最终复测均通过。最新构建的 SuperAgent 两个桌面场景再次通过，覆盖初始 Island 启动、亮色主题及完整原生闭环。日志分别为 `superagent-p8-verify.log`、`superagent-p8-desktop-regression.log`、`superagent-p8-final-desktop.log`、`superagent-p8-legacy-recheck.log` 与 `superagent-p8-plugin-final.log`，均在 `artifacts/`；分项复测通过不改写首轮失败记录，也不声称重跑过整条 verify。

本机 npm 11.12.1 读取安装树时，工作区 junction 目标的大小写与 npm 的规范路径不同，导致 `npm ls` 抛出 `edgesOut` 空值错误、排除规则检查误报 507 项差异。修正本仓 4 个 junction 的路径大小写后，原 `npm run exclusions:check` 通过，415 条规则一致；没有改动打包排除清单或依赖版本。

用户指定的真实 `gemini-3.8-flash` 多轮场景最终通过：Janus 安排原生 Codex 创建 `greet.cjs` 与 `greet.test.cjs`，执行 Node 断言并经 MCP 汇报；随后只查询历史，执行数量不变；补充“无参数默认 world”后继续同一工作并通过两项断言。最终为 1 项工作、2 轮执行、2 次 ready，独立 Node 检查通过。结果为 `artifacts/superagent-p8/live-result.json`，截图为 `live-desktop.png`。两份用户原配置的内容一致性检查通过，临时凭据及原生配置副本已清理。

早期尝试曾遇到 Gemini 4 连接关闭、MiMo 无效密钥、Codex 原生 `workspace routing discovery timed out`；按用户选择改用 Gemini 3.8 后原生连接复测恢复。真实场景还修正了测试脚本遗漏 MCP `read_resource` 权限回答、把 Node 环境警告误当失败、模型历史查询的 60 秒等待过短等问题。最终保留 180 秒回答等待并实际检查无错误卡片与历史回答内容，没有绕过权限或把请求成功当作开发完成。

需求中已逐项勾选有充分机制／产品证据的条款。自然语言歧义、旧功能跨分支修复及多意图等尚无完整真实场景的条款继续保留未勾选；其实现和局部机制测试不能冒充完整语义验收。AC-7 的监督增强和 AC-14／15／29 仍遵守原分期。

| 固定 AC | 对应检查与证据位置 |
| --- | --- |
| 1–4、10、17、22、31、32 | `superagent-routing` 的同一 Janus 工具、当前输入／已读工作卡约束、歧义／历史只读、重复与过期决定；桌面正常对话、运行中问答与继续 |
| 5、23、39–44 | `superagent-context`、`context-environment`、`persistence`、`worker-mcp` 的预算、引用／版本／页范围、长原文、缺失反馈及未覆盖输入；真实 Codex MCP 分页 |
| 6、24、26–28 | Worker 组件 5 项工作／可扩展容量／分页待决策；桌面折叠、调宽、窄窗、终端输入、草稿、Island 阅读与定位 |
| 7、8、16、21、35、37、38 | `superagent-lifecycle`、`codex-managed-recovery`、`app-shutdown`、原生运行与桌面退出重开；30 分钟回收使用可控时钟 |
| 9、11、12、19、20、25 | `superagent-environments`、`scheduling`、`routing` 的 N=1／2／4、真实 Git 目录隔离、占用／身份复核、审批失效、合并／移除及保留分支 |
| 13、18、30、33、34、36 | `superagent-workers`、`worker-permissions`、`native`、`codex-managed-decisions` 和真实 Electron／Codex／MCP 检查 |
| 14、15、29 | 跨工作区完整语义验收、多引擎阶段，继续后置；不因基础隔离与通知来源已实现而勾选 |

2026-11-06 界面精简复核：SuperAgent 隐藏会话导航与手动工作区附件，Island 对话模式保留原控件。`npx playwright test tests/e2e/automation-chat-routing.spec.ts --project=island --workers=1` 6 项通过，覆盖 Island 原有附件行为，以及 SuperAgent 发送时固定工作区、异步创建工具会话期间切换项目、无当前项目不沿用旧附件。`island-interaction.spec.ts` 中以 `--grep 'switches conversations|session rail'` 选出的 2 项通过，确认 Island 会话切换和列表开合。

同轮 `npm run test:e2e:desktop -- tests/e2e/desktop-superagent.spec.ts --workers=1` 2 项通过，继续覆盖终端实际输入、Worker 开合／调宽、窄窗、草稿和重启恢复。浅色与深色截图已目视核对，位于 `artifacts/superagent-p7/desktop-light.png`、`desktop-chat.png`。严格类型检查、应用构建通过；定向 ESLint 0 错误、4 条既有警告。日志为 `artifacts/superagent-context-{routing,island,desktop,typecheck,build-final,lint}.log`。该轮使用受控模型夹具，没有重跑付费真实模型验收，也不扩展跨工作区完整语义验收结论。

2026-11-06 对话风格统一复核：Island 与 SuperAgent 共用原生对话风格，保留各自的会话／工作区入口差异。`npx playwright test tests/e2e/island-interaction.spec.ts tests/e2e/janus-chat-theme.spec.ts tests/e2e/chat-conversation-delete.spec.ts --project=island --workers=1` 首轮 48 项通过、2 项跳过；目视检查发现旧 Island 样式把底部控件排在输入文字上方，修正顺序与窄窗排列后，以 `--grep 'menus|model menu|shared|compact composer|session rail|typing|Chat input'` 重跑前两个文件，16 项通过。最终应用构建后，`npm run test:e2e:desktop -- tests/e2e/desktop-superagent.spec.ts --workers=1` 2 项通过，覆盖 Worker 开合／调宽、终端输入、窄窗草稿与重启恢复。

同轮严格类型检查、主题检查和应用构建通过，定向 ESLint 0 错误、4 条既有警告；日志位于 `artifacts/janus-conversation-{typecheck,theme,lint,build-final,browser,browser-final,desktop}.log`。人工目视核对 Island 的深色、浅色、Planche 和窄窗截图，以及真实 Electron 中 SuperAgent 深浅色截图，保存在 `artifacts/janus-conversation/`；520 px 视口中聊天区宽度与滚动宽度均为 388 px，无横向溢出。该轮桌面场景使用受控模型夹具，没有重跑付费真实模型验收。

2026-11-06 开合控件与入口命名复核：Worker 使用唯一的文字开关，与工具区总开关分组，移除面板标题中的重复按钮；首页及 Island 启动入口显示「Super Agent」。`npm run test:e2e:desktop -- tests/e2e/desktop-superagent.spec.ts --workers=1` 最终 2 项通过，覆盖两层开合互不影响、恢复 Worker 状态、终端输入、窄窗草稿与输入焦点，以及原有原生执行和重启恢复。首轮为 1 项通过、1 项失败，原因是新增断言错误要求窄窗返回对话后焦点留在开关；现有对话行为会自动聚焦输入框，断言对齐后最终通过，产品焦点逻辑未改。严格类型检查、定向 ESLint、主题、双语翻译检查及最终应用构建通过。日志为 `artifacts/superagent-controls-{typecheck,lint,theme,i18n,build-final,desktop,desktop-final}.log`；人工目视核对的深浅主题、展开／收起与窄窗截图位于 `artifacts/superagent-controls/`。本轮未重跑付费真实模型验收。

2026-11-06 选项样式与当前界面演示复核：模型、供应商、权限菜单及提问卡片统一为中性对话主题；Worker 数字输入样式不再影响问答控件。`island-interaction.spec.ts` 与 `janus-chat-theme.spec.ts` 以 `--grep 'menus|model menu|shared|compact composer'` 运行，13 项通过；主题检查及最终应用构建通过。浏览器夹具直接挂载生产 JanusChat，4 组检查通过，覆盖深色、浅色、Planche 的选项色值与截图、520 px 下的模型选择和问答提交，无横向溢出。结果与截图位于 `artifacts/superagent-options/`，日志为 `artifacts/superagent-options-{browser,theme,build-final,preview-check}.log`。本轮没有重跑完整 Electron 或付费真实模型验收。

单文件 `_design/superagent-current/SuperAgent.html` 的 8 组交互检查通过，覆盖五个 Worker 状态、容量与排队、回答后继续同一工作、两层开合、详情、菜单、草稿保留、窄窗终端回显与首页入口。页面没有脚本错误或外部 HTTP 请求；深浅色、问答、多 Worker、窄窗和极窄浏览器截图已目视核对，位于 `artifacts/superagent-current-demo/`。演示使用模拟执行和终端回显，不代替产品原生执行证据；极窄浏览器适配只便于查看演示，不构成桌面应用的移动端支持。

2026-11-06 滚动条与 Worker 状态边框复核：直接复用原生对话滚动条，边框颜色使用现有工作阶段和语义主题变量。聊天浏览器回归使用前述两个文件及 `--grep 'menus|model menu|shared|compact composer|session rail'`，14 项通过；`npx vitest run tests/unit/superagent-work-ui.test.ts` 2 项通过。浏览器视觉夹具挂载生产 JanusChat、原始侧栏／工作卡样式和模拟阶段，4 组检查通过：三主题下两种聊天宿主、侧栏与原生对话滚动条样式一致，八种阶段的边框色正确，消息／侧栏滚轮互不影响，滑块实际拖动成功。初次拖动检查因 Playwright 默认 `--hide-scrollbars` 隐藏滚动条而失败；移除此测试启动参数后复测通过，未为测试修改产品滚动行为。截图与结果位于 `artifacts/superagent-scroll/`。

当前 HTML 已重新嵌入共用滚动条与状态边框，`node _design/superagent-current/verify.mjs` 8 组交互复测通过，截图包含可见滚动条。严格未使用类型检查、主题检查和应用构建通过；定向 ESLint 0 错误、4 条既有警告。日志位于 `artifacts/superagent-scroll-{browser,worker,visual-final,demo-final,typecheck,theme,build,lint}.log`。本轮不重跑完整 Electron 或付费真实模型验收。

2026-11-06 Worker 列表呈现复核：按用户反馈将右侧独立卡片改为连续列表，去掉彩色外框与圆角，颜色保留在状态圆点和文字中。详情原地展开，停止／关闭常显，Codex 移入详情。生产 Worker 组件 2 项通过，HTML 的 8 组交互复测通过；280 px 侧栏、展开详情和长标题均无横向溢出。目视核对生产组件截图与 HTML 的深浅主题、窄窗截图，证据位于 `artifacts/superagent-p7/worker-chat.png`、`artifacts/superagent-current-demo/` 及 `artifacts/superagent-list/`。严格未使用类型检查、主题检查、定向 ESLint 和应用构建通过，日志为 `artifacts/superagent-list-{worker,demo,preview,typecheck,theme,lint,build}.log`。该轮未重跑完整 Electron 或真实模型验收。

2026-11-07 Worker 卡片恢复复核：按用户最新选择恢复紧凑独立卡片，采用中性边框、小圆角、底色与间距，保留状态圆点、文字操作和原地详情。变更限样式，HTML 从生产 CSS 重新生成；8 组演示交互通过，280 px 侧栏、展开详情与长标题无横向溢出，深浅主题截图已目视核对。主题检查和应用构建通过，日志为 `artifacts/superagent-cards-{demo,layout,theme,build}.log`；最新截图保存在 `artifacts/superagent-current-demo/` 与 `artifacts/superagent-list/`。该轮未新增测试，也未重跑完整 Electron 或真实模型验收。

2026-11-07 SuperAgent 用量面板精简复核：通过 JanusChat 呈现选项关闭该宿主的用量、上下文容量及刷新模型信息面板，保留模型选择。`janus-context.spec.ts` 中 `both chat entries send|catalog update recognizes` 两项最终通过，确认其他对话入口继续保留用量和目录刷新；长对话用例首轮超过默认 20 秒，将该次执行的 `--timeout` 调为 60000 后以 26.4 秒完成，没有修改产品逻辑。严格未使用类型检查、应用构建通过，定向 ESLint 0 错误、4 条既有警告；日志为 `artifacts/superagent-usage-{context,context-retry,typecheck,build,lint}.log`。HTML 已同步去掉用量行。

2026-11-07 终端启动界面开合复核：当前项目没有 pane 时，终端入口可以反复展开／隐藏启动界面，提示和展开状态同步变化。扩展现有 `desktop-superagent.spec.ts` 的 `Island starts` 桌面场景，覆盖显示、隐藏、恢复对话焦点及草稿、再次显示，以及 Worker 与外层工具区开合；首轮发现焦点停在按钮，补上收起后的输入框聚焦，最终真实 Electron 1 项通过。最终应用构建、严格未使用类型检查、翻译与主题检查通过，Workspace 定向 ESLint 无问题。日志为 `artifacts/superagent-terminal-toggle-{build-final,desktop-final,typecheck-final,lint-final,i18n,theme}.log`。

同轮 HTML 增加「未打开终端」场景，9 组交互检查通过，包含启动界面反复开合、草稿与焦点恢复，以及选择模拟 PowerShell 后继续显示终端。首次串联检查因上一场景留在终端区域而无法填写小屏对话，在进入下一场景前显式切回对话后通过；没有为该问题修改产品。截图 `artifacts/superagent-current-demo/terminal-launcher-light.png` 与真实桌面 `artifacts/superagent-controls/light-expanded.png` 已核对，演示记录为 `artifacts/superagent-terminal-toggle-demo-final.log`。该轮没有重跑原生 Worker 或付费真实模型验收。

## Reproduction

常规入口为 `npm run verify`。实际 Windows Codex 用环境变量 `JANUS_SUPERAGENT_CODEX_BINARY` 指向选定二进制；未提供时原生测试会明确跳过，不能当作通过。原生 MCP 集成需要当前构建的 `artifacts/build-check/main/worker-mcp.js`，桌面使用 `out/main/index.js`。

受控真实模型场景为 `desktop-superagent-live.spec.ts`，只有明确提供 `JANUS_SUPERAGENT_LIVE_CONFIG`、`JANUS_SUPERAGENT_LIVE_CODEX_HOME` 和上述二进制才运行；`JANUS_SUPERAGENT_LIVE_MODEL` 仅覆盖隔离副本里的 Janus 模型。用户指定使用 `gemini-3.8-flash`，Worker 沿用所选原生 Codex 账户。测试复制配置到隔离 profile 和 Codex home，保留本机连接所需代理，只向模型提供临时的 greet 小功能仓库。原配置不写回；结束清除测试的凭据及原生配置副本。只回答已授权的宿主 MCP 工具权限，任意模型问题不自动代选。

临时仓库／计划 worktree 的原生文件夹信任由测试在隔离 Codex 配置中预置，产品仍遵守已有原生信任检查；具体 Git 创建批准另由界面完成。这不是产品替用户修改全局信任。验收目标为真实开发、实际 Node 测试、只问历史不执行以及继续同一工作，不能据此推导一般语义归属准确率。

## Storage and compatibility

P8 的 `work_git` 仅提出计划，执行仍走环境操作的具体批准。调度账本在版本 1 上增加 `git-merge`／`git-remove` 和可选 `operationId`，新读取器兼容既有记录；旧二进制不认识新动作，因此产生新记录后不要用旧版本覆盖原 profile。升级前备份整个 `janusx/superagent` 目录，诊断时保留原始错误和记录，不能通过删目录或自动重放修复未知结果。

P4／P5 依赖相邻 `janus-agentX` 的委派执行提醒策略和共享资源引用保护；交付需保留这些共享源码。独立 Blueprint 构建锁随当前公共包重新生成并验证，版本号和外部下载源不改变。本轮没有发布、推送、提交或替换用户正在使用的桌面程序。

## Limitations

首版为本机 Windows Codex；不承诺其他平台、任意 CLI 版本或真实供应商服务永远可用。协议夹具证明确定性通路，真实模型检查单独记录；有限受控场景不代表多轮复杂需求的语义正确率。监督增强、跨工作区完整归属及多引擎继续按原分期处理。
