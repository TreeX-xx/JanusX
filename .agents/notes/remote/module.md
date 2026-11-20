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
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/remote/mobile-host.ts", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/companion/gateway.ts", "symbol": "CompanionGateway", "role": "entry"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/hosted/github.ts", "symbol": "detectProvider", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/hosted/gitlab.ts", "symbol": "GitlabProvider", "role": "implementation"}
  ],
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# 远程控制与托管协作

## Responsibility

远程终端在开发电脑上执行。Android 客户端配对后操作该设备获准使用的终端，飞书入站请求经过会话网关。GitHub 与 GitLab 的托管协作走本机 CLI 和仓库适配器。

## Design

桌面启用手机远控后选择工作区并生成限时邀请。Android 扫码，宿主批准设备，双方通过信令交换 SDP 与 ICE，在有序 WebRTC DataChannel 上传送终端操作和输出。断开连接保留电脑上的进程，重连按身份与序号恢复，重试创建用请求身份去重。LAN 限定构建拒绝公网信令和 STUN 配置，开发构建可用于跨网验证。[Android 配对握手](android-pairing-handshake.md)记录版本、设备和网络验收范围，[移动终端需求](requirements/android-remote-terminal.md)保留完整 AC。

[会话网关](remote-control.md)为飞书入口核验调用者、终端绑定和动作令牌。账号式 LAN 控制与早期浏览器试验的限制分别见[历史 LAN 方案](tob-lan-remote.md)和[连接试验](connection-lab.md)。[团队身份](tob-identity.md)、[团队同步](tob-transport.md)和[无账号协作](ideas/account-free-team-collaboration.md)涉及独立的成员与共享数据设计。

[GitHub](hosted-github-reviews.md) 和 [GitLab](gitlab-provider-reviews.md) 适配器通过 gh、glab 处理对应平台的仓库协作。[仓库侧栏](../workbench/ideas/repository-sidebar.md)维护列表、详情与操作入口。

## Acceptance criteria

以下保留 2026-09-26 文档组织验收；数量是历史快照，勾选不证明团队路线全部交付。

- [x] AC-1: 本域 10 篇直接子全部携带有效 parent。
- [ ] AC-2: gateway 与 launch 上下篇关系保留，不合并草案与落地。
