---
{
  "schema": "harness-note/2",
  "id": "6bf16027-53e7-4511-8166-65c8b37b9e67",
  "kind": "requirement",
  "lifecycle": "accepted",
  "created": "2026-10-23",
  "updated": "2026-10-28T07:10:00.000Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 启动开场编排（entrance choreography）

## Expected behavior

窗口打开是一段被真实就绪驱动的装配编排，按横带顺序入场，不是左右配对形式：

1. **启动（第一幕，只有 island 动）**：休眠墨点充能（呼吸点胀大）→ CRT 横线热身 → 裂成双眼（右眼延迟约 60ms 顺序启动）→ 自检双眨。形态契约取自 [planche 主题](./planche-theme.md)下的 `13-janus-planche.css` 折叠岛（52×26 纸胶囊 + 1.5px 墨边 + 墨眼，无文字无辉光）。
2. **顶部**：品牌字标 + 蓝图／工具箱工具组整条一起入场（标题栏无知识库入口）。
3. **底部**：状态栏就位；island 低头注视。
4. **中部**：工作区存在时 `TerminalSelector` 类型卡片逐个弹起（Shell/Janus/Claude/Codex/OpenCode/Pi，108px 卡规格）；无工作区时跳过卡片弹起，中部为 EmptyWorkspace「开始使用 JanusX」，左侧不出现工作区列表。
5. **左展开**（island 瞥左）→ **右展开**（island 瞥右）→ 收束回中，mini-idle 眨眼恢复。

右侧图标轨常驻窗口右缘，展开只把面板从轨左侧推开，轨不位移。窗口控制钮与 island 从第 0 帧起可交互。

## Timing data（2026-10-23 用户敲定）

| 参数 | 值 |
|---|---|
| 卡片 stagger | 100ms |
| 卡片弹起时长 | 180ms |
| 侧栏／面板展开时长 | 400ms |
| 卡片→左栏 beat | 150ms |
| 左→右栏 beat | 150ms |

固定锚点：启动 0 → 睁眼 120ms → 顶部 200ms → 底部 320ms → 卡片起点 420ms。6 卡全程 ≈ 2.20s，无工作区 ≈ 1.52s。超过 2.5s 视为预算超支。

## Acceptance criteria

- [ ] AC-1: 终点 = 用户布局：右栏目标为收起时跳过右展开动作，island 仍瞥一眼窄轨；不覆盖用户折叠偏好。
- [ ] AC-2: 任意输入跳过：序列期间任一键盘／指针输入立即落到终态，动画可中止；窗口控制钮全程可用。
- [ ] AC-3: 真实就绪驱动：卡片弹起由类型列表加载完成事件触发，不按固定时间轴造假等待；热启动快到无感时压缩中间帧。
- [ ] AC-4: 右轨常驻：展开／收起全程图标轨贴窗口右缘不位移，仅面板宽度过渡。
- [ ] AC-5: 唤醒为第一幕：t=0 起只有 island 动，充能→热身横线→裂眼自检完成后才轮到内容入场。
- [ ] AC-6: 横带顺序：顶部（字标+工具组同时）先于底部，底部先于左／右展开；品牌字标不与左栏绑定、工具组不与右栏绑定。
- [ ] AC-7: `prefers-reduced-motion` 直接呈现终态，不播编排。

## Reference

交互原型（时序可调、含跳过与场景分支）：`design/janusx-entrance-choreography.html`。类型卡片视觉契约见 `TerminalSelector`（`src/renderer/src/components/TerminalSelector.tsx`），island 形态见 [island 高保真对齐](../island-hifi-optimized-alignment.md)与 `13-janus-planche.css`。落地入口规划为 `useEntranceChoreography`（驱动 `setSidebarCollapsed`／`setPanelCollapsed` 与入场过渡），尚未实现。
