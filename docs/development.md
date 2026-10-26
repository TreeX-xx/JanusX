# 本地开发与验证

先准备 Git、Node.js 和 npm。Node 版本以仓库根目录 [.node-version](../.node-version) 为准，使用随该版本提供的 npm。完整桌面验证以 Windows 为基准；其他平台可运行适用的开发和检查命令，并在 PR 中说明未执行的 Windows 检查。

## 首次准备

以下命令从三个仓库的共同父目录开始执行。JanusX 使用 `file:../janus-agentX/...` 依赖；完整测试还读取 `../WorkFlowX` 的标准与 fixture，目录名和相对位置应保持一致。

```text
workspace/
  JanusX/
  janus-agentX/
  WorkFlowX/
```

```bash
git clone https://github.com/TreeX-X/JanusX.git
git -C JanusX switch develop
git clone https://github.com/TreeX-X/janus-agentX.git
git clone https://github.com/TreeX-X/WorkFlowX.git
```

外部贡献者将第一条克隆 URL 换成自己的 Fork，并按 [CONTRIBUTING](../CONTRIBUTING.md) 配置上游。新建 Fork 时需包含 `develop`；若 Fork 尚无该分支，可先 fetch 上游，再从 `upstream/develop` 创建本地功能分支，跳过上述切换命令。

构建前，在当前 JanusX checkout 的 [.github/workflows/verify.yml](../.github/workflows/verify.yml) 中找到两个 sibling checkout 的 `ref`，分别检出该 revision。固定值随依赖升级变化，不要直接使用 sibling 最新分支替代：

```bash
git -C janus-agentX checkout <janus-agentX-ref>
git -C WorkFlowX checkout <WorkFlowX-ref>
```

`<...>` 是需替换的 revision，占位命令不要原样执行。已有 sibling 工作区包含未提交改动时，另外克隆隔离目录，不要覆盖原工作。

按依赖顺序构建 sibling；逐条执行，任一命令失败就先处理错误：

```bash
cd janus-agentX
npm ci
npm run build --workspace=@janus-agent/agent-core --workspace=@janus-agent/harness-core --if-present
npm run build --workspace=@janus-agent/chat-core --workspace=@janus-agent/harness-node --workspace=@janus-agent/node-hosts --workspace=@janus-agent/notes-cli --if-present
npm run build --workspace=@janus-agent/janus-agent --if-present
npm run build --workspace=@janus-agent/cli --if-present
cd ../JanusX
npm ci --include=dev
npm run prepackage
npx playwright install chromium
npm run dev
```

`WorkFlowX` 供测试和文档检查读取，不需要在其中安装依赖。JanusX 每个 checkout/worktree 都需要自己的依赖目录；不要复制其他工作树的整个 `node_modules`。仓库 `.npmrc` 的 `install-links=true` 与锁文件中的本地包物化方式配套，无需全局安装 TypeScript。

## 日常开发

`npm run dev` 使用 `%APPDATA%/JanusX-Dev`，与安装版和便携版的应用数据隔离。开发输出在 `.cache`，生产构建在 `out`；运行中的生产预览若仍使用 `out`，请用 `npm run build:check` 输出到 `artifacts/build-check`，避免覆盖它正在读取的文件。

开发页面默认绑定 `127.0.0.1`，启动时由系统分配可用端口，实际地址见终端输出；Electron 自动使用该地址。这样可以避开 Windows Hyper-V/WSL 的保留端口范围。需要固定端口时可设置 `ELECTRON_VITE_PORT`，但该端口必须未被系统保留；`strictPort: false` 只能处理端口占用，不能解决保留端口的 `EACCES`。

更新或重新构建 sibling 后，在 JanusX 运行 `npm run prepackage` 刷新已安装副本；它核对 npm 发布文件清单，不会替你编译 sibling 源码。依赖声明变化时提交相应锁文件，并同步 CI 固定 revision。

## 本地测试蓝图插件

完成首次依赖准备后，在仓库根目录执行：

```bash
npm run dev:blueprint
```

命令构建并签署本地插件包，启动完整桌面并安装为停用状态，不需要上传 Release。在这个测试桌面中添加项目，进入“设置 → 插件 → 已安装”，查看 Blueprint 的权限、勾选项目并授权启用，再从工具箱打开蓝图。已有 Note 的浏览不需要模型；测试审核和讨论时，在此测试配置中添加自己的真实模型。

应用数据保存在 `.cache/blueprint-local/profile`，知识库位于其下的 `knowledge`，与日常应用数据分开。设置修改后自动保存，发生并发冲突时保留输入并等待显式重新载入。修改插件代码后，先退出该桌面及启动命令，再重跑；新包使用递增的 `1.0.0-local.N` 版本，数据保留，但需要重新授权启用。本地签名身份和版本产物保存在忽略目录中，正常构建的生产信任配置不变。

只构建不启动时执行 `npm run dev:blueprint -- --prepare-only`。`npm run test:blueprint:local` 在临时配置中验证完整桌面的安装、启用、阅读和桌面退出后的 MCP；`npm run plugins:blueprint:check` 验证仓库外独立构建及同产物的签名载体验证。后者使用确定性模型 fixture，不代表真实供应商审核效果。完整迁移和发布缺口见[官方插件实施记录](../.agents/notes/planning/blueprint-official-plugin.md)。

蓝图包现在为单个自包含 `.jxp`，用户在“设置 → 插件 → 已安装 → 导入插件包”中选择文件，再审阅权限、选择项目并启用。描述与签名已嵌入包内，不需要另外选择 JSON 或上传 Release。发布工具仍生成 `.release.json` 供目录工具使用，用户只需 `.jxp`。本地导入不访问目录服务，普通 ZIP 不受支持；主程序仍需预置信任对应签名公钥，并允许蓝图的本机服务。专用测试构建使用独立本地签名；10-26 交付的正常主程序已预置 janusx-blueprint-20261026 公钥及蓝图 native allowlist，可直接导入同批 .jxp，不会因导入包而自动信任新发布者。目录与 Release 尚未上线。

## 工作区文件归属

源码放在 `src/`、`packages/` 和 `apps/`，自动化放在 `scripts/`，测试与固定 fixture 放在 `tests/`。贡献者说明由 `docs/` 维护，模块事实和验收记录由 `.agents/notes/` 维护；不要把临时报告、截图或手工测试文件放在根目录。

`artifacts/` 收纳验证报告、截图及本地交付副本，`release/` 保留正式交付和校验清单。手工测试素材放在 `artifacts/manual-fixtures/`；需要跟随版本的测试样例应由测试引用并放入 `tests/fixtures/`。历史产物可归档到 `artifacts/archive/<批次>/`，同时记录原位置与归档位置。保留报告、日志、截图和必要的冻结基线，已结束测试生成的隔离 profile、重复暂存安装包及解包目录可以在核实后归档或清理。

Android 源码和 Gradle 配置由 `apps/android-lab/` 维护，构建及验证工具由 `scripts/android-lab/` 维护；Cloudflare Worker、Pages 入口、依赖锁文件、测试及部署说明放在 `scripts/remote-lab/cloudflare/`，应随源码提交以便复现和维护。APK/AAB、构建缓存、日志、`local.properties`、Wrangler 登录状态和签名密钥不进入 Git；安装包按需要单独交付，不与源码混放。

清理前核实路径、Git 跟踪状态、进程引用和工作树登记。`.cache` 可能承载正在运行的开发输出，`.codex-tmp` 可能包含 Git 工作树，`release/*/data` 与 `.janusX` 可能包含真实数据；不能仅凭目录名或忽略规则清空。保留当前 `out`、依赖、Android 工具链及正在使用的安装包。文件归档不是磁盘空间回收。

## 检查命令

| 命令 | 用途 |
| --- | --- |
| `npm run verify` | 完整检查：主题、类型、单测、构建、包边界、打包排除清单、国际化、Notes、lint 和桌面冒烟 |
| `npm run test:unit -- --run <测试文件路径>` | 运行指定单元测试 |
| `npm run typecheck` / `npm run lint` | 类型和静态检查 |
| `npm run check:notes` | 检查仓库 Note 结构与引用 |
| `npm run test:e2e:island` | Island 浏览器交互检查 |
| `npm run test:e2e:desktop` | 已构建 Electron 的桌面检查，先运行 `npm run build` |
| `npm run verify:local` | 完整检查再加维护者个人技能同步检查，外部贡献者无需运行 |

CI 拆分执行 `verify` 的各步骤以便定位故障，单测会限制 worker 数量。CI 定义与本地命令应同步维护。PR 中记录实际执行的命令和结果，未运行的检查写明原因。

## 常见环境问题

- dev 提示缺少工具或命令 shim：在当前 checkout 运行 `npm ci --include=dev`。
- Electron 二进制缺失（例如安装时跳过了脚本）：运行 `npm rebuild electron`。
- `@janus-agent/*` 入口缺失或更新未生效：确认 sibling revision 和构建结果，再运行 `npm run prepackage`。
- 测试报告 Chromium 缺失：运行 `npx playwright install chromium`。
- 测试报告 `../WorkFlowX` 不存在：检查 sibling 位置及 CI 中固定的 revision。

启动前的环境检查只报告问题，不会自动联网安装依赖或修改 sibling。不要在 PR 中提交个人配置、运行数据、构建产物或凭据。
