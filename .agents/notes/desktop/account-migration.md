---
{
  "schema": "harness-note/2",
  "id": "67d156c7-7751-4fde-83af-4f0c64d34219",
  "kind": "idea",
  "lifecycle": "draft",
  "created": "2026-10-28T00:57:58+08:00",
  "updated": "2026-10-27T16:57:58Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/3a4dc304-70dd-49e4-b46a-ee2fc0fbc83e"
}
---

# 公开仓库账号迁移

## Intent

维护者无法操作旧账号，授权将 JanusX、janus-agentX、WorkFlowX 复制到 TreeX-xx。这是新仓库接管，不是 GitHub ownership transfer；提交和 tags 可以保留，旧仓的 Stars、Issue/PR 身份与下载统计不会自动转移。原作者署名、许可证、Note repoId/UUID、包名与本地 sibling 路径保持不变。

迁移在独立工作树执行，基于本地已提交历史，只加入仓库地址调整和已授权的发布流程修改；其他未提交开发内容保留在原工作区。三个新仓在上传历史前暂停 Actions，避免旧 tags 或历史工作流自动构建。发布流程保留 PR 门禁、手动构建附件、草稿上传与独立公开；OfficeCLI 继续内置。

当前发布目标为 https://github.com/TreeX-xx/JanusX ，sibling checkout 指向同账号的 janus-agentX、WorkFlowX。依赖原提交 SHA 保留，需确保这些提交可以从新仓访问。下载页和插件目录入口准备迁至 https://treex-xx.github.io/JanusX/ ，必须在 Pages 真正可用后检查，不由源码修改推断已经上线。插件签名身份不随账号变化，已有签名清单不能只替换 URL 后继续声称签名有效。

公开历史 Release 附件按旧仓 API 的大小和 SHA256 校验后复制，新仓最终公开前保持草稿。旧 Windows 安装包内仍写有旧更新源，复制文件不会改变其行为；旧账号不可写，无法发布过渡更新，后续需提供新版本供用户手动安装。历史二进制保留其原字节，不能当成已经切换更新源的新构建。

## Open questions

迁移执行证据与失败恢复报告保存在本机忽略目录 `artifacts/account-migration-20261028`。仓库创建、代码与 tags 上传、Release 附件、Pages 和 Actions 设置分别核验；网络失败不能记为完成。完整候选构建及新的迁移安装包另行交付。
