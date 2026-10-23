---
{
  "schema": "harness-note/2",
  "id": "607e1d4b-8bf4-43c7-af1f-97da9ae9e30b",
  "kind": "note",
  "lifecycle": "draft",
  "created": "2026-10-16",
  "updated": "2026-10-23T11:09:35Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/1aef97e6-77fe-4bae-af51-ff560a737282",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/96a2f5cd-166e-4982-a444-7640858f0a5f" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/80e8b427-d263-42f4-b7cd-8313548c9e2a" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bd06538e-063f-4de8-a3da-11b0dccd41d5" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/43efa5a7-e16c-4cc7-846b-f271f8366260" }
  ]
}
---

# 插件平台分阶段交付计划

## 排期定位

目标是让用户通过插件组合中部工作区、工具箱、右侧栏、Island、独立工作台，以及文件、任务、Agent 和外部系统能力，形成完整功能。入口、命令、视图、展示位置与能力授权分别建模；已有官方功能逐步使用同一贡献语义。完整设计归[插件平台架构](../workbench/plugin-platform-design.md)，PI-Desktop 调研继续归[研究 Note](../workbench/ideas/plugin-platform-and-feature-modularization.md)。

保留 S1 至 S5 的既有标识与历史证据；S1 至 S3 已交付，S4 为首个本地插件闭环，S5 为分发。执行细分为 P0 至 P8：P0–P2 对应 S4，P3–P7 扩大贡献和能力，P8 对应 S5。P0 契约、P1 SDK／校验／脚手架和命令入口、P2 本地加载／授权／隔离桥／管理调试已完成；S4 本地只读范围闭合。P3 已接入工作台根页面和 Island 声明式状态、动作、预览及隔离展开工具区。P4 已实施只读 viewer 首片，文件编辑／事务保存、目录查询及完整多实例验收待续，P5 已采用宿主声明式任务交付后台监督、受限网络／凭证及事件／公开服务，P6 已接通内置 Agent／公开服务、受限文本模型代发、技能资源和顺序服务工作流，文档上下文提供者仍待续，P7–P8 尚待实施。实际验证、完整门禁证据及平台限制见下文各阶段专节。

本计划采用相对排期，参考工作量按单条主线、主 Agent 顺序实施估算，包含相关测试与文档维护，不指定起始日期或版本，不挤占既有事项；统一列入[工程排期的未归入节点](engineering-milestones.md)。估算不是历史速度或承诺工期，每批开始前按实际代码、依赖和试验结果修订。普通文档维护与普通 xdo 不创建执行 Task，阶段通过仍以所属需求和实际证据为准。

## 当前基础与实施边界

S1 已在 `src/renderer/src/extensions/` 提供注册／注销、启用／停用、同步激活与清理、稳定视图 ID、React 订阅和视图宿主。右侧注册表与状态管理合并动态贡献，中部通过通用 extension pane 和已有 `+` 菜单承载。S2 已将文件树、Git、会话管理注册为内置扩展，移除它们在右侧容器中的专属渲染与图标分支；兼容适配保留旧 ID、入口和宽度偏好。第三方包另经 P2 主进程登记和授权，再注册可信壳，不向此可信接口直接导入脚本。

内置扩展随应用发布，保留可信 React 运行方式，通过宿主服务访问文件、Git 与会话能力；第三方插件使用隔离容器与按权限开放的通信桥。两者共享贡献语义，不共享全部权限。外部管理网页使用独立承载规则，不因嵌入而获得插件桥。文件系统、Git 操作、会话执行与持久化继续由原宿主模块负责，本轮不重写底层服务。

验收归[插件架构需求](../workbench/requirements/plugin-architecture-forms.md)，导入、隔离和调试归[第三方导入需求](../workbench/requirements/plugin-import-debug.md)，CPA 与 Figma 的产品边界归[服务集成](../workbench/service-integrations.md)。首个 S4 交付不捆绑迁移 Island、蓝图或助手；这些区域的通用贡献分别排入后续批次。所有共享容器变更覆盖已有功能回归，保留旧 ID、偏好和会话行为。

## P0／P1 交付与验证

P0 已形成[首版契约](../workbench/plugin-contract-v1.md)：清单及五类权限、真实消费者盘点、项目／worktree／实例／代次身份、生命周期、两份时序及 C01–C24 测试输入。合法 JSON 样例与 SDK 模板做结构等价校验，生产清单使用 Zod 与 SemVer，并额外拒绝重复键及超深 JSON。规格推演不计作真实隔离证据。

P1 已提供 `packages/plugin-sdk/`、CLI 与双页模板，以及可信命令／菜单／快捷键 registry。工具箱和中部添加菜单共用命令，旧 launcher 自动适配；公开清单不生成未声明入口。偏好显隐／排序与快捷键覆盖独立持久化，等优先级冲突不执行且有诊断；写入失败保留原偏好，停用清理入口及命令。管理页仍归 P2，AC-9 保持未勾选；架构 AC-1、AC-4 仅按开发及纯策略门禁通过，所有第三方运行 AC 保留未完成。

`npm run plugins:check` 已接入 verify：构建 SDK、校验契约模板、将 SDK 打成 tarball 后在系统临时目录外部项目执行安装／typecheck／Vite 双页构建／包校验，并运行 SDK、开发工具与命令负例。外部项目仅引用公开 SDK，未引用私有源码；当前 SDK 未发布 npm，脚手架明确要求本地 tarball，且拒绝覆盖既有目录。回执 `artifacts/plugin-p1/scaffold.json` 保存 tarball integrity、外部目录和实际命令输出；此检查可能需要 npm 依赖缓存或网络。

单元命令：`npx vitest run tests/unit/plugin-sdk.test.ts tests/unit/plugin-tools.test.ts tests/unit/extension-commands.test.ts tests/unit/extensions.test.ts tests/unit/builtin-extensions.test.ts tests/unit/right-tool-state.test.ts tests/unit/right-tool-dock.test.ts tests/unit/workspace-pane.test.ts tests/unit/workspace-front-surface.test.ts tests/unit/workspace-remote-terminal-sync.test.ts tests/unit/workspace-sidebar.test.ts tests/unit/side-panel-collapse-ui.test.ts tests/unit/global-tool-entry.test.ts tests/unit/cpa.test.ts`，14 份、220 项通过；其中新增 SDK／工具／命令 51 项。覆盖重复键、未来权限、悬空引用、越权方法／路径、静态链接、预算、双命令同视图、快捷键冲突、偏好持久化及失败不改内存等。右侧 SSR 测试有既有 useLayoutEffect 警告，不影响通过结论。

浏览器命令：设置 `JANUS_E2E_PORT=41873`、`NO_PROXY=localhost,127.0.0.1,::1`，执行 `npx playwright test tests/e2e/extensions.spec.ts tests/e2e/builtin-extensions.spec.ts tests/e2e/pane-tab-drag.spec.ts tests/e2e/right-dock-motion.spec.ts --project=island --workers=1 --output=artifacts/plugin-p1/browser-reviewed`，35 项通过。新增右侧视图工具箱状态用例后，执行 `npx playwright test tests/e2e/extensions.spec.ts tests/e2e/builtin-extensions.spec.ts --project=island --workers=1 --output=artifacts/plugin-p1/browser-final`，11 项通过；合计 36 项不同用例。最终复跑曾因共用 Vite 预构建缓存返回 504 Outdated Optimize Dep，现已按 harness 端口隔离缓存；失败轮次不作为通过证据。覆盖双入口／快捷键、输入焦点不抢键、缺项目拒绝、隐藏入口仍可从其它入口打开、停用清理、右侧打开标识，以及拖拽、宽度和动效回归；使用浏览器 IPC fallback，不证明 Electron 插件隔离。

真实 Electron 回归：设置 `JANUSX_E2E_ENTRY=artifacts/plugin-p1/build-check/main/index.js`，执行 `npx playwright test tests/e2e/desktop-smoke.spec.ts --project=desktop --workers=1 --grep 'Browser load failure' --output=artifacts/plugin-p1/desktop`，1 项通过，验证既有浏览器原生视图及菜单生命周期，不证明第三方插件隔离。

回头自审修复了新命令的无障碍名称仍取视图标题、同一视图多命令的菜单键冲突、脚手架目录复制误报冲突、未声明命令的公开清单被旧适配补入口、偏好写入失败后的内存一致性，以及工具箱右侧视图打开标识误查中部 pane 的问题，并补对应负例或组件回归。本轮由主 Agent 自审，未执行独立 Agent review。

`npm run typecheck:strict-unused`、SDK 构建、变更范围 ESLint、`npm run i18n:check` 及 `npm run exclusions:check` 已通过。`npx electron-vite build --outDir artifacts/plugin-p1/build-check` 生产构建通过，日志为 `artifacts/plugin-p1/build-reviewed.log`，不覆盖既有 out。新增类型依赖已同步打包排除清单；打包文件模式和依赖契约校验通过，未对旧 out 声称完整打包边界通过，未生成安装包。全仓 verify 与真实第三方 Electron 隔离尚未执行，不据此关闭 P2。

## P2 交付与验证

设置 → 插件现提供开发开关、链接开发目录／复制安装、权限及项目范围确认、启用／停用、重载、卸载及单独删除私有数据。来源与启停意图持久化，恢复启用不自动打开页面；关闭开发模式撤销运行并保存停用意图，重新打开模式不自动恢复执行。中部与右侧视图通过公开 SDK 访问项目上下文、精确授权的 UTF-8 文件、插件私有 KV／watch、自有视图打开和带身份的提示。入口显隐、排序、快捷键覆盖及冲突展示已接通。终端类型、CLI／会话适配器及 PTY 后端继续由宿主拥有，不接受第三方注册；网络、项目写入、模型后端、工作台及 Island 不在 P2 开放范围。

载体试验发现主窗口 iframe 的 HTTP／图片／导航虽受限，WebRTC STUN 仍向 UDP 监听器发出 3 包，失败日志为 `artifacts/plugin-p2/network-probe.log`。现改为每插件独立内存 Session 的 sandboxed WebContentsView，组合离线网络上下文、宿主持有的拒绝代理、WebRTC 策略、权限／下载拒绝和 opaque-origin CSP；主窗口 Office CSP 保持原规则。专用协议只返回校验后的不可变资源，最小 preload 仅传递一次 MessagePort，不提供 IPC 或宿主对象，请求直达主进程 broker。原生视图增加布局、遮挡与进程成本，菜单、对话框、通知及拖拽使用遮挡租约；平台升级后须重测网络及回收。详细运行边界归首版契约。

桌面验证命令：设置 `JANUS_E2E_PORT=41876`、`JANUS_E2E_MAIN_ENTRY=out/main/index.js`、`JANUSX_E2E_ENTRY=out/main/index.js`、`NO_PROXY=localhost,127.0.0.1,::1`，执行 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/desktop-cpa.spec.ts tests/e2e/desktop-smoke.spec.ts --project=desktop --workers=1 --grep 'external packed|runaway plugin|copied development|six invalid|three native|built desktop|Browser load failure|CPA native page shares' --output=artifacts/plugin-p2/desktop-final-reviewed`，8 项通过，日志为 `artifacts/plugin-p2/desktop-final-reviewed.log`。SDK 由仓库外打包安装的双页模板实际运行，覆盖导入授权、双视图及 KV 共享、项目 A／B 隔离及切回、热重载／手动重载、入口管理、停用卸载、复制来源重启和开发模式；六类坏包无半登记，三次真实握手超时自动停用，死循环 renderer 可销毁且宿主仍响应。HTTP／图片、popup／导航、STUN UDP／TURN TCP 探测零到达，伪造其它窗口管理 IPC 被拒绝。CPA 登录复用／遮挡以及既有工作区、终端和浏览器生命周期回归通过。此结果不代表穷尽所有网络通道、进程崩溃或 OOM。

最终完整 verify 的单元阶段为 433 份通过、6 份跳过，3773 项通过、23 项跳过，日志 `artifacts/plugin-p2/verify-bounded-final.log`。其中只读路径的 junction／hardlink、登记根被替换、旧绑定、项目切换迟到响应、权限增加、KV CAS／配额／撤销及 SDK 订阅乱序有单元证据；不能将这些替身证据写成 Electron 全覆盖。`npm run plugins:check` 包含仓库外 SDK 安装／typecheck／双页构建／校验与插件专项用例，回执归 `artifacts/plugin-p1/scaffold.json`。

最后的链接根修复后，重新执行 `npm run plugins:check`，4 份 72 项通过（runtime 21、SDK 38、工具 4、命令 9），日志 `artifacts/plugin-p2/plugins-final.log`；三条新增负例分别覆盖恢复、启用及重载，Windows watcher 打开时无法 rename 的首次测试布置已调整，初次失败不计通过。`npm run build:app` 重新通过，日志 `build-root-reviewed.log`；不设置主入口覆盖，运行 `npx playwright test tests/e2e/desktop-plugins.spec.ts --project=desktop --workers=1 --output=artifacts/plugin-p2/desktop-root-reviewed`，5 项通过，日志 `desktop-root-reviewed.log`，确认默认使用最新 out 及全部插件桌面场景。严格 unused 类型检查与变更范围 ESLint 同轮通过。

回头自审修复了 Electron／Windows `lstat.dev` 不可靠导致合法读取被拒、SDK 早到 watch 事件被旧快照覆盖、项目切回未重挂、相同内容的手动重载未换实例、热重建 dist 后 watcher 丢失、入口显隐擦除排序、通知被原生视图遮挡及 DevTools 共用插件 Session 被资源策略拦截等问题。最后补上已登记链接根被 junction 替换的恢复／启用／重载拒绝，并将桌面测试默认入口对齐 `out/main/index.js`。本轮为主 Agent 自审，没有独立 Agent review。

最终完整门禁设置 `VITEST_MAX_THREADS=4`、`VITEST_MAX_FORKS=4`、`VITEST_MIN_THREADS=1`、`VITEST_MIN_FORKS=1`，加上上述桌面端口、主入口和 NO_PROXY，执行 `npm run verify` 返回 0，日志 `artifacts/plugin-p2/verify-bounded-final.log`。通过插件门禁 72 项、主项目单元 3773 项、llm-core 80 项、类型／严格 unused、生产构建、包边界、主题、i18n、打包排除、Notes 和 lint；lint 为 0 错误、67 条现存警告。全量桌面为 36 项通过、2 项跳过，包含全部 5 项插件用例，以及蓝图、会话继续／历史、浏览器、编辑器、备忘录及启动助手；跳过两项需官方 CPAMC／CPA ZIP 资源的用例，不记作通过。此轮未重新执行 P1 的浏览器 harness 全集。

默认高并发的前两次 verify 曾停在 `workflowx-v2.test.ts` 语料可达性检查，唯一错误为 `BLUEPRINT_SYNC_TIMEOUT`，日志 `artifacts/plugin-p2/verify.log` 与 `verify-reviewed.log`；该文件单独复跑 8 项通过。最终仅限制本次进程并发，没有修改仓库超时或默认 worker 配置，默认高并发的稳定性问题仍保留，不能声称其已经修复。

2026-10-23 收尾补上故障计数缺陷：成功握手不立即清零，仍有就绪页面且连续 30 秒无新故障才恢复；关闭最后就绪页、停用或撤销取消计时。管理页实时显示页面／桥连接／就绪数，并明确内置工具及共享会话由宿主管理。插件主动断开 port 时撤销页面并计一次故障，宿主正常停用不额外计数。重启偏好验收发现隐藏入口排序显示默认值，现优先读取持久化排序，避免后续编辑覆盖。主 Agent 完成回头自审，未使用独立 Agent review。

新增 Electron 用例以新 renderer 的 `--max-old-space-size=64` 和最多 128 MiB 数组分配触发真实 `render-process-gone: oom`，随后两次握手后强制崩溃累计到 3 并自动停用，宿主仍可操作，另一个插件的页面及只读桥保持正常，故障隔离强化复验日志为 `desktop-crash-isolation-reviewed.log`。真实 Git worktree 切换验证旧页面销毁、稳定 projectId、不同 rootId／revision、KV 隔离及切回恢复，并经真实桥拒绝 junction／hardlink，错误日志可查。复制来源跨启动另验证入口显隐／排序／快捷键偏好。初次检查因 V8 堆报告包含年轻代余量及侧栏列表默认折叠而失败，修正测试假设后新增两项通过；偏好初轮失败对应上述已修复的实际显示问题，单独复验通过，日志分别为 `desktop-closeout-new-reviewed.log` 和 `desktop-preferences-reviewed.log`。

文件系统与迟到响应补验使用真实 OS 文件及句柄：在路径校验后、open 前将父目录 rename 并换为 junction，拒绝 `RESOURCE_CHANGED`；将已打开文件读取延迟到新根实例建立后，旧请求返回 `INSTANCE_CLOSED`，新实例只读新根。它们是确定性检查点单元测试，不冒充桌面时序或所有 OS 并发穷尽证明。相关测试为 `tests/unit/plugin-runtime.test.ts`，收尾后 27 项通过。

收尾完整 `npm run verify` 沿用上述 4 worker、端口及入口环境，日志 `artifacts/plugin-p2/verify-closeout.log`：插件门禁 78 项、主单元 433 份／3779 项通过（6 份／23 项跳过）、llm-core 80 项通过；类型、严格 unused、构建、包边界、主题、i18n、排除清单、Notes 和 lint 均通过，Notes 303／0 错误／17 条既有链接诊断，lint 0 错误／67 条既有警告。桌面首次为 35 项通过、3 项失败、2 项跳过，失败是 Browser／Markdown 的长按关闭和 CPA 悬浮提示；此命令返回 1，不记作本轮完整 verify 一次全绿。

最后的主动断桥修复后，独立输出生产构建及严格 unused／变更范围 lint 通过，使用 `JANUS_E2E_MAIN_ENTRY=artifacts/plugin-p2/closeout-build/main/index.js`、上述 NO_PROXY 执行 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/desktop-cpa.spec.ts --config=playwright.desktop.config.ts --workers=1 --grep 'plugin|copied development|six invalid|three native|real git worktree|global page requires|CPA native page shares' --output=artifacts/plugin-p2/desktop-closeout-final`，11 项全部通过，日志 `desktop-closeout-final.log`。包含全部 8 项插件用例和首轮失败的 3 项回归，未修改那三项用例或其产品代码来绕过；首轮交互失败原因未确证，保留稳定性限制。最后再将最终代码构建到默认 out，日志 `build-closeout-final.log`。收尾各轮合计 39 项不同桌面用例有通过证据，2 项官方资源用例仍跳过；不将分轮结果表述为单次全量通过。

P2／S4 的本地只读范围已完成收尾；架构 AC-10 的多实例仍归 P4，AC-18 的外部服务与必要官方功能通用管理仍归后续，整条 AC 不提前勾选。未生成安装包，未作 macOS／Linux 实机验收。不得从 Windows 上已测的网络样例推导操作系统防火墙级隔离，也不得以这些结果关闭未来贡献、网络代理或正式来源分发的 AC。

## P3 交付与验证

公开清单增加 `workbench`／`island` 视图位置和 `contributes.island`，SDK 增加 `island.update` 及 `ui.island` 权限。工作台复用通用 registry，按需挂载一个隔离根页面；返回时恢复此前有效界面和焦点，中部／右侧 pane 保持。项目选择属于宿主头部，项目或 worktree 变化撤销旧页；蓝图／知识库 ID 与创新开关保留，关闭此前内置工作台后返回会退到普通工作区。

Island 状态／进度／徽标／最多三个动作／受限文本预览由宿主绘制，动作仅引用本插件同 scope 的打开视图命令。主进程绑定发布实例与已批准作用域，检查参数和权限，每插件最多十次更新/秒，100ms 合并，全局最多 32 条活动状态。关闭发布页、重载、故障、停用、数据删除及根撤销清理状态；旧发布页不能清除后来的发布状态，过期动作拒绝。内置通知优先，插件状态不自动抢焦点或展开横幅。展开工具页在选中且 Island 展开后挂载，收起回收；托盘遮挡时 detach 原生页。

仓库外打包 SDK 模板复用两份 HTML 提供四区域视图，用私有 KV／watch 共享状态。专用离线 Session、sandboxed WebContentsView 和主进程 broker 沿用 P2；审批／权限等宿主遮挡租约同时隐藏插件外壳与原生页。内嵌浏览器在工作台或 Island 展示时让位，不结束原有页面或会话。

新增单元测试覆盖清单引用／scope／权限、脚本文本转义、内置通知优先、返回目标失效、最新发布者、旧动作拒绝、关闭／故障／重载撤销、应用与项目隔离、worktree 异步切换前撤销、十次限流、32 条队列及回收后释放容量。外部 SDK 真实安装、typecheck、双页构建和静态校验通过，回执沿用 `artifacts/plugin-p1/scaffold.json`。

`plugins:check` 已将新 `plugin-surfaces.test.ts` 纳入专项门禁，最终重跑五份／92 项通过，含四项 P3 契约与宿主路由／转义／返回测试，日志 `artifacts/plugin-p3-plugin-gate-final.log`。

Windows Electron 专项：设置 `JANUS_E2E_MAIN_ENTRY=out/main/index.js`、`JANUSX_E2E_ENTRY=out/main/index.js`、`NO_PROXY=localhost,127.0.0.1,::1`，执行 `npx playwright test tests/e2e/desktop-plugins.spec.ts --config=playwright.desktop.config.ts --grep 'P3 four surfaces' --workers=1 --output=artifacts/plugin-p3/desktop-third`，1 项通过，日志 `artifacts/plugin-p3-desktop-third.log`。覆盖四区域真实页面、KV 联动、工作台返回及原入口焦点、设置／权限面前让位、Island 文本预览／动作／工具区、原生页实际附着与回收、重载恢复、项目切换与停用清理。初轮发现徽标继承 pointer-events:none，已修复并由真实点击验证；项目切换使用宿主工作台头部选择器。

完整 `npm run verify` 使用四个 Vitest worker 执行，日志 `artifacts/plugin-p3-verify.log`：插件专项 88 项通过，主单元 434 份／3793 项通过、6 份／23 项跳过，LLM 核心 80 项通过；主题、类型、strict-unused、构建、包边界、打包排除及 i18n 通过。在 Notes 门禁处退出 1：执行期间新增的未跟踪 `requirements/entrance-choreography.md` 缺少 AC 冒号且 updated 早于 created，两项均属本批之外并保留未改。P3 维护的五份 Note 单独筛查无错误；全仓仍有 17 条既有跨仓库链接诊断。保留已有 CRLF 文件，使用 `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check` 检查通过。

随后独立补跑 `npm run lint` 与 `npm run test:e2e:desktop`，日志 `artifacts/plugin-p3-lint.log`、`artifacts/plugin-p3-desktop-all.log`：lint 0 错误／67 既有警告，Electron 40 项通过、2 项跳过、0 失败，包含全部九项插件用例、CPA、会话、终端、浏览器、编辑器、备忘录、审批及文件窗口回归。完整 verify 并非一次全绿；代码和桌面验证支持架构 AC-11，但不消除其它 Note 的格式问题。macOS／Linux 和安装包未验收。P3 不开放文档写入、目录遍历、后台任意 JS、网络／凭证、模型、终端类型、CLI／会话适配器、PTY 后端或多实例，不创建独立原生窗口，也不提供跨插件布局引擎。

## P4 只读 viewer 首片

2026-10-23 按“先 viewer、后编辑”的既定顺序交付主窗口嵌入文件编辑器的插件打开方式：清单 viewer 以明确扩展名／文件名匹配已声明 project/workspace 页面，用户可选择并保存／恢复默认。新增独立 documents.read 权限及 documents.viewers/readText 必需能力，旧宿主不误接收新清单；模板 bundle 已支持文档上下文，旧四区域清单继续兼容。具体字段、实例键及限制归[首版契约](../workbench/plugin-contract-v1.md#p4-只读文档查看器)。

主进程按真实项目/root、viewer 和文档路径绑定页面；documents.readText 不接收可变路径，沿用 1 MiB／UTF-8、敏感目录和真实路径保护。文档页可多文件共存，普通 pane 维持 single，KV 按原 project/root 共享。异步挂载增加上下文与激活代次复验，防止重载后迟到挂载复活。viewers 声明进入授权指纹，变化需确认。脏缓冲、diff／导航及浮窗继续内置路径，插件失效回退；只读插件显示期间停用宿主保存按钮和 Ctrl/Cmd+S 写入，避免旧干净缓冲覆盖磁盘新内容。

本片不包含文档写入／事务保存、编辑冲突、自动文件变更事件、受限目录查询、通用多实例 pane、代表内置查看器迁移或浮窗插件宿主，因此不关闭 P4、M2 或架构 AC-10／AC-12。Windows 开发构建为本片验证平台，macOS／Linux 和安装包未验收。本轮为主 Agent 实施与自审，无独立 Agent review。

`npm run plugins:check` 通过六份／103 项，含新增 `plugin-documents.test.ts` 的 11 项，日志 `artifacts/plugin-p4-plugins.log`；覆盖声明／必需能力、权限、选择器、不同文件／普通页身份、任意改路径拒绝、真实文件及 junction 边界、UTF-8／预算、内容版本变化、项目／重载期间迟到挂载拒绝、重新授权、默认偏好和存储失败。门禁实际打包 SDK 并在仓库外安装、typecheck、构建及校验，回执仍为 `artifacts/plugin-p1/scaffold.json`。本片模板四区域清单未扩大权限，桌面夹具在仓库外成品上显式添加 viewer 声明并使用相同 bundle。

真实 Windows Electron 执行：设置 `NO_PROXY=localhost,127.0.0.1,::1`，运行 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-p4/desktop-reviewed`，11 项通过，日志 `artifacts/plugin-p4-desktop-reviewed.log`。包含全部十项插件用例及文件宿主／浮窗迁移；新用例实际验证不同文件隔离页并存、越权路径拒绝、默认选择跨启动恢复、设置面遮挡、外部更新重读、只读页宿主保存拦截、脏缓冲禁止切换、崩溃／停用回退及草稿保留。首轮 P4 单项亦通过，日志 `plugin-p4-desktop-first.log`；最终专项包含后续保存保护补验。完整桌面全集未重跑，不将 11 项表述为全量桌面验收。

完整 `npm run verify` 设置 Vitest threads/forks 上限 4、下限 1，日志 `artifacts/plugin-p4-verify.log`：主题、插件门禁、主类型、LLM 类型及核心构建通过；主单元 434 份／3803 项通过、6 份／23 项跳过，`agent-notes-check.test.ts` 一份／一项失败。唯一失败来源仍为本轮前已存在、未跟踪的 `workbench/requirements/entrance-choreography.md`：缺少 AC 冒号且 updated 早于 created。命令在单元阶段返回 1，后续完整门禁未继续，不记作一次全绿；该 Note 和模块中的既有开场编排变更保留，不并入本片提交。

严格 unused 类型、生产构建、i18n、包边界、打包排除清单和变更范围 ESLint 已独立通过，日志为 `artifacts/plugin-p4-types.log`、`plugin-p4-build-closeout.log`、`plugin-p4-i18n.log`、`plugin-p4-package-boundary.log`、`plugin-p4-exclusions.log`、`plugin-p4-eslint.log`。另补跑 `npm run test:llm-core`，80 项通过，日志 `artifacts/plugin-p4-llm.log`；`npm run lint` 为 0 错误／67 条既有警告，日志 `artifacts/plugin-p4-lint.log`。全仓 Notes 单独检查仍只有上述两处错误，304 份 Note 与 17 条既有跨仓库链接诊断；本片维护的七份 Note 无错误。未生成安装包或测试其它平台。

## P4 草稿交接与写前版本检查

本片在只读 viewer 上增加独立 documents.edit 权限与 documents.applyEdit 必需能力。插件提交基于 SHA-256 的全文草稿，主进程核验绑定和当前磁盘，可信外壳核验干净缓冲并确认；成功仅表示宿主接管未保存内容。模板在仓库外打包 SDK 中独立构建，获准时显示编辑区和交接按钮。用户在内置编辑器审阅后保存，沿用策略授权并校验原磁盘版本；同进程保存串行，冲突保留草稿和基线。切项目、停用、失效回退及整体浮窗迁移使用原 EditorSession，关闭保存失败不关页，关闭对话框遮挡原生页。字段、错误和限制归[草稿契约](../workbench/plugin-contract-v1.md#p4-文档草稿交接与审阅保存)。

这是一份草稿交接及写前版本检查，外部进程仍可在检查与写入之间修改文件，不表述为原子 CAS。持续插件编辑／页面内保存、完整文档事务、冲突合并、自动变更、目录查询及内置 viewer 迁移仍待续，AC-10／AC-12、P4 与 M2 保持未完成。未提交的页面编辑和应用重启恢复不在保证内。本片主 Agent 实施与自审，无独立 Agent review。

本片 Windows 开发构建验证：`npm run plugins:check` 113 项通过，包含五项新增草稿／保存测试和原 viewer 中五项新增权限／交接／生命周期测试，日志 `artifacts/plugin-p4-edit-plugins-retry.log`；门禁实际在仓库外安装打包 SDK、typecheck、构建并校验模板，回执 `artifacts/plugin-p1/scaffold.json`。此前一次插件门禁 112 项通过、旧运行时用例临时目录清理报 ENOTEMPTY，完整重跑 113 项通过，不将首轮记作通过。编辑器七份／41 项回归通过，日志 `plugin-p4-edit-editor.log`；IPC／策略边界两份／7 项通过，日志 `plugin-p4-edit-ipc.log`，覆盖旧保存参数兼容、版本参数转发及权限拒绝先于写入。

真实 Electron 命令：`NO_PROXY=localhost,127.0.0.1,::1 npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-p4-edit/desktop-final`（PowerShell 通过环境变量设置 NO_PROXY），12 项全部通过，日志 `artifacts/plugin-p4-edit-desktop-final.log`。新用例验证真实外部模板提交草稿、不自动写盘、关闭对话框遮挡插件页、取消保留、内置审阅保存、停用回退、外部冲突、保存关闭失败不丢草稿以及浮窗往返后基线仍生效。首轮扩展验收在浮窗 alert 定位上与 Monaco 辅助节点冲突，修正定位后通过；后续为旧 IPC 参数兼容修复重新构建，并补跑新 P4 用例，1 项通过，日志 `plugin-p4-edit-desktop-final-ipc.log`。完整桌面全集未重跑，macOS／Linux 及安装包未验证。

最终全仓单元命令 `npx vitest run --maxWorkers=4 --minWorkers=1`：435 份／3813 项通过、6 份／23 项跳过，只有 `agent-notes-check.test.ts` 一项失败，日志 `artifacts/plugin-p4-edit-all-unit-final.log`。仍由既有未跟踪开场编排 Note 缺少 AC 冒号、updated 早于 created 两项格式错误引起；首轮发现的 IPC 参数与测试替身兼容问题已修复并在最终全仓回归通过。七份本片维护 Note 无新增错误，未修改／提交开场编排 Note 或其模块段落。未运行整条 npm verify，不表述为全绿。

最终 strict-unused 类型、生产构建和全仓 lint 分别通过，日志 `plugin-p4-edit-types-final.log`、`plugin-p4-edit-build-final.log`、`plugin-p4-edit-lint-final.log`；lint 为 0 错误／67 条既有警告。i18n、包边界、排除清单检查通过，日志 `plugin-p4-edit-i18n.log`、`plugin-p4-edit-boundary.log`、`plugin-p4-edit-exclusions.log`。CRLF 及变更范围 diff 检查通过。

## 交付顺序

| 阶段 | 前置条件 | 交付内容 | 阶段出口 |
|---|---|---|---|
| S1 扩展核心与视图协议 | 无阶段前置；实施时盘点现有注册及状态接口 | 稳定扩展与视图 ID、注册与注销、激活与停用、资源清理；中部与右侧贡献接口；应用级／项目级作用域；主题和上下文适配；SDK 类型及最小示例 | 示例可分别打开中部与右侧视图，新增贡献无需修改容器；停用清理入口与资源，未知 ID 恢复不崩溃 |
| S2 内置工具迁移 | S1 出口通过 | 按 S2a 文件树 → S2b Git → S2c 会话管理逐个迁移为内置扩展，替换容器中的工具专属分支，保留稳定身份与既有偏好 | 三个工具通过统一协议注册，行为与布局恢复无回归；不以迁移界面为由改写底层服务 |
| S3 CPA 与双区域验证 | S2 出口通过 | 官方 CPA 集成在中部内嵌既有管理前端；验证全局实例配置与跨项目复用；提供同时贡献中部和右侧视图的最小示例 | CPA 登录、导航、页面打开／关闭验证通过或明确不可嵌入并提供系统浏览器回退；双视图共享状态、停用与恢复验证通过 |
| S4 第三方本地导入与调试 | S3 的通用宿主验证通过 | P0–P2：契约、公开 SDK、基础命令与入口、开发目录、隔离页面、只读桥、管理与调试 | 外部项目独立构建；双区域插件全生命周期、权限、故障和重启恢复通过 |
| S5 插件市场与分发 | S4 出口与发布来源规则通过；SDK 已有兼容基线 | P8：精选目录、包校验、正式安装、权限变化、更新与回退 | 安装、连接与实际可用可区分；来源和不兼容包拒绝，失败保留可用版本 |

S1、S2 优先形成可独立验收的内置扩展基础，不等待市场完成。各阶段按出口进入下一阶段，阶段内部按主 Agent 顺序推进，不安排并行 Agent 或隐含独立评审。

## 后续工作包与参考工作量

| 批次／优先级 | 依赖 | 交付与范围 | 出口及需求追踪 | 参考工作量 |
|---|---|---|---|---|
| P0 契约细化／最高 | S3 与目标设计 | 贡献分类、身份／实例／上下文、权限与开发模式、生命周期、兼容策略；以序列图和契约样例验证 | 架构 AC-2、AC-10 的设计基线；已支持／未来能力清楚，开发目录规则无冲突 | 2–3 有效工作日 |
| P1 SDK 与统一入口／最高 | P0 | 清单 schema、SDK、脚手架、命令与入口注册、可信适配器、能力探测、校验门禁 | 架构 AC-1、AC-4、AC-9；同一命令支持工具箱／快捷键，新增已有类型贡献不改容器 | 3–5 日 |
| P2 本地插件闭环／最高 | P1 | 目录校验与登记、隔离 UI／桥、授权、管理页、启停持久化、日志重载及双区域外部模板 | 架构 AC-2–4、AC-8、AC-10、AC-18；导入 AC-1–6；真实 Electron 全生命周期通过 | 7–12 日 |
| P3 工作台与 Island／高 | P2 | 工作台 registry、隔离根页面、进入／返回；Island 声明式状态／进度／动作、受限预览与展开工具区 | 架构 AC-11；一个插件联动中部、右侧、工作台及 Island，停用回到有效界面 | 5–8 日 |
| P4 文件与文档扩展／高 | P2；排期在 P3 后 | viewer／editor 匹配、默认打开和回退、文档保存与脏状态、受限目录查询；逐项迁移代表内置查看器 | 架构 AC-12；同一文件多实例及外部变更不丢数据，冲突可处理，默认选择可撤销 | 5–8 日 |
| P5 后台、网络与事件／高 | P2；排期在 P4 后 | 已按试验结果采用宿主声明式任务，交付监督、受限网络、凭证引用、公开事件／服务 | 架构 AC-13、AC-14；Windows 开发构建验证，范围及限制见 P5 专节 | 声明式范围已实施；任意后台 JS 及更强沙箱另估 |
| P6 Agent 与领域提供者／中 | P5；读取文档的提供者另依赖 P4 | 内置 Agent 工具／技能／工作流、模型代发、上下文读取；一个代表提供者与公开适配指南 | 架构 AC-15；UI 与 Agent 消费同一领域能力，风险／取消有证据，外部 CLI 支持矩阵明确 | 首个代表实现 6–10 日 |
| P7 窗口与个性化／中 | P3；文档脱离另依赖 P4，Agent 工具卡另依赖 P6 | 可选独立窗口／悬浮工具、主题与配置、角色／皮肤资源、受控对话局部贡献 | 架构 AC-16；窗口恢复、配置隔离、主题回退和敏感界面遮挡通过 | 首个支持平台 5–8 日 |
| P8 正式分发／中 | P2、稳定兼容基线及来源试验；推荐 P4 后 | 正式来源和完整性规则、精选目录、包校验、更新暂存／回退、权限扩大重新授权 | 架构 AC-17；失败不破坏可用版本，正式包不能冒用开发来源规则 | 精选目录首版 6–10 日，来源试验后重估 |

参考工作量不含等待用户素材、外部审核、完整社区市场、多平台全部适配或把全部官方业务迁移为独立包。P5 的强制隔离、P6 的宿主外部 CLI 能力矩阵及 P8 的签名／更新基础设施不预先给出完整工期；不能用扩大权限或减少验收来兑现估算。

### P4a 插件设置基础版（新增）

用户要求插件可扩展设置界面以配置参数。P4a 已交付声明式表单、应用默认／项目与 worktree 覆盖、校验／恢复默认、读取／订阅、旧值诊断和并发版本检查，独立于插件私有 KV；后续片接通插件页面／菜单与可信外壳的自身配置导航，自动展开定位并选择对应配置层。清单、SDK、管理页和外部模板一起验证，追踪架构 AC-19 的基础部分；P5／P6 接入前需有可用配置入口。声明式重命名迁移已接入宿主预览及显式应用，隔离自定义工作台设置页与宿主审阅配置建议已交付，类型转换／历史恢复后续扩展；凭证引用已由 P5 独立加密凭证槽和宿主代用接通，不通过普通配置返回明文密钥。P5 补齐凭证后，AC-19 按既定条件闭合；额外类型转换／历史恢复仍待续。

本片由主 Agent 实施并自检，未进行独立 Agent 审查。`npm run plugins:check` 通过 124 项（含仓库外打包 SDK 的安装、类型检查和构建）；`npm run build:app`、`npm run typecheck:strict-unused`、i18n、包边界及 exclusions 检查通过，lint 为 0 错误、67 条既有警告。证据为 `artifacts/plugin-settings-plugins-reviewed.log`、`plugin-settings-build-reviewed.log`、`plugin-settings-types-reviewed.log`、`plugin-settings-lint-reviewed.log` 与对应检查日志。

Windows Electron 定向回归 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-settings/desktop-reviewed` 通过 13 项，覆盖配置表单、继承、双页面订阅、并发冲突、重启及恢复默认，同时回归已有插件生命周期与文件窗口；日志为 `artifacts/plugin-settings-desktop-reviewed.log`，配置截图位于该输出目录的 P4a 用例子目录 `plugin-configuration.png`。全量 `npm run test:unit -- --run` 为 3824 通过、23 跳过、1 失败，唯一失败是既有 `entrance-choreography.md` 缺少 AC 且 updated 早于 created 所触发的 Note 门禁；`npm run check:notes` 检查 306 篇并报相同两项错误，本片维护文档未新增错误，见 `artifacts/plugin-settings-all-unit-final.log` 与 `plugin-settings-notes-reviewed.log`。未执行整条 `npm run verify`、完整桌面测试、安装包验收及 macOS／Linux 验证。

配置导航增量由主 Agent 实施并自检，未使用独立 Agent 审查。`npm run plugins:check` 125 项通过，含外部打包 SDK 安装／类型检查／构建及新增身份约束、活动状态、共享限流和应用／项目层导航用例；应用构建、严格未使用类型检查、lint（0 错误、67 条既有警告）、i18n、包边界与 exclusions 通过，日志为 `artifacts/plugin-navigation-{plugins-final,build-final,types-final,lint,i18n,boundary,exclusions}.log`。Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-navigation/desktop` 首轮 11 通过、1 项既有项目切回后的页面恢复等待超时；以 `--grep 'external packed SDK plugin completes' --output=artifacts/plugin-navigation/desktop-retry` 单独重跑通过，共 12 个不同用例通过，不记为一次全绿，见 `artifacts/plugin-navigation-desktop.log` 与 `plugin-navigation-desktop-retry.log`。新导航用例实际点击 SDK 及外壳入口，验证项目层、自动展开、原生页移除／恢复及后续保存／冲突／重启继承；截图为桌面输出的 P4a 子目录 `plugin-configuration.png`。Notes 检查仍为 306 篇与既有开场编排两项错误，见 `artifacts/plugin-navigation-notes.log`；本片未重跑全量单测或 verify，未验证安装包、macOS／Linux。

字段迁移增量采用声明式重命名映射及可信管理入口，非插件脚本。主 Agent 实施并自检，未使用独立 Agent 审查。`npm run plugins:check` 127 项通过（8 份测试及独立打包 SDK 安装／类型检查／构建），新增映射合法性、逐层迁移、保护已有目标、类型／作用域拒绝、并发／映射变更使预览失效、订阅通知和落盘重读验证；`npm run build:app`、`npm run typecheck:strict-unused`、i18n、包边界及 exclusions 通过。日志为 `artifacts/plugin-migrations-{plugins-final,build-final,types-final,i18n,boundary,exclusions}.log`。迁移不跨应用／项目／worktree 层，成功项消费旧 key，不支持类型转换、迁移历史／回滚或插件 setter。复杂设置页与 P5 凭证代理继续保留未完成。

迁移增量 lint 为 0 错误、67 条既有警告，见 `artifacts/plugin-migrations-lint-final.log`。最终 Windows Electron 执行 `npx playwright test tests/e2e/desktop-plugins.spec.ts --config=playwright.desktop.config.ts --workers=1 --grep 'P4a' --output=artifacts/plugin-migrations/desktop-final`，2 项通过；验证已有配置导航／保存／冲突／重启，以及升级前分别保存应用与项目值、升级预览不自动迁移、待提交编辑阻止迁移、逐层应用及插件重新读取有效值，日志为 `artifacts/plugin-migrations-desktop-final.log`，预览截图为该输出中迁移用例的 `configuration-migration.png`。Notes 检查 306 篇仍有既有开场编排的缺 AC 与时间倒置两项错误，本片维护文档无新增错误，见 `artifacts/plugin-migrations-notes.log`。未重跑完整桌面集、全量单测或 verify，未验证安装包与 macOS／Linux。

隔离自定义设置页增量已交付。插件可分别声明应用／项目工作台配置页；页面通过 `configuration.propose` 提交带原始版本的建议值，宿主打开普通配置表单供用户审阅并显式保存，提交建议本身不写配置。页面崩溃时普通表单仍可用。新增编辑器映射参与重新授权，旧插件的授权指纹保持兼容；异步校验后再次检查活动状态和共享导航限流。前述迁移增量当时尚未交付的复杂设置页在本片接通，凭证代理仍归 P5；类型转换、迁移历史／恢复及 AC-19 的其余范围保持未完成。

本增量由主 Agent 实施并自检，未进行独立 Agent 审查。`npm run plugins:check` 130 项通过（8 份测试，另含外部打包 SDK 安装／类型检查／构建），覆盖编辑器声明、权限／作用域／类型／版本校验、建议不直接写入、映射变更重新授权、异步校验期间隐藏页面和竞争导航。应用构建、严格未使用类型检查、i18n、包边界及 exclusions 通过；lint 为 0 错误、67 条既有警告。证据为 `artifacts/plugin-custom-settings-{plugins-final,build-final,types-final,lint-final,i18n,boundary,exclusions}.log`。

最终 Windows Electron 执行 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-custom-settings/desktop-final`，15 项全部通过，见 `artifacts/plugin-custom-settings-desktop-final.log`。新用例使用独立打包 SDK 插件，验证隔离配置页、宿主审阅后保存、应用／项目隔离、交接后的竞争写入阻止保存并保留编辑、显式重载丢弃建议及崩溃回退，同时回归插件生命周期与文件窗口。Notes 检查 306 篇，仍有既有 `entrance-choreography.md` 缺少 AC 与时间倒置两项错误，本片维护文档未新增错误，见 `artifacts/plugin-custom-settings-notes-final.log`。未重跑全量单测或整条 verify，未验证安装包与 macOS／Linux。

## P5 声明式后台、网络与事件交付

运行时试验 `node scripts/probe-plugin-background.mjs` 在 Node v24.15.0 权限模式下实际得到文件访问被拒绝、回环网络和环境变量仍可访问，见 `artifacts/plugin-p5-runtime-probe.log`。据既定退出条件，P5 采用宿主声明式任务交付，不加载后台插件 JS，也不把 Node 子进程表述为沙箱。M3 的后台范围据此确定为受监督的有限步骤任务；任意代码运行时另行评估，P6 的 Agent／提供者闭环仍未交付。

P5 已实现无页面包、任务状态／日志／取消／超时／显式重试、应用与项目／worktree 归属、跨项目清理、参与提供者撤销及迟到结果拒绝。网络由宿主限制精确 HTTPS origin、公开 IPv4、DNS 固定、证书校验、同源 GET 重定向与预算；原生插件页保持离线。凭证槽按插件／配置层／根／origin 加密并支持替换、撤销与删除数据，认证调用仅返回状态，防止远端密钥回显；认证响应正文、OAuth 自动刷新、显式代理、IPv6-only 与流式请求不在当前契约。事件／服务具备双方声明、schema／版本／作用域、必需依赖拒绝、可选降级、速率、取消与循环控制，服务输出为消费者所有的 v1 任务记录。两份 manifest-only 示例随独立 SDK 包交付。当前契约与预算归[首版契约](../workbench/plugin-contract-v1.md#p5-后台任务网络与公开协作)。

本轮由主 Agent 实施并自检，无独立 Agent 审查。插件专项 `npm run plugins:check` 覆盖清单／请求边界、无页面任务及生命周期、SDK 调用／取消、任务与嵌套服务预算／截止时间、版本／schema／依赖、事件因果及频率、私网／重定向／迟到响应、凭证加密与重新授权竞争。另以真实生产 HTTPS 传输连接本地 TLS 夹具，验证 DNS 地址绑定后仍使用原域名、可信／不可信证书、请求与 Bearer 注入、64 KiB 拒绝和套接字取消；没有关闭 TLS 校验，夹具证书仅通过测试子进程 NODE_EXTRA_CA_CERTS 信任，不改系统信任或生产策略。实际命令和最终结果见下段。

最终 `npm run plugins:check` 为 10 份／161 项通过，并包含独立打包 SDK 的仓库外安装／类型检查／构建／包校验，日志 `artifacts/plugin-p5-plugins-delivery.log`，SDK 回执 `artifacts/plugin-p1/scaffold.json`。`npm run build:app`、`npm run typecheck:strict-unused`、全仓 lint（0 错误、67 条既有警告）、i18n、包边界与 exclusions 通过，日志分别为 `artifacts/plugin-p5-build-delivery.log`、`plugin-p5-types-complete.log`、`plugin-p5-lint-complete.log`、`plugin-p5-i18n.log`、`plugin-p5-boundary.log`、`plugin-p5-exclusions.log`。新增 P5 专项为 30 项任务／协议／凭证测试及 1 项真实 TLS 传输测试；项目凭证写入在根解析期间遇到重载／重新授权会拒绝，正文上限按 UTF-8 字节计算。

全仓单测首轮 `npx vitest run --maxWorkers=4 --minWorkers=1` 因工作进程 ERR_IPC_CHANNEL_CLOSED 中断，无完整汇总，见 `artifacts/plugin-p5-all-unit.log`，不记为通过。降低并发执行 `npx vitest run --maxWorkers=2 --minWorkers=1` 后，438 份／3861 项通过、6 份／23 项跳过、1 份／1 项失败；唯一失败是既有开场编排 Note 缺少 AC 及 updated 早于 created 所触发的 agent-notes-check，见 `artifacts/plugin-p5-all-unit-reviewed.log`。这些无关内容保持未提交，本轮没有运行整条 verify，不能表述为全仓门禁全绿。

完整插件／文件窗口桌面首轮 17 通过、1 失败，见 `artifacts/plugin-p5-desktop-reviewed.log`。该失败的 trace 明确记录 copied-source 重启时 page.reload 为 ERR_FILE_NOT_FOUND；原因是主 Agent 在该桌面运行尚未结束时重建 out，并非一次有效的稳定产物验收。随后固定最终构建、停止产物写入后重跑，结果在下段记录。最初凭证专项的测试读取方式使用不受支持的动态 import，改为测试进程读取后已通过；不将初始失败记为成功。

最终 Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-p5/desktop-final` 为 18 项全部通过，日志 `artifacts/plugin-p5-desktop-final.log`。新用例实际导入无页面包，验证服务依赖、关设置继续执行、停用提供者取消消费者工作；真实隔离页完成事件订阅／发布与服务任务查询，同时原生网络和未授权代理目标仍被拒绝；宿主输入凭证后验证磁盘无明文、整应用重启可恢复及撤销生效，运行记录不跨重启恢复。原有配置／迁移／自定义页、文档交接、生命周期、OOM／故障熔断、worktree／文件边界、复制安装重启及统一文件窗口一起回归。AC-13、AC-14 与凭证补齐后的 AC-19 按此契约在 Windows 开发构建闭合，P4、P6 与 M3 整体不因此关闭。

`npm run check:notes` 检查 306 篇，仍只有既有开场编排 Note 的缺 AC 与时间倒置两项错误，见 `artifacts/plugin-p5-notes-final.log`，本轮维护文档无新增错误。未运行整条 verify、完整桌面全集、安装包验收或 macOS／Linux 实机验证；没有真实供应商账号或公网可用性验收。当前认证请求只返回状态，配置页不读明文密钥，任意后台 JS 保持未开放；这些范围不能从上述通过项推导为已支持。

## P6 内置 Agent／公开服务首片

本片复用 P5 声明式服务，不开放任意后台或 Agent 插件代码。新增 agent.services 显式授权、内置 Agent 服务发现／调用工具、宿主 run 审批与审计、当前项目／worktree 校验、取消传递与独立结果归属；应用级服务的 Agent 调用也随上下文撤销。SDK 提供固定 HTTPS 的公共状态提供者与普通消费者任务，二者和 Agent 消费同一版本／输入契约。公开适配指南与外部 CLI 插件服务可用性矩阵一起交付；外部 CLI 均未接通 P6 hook，不将既有通知适配误记为插件服务支持。契约和限制归[首版契约](../workbench/plugin-contract-v1.md#p6-首片内置-agent-调用公开服务)。

首片由主 Agent 直接实施与自检，无独立 Agent 审查。首片时模型代发和插件技能尚未实施，现已按后续小节补齐，顺序服务工作流也已交付；文档上下文提供者仍待续；当前会话必须匹配选中项目／worktree，未增加持久会话任务索引。公网状态端点没有真实可用性验收，单元网络为替身，桌面为确定性延时／日志夹具。P6 与 AC-15 保持未完成。

插件专项最终 `npm run plugins:check` 通过 11 份／174 项，包括新增 12 项 Agent 服务测试、无页面 CLI 校验和仓库外 SDK 打包安装／类型检查／构建，日志 `artifacts/plugin-p6-plugins-complete.log`；既有 Agent 工具回归 5 份／31 项通过，日志 `artifacts/plugin-p6-agent-regression.log`。新增测试覆盖授权升级、版本／schema、计划模式拒绝、逐次审批、UI／Agent 响应一致、取消与工具超时、跨 worktree／停用的迟到结果拒绝、提供者页面无权读取或取消 Agent 任务。CLI 原先错误要求无页面包存在 dist，已与宿主的 manifest-only 规则对齐；两份 P6 示例实际通过 CLI check。收尾统一换行曾把 CLI 的 LF 改为 CRLF，触发 Vitest 加载失败（`plugin-p6-plugins-delivery.log`），恢复其原有 LF 并用路径级 .gitattributes 固定后，最终专项通过，不把该失败记作成功。

`npm run build:app`、`typecheck:strict-unused`、包边界、exclusions 与 i18n 检查通过；lint 为 0 错误、67 条既有警告。日志分别为 `artifacts/plugin-p6-build.log`、`plugin-p6-types-final.log`、`plugin-p6-boundary.log`、`plugin-p6-exclusions.log`、`plugin-p6-i18n.log` 与 `plugin-p6-lint-final.log`。

Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-p6/desktop` 首轮 18 通过、1 失败，日志 `artifacts/plugin-p6-desktop.log`。新 P6 用例实际验证工具注册、IPC、plan 拒绝、审批、任务 ID／结果及会话取消；失败的 P4a 用例尚未执行即报 worker process exited unexpectedly，退出码 3221226505，不能宣称整轮全绿。随后对同一稳定构建执行 `--grep "P4a declarative configuration"`，1 项通过，日志 `artifacts/plugin-p6-desktop-config-retry.log`；不将定向复测写成 19 项整轮通过。

`npm run check:notes` 最终检查 308 篇，报既有开场编排 Note 缺 AC／时间倒置，以及无关 island-behavior-system Task 缺 Evidence 共 3 项错误，日志 `artifacts/plugin-p6-notes-final.log`；本片维护 Note 没有新增错误。这些无关工作区内容保持未提交。未重跑全仓单测或整条 verify，未验证完整桌面全集、安装包与 macOS／Linux，也没有公网状态端点或真实模型供应商验收。

## P6 受限文本模型代发交付

本片在 P5 声明式任务中增加 model 步骤、models.generate 显式授权和宿主默认模型适配器，UI 与内置 Agent 可调用同一摘要公开服务。宿主管理密钥、模型选择、容量／并发／频率预算、取消和结果隔离，插件只得到完成文本与回报用量。契约、取舍和费用边界归[受限文本模型代发](../workbench/plugin-contract-v1.md#p6-受限文本模型代发)，可运行示例与指南归 SDK。本片由主 Agent 直接实施、自检，无独立 Agent 审查。

插件专项 `npm run plugins:check` 通过 12 份／195 项，含新增 21 项模型测试、运行时试验与仓库外 SDK 打包安装／类型检查／构建，日志 `artifacts/plugin-model-plugins.log`。模型测试覆盖权限和升级重授权、严格 schema／字符串输入引用、容量、配置变化、输出字节／token／流块限制、未完成响应、凭证原文回显、错误脱敏、取消／超时／迟到结果、并发与频率、UI／Agent 结果隔离。无页面摘要示例通过实际 CLI check。

生产适配器用真实模型 SDK 连接本地 OpenAI 兼容 HTTP SSE 测试服务，新增两项 Electron 验证 UI 文本／用量、Agent 同服务调用、认证头注入且不把密钥放入提示、无工具、请求输出额度、停用关闭请求与密钥回显拒绝。测试不访问付费供应商；Anthropic／无认证路径未作真实端到端验收。模型片时插件技能尚未实施，现已按后续小节补齐，顺序服务工作流也已交付；文档上下文提供者仍待续，P6、AC-15 和 M3 整体保持未完成。

Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-model/desktop-final` 为 21 项全部通过，日志 `artifacts/plugin-model-desktop-final.log`；覆盖新增模型任务、既有 Agent 服务、P5 后台／凭证、配置／自定义页／迁移、文档草稿、隔离生命周期及统一文件窗口。已检查结果展示截图 `artifacts/plugin-model-ui.png`。Agent／配置回归 `npx vitest run tests/unit/llm/janus-agent-ports.test.ts tests/unit/llm/configuration-service.test.ts tests/unit/model-catalog-service.test.ts tests/unit/agent/project-tools.test.ts tests/unit/agent/command-tools.test.ts` 为 5 份／62 项通过，日志 `artifacts/plugin-model-agent-regression.log`。

`npm run build:app`、`typecheck:strict-unused`、i18n、包边界与 exclusions 检查通过；lint 为 0 错误、67 条既有警告。日志依次为 `artifacts/plugin-model-build.log`、`plugin-model-types-final.log`、`plugin-model-i18n.log`、`plugin-model-boundary.log`、`plugin-model-exclusions.log`、`plugin-model-lint.log`。`npm run check:notes` 检查 308 篇，仍有无关开场编排 Note 缺 AC／时间倒置和 island-behavior-system Task 缺 Evidence 三项错误，日志 `artifacts/plugin-model-notes-final.log`；本轮维护文档无新增错误，无关改动不纳入提交。未运行全仓单测、完整桌面全集或整条 verify，未打包安装器，未验收 macOS／Linux 或真实付费模型供应商。

## P6 插件技能资源交付

本片增加 agent.skills 显式授权、严格的内联技能清单、宿主纯文本预览和 plugin.skills／plugin.read-skill 两个 inspect 工具。纯指引包无需页面或任务；服务指引只引用本插件已开放给内置 Agent 的同作用域服务。读取按版本、包修订、项目／worktree、授权与激活代次校验，不执行任务；实际调用仍经过既有 run 审批。内容修改必须重授权，停用禁止新读取，但无法撤回已进入对话的文本。契约和取舍归[技能资源](../workbench/plugin-contract-v1.md#p6-插件技能资源)，可运行的本地状态示例与指南归 SDK。本片由主 Agent 直接实施与自检，无独立 Agent 审查。

`npm run plugins:check` 通过 13 份／217 项，含新增 22 项技能测试、运行时试验与仓库外 SDK 打包安装／类型检查／构建，日志 `artifacts/plugin-skills-plugins-final.log`。测试覆盖权限／旧宿主拒绝、严格字段与文本预算、服务版本／白名单／作用域、纯指引无页面包、只发现元数据、结果 schema 副本、plan 读取与 run 拒绝、输入／修订校验、项目授权／应用级技能的工作区绑定、停用／卸载／开发模式关闭、正文修改重授权、等待根校验时重新激活的拒绝、取消及全局元数据截断。SDK CLI 实际检查包含技能与模型示例。

Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-skills/desktop-final` 为 22 项全部通过，日志 `artifacts/plugin-skills-desktop-final.log`。新增用例实际导入无页面技能包，经设置页查看授权前全文、选定项目后启用，通过注册工具发现／读取同一指引，证明读取未创建任务、plan 不能执行服务、per-action 产生一次审批和独立 Agent 任务结果，停用后目录为空且直接读取失败。已检查纯文本预览截图 `artifacts/plugin-skills-ui.png`。既有模型／Agent 服务、P5 后台／凭证、配置／自定义页／迁移、文档草稿、隔离生命周期及统一文件窗口一起回归。

Agent／配置回归 `npx vitest run tests/unit/llm/janus-agent-ports.test.ts tests/unit/llm/configuration-service.test.ts tests/unit/model-catalog-service.test.ts tests/unit/agent/project-tools.test.ts tests/unit/agent/command-tools.test.ts` 为 5 份／62 项通过，日志 `artifacts/plugin-skills-agent-regression.log`。`npm run build:app`、`typecheck:strict-unused`、i18n、包边界和 exclusions 检查通过；lint 为 0 错误、67 条既有警告。对应日志为 `artifacts/plugin-skills-build.log`、`plugin-skills-types-final.log`、`plugin-skills-i18n.log`、`plugin-skills-boundary.log`、`plugin-skills-exclusions.log`、`plugin-skills-lint.log`。

`npm run check:notes` 检查 309 篇，仍有无关开场编排 Note 缺 AC／时间倒置及 island-behavior-system Task 缺 Evidence 共三项错误，日志 `artifacts/plugin-skills-notes-final.log`；本轮维护文档无新增错误，无关改动保留且不纳入提交。未运行全仓单测、完整桌面全集或整条 verify；未重新打包安装器或验证 macOS／Linux，没有真实供应商网络／模型验收。

技能片时工作流编排尚未实施，现已按下节补齐；文档上下文提供者仍待续，P6、AC-15 与 M3 保持未完成。桌面证据是显式调用真实注册工具与审批链，不代表模型自动选择技能、真实领域网络可达或所有外部 CLI 已接通。

## P6 顺序服务工作流交付

本片通过 agent.workflows 声明已有公开服务为 1–8 个服务步骤的顺序工作流，使用 tasks.inputBindings 映射原始任务输入；UI 与内置 Agent 共用监督和结果格式。复用已有 agent.services 授权和 run 审批，一次执行审批覆盖完整序列；不授予新权限、不插值前序输出、不回滚外部效果。启动前固定全部直接提供者与并发额度，取消／超时／失败跳过剩余步骤，Agent 保持独立任务所有权。契约和取舍归[顺序服务工作流](../workbench/plugin-contract-v1.md#p6-顺序服务工作流)，SDK 提供无页面本地报告示例与指南。

主 Agent 直接实施并按 engineeringX 自检与 review，没有独立评审者，不把自检记作独立审查。Review 关注后续提供者激活改变、失败前缀、共享模型预算和超时状态一致性。启动前预留并固定直接提供者，避免等待中重载后转向新激活；单测实际验证后续提供者停用／重新启用后当前步骤取消、后续步骤跳过。补充的子网络 TIMEOUT 用例先复现父任务 timeout／步骤 failed 不一致，日志 `artifacts/plugin-workflows-review-timeout-before.log`，修复为父／步骤均 timeout；失败是 review 证据，不算通过。最初两项新测试错误地把传输层 URL 参数当作请求对象，已修正替身断言；初轮日志 `plugin-workflows-unit.log` 不记为通过。

`npm run plugins:check` 最终 14 份／245 项通过，含新增 28 项工作流测试、运行时试验和仓库外 SDK 安装／类型检查／构建，日志 `artifacts/plugin-workflows-plugins-reviewed.log`。覆盖严格清单／旧宿主／映射类型与冲突、目录无执行、plan／拒绝审批无副作用、一次审批、UI／Agent 同序列与不同 owner、精确输入／版本／修订、顺序网络输入映射、结果范围和失败前缀、取消／停用／worktree／开发模式／截止、后续提供者固定、optional 直接依赖在副作用前预检，以及嵌套共享的一次模型预算。

Windows Electron 命令 `npx playwright test tests/e2e/desktop-plugins.spec.ts tests/e2e/unified-file-window.spec.ts --config=playwright.desktop.config.ts --workers=1 --output=artifacts/plugin-workflows/desktop-final` 共 23 项全部通过，日志 `artifacts/plugin-workflows-desktop-final.log`。新用例实际导入无页面工作流，经设置授权页预览完整序列及输入映射，UI 运行显示逐步完成；真实注册工具发现精确契约，plan 拒绝执行，per-action 一次审批运行整个序列并产生独立 Agent 结果；会话取消后活动步骤 cancelled、后续 skipped。已检查步骤状态截图 `artifacts/plugin-workflows-ui.png`。既有技能／模型／Agent 服务、P5 后台／凭证、配置／迁移／自定义设置、文档草稿、隔离生命周期与统一文件窗口一起回归。

Agent／配置回归 `npx vitest run tests/unit/llm/janus-agent-ports.test.ts tests/unit/llm/configuration-service.test.ts tests/unit/model-catalog-service.test.ts tests/unit/agent/project-tools.test.ts tests/unit/agent/command-tools.test.ts` 共 5 份／62 项通过，日志 `artifacts/plugin-workflows-agent-regression.log`。应用构建、严格 unused 类型、i18n、包边界和 exclusions 检查通过；lint 为 0 错误、67 条既有警告。对应日志为 `artifacts/plugin-workflows-build-reviewed.log`、`plugin-workflows-types-final.log`、`plugin-workflows-i18n.log`、`plugin-workflows-boundary.log`、`plugin-workflows-exclusions.log`、`plugin-workflows-lint-final.log`。

`npm run check:notes` 检查 309 篇，仍有无关开场编排 Note 缺 AC／时间倒置及 island-behavior-system Task 缺 Evidence 三项错误，日志 `artifacts/plugin-workflows-notes-final.log`；本轮维护文档无新增错误，无关改动不纳入提交。未运行全仓单测、完整桌面全集或整条 verify，未重新打包安装器，未验证 macOS／Linux 或真实外部供应商业务。

文档上下文提供者仍待续，P6、AC-15 与 M3 保持未完成。本片交付有限顺序编排，不代表任意图式工作流、全部传递依赖预检、模型自动选择工作流或外部 CLI hooks 已可用。

### 里程碑与执行顺序

推荐主线为 P0 → P1 → P2 → P3 → P4 → P5 → P6；新增 P4a 的声明式配置基础与隔离自定义设置页已在 P5／P6 前交付，P5 凭证引用已随声明式后台主线交付。P7 是 P3 之后可独立调整优先级的工作包；P8 不依赖全部贡献类型或全部官方功能迁移，在 P2 与来源规则通过后可独立实施，推荐在 P4 形成稳定兼容面后进入。这里的独立表示依赖关系，不安排并行 Agent。

- M1 可开发的本地平台：P0–P2，参考 12–20 有效工作日；另留约 20%–30% 联调与缺陷余量，整体预算约 15–26 日。出口是外部作者完成只读目录插件，不包含工作台、Island、网络、执行或模型开放。
- M2 可组合的工作台：P3–P4，新增约 10–16 日并单独预留回归余量。出口是完整工作台／Island 联动及文件查看／编辑；保留原工作区、浏览器和终端行为。
- M3 有业务能力的平台：P5–P6。后台试验已确定宿主声明式路径，任务、网络／凭证及事件／服务已交付，P6 已接通内置 Agent 公开服务、受限文本模型代发、技能资源与顺序服务工作流，文档上下文提供者待续；任意后台 JS 的更强沙箱另估。不等于所有 CLI 均可深度扩展。
- M4 个性化与分发：P7、P8 分别验收，不合并成一个必须同时完成的版本门槛。社区发布、全部官方包独立更新和多平台覆盖另定增量。

### P0–P2 的执行拆分

P0 先盘点可信 registry、两个视图宿主、工具箱、工作台切换、Island、IPC 与存储的真实消费者，确定命名空间和兼容适配。冻结首版贡献及权限表，给出项目切换、关闭／停用、故障、重载和权限变化的契约样例。全产品类型可以记录在设计中，首版 schema 不假装支持未来类型。

P1 先将命令、入口与视图注册分开，接入工具箱和快捷键。首版普通插件命令限于打开已声明视图及已开放的宿主动作，不暗中引入无页面任意 JS 执行。脚手架在仓库外独立构建，校验非法清单、版本不兼容与越权调用；静态门禁只作辅助，运行时仍必须拒绝越权。

P2 按目录／路径校验 → 只登记不执行 → 隔离资源协议 → 身份绑定通信桥 → 授权与生命周期 → 管理／启停恢复 → 调试／故障熔断 → 外部模板和真实桌面验收推进。开发链接重载需重读权限和资源代次，权限增加先停用或等待重新授权，禁止保留旧通道取得新权限。正式来源安装和用户后台脚本不混入此批。

### 后续工作包的切片

P3 先提供一个工作台根视图，再增加 Island 状态和动作，最后接入受限预览及展开工具区；不先做跨插件布局引擎。P4 先只读 viewer，再接文档保存和编辑冲突。现有蓝图、知识库、备忘录／圆桌仅先接入口及所需服务边界，完整功能迁移按独立验收推进。

P5 已依次完成运行时试验、宿主任务监督、网络／凭证代理和事件／公开服务。试验未满足强制权限契约，按既定分支交付宿主声明式任务，普通后台 JS 保持未开放；M3 后台范围及后续工作量据此调整，不把 Node 子进程视为已满足沙箱。

P6 先选内置 Agent 与一个真实领域提供者，逐步加入工具、模型代发和工作流；外部 CLI 仅记录宿主已有接入能力矩阵，不把 CLI／会话适配器列为第三方提供者候选。P7 先窗口生命周期，再主题／配置，最后角色资源与对话局部位置；不以自定义皮肤授予会话访问。P8 先验证发布来源与完整性，再做精选目录和更新；ZIP、签名、远程源与社区投稿分别验证后开放。

### 验收与记录

每批记录实现范围、需求 AC、相关单元／真实组件／Electron 证据、资源基线和未覆盖平台。共享容器变更覆盖旧工具 ID、宽度、快捷键、项目切换、未保存内容、浏览器遮挡和会话不被关页终止。P2 测真实隔离及开发模式关闭；P3 测工作台返回和 Island 队列；P4 测保存冲突；P5–P6 测取消与迟到结果；P8 测更新失败回退。脚手架示例不引用私有源码，示例业务选择不阻塞契约细化。

范围、工期或运行模式因试验变化时，先更新本计划和所属需求，再实施下一批。所有未执行 AC 保持未勾选，设计维护不产生实现通过证据。

### S2 迁移验收重点

- S2a 文件树：保留目录展开、搜索、文件打开、拖拽、现有写操作授权，以及项目切换后的正确归属；停用视图不遗留其订阅和监听。
- S2b Git：保留变更查看、暂存、提交、历史与远端操作，状态跟随项目；插件视图生命周期不重复创建监听或修改既有写入授权。
- S2c 会话管理：保留列表、筛选、打开与导航、相关实验开关和状态恢复；关闭面板不终止正在执行的会话，不改变会话持久化和 CLI 的原生交互。
- 三次迁移分别记录受影响的单元、界面及真实桌面检查证据，覆盖顺序、图标、快捷键、宽度偏好、快速开关、错误重试和已有其他工具；不以浏览器替身检查替代桌面验证结论。

### S3 CPA 范围

CPA 作为官方推荐集成候选，主要用于账号额度及重置次数、时间等信息查看；转 API 按需配置。优先复用现有管理界面，不重建完整原生账号面板。具体前端和各供应商字段覆盖需核实，调用统计不能替代供应商剩余额度。

双区域示例用于验证宿主能力，不要求 CPA 首版实现原生右侧额度摘要。初始 S3 未包含托管下载、升级与进程管理；用户后续明确选择首次启用下载，已按末节补充交付。完整原生额度摘要仍不在范围内。若所选管理前端无法内嵌，需先明确调整 CPA 交付范围；浏览器回退不能作为“内嵌已验收”的证据。

### S4 与 S5 的进入条件

本地开发和正式来源分开：S4 计划通过默认关闭的开发模式加载用户选择且授权的未签名隔离页面，复制目录仍为开发来源；关闭模式阻止其继续激活。开发模式外拒绝相同未签名目录自动执行并记录原因，不执行原生 Node 或宿主 renderer。架构 AC-2 与导入需求已按该语义对齐。P0 细化规则，P2 已实现对应生命周期并通过真实桌面重启／来源测试；其余未覆盖面见本页交付证据。

S4 首批第三方网络、凭据、写入、终端与模型后端仍不开放；后续能力按 P4–P6 的专项契约增加，不倒填首版已具备。CPA 官方集成不能成为绕过第三方权限边界的样板。S5／P8 确定来源审核、完整性验证、更新与回退；签名和确认界面不能替代运行时授权，也不承诺当前已支持签名。

## 后续接入

Figma 保留为后续服务集成候选，围绕项目设计链接、所选 CLI 的 MCP／Skills 接入及服务授权单独定范围，不阻塞本地平台。全产品设计与 P3–P7 覆盖更广的贡献类型，但不自动包含任意视图拖动换区、跨容器迁移、工作台拼装他插件面板或全部视图后台保活；这些能力待真实工作流证明需求后另排增量。

## S1 交付与验证

可信扩展通过一个定义贡献中部页面和右侧面板，入口由宿主自动生成；示例见 `src/renderer/src/extensions/examples/workspace-tools.tsx`，使用方法见同目录上级的 `README.md`。示例不在生产中自动启用。项目页面按项目快照恢复，项目右侧视图切换时重挂载；应用级中部页面随当前项目转移，快照不复制其身份。跨项目或容器重挂载后需要保留的业务状态由扩展自己的状态存储管理，当前不增加页面磁盘持久化。

停用或注销清理中部活动树、后台项目快照和右侧打开集合；清理函数异常仍移除贡献，重新启用得到新挂载身份。单视图渲染错误使用局部错误边界，注册订阅者异常不阻止其他订阅者收到更新。已有内置工具 ID 和宽度偏好保持兼容。

验证：`npx vitest run tests/unit/extensions.test.ts tests/unit/right-tool-state.test.ts tests/unit/right-tool-dock.test.ts tests/unit/workspace-pane.test.ts tests/unit/workspace-front-surface.test.ts tests/unit/workspace-remote-terminal-sync.test.ts tests/unit/workspace-sidebar.test.ts tests/unit/side-panel-collapse-ui.test.ts` 共 121 项通过。浏览器真实组件测试 `tests/e2e/extensions.spec.ts` 5 项通过，覆盖纸面／深色主题、双区域状态、项目隔离和恢复、菜单与关闭、停用／注销清理及错误隔离；原有 `pane-tab-drag` 与 `right-dock-motion` 25 项通过。曾复现全局页面插入抢走项目 Tab 的选中态，已修复并补回归用例。浏览器使用 IPC fallback，不作为真实 Electron 集成结论。

严格类型检查、变更范围 ESLint、`npm run build:app`、包边界、i18n 与 Notes 检查通过。真实 Electron 回归 `npx playwright test tests/e2e/desktop-smoke.spec.ts --project=desktop --workers=1 --grep 'built desktop' --output=artifacts/extensions-s1/desktop` 1 项通过，覆盖既有工作区、终端及右侧工具关键路径；新扩展本身的双视图验证仍为前述浏览器组件测试。主题 CSS 生成检查通过；全仓主题审计在本轮未改的 `AboutSettingsPanel.module.css:132` 和 `:133` 报两处固定颜色，未修改其他功能来消除此失败。第三方隔离、清单权限校验、独立发布的 SDK 包与脚手架仍待后续阶段，不能据此宣称完整插件平台已完成。

## S2 交付与验证

S2a 文件树、S2b Git、S2c 会话管理统一在 `extensions/builtins.tsx` 声明：扩展身份为 `janusx.files`、`janusx.git`、`janusx.sessions`，各贡献一个右侧 `panel`。适配层将命名空间视图映射回 `files`、`git`、`sessions`，避免重复面板并保留调用入口、快捷键及 `janusx:right-tools:v1` 宽度偏好。顺序、图标、翻译键、宽度配置与会话实验开关跟随定义。停用卸载视图并移除入口，重新启用保持关闭，宽度仍保留；应用重启仍默认启用内置扩展，本阶段未增加插件管理页或停用状态持久化。

元数据在偏好恢复前注册，业务组件按需加载，避免注册表、组件与 store 的循环初始化。三个内置外壳使用应用级挂载身份，继续通过既有 store 读取项目／worktree；这样保留原来的空项目界面与切换项目时的局部 UI 状态。宿主服务及其后台监听继续运行，视图自身订阅、定时器和 DOM 监听随原组件卸载清理。右侧所有贡献共用原有重试／关闭错误边界；关闭或停用会话视图不终止 PTY，也不修改会话记录。

单元验证：`npx vitest run tests/unit/builtin-extensions.test.ts tests/unit/extensions.test.ts tests/unit/right-tool-state.test.ts tests/unit/right-tool-dock.test.ts tests/unit/workspace-pane.test.ts tests/unit/workspace-front-surface.test.ts tests/unit/workspace-remote-terminal-sync.test.ts tests/unit/workspace-sidebar.test.ts tests/unit/side-panel-collapse-ui.test.ts tests/unit/file-tree-utils.test.ts tests/unit/file-tree-drag.test.ts tests/unit/file-tree-move.test.ts tests/unit/file-tree-refresh-pressure.test.ts tests/unit/git-store.test.ts tests/unit/session-continue-resume.test.ts tests/unit/external-session-sync.test.ts` 共 176 项通过。覆盖三种工具的兼容 ID、重复打开、停用／启用、宽度保留、会话开关，以及既有文件、Git 和会话逻辑。

浏览器验证：`npx playwright test tests/e2e/builtin-extensions.spec.ts tests/e2e/extensions.spec.ts tests/e2e/right-workspace-design.spec.ts tests/e2e/right-dock-motion.spec.ts tests/e2e/right-tool-tooltips.spec.ts --project=island --workers=1 --output=artifacts/extensions-s2/browser` 首轮 16 项通过、1 项因按钮定位器失败；修正定位器及补齐语言设置 IPC 测试桩后，重跑 `builtin-extensions.spec.ts` 的 2 项通过，结果在 `artifacts/extensions-s2/browser-fixed`，合计 17 项不同用例通过。覆盖文件搜索保留、Git 暂存调用、三个扩展停用及重开、两套主题与窄宽面板、双区域示例、错误隔离，以及会话失活／关闭／开关／停用时订阅归零、重开不累积和项目归属。随后增强 `extensions.spec.ts` 的错误用例，实际点击重试恢复视图，单项通过，证据在 `artifacts/extensions-s2/retry`。浏览器使用 IPC fallback。

桌面验证：构建后运行 `npx playwright test tests/e2e/desktop-smoke.spec.ts tests/e2e/desktop-session-continue.spec.ts --project=desktop --workers=1 --grep 'built desktop|Continue in New Session mints' --output=artifacts/extensions-s2/desktop`，2 项通过。真实 Electron 覆盖文件树、Git、工作区与终端关键路径，以及会话继续／恢复。新增检查关闭会话面板后向已有 PTY 发送标记，测试 CLI 收到输入且会话记录保留，重开恢复列表。CLI 为隔离的测试进程，不访问真实供应商账号；本轮未对真实远端执行 push／pull。

严格类型检查、生产变更范围 ESLint、应用构建、包边界、i18n 与 Notes 检查通过；Notes 为 315 份、0 错误，另有 17 条显式外部链接诊断。主题生成检查通过，全仓主题审计仍被未改动的 `AboutSettingsPanel.module.css:132`、`:133` 两处固定颜色阻断。AC-6 按以上迁移和回归证据完成；CPA 内嵌、第三方加载与市场继续归 S3 至 S5。

## S3 交付与验证

CPA 通过 `janusx.cpa` 注册应用级中部页面，设置的“应用设置 → 服务集成”保存已有实例的管理页地址并打开页面，中部 `+` 菜单也提供入口。使用原生网页承载原版管理前端，复用原浏览器的加载错误、重试与对话框遮挡机制；保留系统浏览器入口。S3 初始交付连接已有实例，后续按用户确认补充下节本地托管；仍不新增 JanusX 模型 API 配置或原生额度摘要。

初始交付的已有实例模式全局配置只存地址，管理密钥由原前端处理，按 origin 隔离的持久分区保留其登录；跨项目复用同一原生页面，关闭释放视图，重启可恢复前端自己记住的登录。页面无 preload、Node 或宿主桥，原生浏览器仅通过内部选项配置独立分区及 HTTP(S) 导航限制。后续托管增加的配置与密钥职责见末节及[服务集成](../workbench/service-integrations.md)，不据此完成第三方权限验收 AC-8。

单元验证：`npx vitest run tests/unit/cpa.test.ts tests/unit/browser-surface-manager.test.ts tests/unit/browser-ipc-contract.test.ts tests/unit/browser-occlusion.test.ts tests/unit/builtin-extensions.test.ts tests/unit/extensions.test.ts` 共 80 项通过，覆盖地址和 IPC 边界、只保存地址、并发打开、重复保存、关闭重开、分区变化、系统浏览器调用和受限导航，日志为 `artifacts/cpa-s3-unit.log`。

浏览器验证：`npx playwright test tests/e2e/extensions.spec.ts tests/e2e/builtin-extensions.spec.ts --project=island --workers=1 --output=artifacts/cpa-s3/browser` 共 7 项通过。复用 S1 双区域示例，覆盖中部／右侧共享状态、项目隔离与恢复、主题、停用／注销清理和错误恢复；内置工具回归通过。此组使用 IPC fallback。

真实 Electron：`tests/e2e/desktop-cpa.spec.ts` 的本地页面用例验证跨项目同一 guest、独立网页登录、无宿主桥、对话框遮挡、HTTP 弹窗标签、关闭释放和应用重启后登录恢复。原版 CPAMC v1.26.5 用例验证渲染、登录、配额页导航及刷新恢复，使用校验 SHA-256 的上游单文件前端与本地模拟管理 API；没有真实供应商账号或 OAuth 证据。原有 `desktop-smoke.spec.ts` 的 `Browser load failure` 用例通过。原版前端和浏览器回归结果位于 `artifacts/cpa-s3/desktop-final`，生命周期最终结果位于 `artifacts/cpa-s3/desktop-lifecycle`。运行原版用例需设置 `JANUSX_E2E_CPA_HTML` 与 `JANUSX_E2E_CPA_SHA256`；默认无资源时显式跳过，不联网下载。最初失败的预期及定位器已修正，不作为通过证据。

严格类型检查、生产变更范围 ESLint、`npm run build:app`、包边界、i18n 和 Notes 检查通过；Notes 为 315 份、0 错误、17 条显式外部链接诊断。主题生成检查通过，全仓主题审计仍在未改动的 About 页报上述两处固定颜色。S3 出口限定为管理前端与通用宿主验证，实际后端及供应商额度兼容性需连接部署实例再核对；S4 进入前仍须解决本计划所列开发目录与正式发布信任规则。

## S3 补充：本地 CPA 托管

用户已选择首次启用下载、自定义端口、自动更新，并认可 CPA 随 JanusX 运行。本地托管与已有实例两种模式已交付，旧地址配置继续归已有实例。托管初始未启用，启用保存或按需打开时准备组件并启动，关闭页面保持服务，停用或应用退出停止自有进程。支持端口校验、占用提示、运行状态、停止／重启、立即更新、日志及加密管理密钥的显式复制。配置、账号目录与版本文件分开，主安装包不包含 CPA 二进制。产品边界和平台限制归[服务集成](../workbench/service-integrations.md)。

组件从固定官方仓库选择支持主版本的稳定资源并校验 GitHub SHA-256 digest，限制解压文件，保留许可证。自动更新每日检查并暂存，下一次 CPA 启动时应用；立即更新会重启。新版本启动失败尝试保留的当前版本，恢复启动前配置，账号不参与覆盖。受控托管不提供第三方本机执行权限，AC-8 保持未完成，S4 的信任规则仍须独立确定。

单元验证：`npx vitest run tests/unit/cpa.test.ts tests/unit/cpa-installer.test.ts tests/unit/cpa-runtime.test.ts tests/unit/app-shutdown.test.ts tests/unit/browser-surface-manager.test.ts tests/unit/browser-ipc-contract.test.ts tests/unit/extensions.test.ts` 共 101 项通过，日志 `artifacts/cpa-managed-unit.log`。覆盖摘要与来源、归档过滤、取消、组件篡改、版本保留／清理、端口冲突、加密存储不可用、幂等启动、密钥复用及并发生成、退出竞态、更新暂存、失败回退及原浏览器和扩展回归。更新跨版本与下载失败为单元替身证据，不等于真实未来版本升级兼容性。

桌面验证：构建后设置 `JANUSX_E2E_CPA_ZIP`、`JANUSX_E2E_CPA_HTML` 与 `JANUSX_E2E_CPA_SHA256`，运行 `npx playwright test tests/e2e/desktop-cpa.spec.ts tests/e2e/desktop-smoke.spec.ts --project=desktop --workers=1 --grep 'CPA|CPAMC|Browser load failure' --output=artifacts/cpa-managed/desktop-final`，4 项通过。密钥并发生成修复后，以 `--grep 'managed CPA' --output=artifacts/cpa-managed/desktop-key-final` 重跑托管用例，1 项通过。新托管用例替换网络传输为本地校验资源，但生产安装器、提取、safeStorage、真实 Windows CPA 8.0.31、CPAMC 1.26.5 与进程托管原样执行；验证设置页首次启用、原前端登录／配额导航、关闭页继续运行、修改端口、冲突不结束外部监听、应用退出后端口释放及整应用重启后的密钥与账号目录测试文件保留。未接入真实供应商账号，未验证 OAuth、额度、强杀全部进程或已签名安装包；网络资源曾实际下载并校验，但桌面用例不衡量 GitHub 可达性。

浏览器回归 `extensions.spec.ts` 与 `builtin-extensions.spec.ts` 7 项通过，结果在 `artifacts/cpa-managed/browser`。严格类型检查、生产变更范围 ESLint、构建、i18n、包边界和 Notes 检查通过；全仓主题检查仍被未改动的 About 页两处固定颜色阻断。Windows 子进程仍继承父进程权限，未实现降权；macOS／Linux 下载分支未作真实启动验收，不能从 Windows 结果推导跨平台完成。

本地管理密钥现支持自定义、显示／隐藏及随机生成草稿，留空保留原值；具体约束和持久化边界归[服务集成](../workbench/service-integrations.md)。`npx vitest run tests/unit/cpa.test.ts tests/unit/cpa-runtime.test.ts tests/unit/cpa-installer.test.ts tests/unit/browser-ipc-contract.test.ts` 共 62 项通过，日志 `artifacts/cpa-custom-key-unit.log`，覆盖密钥校验、停止后修改、加密失败保留原值、生成失败可重试及重建运行时复用。设置上述三个资源环境变量后，`npx playwright test tests/e2e/desktop-cpa.spec.ts --project=desktop --workers=1 --output=artifacts/cpa-custom-key/desktop` 共 3 项通过，日志 `artifacts/cpa-custom-key-desktop.log`。真实 Windows 托管用例新增首次自定义、随机生成／显示切换、同端口修改后旧密钥 401／新密钥 200、新密钥原版前端登录、输入清空及整应用重启后复用，账号目录测试文件保留，设置 JSON 与 CPA YAML 均无明文管理密钥。设置页截图已检查；网络仍用本地校验资源，不含真实供应商账号。最终构建、严格类型检查、生产变更范围 ESLint、i18n、包边界和 Notes 检查通过，本轮未重新打包 exe。

## 托管 OAuth 回调兼容

Codex、Claude、Antigravity 在托管页面发起授权前预检固定回调端口，不可用时复用原前端的手动回调；核对过的授权端点交给系统浏览器。实现与竞争窗口、已有实例边界归[服务集成](../workbench/service-integrations.md)。不改系统端口排除、不终止用户进程、不改上游二进制，也不接管账号令牌。

`npx vitest run tests/unit/cpa-oauth.test.ts tests/unit/cpa.test.ts tests/unit/cpa-runtime.test.ts tests/unit/browser-surface-manager.test.ts tests/unit/browser-ipc-contract.test.ts` 共 107 项通过，日志 `artifacts/cpa-oauth-unit.log`。覆盖三种供应商端口、可用时保留自动流程、限制／占用／探测失败、无关请求不改写、关闭中探测取消、真实监听探测、授权端点边界、系统浏览器失败与关闭后迟到失败不污染状态。严格类型、生产变更范围 ESLint、应用构建、i18n 和包边界通过，对应 `artifacts/cpa-oauth-*.log`；Notes 检查 315 份、0 错误、17 条已有外部链接诊断。

设置本节前述三个官方资源环境变量，`npx playwright test tests/e2e/desktop-cpa.spec.ts --project=desktop --workers=1 --output=artifacts/cpa-oauth/desktop-final` 共 3 项通过，日志 `artifacts/cpa-oauth-desktop-final.log`。真实 Windows CPA 8.0.31 和原版 CPAMC 1.26.5 在 1455 系统限制下成功生成授权链接，证明同源请求改写后仍通过管理认证；实际点击原页面链接，主进程替换的 shell 记录外部交接且 guest 标签不增加。原页面提交测试用 `access_denied` 回调后后端进入失败状态，不匹配 state 和供应商被拒绝，新的待授权会话可取消；关闭后兜底提示清空，原密钥轮换、修改端口、重启、账号目录保留及已有实例两项回归通过。已检查宿主提示与原页回调表单两张截图。此测试没有打开真实供应商登录页或成功换取令牌，不能作为真实供应商登录／额度验收。最初的定位器错误和一次测试 worker 异常不作通过证据。本轮未重新打包 exe。

## 托管 CPA 继承 JanusX 代理

按用户选择直接复用宿主代理，不增加独立网络设置；启动时传入共享检测结果与回环地址绕过规则，清除 CPA 自有全局代理覆盖，重启读取新值。实现与凭据交接边界归[服务集成](../workbench/service-integrations.md)。

`npx vitest run tests/unit/cpa-runtime.test.ts tests/unit/cpa.test.ts tests/unit/cpa-oauth.test.ts tests/unit/llm-proxy-refresh.test.ts` 共 78 项通过，日志 `artifacts/cpa-proxy-unit.log`。覆盖有效代理优先、共享系统检测、重启读取变化、无代理不携带旧值、保留并合并 NO_PROXY、补齐回环直连、父环境不变、无关秘密不继承、代理认证不进入配置或状态，以及 CPA 原全局代理覆盖清理。严格类型、范围 ESLint、应用构建及包边界检查通过，对应日志 `artifacts/cpa-proxy-{typecheck,eslint,build,boundary}.log`。

设置上述官方 ZIP、HTML 和摘要环境变量后，`npx playwright test tests/e2e/desktop-cpa.spec.ts --project=desktop --workers=1 --output=artifacts/cpa-proxy/desktop` 共 3 项通过，日志 `artifacts/cpa-proxy-desktop.log`。Electron 测试进程携带本地测试代理环境，真实 CPA 8.0.31 用新建会话及合成授权码进入令牌交换，测试代理收到 `CONNECT auth.openai.com:443` 并主动返回 502，CPA 随后发布认证失败状态；代理不连接上游，未访问真实账号或换取令牌。管理登录、原页手动回调、已有实例、密钥轮换、端口修改及应用重启回归通过。此证据确认环境代理实际参与令牌交换，不能保证真实网络出口被供应商接受。本轮未重新打包 exe。

## CPA 统一代理与授权提示生命周期

已修复仅环境代理导致管理 `requests/api-call` 直连的遗漏：托管全局配置和子进程环境指向本地认证转发入口，额度、订阅、重置次数、HTTP／WebSocket 执行及授权共用 JanusX 有效出口，既有显式请求／账号覆盖遵循 CPA 优先级。首次下载与自动更新也使用相同转发方式。回环管理页和本地控制请求固定直连；共享 HTTP 钩子保留显式 agent，Undici 调整为与内置 fetch 兼容的 7.x。授权提示绑定当前会话，成功／失败／取消／超时后清除；详细边界与取舍归[服务集成](../workbench/service-integrations.md)。

`npx vitest run tests/unit/cpa-proxy.test.ts tests/unit/cpa-runtime.test.ts tests/unit/cpa-oauth.test.ts tests/unit/cpa.test.ts tests/unit/cpa-installer.test.ts tests/unit/llm-proxy-refresh.test.ts` 共 110 项通过，日志 `artifacts/cpa-routing-unit-final2.log`。`npm run test --workspace=@janusx/llm-core -- --run` 共 76 项通过，日志 `artifacts/cpa-routing-core-final.log`。新增证据包括代理认证、新连接切换出口、NO_PROXY 域名／端口／IPv4／IPv6 网段、回环直连、启动与停止竞争、完整 HTTPS 响应和证书校验、真实内置 fetch、首次下载取消与体积限制，以及授权成功／失败／取消／超时／迟到结果。主项目严格类型、llm-core 类型与构建、范围 ESLint、应用构建和包边界检查通过，日志 `artifacts/cpa-routing-{typecheck-final2,core-typecheck,core-build,eslint-final2,build-final4,boundary-final}.log`。llm-core 老文件直接套根 ESLint 有既有 any／require 规则错误，本次未清理这些历史写法；范围 ESLint 限 `src/main/cpa`。

设置前述官方资源变量，`npx playwright test tests/e2e/desktop-cpa.spec.ts --project=desktop --workers=1 --output=artifacts/cpa-routing/desktop-complete` 共 3 项通过，日志 `artifacts/cpa-routing-desktop-complete.log`。真实 CPA 8.0.31／CPAMC 1.26.5 验证原回调失败与取消后提示清除、同一代理收到令牌和 HTTPS 额度 CONNECT；向隔离账号目录上传合成 Codex 凭据，再由真实管理接口解析 authIndex 与 `$TOKEN$`，四条额度／订阅／重置查询与消费请求经本地 HTTP 模拟出口返回 200。已有实例、网页登录持久化、自定义密钥、端口变更、账号目录保留与退出释放回归通过。此证据不等于真实供应商额度或消费验收。尝试隔离 TLS 供应商时被 Windows Go 的系统证书校验拒绝，未改系统信任或关闭 TLS；成功状态清除有单测，真实 CPA 成功令牌交换／刷新未自动验收。初次构建产物竞争及后续诊断失败不计入通过证据。本轮未重新打包 exe。
