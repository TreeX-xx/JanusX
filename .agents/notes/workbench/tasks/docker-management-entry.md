---
{
  "schema": "harness-note/2",
  "id": "f4a76b28-1796-44dc-9f03-6f3bded72f27",
  "kind": "task",
  "lifecycle": "accepted",
  "created": "2026-10-13",
  "class": "feature",
  "tags": ["docker","portainer","browser","workbench","titlebar"],
  "work": {
    "scope": [
      {
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "paths": [
          "src/renderer/src/components/Titlebar.tsx",
          "src/renderer/src/App.tsx",
          "src/renderer/src/stores/workspace.ts",
          "src/renderer/src/lib/workspace-pane.ts",
          "src/renderer/src/components/browser/",
          "src/renderer/src/components/AppSettingsModal.tsx",
          "src/main/browser/",
          "src/main/windows/browser-window.ts",
          "src/main/ipc/browser-handlers.ts",
          "src/renderer/src/i18n/locales/",
          "tests/unit/",
          ".agents/notes/"
        ]
      }
    ],
    "acceptanceRefs": [
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-1"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-2"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-3"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-4"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-5"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/f4a76b28-1796-44dc-9f03-6f3bded72f27","criterionId":"AC-6"}
    ],
    "verification": [
      {
        "id": "V-1",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npm",
        "args": ["run","typecheck"]
      },
      {
        "id": "V-2",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npx",
        "args": ["vitest","run","tests/unit/browser","tests/unit/workspace"]
      }
    ],
    "review": "self"
  },
  "updated": "2026-10-29T06:52:35Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# Docker 管理入口实现（Portainer CE）

> 当前接续：2026-10-29 已确认改为可选安装的 Docker 官方插件，应用级单实例面板从工具箱打开，复用 extension pane，不再新增 Docker 专用 pane 类型。当前设计与 D0–D5 计划归[Docker 官方插件](../docker-management-entry.md)。本 Task 保留 Portainer 历史范围、验收状态与执行证据，不作为新插件的实施或验收任务；下文为历史记录。

> 2026-10-14 转向：Portainer 接入方向已放弃，改为自研首版基本能力，见[Docker 面板入口](../docker-management-entry.md)的 Decisions。P2/P4/P5/P6 属 Portainer 承载、部署引导、证书信任与兼容性验证，随转向**取消**（AC-2/AC-4/AC-6 一并作废）；P1 顶栏全局工具入口与 pane 树放宽仍然有效，其中 Docker 图标与环境下拉已移除，顶栏现余浏览器与 Markdown。

## Goal

依据[Docker 管理网页的工作台入口](../docker-management-entry.md)的定稿设计，交付顶栏全局入口（与终端解耦）、Portainer CE 完整网页承载、多地址管理与部署引导默认（CE LTS + 9443 自签）。首版不自研 Docker 管理界面，实际功能范围由所接入的 Portainer CE 版本提供。本 Task 与 [Git Bash 与自定义 Shell 终端管理实现](../../terminal/tasks/gitbash-shell-terminal-management.md)相互独立，可分开执行。

## Scope

P1 顶栏全局工具入口：Titlebar 常驻浏览器 + Docker 两个图标（与设置、工作台切换器同排）；点击语义与终端解耦——处于蓝图模式先翻回工作区正面，处于空白页或终端选择页直接呈现 pane 树，已有管理标签激活否则新建；`showWorkspacePane` 呈现条件从“有终端”放宽为“有 pane 内容（终端或浏览器）”，允许只含浏览器 pane 的工作区。

P2 Docker 管理承载：Docker 图标打开已配置当前地址的 Portainer 完整网页于中央工作区浏览器标签（pane 完整空间，复用内置浏览器的分屏与独立窗口能力）；重复点击优先激活已有管理页；连接失败提供重试、修改地址与部署帮助，且不据此判定引擎或 Portainer 容器状态。

P3 地址管理：设置保存多地址列表（名称、URL、测试连接、在外部浏览器打开、设为当前）；顶栏 Docker 图标主体打开当前地址，旁边下拉箭头提供临时切换，选中即设为当前并载入管理页。

P4 部署引导：本机有 Docker、无 Portainer 时提供部署引导（Portainer CE LTS、9443 HTTPS、自签证书默认）；无 Docker 时提供平台安装引导；首版不自动安装 Docker、不自动部署 Portainer；仅管理远程环境时不要求本机安装 Docker 或 Docker Desktop。

P5 自签证书信任：内置浏览器侧（Electron 证书校验层，如 `setCertificateVerifyProc` 一类）信任 Portainer 自签证书，管理页可正常打开。

P6 兼容性验证：登录态保持、实时日志、容器控制台、文件上传下载、证书处理在内置浏览器中实测并记录。

## Acceptance criteria

- [x] AC-1: 顶栏常驻浏览器与 Docker 两个全局图标；点击与终端解耦：蓝图模式翻回正面、空白页与终端选择页呈现 pane 树、允许纯浏览器 pane 不建终端、已有 tab 激活否则新建。（已交付；Docker 图标已于 2026-10-14 随转向移除，浏览器入口保留同一语义。）
- [x] AC-3: 设置保存多个管理地址（名称、URL、测试连接、外部浏览器打开、设为当前）；顶栏主体打开当前地址，下拉临时切换并设为当前载入。（已交付；2026-10-14 随转向移除，自研首版不做远程环境，多地址管理随之失去用途。）
- [x] AC-5: 边界守住：不自动安装 Docker 或 Portainer、不自研容器操作、引擎状态诊断、Docker Desktop 启动控制与 worktree 到 Compose Stack 联动；仅远程管理不要求本机 Docker。（已守住；其中"不自研容器操作"一条已被 2026-10-14 的用户决策推翻，新的边界见 Docker 面板入口的首版不做清单。）
- [ ] AC-2: **取消**（2026-10-14）：Docker 图标在中央工作区打开 Portainer 完整网页标签；重复点击激活已有管理页；连接失败提供重试、修改地址与部署帮助，不误判引擎或容器状态。Portainer 承载整体放弃，改自研 pane 内容类型。
- [x] AC-4: 部署引导默认 Portainer CE LTS、9443（HTTPS）、自签证书；自签证书经内置浏览器信任处理后可直接访问管理页。**已作废**（2026-10-14）：P5 代码已落地但从未在真实 Electron 验证，随转向删除；自研面板不再需要为第三方网页信任自签证书。
- [ ] AC-6: **取消**（2026-10-14）：兼容性清单实测记录至少覆盖登录态保持、实时日志、容器控制台与证书信任。被测对象已不存在，不再适用。

## Verification

- V-1: `npm run typecheck`（required）。
- V-2: `npx vitest run tests/unit/browser tests/unit/workspace`（新增：地址列表、入口点击语义、pane 呈现条件放宽；回归：既有浏览器 tab、分屏、独立窗口）。
- V-3: **取消**（2026-10-14）：手动实测 Portainer CE LTS 于 9443。被测对象已移除，不再适用。

## Boundary

2026-10-14 起：登录与容器、镜像、卷、网络、日志、Stack 的操作全部由 Portainer 提供、JanusX 不实现原生容器操作——这条边界**已被用户决策推翻**。新边界见[Docker 面板入口](../docker-management-entry.md)：首版自研连接状态、容器列表与启停、实时日志、容器终端、访问服务、Compose 分组七项；不做镜像仓库、镜像构建配置、卷与网络管理、磁盘清理、运行时安装、远程环境管理，这些保留「打开 Docker Desktop」入口。Docker Desktop 的安装、升级与 WSL 配置仍不由 JanusX 负责；管理界面不默认放入狭窄的右侧工具面板。

## Results

未执行 P5/P6 与手动实测。代码落地进度见 Progress，实测证据待补 Evidence。

## Progress

2026-10-14 落地 P1–P3 与 Markdown 迁移（Main Agent 单次执行，无子代理）。设计方向按用户当日确认改为**右上角固定入口**（否决悬浮球方案：会遮挡它要打开的全屏 pane 内容、丢失键盘可达性、并破坏与工作台切换器的分组一致性）。

- P1 顶栏全局工具组：新增 `components/TitlebarToolGroup.tsx` + `.module.css` 与 `components/ui/DockerIcon.tsx`，挂在 `Titlebar.tsx` 右侧单一 flex 行内，与 `WorkbenchSwitcher` 同排但由 14px 竖分隔线隔开；两个工作台开关都关掉时分隔线自动收起。视觉语言克隆 `WorkbenchSwitcher`（24px 按钮 / radius 5 / 组内 6px / 组间 12px），含 planche 覆载。`lib/global-tool-entry.ts` 的 `focusWorkspaceFront()` 统一"翻回工作区正面 + 收起遮挡工作台"前置，顶栏与快捷键共用，不依赖 `TerminalArea` 已挂载。
- 无项目宿主（原架构缺口）：`buildWorkspaceTerminalSurfaces` 原先用 `if (activeWorkspaceId && active.paneTree)` 守活动 surface，`activeWorkspaceId` 为 null 时整个分支被跳过，空白页打开的浏览器/Docker 内容无宿主可挂。改为经 `activePaneScopeId()` 引入模块级哨兵 `GLOBAL_PANE_SCOPE = '__global__'`，`TerminalArea.tsx` 的可见性判断按哨兵判。已核实 `WorkspaceTerminalSurface.workspaceId` 全仓仅三个消费点（Map 键、React key、可见性判断），哨兵不进 `terminalSnapshots`/`hotWorkspaceIds`/`retainWorkspacePaneContent`/shell-restore manifest。同时修掉 `removeWorkspace` 删掉活动工作区时不清 `paneTree` 导致的悬空态。
- P2 管理页承载：`openDockerInWorkspace(url, environmentId)` 用确定性 surfaceId `browser-docker:<envId>`；命中已有 pane 则激活，未命中则创建，`Surface already exists` 时直接纳回仍活着的主进程 surface（`partition: 'persist:janusx-browser'` 保登录态）。主进程零改动。
- P3 地址管理：`shared/dockerSettings.ts`（schema + `normalizeDockerSettings` + `getCurrentDockerEnvironment` + `dockerSurfaceId`）；`GlobalConfig.dockerSettings` 与 config service get/set；`shared/ipc/docker.ts` + IPC + preload + `stores/docker.ts`（照 shellProfiles 范式，含 IPC 失败回滚）；设置新增 `docker` tab 与 `DockerSettingsPanel.tsx`，独立 `docker` i18n 命名空间（不碰有历史编码损坏的 settings.json）。`normalizeBrowserUrl` 从主进程搬到 `shared/browser-url.ts` 再导出，既有 import 与 12 条用例零改动。
- Markdown 独立 pane（来自 `markdown-pane-entry.md`，本次一并落地）：新增 `MarkdownPaneContent` 与 `createMarkdownPaneContent`/`findFirstMarkdownPaneContent`；`retainWorkspacePaneContent` 保留规则扩为 browser/markdown/匹配终端；`TerminalArea.tsx` 加 markdown 渲染、标签与 tooltip 分支，关闭标签只移除呈现不碰草稿；拖拽落点抽出内容中立的 `movePaneContentToPane`/`splitPaneWithContent`（删除已死的 `moveBrowserToPane`/`splitPaneWithBrowser`/`addBrowserToPane`）；草稿归属从 `terminalId` 改为 `scopeId`（workspaceId 或全局哨兵），`DraftCard.terminalId` 降为可选元数据，`migrateLegacyDraftScopes` 一次性迁移；底部抽屉收成只留上下文监控，删除 `DrawerViewTabs`/`getNextDrawerView` 与 `Ctrl/Cmd+Shift+N` 的抽屉监听。
- 删除 pane 内浏览器 "+" 按钮及 `onOpenBrowser` prop 链（用户确认），顶栏入口统一走 `openBrowserInWorkspace()` 的复用语义；`Ctrl/Cmd+Shift+B` 监听随入口移出 `TerminalArea`。
- 2026-10-14 追加：三个顶栏入口**打开后置灰、关闭标签后恢复**（用户选定的简约设计）。逻辑抽成 `resolveGlobalToolOpenState(paneTree, currentDockerEnvironmentId)` 纯函数（`lib/global-tool-entry.ts`），只看 pane 树里有没有对应内容、不看焦点。实现时暴露出一个设计缺陷并修掉：Docker 管理页本质是浏览器 surface，`findFirstBrowserPaneContent` 会把它当成"工作区浏览器"，导致打开 Docker 会把浏览器入口也置灰、且点浏览器会跳到 Portainer。新增 `isDockerSurfaceId` 与 `findFirstUserBrowserPaneContent` 把管理页排除出浏览会话，`openBrowserInWorkspace` 与置灰判断都改用它。Docker 下拉箭头在主体置灰后仍可用——切换到别的环境是新的一页。
- 2026-10-14 落地 **P5 自签证书信任**：新增 `src/main/browser/cert-trust.ts`，用 `app.on('certificate-error')`（不用 `setCertificateVerifyProc`，理由见下）为**已配置的 Docker 管理地址的精确 origin**（scheme+host+port）信任自签证书，其余一律 `callback(false)`；子框架的证书错误一律拒绝。在 `src/main/index.ts` 的 `app.whenReady()` 之后、`createWindow()` 之前注册，保证内置浏览器首次加载即被覆盖。选型依据：`setCertificateVerifyProc` 在**每一次**证书校验时都会被调用，挂在 `persist:janusx-browser` session 上就要为该 session 里每个 HTTPS 请求（含 github.com）重写整条校验链；`app.on('certificate-error')` 只在校验失败时触发，可以只开一个精确口子。
- 2026-10-14 追加**加载失败兜底**（消除黑屏这类静默失败）：`BrowserTabState` 增 `loadError`，主进程在 `did-fail-load` 且 `isMainFrame` 时记录、`did-navigate`/`did-start-loading` 时清空；`BrowserSurface` 在内容区之上铺一层失败提示，给出地址、原因和重试按钮。此前自签证书被中止、端口没开都完全静默——`.body` 没有 background，视图停在 `setBackgroundColor('#0a0a0a')` 的深色底上，用户只能看到一块黑且无法区分"在加载"和"加载失败"。（此项与 Portainer 无关，保留。）
- 2026-10-14 **移除 Portainer 集成**（Main Agent 单次执行，无子代理；用户当日决策，见[Docker 面板入口](../docker-management-entry.md)的 Decisions）：删除 `shared/dockerSettings.ts`、`shared/ipc/docker.ts`、`stores/docker.ts`、`components/DockerSettingsPanel.tsx`、`components/ui/DockerIcon.tsx`、`main/browser/cert-trust.ts`、`tests/unit/docker-settings.test.ts`、`tests/unit/docker-cert-trust.test.ts` 与 `i18n/locales/{en,zh-CN}/docker.json`。顶栏 `TitlebarToolGroup` 去掉 Docker 主体按钮与环境下拉及其全部 CSS（含 planche 覆载），余浏览器与 Markdown；`resolveGlobalToolOpenState` 去掉 `docker` 字段与第二参数；`workspace-pane.ts` 删掉 `findFirstUserBrowserPaneContent` 与 `isDockerSurfaceId` import，`openBrowserInWorkspace` 回到 `findFirstBrowserPaneContent`；`stores/workspace.ts` 删掉 `openDockerInWorkspace` 与 `dockerSurfaceId` import；`AppSettingsModal` 去掉 `docker` tab、`Container` 图标与 `tDocker`；i18n 去掉 `docker` 命名空间与 `common:toolGroup.docker*` 五个键；`GlobalConfig.dockerSettings`、config service 的 get/set、IPC、preload、`electron.d.ts`、`electron-api-fallback` 一并删除。`tests/e2e/desktop-smoke.spec.ts` 的 Electron 用例改由 `button[data-id="browser"]` 驱动、fixture 地址改为普通 surface，覆盖的原生视图树、加载失败、重试、对话框与退出行为不变。

验证状态：

- V-1 `npm run typecheck`：**通过**（退出码 0，2026-10-14 本机）。
- V-2 `npx vitest run tests/unit`：**3146 通过 / 4 失败**，4 项失败全部为先存失败且与本次改动无关——`agent-notes-check`（两份 Task 缺 Progress/Evidence，本文件已补）、`note-repair`（`updated precedes created`，时间相关）、`workflowx-v2` 与 `note-corpus-navigation`（note 语料遍历，成对抖动）、`knowledge/user-recall-m2`（画像召回）。新增/改写：`docker-settings.test.ts` 12 例、`global-tool-entry.test.ts` 4 例、`workspace-front-surface.test.ts` 补 3 例 null 作用域、`workspace-pane.test.ts` 补 4 例 markdown、`draft-card-store.test.ts` 改 9 例、`quick-note-view.test.ts` 改 13 例。
- `npx playwright test tests/e2e/pane-tab-drag.spec.ts --project=island --workers=1`：**21 项全通过**（含两个 browser-only 分屏用例，走内容中立落点路径）。需 `NO_PROXY=127.0.0.1,localhost`。
- `npm run i18n:types` + `i18n:check`：**通过**（13 个命名空间双语同步）。
- V-3 与 P5/P6 **未执行**：本地部署 Portainer CE LTS 于 9443 的实测、自签证书信任、登录态保持、实时日志、容器控制台、文件上传下载均待办。

遗留与未决：

- ~~P5 自签证书信任已于 2026-10-14 落地~~ **已删除**（2026-10-14 随转向）。其唯一未实测的点（`certificate-error` 是否确实对 `persist:janusx-browser` 分区的 `WebContentsView` 触发）连同代码一起作废，不再需要验证。
- ~~P6 兼容性实测仍未执行~~ **已取消**（2026-10-14 随转向）：被测的 Portainer 管理页已不在产品内。
- ~~P4 只交付了设置页里的部署指引文案~~ **已删除**（2026-10-14 随转向）。
- ~~AC-3 的"测试连接"与"在外部浏览器打开"合并为同一个按钮~~ **已删除**（2026-10-14 随转向）。
- Markdown 草稿仍为纯内存，自动保存与重启恢复未实现；无项目的 pane 同样仅内存（选项目后丢弃，浏览器 surface 在主进程存活可恢复）。
- `.agents/notes/terminal/tasks/gitbash-shell-terminal-management.md` 同样缺 Progress/Evidence，属 Git Bash Task 自己的收尾，未代写。

## Evidence

代码与自动化证据（2026-10-14，本机 `node_modules` 与兄弟仓库 `../janusx` 均在位）：

- `npm run typecheck` 退出码 0。
- `npx vitest run tests/unit`：3146 通过 / 4 失败，失败项均为先存且与本 Task 无关（详见 Progress 的 V-2 说明）。
- `npx playwright test tests/e2e/pane-tab-drag.spec.ts --project=island --workers=1`：21 项全通过；运行需带 `NO_PROXY=127.0.0.1,localhost`（本机 localhost 代理会劫持 Playwright 的就绪探测）。
- `npm run i18n:types` 写出 3633 键；`node scripts/i18n-check.mjs` 报 13 个命名空间双语同步。
- 新增/改动的测试文件：`tests/unit/docker-settings.test.ts`、`tests/unit/global-tool-entry.test.ts`、`tests/unit/workspace-front-surface.test.ts`、`tests/unit/workspace-pane.test.ts`、`tests/unit/draft-card/draft-card-store.test.ts`、`tests/unit/draft-card/quick-note-view.test.ts`、`tests/e2e/pane-tab-drag.spec.ts`。

Portainer 移除的验证证据（2026-10-14 当日追加，Main Agent 本机）：

- `npm run typecheck` 退出码 0；`npx eslint` 对全部改动文件 0 error。
- `npm run i18n:types` 写出 3614 键（较移除前少 19：`docker` 命名空间 14 键 + `common:toolGroup` 5 键）；`node scripts/i18n-check.mjs` 报 **12 个命名空间**双语同步。
- `npm run build:check` 与 `npm run build`（产物落 `out/`）均成功。
- `npx vitest run tests/unit/browser tests/unit/workspace tests/unit/workspace-pane.test.ts tests/unit/global-tool-entry.test.ts tests/unit/workspace-front-surface.test.ts`：**11 个文件 / 109 项全通过**（`global-tool-entry.test.ts` 改为两个工具的 7 项）。
- `npx playwright test tests/e2e/pane-tab-drag.spec.ts --project=island --workers=1`：**21 项全通过**。
- `npx playwright test tests/e2e/desktop-smoke.spec.ts --project=desktop --workers=1`（`JANUSX_E2E_ENTRY=artifacts/build-check/main/index.js`、`NO_PROXY=127.0.0.1,localhost`）：改名后的 `Browser load failure, retry, dialogs and close release native browser views` **通过**——原生视图树、加载失败提示与重试、对话框遮挡、pane 关闭与重开、退出路径全部仍被覆盖。
- 全量 `npx vitest run tests/unit`：8 项失败，全部先存且与本次移除无关——`agent-notes-check`（`terminal/tasks/gitbash-shell-terminal-management.md` 缺 Progress/Evidence）、`note-repair`（`updated precedes created`，fixture 时间相关）、`workflowx-v2`（`BLUEPRINT_SYNC_TIMEOUT`，与 `note-corpus-navigation` 成对抖动，本次单独运行通过）、`knowledge/user-recall-m2`（画像召回）、`file-explorer-delete`（4 项，`dispatcher.useLayoutEffect is not a function`，React 环境问题）、`prepare-package`（单独运行通过，并行抖动）。新增的 `http-request-pane.md` 通过 `note-corpus-navigation` 的可达性与 `agent-notes-check` 的机械门禁。

尚缺的实测证据（未执行）：`tests/e2e/desktop-smoke.spec.ts` 的 `built desktop exposes typed Workspace, Terminal, and Project critical paths` 在用 `out/main/index.js` 实跑时于 `page.getByRole('main').getByText('Shell', { exact: true }).click()` 超时失败——Windows 上新 shell 种子名为 `PowerShell`（`createShellProfileSeed`），Shell 卡片渲染的是条目名而非 "Shell"，属 Git Bash/Shell 终端管理自己的未收尾项，与本次移除无关。自研 Docker 面板与 HTTP 请求 pane 尚无 Task 与实测。

## Handoff

Main Agent 负责本 Task 的排期与状态维护；子代理只读。执行前重读[设计 note](../docker-management-entry.md)的 Decisions；2026-10-14 之后该文的 Portainer 段落仅为历史记录，实际方向是自研首版七项能力。
