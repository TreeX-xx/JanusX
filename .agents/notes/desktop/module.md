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
  "updated": "2026-11-20T12:06:46Z",
  "moduleState": "partial"
}
---

# 桌面与分发

## Responsibility

桌面宿主装配 Electron 启动、窗口、IPC、应用数据目录和退出清理。平台适配与分发在这里维护；终端、会话与插件各自定义领域行为。

## Design

启动及退出时按[应用配置目录](application-profile.md)和[退出顺序](application-shutdown.md)组织宿主服务。工作区私有状态按稳定身份保存在应用数据目录；迁移条件、旧目录清理和恢复限制见[工作区存储](workspace-state-storage.md)。[窗口控件](window-controls.md)与[平台边界](platform-runtime-boundaries.md)维护 Windows 和 macOS 的差异。

发布流水线使用固定依赖和平台对应的打包输入。[交付设计](release-delivery-design.md)维护本地构建与发布的分工，[依赖闭包](packaged-hoisted-deps.md)维护安装包所需运行时，[验证入口](reproducible-verification.md)记录可复验的环境。插件的签名分发与宿主安装包分别验证；版本及具体资产可从[0.9.10 说明](../../../docs/releases/v0.9.10.md)追溯。

[README 展示](readme-showcase.md)、[账号迁移](account-migration.md)与[更新机制](app-auto-update-win.md)分别维护演示、公开来源和升级行为。

## Acceptance criteria

以下保留 2026-09-26 文档整理的验收原文与勾选状态，供旧 Task 引用；其中篇数是当时快照，不是当前模块大小，新增工作也不强制改写历史 parent。

- [x] AC-1: 本域 21 篇直接子全部携带有效 parent。
- [ ] AC-2: 两篇正名文件后缀与 id 一致，无 flat-layout 违规残留。
- [ ] AC-3: github-maintenance 归属产品面，本域不重复收纳。
