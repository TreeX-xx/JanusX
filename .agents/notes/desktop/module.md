---
{
  "schema": "harness-note/2",
  "id": "3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": ["desktop","distribution"],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/cf5310f1-3f10-484b-9823-a510d178ec02"},
    {"type":"governed-by","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/39f58575-dba9-584f-a285-a33a2c73cdc4"}
  ],
  "codeRefs": [
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/index.ts","role":"entry"},
    {"repoId":"972afef3-2fc7-49de-a3ee-7e041225d28c","path":"src/main/ipc/register.ts","role":"implementation"}
  ],
  "updated": "2026-10-29T16:50:52.329Z",
  "moduleState": "partial"
}
---

# 桌面与分发

## Responsibility

负责 Electron 启动、窗口与宿主服务装配、应用 IPC 注册及桌面分发。它承载各子系统并管理应用生命周期，领域行为仍由终端、会话、执行和知识等模块维护。

下列链接保留已有决策、阶段需求和交付记录的阅读路径；正文及生命周期由原 Note 负责。历史 parent 仅组织文档，跨模块关联由本声明的 related-to 补充。模块声明只在职责、接口、明确依赖或代码入口变化时维护。

## Design

v0.9.4 的 Windows 启动修复采用调用者权限启动桌面程序与便携启动器，终端继承当前权限。用户已确认候选包在故障 Windows 10 上可以打开，并授权以正式名称替换 v0.9.4 的 Windows 附件与标签代码。包验证包含不带 GPU 绕过参数的真实窗口启动；启动日志保存于所选用户配置目录的 `logs`。原因、代价及验证范围由 [reproducible-verification](./reproducible-verification.md) 维护。

v0.9.4 相较 v0.9.3 的用户可见变化及安装说明维护在[版本说明](../../../docs/releases/v0.9.4.md)，发布包限定 Android 局域网测试，开发构建保留跨网实现。旧 wiki 已删除，README 和相关专题中的历史素材链接固定至 v0.9.3 Git 存档，避免随 main 删除失效；当前工程文档继续由 `.agents/notes` 与 `docs` 维护。二维码扫描区的白底及其深色加载文字是主题无关的扫描对比度要求，主题例外随组件迁移至 StatusBar.module.css；操作按钮已使用主题变量，不保留旧的白字按钮例外。

Window chrome follows the host platform: Windows uses right-side minimize/maximize/close and macOS uses left-side traffic lights. Internal dialogs keep a right-side close action; floating panels expose only supported actions. Shared state synchronization and limits are described in [window-controls](./window-controls.md).

README 的内容架构、像素品牌形象与新 UI 多主题演示，见[展示与录制计划](./readme-presentation-plan.md)；10 条功能 GIF 已全部重录并接入，覆盖分屏两部曲、Island、运行配置、蓝图维护/自动审核、用量、会话、Worktree 与产物。八组静态素材齐备，工具四格、用量明细和外部会话补图已接入；录制机制、构建来源、数据边界及验证由 [readme-showcase](./readme-showcase.md) 维护。

免安装版配置使用用户目录下独立的 `JanusX-Portable`，不提供随身模式；旧同级 `data` 在应用数据服务打开前完成校验迁移，并清理已迁移文件及明确可重建的缓存。路径隔离、失败保护和重试语义见 [application-profile](./application-profile.md)。

[工作区私有状态迁出项目目录](./workspace-state-storage.md)已完成本地 P2 和 P4：新数据接入 userData，旧数据主动迁移；稳定身份重新定位、最后关联移除后的 30 天恢复期、过期维护和按需统计从通用设置管理。终端与 Agent 的自动快照已退场，Island 差异独立保留；迁移只复制启动配置和日志，旧还原点连同已迁入 userData 的副本直接清除，不再按年龄或数量保留。P1 队列和三个常量继续复用；P3 Hook 资产采用 userData 单次启动注入。迁移不含源码、工程 Notes 和构建产物，远程迁移不支持；残留核对与长期升级验收归待调度的 P5／P6。

桌面执行史：[scoped implementation 与实施史](../agent/desktop-task-implementation.md)、[delegated-modes 与 xdo 宿主](../agent/desktop-delegated-modes.md)、[ade-survey](./desktop-ade-mit-survey.md)。

打包与发布：[hoisted-deps](./packaged-hoisted-deps.md)、[runtime-size](./packaged-hoisted-deps.md)、[cli-publish](./janus-cli-npm-publish.md)、[officecli](./officecli-bundled.md)、[runner-backflow](../agent/external-runner-backflow.md)、[ci-order](./ci-sibling-build-order.md)、[verify-repair](./release-verify-repair.md)（v0.8.8 双管线修复）。

[发布门禁成本与冗余审计](./release-gate-redundancy-audit.md)实测完整 verify 约 27min，指出发布级验收占约六成、同一断言重复执行、排序倒置与 PR 全量执行三类冗余，并确认分支保护未绑定 required status check；建议按性价比排序，接入分层与重排顺序为前置。该审计为草案，未实施。

[开发、构建与发布解耦设计](./release-delivery-design.md)针对本地可打包而远端反复失败的维护问题，第一阶段已在代码中取消 tag 自动构建和分支 push 重复验证，保留完整 PR 门禁及手动构建附件。Windows 本地上传草稿与核验公开分开，失败可续传；OfficeCLI 保持内置。统一输入与新增平台仍在设计阶段，具体取舍与实施验收由该草案维护。

正式 Windows 发布推荐 `package:win:stage`，避免打包和首次上传重复执行运行验证；上传先预检远端状态，运行检查后重新核对再续传。手动构建将版本及 OfficeCLI 资源检查前置，并复用本地资源哈希校验脚本。必要的构建、包边界与公开前字节核验保留，细节见上述解耦设计及维护者指南。

协作入口由 [CONTRIBUTING](../../../CONTRIBUTING.md)、[开发环境](../../../docs/development.md)和[维护者指南](../../../docs/maintainers.md)分别承担：功能 PR 进入 dev，晋级 PR 进入 main，两者均运行 Windows 验证；发布由维护者负责。分支、验证和反馈取舍分别见 [development-branch](./development-branch.md)、[reproducible-verification](./reproducible-verification.md)及 [github-maintenance](./github-maintenance.md)。

早期基石（均保留，无孤儿）：[toast](./desktop-toast.md)、[model-registry](../agent/model-registry.md)、[llm-runtime](../agent/llm-tool-runtime.md)、[browser-surface](./browser-surface.md)、[auto-update](./app-auto-update-win.md)、[cli-scope](./cli-manager-scope.md)、[i18n](./i18n-pipeline.md)、[statusbar](./runtime-statusbar.md)。

内嵌浏览器按实际可见性挂载原生网页视图：隐藏、加载失败和对话框遮挡时摘除，恢复后按布局重新挂载。错误提示保留失败地址与重试入口；退出确认和设置等共享弹窗通过窗口内计数协调遮挡，不能依靠 CSS 层级覆盖原生网页。具体行为及 Docker 入口回归证据见 [browser-surface](./browser-surface.md)。

[浏览器与桌面应用控制](./browser-computer-use.md)记录 codeg、Orca 的调研及开箱即用候选方案：先复用现有浏览器打通 Agent 操作，再评估 Windows 原生驱动；内置工具、CLI 与 MCP 共享宿主服务。该方向处于探索阶段，尚未选型或实施，不改变既有浏览器和元素点选需求的边界。

预览选元素→AI 按元素改（已敲定、未实现）：内置浏览器与 HTML 预览（`HtmlPreviewFrame`）共用一份元素引用协议（selector／outerHTML／计算后 CSS／bbox／截图），取元素前端各面自建；用户点选后元素引用进会话输入，AI 按引用定位源码修改并刷新验证。注入只服务用户主动选取手势，不开放 agent 页面脚本；映射目标态为 sourcemap／组件树 `file:line`，本期文本检索、二期映射。范围、边界与验收归[选元素→AI 按元素改](./requirements/element-picker-ai-edit.md)。

Windows 分发先刷新已构建的 sibling 发布文件，再构建、检查边界和同步排除清单。双目标打包与单目标 portable 迭代均禁用自动发布；迭代子进程使用压缩级别 1 并保留体积预算，正式发行保持默认压缩配置。独立上传入口检查运行时和更新清单，向草稿续传同一批产物；单独公开时核对远端附件，不重新构建。llm-core 的增量信息保存在 dist 内，清理 dist 同时清理缓存；verify 先构建 core 供测试使用，后续 build:app 仅构建 Electron 应用。

本地 checkout/worktree 独立安装开发依赖，`.npmrc` 固定本地 sibling 包物化方式；`npm run dev` 先检查本地工具链、Electron 二进制和 sibling 发布入口，再编译 llm-core 并启动隔离的 `.cache` 开发输出。缺依赖给出明确修复命令，不自动安装或改动同级仓。环境契约和验证由 [reproducible-verification](./reproducible-verification.md) 维护，操作入口见 `CONTRIBUTING.md`。

## Acceptance criteria

以下保留 2026-09-26 文档整理的验收原文与勾选状态，供旧 Task 引用；其中篇数是当时快照，不是当前模块大小，新增工作也不强制改写历史 parent。

- [x] AC-1: 本域 21 篇直接子全部携带有效 parent。
- [ ] AC-2: 两篇正名文件后缀与 id 一致，无 flat-layout 违规残留。
- [ ] AC-3: github-maintenance 归属产品面，本域不重复收纳。

[Public account migration](./account-migration.md) records the three repositories, Pages, release assets and old-client update limits. Isolated migration worktrees preserve unrelated uncommitted development changes.
