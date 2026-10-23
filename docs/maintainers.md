# 维护者指南

贡献入口与 PR 内容要求见 [CONTRIBUTING](../CONTRIBUTING.md)，环境准备见[本地开发指南](./development.md)。本页管理审核、晋级和发布。

## 审核与分支保护

`develop` 和 `main` 应通过 GitHub 分支保护或 ruleset 要求 PR、成功的 `verify` 检查和至少一名非作者审核者批准，并在新增实质性修改后重新审核；维护者负责在仓库设置中配置。仓库文件本身不会创建这些保护规则。

审核关注问题是否解决、范围是否清楚、回归测试是否覆盖，以及文档是否与最终行为一致。未运行的本地检查必须在 PR 中明确，CI 仍须通过。对外部贡献者首次运行工作流的批准应先检查其变更；验证使用 `pull_request` 与只读仓库权限。

作者不能批准自己的 PR。确因紧急修复、CI 基础设施故障或无人可审核而需要管理员例外时，必须在 PR 中记录原因、实际完成的检查、未覆盖风险及后续补验安排；不能把自查写成独立审核。例外仅限维护者显式决定，不授予 Agent 默认绕过权限。常规贡献不直推 `main` 或 `develop`。

## 晋级与同步

1. 维护者确认 `develop` 的当前批次范围清楚，创建 `develop → main` PR，汇总行为变化、关联 Issue 和验证结果。
2. 审核并通过 PR 的 `verify` 后，使用 **merge commit** 合并；不要对长期分支使用 squash 或 rebase merge。
3. 将 `main` 同步回 `develop`：

```bash
git fetch origin
git switch develop
git merge --ff-only origin/main
git push origin develop
```

这里 `origin` 指原仓库。快进同步是维护者的分支同步操作，不包含新的功能提交；若 ruleset 禁止该同步推送，走 `main → develop` 的同步 PR。若无法快进，创建同步 PR、解决冲突并重新验证，使用 merge commit 保留历史，禁止强推覆盖开发。功能分支合入 `develop` 通常使用 squash merge。

Issue 合入开发分支后可关闭并注明“已集成，待发布”；Release 说明应链接相关修复。Label、milestone 由维护者按实际计划维护，不应把旧里程碑名称当成永久流程。

## 版本与发布

版本 tag 使用小写 `vX.Y.Z`，与 `package.json` 的版本完全一致；历史大写 `V*` 保留但不再使用。内测 prerelease 使用明确声明的版本，例如 `v1.0.0-beta.1`，包版本同时设为 `1.0.0-beta.1`。

**推送任意 `v*` tag 都会触发公开发布，没有静默内测 tag。** `release-win` 校验版本、构建 Windows x64 安装版与便携版、核验固定 OfficeCLI 的 SHA256，并验证打包运行时与更新清单。发布脚本先创建临时 draft 并上传全部附件，成功后公开；prerelease 后缀自动对应 GitHub prerelease。未完成的 draft 不会进入更新 feed 和下载页，不能把它当作发布完成。

推荐通过版本 PR 保持审核链：

1. 当前开发批次晋级 `main` 后，从最新 `main` 创建 `release/<版本>` 分支，只修改 `package.json` 和 `package-lock.json` 的版本，创建目标为 `main` 的版本 PR。
2. 审核与 `verify` 通过后合并，检出并确认最新 `origin/main` 的版本，再创建指向该提交的 annotated tag 并推送。
3. 等待 `release-win` 成功，检查附件、`latest.yml`、Release 类型与下载入口，补充发布说明，最后将 `main` 同步回 `develop`。

```bash
# 版本 PR 合并后，在干净且同步的 main 上执行；版本号仅为示例
git fetch origin
git switch main
git merge --ff-only origin/main
git tag -a v0.9.3 -m v0.9.3
git push origin v0.9.3
```

打 tag 前确认它尚不存在、指向预期提交且与包版本相同。不要删除或移动已公开的 tag，也不要覆盖已有 Release。

2026-10-22 维护者明确要求将更新下载与标题栏 UI 修复覆盖到 `v0.9.4`，授权本次移动 tag 并替换 Windows 附件。此例外不改变常规版本递增规则。显式重打包使用 `release-win` 的 `workflow_dispatch`，指定 `release_tag` 和 `replace_existing=true`；该选项在运行时与清单校验通过后才将原 Release 转为 draft、覆盖四个 Windows 附件并恢复公开，保留原说明和 Android 附件。上传失败保留 draft 供恢复，不公开混合附件。替换后维护者须同步 Release 说明和 `SHA256SUMS.txt`，并确认 tag、构建 revision 与附件一致。已有同版本客户端不会自动再次更新，须手动下载安装包。

2026-10-23 维护者在 Windows 10 启动候选包确认可打开后，明确要求将启动修复同步到本地 `main`，替换远程 `v0.9.4` 标签代码及 Windows 安装包，文件名不含 fix。此例外沿用 `0.9.4` 正式版本，从原 v0.9.4 加启动修复独立构建，保留 Android 附件及此前更新下载修复，不把本地 main 的其他开发改动带入发布，也不据此授权推送本地 main 的其他提交。

现有 `npm run release:tag -- <版本>` 是维护者快捷工具：要求干净、同步的 `main`，检查版本递增与 tag 不存在，再生成版本提交、annotated tag 和未入库的发布说明模板；默认只在本地执行，`--dry-run` 可预览，`--verify` 可先跑检查。它**不会创建版本 PR**；`--push` 会直接推送 `main` 和 tag，只能在维护者已明确授权并记录发布例外、且仓库规则允许时使用。不要为了执行脚本临时关闭分支保护。

发布说明写明用户可见变化、修复、已知限制与相关 Issue/PR。若使用生成的模板，完成后通过 `gh release edit <tag> --notes-file <文件>` 或网页更新正文。

## 本地打包与失败恢复

`npm run package:win:portable` 用于便携版迭代检查，可追加 `-- --release-dir artifacts/portable-check`。它使用较低压缩级别但保留包边界、依赖排除、体积预算和运行时检查。`npm run package:win` 生成完整 Windows 产物；macOS/Linux 的命令要求相应构建环境，公开支持范围以 Releases 附件为准。

需要本地正式发布时，维护者可使用 `npm run package:win:publish`，或通过 `npm run publish:win` 验证并上传已有当前版本产物；须先推送匹配 tag、认证 GitHub CLI 并准备工作流中固定版本和校验和的 OfficeCLI。两者都会实际发布，不能当作普通验证命令。

发布失败时先查看失败步骤；部分上传留下的 draft 由维护者确认后处理，再重试，禁止直接跳过运行时检查公开半成品。`release-win` 的手动触发接受已有 `release_tag`，会检出该不可变 tag，并在打包后使用触发 revision 的外部运行时检查脚本；它用于已有 tag 的恢复，不代表可以更改已发布应用。需要改变应用内容时发布新版本。

## 工作流维护

`verify.yml` 和 `release-win.yml` 固定使用上游 `TreeX-X/janus-agentX`，验证还固定使用 `TreeX-X/WorkFlowX`，避免 Fork 在自己的账号下查找缺失的依赖仓库。升级 sibling 时检查提交在远端可读取，并同步两个工作流的 agentX pin、构建顺序和开发说明。修改 `package.json` 的 `verify` 检查链时，同步 `verify.yml` 的拆分步骤。
