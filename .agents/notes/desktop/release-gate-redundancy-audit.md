---
{
  "schema": "harness-note/2",
  "id": "15218225-ec9b-485f-a1d5-38cad7a8eaae",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-28",
  "updated": "2026-10-28T10:54:48.000Z",
  "class": "process",
  "tags": ["ci","release","verify","windows"],
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e",
  "relations": [
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/8bda71ec-1f76-4d89-aabc-f193b2579438"},
    {"type":"related-to","target":"note://972afef3-2fc7-49de-a3ee-7e041225d28c/40cc28a8-0ca8-5ac3-b2c6-fafd93175e2c"}
  ]
}
---

# 发布门禁成本与冗余审计

## Intent

回答两个问题：正式发布前为什么需要当前这么多检查，以及这套门禁是否已经冗余到需要重整。审计范围是 `verify` PR 门禁与本地 Windows 发布链（`package:win` → `stage:win` → `publish:win`），不评审单个检查项的正确性，也不提出新的产品行为。

本文产出成本事实与冗余分类，用于支撑[开发、构建与发布解耦设计](./release-delivery-design.md)阶段三（分层检查）的决策。在维护者确认前，所列建议均未实施。门禁的执行强度由[维护者指南](../../../docs/maintainers.md)的分支保护设置决定，不在本文改动范围内。

## 门禁构成与实测成本

`verify` 由 17 个 npm 步骤组成，展开为 26 次叶子命令调用、22 个不同检查。CI 的 `verify.yml` 把同一条链拆成同名具名步骤，只为失败归因，拆步本身不增加检查。

成本数据有三个来源，分别标注：CI 实测取自 2026-10-28 的 run `40666700655`，并用 `40661787055`、`40659109847` 交叉核对蓝图检查与单测两步；本机实测取自 dev checkout（Node 24.15.0）当天逐条计时；桌面场景数量与单测规模引自[可复现验证](./reproducible-verification.md)的记录，本次未重新测量。

| 阶段 | CI 实测 | 本机实测 | 备注 |
| --- | --- | --- | --- |
| 3× checkout + Setup Node | 50s | — | JanusX、janus-agentX、WorkFlowX |
| 构建 sibling janus-agentX | 48s | — | `npm ci` + 四层定序构建 |
| Prepackage | 70s | — | `npm install --install-links` |
| Install Playwright chromium | 13s | — | |
| theme:check | 2s | 5.3s | |
| plugins:check:platform | 37s | — | 内部再构建一次 plugin-sdk |
| plugins:distribution:test:tools | 1s | — | |
| plugins:blueprint:check | 3m33s | — | 临时目录独立装包、构建，再进签名 Electron 载体 |
| typecheck | 20s | 16.6s | |
| typecheck:llm-core + build:llm-core | 3s | — | 增量 |
| test:unit | 6m43s | — | 457 文件 / 4006 用例，CI 单进程串行 |
| test:llm-core | 3s | — | |
| typecheck:strict-unused | 18s | 22.8s | |
| build:app | 52s | — | electron-vite build |
| boundary + exclusions + i18n + notes | 6s | 10.8s | |
| lint | 18s（该 run 被跳过） | 18.1s | |
| test:e2e:desktop | 约 12min | — | 63 个串行 Electron 场景 |
| **合计** | **约 27min** | — | job timeout 45min |

发版日在 PR 门禁之外还要执行本地链：`package:win`（资源校验 → prepackage → 第二次 build → 第二次 boundary 检查 → exclusions:sync → electron-builder → `check:portable-runtime`），随后 `stage:win` 与 `publish:win`。

## 检查项的来源

当前门禁不是一次设计出来的，每一类检查都对应一类已经发生过的事故。

依赖与产物边界类的直接成因是泄漏与缺失。devDependency 未排除时，electron-builder 自身二进制、electron dist 与测试工具链在 301 MiB 安装包里占 870 MiB 载荷中的 612 MiB；忽略的 OfficeCLI 二进制在干净 checkout 缺席，原来要到产物校验才失败。运行核验类的直接成因是静默启动失败：v0.9.2 便携版 launcher 为 `asInvoker` 而应用为 `requireAdministrator`，NSIS 的 `ExecWait` 无法从普通令牌提升，用户机器上不出现 UAC 提示即启动失败，而本地与 CI 的高权限 smoke 都看不见。字节核对类的直接成因是 2026-10-22 与 10-23 两次移动已公开 tag 并替换附件的事故。

架构成因是测试体量与外部输入。457 个单测文件、84 个 e2e spec、15 个桌面 spec；`file:` 引用的 sibling 仓需分层定序构建；内置约 33 MB 的 OfficeCLI 二进制；`node-pty` 为原生模块且 `npmRebuild: false`。任一输入漂移都会造成"本地能过、远端必挂"。

发布链成因是 tag 曾经同时承担版本身份与发布触发器，tag 推送即触发云端打包并直接公开。现已拆为标记、构建、草稿上传、独立公开四段，公开前逐附件比对 SHA256。这一段是目前设计最完整的部分，不应削减。

## 冗余诊断

### A 类：同一断言重复执行

`typecheck` 被 `typecheck:strict-unused` 完全包含。`--noUnusedLocals` 与 `--noUnusedParameters` 只增加 TS6133 类诊断，不抑制任何类型错误；已用含类型错误与未使用局部的样例实证，`tsc --noEmit` 报 TS2322，加严格开关后同时报 TS6133 与 TS2322。strict-unused 通过时 typecheck 必然通过，而链中前者在第 6 位、后者在第 12 位，中间隔着 6m43s 单测，这 16.6s 是净浪费。

同一目录在完整 verify 后执行 `package:prepare`，会再次运行 `build`、boundary 检查与 exclusions:sync，但不能直接判定为可删除的重复。`prepare-package.mjs` 的 `changed` 只比较 @janus-agent 发布文件，并且随后仍执行 npm install；它不涵盖宿主源码、构建配置、其他依赖和输出缺失，不能证明两次构建输入相同。当前保留正式打包构建；完整输入身份与输出验证建立后，才评估安全复用。

打包运行检查是全链唯一做了输入摘要缓存的设计：`publish-win.mjs` 以源码提交、Node 与平台、检查脚本、四个发布附件及 win-unpacked 全量摘要决定能否复用，任一输入变化即重跑。其他环节都缺少同等机制。

增量构建在链内重复出现但开销很小：`build:llm-core` 出现在蓝图检查内部与独立步骤中，`build:plugin-sdk` 出现两次，`build:note-tools` 出现三次。均为增量 `tsc -b`（CI 1-2s），问题是不透明而非耗时。

### B 类：门禁粒度错配

每个 PR 都执行发布级验收。`verify` 中的 `build:app`（52s）、`test:e2e:desktop`（约 12min）与 `plugins:blueprint:check --test-runtime`（3m33s）合计约 16.5min，占整链约六成，对一行文档修改同样全量执行。解耦设计早已写明"桌面全量、安装包从普通 push 中移出"以及阶段三分层检查；`verify:quick` 脚本与 `docs/testing.md` 的说明均已存在，但未接进任何 workflow，CI 至今只有一个 job。

同一批代码被完整验证 2 至 3 次：PR 进 dev 一遍，dev 到 main 的晋级 PR 再一遍（内容常为同一批），`release:tag --verify` 可选第三遍。

排序倒置。`typecheck`（20s）排在 3m33s 的蓝图检查之后，一次类型错误从 job 开始到归因约 6m48s（run `40666700655`：09:46:10 → 09:52:58）；`lint`（18s）排在外层只有约 12min 桌面场景的位置之前一位，该 run 因前置 note check 失败，lint 与桌面场景都未执行。按失败概率乘成本重排，约 70s 的静态检查应全部前置，再进入插件平台检查、单测、蓝图检查、构建与桌面场景。

单测串行是最大单点，其原始根因已经修复。CI 下 `vitest.config.ts` 使用单 worker、单进程、无文件并行，耗时 6m43s，起因是 libuv issue 5010 的短路径断言会杀死 worker；但同一配置已在 worker 启动前用 `realpathSync.native(tmpdir())` 展开临时目录，直接消掉了触发条件。现存理由只剩内存上限与确定性，而本地为四 worker 并行，CI 完全未获得并行收益。

### C 类：配置重复

agentX sibling 构建步骤在 `verify.yml` 与 `release-win.yml` 中逐字重复，含同一 pin 提交，改动需同步两处。OfficeCLI 版本与 SHA256 钉在四个活跃位置：运行时校验（`src/main/office/office-bundled-path.ts`）、打包前校验（`scripts/check-win-resources.mjs`）、CI 下载校验（`.github/workflows/release-win.yml`）与资源说明文档。`verify.yml` 的分步是 `package.json` 检查链的人工镜像，改链必须同步两处，遗忘即漂移。

## 门禁未绑定执行

[维护者指南](../../../docs/maintainers.md)记录 `main` 的分支保护未设置 required status check。因此这条约 27min、17 步的门禁在 GitHub 层面不阻止合并。仍可从 Actions API 取到的最近 11 次 verify run 中，0 次成功、5 次失败、5 次取消、1 次进行中；该窗口受运行保留策略限制，不是完整历史。[verify 管道硬化](./verify-pipeline-harden.md)当时已记录"分支保护要求的 verify 变绿永无止境，直推 main 的 bypass 成为常态"。

结果是检查数量没有换来"合并内容一定通过检查"，只换来每次 PR 等待约 27min 查看一个不拦人的状态，以及习惯性 bypass。这一项是其他优化的前置决策。

同一份记录中"完整 verify 被 12 项主题色彩发现与 5 个 Note 错误阻塞"的说法已经过期。本次审计时 `theme:check` 与 `check:notes` 均通过，后者为 0 错误、17 条既存外部链接诊断，且全部指向本地缺席的 sibling 仓。门禁自身的障碍已经清除，剩下的是成本与执行强度。

## 建议

按性价比排序，第 1 项是其他项的前置。

| # | 动作 | 收益 | 风险 |
| --- | --- | --- | --- |
| 1 | 决定 required check：绑定，或明确降级为参考状态 | 门禁从装饰变为闸门 | 绑定前须先完成第 2 项，否则 PR 全卡 |
| 2 | 接入分层：PR 跑 `verify:quick`，完整 verify 留手动、合并前与发版前 | PR 反馈从约 27min 降到分钟级 | 低，脚本与文档已存在 |
| 3 | 重排顺序：约 70s 静态检查全部前置 | 常见失败归因从数分钟降到 1min 内 | 极低，纯调序 |
| 4 | 删除 `typecheck`，仅保留 strict-unused，或将严格开关并入主 typecheck | 省 16.6s 与一次 tsc 启动 | 极低，包含关系已实证 |
| 5 | 统一构建输入与输出校验后再评估构建复用，不以 `changed` 为空跳过 build | 输入和输出均匹配时有机会减少一次构建，尚未实施 | 当前缺少安全复用前提 |
| 6 | 重估 CI 单测串行，短路径根因修复后试 2 worker | 可能省 3-4min | 中，需观察 libuv 断言是否复现 |
| 7 | 收敛重复 pin：sibling 构建抽为共享步骤，OfficeCLI SHA 收敛到单一清单 | 消除四处手抄与两处 workflow 重复 | 中，触碰发布输入需重验 |

维持现状同样是可选方案，代价是每次 PR 的等待与 bypass 习惯继续，且发布级检查对无关改动重复执行。`verify:quick` 中的 unit 项目单测本次未计时，第 2 项的实际收益需在接入时测一次再记录。

## Open questions

required check 是否绑定由维护者决定，它决定第 2 项是否紧急。绑定前需要先确认完整层在合并前一定被执行，否则等于取消门禁。

桌面场景与蓝图运行时检查移出 PR 层后放到哪个入口（手动、合并前、发版前），需要与阶段三的统一构建输入一起决定，避免两次改动同一处 workflow。

CI 单测能否恢复多 worker 需要一次受控实验：固定 sibling 与 Node 版本，在 CI 上以 2 worker 跑完整单测，观察 libuv 断言与内存是否复现。没有这个证据不调整并发度。
