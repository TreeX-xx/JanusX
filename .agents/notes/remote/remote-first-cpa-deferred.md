---
{
  "schema": "harness-note/2",
  "id": "8f5bcccb-5178-4d02-b43c-8e8fe6baeaf2",
  "kind": "decision",
  "lifecycle": "archived",
  "created": "2026-10-07",
  "class": "architecture",
  "tags": ["0.9.1","remote","team","cliproxy","roadmap"],
  "updated": "2026-11-20T12:06:46Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/b653bb34-279f-45db-92d1-313d1c6bcdf5",
  "disposition": {"reason": "0.9.1 的排期取舍已结束，个人远程改用 Android 客户端，CPA 已独立作为官方插件分发。"}
}
---

# 0.9.1 的个人远程与 CPA 排序

## Problem

当时需要在个人跨设备继续开发、团队同步和多账号模型网关之间分配开发时间。已有 CLI 原生登录可以满足一部分本机开发需求。

## Decision

0.9.1 优先验证个人远程终端，将 CPA 和团队数据同步延期。当时拟采用 Web 控制端，原范围保存在[公网 Web 需求](requirements/public-web-terminal-foundation.md)。后续移动端转向[Android 配对与终端](android-pairing-handshake.md)。

## Alternatives considered

同时开发团队同步会将跨设备身份、资源授权与冲突处理带入首次连接验证。先集成完整 CPA 管理台则无法验证离开主机后继续操作终端的需求。

## Consequences

这项排序只适用于当时的版本。当前 CPA 通过可选官方插件提供托管进程与外部实例两种接入方式；原生 CLI 登录及 Janus 模型配置各自维护。安装边界见[CPA 插件说明](../../../plugins/cpa/README.md)，仓库发布清单见[0.9.10](../../../docs/releases/v0.9.10.md)。
