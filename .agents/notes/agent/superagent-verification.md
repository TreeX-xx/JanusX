---
{
  "schema": "harness-note/2",
  "id": "bb19f25e-9321-44e6-9184-e3bd643f92a6",
  "kind": "note",
  "lifecycle": "accepted",
  "created": "2026-11-06",
  "updated": "2026-11-14T07:08:33.497Z",
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

## 合入 dev 的检查与资料保留（2026-11-14）

合并前将 SuperAgent 工作区保存为49191fc8，将 dev 的导航、侧栏和本地设计清理保存为668f8cf7，原始补丁及文件哈希位于 artifacts/merge-superagent-20261114/before。合并保留双方记录与导航输入类型，未覆盖 dev 的其他改动。Main 执行集成复查，未委派独立评审。

检查发现并修复主题令牌缺口、Blueprint 独立构建将固定tgz误作源码目录的问题，并同步六个引擎归档及SDK的插件锁。构建边界测试补齐Vite资源导入；固定引擎的原生ESM启动测试使用Node内建模块同步替身；停止清理测试改用当前进程树服务边界；活动类型断言与输出契约一致。摘要失败测试明确强制多段摘要，验证第二段失败后不提交部分检查点、不丢原文。相关43项定向复跑通过。完整首轮单元范围为518个文件、4531项，其中4502项通过、22项跳过，7项失败已由上述复跑覆盖；后续检查及资料迁移结果见同目录回执。

design继续作为本地忽略目录：源工作区91个文件中78个新增、3个相同，10个冲突版本保存在 local-design-conflicts。安装包、历史引擎归档、截图与验证证据按清单迁移到 dev；已有同名文件不覆盖，不同内容单独归档。迁移清单、逐项SHA256与转移回执保存在同目录。此项不代表重新打包、安装或公开发布。

后续复验修复了协调器筛选隐藏提醒草案的实际回退：automation_reminder作为协调工具开放，仍只生成草案，保存／启用继续由用户确认。低高度窗口的启动页压缩留白，保留工具栏并填满实际工作区。快捷派发夹具补齐验收目标与完整模型消息；恢复计划补齐历史字段；会话卡按已创建的会话ID定位，Memo布局恢复实际几何读取。会话夹具的假CLI曾在--version后持续运行，产生12个残留测试进程并使Playwright工作进程收尾超时；修复版本探针及时退出并清理这些测试进程后，整份会话专项3项通过且正常退出。未通过延长生产超时或关闭退出核验规避问题。

验证采用完整首轮加受影响项复跑，未宣称一次npm run verify全部通过：集成首轮351项通过、5项失败、41项跳过，快捷路由5项修复复跑通过，蓝图冷语料读取单独1项通过；该冷读取首轮SERVICE_FAILED的原因未确认，保留两次日志。浏览器首轮138项通过、2项失败，启动／恢复5项复跑通过。提醒与自动化13项、公开归档2项和计划历史4项通过。桌面首轮75项中62项通过、9项跳过、4项失败；自动化2项、会话继续3项、Memo布局1项最终复跑通过，覆盖全部失败项，最终会话复跑没有收尾错误。LLM核心80项、最终严格类型、主题检查、生产构建、包边界、排除清单、i18n、Notes与lint通过；Notes保留17条外链诊断，lint保留51条既有警告。外部CLI及WSL／SSH等未配置场景按仓库条件跳过，没有调用真实云模型。

16665个本地文件共3968128062 bytes在转移时逐项SHA256匹配，另有91个设计文件校验通过；收据为local-preservation-verified.json。本轮回归按现有约定刷新228个截图／测试数据／构建输出，其中84个旧构建分块被重建替换；更新映射见local-preservation-after-tests.json，设计与归档交付文件保持校验。并行专项曾共用默认测试输出目录，导致首轮一份trace丢失；后续专项使用独立目录，原失败日志与复跑证据保留。最终合并及worktree移除结果记录在同目录removal.json；源分支保留用于回溯。

## Gemini 修复安装包覆盖（2026-11-14）

按用户要求重新构建并覆盖release/superagent/installer的六个交付文件，版本保持0.9.9，固定引擎为87d7e30ed28ec2d9。安装程序153552666 bytes，SHA256为4a95d2a92eadd3a02703b5b30c143683eaeb1c15ebed831106d43d3144f65dd8。包内已确认maxRepairRounds使用有界整数，旧数值literal union不存在，应用及引擎文件与本轮固定输入一致。

严格未使用类型检查、完整package:prepare、Windows资源与包边界检查通过。包内478个应用输出及190个引擎运行文件匹配，2200项构建输入在封装期间保持一致；安装程序解出的273个文件与打包目录一致。独立临时目录和配置下的LLM runtime、模块图、可见GUI、preload及正常GPU启动通过，载荷217.7 MiB、unpacked 11.1 MiB满足预算，latest.yml的SHA512／size一致。解包校验遇到Windows临时目录重命名EPERM，改为保留原目录并复制后逐文件比对通过，未修改安装包。

构建、运行和交付回执保存在artifacts/gemini-schema-installer-9dyDgS；旧六文件备份在其中previous-installer。覆盖后逐文件SHA256匹配，BUILDINFO.json与SHA256SUMS.txt同步更新。本轮交付包含当前工作区已有修改；没有实际安装、替换运行中的客户端、公开发布或请求真实云模型。

## Gemini 工具声明兼容修复（2026-11-14）

现场会话在09:42:41、09:43:09及09:43:24经Vertex AI调用时均因work_route.context.outcome.maxRepairRounds序列化为数值enum [0, 1]而被拒绝。引擎源码改为有界整数并保留0／1输出类型，运行时拒绝字符串、小数、越界和缺失值。设计归[上下文决策](superagent-context.md)。桌面固定六包更新为87d7e30ed28ec2d9；相对c3b228697d8a8e02仅schema.js、schema.d.ts和schema.d.ts.map变化，其他运行文件字节保留。

引擎superagent-context-flow、dispatch-context及superagent-reviews共25项通过，janus-agent完整构建通过。桌面superagent-context、superagent-routing、superagent-store和superagent-workflows共46项通过；新增回归检查实际注册工具的JSON Schema及0／1边界。严格未使用检查、固定制品哈希与包边界检查通过。Vertex SDK经注入fetch和假认证的离线请求确认maxRepairRounds发出为integer且无数值enum；SDK省略上下界，宿主仍严格校验。

证据位于artifacts/gemini-schema-fix：consumer-tests.json、baseline-manifest.json、delivery.json、vertex-request.json及engine-notes.json。桌面Notes检查346份、0错误、17条既有外链诊断；引擎Notes检查74份，本次维护文件无错误，仍有omp-tooling-design.md缺少Intent及旧codex-cli-tool-surface-survey.md相对链接失效两项既有问题，以及2条外链诊断。没有请求真实云模型、重跑全仓verify、打包安装、替换运行中的应用或修改用户会话记录。

## Worker 交接与证据复核安装包（2026-11-14）

按用户指定目录重新打包并覆盖 `release/superagent/installer`，版本保持 0.9.9，固定引擎为 `c3b228697d8a8e02`。该轮安装包包含目标／验收交接、约束撤销来源保留、交付后只读复核及最多一次返修；对应源码独立复审结果仍为 PASS。安装程序为 153552808 bytes，SHA256 为 `913ba877a7d6d929c948645b0dca6aa7255085f411527df96994c6a65f053e79`。

首轮安装包因混入本地 `_design` 原型及 `vendor/janus-agent` 历史归档，asar 载荷达到274.5 MiB，超过既有260 MiB预算。将这两个构建材料目录加入排除范围与包边界门，14项边界回归通过；重新封装后载荷为217.7 MiB，预算保持不变。运行依赖继续从包内 node_modules 加载，未删除本地原型或引擎制品；分发规则见[打包依赖决策](../desktop/packaged-hoisted-deps.md)。

严格类型、完整构建、包边界和排除清单检查通过。包内478个应用输出、190个引擎运行时文件与固定输入逐一匹配；从安装程序解出的273个文件与打包目录一致。独立目录中的 LLM runtime、模块图、可见 GUI、preload 和正常 GPU 启动检查通过，更新清单 SHA512／size 一致。六个交付文件已覆盖并校验复制后 SHA256，旧包保留在 `artifacts/superagent-installer-quality-LVC1CY/previous-installer`；构建、初次失败、修正与交付回执均保留在同一证据目录。未执行实际安装、替换运行中的客户端、公开发布或真实云模型质量评测。

## Worker Dock 与对话内汇报（输入89／90，2026-11-13）

整体Dock默认340 px、收起38 px；顶栏与边缘抓手开合、真实状态／耗时、未读标记和悬浮预览在HTML及生产同步落地。汇报改为对应对话位置展开，独立阅读顶栏固定、正文独立滚动，操作区及滚动条使用中性灰阶。具体规则归[界面决策](superagent-interface.md)。

- 真实React组件定向11项通过（按用例去重），覆盖整栏过渡逐帧宽度、快速反向连续性、抓手拖动及宽度保留、键盘／焦点、38 px轨、真实耗时更新、资源读取失败／重试／新版本未读、本地已读偏好、空对话备用报告、历史消息原位阅读、三主题固定顶栏、窄窗、上下文和串联高亮。最终证据由 `artifacts/superagent-dock-f59adea7/verification.json` 索引；截图在 topics/dock/、topics/superagent-toolbar/ 及 workers/reports/。
- 离线Dock专项3组、综合30组、编排10组通过；专项及综合无运行时错误和外部请求。原型截图、整栏开合实拍WebM与JSON位于 `artifacts/archive/design-review-20261114/superagent-bubbles/review-f59adea7/`。已查看深色监视轨预览及生产阅读器截图。
- 首轮回归发现空对话欢迎页遮住备用汇报，现由当前报告状态让出欢迎页；窄窗长引用因100%宽度加4 px外边距溢出，原型与共用输入样式均修正。测试页面的绝对定位工具栏遮挡关闭按钮，夹具改为与实际pane一致的独立顶栏；过渡中的宽度检查改为等待实际布局稳定，快速反向用真实键盘事件路径验证。
- 严格TypeScript、6个生产文件定向ESLint、16命名空间双语校验及限定已跟踪文件的差异空白检查通过。Notes校验346份、0错误、17条既有外链诊断。夹具仍输出未修改的AgentSessionPane／native-scrollbars CSS composes顺序警告，本轮未扩展到这些模块。
- 检查基于真实组件和受控IPC数据，未启动真实在线Worker、未打包安装、未跑全仓测试或替代用户人工验收。保留共享工作区已有修改，无Git提交或分支操作；当前HEAD为c819b86b5a1b8f24656c388504ba98bfcfc4b7c4，与分派旧基线不同，已按实际代码实施。

## Worker 监视窗开合（输入85，2026-11-13）

HTML 与真实 React 组件同步分段开关、刻度线和阻尼开合。详情折叠保留内部状态，键盘、inert、焦点归还、快速反向与减少动态效果均覆盖。规则归[界面决策](superagent-interface.md)。

- Worker 组件定向11项通过，证据在 `artifacts/superagent-monitor-ab5a9d08/` 的 `components.json`、`components-corrected.json`、`queue-final.json`（按用例去重）。逐帧几何证明标题高度不变、详情高度连续变化；另覆盖父流程／节点、独立命令输出、模型浮层、分支与耗时、排队控制、汇报及设置导航。初轮两项失败来自旧队列文案断言和收起动画尚未结束就测量；修正为当前占用展示与等待实际零高度后重跑通过。
- 真实工作区组件3项通过，见 `topics.json`：上下文选择与拖入、输入／回复／Worker 串联高亮及历史折叠、就地汇报。夹具仍有未修改模块的 CSS composes 顺序警告；本轮未触及这些模块。
- 离线专项6组、综合30组、编排10组检查通过，运行时错误与外部请求均为0。最新图片、开合 WebM、逐帧 JSON 位于 `artifacts/archive/design-review-20261114/superagent-bubbles/review-ab5a9d08/`。首轮窄屏测试使用隐藏入口，改为现有 Workers 按钮；分支提示在开合引起的滚动中消失的问题已修复并回归。
- 已查看原型深色展开、390 px 编排以及生产深／浅主题截图。生产组件为真实 React 与受控 IPC 数据；未运行真实 Worker、Electron 安装包、全仓测试或主观人工验收。没有提交、切分支或覆盖其他未提交改动。
- 严格 TypeScript、3个生产文件定向 ESLint、限定差异空白检查通过；Notes 检查346份、0错误、17条既有跨仓引用诊断。去重汇总和具体证据索引见 `artifacts/superagent-monitor-ab5a9d08/verification.json`。

## 色卡及并发设置入口（输入84，2026-11-13）

设置页将色块与色值组合，并以并列样例区分正文加粗和行内代码；保持原主题色持久化机制。侧栏只保留占用数和设置图标；通过真实标题栏打开 Agent 设置，WorkerCapacitySettings 承接原全局并发 IPC，正整数校验与保存失败草稿保留均已覆盖。规则归[界面决策](superagent-interface.md)、[调度](superagent-scheduling.md)及[主题机制](../workbench/theme-system.md)。

- `superagent-work-ui.test.ts` 定向5项通过：设置读取／校验／失败恢复、从侧栏跳转修改上限、Agent 设置滚动布局、刷新错误恢复、命令输出独立折叠。首轮因共享导航模块牵入 Monaco 导致夹具构建失败，改为独立轻量事件常量后恢复；随后修正旧测试的二分区假设和错误注入目标，两项重跑通过。证据为 artifacts/superagent-settings-e237da38/components-final.json、components-rerun.json。
- `conversation-topics-ui.test.ts` 定向3项通过：真实上下文选择／拖入／发送、问答与 Worker 联动和历史折叠、就地汇报。证据为同目录 topics.json。没有运行未选中的组件用例。
- `conversation-emphasis-settings.spec.ts` 4项浏览器用例通过，涵盖主题独立保存／重载／恢复、跨窗口同步、色卡几何及深浅／Planche／320px预览、真实 Titlebar 设置跳转。首轮两项新增测试选择器有误，修正原生颜色输入与十六进制输入的区分、使用真实 Settings 按钮等待后，二项重跑通过。证据为 browser.json、browser-rerun.json；已查看 color/color-control-white.png 和 settings/capacity/narrow-zh.png。
- 离线原型设置专项4组、既有交互30组、编排10组检查通过，运行时错误与外部请求为0。设置只在对话框内修改，降低到占用以下被拒绝；增加容量可释放满足依赖的排队节点。原型保存后的刷新作用域错误已修正并重跑。最新设置4张、既有交互27张、编排18张截图位于 artifacts/archive/design-review-20261114/superagent-bubbles/review-e237da38/；已查看设置深色截图。
- 严格 TypeScript、6个生产文件定向 ESLint、16命名空间双语校验和限定差异空白检查通过。Notes 检查346份、0错误、17条既有跨仓引用诊断。日志为 typecheck-final.log、lint-final.log、i18n.log、notes.log；最终侧栏截图与重复验证为 sidebar-final.json，不重复计入用例总数。

检查使用受控 IPC 与浏览器夹具。未打包安装、未运行全仓测试或真实在线 Worker；完全无工作区时受现有快照 IPC 限制，设置明确提示先打开工作区。本轮保留共享工作区其他未提交修改。

## 双模式新会话落地（2026-11-13）

普通对话与 SuperAgent 共用 ConversationWelcome、切角字标、引导语和真实工作区提示，整组与输入框居中、文字左对齐。已检查三主题、五个普通对话引擎、窄窗、矮窗、上下分屏及中文 SuperAgent；SVG 轮廓与原型一致，构建内联地址正确转义，JanusX 完整斜笔可见。加载文案采用顺序淡出／淡入，避免文字重叠，输入框保持原实例。普通加载、trust/login/hooks、错误摘要与原始详情、减少动态偏好、首条消息移动、/new 返回、400条历史下输入隔离均保留。SuperAgent 全屏启动、隐藏暂停、扫描、上下文导入、模型选择、#／@、话题和报告恢复均沿用原实现。

欢迎页只在真实空会话显示：普通重连时已有历史优先，SuperAgent 等待工作数据读取后再展示空态；工作流计划、待处理决策及暂停话题直接显示内容。测试夹具为失败 Worker 补齐 workerLog，并验证无消息时决策仍可见。生产无需修改日志接口。

证据目录为 artifacts/conversation-welcome-production-20261113/。原生24项独立检查通过，分别见 native-final.json（22项）、native-loading-final.json（14项，含新增重连历史，部分重复）及 native-results.json 中的输入隔离检查。SuperAgent32项独立检查通过：superagent-results.json 初轮30项通过；修正内联字标和窄窗后在 welcome-recheck.json、superagent-final.json、superagent-boundaries.json 与 decisions-final.json 定向复核，按最新执行结果汇总于 verification-summary.json。初轮加载错误断言在修改前版本 baseline-startup.json 同样失败；现已改为同时验证现有摘要和展开后的真实错误详情。首次冷启动导航超时随后复跑通过。

严格未使用项 TypeScript、定向 ESLint、i18n 和 electron-vite 构建通过；Notes 检查通过，保留17条既有跨仓引用诊断。日志在同一证据目录。没有覆盖安装版，也没有连接真实模型或重跑完整桌面发行验证。

## 双模式输入框落地（2026-11-13）

按用户确认更新普通对话 AgentComposer 与 SuperAgent 根输入框的圆角、字体、表面、灰色分割线、框外快捷提示及发送／停止布局。原生模型菜单移除对号，保留选中底色、字重和 aria-selected。SuperAgent 保留纯模型选择、上下文和 # 引擎 / @ Worker 操作，不加入推理强度；Worker 定向投递、文件引用、异步守卫与普通 Island 的原行为保持。

- 普通对话：四个既有浏览器文件 conversation-composer-layout、conversation-settings、conversation-inline-reference、conversation-commands 共52项；最终47项通过。新增3项覆盖 Codex、Claude、OpenCode 的单个主操作、草稿时双按钮、停止保留草稿、补充投递与结束复位；三主题380px截图已目视检查。首次新断言误采样颜色过渡，改为等待稳定样式；一次冷启动导航超时单项重跑通过。
- SuperAgent：conversation-topics-ui 中上下文、纯模型菜单、# / @、禁用目标与普通文本、连续补充、注册等待、输入框停止共7项通过，其余22项未选中。既有 footer 用例扩展了三主题窄窗、主操作位置、弱停止和未发送草稿保留；首次窄窗测量早于布局稳定，改为轮询后通过。已目视检查真实React组件的中文界面、窄窗、输入框、引擎候选、文件上下文与分支停止截图。
- 5项设置错误提示断言仍失败：测试要求 alert 直接包含 Fixture 错误原文，现有界面显示通用标题“The operation could not be completed”。使用修改前 AgentComposer.tsx / AgentSessionPane.module.css 的独立 Vite 加载对照，在 baseline-settings.json 与 baseline-ultracode.json 复现相同5项文案失败；未修改当前提示机制或放宽这些既有断言。
- 严格未用项类型检查通过；两份生产TSX的 ESLint 无错误，保留 JanusChat 原有4处中文文案警告，仓库配置不检查测试文件。electron-vite build 使用本轮独立输出目录构建通过；保留既有 CSS composes 与分包警告。

证据位于 artifacts/composer-production-20261113/，汇总为 verification-summary.json；原生分轮报告为 native-tests.json、composer-final.json、codex-final.json，SuperAgent 为 superagent-tests.json、footer-final.json，截图在 native/ 与 superagent/。这些是本checkout真实组件、受控会话数据与构建验证；未运行真实云模型或打包覆盖安装版。

## JanusX 切角字标更新（2026-11-13）

按用户确认，将生产 `src/renderer/src/assets/superagent-wordmark.svg` 更新为 HTML 的新版切角 JanusX；与 `design/superagent-conversation/assets/janusx-lockup.svg` 逐字节一致，保留完整杏橙斜笔。新资产由420×80原始比例自动缩放，既有底形、填充面与扫描遮罩同时更新。SuperAgentStartup.tsx 与样式对比本轮开始时逐字节一致，加载恢复条件、时序和点阵布局未改。

- `npx vitest run tests/unit/conversation-topics-ui.test.ts -t "startup|JanusX wordmark|static full-screen" --maxWorkers=1 --no-file-parallelism`：5项通过、24项未选中；覆盖扫描/遮罩、真实恢复门槛、隐藏暂停、减少动态偏好及输入等待，沿用既有 CSS composes 警告。
- 已目视检查真实 React 组件的扫描中段、完成帧、320×420中文窄窗及800×280矮窗：字形完整，橙色斜笔清晰，无裁切。三主题及1920×1080截图也已生成。
- 独立证据位于 `artifacts/superagent-cutcorner-startup-20261113/`，包括 startup-tests.json、startup-tests.log、startup/ 截图与 final-scope.json。

本轮生产仅替换SVG，验证使用真实组件与受控数据；未重跑全仓类型/构建/模型验收，未打包或替换运行中的安装版。

## JanusX 加载字标首批落地（2026-11-13）

本轮将对话 HTML 确认的厚块 JanusX 字标与扫描显现接入真实 SuperAgentStartup。按最新补充，Tab、终端选择及启动入口继续使用 Janus 双眼；TerminalArea.tsx 与 SuperAgentLaunch.tsx 对比本轮开始时逐字节一致。回复形象、恢复条件、工作调度与普通对话未改变。

- `npx vitest run tests/unit/conversation-topics-ui.test.ts -t "startup|JanusX wordmark|static full-screen" --maxWorkers=1 --no-file-parallelism`：5项通过、24项未选中。验证完整扫描、内联SVG扫光遮罩、快速与延迟恢复、隐藏pane及后台文档暂停、减少动态模式、切回不重播、草稿保留与启动期间输入等待。报告为 `artifacts/superagent-brand-production-20261113/startup-tests-final.json`。初跑隐藏检查使用了排除隐藏节点的role定位，改为includeHidden后复跑通过；截图检查发现内联SVG URL需要正确引号转义，已修复并增加遮罩生效断言。
- 已目视检查真实React组件的扫描中段／完整字形、320×420中文窄窗和800×280矮窗；三主题、1100×850与1920×1080截图也已生成，位于同目录startup/。
- `npm run typecheck:strict-unused`、SuperAgentStartup定向ESLint及`npm run build:check`最终均通过，日志为typecheck-final.log、lint-final.log和build-final.log。浏览器测试保留既有sidebar CSS composes警告。

证据来自真实React组件、受控恢复数据与本checkout构建；未运行其余24项组件测试、全仓测试或真实模型验收，未打包或替换运行中的安装版。Tab与终端入口替换提案已按用户要求撤回，不作为本轮交付。


## 入口与对话高亮简化（输入83，2026-11-12）

生产移除“独立提问”按钮及关联界面状态、样式、中英文文案；标题区只保留标题和说明。回复高亮删除左侧内阴影竖线，保留中性微底色。HTML 同步使用无单侧亮边的问答高亮，并持续确认没有该入口。公共输入、已有并行历史、上下文与悬停／键盘联动机制保持不变。当前规则归[界面决策](superagent-interface.md)。

- 真实 React 组件由 Playwright 驱动：`conversation-topics-ui.test.ts` 与 `superagent-presentation.test.ts` 共31项，初跑30项通过、1项失败；失败来自旧测试直接寻找默认折叠 Worker 内的提示词按钮。增加先展开详情的用户操作后，该项定向重跑通过，其他断言不变。证据为 `artifacts/superagent-ui-1a9a2caf/components.json`、`panel-rerun.json` 及对应日志。
- `superagent-work-ui.test.ts` 定向执行命令／输出折叠、分支／耗时／业务概括及汇报抽屉测试，3项通过、30项未选中，见同目录 `worker-regression.json`。合计34项相关用例验证通过。
- `build.mjs` 与 `verify.mjs`：30组离线浏览器检查通过，无运行时错误、外部请求或 Emoji；27张截图以及折叠／高亮几何证据在 `artifacts/archive/design-review-20261114/superagent-bubbles/review-1a9a2caf/`。覆盖上下文文件选择与拖入、输入发送、独立折叠、汇报就地阅读和窄窗。
- 新增断言检查中英文入口不存在、标题区无残留子节点／空隙，深色／浅色／Planche 回复伪元素没有阴影或左边框，同时微底色仍可见，联动前后几何不变。已查看生产深浅主题和原型浅色截图；生产 `linked/` 内含三主题及窄窗截图。
- 严格 TypeScript、生产组件定向 ESLint、中英文资源校验及 Notes 检查通过，日志均在本轮生产证据目录。测试文件按仓库 ESLint 配置被忽略，未声称 lint 覆盖它；Notes 为342份、0错误及17条既有跨仓链接诊断。浏览器构建仍有既有 CSS composes 的 min-width 警告。

验证使用受控 IPC 及离线资源。未运行全仓测试、未生成或安装新应用包、未验证真实外部模型；本次仅修改本 checkout 的源码与原型，保留共享工作区其他修改。

## 多 Worker 编排与 HTML 界面落地（2026-11-12）

按用户 xdo 授权实现持久父流程、角色依赖、全局名额排队、暂停后续、限定范围停止、最多一次返修及统一简洁卡片。独立 Worker 和编排节点共用 WorkerSummaryHeader；输入复用 dev 的行内文件引用、多行定位与原生撤销。规则及限制归[编排决策](ideas/superagent-workflow-orchestration.md)。

桌面固定引擎 build 为 `c1bea8c99878aafd`。六包及安装字节校验通过；相对 `b9f04002dca68710`，仅七个明确列出的编排／调度／服务／工具源码对应的 20 个发布文件改变，其他引擎内容保持原基线。复核命令为 `node artifacts/workflow-implementation/verify-package.mjs`，回执保存在同目录 package-verification.json。引擎源码和文档同步在 janus-agentX，桌面不依赖相邻源码路径运行。

验证结果：

- `npx vitest run tests/unit/superagent-workflows.test.ts tests/unit/worker-shortcut-routing.test.ts tests/unit/superagent-ipc.test.ts tests/unit/superagent-scheduling.test.ts --maxWorkers=1 --no-file-parallelism`：43 项通过，包含真实 Git 目录指纹及文件边界编码、开发后测试、一次返修上限、旧报告不推进、恢复不重放、暂停期间补充保序、单独停止子节点不复活、stop-all 关闭父流程及禁用引擎拒绝。最终回执为 artifacts/workflow-implementation/backend-final.json。
- `npx vitest run tests/unit/superagent-work-ui.test.ts --maxWorkers=1`：33 项通过，覆盖共用卡片、左侧计划定位、父流程暂停与停止确认、报告、模型设置、队列及原生审批。深浅主题与窄屏截图已查看，位于 artifacts/workflow-implementation/ui/。
- `npx playwright test tests/e2e/conversation-inline-reference.spec.ts --project=island --workers=1 --timeout=60000`：19 项通过，包含 dev 的八种多行目录落点和导入期间另一次拖入的 Range 重定位。此前首个页面冷启动在默认 20 秒导航阶段超时；使用明确的 60 秒启动预算后整组通过，断言没有放宽。
- `npx vitest run tests/unit/conversation-topics-ui.test.ts -t 'adds real context' --maxWorkers=1`：1 项定向通过，覆盖 SuperAgent 真实上下文选择、拖入、失败后草稿保留及发送后的行内引用；没有重复附件条。
- `tests/unit/superagent-routing.test.ts`：12 项串行回归通过。首轮并发验证曾有原有 Git 路由与快捷指令超时；归入真实 Git 集成组、按已有路由测试采用 45 秒预算。编排快捷指令的异步启动曾超过默认 1 秒等待，改为明确的 10 秒启动等待后整组 43 项通过，实际状态断言保持不变。
- `npm run typecheck:strict-unused`、`npm run build:check`、`npm run i18n:check` 和定向 ESLint 通过；ESLint 保留 JanusChat 原有四处中文文案警告。Notes 检查为 341 份、0 错误，另有原有 17 条跨仓链接诊断。

这些检查使用受控原生执行器与浏览器夹具，未声称真实在线 Codex／Claude 模型已完成端到端开发验收。未运行全仓 verify、未生成新安装包、未改动运行中的应用。共享工作目录的指纹检查检测可见版本漂移，不是不可变快照或测试正确性证明。

## 连续输入与高亮修复安装包（2026-11-11）

按用户要求重新构建并覆盖 release/superagent/installer，Windows x64 NSIS 版本仍为 0.9.9。构建包含当前 checkout 的连续输入 steering、对话高亮修复及既有未提交改动；固定引擎为 457d4530b40f11d6。严格 TypeScript、package:prepare、资源与包边界检查通过，功能回归证据见下方对应记录。

打包前后 1227 个源码输入保持一致；包内 478 个应用输出、181 个引擎运行时文件及 52 个工作区依赖产物与记录的构建字节一致。latest.yml 的版本、文件名、SHA512 与大小通过核验。使用仓库外独立目录及临时配置启动，模块图、LLM runtime、GUI 和 preload 检查全部通过；payload 237.3 MiB、unpacked 11.1 MiB 满足现有预算。

安装程序为 166459480 字节，SHA256 为 `6e3f289393a5b8ea0aeaf8d33bd8b4f598733b5f3820c7b9e201f01fb8004c8c`。安装包、blockmap、latest.yml、builder-debug.yml、BUILDINFO.json、SHA256SUMS.txt 六文件已交付指定目录，复制后逐一核验 SHA256 一致。覆盖回执为 artifacts/superagent-highlight/installer-delivery.json。

构建与独立启动证据保存在 D:/janusx-build-temp/superagent-highlight-20261111-233451，旧安装包六文件经哈希校验后备份于其 previous-installer 子目录。因 C 盘空间不足，临时构建使用 D 盘，先前 artifacts/build-check 输出已移至同一证据目录的 verified-build-check。未执行安装、替换运行中的应用、公开发布或全仓 verify。

## 对话高亮修复与优化（2026-11-11）

修复鼠标点击后的持续高亮、追加消息时原末条节点重建导致的联动丢失，以及 Worker 晚到关联未即时更新。用户气泡只在内容内描边，回复使用淡底与侧线，固定内边距避免文字贴边；键盘焦点保留可见反馈，悬停不展开历史或触发滚动。当前行为与边界归[界面决策](superagent-interface.md)。

先用真实组件复现：点击回复再移出后仍有3个节点高亮；追加补充后原输入节点 isConnected 为 false。两项失败记录分别为 artifacts/superagent-highlight/repro-tests.log 和 repro-append.log。修复后 `npx vitest run tests/unit/conversation-topics-ui.test.ts tests/unit/superagent-work-ui.test.ts tests/unit/superagent-presentation.test.ts` 共56项通过（52项浏览器、4项单元），保留鼠标／键盘、精确轮次、动态补充与 Worker 关联、卸载／失焦清理、三主题、390px窄窗与减少动态效果覆盖。最后增加的手动展开状态保留断言随 refreshes hovered 定向回归通过；检查原节点仍挂载，并非依赖等待时间掩盖重建。

严格 TypeScript 与定向 ESLint 通过，ESLint 为0错误和4条既有 JSX 中文警告；最终 `npx electron-vite build --outDir artifacts/build-check` 通过，保留既有 CSS composes 和动态导入提示。回归、类型、lint、构建日志归 artifacts/superagent-highlight/，已目视核对 after/linked/ 下深色、浅色、Planche 与窄窗截图，高亮不越界、不改变气泡尺寸。验证使用生产组件及模拟 IPC，未更新安装包或重启运行中的应用，未运行全仓 verify。

## Bubbles 交互与上下文正式落地（输入78／79，2026-11-11）

将已验证原型落实到真实 React 组件：独立默认收起的命令／输出、问答与 Worker 明确身份串联高亮、历史回复折叠、完成／空闲摘要沉降、就地汇报抽屉与显式放大。输入区复用普通对话的上下文选择、真实附件导入、拖拽高亮和内联引用编辑；引用展开进入模型请求，消息保存经过校验的引用元数据。纯模型选择接通下一轮请求，保留运行中 steering；没有手动选择时仍跟随设置默认模型。当前机制归[界面决策](superagent-interface.md)。

本执行证据集中于 `artifacts/superagent-ui-c16f1987/verification.json`，原型证据为 `artifacts/archive/design-review-20261114/superagent-bubbles/review-c16f1987/results.json`。9个相关单元／真实组件测试文件共117项通过；最后呈现调整另复测组件文件。共享普通对话的4个Playwright文件21项通过，覆盖附件导入、拖入、失败恢复、Windows路径、插入位置、图片、输入法、换行、撤销与重挂载。HTML离线22组检查通过，24张截图，0页面／控制台错误、0外部请求，构建及回归检查无Emoji。已目视复核三主题、窄窗、上下文条目、联动轮次与汇报抽屉。

严格TypeScript检查、定向ESLint、中英文键检查与Notes校验通过。ESLint保留4条既有JSX中文警告，组件夹具保留既有CSS composes提示，Notes为340篇、0错误和17条既有跨仓链接诊断。首轮旧断言失败和中间失败结果保留；共享输入的首次完整通过遇到测试服务器退出超时，后改为独立管理本次Vite服务，21项重新通过且退出码0，不把前次退出错误当作通过证据。

验证使用生产组件及确定性IPC／模型快照，未更新安装包、未替换运行中应用、未进行真实供应商／外部CLI执行或全仓verify。没有提交Git修改。共享工作区的既有steering、模型和布局改动均保留；本次只补齐界面与上下文所需通路。意图检测仍为Note备忘，不实施。

## 连续输入参与当前回合（2026-11-11）

按用户授权将单活动会话的默认输入接入 steering，显式独立提问保留临时分叉。连续补充沿用原输入身份和活动 requestId，区分接收与纳入回执；撤回同步移除持久原文，未知结果不自动重放。引擎同时修复启动及上下文准备期间的补充遗漏。当前机制归[界面决策](superagent-interface.md)。

- `npx vitest run tests/unit/conversation-topics.test.ts tests/unit/chat-stream-timeout.test.ts tests/unit/llm/chat-turn-guard.test.ts tests/unit/janus-tool-pairing.test.ts tests/unit/janus-steering.test.ts tests/unit/engine-packages.test.ts tests/unit/conversation-topic-routing.test.ts`：7 文件、68 项通过，覆盖同回合连续输入、启动／结束／回执竞态、未知结果、停止与失败隔离、IPC 超时及安装包中的建流前消费和工具配对。
- `npx vitest run tests/unit/conversation-topics-ui.test.ts`：19 项真实 React 浏览器回归通过。补充使用同一 requestId、无需归属调用或另起回合；启动等待、消费状态、撤回持久化、默认模型、分叉汇合、恢复及窄窗均有检查。日志为 `artifacts/steering-verification/ui-tests.log`；已目视检查 `superagent-steering/pending.png` 与 `applied-narrow.png`。
- `janus-agentX` 中 `npm run test --workspace=@janus-agent/agent-core`：25 文件、392 项通过、1 项既有跳过；`npm run build --workspace=@janus-agent/agent-core` 通过。仅 agent-core 的循环运行文件及其声明映射变化，其余五包运行时未变；六包重新固定为 `457d4530b40f11d6`。实际 vendor 压缩包、manifest 与 node_modules 文件哈希通过 `verifyEnginePackages` 核验，`npm run check:package-boundary` 通过。
- 严格 TypeScript 检查、定向 ESLint（0 错误、4 条既有 JSX 中文警告）、中英文键检查和 `npm run build:check` 通过；最后源码调整后再次完成 `npx electron-vite build --outDir artifacts/build-check`。构建保留既有 CSS composes 与动态导入提示。类型、单元、浏览器、lint 与构建日志保存在 `artifacts/steering-verification/`。

文档检查：桌面仓库 340 条 harness Note 通过，0 错误，17 条既有外部链接提示。对 janus-agentX 全仓应用同一检查器时，本次修改的 agent/module.md 没有错误；其他原有文档仍有 2 项错误（omp-tooling-design.md 缺少 Intent、2026-09-16-codex-cli-tool-surface-survey.md 的旧相对链接失效），以及 chat-turn-maintenance-hosting.md 和 delegated-task-hosts.md 指向旧 JanusX 目录的 2 条未解析外链。上述记录未在本次功能范围内修改。

证据来自确定性循环和真实界面配模拟端口，尚未验证真实供应商的思考延迟或遵从补充的语义质量。本轮已更新源码及工作区固定引擎依赖；未替换 release 安装包、安装或重启正在使用的应用，也未运行全量 verify。

## 气泡、汇报与 Worker 卡片安装包（2026-11-11）

用户要求将左右气泡 HTML 同步到真实代码，并在完成后自动打包覆盖 `release/superagent/installer`。对话气泡、紧凑分节报告、Worker 实际分支、当前任务概括及原生轮次计时已经实现。45 项真实组件浏览器回归、8 项呈现单元测试、17 组离线原型检查通过；严格类型检查、中英文键校验、定向 ESLint、build:check 和 package:prepare 通过。对应截图与日志在 `artifacts/superagent-ui-sync-20261111/`。

Windows x64 NSIS 安装程序保持版本 0.9.9，固定引擎为 `9079f8b4eae8658b`。包内 478 个应用构建文件及 181 个引擎运行时文件与当前构建／固定清单一致，打包期间记录的源码输入未变，更新清单 SHA512 与大小校验通过。包外独立目录的模块图、LLM runtime、GUI 与 preload 启动验证通过。

安装包及 blockmap、latest.yml、builder-debug.yml、BUILDINFO.json、SHA256SUMS.txt 六文件已覆盖指定目录，复制后 SHA256 全部一致。安装程序为 165995455 字节，SHA256 为 `2d2f11670dfa515e8d12c2327caf8c89429759124ae1a96cf197116820ae547e`。旧六文件保留在 `D:/janusx-build-temp/superagent-ui-sync-20261111-1828/previous-installer`。构建包含当前 checkout 既有改动，未执行安装、重启现有应用、公开发布或全量 verify。包内证据见 `installer-verification.json`，覆盖回执见 `installer-delivery.json`。

## dev 同步后的安装包（2026-11-11）

以 SuperAgent 分支为基础，将 dev 的 ed66abc0 合入为 9a440cd7，并恢复该 checkout 的既有未提交功能。保留受管 Worker 和固定引擎架构，将 dev 的独立 retry 状态、turnError 与可取消异步提问同步到引擎源，重新固定六包为 13fe2d650a23f0db。VirtualHistory 同时保留输入导航与可选虚拟化。会话概括与 AGENTS.md 注入修复包含在本构建中。

Windows x64 NSIS 安装包及 blockmap、latest.yml、builder-debug.yml、BUILDINFO.json、SHA256SUMS.txt 已覆盖 release/superagent/installer，并逐一验证复制后 SHA256。安装包 JanusX-0.9.9-x64-setup.exe 为 155676881 字节，SHA256 为 7f56ec6416d327d625bcfc10a3da990a949d25f5478fcfb4982fdd67e081a3d0。478 个应用输出与 180 个引擎运行时文件和包内字节一致，更新清单 SHA512 与大小一致；包外独立目录的模块图、LLM runtime、可见 GUI 和 preload 启动检查通过。

类型检查、package:prepare、包边界、166 项相关测试与 9 项输入导航／会话卡片界面回归通过；1 项真实原生环境测试按配置跳过，未运行全量 verify 或实际安装。证据在 artifacts/superagent-dev-*。构建包含当前未提交修改，合并前备份保留为 stash 的 superagent-before-dev-merge-20261111；旧安装包六文件另存于 D:/janusx-build-temp/superagent-installer-before-dev-merge。没有替换正在运行的应用。

## 多输入话题增量验证（2026-11-10）

本次 xdo 接入生产话题路由、FIFO、独立会话并行、合并过渡与 Worker 控件。相关 9 个测试文件共 81 项通过：`conversation-topics.test.ts` 8、`conversation-topic-routing.test.ts` 2、`conversation-topics-ui.test.ts` 4、`superagent-work-ui.test.ts` 8、`janus-chat-store.test.ts` 11、`janus-chat-conversations.test.ts` 12、`janus-chat-engineering.test.ts` 3、`llm/chat-turn-guard.test.ts` 25、`superagent-routing.test.ts` 8。浏览器检查运行真实 React 会话控制器，以确定性 IPC／模型夹具验证输入身份、并行输出、合并中间阶段、焦点、无内层滚动、报错、选择／自定义回答／暂缓／提交回执、重启暂停及减少动态效果；Work 集成验证沿用真实隔离 worktree 和宿主调度。

`npm run typecheck:strict-unused`、`npm run i18n:check`、`npm run build:check`、`npm run package:prepare` 通过。改动源文件 ESLint 为 0 错误、4 条既有圆桌中文字面量警告；改动文件的 diff 空白检查通过，全仓另有既存 `JanusIslandExpandedShell.tsx:428` 尾随空格，未改动。`npm run check:notes` 为 339 篇、0 错误、17 条既有跨仓链接诊断，本轮未解析这些外部链接。界面截图在 `artifacts/superagent-topics/`，Main 已检查并行卡片、问题选项和 Worker 异常／关闭状态。

边界：本轮没有调用真实供应商评测话题分类准确率，也没有以这些夹具结果冒充真实外部 CLI 执行验收；未执行全仓全部测试。实现细节、并发上限和尚未实现的误合并撤销见[界面决策](superagent-interface.md)。

按用户要求覆盖 `release/superagent/installer`，交付 `JanusX-0.9.8-x64-setup.exe`（152026577 bytes）、对应 blockmap、latest.yml 和 SHA256SUMS.txt。安装包 SHA-256 为 `1c92dad81d045552765ad9accbb3bd346f9a1491c5804bbb5a9ea6d0d6760a59`，与 latest.yml 的 SHA-512／size 一致。`electron-builder --win nsis --x64 --publish never` 成功，`check-packaged-runtime.mjs --release-dir <独立 staging 目录>` 验证包内模块图、运行时、GUI 和 preload 启动通过。额外读取 app.asar 确认新版 topic IPC 和话题卡片实际进入产物；覆盖前后逐文件校验 SHA-256。打包日志与包内标记证据在 `artifacts/superagent-topics/`，本次未覆盖同级 portable 包。

## 高保真界面本地包交付（2026-11-10）

用户要求打包到 `release/superagent`。当前工作区经 `npm run package:prepare` 后生成 Windows x64 便携版，并以同一 `win-unpacked` 生成 `installer/JanusX-0.9.8-x64-setup.exe`；版本仍为 0.9.8，包含当前未提交修改。便携版 187991773 bytes，SHA-256 `82cf0844d741cacbf02e8d2023d83c564173855aaeefd56ae9dc28baafc54fb4`；安装版 152572266 bytes，SHA-256 `e83f81765c23168808b23881893e2b6222141a2799fc71bdaaac616aed4a74ac`。478 个 `out` 文件逐一与包内内容匹配，安装更新清单的 SHA-512 和大小一致。

`check-packaged-runtime.mjs --portable --release-dir release/superagent` 最终通过 unpacked、portable payload 和 portable stub 的模块图、运行时与 GUI／preload 检查。首次打包遇到路径大小写与 junction 不一致，改用实际大小写工作目录后成功；首次便携验证因 C 盘临时空间不足导致提取失败，临时目录改为 D 盘后完整通过。原失败日志保留，最终证据为 `artifacts/superagent-hifi/package-runtime-final.log`、`package-installer.log`、`delivery-verification.log`；交付目录的构建信息、校验清单及说明已更新。本次未执行安装、替换正在运行的客户端或新增付费模型验证。
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

单文件 `design/superagent-current/SuperAgent.html` 的 8 组交互检查通过，覆盖五个 Worker 状态、容量与排队、回答后继续同一工作、两层开合、详情、菜单、草稿保留、窄窗终端回显与首页入口。页面没有脚本错误或外部 HTTP 请求；深浅色、问答、多 Worker、窄窗和极窄浏览器截图已目视核对，位于 `artifacts/superagent-current-demo/`。演示使用模拟执行和终端回显，不代替产品原生执行证据；极窄浏览器适配只便于查看演示，不构成桌面应用的移动端支持。

2026-11-06 滚动条与 Worker 状态边框复核：直接复用原生对话滚动条，边框颜色使用现有工作阶段和语义主题变量。聊天浏览器回归使用前述两个文件及 `--grep 'menus|model menu|shared|compact composer|session rail'`，14 项通过；`npx vitest run tests/unit/superagent-work-ui.test.ts` 2 项通过。浏览器视觉夹具挂载生产 JanusChat、原始侧栏／工作卡样式和模拟阶段，4 组检查通过：三主题下两种聊天宿主、侧栏与原生对话滚动条样式一致，八种阶段的边框色正确，消息／侧栏滚轮互不影响，滑块实际拖动成功。初次拖动检查因 Playwright 默认 `--hide-scrollbars` 隐藏滚动条而失败；移除此测试启动参数后复测通过，未为测试修改产品滚动行为。截图与结果位于 `artifacts/superagent-scroll/`。

当前 HTML 已重新嵌入共用滚动条与状态边框，`node design/superagent-current/verify.mjs` 8 组交互复测通过，截图包含可见滚动条。严格未使用类型检查、主题检查和应用构建通过；定向 ESLint 0 错误、4 条既有警告。日志位于 `artifacts/superagent-scroll-{browser,worker,visual-final,demo-final,typecheck,theme,build,lint}.log`。本轮不重跑完整 Electron 或付费真实模型验收。

2026-11-06 Worker 列表呈现复核：按用户反馈将右侧独立卡片改为连续列表，去掉彩色外框与圆角，颜色保留在状态圆点和文字中。详情原地展开，停止／关闭常显，Codex 移入详情。生产 Worker 组件 2 项通过，HTML 的 8 组交互复测通过；280 px 侧栏、展开详情和长标题均无横向溢出。目视核对生产组件截图与 HTML 的深浅主题、窄窗截图，证据位于 `artifacts/superagent-p7/worker-chat.png`、`artifacts/superagent-current-demo/` 及 `artifacts/superagent-list/`。严格未使用类型检查、主题检查、定向 ESLint 和应用构建通过，日志为 `artifacts/superagent-list-{worker,demo,preview,typecheck,theme,lint,build}.log`。该轮未重跑完整 Electron 或真实模型验收。

2026-11-07 Worker 卡片恢复复核：按用户最新选择恢复紧凑独立卡片，采用中性边框、小圆角、底色与间距，保留状态圆点、文字操作和原地详情。变更限样式，HTML 从生产 CSS 重新生成；8 组演示交互通过，280 px 侧栏、展开详情与长标题无横向溢出，深浅主题截图已目视核对。主题检查和应用构建通过，日志为 `artifacts/superagent-cards-{demo,layout,theme,build}.log`；最新截图保存在 `artifacts/superagent-current-demo/` 与 `artifacts/superagent-list/`。该轮未新增测试，也未重跑完整 Electron 或真实模型验收。

2026-11-07 SuperAgent 用量面板精简复核：通过 JanusChat 呈现选项关闭该宿主的用量、上下文容量及刷新模型信息面板，保留模型选择。`janus-context.spec.ts` 中 `both chat entries send|catalog update recognizes` 两项最终通过，确认其他对话入口继续保留用量和目录刷新；长对话用例首轮超过默认 20 秒，将该次执行的 `--timeout` 调为 60000 后以 26.4 秒完成，没有修改产品逻辑。严格未使用类型检查、应用构建通过，定向 ESLint 0 错误、4 条既有警告；日志为 `artifacts/superagent-usage-{context,context-retry,typecheck,build,lint}.log`。HTML 已同步去掉用量行。

2026-11-07 终端启动界面开合复核：当前项目没有 pane 时，终端入口可以反复展开／隐藏启动界面，提示和展开状态同步变化。扩展现有 `desktop-superagent.spec.ts` 的 `Island starts` 桌面场景，覆盖显示、隐藏、恢复对话焦点及草稿、再次显示，以及 Worker 与外层工具区开合；首轮发现焦点停在按钮，补上收起后的输入框聚焦，最终真实 Electron 1 项通过。最终应用构建、严格未使用类型检查、翻译与主题检查通过，Workspace 定向 ESLint 无问题。日志为 `artifacts/superagent-terminal-toggle-{build-final,desktop-final,typecheck-final,lint-final,i18n,theme}.log`。

同轮 HTML 增加「未打开终端」场景，9 组交互检查通过，包含启动界面反复开合、草稿与焦点恢复，以及选择模拟 PowerShell 后继续显示终端。首次串联检查因上一场景留在终端区域而无法填写小屏对话，在进入下一场景前显式切回对话后通过；没有为该问题修改产品。截图 `artifacts/superagent-current-demo/terminal-launcher-light.png` 与真实桌面 `artifacts/superagent-controls/light-expanded.png` 已核对，演示记录为 `artifacts/superagent-terminal-toggle-demo-final.log`。该轮没有重跑原生 Worker 或付费真实模型验收。

## 真实使用故障补充

2026-11-08 排查设置扩展任务时核对到：首次回复 41 次工具调用，第 40 次才 work_route；实际分派因嵌套 worktree 被拒绝，工作输入保持 pending，无执行或报告。继续后的回复又有 40 次工具调用并触顶。目标主 checkout 与本探索工作树的代码不同，且入队前拒绝没有形成右侧可展示的调度项。详细证据和推断边界归[可靠性讨论](ideas/superagent-harness-reliability.md)。这暴露了现有有限场景验收未覆盖的路径，不撤销历史实际通过结果，也不表示整体生产可靠性已获保证。

同轮 Main 运行 `npx vitest run tests/unit/agent-max-steps-config.test.ts tests/unit/superagent-environments.test.ts`，2 文件、26 项通过。这些测试验证现有行为，没有覆盖并修复本次完整故障链；本次未执行新的桌面／真实模型回归。

## Reproduction

常规入口为 `npm run verify`。实际 Windows Codex 用环境变量 `JANUS_SUPERAGENT_CODEX_BINARY` 指向选定二进制；未提供时原生测试会明确跳过，不能当作通过。原生 MCP 集成需要当前构建的 `artifacts/build-check/main/worker-mcp.js`，桌面使用 `out/main/index.js`。

受控真实模型场景为 `desktop-superagent-live.spec.ts`，只有明确提供 `JANUS_SUPERAGENT_LIVE_CONFIG`、`JANUS_SUPERAGENT_LIVE_CODEX_HOME` 和上述二进制才运行；`JANUS_SUPERAGENT_LIVE_MODEL` 仅覆盖隔离副本里的 Janus 模型。用户指定使用 `gemini-3.8-flash`，Worker 沿用所选原生 Codex 账户。测试复制配置到隔离 profile 和 Codex home，保留本机连接所需代理，只向模型提供临时的 greet 小功能仓库。原配置不写回；结束清除测试的凭据及原生配置副本。只回答已授权的宿主 MCP 工具权限，任意模型问题不自动代选。

临时仓库／计划 worktree 的原生文件夹信任由测试在隔离 Codex 配置中预置，产品仍遵守已有原生信任检查；具体 Git 创建批准另由界面完成。这不是产品替用户修改全局信任。验收目标为真实开发、实际 Node 测试、只问历史不执行以及继续同一工作，不能据此推导一般语义归属准确率。

## Storage and compatibility

P8 的 `work_git` 仅提出计划，执行仍走环境操作的具体批准。调度账本在版本 1 上增加 `git-merge`／`git-remove` 和可选 `operationId`，新读取器兼容既有记录；旧二进制不认识新动作，因此产生新记录后不要用旧版本覆盖原 profile。升级前备份整个 `janusx/superagent` 目录，诊断时保留原始错误和记录，不能通过删目录或自动重放修复未知结果。

P4／P5 依赖相邻 `janus-agentX` 的委派执行提醒策略和共享资源引用保护；交付需保留这些共享源码。独立 Blueprint 构建锁随当前公共包重新生成并验证，版本号和外部下载源不改变。本轮没有发布、推送、提交或替换用户正在使用的桌面程序。

## Limitations

2026-11-10 合并原型高保真实施：`npx vitest run tests/unit/superagent-work-ui.test.ts tests/unit/conversation-topics-ui.test.ts tests/unit/worker-presentation.test.ts` 通过 22 项检查（12 项 Worker／汇报组件、6 项真实工作台话题、4 项数据投影）。覆盖当前 turn 指令与输出更新、完成／断连／恢复／停止不误示执行、最近已投递输入选择、隐藏宿主启动消息、提示词按需读取、旧报告恢复为紧凑卡片、完整原文弹窗与焦点返回、三主题及手机布局，并复验既有审批、问题与关闭身份。证据位于 `artifacts/superagent-hifi/tests.log` 和同目录截图，Main 已目视核对真实 React Worker 三主题及完整工作台桌面／手机。

严格未使用类型检查、定向 ESLint、主题与双语检查通过；涉及的 `JanusChat.tsx` 仍有四条既有中文常量 lint 警告，无错误。`npm run build:app` 通过，最后样式与弹窗重试修改再经 `npx electron-vite build` 验证，构建日志位于 `artifacts/superagent-hifi/build.log`。本轮是 Renderer 与协议夹具验证，没有运行付费模型、重新验收真实 Codex 全链路，亦未替换或启动用户正在运行的安装版。

首版为本机 Windows Codex；不承诺其他平台、任意 CLI 版本或真实供应商服务永远可用。协议夹具证明确定性通路，真实模型检查单独记录；有限受控场景不代表多轮复杂需求的语义正确率。监督增强、跨工作区完整归属及多引擎继续按原分期处理。
