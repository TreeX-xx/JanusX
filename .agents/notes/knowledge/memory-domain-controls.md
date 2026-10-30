---
{
  "schema": "harness-note/2",
  "id": "908d675a-aec9-4791-8c8b-05f1e4c923ca",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-04",
  "class": "architecture",
  "tags": ["memory","knowledge","persona","settings","verification"],
  "updated": "2026-10-29T11:24:13.896Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/c1c04881-a2fb-430f-bc26-528027d0e5cf"
}
---

# 工程知识与个人画像独立控制、共用阅读入口

## Problem

只控制入口的开关会让用户在关闭画像后仍被采集或召回个人记忆；统一审核栏若仅依赖知识库开关，个人助手就不能独立使用。两个领域需要独立运行，详细设置提供个人记忆控制，同时在同一打开界面中查看工程知识与个人画像。本地资源、启停与模型验证由[自动处理需求](./requirements/knowledge-accumulate-review-wiki-rereview.md)承载，功能测试不能替代真实质量验收。

## Decision

工程知识库专用功能已退出，原“知识与记忆”工作台现在只承载个人记忆，入口由 persona 控制。个人候选列表不读取旧 Wiki/graph/工程自动化；蓝图设置与建议独立使用 blueprint 开关。保存的旧 knowledge 配置保留兼容，但 project 采集、候选生成、自动处理及 recall 已停用。

个人设置仍独立持久保存：自动积累对话、从工程用户输入推断习惯、对话使用及近期记录保留期。工程习惯默认关闭，开启且 persona 生效时只接纳可归因用户消息，CaptureInbox 落盘前过滤；不再依赖工程知识开关，也不保留整轮工程正文。关闭自动对话采集仍可显式记住，关闭 persona 阻止个人采集/处理/召回并保留数据。长期事实不随近期记录到期。

生产在队列恢复前安装领域策略，并在捕获、候选写锁及召回返回前复核。个人确认不受蓝图模型评分控制。通用队列、来源与审计继续使用；本地模型实现和资源保留，部署 UI 隐藏，个人设置不会启用本地运行。

### 习惯采集接入边界（已明确，待收敛）

2026-10-29 用户要求先保留当前个人习惯采集方案，后续再做大改；本次 hook 简化不改为另一套采集路线。只有个人画像及对应习惯采集选项均开启后，才允许习惯采集接入终端内容。关闭时不为此功能分发内容、排队、补读、持久化或推断；运行中关闭也需阻止在途任务继续采集或提交新结果，保留已有数据。共享 hook 的终端状态职责继续运行，不代表习惯采集获得授权。

P3 已将入口和恢复启停收敛：terminal-handlers 在复制采集载荷、查询 transcript 前检查 persona && inferEngineeringHabits，recorder 在内容处理及入队前再次复核。恢复定时器只在开启时存在；关闭提升 generation、清空活动回合并停止恢复，队列执行、补读、写入和调度结果前均检查 generation 与当前策略。设置保存经 settleMemoryMutations 等待此前已获准写入完成；已启动系统调用不能撤销，旧结果不再发布或触发推断，既有数据保留，重开可恢复此前合法任务。开关四组合、在途关闭、禁用时零恢复文件及排队后关闭不写重试元数据均有回归；命令与范围见 [P3 验证](../terminal/terminal-hook-launch-isolation.md#verification)。标题保留原锚点以兼容既有链接，待收敛内容已实施。

## Alternatives considered

保留现有入口与只控制显示的开关改动最少，但不能满足关闭个人记忆功能的语义，且个人审核仍依赖工程开关。合并总开关减少控件，却使只需要个人助手或只需要工程知识的用户被迫同时开启两个领域。完全独立窗口强调领域边界，但切换与管理成本更高。共用入口与独立分区复用已有组件，代价是需要验收四种开关组合与关闭时的异步结果。

## Consequences

创新开关从入口控制扩展到生产处理控制，旧安装中关闭的功能不会继续积累资料。已存内容不删除，重新开启后队列可处理未完成资料。个人信息读取与编辑复用现有画像组件，不增加第二套画像存储。工程自动模型管线与个人人工审核仍有不同能力边界；此设置不承诺个人记忆自动通过模型审核。

## Verification

本轮工程退出后的组合回归与实际限制见[实施基线](../blueprint/implementation-baseline.md)。以下带日期的历史验收记录保留原事实；其中已删除的工程测试和接口不再作为当前能力。

2026-10-08：蓝图真实录制暴露了 Chat 收尾错误：领域策略拒绝可选采集后，已成功的模型回复和 Note 工具也被显示为失败。Chat 宿主现在仅将精确的 `memory-capture-disabled` 作为预期跳过，保持采集门禁和用户配置；磁盘等其他错误继续上报。`npx vitest run tests/unit/llm/janus-agent-ports.test.ts tests/unit/llm/chat-turn-guard.test.ts` 通过 40 项，覆盖关闭采集、存储失败、载荷与领域隔离。此修复不改变知识入库或质量验收结论。

2026-10-07：个人画像分组调整的 `npx vitest run tests/unit/experimental-features.test.ts --reporter=dot` 为 4 项通过，验证开关默认值、独立性和 IPC 契约；组件 ESLint 与 Note 检查通过。源码复查确认 persona 仅列于 DEV_FEATURES，中英文共用同一分组及已有标题词条。本次未执行浏览器视觉验收。

最终全仓 `npm run test:unit -- --run --maxWorkers=3 --reporter=dot` 为 334 个文件通过、1 个文件失败、3 个文件跳过；2,701 项通过、1 项失败、5 项跳过。唯一失败是 agent-notes-check 对既有跨仓源码链接的严格检查：[圆桌循环 Note](../agent/roundtable-chat-harness-loop.md)与[统一 Note/蓝图 Note](../blueprint/unified-note-blueprint-harness.md)共六处 janus-agentX 源码引用无法解析；未修改这些无关链接或放宽测试。`npm run check:notes` 的结构检查为 235 篇、0 errors、27 项显式链接诊断，结构通过不能替代上述严格链接检查。显式本地实验另行运行，不能把默认跳过项计为通过。

2026-10-04：`tests/unit/knowledge/memory-domain-controls.test.ts` 的 6 项测试检查领域关闭、30 天新记录保留期、显式记住、关闭时保留队列游标、写入前二次授权、真实确认记忆的召回门禁及重开恢复。浏览器复验使用真实 React 组件与 IPC 替身，`knowledge-automation-ui.test.ts` 的 7 项覆盖个人独立打开、设置即时保存、知识设置不被覆盖、审核入口组合与禁用卸载；`memory-review-ui.test.ts` 的 7 项覆盖快照、替代、审核失败及工程精修。深色与 planche、640×720 个人设置截图人工检查通过，未发生横向溢出。

`JANUSX_DESKTOP_ENTRY=artifacts/build-check/main/index.js npx playwright test --config playwright.desktop.config.ts tests/e2e/knowledge-pipeline.spec.ts` 通过 1 项：隔离 Electron 配置走真实 preload/IPC，覆盖采集、审核、正式知识、检索、画像编辑、遗忘、迁移，以及四种 knowledge/persona 组合的实际采集门禁；个人设置保存不修改工程设置。`npm run typecheck:strict-unused`、`npm run build:check`、`npm run i18n:check`、包边界和打包排除检查通过；变更源文件 ESLint 无错误，KnowledgeWorkbench 的既有 refresh effect 依赖警告保留。

本机真实 Qwen3.5-4B Q5_K_M、llama.cpp b11277 Vulkan、RTX 4060 Laptop 运行 `JANUSX_QWEN_SMOKE=1 npx vitest run tests/unit/knowledge/knowledge-local-smoke.test.ts --maxWorkers=1 --reporter=verbose`，以 `-t 'small handbook'` 和 `-t 'longer handbook'` 分别执行基础与长资料专项。基础生成、复核、长中文分词和进程释放验证实际加载 65,536 tokens；检查时可用显存约 6,633 MiB。复用安装资源的基础专项通过耗时 35.92 秒。长手册专项使用 78,388 字节、八主题资料，以生产生成模板保留所有关键数值与例外，复核覆盖八条来源，故意把 7 天改成 3 天被判 unsupported。长手册通过耗时 58.57 秒。128K/256K 与其他 GPU 未实测，容量预算单测不替代硬件实测。

长资料初次无限制思考没有完整返回；生成的 1,024 token 思考预算给正文保留输出空间，接口将非 stop 结束明确报告为 incomplete-model-output。预算复验的一次自定义提示返回 `[id]: backup` 引用形式，不符合该临时测试的方括号断言；生产的来源绑定由宿主 generatedSections 维护，因此最终专项采用生产模板并检查内容及独立复核，未用模型生成的引用标记替代宿主来源检查。原始失败记录保留，本结论不证明任意长文都能生成。

使用 `scripts/benchmark-qwen-reviewer.py` 对已有原集与扩展集合计 164 条样例执行三次非思考审核，共 492 次有效调用，耗时 650.86 秒，中位延迟 1,219 ms。三次准确率分别为 95.12%、94.51%、95.12%，错误放行分别为 2、3、2 条。三次一致规则仍误放行 preference-quote 与 numeric-conflict，expanded-32-no 出现动作波动；一致放行精度 97.98%，正确通过覆盖率 94.17%。基准使用 8K 上下文，测量模型原始判断，不等于生产 64K 全管线验收。这是固定合成集测量，qualityGate 为 not-evaluated-synthetic；不能宣告独立生产质量验收通过。模型 SHA-256 为 `8814232b85594dcd46c50e5b8b29324a7efe9e746edbe8a3d1df3d3fce7aad39`，基准脚本 SHA-256 为 `2d2b1b43889b7fb82332e335f867a05d90d76623d41e55cd37a9b9ee54db6d52`。未修改真实用户自动入库配置。

首次公网安装通过 33,095,916 字节运行程序下载、哈希和解压；权重下载到 458,571,011 / 3,143,656,608 字节后返回 local-download-failed，临时片段清理，完整运行程序保留。随后将已有同版本权重复制到隔离缓存，生产安装器重新校验并进入 ready，推荐 64K；此结果仅验证资源复用，不算首次完整权重公网下载通过。测试产物位于本机 `artifacts/memory-domain-acceptance/`，不进入发布包或版本库。首次全量网络下载、真实独立标注、真实外部提供方组合、其他硬件及长期质量仍是未通过或未执行项。
