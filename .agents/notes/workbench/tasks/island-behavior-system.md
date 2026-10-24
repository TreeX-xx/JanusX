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
  "updated": "2026-10-24T15:28:32Z",
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
4. **事件原语**：flinch（压扁回弹+急眨眼）、nod、fail 垂眼、greet 双眨；**摸头闭眼**：鼠标停胶囊上 → 慢速闭眼享受（2.2s）→ 自己睁眼偷看（2.8s）→ 循环；闭眼时点击=惊醒（跳进偷看）。flinch/惊醒**不占点击手势**，均作为 peek 展开的伴随反应（见 P5 手势仲裁）。原型另有**自主动作/待机动作**（2026-10-24）：空闲时 5–10.5s 自发切换做动作（不连重、传话/面板/摸头/拖拽/动作进行中让位，摸头/点击/开面即时中断动作），lab 开关 `autoAct`，**已移植生产**（见 P1 扩展）。待机动作池（加权轮换，`IDLE_ACTS` 包络驱动 `--rot` 新通道 + 形变/眼睑/视线接管）：伸懒腰/歪头好奇/环顾四周（权重3）、小跳/打瞌睡钓鱼/深呼吸（权重2），事件反应 flinch/nod/greet/fail/notice（权重1；生产池只含待机动作，事件反应仍走真实事件）；另叠加常驻呼吸基线（±1.2%）。歪头好奇编排（2.9s，左右随机）：视线抢先到位 → 头带回弹入倾（冲过 12.5° 回落 10°，两段微颤）→ 第二感缩回 5° 再倾 12° → 回正余韵+收尾定神眨；打哈欠按用户要求移除（2026-10-24）。右栏「待机动作」按钮可手动点名即播，事件反应/待机动作手动触发一律优先（打断进行中的自动动作）。同日 lab 手势对齐生产——单击开/合通知中心（下拉开面退役，拖拽只挂起摸头）。

通知系统（替代侧边弹卡）：

- **串行传话**：胶囊横向展开 52→272px（眼在左、话在右，皮肤一体），清嗓眨眼 → 眼神扫向文字"念"→ 念完移开 → 收起；排队时 hold 缩短 1.9s。收起当前条**队列必须续播**（曾有连坐清定时器的 bug，修复为 keepQueue）。
- **未读计数**：舞台左上角灰色小字（mono 10px，如「通知 3」），**不做胶囊角标**；可点击打开通知中心。
- **通知中心**：点击入口 → island **整体纵向展开**（52×26 → 302×136，眼在左上与标题并排），不悬浮面板，**不占用下拉手势**；内容含 mono 时间戳+正文。**看过即焚**：收起时逐条 stagger 溶解清空历史与计数。展开高度按最终内容宽（276px）测量——宽度过渡中途量高会因长文案折行量出虚高（实测 283px 坑）。入口（2026-10-24 修订）：**岛体单击为主入口**（折叠态单击开/合通知面，取代 knowledge 空态舱重放；peek 单击维持收起语义），另有灰字计数、传话胶囊可点；peek 历史入口 deferred。
- 打开通知中心=已读：清空传话队列；传话中打开先中断当前条。

降级与红线：`prefers-reduced-motion` 全行为静止化（仅透明度）；旧 `mini-idle` keyframe 从 order 态退役（保留 A/B 对照期后删除）；rAF 只写 CSS 变量，指针静止后停帧；调度器纯逻辑、时间/随机可注入以便单测。

## Scope

**P1 行为内核**：新建 `janusBehavior.ts`（GazeScheduler/Blink/Reaction 纯逻辑，含吸引·驻留·移开·疲劳·游荡·摸头循环状态机）+ `useJanusGaze()`（rAF 桥、CSS 变量输出、闲置停帧、reduced-motion 降级）；`01-janus-foundation.css` 的 `mini-idle` 由 var() 驱动 transform 替代，EQ/scan 模式 keyframe 保留。参数默认值=定稿值。实现修订（2026-10-24 用户实测）：`.janus-eye-group` 曾漏接 `--gaze-x/--gaze-y`（调度器在跑但眼球不动，表现为「鼠标靠近无吸引」），已补进 transform 链（face 位移 → gaze 位移 → squash/lid 缩放）。**待机动作移植（2026-10-24）**：内核新增 `JanusActKind` 六动作包络（stretch/tilt/lookaround/hop/doze/breathe，含歪头编排与伴随急眨眼偏移表）+ 加权调度（`actIntervalMs: 7500`，×0.67–1.4 ≈ 5–10.5s，order 态且非忙开演，不连重；hover/panel/事件注视/点击/传话/拖拽即时打断或让位）；帧输出增 `rot/act`，CSS 链改 `translate(face) rotate(rot) translate(gaze) scale(...)`（视线随头转）；动作中 settled=false 不停帧，`nextActAt`/动作终点进唤醒表；呼吸基线 CSS 化（collapsed-core 3.8s ±1.2%，reduced-motion 关闭）。

**P2 事件与摸头接入**：JanusIsland 折叠态接 hover 判定（胶囊+14px 容差）与摸头闭眼循环；flinch/nod/fail/greet 映射真实事件。实现时修订（2026-10-24）：peek 展开首帧即隐藏胶囊（`island-expand-from-pill` 放大的是 `.janus-expanded`），「展开伴随」改挂**单击即时回调**（`onQuickTap`，420ms 单击仲裁期内播放、胶囊仍可见；惊醒=闭眼时点击的 kernel 内逻辑不变）；nod=流式下降沿且无错误、fail=错误出现上升沿、greet=工作区切换落定。摸头与 hover 呼吸分层共存（呼吸在 island、凝视在眼组 transform 链），拖拽（is-dragging）期间摸头挂起（`suspendRef`），与呼吸的 `:not(.is-dragging)` 对齐；`useIslandGesture` 仅增量接口（onQuickTap/isDraggingRef），下拉路径零改动。

**P3 胶囊传话 + 队列 + 计数**：通知到达走 `islandNotifications.ts` 统一入口 → 串行传话队列（收起续播、面板打开清队）；左上角灰色计数与历史一致；替换现行折叠态通知弹出（peek 一级展开通知胶囊不动）。

**P4 通知中心**：点击入口展开 island 通知面（岛体单击、灰字计数、传话胶囊可点；高度测宽陷阱见上）、看过即焚（stagger 溶解）、历史数据源接入、空态；与 `island-hifi` 通知面样式令牌对齐。实现备注（2026-10-24）：历史数据源=传话队列历史（到达即入史）；**peek 历史入口 deferred**（需 peek↔collapsed 跨 stage 编排，另行设计）；打开=已读（清队、面板期到达只补行不打断）。同日修订（用户实测）：① 折叠态岛体单击改开/合通知面（island-local `notifOpen`，取代 single-activate 的 knowledge 空态舱重放）；传话中轻点仍=收起续播（quickTap 消费 `dismiss()` 后抑制 420ms 单击开面，keepQueue 语义保留）。② 「到达即入史」补漏：知识召回一到即进 peek，旧 collapsed-only 入史门控会把这类通知永久漏记，改为 peek 到达也入史（enqueue 后 `markSeen` 只进史不播，防传话条叠画 peek 胶囊）；expanded 到达仍归托盘不进传话链。③ 通知面形态对齐 lab（2026-10-24 用户实测）：`.janus-island` 补 `overflow:hidden` + height 过渡（展开中文字被裁进胶囊不外泄、高度不再瞬跳）、正文折行不 ellipsis（高度按 300px border-box=276 内容宽测量，防折行量高）、眼位对齐 lab 左上（core inset 10/2）、head 让位 34px、sheet 底 padding 6px；点空白处=看过即焚收起（document pointerdown 壳外判定，lab「点舞台空白」语义）。④ 展开手感对齐 lab（2026-10-24 用户实测：生产展开方式/节奏与 lab 不一致）：形变收敛为**壳单一驱动**（宽/高/圆角/眼位同一物体同一拍，内岛 100% 随行，删双层各写 height 的错位），时序统一 lab 定稿 `420ms cubic-bezier(0.32, 0.72, 0.24, 1)`——开/合两向都由 `data-notif-anim` 属性供给同款过渡（CSS 过渡取后态时序，收起后态原本落回基础壳 0.34s/0.24s 两套节奏导致开合手感分裂）；起跳用 lab openPanel 同款 reflow 手法（先钉 26px 强制回流再落目标高，高度过渡从胶囊高起跑）且改 layout effect 与 `data-notif` 同帧生效；开中补行只重落目标高不回跳 26px。收起时 JS 在看过即焚定时器内打 morph 属性再翻状态，保证收起同节奏。

**P5 手势仲裁与收尾**：**仲裁已定案（2026-10-23 采纳 B 案）**：下拉 ≥60px 保持副黑板专属语义（toggle + 0–60px 全程跟手预览 + <60px cancel，见[下拉副黑板](../island-blackboard.md)），`useIslandGesture` 下拉路径**零改动**（落地后 diff 复核：仅 onQuickTap/isDraggingRef 增量）；通知中心不占用下拉，只走点击入口；flinch/惊醒为轻点伴随反应。单击语义 2026-10-24 修订：折叠态=开/合通知中心（原「单击 replay knowledge 空态舱」退役），peek 单击维持收起；双击控制台语义零改动。收尾：reduced-motion 内核静止化、aria-label/计数钮可访问名（单击主入口后折叠态 aria 改 `openNotif`/`closeNotif`）、i18n 文案（historyCount/notif 三键 + aria.openNotif/closeNotif）、`mini-idle` keyframes 退役删除（AC-6 完成）。

## Acceptance criteria

- AC-1 调度器单测覆盖吸引/驻留/主动移开/疲劳/游荡/摸头循环/续播队列，默认参数=定稿值（V-2）。
- AC-2 order 折叠胶囊支持鼠标跟随与摸头闭眼循环；reduced-motion 下静止降级无报错。
- AC-3 通知串行传话不丢队（中途收起续播、面板打开清队语义固定）；左上角计数与历史条数一致。
- AC-4 点击入口展开通知中心：眼在左上、内容完整不裁切；收起看过即焚清空历史与计数。
- AC-5 下拉手势保持副黑板专属语义不被通知中心占用（≥60px toggle、0–60px 跟手预览、<60px cancel 不变）；通知中心经岛体单击/灰字计数/传话胶囊可达（peek 历史入口 deferred）；flinch/惊醒为 peek 展开伴随反应，双击语义零改动（单击语义见 P5 修订）。
- AC-6 order 态不再使用 `mini-idle` 8s 循环；A/B 对照期后从 CSS 移除。

## Verification

V-1 `npm run typecheck`；V-2 `npx vitest run tests/unit/janus-behavior.test.ts tests/unit/island-speak-queue.test.ts`（35 用例：调度器状态机 29 含待机动作 8 + 传话队列语义 6）。原型层证据：`_design/janus-eye-behavior-lab/verify-lab2.mjs`–`verify-lab5.mjs`（摸头/惊醒/传话/队列续播/展开/看过即焚断言全绿，0 pageerror）。harness 层 e2e（2026-10-24 跑过，`island-interaction.spec.ts`）：29 过，含单击开/合通知面、通知面/expanded 视口几何、延迟单击回调身份（改 peek→收起路径验证）；3 失败为**基线既有**（docks / switches conversations / chat topbar drag，stash 基线复核确认）；2 用例并发负载 flake（approval panel / roundtable parchment，单跑全过）。未跑（显式缺口）：真机 App e2e 回归（下拉只落副黑板、传话/摸头视觉冒烟）——需真实 App 运行环境，留待合并前补。eslint 对改动文件 0 错误。

## Progress

P1–P5 全部落地（2026-10-24，feat/island-behavior-system，f8630f51→2d8a728a 五笔）：P1 内核+21 单测、P2 事件映射、P3 传话队列+灰字计数、P4 通知中心+看过即焚、P5 退役清理；27 用例全绿、typecheck 干净、eslint 0 错误、手势 diff 复核零语义改动。用户实测反馈修复（2026-10-24 二次落地）：① 凝视吸引无视觉输出——`.janus-eye-group` 补接 `--gaze-x/--gaze-y`（P1 CSS 通道漏接）；② 单击直达通知中心——折叠态单击开/合 P4 通知面（保留传话中轻点收起续播）、aria 同步 openNotif/closeNotif、peek 到达补史（到达即入史补漏）；e2e 两用例随新语义改写（island-harness 新增 open-peek 钮供 peek 路径编排）。待机动作移植生产（2026-10-24 三次落地）：lab 六动作（打哈欠已按用户要求移除）经内核包络+加权调度移植，`--rot` 通道、呼吸基线、传话忙让位接线，8 新单测全绿。遗留缺口：真机 App e2e 回归未跑（见 Verification）；peek 历史入口 deferred；合并前跑一次真实 App 冒烟。手势仲裁定案（2026-10-23）：采纳 B 案。原型设计与参数定稿完成（2026-10-23，用户确认手感参数与通知形态三条反馈）。展开手感对齐 lab（2026-10-24 四次落地）：用户实测生产点击展开的加载方式/节奏不如 lab——壳单一驱动 + `data-notif-anim` 双向 420ms lab 时序 + 26px reflow 起跳 + layout effect 同帧（P4 ④）；V-1/V-2 全绿、e2e 通知面 4 用例全过、eslint 0 错误。

## Integration ? 2026-10-24

??????????? `e1fe16a0` ??? `12dc90e5` ???? main???? main????????????????????????????????? worktree ????????main ??????????????????? main ???????????????? 2 ?????

??????`npm run typecheck` ???`npx vitest run tests/unit/janus-behavior.test.ts tests/unit/janus tests/unit/electron-dev-port.test.ts` 140 ???`tests/unit/island-speak-queue.test.ts` 6 ???????????????????????? 4 ? Playwright harness ????????? 4 ? TypeScript ???? eslint ?????????? Electron ????????????? Verification ???????

## Evidence

- 设计源：`_design/janus-eye-behavior-lab/Janus Eye Behavior Lab.html`（verify-lab2–5.mjs 交互断言全绿，0 pageerror，2026-10-23；verify-lab2–5 记录的是下拉开面旧手势期证据）。
- 原型跟进（2026-10-24）：lab 单击=通知中心开合/下拉开面退役/传话中轻点收起续播 + 自主动作切换（greet→nod 实测不连重、忙时让位），`verify-lab6.mjs` 全绿 0 pageerror（A 单击展开 / B 单击焚尽收起 / C 下拉不开面 / D 传话续播 / E 自主切换 / F 面板让位）。
- 待机动作丰富（2026-10-24）：6 个待机动作经右栏按钮逐个实测（`verify-lab7.mjs` 全绿 0 pageerror，中段变量截图 shot-30-act-*.png）——tilt 中段 |rot|≈10°（方向随机 ±）、hop 中段 fy=-2.7 拉伸、doze 中段 lid=0.53 眨拉、breathe 眼睑包络正确，播完自动归还；事件反应按钮手动通路抽查（nod 打断进行中动作）；呼吸基线两次采样不同；摸头即时中断动作。
- 待机动作生产移植（2026-10-24）：V-1 typecheck 干净、V-2 35 用例全绿（tilt 中段 ±10°/hop 腾空 faceY<-1/doze 垂眼/lookaround 扫视前眨眼/让位与打断/reduced-motion 静止）、eslint 0 错误，`tests/unit/janus/` 套件 68 过。
- 通知面形态对齐 + 点空白收起（2026-10-24）：e2e「single activation opens the notification center sheet」扩展断言（开→点空白焚尽收起→再开→点岛收起）与「notification sheet and expanded geometry」均过，typecheck 干净。
- 展开手感对齐 lab（2026-10-24）：e2e 通知面 4 用例（single activation 开/合、second pointerdown 仲裁、delayed single 身份、notification sheet geometry）全过24.8s；V-1 typecheck 干净、V-2 35 用例全绿、eslint 0 错误。对照分析结论：lab 单元素同拍生长（width/height/padding/border-radius 同 420ms 同曲线）+ openPanel 的 26px 强制 reflow 起跳；生产旧实现壳/内岛双层各写 height、开合两向落不同过渡节奏（收起落回基础壳 0.34s/0.24s）、height 直落目标值无起跳帧。
- 移植落地：feat/island-behavior-system `f8630f51→2d8a728a`（P1–P5 五笔）；实测反馈修复见 2026-10-24 工作区 diff（`01-janus-foundation.css` gaze 通道、`JanusIsland.tsx` 单击语义与入史门控、`useIslandSpeak.ts` dismiss 返回值、i18n 双语 aria、e2e 两用例改写 + harness `open-peek` 钮）。
- 单测（2026-10-24）：V-2 27 用例全绿；另 `tests/unit/janus/` + `tests/unit/knowledge/` 639 过 3 skip。
- e2e（`island-interaction.spec.ts`，2026-10-24，NO_PROXY）：29 过（含单击开/合通知面、通知面/expanded 几何、延迟单击回调身份）；3 失败为基线既有（docks / switches conversations / chat topbar drag，stash 基线复核一致）；2 用例并发 flake（approval / roundtable-parchment）单跑全过。
- `npm run typecheck` 干净；eslint 对改动文件 0 错误。

## Handoff

P1–P5、2026-10-24 实测反馈修复与待机动作移植均已落地，待合并前真机冒烟。注意 CRLF 工作区（提交前 tr 计数 CR）；`useIslandGesture.ts` 按 B 案零改动（下拉语义不动，只挂伴随反应挂点）；e2e 带 `NO_PROXY=127.0.0.1,localhost`。
