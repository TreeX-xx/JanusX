---
{
  "schema": "harness-note/2",
  "id": "96a2f5cd-166e-4982-a444-7640858f0a5f",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-09-09",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-09-agent-note-plugin-architecture-forms-selection--96a2f5cd.md",
      "sourceHash": "bb00f53999e5e0e4c094c057c2fee217cd57daa1c39a3eb269f822e4fb9ef17d",
      "originalBodyHash": "b37748cb72d6d93be29cab1980b8e2a879ac24e31c2eb465b9f288f2b027d7c1",
      "category": "formal",
      "reason": "Retains the source requirement in draft lifecycle; body documents Plugin architecture forms selection. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/architecture/2026-09-09-plugin-architecture-forms.md",
        "sourceHash": "bb00f53999e5e0e4c094c057c2fee217cd57daa1c39a3eb269f822e4fb9ef17d",
        "originalBodyHash": "b37748cb72d6d93be29cab1980b8e2a879ac24e31c2eb465b9f288f2b027d7c1"
      }
    }
  },
  "updated": "2026-10-23T03:10:27Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# Plugin architecture forms selection

## Expected behavior

插件作者能够通过公开协议组合中部工作区、工具箱、右侧栏、Island 和完整工作台，并按阶段接入文档、后台任务、Agent 和提供者能力。新增使用已开放协议的插件无需逐个修改宿主容器；命令、入口、视图、实例、展示位置和权限分别建模。目标设计归[插件平台架构](../plugin-platform-design.md)，本需求维护可验证结果。

S1 已提供可信渲染器注册与生命周期，S2 已迁移文件树、Git 和会话管理，S3 通过应用级贡献内嵌已有 CPA 管理页。P0／P1 已形成首版契约、公开 SDK 类型与严格校验、独立脚手架、命令／入口和快捷键适配；P2 已实现第三方加载、异步桥、私有 KV 与管理调试，实际验证见阶段计划。旧 AC-5–7 的勾选仅覆盖可信扩展，公开桥、包持久化、工作台及 Island 的运行验收仍独立保留。

## Proposal

保留可信代码贡献（[slot 提案](./island-rightdock-slots.md)）与独立公开 SDK。首版以清单、脚手架、命令／入口、目录导入和隔离页面形成闭环，公开类型不直接暴露内部 React 组件或 store。第三方使用 `await connectPlugin()` 建立专用 MessagePort 连接；页面运行于独立离线 Session 的 WebContentsView，CSP `sandbox allow-scripts` 不开放 same-origin 或顶层导航，最小 preload 仅传 port，不提供宿主 API。插件 JS 不进入主进程，普通插件不获得完整 renderer bridge，远程 URL 不直接作为插件代码入口。载体修订原因和实际边界归首版契约。

本地开发模式默认关闭，用户选择目录并确认权限后，允许未签名页面隔离运行；复制安装仍保留开发来源。模式关闭时拒绝其自动执行并清理运行资源。该规则替代旧条文中不区分运行方式的“所有未签名目录一律拒绝”，不允许通过开发模式执行原生 Node 或宿主 renderer。正式发布的来源、完整性和签名另归 S5，未实现前不自动激活正式来源包。

清单声明身份、版本、宿主兼容范围、权限、能力需求和贡献。`plugins:check` 发现非法声明及受测的越权调用，所有宿主调用另在运行时校验身份、权限、范围和参数。完整生命周期、上下文、工作台／Island、文档、服务／事件及提供者按阶段增加。MCP 和 Skills 为专用适配，不能代替完整插件契约或假定所有外部 CLI 均支持相同 hook。

实施顺序以[分阶段计划](../../planning/plugin-platform-roadmap.md)为准：P0–P2 完成 S4 本地闭环，P3–P7 扩展贡献与领域能力，P8 对应 S5 分发。内置扩展随应用发布并保留可信 React 方式；第三方 UI 隔离运行，通过受限桥调用授权能力。共享贡献协议不等于共享权限，外部服务网页也不获得插件桥。原宿主继续拥有文件服务、Git 操作、会话执行及持久化。

清单按需声明中部页面和右侧面板、稳定视图身份及应用级／项目级作用域。S1 已交付 `src/renderer/src/extensions/` 的可信代码贡献定义、动态注册与视图宿主；右侧静态工具与动态扩展合并，中部通过通用 extension pane 承载。宿主管理入口、容器、内存布局恢复、激活／停用、资源释放和错误处理，作者维护页面与业务状态。应用级 Tab 切换项目时转移，项目级 Tab 随项目快照恢复；跨容器或项目重挂载不承诺保留 React 局部状态。S2 已移除文件树、Git、会话管理的容器专属分支，内置定义兼容旧 ID 与偏好，不扩大到全部 Island 或助手工具。第三方清单通过授权适配为可信外壳，脚本仅在独立离线 Session 的原生 sandbox 页面运行。

## Alternatives considered

- Directory loading first for release-free customization — strongest case is team PoC and customer variants without a release train. The driver that rules it out is trust inversion: full-permission renderer JS before any signature or version-skew design exists.
- Sandbox iframe for everything — strongest case is one uniform isolation story. The driver that rules it out is composition loss: no shared React components, hooks, or stores across the bridge, with degraded drag, menus, and shortcuts.
- Do nothing / reuse hand-written allowlists — staying put keeps the current review gates sufficient. The cost is that every integration remains a five-layer manual patch and third-party capability stays impossible.

## Acceptance criteria

- [x] AC-1: The SDK package plus scaffold generates a preview contribution that typechecks under the existing verify chain.
- [x] AC-2: 未开启本地开发模式时，未签名目录不执行且返回明确错误和日志；显式选择目录并授权后仅加载隔离页面，关闭模式清理其运行资源，复制安装不改变来源或权限；主进程与宿主 renderer 均不执行该目录代码。
- [x] AC-3: One read-only sandboxed sample plugin runs through the curated bridge with timeout and error states.
- [x] AC-4: The verify gate rejects a manifest-external method call automatically.
- [x] AC-5: 中部与右侧均可通过统一贡献协议注册、打开及关闭视图；新增使用已有能力的视图无需修改容器代码，一个示例可同时贡献两处视图。
- [x] AC-6: 文件树、Git、会话管理依次通过内置扩展注册，保留现有功能、实验开关、快捷键、顺序、宽度偏好及状态恢复；关闭会话面板不终止会话或改变持久化。
- [x] AC-7: 应用级视图跨项目复用，项目级视图的上下文与状态按项目隔离；禁用或卸载清理入口与视图资源，恢复已失效的视图 ID 不崩溃。
- [x] AC-8: 内置扩展、隔离第三方页面与外部服务网页各自遵守运行边界；同一插件的中部及右侧视图可通过受限接口共享状态，页面不能直接获得宿主完整桥。
- [x] AC-9: 命令、入口与视图分开注册，同一命令可从工具箱和快捷键触发；上下文可用条件、用户排序／显隐及快捷键冲突有确定行为，新增已有类型贡献无需修改容器。
- [ ] AC-10: 公共上下文与单／多实例身份稳定；项目切换、停用或重载后的迟到响应不写入新实例，应用级／项目级存储隔离，重启启停恢复与缺少必需能力的拒绝有实际证据。
- [x] AC-11: 外部插件可打开完整工作台并返回原界面，同时贡献 Island 状态、动作、受限预览和展开区域；停用清理并回到有效界面，插件内容不能覆盖宿主审批和权限提示。
- [ ] AC-12: 文件查看器／编辑器支持匹配、用户默认选择、失败回退及多实例；保存经过宿主文档事务，未保存关闭、外部变更与版本冲突不丢数据，受限目录查询不越界。
- [ ] AC-13: 一个无页面示例通过已验证的受限运行时或宿主声明式任务执行；任务日志、取消、超时、停用清理和项目归属正确，事件／公开服务有 schema、版本、权限、限流及循环控制。
- [ ] AC-14: 网络及凭证通过宿主代理，未授权域名和重定向目标被拒绝，页面无法绕过限制；凭证引用支持撤销且不向插件 UI 返回原始密钥。
- [ ] AC-15: 内置 Agent 的一个工具／工作流和一个代表提供者只依赖公开协议，支持授权、取消及结果追踪；外部 CLI 能力矩阵明确，未支持的 hook 不显示为可用。
- [ ] AC-16: 支持平台上的插件窗口可恢复与清理，主题／配置有命名空间和失败回退，角色资源不附带会话权限；对话局部贡献按数据权限运行且不改变消息耐久层。
- [ ] AC-17: 正式包的来源和完整性可验证，必需能力不兼容明确拒绝；权限扩大需重新授权，更新失败保留可用版本及用户数据，开发来源不能冒充正式来源。
- [ ] AC-18: 插件管理界面区分已安装、启用、连接和实际运行状态，提供启用范围、入口控制及跨启动偏好；必要官方功能的限制明确，停用视图不结束宿主共享会话，卸载默认保留用户数据。

## Risks

- Directory discovery and installation must not execute code; activation is separate and checks development-source rules, grants and the isolated carrier before loading.
- Persisted registries meet unknown plugin ids after uninstall; filter with an empty state rather than crashing.
- Keep-alive and bridge memory need measurement before the sandboxed form is declared done.

## Verification

P4 首片实现嵌入文件编辑器的只读 viewer、默认选择／恢复、失败回退和按文件绑定实例。AC-10 仅补充文档 viewer 实例身份，通用多实例 pane 尚未开放；后续片已接通版本化草稿交接、宿主审阅保存、未保存关闭及写前版本冲突保护；AC-12 的完整写入事务、持续插件编辑／冲突合并及目录查询仍未完成，两条 AC 保持未勾选。契约归[只读 viewer](../plugin-contract-v1.md#p4-只读文档查看器)，实际验证归[阶段记录](../../planning/plugin-platform-roadmap.md#p4-只读-viewer-首片)。

P3 的 AC-11 已在 Windows 开发构建验收：真实打包 SDK 的四区域联动通过，包含工作台返回／焦点、宿主设置面遮挡、Island 状态／动作／受限文本预览／原生展开页、重载、项目切换与停用清理。主单元 3793 项及 LLM 核心 80 项通过；完整 Electron 回归 40 项通过、2 项跳过。清单边界、队列与撤销证据归[阶段交付记录](../../planning/plugin-platform-roadmap.md#p3-交付与验证)。完整 verify 在新增的其它 Note 两处格式问题停止，后续 lint 和桌面回归已独立补跑通过，不记为一次全绿。macOS／Linux 和安装包未验收。

2026-10-23 P2 收尾：AC-2、AC-3、AC-8 由外部打包 SDK 的真实双视图、只读桥／私有 KV、开发来源／重启、超时熔断、网络拒绝和 CPA 回归支持。AC-9 结合 P1 的命令／快捷键及冲突单元／浏览器证据，与 P2 入口显隐、排序和快捷键设置的 Electron 操作闭合。新增真实 OOM／握手后连续崩溃熔断、Git worktree 切换及根身份／KV 隔离、经桥拒绝 junction／hardlink，配合真实文件句柄延迟完成和校验后父目录置换的确定性单元测试，补齐 P2 故障和边界证据。

AC-10 的 P2 单作用域实例、上下文／撤销、应用／项目／worktree KV 隔离、启停恢复和能力拒绝已覆盖；多实例仍按首版契约归 P4，因此整条 AC-10 保持未勾选。AC-18 的 P2 第三方列表已区分来源／启用意图、页面数、桥连接和就绪数，跨启动显隐／排序／快捷键偏好有桌面证据，管理页明确内置工具及共享会话仍由宿主管理。外部服务连接和必要官方功能的通用管理尚属后续范围，因此整条 AC-18 保持未勾选；这不把后续范围追记为 P2 已实现。完整命令、证据和平台限制归[阶段交付记录](../../planning/plugin-platform-roadmap.md#p2-交付与验证)。以下各阶段条目保留当时证据。

2026-10-22 P1：`packages/plugin-sdk/` 与 `plugins:check` 已接入 verify，门禁包含严格清单／调用策略负例，以及 SDK 打包后在仓库外安装、typecheck、双页构建和静态包校验；AC-1、AC-4 的勾选限定于开发与纯策略门禁，不表示运行时桥已实现。命令、入口、视图分别建模，工具箱／中部菜单／快捷键共用打开路由，旧 launcher 自动适配；用户偏好已有持久化 API，但可见管理页及冲突展示仍归 P2，AC-9 保持部分完成、未勾选。数量、命令和复查发现归[交付记录](../../planning/plugin-platform-roadmap.md)。

2026-10-16 S1：扩展核心与宿主相关的 8 份单元测试共 121 项通过，`tests/e2e/extensions.spec.ts` 5 项浏览器真实组件用例通过，既有 pane 拖拽与右侧动效 25 项通过，真实 Electron 的既有关键路径 smoke 1 项通过。AC-5、AC-7 的勾选限定于可信扩展与既有内存快照机制；第三方权限隔离和持久化包格式不在此证据内。命令、验证限制和后续范围归[阶段交付记录](../../planning/plugin-platform-roadmap.md)。

2026-10-16 S2：16 份相关单元测试 176 项、17 项不同浏览器用例及 2 项真实 Electron 回归通过。新增桌面检查确认关闭会话面板后原 PTY 仍可接收输入，会话记录仍保留。AC-6 覆盖可信内置迁移，未新增第三方能力；会话 CLI 使用测试进程，未对真实远端执行 push／pull。命令与证据路径同上。

2026-10-16 S3：80 项相关单元测试与 7 项浏览器回归通过，复用双区域示例。真实 Electron 验证 CPA 跨项目、关闭／重启登录复用、弹窗与对话框生命周期，原版 CPAMC v1.26.5 完成登录和配额页导航；后端为模拟 API，真实额度与 OAuth 未验证。网页无宿主桥，使用独立持久分区；第三方受限共享接口仍未实现，AC-8 保持未勾选。命令、原版前端指纹及证据限制见阶段交付记录与[服务集成](../service-integrations.md)。

S3 后续按用户选择补齐本地 CPA 托管：101 项相关单元、7 项浏览器回归、4 项真实 Electron 用例通过。托管桌面用例运行已校验的官方 Windows CPA 后端与原版前端，网络传输为本地资源替身；覆盖首次启用、端口配置、登录、关闭与退出、重启后密钥及账号目录测试文件保留。官方组件下载和执行仅由固定主进程能力负责，未向第三方插件开放，AC-8 保持未勾选；真实供应商额度和 OAuth 尚未验证。
