---
{
  "schema": "harness-note/2",
  "id": "80e8b427-d263-42f4-b7cd-8313548c9e2a",
  "kind": "requirement",
  "lifecycle": "draft",
  "created": "2026-09-09",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-09-agent-note-third-party-plugin-import-and-debug-flow--80e8b427.md",
      "sourceHash": "43a87cbb0bd9a7a449a07a8ebee9b26ab8e18fca5f74cf342bcc0dfa44da3d90",
      "originalBodyHash": "39d95f58874202af27bc65c7ee5ca9aac3f88464ae3765a8c1a2d0473cc4f9a7",
      "category": "formal",
      "reason": "Retains the source requirement in draft lifecycle; body documents Third-party plugin import and debug flow. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/proposed/feature/2026-09-09-plugin-import-debug.md",
        "sourceHash": "43a87cbb0bd9a7a449a07a8ebee9b26ab8e18fca5f74cf342bcc0dfa44da3d90",
        "originalBodyHash": "39d95f58874202af27bc65c7ee5ca9aac3f88464ae3765a8c1a2d0473cc4f9a7"
      }
    }
  },
  "updated": "2026-10-22T16:11:38Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# Third-party plugin import and debug flow

## Expected behavior

P2 已加入第三方目录登记、授权、独立离线页面、私有 KV 与管理调试。限制 4 worker 的完整 verify 已通过，实际证据、默认并发失败记录及未覆盖面归阶段计划。首版应让作者仅依赖公开 SDK，在显式本地开发模式中完成构建、导入、授权、启用、使用、重载、禁用和卸载。[架构设计](../plugin-platform-design.md)定义完整平台，[实施计划](../../planning/plugin-platform-roadmap.md)的 P0–P2 限定首个 S4 交付；更广贡献不混入本轮只读权限。

## Proposal

首版只接受目录与构建好的本地静态资源。清单、预算、路径、错误码及五类能力以[首版契约](../plugin-contract-v1.md)为准：SDK、脚手架、主进程校验／登记、资源协议、隔离壳、授权桥、设置管理与调试已实现。资源协议使用 `janusx-plugin://`，原生 WebContentsView 使用独立内存 Session 及 CSP `sandbox allow-scripts`；项目文件只能经授权 API 读取，不由资源协议暴露。链接目录变化需重新校验并撤销旧代次；连续三次加载失败／握手超时熔断，普通拒权不计崩溃。首版仍拒绝写入、网络、终端、模型后端、任意后台 JS、ZIP、正式签名来源及市场。

本地开发模式默认关闭，由用户显式选取目录并授权；未签名包只在此模式运行隔离页面，复制到安装目录也保留开发来源。关闭模式停止对应来源的激活并清理资源，重载或内容变化不自动增加权限。该约束与架构 AC-2 一致，不是签名验证的替代，也不允许原生 Node／宿主 renderer 执行。正式来源、归档和市场仍归 S5。

五类桥能力按公开命名空间细化，不强制每类只有一个方法：项目上下文、工作区受限文件读取、已声明视图操作、提示及插件私有存储。主题／语言及桥握手作为宿主上下文；普通命令只映射到已声明视图或已开放宿主动作。大目录扫描、写入、后台 JS 和模型调用不由“只读”推导开放。

P0 明确资源路径、符号链接／真实路径、总大小／文件数量预算和错误码；P2 逐项实现。桥绑定真实发送页面、插件及激活代次，不能相信消息内自报 ID。只读协议限制插件自身静态资源，项目文件通过授权 API 读取；网络请求及导航均需限制，sandbox 本身不能证明网络已被禁止。旧 iframe 在 STUN 实测中泄漏 UDP，现改为独立离线 Session、宿主持有的拒绝代理及 WebRTC 策略，细节见首版契约。浏览器替身测试不替代 Electron 隔离证据。

## Alternatives considered

- Zip-first packaging — strongest case matches how users already pass folders around. The driver that rules it out is new attack surface: decompression plus zip-slip guards before the basic loop proves itself; folders plus an open-directory button cover debugging.
- Direct renderer import of plugin JS — offers React composition but collapses the normal plugin boundary. Local development does not enable it; any future trusted renderer mode needs its own contract.
- Do nothing / reuse hand-built integration — staying put keeps every current gate sufficient. The cost is that the B-plus-C decision never becomes buildable.

## Acceptance criteria

- [x] AC-1: A scaffold-built folder travels import, authorize, enable, use, disable, uninstall with no restart.
- [x] AC-2: Six bad-package error codes demonstrate end to end; overprivileged bridge calls refuse with log entries; three crashes auto-disable.
- [x] AC-3: The debug quartet works: linked-directory hot reload, bridge trace, log drawer, detached devtools.
- [x] AC-4: Verify plus the plugin gate stays green with new desktop cases; main holds no variable plugin import; the native page enforces CSP sandbox without same-origin or top-navigation and exposes no host preload API.
- [x] AC-5: 开发模式关闭时未签名目录不能执行，显式开启后只运行隔离页面；关闭、权限增加、重载和整应用重启均遵守来源与授权规则，复制安装不提升信任等级。
- [x] AC-6: 测试覆盖真实路径／符号链接越界、非法资源与网络／导航、伪造发送者、旧通道和项目切换迟到响应；拒绝有错误码和日志，用户数据及宿主会话不被清理误伤。

## Risks

- No-zip frictions real folder sharing; answer with a vouchered later version, not scope creep now.
- 原生隔离视图有布局、遮挡和进程成本；主题令牌经桥传递，快捷键仅保证宿主非编辑区域焦点，不转发插件键盘内容。
- 专用协议与隔离载体需真实 Electron 验证；若无法满足网络／导航约束，先报告并修订载体契约，不无提示回退联网浏览器或 localhost 服务。
- Permission creep on every feature request; each new bridge method needs a manifest entry plus review plus gate update.

## Verification

P2 的真实 Electron 证据及命令归[阶段交付记录](../../planning/plugin-platform-roadmap.md#p2-交付与验证)。AC-1、AC-3 已由仓库外打包 SDK 的双页插件验证；AC-5 由开发开关、复制来源与重启桌面用例，加上权限增加的单元负例共同支持。AC-2 补齐小堆真实 OOM 后两次握手后强制 renderer 崩溃，连续三次故障自动停用且宿主仍可操作；原有六类坏包、越权日志和三次真实握手超时继续保留。AC-4 在限制 4 worker 的完整 verify 中通过，默认高并发曾触发的语料超时未作修复。AC-6 增加真实 Git worktree 切换、根身份／KV 隔离及旧页面销毁，经桥拒绝 junction／hardlink 且留日志；确定性原生文件系统单元测试覆盖校验后置换父目录，以及真实已打开文件在新根实例建立后才完成读取的迟到拒绝。卸载保留数据、单独清理 KV 与宿主会话关闭回归由既有专项支持。桌面证据与检查点测试共同覆盖本条边界，不声称全部并发时序或跨平台通过。
