# 为 JanusX 做贡献

欢迎提交问题、改进文档、修复 Bug 或贡献功能。人类与 Agent 遵循相同的质量标准；无需安装维护者的个人技能目录。

## 从哪里开始

- 使用问题、Bug、功能建议：[创建 Issue](https://github.com/TreeX-xx/JanusX/issues/new/choose)。先搜索已有 Issue；同一问题补充在原讨论中。
- 小型修复、错字和文档修正：可以直接提交 PR，无需先建 Issue。
- 新功能、接口变更或较大重构：先提交 Issue，说明场景、范围与预期结果，等待维护者确认方向后再投入实现。Issue 被接受不代表已有交付时间。
- 首次开发：按[开发环境指南](./docs/development.md)准备依赖并启动应用；理解相关模块时再查阅 [Wiki](./wiki/README.md)。

## 分支与提交 PR

`develop` 是日常集成分支，`main` 是稳定分支。贡献者通过短期分支提交改动，维护者负责将已验证的开发批次晋级到 `main`。

1. Fork 仓库；有写权限的协作者也使用独立功能分支。
2. 从最新的上游 `develop` 创建分支，例如 `fix/terminal-startup` 或 `docs/contributing`。
3. 保持一次 PR 只解决一个明确问题，避免混入无关格式化、生成文件或个人配置。
4. 完成相关检查，向 **`TreeX-xx/JanusX` 的 `develop`** 提交 PR；尚未完成时先开 Draft PR。
5. 在 PR 中说明问题、行为变化、验证结果和关联 Issue。UI 改动附截图或录像。
6. 根据审核意见修改，重新运行受影响的检查；准备好后标记 Ready for review，由维护者审核并合并。

Fork 的常用命令如下；`origin` 指向你的 Fork，`upstream` 指向原仓库：

```bash
git remote add upstream https://github.com/TreeX-xx/JanusX.git
git fetch upstream
git switch -c fix/terminal-startup upstream/develop
# 完成修改并提交后
git push -u origin fix/terminal-startup
```

若已配置 `upstream`，跳过添加远端。PR 期间需要跟进开发分支时，合并最新的 `upstream/develop` 并解决冲突；不要强推共享分支。跨仓库依赖改动应同时链接相关 PR，并在依赖提交公开可用后更新固定 revision。

提交和 PR 标题描述具体改动，推荐 `fix(terminal): …`、`feat(run): …`、`docs: …`、`chore: …`。中文或英文均可，不要求使用特定 Agent 工作流前缀。

## 验证与文档

- 代码改动：本地优先运行 `npm run verify`。开发过程中可以先运行相关测试；受平台或环境限制未跑的检查，应在 PR 中列明命令、原因和需要 CI 补充的部分。
- 纯文档改动：检查链接、命令和排版；修改 Notes 时运行 `npm run check:notes`。不要求仅为错字修正本地运行整套桌面测试。
- 修复行为缺陷或新增行为时，补充能验证该行为的测试。涉及 UI 文案时同步国际化；涉及架构、对外行为或长期约定时更新对应文档及已有 Note。
- Issue 和 Note 均按需关联。没有 Issue 可省略；普通小修不必为了填模板新建 Note。仓库的 Agent 执行规则见 [AGENTS.md](./AGENTS.md)。

Windows CI 会对目标为 `develop`、`main` 的 PR 运行完整 `verify` 检查，也可手动运行；普通分支 push 不重复触发。CI 未通过不得按常规流程合并；维护者确认必要检查通过、审核意见得到处理后执行合并。新增实质性修改后需重新检查和审核。CI 因权限等待批准时，由维护者审阅后批准运行。

功能分支合入 `develop` 通常使用 squash merge；合并后删除已交付的短期分支。`develop → main` 的晋级 PR 使用 **merge commit** 保留长期分支的共同历史。`develop`、`main`、官网来源 `gh-pages` 长期保留，活跃 worktree 分支在对应工作结束后清理。

## Issue 填写与处理

| 类型 | 需要的信息 |
| --- | --- |
| Bug 反馈 | 应用版本、系统环境、安装来源、触发操作、实际与期望行为；偶发问题可说明频率，附相关截图或日志 |
| 功能建议 | 使用场景、遇到的问题、期望结果；具体方案与替代办法可选 |
| 使用疑问 / 文档问题 | 想完成的操作、已经尝试的方法、卡住的位置或文档链接 |

内测版也按问题类型选择模板，并填写完整版本号；维护者按需加 `beta-feedback`，无需重复提交。每个 Issue 聚焦一个问题。日志、截图和示例文件请移除 API Key、Token、私人对话与敏感路径；不要上传整个用户数据目录。

维护者先确认信息是否充分，再分类、请求补充或讨论方案；重复问题链接原 Issue 后关闭，不采纳的建议说明原因。Label、负责人和 milestone 由维护者管理；认领工作前先留言确认，避免重复投入。修复 PR 合入 `develop` 表示已集成，实际可用版本以 Release 为准。

## 维护者操作

审核规则、`develop → main` 晋级与同步、紧急例外、版本及发布流程见[维护者指南](./docs/maintainers.md)。普通贡献者无需修改版本号、打 tag 或发布安装包。
