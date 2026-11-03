# 性能检测与功能守恒

检测脚本只操作合成数据和独立 profile，不复用运行中用户数据，也不发送通知或调用模型。首批产物写入 `artifacts/performance-current/`，Chat/编辑器保留内存基准写入 `artifacts/performance-retention/`。各层分别报告，不能把某一层的收益当作整个应用收益。

## 1. 历史扫描隔离基准

优化前运行 `node scripts/performance/corpus-benchmark.mjs baseline`，优化后运行 `node scripts/performance/corpus-benchmark.mjs candidate`。先将当时的扫描实现打包快照，再分别启动五个新 Node 进程处理同一个约 55 MiB JSONL。再次测冻结基线使用 `node scripts/performance/corpus-benchmark.mjs baseline --reuse`，不要重新生成 baseline bundle。

固定元数据、模型切换与 token_count，夹杂较大但不参与记账的合成消息正文。输出文件包含 fixture/bundle SHA-256、五次原始结果、中位数、完整观测摘要。candidate 与 baseline 的观测摘要不一致就失败；同一语料与同一统计结果是性能比较的前提。这里的 ledger 是只计算摘要的替身，未计量 SQLite 提交，也未模拟真实用户全部历史分布。

指标：总耗时、1 ms 分辨率的事件循环延迟直方图最大值、2 ms 采样的堆/RSS 峰值、OS 进程高水位 RSS。采样可能漏掉同步期间的瞬时峰值，故同时报告进程高水位。数字包括进程基线，不能当作净分配量。最大延迟不是用户输入 p99；超长单行仍可能占用一次不可中断 JSON.parse。

## 2. 工具区浏览器基准

PowerShell 示例：

```powershell
$env:NO_PROXY='127.0.0.1,localhost'
$env:HTTP_PROXY=''
$env:HTTPS_PROXY=''
$env:JANUS_E2E_PORT='41847'
$env:JANUSX_PERF_LABEL='baseline'
npx playwright test tests/e2e/workbench-performance.spec.ts --project=island --workers=1
```

优化后将标签改为 `candidate`。这些环境设置只用于当前测试 shell；本地代理可能把未监听端口返回为 HTTP 成功，导致 Playwright 误判端口已占用。

使用真实工具菜单、TerminalArea 和布局组件，Electron/PTY 边界采用现有 fixture。30 次点击测 click handler 到两次 rAF 的显示机会代理值，验证菜单已打开；40 次工具比例变化用 React Profiler 记录提交次数与 actualDuration 总和，同时记录 Long Tasks。它不是硬件输入到屏幕的延迟，不模拟持续终端输出，不直接证明现场菜单卡顿消失。普通测试默认跳过测量，避免硬件差异导致功能 CI 失败。

功能回归另外执行 `tests/e2e/global-tools.spec.ts`，覆盖窗口变窄、快速反转、项目切换、嵌套分屏、浏览器身份和 Markdown 内容归属。

## 3. 隔离 Electron 启动

优化前后分别构建，不覆盖正在使用的 `.cache` 或 `out`：

```powershell
npx electron-vite build --outDir artifacts/performance-current/baseline-app
npx electron-vite build --outDir artifacts/performance-current/candidate-app
node scripts/performance/desktop-sample.mjs baseline
node scripts/performance/desktop-sample.mjs candidate --check-editor
```

必须在优化前保存 baseline-app；两条构建命令不是在优化后连续运行来制造“基线”。每次启动生成独立空白 profile，与本机开发依赖共用 Electron，保留测量文件便于检查。记录首个 root 内容出现时间、启动后目标 5/30 秒各进程的 Private Bytes/Working Set、JS heap 和 main 10 ms 定时器滞后；如果首屏晚于 5 秒，实际采样以 `actualElapsedMs` 为准。首个内容可能是 loading，不称为可交互完成；JS heap API 可能量化，优先结合进程指标。

`--check-editor` 在采样后进入项目高级 JSON 编辑，修改实际 Monaco model，经过 onChange、校验与审批保存配置；随后打开独立文件编辑器，用键盘验证查找、编辑和真实磁盘保存。这些操作不混入空白启动内存。整份 JSON 文本用 model 修改，避免把原生 EditContext 的自动配对/缩进当作粘贴；该检查不声称验证所有 JSON 输入法交互。`--checks-only` 跳过内存采样，仅执行功能检查并单独写文件。`--check-terminal` 创建独立 cmd PTY，测 20 个未提交字符的 IPC→PTY 回显，保留首个输入与后续输入的区别；不执行命令，结束后销毁该测试终端。该值不含 xterm 绘制，不等于按键到屏幕时间。

首次加载编辑器可能稍慢，是避免提前常驻的代价。运行前后顺序交错并避免同时构建/压测，区分 OS 文件缓存和应用改动影响。运行中的真实会话、后台外部进程仍可能干扰本机绝对耗时，不能据单次运行承诺比例。每次成功采样追加到 `desktop-*-runs.json`，避免只保留最有利的一次。

## 4. Chat 恢复与编辑器缓存

优化前运行 `node scripts/performance/retention-benchmark.mjs baseline` 冻结 Chat store 和 editor store 的独立 bundle，优化后运行 `node scripts/performance/retention-benchmark.mjs candidate`。复跑已冻结实现使用 `baseline --reuse` / `candidate --reuse`。不要在修改后重建 baseline。Electron 路径使用隔离替身，文件读取由合成数据提供，不访问真实 profile。每场景五个新 Node 进程，记录源码 bundle 和语料摘要，候选完整恢复结果/文件内容摘要必须与基线一致。

Chat 语料为 128 个相互链接的全量修订，44,634,409 字节；每份包含 40 条正文。测恢复耗时、事件循环最大延迟、采样堆峰值、进程高水位 RSS 及恢复后 GC 的堆。该优化减少旧修订同时存活造成的峰值，最新会话正文仍需加载，恢复后的保留堆不应被表述为同比下降。

编辑器通过真实 store 连续开关三批各 80 个文件，其中四分之一是图片 base64；每个内容是独立的 512 KiB 字符串。每 8 次操作让出事件循环，每批使用受控 GC 测保留堆，另外测 200 次最近文件重开的 p95 和读取次数。字符串按 UTF-16 估算，因此缓存的 16 MiB 预算不等于观测堆大小。总耗时包括生成数据、内容哈希、采样和 GC，不等于实际磁盘、Monaco 或用户点击耗时；不能用这一层的 p95 宣称界面延迟达标。受控 GC 只用于测试，不在产品运行中强制 GC。

当前功能命令：

```powershell
npx vitest run tests/unit/janus-chat-store.test.ts tests/unit/janus-chat-conversations.test.ts tests/unit/janus-chat-engineering.test.ts tests/unit/editor-cache.test.ts tests/unit/editor-tabs.test.ts tests/unit/editor-find.test.ts tests/unit/editor-window-manager.test.ts tests/unit/editor-viewed-ipc.test.ts tests/unit/terminal-editor-scope.test.ts tests/unit/file-tree-move.test.ts tests/unit/workspace-ipc-contract.test.ts
npm run typecheck
npx eslint src/main/janus/chat-store.ts src/renderer/src/stores/editor.ts
npx electron-vite build --outDir artifacts/performance-current/retention-app
node scripts/performance/desktop-sample.mjs retention --check-editor --checks-only
```

功能边界包括修订重复/分支/孤立关系、坏行与断尾、跨块 UTF-8/CRLF、完整无换行尾行、旧 JSON 回退、未先 load 的连续 save；编辑器包括字节/条目预算、LRU 命中、大文本/图片跳过、未保存编辑、保存中继续编辑、关闭/删除/重命名/工作区失效和在途读取竞争。实际 Electron 检查验证编辑与落盘，不做本轮空白启动内存比较；此阶段收益依赖历史与文件规模。

## 功能门槛与本轮边界

先运行 history/coordinator/accounting/corpus/projection 的单测，再跑工具区和编辑器功能，再审查数据语义，最后采样比较。Codex event 模式按块校验全部 JSONL，但只保留记账记录；旧 cumulative 模式及哈希检测保持原路。完整尾行无换行、半写尾行、CRLF、多字节、坏行、分叉继承、重复事件、模型变化及取消都有兼容性约束。

本轮不是跨重启增量解析，也没有迁移数据库到 worker；Claude/Pi、活动终端 cumulative 读取、SQLite 主线程事务、多终端总输出预算仍需后续工作。蓝图、知识库与历史统计继续启用。长会话现场需要补采 CPU profile、真实输入延迟和保留堆，当前基准只回答指定场景。

## Terminal pre-launch baseline

Run `node scripts/performance/terminal-baseline.mjs [workspace] [baseline-revision]` from the checkout. Defaults are the repository workspace and `HEAD`; pass the original revision again after committing the optimization. The probe bundles the production tracker and scanner from that revision and the working tree, alternates three samples each, and records registration time followed by a real PTY ready marker. Windows uses bundled ConPTY, as the application does. It reads the workspace without changing its files; keep other writers idle so snapshot digests can be compared.

Results, source copies and bundles are written under `artifacts/terminal-startup-performance/`. All six complete snapshot digests must match. Measurements exclude Electron startup, hook installation, CLI initialization, renderer paint and interactive readiness; the OS cache is not flushed. This is a component comparison, not an end-to-end desktop speed claim.

The legacy marker does not answer terminal capability requests. Bundled ConPTY can therefore wait approximately three seconds in that probe; do not interpret that interval as normal xterm startup cost.

For a working-tree comparison, run `node scripts/performance/snapshot-startup-probe.mjs --freeze` **before editing**, then run `node scripts/performance/snapshot-startup-probe.mjs` after the change. It preserves the frozen scanner, alternates three foreground samples per version and checks complete snapshot digests. Keep workspace writers idle during sampling. Results and exact sources are in `artifacts/terminal-startup-investigation/`; it measures capture only, with no memory or full-desktop claim.

On Windows, `node scripts/performance/pty-startup-probe.mjs` independently runs twelve isolated cmd marker probes: bundled/system ConPTY, with/without capability replies, three samples each. It records spawn, first-byte and marker timings plus control sequences in `pty.json` in the same directory. The real xterm reply/replay behavior is checked by `npx playwright test tests/e2e/terminal-startup.spec.ts --project=island --workers=1`.

## Native Claude startup and overlapping preparation

`node scripts/performance/claude-startup-probe.mjs --freeze` bundles the current adapter before editing. `--baseline` then measures one original start; no flag compares three alternating before/after samples. The Windows probe uses `JANUSX_TEST_CLAUDE_BIN` or the standard npm native executable, creates a separate home/config/workspace with a localhost fixture, accepts trust only there, and requires zero model requests during startup. It stops only its own workers and isolated daemon. Reports and frozen sources are under `artifacts/claude-startup-performance/`. It does not measure app rendering or use the user's provider credentials.

`node scripts/performance/launch-preparation-probe.mjs` compares serial and overlapping native `--version` probing plus production foreground capture, three alternating samples each. Reports under `artifacts/terminal-startup-round2/` include full snapshot digests; keep workspace writers idle. This is a component comparison, not a measurement of the entire IPC/Agent startup. Production `preparationMs` and `baselineMs` now overlap, so their sum is not total startup time.

Set `JANUSX_PERF_DIRECTORY` to a separate artifact directory when freezing a new round with `snapshot-startup-probe.mjs`; retain earlier frozen baselines instead of overwriting them after edits.
