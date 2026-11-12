---
{
  "schema": "harness-note/2",
  "id": "f0260b8c-93ec-47d7-9524-05a0abb1db0c",
  "kind": "task",
  "lifecycle": "accepted",
  "created": "2026-11-10",
  "updated": "2026-11-10T16:36:35.294Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "work": {
    "scope": [
      {
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "paths": [
          "README.md",
          "README.zh-CN.md",
          "docs/assets/readme/plugin-management.png",
          ".agents/notes/desktop/readme-showcase.md",
          ".agents/notes/desktop/tasks/readme-plugin-management-image.md"
        ]
      }
    ],
    "acceptanceRefs": [
      {
        "uri": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f0260b8c-93ec-47d7-9524-05a0abb1db0c",
        "criterionId": "AC-1"
      },
      {
        "uri": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f0260b8c-93ec-47d7-9524-05a0abb1db0c",
        "criterionId": "AC-2"
      },
      {
        "uri": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/f0260b8c-93ec-47d7-9524-05a0abb1db0c",
        "criterionId": "AC-3"
      }
    ],
    "verification": [
      {
        "id": "V-1",
        "kind": "manual",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "description": "核对原始截图、界面色值及插件实际状态。"
      },
      {
        "id": "V-2",
        "kind": "manual",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "description": "预览中英文 README 在桌面与窄屏的显示效果，并检查图片引用。"
      },
      {
        "id": "V-3",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "git",
        "args": [
          "diff",
          "--check"
        ]
      }
    ],
    "review": "self"
  }
}
---

# 更新 README 插件管理截图

## Scope

在隔离的 JanusX 桌面实例中打开设置 → 插件 → 已安装，制作一张经典黑主题的静态图。画面集中展示导入插件包入口、官方插件列表及实际启用状态。按可用的官方安装包选用 Blueprint、CPA、Docker。两版 README 在插件表格之前共用这张图，蓝图功能展示留给下一项素材。

## Acceptance criteria

- [x] AC-1: 截图来自当前 JanusX 的真实设置界面。导入插件包入口、插件名称和实际状态清楚可见，所展示的条目由隔离配置中实际导入的官方包产生。画面无个人账号、凭证或本机私有路径。
- [x] AC-2: 成品为 PNG，保留经典黑主题的界面原色。按 README 展示宽度检查关键文字和状态，窄屏可打开原图。图内及图下不添加说明小字或水印。
- [x] AC-3: 中英文 README 的插件章节仅替换表格前的占位图，引用同一 PNG 并提供各自语言的替代文本。表格后的蓝图占位及已有图片保持原样。

## Verification

- V-1 核对原始帧与成品的主要界面区域和色值，确认画面中的插件与隔离实例内的安装状态一致。
- V-2 在桌面和窄屏预览两版 README，确认图片能加载并打开原图，另检查蓝图占位位置。
- V-3 检查差异中的空白错误。
- 在 [README 展示记录](../readme-showcase.md) 补记实际使用的 JanusX 构建、插件、成品规格和验证结果。

## Progress

- 右侧工作台动图已获用户认可，本任务接续插件章节的首张静态图。
- 已在隔离的 JanusX 0.9.9 中完成官方包导入、截图、双语 README 接入和自检。

## Evidence

- [成品 PNG](../../../../docs/assets/readme/plugin-management.png) 为 1040×760，与设置弹窗原始截图逐字节一致。SHA-256 为 11baf1b5e44b1cac9f770675a98f9173019d77b1c2d53d3d73f5aadf628d4005。
- 已验证 Blueprint 1.0.8 已启用，CPA 1.0.0 与 Docker 1.0.0 已安装并停用，三项均由官方发布包经导入入口安装。
- [英文 README](../../../../README.md) 与 [中文 README](../../../../README.zh-CN.md) 在 1280px 和 390px 浏览器视口均可加载并打开原图，蓝图占位仍在插件表格后。git diff --check 通过。

## Handoff

- 插件管理截图已完成，下一张素材为独立的蓝图功能截图。
