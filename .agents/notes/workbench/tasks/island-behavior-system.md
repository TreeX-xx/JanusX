---
{
  "schema": "harness-note/2",
  "id": "018a168e-df09-4bfd-b7f9-935d78b7b032",
  "kind": "task",
  "lifecycle": "draft",
  "created": "2026-10-23",
  "class": "feature",
  "tags": ["island","animation","behavior","notification","persona","gaze"],
  "work": {
    "scope": [
      {
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "paths": [
          "src/renderer/src/components/janus/JanusEye.tsx",
          "src/renderer/src/components/janus/JanusIsland.tsx",
          "src/renderer/src/components/janus/janus-island.css",
          "src/renderer/src/components/janus/styles/01-janus-foundation.css",
          "src/renderer/src/components/janus/useIslandGesture.ts",
          "src/renderer/src/components/janus/islandNotifications.ts",
          "src/renderer/src/components/janus/janusBehavior.ts",
          "src/renderer/src/i18n/locales/",
          "tests/unit/",
          ".agents/notes/"
        ]
      }
    ],
    "acceptanceRefs": [
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-1"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-2"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-3"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-4"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-5"},
      {"uri":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/018a168e-df09-4bfd-b7f9-935d78b7b032","criterionId":"AC-6"}
    ],
    "verification": [
      {
        "id": "V-1",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npm",
        "args": ["run","typecheck"]
      },
      {
        "id": "V-2",
        "kind": "command",
        "required": true,
        "repoId": "972afef3-2fc7-49de-a3ee-7e041225d28c",
        "cwd": ".",
        "program": "npx",
        "args": ["vitest","run","tests/unit/janus-behavior"]
      }
    ],
    "review": "self"
  },
  "updated": "2026-10-24T00:05:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/2a85ca64-bc0b-48b1-91b5-a89c44e13321" },
    { "type": "related-to", "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/e22d4cdb-c2aa-5a6c-ae54-945ea26e91ce" }
  ]
}
---

# Janus 眼睛行为与通知系统移植

## Goal

按 2026-10-23 实验台定稿，把折叠胶囊从 `mini-idle` 8s 死板循环升级为注意力行为系统，并把通知改为胶囊传话 + 点击式通知中心。可玩原型（设计源）：`_design/janus-eye-behavior-lab/Janus Eye Behavior Lab.html`，含 A/B 对照（旧循环）、6× 放大镜、行为日志与 Playwright 验证脚本（verify-lab2–5，交互断言全绿）。与[功能形象探索](../ideas/janus-functional-character.md)互补：本任务只改现有眼睛与通知面，不引入新角色形象；与[hifi 通知胶囊](../island-hifi-optimized-alignment.md)分工：一级展开（peek）通知胶囊仍归 hifi 层，本任务只动折叠胶囊态与新增历史面。

## 设计定稿

手感参数（用户实测选定，2026-10-23）：感知半径 **250px**、驻留 **3.0s**、跟随阻尼 **0.12**、眼动幅度 **2.4px**、头部微移 **1.0px**。生理参数：眨眼间隔 2.2–6.5s 非均匀随机、双眨概率 0.18、游荡间隔 4.5s±40%、疲劳阈值 3 次、疲劳休息 6s、闭眼享受 2.2s。

四层模型（层间叠加，行为输出只走 CSS 变量 `--gaze-x/--gaze-y/--lid/--face-x/--face-y`，视觉样式留 CSS）：

1. **生理基线**：非均匀眨眼、双眨、扫视前眨眼（真实眼动特征）、呼吸；眨眼间隔不等距是"不死板"的根源。
2. **注意力调度**：吸引（感知半径+指针新鲜）→ 驻留跟随 → 主动移开（朝反方向偏置）→ 疲劳休息（忽略鼠标）→ 自主游荡（70% 微漂 + 30% 扫视，analytics 态横向定格像读数据）。
3. **模式配比**：order 全量凝视；running 凝视降权（×0.35）；sleep 单点呼吸+droop；analytics 读扫。
4. **事件原语**：flinch（压扁回弹+急眨眼）、nod、fail 垂眼、greet 双眨；**摸头闭眼**：鼠标停胶囊上 → 慢速闭眼享受（2.2s）→ 自己睁眼偷看（2.8s）→ 循环；闭眼时点击=惊醒（跳进偷看）。flinch/惊醒**不占点击手势**，均作为 peek 展开的伴随反应（见 P5 手势仲裁）。

通知系统（替代侧边弹卡）：

- **串行传话**：胶囊横向展开 52→272px（眼在左、话在右，皮肤一体），清嗓眨眼 → 眼神扫向文字"念"→ 念完移开 → 收起；排队时 hold 缩短 1.9s。收起当前条**队列必须续播**（曾有连坐清定时器的 bug，修复为 keepQueue）。
- **未读计数**：舞台左上角灰色小字（mono 10px，如「通知 3」），**不做胶囊角标**；可点击打开通知中心。
- **通知中心**：点击入口（灰字计数 / 传话胶囊可点 / peek 历史入口）→ island **整体纵向展开**（52×26 → 302×136，眼在左上与标题并排），不悬浮面板，**不占用下拉手势**；内容含 mono 时间戳+正文。**看过即焚**：收起时逐条 stagger 溶解清空历史与计数。展开高度按最终内容宽（276px）测量——宽度过渡中途量高会因长文案折行量出虚高（实测 283px 坑）。
- 打开通知中心=已读：清空传话队列；传话中打开先中断当前条。

降级与红线：`prefers-reduced-motion` 全行为静止化（仅透明度）；旧 `mini-idle` keyframe 从 order 态退役（保留 A/B 对照期后删除）；rAF 只写 CSS 变量，指针静止后停帧；调度器纯逻辑、时间/随机可注入以便单测。

## Scope

**P1 行为内核**：新建 `janusBehavior.ts`（GazeScheduler/Blink/Reaction 纯逻辑，含吸引·驻留·移开·疲劳·游荡·摸头循环状态机）+ `useJanusGaze()`（rAF 桥、CSS 变量输出、闲置停帧、reduced-motion 降级）；`01-janus-foundation.css` 的 `mini-idle` 由 var() 驱动 transform 替代，EQ/scan 模式 keyframe 保留。参数默认值=定稿值。

**P2 事件与摸头接入**：JanusIsland 折叠态接 hover 判定（胶囊+14px 容差）与摸头闭眼循环；flinch/nod/fail/greet 映射真实事件。实现时修订（2026-10-24）：peek 展开首帧即隐藏胶囊（`island-expand-from-pill` 放大的是 `.janus-expanded`），「展开伴随」改挂**单击即时回调**（`onQuickTap`，420ms 单击仲裁期内播放、胶囊仍可见；惊醒=闭眼时点击的 kernel 内逻辑不变）；nod=流式下降沿且无错误、fail=错误出现上升沿、greet=工作区切换落定。摸头与 hover 呼吸分层共存（呼吸在 island、凝视在眼组 transform 链），拖拽（is-dragging）期间摸头挂起（`suspendRef`），与呼吸的 `:not(.is-dragging)` 对齐；`useIslandGesture` 仅增量接口（onQuickTap/isDraggingRef），下拉路径零改动。

**P3 胶囊传话 + 队列 + 计数**：通知到达走 `islandNotifications.ts` 统一入口 → 串行传话队列（收起续播、面板打开清队）；左上角灰色计数与历史一致；替换现行折叠态通知弹出（peek 一级展开通知胶囊不动）。

**P4 通知中心**：点击入口展开 island 通知面（灰字计数、传话胶囊可点、peek 历史入口三路；高度测宽陷阱见上）、看过即焚（stagger 溶解）、历史数据源接入、空态；与 `island-hifi` 通知面样式令牌对齐。

**P5 手势仲裁与收尾**：**仲裁已定案（2026-10-23 采纳 B 案）**：下拉 ≥60px 保持副黑板专属语义（toggle + 0–60px 全程跟手预览 + <60px cancel，见[下拉副黑板](../island-blackboard.md)），`useIslandGesture` 下拉路径**零改动**；通知中心不占用下拉，只走点击入口；flinch/惊醒降级为 peek 展开伴随反应，单击 peek / 双击控制台语义零改动（实验台的轻点=惊跳手势不移植）。收尾：reduced-motion、aria-label、i18n 文案、`mini-idle` 退役清理。

## Acceptance criteria

- AC-1 调度器单测覆盖吸引/驻留/主动移开/疲劳/游荡/摸头循环/续播队列，默认参数=定稿值（V-2）。
- AC-2 order 折叠胶囊支持鼠标跟随与摸头闭眼循环；reduced-motion 下静止降级无报错。
- AC-3 通知串行传话不丢队（中途收起续播、面板打开清队语义固定）；左上角计数与历史条数一致。
- AC-4 点击入口展开通知中心：眼在左上、内容完整不裁切；收起看过即焚清空历史与计数。
- AC-5 下拉手势保持副黑板专属语义不被通知中心占用（≥60px toggle、0–60px 跟手预览、<60px cancel 不变）；通知中心经灰字计数/传话胶囊/peek 历史入口可达；flinch/惊醒为 peek 展开伴随反应，单击/双击语义零改动。
- AC-6 order 态不再使用 `mini-idle` 8s 循环；A/B 对照期后从 CSS 移除。

## Verification

V-1 `npm run typecheck`；V-2 `npx vitest run tests/unit/janus-behavior`（新建，纯逻辑调度器）。原型层证据：`_design/janus-eye-behavior-lab/verify-lab2.mjs`–`verify-lab5.mjs`（摸头/惊醒/传话/队列续播/展开/看过即焚断言全绿，0 pageerror）。真组件落地后补 e2e 回归：下拉只落副黑板不误触通知、三路点击入口可达通知中心。

## Progress

P1 行为内核已落地（2026-10-24，feat/island-behavior-system f8630f51）：janusBehavior.ts 调度器 + useJanusGaze rAF 桥 + 21 项单测全绿、typecheck 干净；order 态 mini-idle 用法退役（AC-6 用法侧）。P2 事件映射已落地（同分支）：onQuickTap flinch/惊醒伴随、nod/fail/greet 真实事件、拖拽挂起摸头。手势仲裁定案（2026-10-23）：采纳 B 案——下拉专属副黑板，通知中心走点击入口。原型设计与参数定稿完成（2026-10-23，用户确认手感参数与通知形态三条反馈：整体展开、灰字计数、连发/展开 bug 修复）。

## Handoff

下一步执行 P1。注意 CRLF 工作区（提交前 tr 计数 CR）；`useIslandGesture.ts` 按 B 案零改动（下拉语义不动，只挂伴随反应挂点）；e2e 带 `NO_PROXY=127.0.0.1,localhost`。
