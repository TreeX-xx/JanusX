---
{
  "schema": "harness-note/2",
  "id": "97efe07c-2d7e-54c0-a4ac-a55cb12c8fc3",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-08-20",
  "class": "feature",
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-08-20-agent-note-account-system-lan-remote-control--97efe07c.md",
      "sourceHash": "d78bae25aabd8d65227e2e2f38a093ba86ad2387f4b912dad6f20263d5e1b703",
      "originalBodyHash": "67466892e267f2bdff70d69a0bf22b80a1291b7ccf771370207c914a2791f960",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Account-system LAN remote control. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-08-20-tob-lan-remote.md",
        "sourceHash": "d78bae25aabd8d65227e2e2f38a093ba86ad2387f4b912dad6f20263d5e1b703",
        "originalBodyHash": "67466892e267f2bdff70d69a0bf22b80a1291b7ccf771370207c914a2791f960"
      }
    }
  },
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5",
  "disposition": {"reason": "账号式 LAN 端到端控制已退出当前移动入口，配对原语与团队身份服务分别保留。"}
}
---

# 账号式 LAN 远控的历史设计

## Problem

团队成员访问同一主机的终端，需要同时校验设备、组织成员和工作区权限。

## Decision

早期设计将 LAN 发现、一次性配对、成员授权与宿主网关串接。当前仓库保留本地团队账户服务以及内存中的 `LanPairingCodes`。该类默认十分钟过期、只允许兑换一次，职责止于配对握手。当前 Android 由[独立手机会话](android-pairing-handshake.md)处理扫码、设备审批和终端归属。

## Alternatives considered

先部署组网或业务中继可以改变网络可达性，但仍需要定义谁能操作哪个终端。多人共同写同一终端还需要单独的控制权策略。

## Consequences

本地账号、成员和配对原语可分别验证。若恢复账号式 LAN 控制，仍需用真实网络入口验证成员撤销、每次操作的工作区授权与断线重连。
