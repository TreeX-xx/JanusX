---
{
  "schema": "harness-note/2",
  "id": "b653bb34-279f-45db-92d1-313d1c6bcdf5",
  "kind": "module",
  "lifecycle": "accepted",
  "created": "2026-09-26",
  "class": "architecture",
  "tags": [
    "remote",
    "hosted"
  ],
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/636764b9-0105-4944-91f7-72fcbd3c4869"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/bda5aa81-dc65-4408-9544-60fdfdf8c836"
    }
  ],
  "parent": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b2e7f160-2d77-4cc4-8828-b9cf3e5d931a",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/companion/gateway.ts",
      "symbol": "CompanionGateway",
      "role": "entry"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/hosted/github.ts",
      "symbol": "detectProvider",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/hosted/gitlab.ts",
      "symbol": "GitlabProvider",
      "role": "implementation"
    }
  ],
  "updated": "2026-11-03T10:03:13Z",
  "moduleState": "partial"
}
---

# 远程控制与托管协作

## Responsibility

通过 CompanionGateway 校验远程会话操作，并通过 HostedProvider 适配 GitHub 与 GitLab 的 issue、review、检查及合并。网关负责上下文验证、动作令牌、去重与审计；托管适配通过现有凭据和本地工作树流程协作。远程创建终端仅允许 claude、codex、opencode，janus、pi、dsh 不因本地状态接入获得远控能力。

## Design

v0.9.4 远程功能收口为局域网测试：桌面发布构建默认只使用内置信令，不开放公网信令或 STUN；开发构建保留跨网实现与原配置。Android 提供独立包名的 LAN 测试 APK，可与现有开发版共存。用户于 2026-10-22（北京时间）确认 Android 空白屏已经修复并经真机验证；手机端显示和界面设计优化、长期使用测试及进一步跨网开发移至 v0.9.5。构建开关、限制边界与验证证据见[配对握手](./android-pairing-handshake.md#v094-局域网测试发行与-v095-边界)。

模块覆盖已存在的受控网关与托管平台入口，不声明完整团队身份、服务端同步或 LaunchSurface 已实现。ToB 身份及传输文档保留原生命周期，其计划需要独立交付；下列历史 LAN 决策也不能替代对当前身份及授权实现的核验。远程对象是会话与工作流，不是整机桌面或任意键鼠控制。

用户提供的 `Unexpected token ?` 将空白故障指向 WebView 无法解析 Chrome 80 目标 bundle；0.1.12 改为 Chrome 58 语法构建并避免 globalThis 运行时依赖，保留首个脚本错误并记录实际引擎版本。本地 favicon 不再产生 CSP 假故障，详见配对握手专题的 WebView 兼容记录。用户已确认空白故障修复；该确认不等于旋转、弱网、长时会话等完整验收。

当前实现是 Android 原生 App + Electron 隐藏 WebRTC 主机：扫码载荷包含信令地址、临时邀请和配对密钥，电脑审批设备后才允许单工作区终端控制。业务使用有序 WebRTC DataChannel，信令只转发 SDP/UDP ICE，TURN 和业务中继被拒绝。电脑端通过现有 terminal manager 真实创建 Claude Code，输出序号回放、输入请求去重和断线保活已落地。旧浏览器、LAN/账号远控、web-test gateway 和 remote-lab 验证代码已移除；scripts/android-lab 仅保留 Android 构建与底层链路工具，尚未替代真实异网手机验收。

首版目标见[Android 真实远程终端需求](./requirements/android-remote-terminal.md)：手机配对独立于账号与组织系统，电脑开启后生成二维码，手机扫码并由电脑确认授权。Android 0.1.1 新增应用内相机扫码（ZXing Embedded 4.3.0 本地识别），有效的 v1 JSON 自动填入并连接，校验版本、地址、密钥格式及过期时间；取消、拒绝权限时保留手动粘贴。相机为可选硬件，进入扫码页会断开已有前台连接。连接后可在指定工作区真实新启动电脑端 Claude Code，并持续接收流式输出和提交输入；代码落地不代表真机相机或异网终端验收已完成。

真机反馈相机预览持续无法识别后，Android 0.1.2 扩大扫描范围、启用连续对焦并隐藏红色指示线；电脑二维码从约 176px 显示区域扩大至最大 320px，以整数比例生成并保留四模块留白。旧版本只验证相机启动，不等于镜头解码通过；新版二维码的浏览器显示图在 1、1.25、2 倍像素密度下由同版 ZXing 核心成功解码，仍需真机光学扫描复验。

[Android 与桌面配对握手](./android-pairing-handshake.md)维护 0.1.3 的 CJS 沙箱通信桥、资源定位、双向 SDP 签名及 hello 时序处理。电脑面板自动刷新审批，手机创建后自动订阅输出；真实 Electron 与 Android 模拟器已验证本机 UDP 配对、审批和新启动 Claude Code 输出，尚未替代异网真机验收。

同一专题维护开关与屏幕显示：Android 远程默认受 `remoteControl` 关闭，在设置的通用页独立启用，关闭开关断开手机但保留电脑终端；桌面默认授权当前工作区，右侧栏底部手机图标提供配对入口和连接状态，面板可跳转对应工作区。桌面不再保留底栏。安卓离线 xterm 替代原生文本追加，处理 ANSI/VT、有限回放与序号缺口，默认适宽并支持字号调整及横向查看。主机共享 PTY 几何尺寸，手机避免与桌面争用 resize；模拟器证据仍不能替代真机跨网和长期使用验收。

可靠有序通道不等于断线恢复，仍需设备配对与审批、持久身份、请求去重、输出恢复和网络切换策略。蓝图与知识库团队同步属于后续目标；无账号的长期设备信任与团队连接正在讨论，未确认为已实现设计，当前消息实验不代表数据同步已实现。

0.1.5 修复默认 LAN 信令无法供蜂窝网络访问的配置缺口：桌面可选择 LAN 网卡或公网 wss 信令、保存 STUN 设置，Android 区分信令/协商/UDP 失败；隐藏窗口容忍选中路径统计延迟，信令瞬断保留已打开通道。[配对握手](./android-pairing-handshake.md)维护原因、独立信令构建与验证边界。当前电脑已提供依赖后台进程的临时 Cloudflare 公网信令入口，并通过公网 WSS 协商与心跳测试；它不是产品默认公共服务，真实手机异网 UDP 可达性仍待验证。

0.1.6 优先完善纯 UDP 直连，不引入 TURN：双方先发送签名 SDP 再发送候选，以 ICE ufrag 隔离旧轮次；电脑建连最多三轮，每轮 20 秒，手机保留失败轮次的信令并随新 offer 重建原生连接，避免首次 ICE/PEER FAILED 就终止全部尝试。Android 持续收集可用网络候选，记录 IPv6、候选实际应用和检查应答；快速重连立即释放旧 socket，尚未入房的 1008 拒绝可短暂重试。39 项桌面单测、6 项 Java 单测及最终 17 项本机联调通过，包含首轮阻断后连接成功和临时占房后的同终端重连；这些措施不声明已定位或解决真机异网失败。长期公网信令需由产品维护方运营固定入口并预置，避免每位用户配置；Cloudflare Workers signaling is deployed and bundled as the current default after the user reported phone health-check reachability; phone WSS and cross-network UDP remain unverified.

[连接验证工具](./connection-lab.md)保留早期网络测试与中继讨论，[公网 Web 终端需求](./requirements/public-web-terminal-foundation.md)保留历史验收；模拟器测试不能替代真实跨网证据。CGNAT、双重 NAT 或一次失败不能单独证明所有 UDP 打洞都不可行，STUN 获得公网映射也不能证明没有 CGNAT。无中继方案无法保证任意网络可达；原生 App 不消除 NAT 与防火墙限制。

[公网直连设计草案](./public-relay-design.md)、[远程优先决策](./remote-first-cpa-deferred.md)和[主机组织提案](./host-owned-organization.md)保留背景与候选设计。生产身份与组织授权仍需核验，不能仅因传输成功就开放远程操作。

方向与发射：[gateway 已落地](./remote-control.md)为方向上篇，[launch-surface 草案](./launch-surface-remote-visualization.md)为投影下篇，互链保留。

ToB 三部曲：[identity](./tob-identity.md)、[transport](./tob-transport.md)、[lan-remote](./tob-lan-remote.md)按身份到传输到控制排序。

Hosted 双适配以[orca-dual 纲](./requirements/orca-hosted-dual-github-gitlab.md)为目：[gitlab-config](./gitlab-provider-reviews.md)、[gitlab-reviews](./gitlab-provider-reviews.md)、[github-reviews](./hosted-github-reviews.md)、[automerge](./hosted-github-reviews.md)为目。

## Acceptance criteria

Cloudflare 免费信令保留用于开发构建，Pages 入口复用原 Worker；v0.9.4 发布构建不使用该入口。Android 空白屏修复已有用户真机确认，完整 AC-3/AC-8 与长期使用仍需补充验收。AC-9 二维码倒计时及自动刷新、AC-10 桌面连接状态已经实现并有单测/模拟器证据，完整真机验收不自动勾选。当前状态见[配对握手](./android-pairing-handshake.md)和[部署说明](../../../scripts/remote-lab/cloudflare/README.md)。

以下保留 2026-09-26 文档组织验收；数量是历史快照，勾选不证明团队路线全部交付。

- [x] AC-1: 本域 10 篇直接子全部携带有效 parent。
- [ ] AC-2: gateway 与 launch 上下篇关系保留，不合并草案与落地。
