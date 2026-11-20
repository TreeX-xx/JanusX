---
{
  "schema": "harness-note/2",
  "id": "8ac68f05-8b94-52c1-809a-b75176904195",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-04",
  "class": "architecture",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-04-agent-note-remote-control-direction-and-gateway--8ac68f05.md",
      "sourceHash": "a783046f60940ae7e9b85408ed5a407558262acf7301b96b313ff64f01b9320b",
      "originalBodyHash": "fd9a9f569b7e0c65ec52a68ecde28f2ce18b12b7f6c8b10c32e9e3e0add3f175",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Remote control direction and gateway. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/architecture/2026-09-04-remote-control.md",
        "sourceHash": "a783046f60940ae7e9b85408ed5a407558262acf7301b96b313ff64f01b9320b",
        "originalBodyHash": "fd9a9f569b7e0c65ec52a68ecde28f2ce18b12b7f6c8b10c32e9e3e0add3f175"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5"
}
---

# 远程会话控制与宿主网关

## Problem

远端操作需要把请求绑定到用户、工作区和终端。直接提供整机控制会越过这条授权边界。

## Decision

飞书入站运行时通过 `CompanionGateway` 处理允许的会话操作。网关结合调用方策略、终端绑定、动作令牌、请求去重和审计后交给宿主执行。具体入口为[飞书运行时](../../../src/main/remote-notifications/feishu-inbound/runtime.ts)和[网关](../../../src/main/companion/gateway.ts)。

Android 使用[手机宿主](../../../src/main/remote/mobile-host.ts)及独立的 `MobileSession` 路径，按设备审批、终端所有权、请求身份和序号控制操作与输出恢复。[Android 配对握手](android-pairing-handshake.md)维护连接条件。

## Alternatives considered

整机桌面共享能传递界面与按键，但扩大设备权限。仅通过聊天渠道接入可以复用消息平台，无法完整呈现持续变化的终端输出。

## Consequences

两个入口共享宿主执行终端这一业务边界，各自验证调用身份、允许的动作和恢复语义。新的团队连接方式需要先确定成员及资源授权；原方案见[账号式 LAN 远控](tob-lan-remote.md)。
