---
{
  "schema": "harness-note/2",
  "id": "8bda71ec-1f76-4d89-aabc-f193b2579438",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-27",
  "updated": "2026-10-28T10:54:48.000Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---

# 开发、构建与发布解耦设计

## Intent

用户反馈本地可以编译打包，GitHub 自动构建却频繁失败，引发修复提交和重复运行。目标是让开发反馈及时、正式包来源可追溯、失败可以单独恢复，Windows 交付不依赖云端重复构建，并为 Linux/macOS 留出按需构建入口。本篇保留整体设计与待实施部分，第一阶段代码落地见下节；OfficeCLI 继续内置，不代表其他平台已经通过验证。

调查依据是当前工作区的工作流、打包脚本、维护指南及 Office 集成源码；没有逐条分析失败 run，所以以下环境差异是结构性风险，不能作为某次失败的已证实原因。普通失败重跑是否导致 GitHub 账号风控没有证据；减少资源消耗和无效提交是设计目标，不承诺规避平台判定。

## 第一阶段实现

`release-win` 已改为手动、只读权限的 Windows 构建，只上传保留 14 天的 Actions 附件，包含后续本地检查需要的 `win-unpacked`。版本 tag 不再触发构建。`verify` 取消分支 push 重复运行，保留原 job 名、完整 PR 门禁与手动入口；未调整 GitHub ruleset 或独立审核要求。

本地 `stage:win` 对指定候选目录做更新清单及运行检查，要求干净 checkout 与远端 tag 提交一致。上传仅复用尚未公开的草稿，同名同内容附件跳过，缺件续传，同名不同内容拒绝。`publish:win` 单独核对本地四个附件与远端的大小和 SHA256；远端无摘要时下载比较，再公开，不构建、不运行应用、不上传或替换文件。旧的自动构建公开命令和 `replace_existing` 入口已移除。操作见[维护者指南](../../../docs/maintainers.md)。

正式 Windows 发布推荐现有 `package:win:stage` 入口，构建后在 stage 内完成一次运行验证再上传，避免先运行 `package:win` 后首次 stage 重复验证。上传失败只重跑 stage。stage 在启动 Electron 前预检远端草稿状态、附件大小和可用的 SHA256，检查结束后重新读取远端状态并完整比对，避免检查期间草稿变化后继续上传；远端无摘要的附件仍下载比对，仅执行一次下载。手动 Windows 构建先校验 tag/版本并下载、验证 OfficeCLI，再安装和构建依赖；OfficeCLI 哈希复用本地资源校验脚本，不在 YAML 重复维护。正式构建、包边界、体积、运行检查及公开前远端字节核验均保留，未按 sibling 刷新数量跳过构建。

第一阶段保留当前 sibling 准备和 OfficeCLI 下载方式，未实现统一输入清单、完整构建收据、快速 PR 门禁或新增平台。tag 对齐与附件身份核验并不证明开发机包的完整构建来源，正式候选仍需在匹配 tag 的隔离目录构建并保留；这是下一阶段要消除的人工约束。

打包发布优化验证：`npm run test:unit -- --run tests/unit/publish-win.test.ts --maxWorkers=1` 通过 34 项，覆盖远端冲突前置、运行检查期间草稿状态及附件变化、无摘要附件单次下载和原有断点续传/公开边界。严格 unused 类型检查、发布脚本语法、本地 OfficeCLI 固定哈希及 diff 检查通过；YAML 解析和阶段顺序检查通过。Notes 校验为 0 错误、17 条既存外部链接诊断，本地 sibling 对应目标未全部可达。远端调用由替身验证，未执行完整安装包构建、Electron 运行、云端任务、实际上传或公开。

本地验证：`npm run test:unit -- --run tests/unit/publish-win.test.ts tests/unit/updater tests/unit/app-shutdown.test.ts --maxWorkers=1` 首次通过 67 项；随后补充运行检查期间产物变化、远端无摘要时下载字节不符的回归，单独重跑发布文件通过 27 项。`npm run typecheck:strict-unused`、两个修改脚本的 `node --check`、版本脚本帮助和定向 diff 检查通过。GitHub 命令由测试替身驱动，未实际创建或公开远端 Release，未执行新的云端构建。本次 Notes 无格式或链接错误，仓库其他文档仍有两条旧插件附件断链和两条 entrance-choreography 要求/时间错误。

## 重构前的耦合与持续约束

`verify.yml` 在 PR 和 main/dev push 上跑完整 Windows 检查。同一次功能集成可能先验证 PR、再验证集成分支、再验证晋级 PR。`release-win.yml` 在版本 tag 推送后重新准备 sibling、下载 OfficeCLI、打包并直接公开 Release；因此标签同时承担版本身份和发布触发器。

两个 workflow 分别维护相同 agentX 提交和分层构建命令；本地开发可使用另一个 sibling revision，甚至未提交内容。`prepackage` 检查 sibling 发布文件后执行 `npm install --install-links`，必要时调整 lock 条目；不能将其描述为锁文件完全只读的正式安装。它应继续服务开发刷新，正式构建另设严格入口，避免在任意开发状态上直接执行干净安装。

OfficeCLI 版本和 Windows 哈希在应用路径模块中固定，工作流又重复声明 Windows x64 下载地址和哈希。资源目录直接进入安装包；运行检查和发布脚本均面向 Windows。路径解析器在非 Windows 返回 undefined。`node-pty` 是原生依赖，electron-builder 的自动依赖重建已关闭，必须明确验证目标平台、架构及 Electron ABI。

当前操作归 [维护者指南](../../../docs/maintainers.md)，相关职责归 [分支决策](./development-branch.md)、[可复现验证](./reproducible-verification.md)和 [OfficeCLI 内置决策](./officecli-bundled.md)。下文整体设计未完成的部分仍是拟议状态。

## 外部参考与适用范围

2026-10-27 查询 GitHub 默认分支时，Orca revision 为 `c98a2d639c764b0146c5dc902a6185c114432a85`，Codeg revision 为 `00d5feae7f9b8e1d3455a96242ff52cfc024917d`。以下是代码与配置阅读，不是下载运行或完整代码审计。

| 参考 | 观察到的实现 | JanusX 的取舍 |
| --- | --- | --- |
| [Orca Cut Release](https://github.com/stablyai/orca/blob/c98a2d639c764b0146c5dc902a6185c114432a85/.github/workflows/release-cut.yml) | 手动指定 ref 和版本意图；独立平台构建；最终 job 检查仍是 draft 且所需附件完整，再公开 | 借鉴阶段和产物边界，不引入其庞大的整套 CI，也不照搬自动公开 |
| [Orca macOS 构建](https://github.com/stablyai/orca/blob/c98a2d639c764b0146c5dc902a6185c114432a85/.github/workflows/release-mac-build.yml) | 独立 dispatch，传入 tag、父 run 等信息；有仅做签名公证验证的入口 | 构建目标可独立请求、验证和恢复，云端失败无需重建本地 Windows 包 |
| [Codeg Release](https://github.com/spacering-net/codeg/blob/00d5feae7f9b8e1d3455a96242ff52cfc024917d/.github/workflows/release.yml) | tag 触发，先建或复用草稿，再做 Windows/Linux/macOS 架构矩阵，最终统一公开 | 草稿汇总值得复用；tag 自动触发和完整矩阵不符合本项目当前降频需求 |
| [Codeg Office 集成](https://github.com/spacering-net/codeg/blob/00d5feae7f9b8e1d3455a96242ff52cfc024917d/src-tauri/src/commands/office_tools.rs) | 检测 PATH 和已知安装目录；调用上游官方安装脚本，镜像优先、GitHub 回退；流式日志、互斥、超时杀进程树；从 CLI 导出 skill 并同步 | 证明可以复用引擎；安装治理仍有维护成本，不能照搬后宣称无需管理版本和网络 |
| [Codeg Office watch](https://github.com/spacering-net/codeg/blob/00d5feae7f9b8e1d3455a96242ff52cfc024917d/src-tauri/src/office_watch/mod.rs) | 每个文件使用长驻 OfficeCLI watch，管理持有、续期和预览生命周期 | 类似 JanusX 已有 watch 集成，未自研 Office 格式或排版引擎 |

Orca 可作为发布架构参考。本次没有取得它使用 OfficeCLI 或自研完整 Office 引擎的直接证据；部分远端文件读取超时，不能把未找到实现当成不存在功能。它的 HTML 等预览也不能替代 DOCX/XLSX/PPTX 的等价能力证明。

[OfficeCLI 当前固定版本附件](https://github.com/iOfficeAI/OfficeCLI/releases/tag/v1.0.135)实际包含 Windows、macOS、Linux 的 x64/arm64，以及 Alpine 的两种架构和 SHA256SUMS。各二进制约 33–35 MB（十进制）。跨平台分发有上游资产可复用，但必须在目标系统验证动态库、字体、权限和预览结果。

## 拟议开发流程

### 反馈与环境准备

保留现有 dev/main 职责，本次先不把分支调整与发布重构混在一起。开发环境允许 agentX 联调，开发输出继续隔离在 `.cache`；正式发布只接受已提交、可取得的 JanusX 和 agentX revision。

设置一个跨平台 Node 编排入口，让本地和 Actions 调用相同阶段。YAML 只声明触发方式、runner、权限与缓存，不再各写一份 sibling 构建、工具下载和包验证逻辑。先检查工具链版本、平台能力和输入，再执行昂贵构建；错误报告应指向具体准备步骤。

自动 PR 检查以类型、静态规则和有明确映射的单测为快速入口，目标是数分钟反馈。初期不急于实现复杂的变更测试选择器；完整验证保留手动入口和正式候选门禁。桌面全量、安装包、Office 真实二进制与其他系统验证从普通 push 中移出。可取消 main/dev push 的重复全量运行，但 PR 合并结果的检查与本地候选严格验证仍保留。路径选择不能覆盖到公共核心或不明影响时，执行完整适用检查。

调整 required check 时，先保证新工作流稳定产生同名汇总状态，再由维护者同步 ruleset；不能删除工作流后让所有 PR 永远等候不存在的检查，也不以本草案授权绕过现有审核规则。

### 输入清单和严格构建

建立单一构建输入清单，记录 agentX revision、测试 fixture revision、工具资产版本和各目标 SHA256。Node 版本继续以 `.node-version` 为准；npm、Electron 实际版本、应用 SHA、锁文件摘要和构建工具 revision 写入构建记录。工作流读取该清单，不重复存储 pin。缓存是加速来源，缺失时应能按固定输入重建；缓存不作为真实性依据。

正式候选在隔离工作树或发布目录准备，不能清理用户正在运行的开发环境，也不修改 sibling checkout。对 agentX，近期在隔离目录构建固定提交并生成发布 tgz/文件清单，消费方校验后物化；现有 file: 引用与 npm lock 的转换必须有明确一致性校验，不能简单替换依赖声明后继续使用旧 lock。远期多人复用频繁时再评估固定版本包仓库，不为当前单人流程引入新的在线服务依赖。

开发刷新仍可使用 `prepackage`。正式入口执行锁定安装并拒绝未预期的 manifest/lock 变化；不能只把现有 `npm install` 换成 `npm ci` 就声称完成隔离。必须验证 file: 包内容与目标 SHA、发布文件清单一致，以及干净目录可以准备成功。WorkFlowX 的标准/fixture 属于验证输入，不是安装包的运行依赖。

### 候选产物与发布

流程状态为“准备输入 → 构建候选 → 签名与验证 → 封存产物 → 上传草稿 → 公开”。版本应在构建前写入并提交；本地可以在 push tag 前验证候选，上传前再核对远端 tag 指向同一应用提交。tag 只标记版本，不触发构建。任何签名、公证或二进制修改都发生在最终哈希和更新清单核验之前。

封存目录包含安装包/便携包、对应更新清单、blockmap、SHA256SUMS、构建输入记录和验证收据。每个平台有独立子目录，避免覆盖更新文件。收据绑定产物哈希、目标系统/架构、检查器 revision 与检查时间；一次后续修改使旧收据失效。禁止将未提交工作区包当正式候选，也不把“构建成功”写成“功能测试通过”。

上传只读取指定的封存目录，不再从当前 checkout 的 package.json 推断待发布版本，不安装依赖、不重新编译、不执行上传机器无法运行的平台包。它校验收据、哈希、tag、版本与配置，将完整产物上传到可复用的同版本草稿；相同哈希的已上传文件跳过，不同哈希默认拒绝覆盖。失败保留草稿和报告，恢复只做缺失上传。上传完成后仍保持草稿，最终公开由维护者明确操作。

最终公开入口核对本次发布声明的必需平台、附件和更新清单引用。初期发布计划只要求 Windows x64，未来声明哪些平台，就要求那些平台齐全；不能某次 macOS 失败就静默缩小已声明范围。公开过程不重新生成安装包，不移动已公开 tag，内容修改使用新版本。保留现有 Windows 更新哈希检查，正式发布前核对自动更新入口和下载页。

拟议命令职责如下，命令名尚未实现，不可直接照抄执行：

| 入口 | 职责 | 是否联网发布 |
| --- | --- | --- |
| `doctor` / `bootstrap` | 分别诊断、按固定输入准备开发或严格环境 | 准备可下载依赖，不发版 |
| `check:quick` / `check:full` | 分别执行快速检查、完整适用检查 | 否 |
| `release:build --target …` | 隔离构建指定系统/架构候选 | 否 |
| `release:verify --dir …` | 在目标系统验证该候选并生成收据 | 否 |
| `release:stage --dir …` | 校验并上传同一批产物到草稿 | 上传草稿 |
| `release:publish --tag …` | 核对发布计划，公开完整草稿 | 是 |

平台构建可以在本地或手动 Actions 执行，均调用同一编排入口。Windows 优先本机构建；Linux 可在 Linux 主机/固定容器中准备并在支持的桌面环境验证；macOS 用 Mac 或按需 runner，并完成目标架构的原生模块、签名、公证及运行检查。WSL2/容器产包不等于所有目标桌面验证通过。x64/arm64 不共用 node_modules，平台间可共享固定源码和纯 JS 产物，但先不增加一次构建 JS 再跨平台分发的复杂优化。

### 失败恢复与触发预算

同一应用 SHA、目标和输入摘要只允许一个有效构建；Actions 使用并发组防止重复任务，发布过程串行且不能被新 push 取消。发布流程不自动提交代码、不自动重新触发自己。输入或代码错误直接停止；仅下载等短暂网络错误允许少量、有上限的重试。连续出现相同环境错误后停止重跑，保留日志供本地复现，再提交一个有针对性的修复。

构建、运行检查、上传分别有报告和退出状态。网络上传失败重传，平台构建失败只恢复该目标；只有目标输入或产物失效才重建。构建器、检查器与发布工具 revision 分别记录，允许用新检查器重新验证同一未修改产物，但不能冒充原检查结果。

## Office 能力边界

### 推荐：复用 OfficeCLI，自建稳定适配和资产准备

Office 格式写入、布局和预览引擎继续复用 OfficeCLI；JanusX 自己维护宿主接口、MCP/CLI 适配、工作区文件边界、进程与 watch 生命周期、错误诊断、版本契约和工具分发。不为了消除一个下载步骤重写 DOCX/XLSX/PPTX 引擎。

现有 OfficeBroker 已有命令白名单、路径限制和执行身份校验，保留并整理为清晰的 provider 边界。先只实现一个 OfficeCLI provider，不增加空壳后端。接口按已有真实需求区分探测、create/batch/help、预览/watch 和 skill；预览可用不能自动推出编辑、公式重算或全部 Office 特性可用。下游消费经验证的 provider，不再各自推断工具位置和哈希。

### 近期继续随包分发，先消除构建漂移

新增版本化工具资产清单，按 platform/arch，Linux 必要时按 libc，记录上游文件名、URL、大小、SHA256 和声明的能力。构建阶段下载到按哈希寻址的缓存，校验后在独立 target staging 中放置当前平台工具；缓存命中离线可用。源资源目录不在多目标构建间反复覆盖，缺少固定资产或目标不支持应提前失败。运行时继续使用安装包内已验证路径，不探测任意 PATH 二进制。

同一清单供开发准备、打包和运行时身份校验使用；应用消费构建生成的只读目标元数据，消除 TS、YAML 和脚本重复 pin。资源包先在目标平台验证版本、watch/create/batch、最小文档创建编辑和预览刷新，再进入正式安装包。保留文件缺失、架构不符、ICU/.NET 启动失败等具体诊断；它们不能全部降为“重装应用”。Office 故障不得阻断 Shell、AI 终端和其他宿主能力启动。

macOS 还要核对嵌入工具签名及整包公证，Linux 明确 glibc/musl、ICU 和字体支持范围；上游发布了一个文件不等于宿主即可支持该目标。重分发前核对上游许可及其随附要求。

这保留现有“安装后即可使用、无首次下载”的用户体验，能直接解决 CI 临时下载和平台路径散落的问题。固定版本二进制可在准备阶段取得，不需要每次测试重复下载，也无需把二进制直接提交进 Git 源码历史。

### 后续有证据再拆成独立引擎包

如果安装包体积、OfficeCLI 更新频率或可选功能定位确实形成负担，再评估按需引擎包：优先复用现有插件/包分发基础设施，具备版本清单、可信来源、哈希、原子激活、失败回滚和离线导入。不得在每次启动拉取 latest，也不把全局 PATH 和官方在线脚本当正式构建输入。

Codeg 的官方脚本方案能降低它自己维护下载和 PATH 的工作量，但把网络、上游版本变化与系统依赖放到了用户安装环节。JanusX 已因首用摩擦取消过同类安装流程，不能只为 CI 省事将其恢复。正式产品选随包或按需是体验决策，与构建前缓存二进制是两个独立问题。

只有出现可重复验证的上游能力缺口、兼容性问题或不可接受的许可/维护约束，且薄适配或上游修复无法解决时，才讨论 fork 或替代。对简单表格导出可以局部评估成熟 JS 库，但不能宣称其覆盖 OfficeCLI 的文档编辑、预览、动画或公式能力。完整自研引擎不进入当前路线。

## 分阶段实施与验收

| 阶段 | 修改范围 | 完成条件 |
| --- | --- | --- |
| 一：停止重复发版 | release-win 触发器、Windows 上传/公开职责、维护文档 | push tag 不运行构建；本地候选可上传到草稿；公开不重新编译；上传失败可复用草稿恢复 |
| 二：统一构建输入 | 新编排入口、依赖/工具清单、开发与正式准备分离 | 本地隔离目录和一次手动 Windows CI 使用相同应用/agentX SHA、锁文件和 Office 哈希；全新缓存也可准备；输入不匹配提前失败 |
| 三：分层检查 | verify 工作流、快速/完整检查入口、ruleset 配套说明 | 普通 push 不重复完整验证；PR 仍产生必需状态；候选仍执行完整适用检查与真实运行验证；本地专属配置测试不进入通用门禁 |
| 四：按需平台 | Office 目标解析、node-pty 准备、平台运行检查与手动 runner | 每个新增平台都有真实启动、终端交互、Office 创建编辑预览和安装/权限证据；macOS 完成签名公证，更新能力另行验收 |

针对这次重构，应新增有价值的流程契约检查：草稿断点恢复、哈希不匹配拒绝上传、远端 tag 与收据 SHA 不同拒绝发布、已公开版本拒绝覆盖、缺少必需平台拒绝公开，以及 Office 故障不阻断普通工作区。不要为 YAML 文本逐行镜像写测试，也不因流程拆分删掉已有包边界和运行检查。

## Open questions

下一阶段先统计少量代表性的失败 run，区分输入漂移、下载、工具链、测试/桌面环境和真正源码错误。没有这个证据，不承诺重构后所有 CI 错误消失。

门禁成本与冗余审计已提供第一部分证据：完整 verify 约 27min，其中发布级验收占约六成，且存在同一断言重复执行、排序倒置与 PR 全量跑发布级检查三类冗余；同时确认分支保护未绑定 required status check，门禁当前不阻止合并。该审计只覆盖成本与结构，未逐条分析失败 run，也未区分输入漂移与工具链失败，这部分证据仍然缺失。审计结论、实测数据与建议见[发布门禁成本与冗余审计](./release-gate-redundancy-audit.md)，阶段三的分层范围应在采纳其建议时一并确定。尚需确定首批正式支持的非 Windows 目标、可用 Mac/签名身份、Office 是否仍是默认能力，以及维护者的手动公开入口偏好；这些不妨碍先完成 Windows 发布解耦。

已完成源码调查、设计草案及上述第一阶段流程代码；未运行三个平台的完整构建、Office 二进制或安装测试，未修改 GitHub 设置，未提交、推送或实际发布。本地代码生效于推送并被 GitHub 读取之后。
