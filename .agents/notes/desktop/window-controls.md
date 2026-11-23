---
{
  "schema": "harness-note/2",
  "id": "8d37d89b-3921-4b59-abcb-572c6cc0185c",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-20",
  "updated": "2026-11-20T08:41:59Z",
  "class": "architecture",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "codeRefs": [
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/renderer/src/components/WindowControls.tsx",
      "role": "implementation"
    },
    {
      "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
      "path": "src/main/windows/register-window-ipc.ts",
      "role": "implementation"
    },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/main/windows/main-window-resize.ts", "role": "implementation" },
    { "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c", "path": "src/renderer/src/components/MainWindowResize.tsx", "role": "implementation" }
  ]
}
---

# Platform window controls and internal close actions

## Problem

Desktop windows previously displayed macOS traffic lights on Windows. Internal dialogs and floating panels reused the same appearance even when minimize was unavailable or actually closed the panel.

## Decision

Shared modal reveal focuses the panel only when focus is outside the panel. A field already focused by the user keeps focus while the first animation frame reveals the dialog; otherwise an early Enter can miss the editable draft. The plugin handoff browser regression verifies newline entry, preservation across project changes and bracketed paste without submission.

Main, standalone editor, browser and editor-loading windows share WindowControls. Windows and Linux show minimize, maximize/restore and close at the right; macOS shows traffic lights at the left. Existing application themes and centered Island remain. Platform indicator colors are explicit, bounded exceptions in the theme audit; ordinary chrome uses theme tokens.

On macOS the 14-point lights sit on 23-point centers with a 9-point leading inset. The group reveals its close, minimize and diagonal zoom glyphs on hover. Inactive windows use neutral lights. The native BrowserWindow supplies focus state even when an embedded web view owns keyboard focus.

The macOS main window reserves a 7-point strip inside each edge and combines adjacent strips at the corners. These handles provide an alternate gesture when the system frame does not pick up the drag. During a gesture the renderer captures the pointer and sends screen-coordinate deltas at most once per frame. The host accepts them only from the main window's top frame, anchors the opposite edge, clamps dimensions to native limits and the starting display, and ignores resize gestures while maximized or fullscreen. Losing capture or focus ends the gesture. The resize handles share the existing custom titlebar layout.

Window IPC targets the requesting webContents rather than whichever window currently has focus. An initial query and native maximize/unmaximize events keep the restore affordance synchronized, including external window changes. Close callbacks retain the main exit confirmation and editor unsaved-file guard.

Window IPC is registered once during application bootstrap; its main-window getter follows replacements. Dock activation and a second-instance request share the main-window restore path: create a missing window after readiness, otherwise restore/show/focus it, and do nothing during shutdown. Hidden auxiliary windows do not block this path. The [Mac compatibility Note](./macos-compatibility.md) owns implementation status and the remaining native Mac acceptance.

主界面退出确认使用 PromptDialog，组件直接加载独立 PromptDialog.css，定位、遮罩、按钮及输入样式不再隐式依赖旧蓝图工作台的 blueprint.css。蓝图退出宿主入口后，旧依赖曾导致确认框没有 fixed／flex 居中样式，落在 body 内容末尾。样式随共用组件加载，颜色使用宿主主题令牌，遮罩保持 13500 层级；调用者继续负责原有 portal，取消／Esc／遮罩只取消，确认才调用窗口关闭。减少动画偏好关闭入场效果。

Internal dialogs use a visible close mark at the right on both platforms. FloatingPanel offers its local expand/restore action only when supported, plus close; the misleading minimize action is removed. Session dialogs, blueprint and knowledge headers, and toast dismissal follow the same close affordance. Workbench target geometry is owned by [workbench-close-hit-slop](../workbench/workbench-close-hit-slop.md).

## Alternatives considered

Keeping traffic lights everywhere preserves the previous appearance but conflicts with Windows placement and action expectations. Native system titlebars provide more OS behavior, but replacing the existing frameless chrome would require a separate layout and Island integration. The shared custom component keeps the current layout with one platform policy.

## Consequences

The macOS Electron regression uses a fresh profile and renderer pointer input. It checks actual `BrowserWindow` bounds after corner and edge drags, the minimum width, and hidden handles while maximized. It also covers closing and reopening the main window. Physical pointer input and the installed application were outside this run.

The window-lifecycle change passed 21 scoped unit tests and the new desktop-window-reopen Electron test on Windows. The desktop test keeps a hidden auxiliary window, closes/reopens the main window three times, checks that editor event listener counts stay at one, exercises maximize state round trips, and restores minimized/hidden windows. The Mac arm64/x64 source probe passed 18 window checks, including ten reopen cycles per architecture. TypeScript, build:check and scoped entry ESLint passed. Evidence is in artifacts/macos-window-fix; the Windows fixture temporarily keeps only its own test process alive, so real macOS Dock and native focus remain not-run.

Custom Windows buttons do not provide the native maximize-hover Snap Layout flyout. macOS green retains maximize/restore rather than native fullscreen. macOS styling is tested with a simulated platform, not on a macOS machine. Native titlebar double-click is not covered by browser-synthesized pointer input. Revisit if native fullscreen or Snap Layout support becomes a requirement.

Verification is in tests/e2e/window-controls.spec.ts: four platform/theme combinations exercise placement, state labels, guarded close, panel actions and keyboard dialog dismissal; a Windows Electron case exercises native maximize events, restore, minimize and exit-confirmation cancellation. All five window-control cases passed. The editor window-sharing and native-close/save-failure/discard cases also passed. npm run typecheck, npm run build:app, npm run theme:check, npm run i18n:check, npm run check:notes and scoped ESLint passed (Notes reported existing cross-repository link diagnostics). The existing planche unit suite has an unrelated FileEditor filetab-close source assertion that no longer matches the pre-existing unified-editor refactor.

Additional regression gap: the existing HTML editor preview case in tests/e2e/editor-window-tabs.spec.ts fails waiting for .monaco-editor after its iframe checks pass, including when rerun under the desktop project timeout. This change does not modify HTML preview/editor mode switching; that regression remains unresolved. The targeted unit run passed 23 of 24 cases, with the source assertion described above failing.


退出确认修复的本轮验证：tests/e2e/blackboard-plugins.spec.ts 与 chat-conversation-delete.spec.ts 共 12 项通过，覆盖真实 Titlebar 在未打开蓝图时居中、1280×720／800×480 几何、退出与取消路径及聊天删除确认。主题回归通过实际主题 store 切换，另断言打开弹窗后主题没有被遮挡协调恢复成默认值；两项重新通过并查看 Planche／深色截图。file-explorer-delete 与 blueprint-host-boundary 单元共 11 项通过，PromptDialog.tsx ESLint 通过（E2E 文件按仓库配置忽略）。npm run theme:check 未通过：12 项报告均在本轮未改动的 Janus foundation 与 plugin-workbench 样式，本轮新增的 PromptDialog.css 无新增主题审计项。全仓 Notes 校验仍保留 entrance-choreography.md 的缺 AC 与更新时间早于创建两项既有错误。验证为 Chromium 组件集成，本轮未重建完整 Electron 应用或重启用户运行窗口。
