# 维护者指南

贡献入口与 PR 内容要求见 [CONTRIBUTING](../CONTRIBUTING.md)，环境准备见[本地开发指南](./development.md)。本页管理审核、晋级和发布。

## 审核与分支保护

`main` 已启用 GitHub 分支保护：所有变更必须通过 PR 合并，管理员也受约束，禁止强推和删除分支。当前未设置强制批准人数或 required status check；`dev` 保持可推送，供维护者同步已集成的 `main`。常规功能与晋级 PR 仍应通过 `verify` 并取得至少一名非作者审核者批准，新增实质性修改后重新审核。仓库文件本身不会创建这些保护规则。

审核关注问题是否解决、范围是否清楚、回归测试是否覆盖，以及文档是否与最终行为一致。未运行的本地检查必须在 PR 中明确，CI 仍须通过。对外部贡献者首次运行工作流的批准应先检查其变更；验证使用 `pull_request` 与只读仓库权限。

作者不能批准自己的 PR。确因紧急修复、CI 基础设施故障或无人可审核而需要审核或检查例外时，必须在 PR 中记录原因、实际完成的检查、未覆盖风险及后续补验安排；不能把自查写成独立审核。例外仅限维护者显式决定，不授予 Agent 默认绕过权限。所有 `main` 变更仍须通过 PR，不能以例外为由直推；常规功能贡献也不直推 `dev`。

## 晋级与同步

1. 维护者确认 `dev` 的当前批次范围清楚，创建 `dev → main` PR，汇总行为变化、关联 Issue 和验证结果。
2. 审核并通过 PR 的 `verify` 后，使用 **merge commit** 合并；不要对长期分支使用 squash 或 rebase merge。
3. 将 `main` 同步回 `dev`：

```bash
git fetch origin
git switch dev
git merge --ff-only origin/main
git push origin dev
```

这里 `origin` 指原仓库。快进同步是维护者的分支同步操作，不包含新的功能提交；若 ruleset 禁止该同步推送，走 `main → dev` 的同步 PR。若无法快进，创建同步 PR、解决冲突并重新验证，使用 merge commit 保留历史，禁止强推覆盖开发。功能分支合入 `dev` 通常使用 squash merge。

Issue 合入开发分支后可关闭并注明“已集成，待发布”；Release 说明应链接相关修复。Label、milestone 由维护者按实际计划维护，不应把旧里程碑名称当成永久流程。

## 版本与发布

版本 tag 使用小写 `vX.Y.Z`，与 `package.json` 的版本完全一致；历史大写 `V*` 保留但不再使用。内测 prerelease 使用明确声明的版本，例如 `v1.0.0-beta.1`，包版本同时设为 `1.0.0-beta.1`。

**tag 只标记版本，推送不触发构建或公开发布。** Windows 优先本地构建；`stage:win` 验证已有包并上传到草稿，`publish:win` 核对远端附件后单独公开。OfficeCLI 保持固定版本随包内置。稳定版与 beta 由包版本决定，草稿不进入更新 feed 和下载页。

推荐通过版本 PR 保持审核链：

1. 当前开发批次晋级 `main` 后，从最新 `main` 创建 `release/<版本>` 分支，只修改 `package.json` 和 `package-lock.json` 的版本，创建目标为 `main` 的版本 PR。
2. 审核与 `verify` 通过后合并，检出并确认最新 `origin/main` 的版本，再创建指向该提交的 annotated tag 并推送。
3. 在该版本的干净 checkout 中本地构建、上传草稿、补充说明，再单独公开；检查更新清单、Release 类型与下载入口，最后将 `main` 同步回 `dev`。

```bash
# 版本 PR 合并后，在干净且同步的 main 上执行；版本号仅为示例
git fetch origin
git switch main
git merge --ff-only origin/main
git tag -a v0.9.3 -m v0.9.3
git push origin v0.9.3
```

打 tag 前确认它尚不存在、指向预期提交且与包版本相同。不要删除或移动已公开的 tag，也不要覆盖已有 Release。

2026-10-22 维护者曾明确授权将更新下载与标题栏 UI 修复覆盖到 `v0.9.4`，移动 tag 并替换 Windows 附件。旧流程通过 `replace_existing` 隐藏、替换并恢复公开，保留原说明和 Android 附件；这是历史的一次性例外。当前脚本已移除该入口，拒绝修改已公开版本，常规修复使用新版本。已有同版本客户端不会自动再次更新，须手动下载安装包。

2026-10-23 维护者在 Windows 10 启动候选包确认可打开后，明确要求将启动修复同步到本地 `main`，替换远程 `v0.9.4` 标签代码及 Windows 安装包，文件名不含 fix。此例外沿用 `0.9.4` 正式版本，从原 v0.9.4 加启动修复独立构建，保留 Android 附件及此前更新下载修复，不把本地 main 的其他开发改动带入发布，也不据此授权推送本地 main 的其他提交。

现有 `npm run release:tag -- <版本>` 是维护者快捷工具：要求干净、同步的 `main`，检查版本递增与 tag 不存在，再生成版本提交、annotated tag 和未入库的发布说明模板；默认只在本地执行，`--dry-run` 可预览，`--verify` 可先跑检查。它**不会创建版本 PR**；`--push` 会直接推送 `main` 和 tag，与当前 `main` 的强制 PR 保护不兼容；应使用上面的版本 PR 流程，合并后单独打 tag。不要为了执行脚本临时关闭分支保护。

发布说明写明用户可见变化、修复、已知限制与相关 Issue/PR。模板默认写入忽略目录 `release/release-notes-v<版本>.md`，避免生成未跟踪文件影响干净 checkout 校验；自定义路径也应在忽略目录中。上传草稿后通过 `gh release edit <tag> --notes-file <文件>` 或网页更新正文，再运行公开命令。

## 本地打包与失败恢复

`npm run package:win:portable` 用于便携版迭代检查，可追加 `-- --release-dir artifacts/portable-check`。它使用较低压缩级别但保留包边界、依赖排除、体积预算和运行时检查。`npm run package:win` 生成完整 Windows 产物；macOS/Linux 的命令要求相应构建环境，公开支持范围以 Releases 附件为准。

本地发布须准备已构建的固定 sibling、内置 OfficeCLI 和 GitHub CLI 登录，并使用与远端 tag 指向相同提交的干净 checkout。先完成版本提交，再构建；准备步骤若改变锁文件或打包清单，应将变化纳入版本提交并重新构建，不能忽略输入变化。

```bash
npm run package:win
npm run stage:win
# 检查草稿并填写说明，tag 仅为示例
gh release edit v0.9.5 --notes-file release/release-notes-v0.9.5.md
npm run publish:win
```

`package:win` 构建并执行运行检查；`stage:win` 不编译，会再次运行包检查，校验安装包与更新清单，再将四个 Windows 附件上传到草稿。需一次完成构建与草稿上传时使用 `package:win:stage`；旧的 `package:win:publish` 已移除。

`publish:win` 不编译、不启动应用、不上传文件，只核对草稿的四个远端附件与本地候选逐字节身份一致，再公开。它仍需保留同一候选目录及匹配版本的干净 checkout；不能切到新版本后发布旧目录。两个命令都支持 `-- --release-dir <目录>`，公开前不能清理候选文件或修改安装包。

草稿上传可重复执行：同名同内容附件跳过，缺件续传；同名不同内容、错误 tag、错误 prerelease 状态或已公开版本均拒绝。远端提供 SHA256 时核对摘要，否则下载该附件核对。已有说明和其他附件不会被改写。首次上传产生的草稿保持私有，只有独立公开命令改变可见性。

上传失败时保留本地候选和草稿，重跑 `stage:win` 续传，不需要重编译；公开失败时修复网络后重跑 `publish:win`。内容不同的残留附件需要维护者在仍未公开的草稿中核对并处理，脚本不会自动覆盖。禁止直接跳过完整性检查公开半成品。

`release-win` 只接受手动 `workflow_dispatch`，指定已有 `release_tag` 后构建和验证，上传保留 14 天的 Actions 附件，不创建或公开 Release。任务只有只读仓库权限，没有发布 token；同 tag 构建串行。附件含安装包、便携包、清单、blockmap 和 `win-unpacked`，下载解压后可在匹配 tag 的本地 checkout 中检查，并通过 `--release-dir` 上传草稿。手动构建在打包后使用触发 revision 的外部检查工具，不修改不可变应用 tag。平台构建失败不会影响已保存的本地 Windows 候选。

## 工作流维护

`verify.yml` 和 `release-win.yml` 固定使用上游 `TreeX-xx/janus-agentX`，验证还固定使用 `TreeX-xx/WorkFlowX`，避免 Fork 在自己的账号下查找缺失的依赖仓库。升级 sibling 时检查提交在远端可读取，并同步两个工作流的 agentX pin、构建顺序和开发说明。修改 `package.json` 的 `verify` 检查链时，同步 `verify.yml` 的拆分步骤。

`verify` 保留原 PR job 名与完整检查，取消 main/dev push 的重复运行，仍可手动触发。required check 名和完整 PR 验证链保持不变，GitHub 实际保护设置见本页的审核与分支保护约定。统一构建输入、正式构建收据和更多平台属于[后续设计](../.agents/notes/desktop/release-delivery-design.md)，当前 tag 对齐检查不等于已经证明开发机二进制的完整构建来源。
