---
{
  "schema": "harness-note/2",
  "id": "80e64e6f-91eb-50a2-94b4-fbc40b112e10",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-09",
  "class": "feature",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/cc4811c7-b7f1-490f-8770-81eaae8805e6"}
  ],
  "extensions": {
    "r6Organization": {
      "sourcePath": ".agents/notes/2026-09-09-agent-note-run-orb-budding-for-multi-workspace-running-state--80e64e6f.md",
      "sourceHash": "e9f4389e04e8d9718e007a38cdf67aa53dbfee275ff4664be261ede5083f4b48",
      "originalBodyHash": "d5c5bf0a24d592b05394defaeb1470ff70fbad2a38d9c92b0d5ee91fb51ef37f",
      "category": "formal",
      "reason": "Retains the source decision in implemented lifecycle; body documents Run-orb budding for multi-workspace running state. No age-based archival.",
      "edits": ["Removed redundant Agent Note title prefix","Removed lifecycle duplicated by frontmatter"],
      "baseline": {
        "revision": "d59d9a8808cf2e3a2f02520144d8371a20ebdf56",
        "path": ".agents/notes/implemented/feature/2026-09-09-run-orb-budding.md",
        "sourceHash": "e9f4389e04e8d9718e007a38cdf67aa53dbfee275ff4664be261ede5083f4b48",
        "originalBodyHash": "d5c5bf0a24d592b05394defaeb1470ff70fbad2a38d9c92b0d5ee91fb51ef37f"
      }
    }
  },
  "updated": "2026-10-22T12:06:42.843Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---
# 顶栏运行入口与紧凑运行指示器

## Problem

Island 长按启动缺少可见入口，且与单击、双击、下拉共用命中区。运行球的首字母、进程角标、旋转轨道与 worktree 子芽把项目和进程层级同时挤在顶栏，多 worktree 时难以辨认。启动目标需要明确，同时后台实例必须跨项目切换保留。

## Decision

`TitlebarRunButton` 在顶栏右侧工具组前提供唯一的 `Play` 图标按钮，悬停与键盘聚焦提示项目和当前分支／目录。按钮在触发时快照当前 worktree；加载配置期间禁止重复点击，切换 worktree 不重定向该次启动。配置优先读目标目录，缺失继承工作区根模板，命令仍在目标目录执行。无配置直接打开快照目标的 `ProjectLauncher`；启动失败显示可关闭的错误提示；已运行则提示并轻闪项目标记，不停止或重复启动。启动成功立即刷新全局运行快照。没有项目时按钮禁用。

Island 长按启动及其蓄力、回弹和涟漪实现直接移除，不保留兼容手势。单击、双击与下拉黑板保持原职责。

`JanusRunOrbs` 保留命名及运行数据源，一工作区呈现一条细刻度，统一排列为紧凑运行指示器组。每个刻度命中区 18×24px，常态不画单独底色或外框；绿色刻度宽 3px，当前项目高 16px，其余高 10px 且降低透明度。项目名、配置和进程数只在主题化 tooltip 与运行详情中显示，顶栏不放截断名称。出现时 320ms 轻升并展开；运行中以 2400ms 周期在 78%～100% 高度间缓慢伸缩，保持当前项目与后台项目的明暗区分；停止中以 800ms 周期收缩变暗，退出时 200ms 收拢淡出，面板打开时保留空态锚点。减少动态效果设置关闭上述动画；轨道、数量角标、worktree 子芽及球体长按停止全部移除。最多直接显示两个项目，当前项目优先，其余按启动顺序，溢出进入 `+N`。宽窗口指示器位于 Island 右侧，≤1100px 移到左侧；绝对定位使数量变化不移动居中的 Island。初版文字胶囊经用户评审否决，最终采用三版 UI 对比中的紧凑刻度方向，设计稿为 `design/run-status-exploration.html`。


点击指示器查看原有轻面板；后台项目指示器仍沿用切换项目并打开详情的行为。溢出列表也打开对应详情。面板按 worktree 分组进程，保留 PID、端口、最近输出、空闲 worktree 启动和端口冲突警示。停止全部、单 worktree、单进程均在面板内显式点击并再次确认，停止全部失焦即取消确认。关闭面板、点外和 Esc 不停止进程。停止全部优先按启动时盖章的 workspaceId 归属，覆盖仓库目录外的 worktree；未盖章数据仍用根目录前缀兜底。

`stores/running.ts` 继续按工作区与作用域两级分组，`useGlobalRunning` 全量轮询，不随活动项目过滤；`useProjectRunning` 仅保留旧 app store 读者需要的运行状态镜像。端口冲突只警示，不自动改端口。

## Alternatives considered

- 每个 worktree 一枚运行按钮：目标清楚，但控件随 worktree 增长。采用一个跟随当前目标的入口。
- 顶栏组合启动菜单与运行数量：可以集中管理，但与运行指示器重复职责。启动按钮只负责启动，指示器负责查看运行实例。
- 项目名称胶囊：辨认直接，但较占空间。用户选择紧凑刻度，名称通过悬停与详情提供。
- 保留长按或增加提示：改动小，但核心操作仍依赖记忆手势。直接移除长按并提供可见按钮。

## Consequences

顶栏操作数不随 worktree 增长，一个项目的多个 worktree 并行运行仍只占一条刻度。代价是项目辨认需要悬停或打开详情，多个同色刻度的学习成本高于显式名称；当前项目通过长刻度区分，键盘可聚焦并读出完整项目名。最多两个直显项目与窄窗左置用于避让右侧工具区，若工具组继续增长需重新检查顶栏几何。运行失败尚无退出快照通道，异常退出持久呈现仍待 runner 能力扩展。

## Verification

动效增补后，运行控件的 10 项 Playwright 交互检查与变更 TSX 的 ESLint 通过。额外浏览器采样确认入场动画为 `orb-enter`、运行周期中纵向缩放从 0.78 到 1、停止后的空态锚点播放 `orb-leave`，模拟 `prefers-reduced-motion: reduce` 后按钮和刻度均无动画。

`npx vitest run tests/unit/janus/run-orb-actions.test.ts tests/unit/janus/run-orb-grouping.test.ts tests/unit/planche-theme.test.ts` 通过 33 项，覆盖项目归属、仓库目录外 worktree 的停止与主题。最终严格 unused 类型检查、变更源文件 ESLint、i18n 检查及 `npm run build:app` 通过。

`$env:JANUS_E2E_PORT=41842; $env:NO_PROXY='127.0.0.1,localhost'; npx playwright test tests/e2e/island-interaction.spec.ts --project=island --workers=1 --grep 'run-orb budding'` 最终刻度版通过 10 项，覆盖两个 worktree 并行启动、每项目一条刻度、重复启动、异步期间切换目标、键盘操作、启动失败、缺少配置、显式停止、溢出项目详情和实际顶栏几何。深浅主题在 1280、900、720px 截图已检查，指示器与运行按钮无重叠，Island 保持居中。截图位于本地 `artifacts/run-controls-*.png`，构建日志为 `artifacts/run-controls-build.log`。

此前完整 Island 套件为 26 通过、5 失败；圆桌单项复查两次通过，其余 4 项在独立 HEAD 基线 `23f9ea4e` 复现，涉及 Knowledge 空态、旧 Chat 停靠入口、会话菜单和已移除的面板拖动预期，未扩大本次修复范围。Notes 检查报告 0 errors、17 条跨仓外部链接诊断；浏览器使用 Electron API 夹具，真实桌面启动命令未验证。
