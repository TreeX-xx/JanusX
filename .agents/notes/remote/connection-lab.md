---
{
  "schema": "harness-note/2",
  "id": "c4e713ef-78b9-4d93-aaf5-37d48df42a3c",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-10-12",
  "updated": "2026-11-20T12:06:46Z",
  "class": "architecture",
  "tags": ["remote", "validation", "webrtc", "oauth"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/cd5b3e52-1610-4842-b04f-3ca9b2fa1759"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/73984092-d377-4871-81bb-38d62c160f75"}
  ],
  "codeRefs": [
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "scripts/remote-lab/protocol.mjs", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "scripts/remote-lab/nat-probe.mjs", "role": "implementation"},
    {"repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "scripts/remote-lab/tests/protocol.test.mjs", "role": "test"}
  ],
  "disposition": {"reason": "浏览器试验和业务中继已退出当前 Android 产品路径；保留跨网证据边界与原始试验版本。"}
}
---

# 公网连接试验与传输取舍

## Problem

同机浏览器可以交换信令并建立连接，真实手机在另一网络却可能停在 ICE 协商。需要把信令、候选路径和业务恢复的测试结果分开记录。

## Decision

早期试验用浏览器对端、合成终端与公网信令验证配对、请求去重、输出序号和回放。异网复测出现过信令已达而数据通道仍未建立。曾讨论用用户自建的 WSS 中继转发加密数据；该方向没有进入 Android 终端。当前传输、配对与审批由[Android 配对握手](android-pairing-handshake.md)维护。

## Alternatives considered

业务中继能覆盖部分 UDP 受限网络，同时引入可用性、成本和密钥管理责任。Android 方案选择有序 DataChannel 和仅交换协商信息的信令服务。在限制 UDP 的网络，客户端需要报告失败并允许重试。

## Consequences

NAT 探针反映一次测量的映射，单次 ICE 失败不足以确定故障位于哪一端。模拟器能验证协议和恢复流程，真实异网连通性需要两端在相同轮次的候选、选中路径和业务收发证据。[原 Web 验收](requirements/public-web-terminal-foundation.md)保留独立编号。

原方案、逐项试验记录与当时的限制保存在 Git `6ed1bd4190921de520d9c98e746c7b83bc4e4660:.agents/notes/remote/connection-lab.md`。
