---
{
  "schema": "harness-note/2",
  "id": "70970ea2-2ac0-41c7-a8c5-53a1d671671d",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-03",
  "updated": "2026-11-04T15:59:18.394Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c",
  "relations": [
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/97a21dee-2b5e-4cf8-8298-28263eeb02bb"
    },
    {
      "type": "related-to",
      "target": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/640a69dd-bbea-4606-b51a-f9b545de37a5"
    }
  ]
}
---

# 工作区仓库侧栏

## Problem

用户需要在应用中浏览和操作仓库 Issue、PR／MR。登录入口收进工作区的三个点菜单，右侧仓库未登录时也提供可点击的登录提示。Git 本地变更、提交与历史继续归 Git 工作台。

## Decision

左侧工作区行保持原有导航布局，三个点菜单提供“登录 GitHub／GitLab”，打开菜单时检查授权，已有有效 CLI 授权则显示“查看仓库”。右侧“仓库”检测未登录后显示登录提示，用户点击才启动授权。两个入口共用登录窗口，启动本机 gh／glab 官方浏览器授权流程，并展示官方提示、一次性验证码和交互输入。缺少 CLI 时提供安装指引；关闭窗口会终止此次登录，十分钟超时也会回收进程。登录进程结束后重新检查平台授权，不能仅凭退出码宣布登录成功。JanusX 不注册 OAuth 应用，也不保存平台凭据。

右侧注册 janusx.repository 内置扩展，复用[右侧工具容器](../right-dock.md)的悬浮预览、点击固定和宽度记忆，默认 380px，范围 340–520px。仓库入口和面板标题统一使用 RepositoryIcon：带顶部分隔线的圆角容器内置代码括号，表达代码仓库，与 Git 分支及 README 书本图标区分；16px 尺寸、1.6 线宽、颜色和选中状态沿用工具栏主题。只支持 GitHub.com 和 GitLab.com。仓库身份使用当前工作区 origin，头部明确显示平台、仓库名和 origin；首版没有多远端切换，也不会把 upstream 自动当作操作目标。

仓库页提供概览、Issues 与 Pull Requests／Merge Requests 三个标签，首次默认概览，标签支持方向键切换并记忆工作区选择。概览按需读取平台简介、可见性和默认分支，以及该分支的 README；未进入 Issue／PR 标签时不查询列表。README 用 Markdown 渲染，支持相对文档链接和内嵌图片，原始 HTML 继续跳过。正文预览上限为 512 KiB，缺失文件与权限／网络失败分别处理，README 失败保留仓库元信息。复杂内容可打开平台原页；不增加 Actions、Release 或项目看板。

Markdown 图片接近视区时才加载，按面板宽度等比缩放，点击在应用内居中放大，长图可滚动，Escape 关闭并返回原焦点。相对路径、仓库根路径和当前分支的 blob／raw 链接通过 gh／glab 读取选中仓库，支持私有仓库，凭据不进入 renderer 或外部请求。单张仓库图片限制 4 MiB，GitHub 大于 1 MiB 时用已校验 SHA 的 blob 接口读取；支持 PNG、JPEG、GIF、WebP、SVG、AVIF、ICO。HTTP(S) 外链图片由浏览器无 referrer 加载。失败保留替代文字、重试和打开原图入口；图片复用有容量限制的会话内存缓存，不写入磁盘。HTML 图片、LFS 指针和其它分支的私有图片链接不作为本版支持范围。

Issue／PR 支持关键词、未关闭／已关闭／已合并／全部状态及所有人／我创建的／分配给我筛选，列表每页二十条并可继续加载。筛选复用共享 Select，搜索行保留文字新建按钮，头部与 README 使用中性分隔、统一间距和主题颜色。GitHub 使用仓库约束的搜索接口，输入作为字面短语，最多浏览一千个匹配结果，限制和不完整结果会提示。GitLab 使用项目列表与服务端搜索；已关闭和已合并分别筛选。这里的列表独立于当前任务盘分支。

条目详情显示正文、标签、负责人、普通讨论评论，以及 PR／MR 的源分支、目标分支与当前提交检查。支持新建 Issue、创建草稿或普通 PR／MR、编辑标题和正文、评论、关闭、重开和压缩合并。创建 PR／MR 需要源分支已推送，不自动执行 Git push。合并先展示编号、分支与提交确认，再提交该 SHA；远端已更新或平台未确认合并时显示失败，不宣称成功。项目权限仍由服务端校验，连接成功或 CI 通过均不等于有写入／合并权限。

Issue 的“创建任务盘”复用现有 WorktreeComposer，预填标题、分支和 Issue 编号；用户仍确认任务盘创建。现有 Issue composer 与 Ship 保留各自工作流，平台认证边界见 [GitLab](../../remote/gitlab-provider-reviews.md)和 [GitHub](../../remote/hosted-github-reviews.md)。

## Alternatives considered

独立 OAuth 应用会增加凭据生命周期维护，因此继续复用官方 CLI。常驻连接按钮和仓库快捷图标增加工作区行的视觉负担，登录改用三个点菜单，并通过右侧仓库的未登录提示提供操作入口。旧分支接口不足以支持仓库级分页和详情，因此新增 Hosted 仓库服务，既有任务盘工作流继续使用原接口。

## Consequences

同一工作区切换任务盘仍浏览同一仓库。Issue 与 PR／MR 分别记忆筛选和滚动位置，列表缓存保留已加载分页。概览、列表、详情、评论与仓库图片共用会话内存缓存，按工作区、仓库身份、资源、查询和页码隔离；最多 160 项，序列化内容估算上限 32 MiB，按最近使用顺序淘汰，不写入磁盘。列表／详情／评论保鲜 60 秒，概览／图片保鲜 5 分钟；重新访问先展示缓存，过期时后台更新，失败保留原内容和重试入口。同一资源的在途请求合并，重复点击当前标签不发起读取。

正常打开面板或菜单可复用 60 秒内的成功连接检查；显式重试连接和登录完成仍重新验证，内容刷新不重复运行认证检查。评论成功只更新讨论；编辑、关闭、重开与合并更新详情并使相关列表失效，创建后使列表失效。合并确认前强制读取最新详情，仍按展示的 SHA 提交。登录完成或检测到认证失效会清空资源缓存，并阻止旧会话响应重新填充。手动刷新重新确认 origin 并使仓库缓存过期。切换工作区使用独立视图状态和请求代次，旧响应不能覆盖新仓库。右侧隐藏后不发起新的浏览查询，不做后台轮询。未提交编辑草稿不承诺跨关闭保留；首次读取仍受 CLI 与平台网络耗时影响。

Hosted IPC 的每次查询和写入都携带展示时的仓库 key，主进程重新读取 origin 并比对，避免 remote 修改后沿用旧界面写入新仓库。Windows／WSL／SSH 仍通过工作区运行时读取 remote；平台 CLI 在桌面端运行，不把运行时 URI 用作本地 cwd。登录会话按窗口隔离，仅传递官方终端输出；窗口销毁、取消或超时回收进程。

GitHub 详情的检查与状态按 PR head SHA 查询，每类最多一百条，超出时提示浏览器查看；GitLab 只显示与 MR 当前 SHA 匹配的 head pipeline。普通评论分页不等于完整代码评审线程。检查获取失败保留条目详情并显示错误；列表查询失败不显示为空仓库。写入失败保留评论／编辑草稿，写入成功后的刷新失败不会自动重发写入。

## Remaining scope

自建实例、账号系统和托管平台设置页不再属于范围。多远端／fork 选择、待我评审筛选、PR／MR 直接进入任务盘、添加上下文到对话、完整差异、行级讨论与评审批准仍是后续能力。右侧首版不提供自动合并开关；旧 Ship 的自动合并能力没有迁移成完整服务端状态投影。

## Verification

与自动化 worktree 一并整合到 v0.9.8 之后的 dev：保留本地 Skills／MCP 设置入口、仓库与自动化工具注册，以及现有中性滚动条和键盘焦点修复。图片放大遮罩使用共享主题令牌。整合后的相关单测 347 项通过、5 项外部环境用例跳过；仓库等 72 个浏览器主场景分批通过，工具栏另复测 11 项通过。严格类型检查、生产检查构建、双语和主题检查通过，ESLint 为 0 错误、51 条既有警告。原 worktree 的测试资料归档到 `artifacts/worktree-integration-20261104/repository/`，新证据位于 `artifacts/worktree-merge-*`；未执行真实托管平台账号写入验收。

加载优化：缓存、连接状态、CLI 和仓库接口共 40 项单测通过，覆盖保鲜期限、请求合并、容量淘汰、失败重试、写入失效、认证清理与旧会话响应隔离。仓库浏览器回归 22 项通过，新增请求计数验证标签／详情／图片复用、评论局部刷新、更新中保留内容、分页返回位置和读写认证失效；产物位于 `artifacts/repository-cache-final/`。类型、定向 ESLint、国际化与 Note 检查通过。使用模拟平台响应验证交互和请求次数，未测量真实网络下的首载耗时。

图片增量：`npx vitest run tests/unit/hosted-images.test.ts tests/unit/hosted-repository.test.ts tests/unit/remaining-ipc-contract.test.ts` 40 项通过，覆盖双平台授权读取、二进制完整性、路径／分支编码、GitHub 大文件 blob 回退、超限和仓库身份校验。仓库浏览器回归 18 项通过；最终居中样式调整后复跑 3 项图片测试通过，覆盖内嵌外链、懒加载、放大／Escape／焦点归还、失败重试。截图 `artifacts/repository-images-final/` 已目视检查，类型、定向 ESLint、双语和 Note 校验通过。私有图片授权路径使用 CLI 测试桩，未进行真实私有仓库或打包 Electron 验收。

概览增量验证：`npx vitest run tests/unit/hosted-repository.test.ts tests/unit/hosted-handlers.test.ts tests/unit/remaining-ipc-contract.test.ts` 28 项通过；`npx playwright test tests/e2e/repository.spec.ts --project=island --timeout=60000` 15 项通过，控件间距最终调整后复跑 3 项概览／共享筛选测试通过。覆盖双平台元信息、README UTF-8、默认分支路径、缺失／失败／超限、仓库身份约束、键盘切换、空态重试和已有写入流程。最终双主题截图位于 `artifacts/repository-overview-final/`，已目视检查；类型、定向 ESLint、国际化及 Note 检查通过。平台响应为测试桩，未进行打包应用真实账号验收。

接口回归位于 tests/unit/hosted-repository.test.ts、hosted-login.test.ts 和 remaining-ipc-contract.test.ts，覆盖仓库隔离、分页、查询约束、Issue／MR 评论路径、提交绑定、写入结果、登录归属与回收。浏览器回归位于 tests/e2e/repository.spec.ts，挂载真实 Sidebar、RightDock 和仓库视图，以模拟平台响应验证点击授权、列表／详情、写入和工作区切换。截图位于 artifacts/repository-panel/。这些测试不进行真实账号登录或远端写入，不能替代打包后真实账号验收。

2026-11-04：登录入口调整后，`npm run test:e2e -- tests/e2e/repository.spec.ts tests/e2e/sidebar-design.spec.ts` 的 18 项回归通过，覆盖菜单登录、右侧未登录提示、授权取消、缺少 CLI 和既有侧栏交互。类型检查、定向 ESLint 及双语文案检查通过。菜单和未登录状态截图已人工检查，截图保存在 `artifacts/repository-panel/menu-login/`。平台响应使用测试桩，未执行真实账号登录或远端写入。
