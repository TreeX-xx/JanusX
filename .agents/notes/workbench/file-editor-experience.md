---
{
  "schema": "harness-note/2",
  "id": "8898f65e-ec54-46d7-9f12-5937db991221",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-10-19",
  "updated": "2026-10-24T10:10:36Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 文件编辑窗口与预览体验

后续已确认、尚未实施的窗口统一与默认内嵌方向见[统一文件窗口与内嵌／浮窗路由](./unified-file-window.md)。下文保留当前实现与验证，不代表统一路由已交付。

## Problem

双击文件自动进入 Git 差异视图，Markdown 编辑区受红绿变更块干扰；关闭采用系统弹窗，且保存 IPC 返回错误仍可能被当作成功；双栏 Markdown 未联动。HTML 的窄 iframe 视口裁切固定画布，srcDoc 缺少本地资源基址；Markdown 内嵌的 picture/source 等 HTML 图片结构无法正常预览。

## Decision

文件窗口定位为 ADE 中的当前文件阅读与轻量编辑界面。代码定位保留 Ctrl/Cmd+F 文件内搜索，移除定义／引用／符号导航、F12 跳转及设置中的语言服务区。clangd 安装、探测、IPC 和进程管理，以及 TS/JS 工作区源码预加载均已移除；Monaco 内置定义、引用和符号提供器关闭，语法高亮、编辑保存、差异对比与文件视图状态继续保留。

文件树双击打开独立编辑窗口。代码、Markdown 和 HTML 源码默认使用普通 Monaco 编辑器；独立窗口的“与 HEAD 比较”按钮才读取 Git 基线并切换 DiffEditor。没有可用基线时提示原因并继续普通编辑，不阻塞文件打开。退出比较保留草稿、光标和滚动状态；基线按需读取，不沿用长期缓存。

独立窗口、内嵌面板和标签关闭共用三选项保存弹窗，采用应用主题、中英文文案、文件相对路径列表和键盘焦点约束。取消保留编辑；不保存关闭目标；保存并关闭逐一保存目标文件，失败则保留弹窗和草稿，允许重试。主进程拦截原生窗口 close，向对应 renderer 发请求，收到该窗口确认后才关闭，避免 beforeunload 引发系统卸载确认。嵌入主工作区时传递草稿后确认关闭源窗口。

保存必须检查 IPC 的 success/error，不能只判断 Promise 是否兑现。写入期间发生的新编辑仍标记为 dirty，关闭流程会再次检查。强制销毁窗口与整个应用的现有关闭机制不属于本次窗口关闭确认的扩展范围。

Markdown 双栏默认开启左侧带动右侧的同步滚动，可手动关闭。专用 rehype 插件为顶层块保留源码行号，结合 Monaco 实际行位置和预览块位置插值；首尾对齐，图片加载、编辑内容和分栏尺寸改变后重新测量。只使用整篇高度比例会在大图、表格和代码块处漂移，因此不采用。当前为单向同步，顶层长列表或长代码块内部采用插值，没有逐行渲染位置映射。

文件与产物 Markdown 预览按 raw HTML → sanitize → 图片 URL 校验 → 源码块标记（编辑窗口）的顺序处理，支持 picture/source/img、srcset、尺寸和 details/summary。图片支持远程及本地资源，媒体查询中的明暗分支跟随应用主题；保留作者 URL，不替作者改写 theme 查询参数。外部 HTTP(S) 链接通过系统浏览器打开。脚本、事件属性、style 和 iframe 等不进入 Markdown 预览，聊天区不因此开放 raw HTML。

HTML 共用 HtmlPreviewFrame，默认 1280×800 虚拟视口与适合窗口缩放，可选桌面／移动尺寸、响应式模式、50%–150% 和刷新。固定视口在父容器中缩放；100% 等实际比例允许外层双向滚动，长文仍由 iframe 内部按原页面规则滚动。响应式模式采用实际面板尺寸，不改写文档 overflow。

主进程提供 127.0.0.1 随机端口的只读资源服务，以随机 capability 和 renderer 所属租约限定工作区。HTML 草稿内存更新，CSS、模块脚本、CSS 内图片及 fetch 等保留浏览器原生相对路径解析；根相对路径通过同源 Referer 归入租约。只读 GET/HEAD，限制文件类型和 32MB 大小，真实路径检查拒绝工作区外资源；关闭预览或销毁窗口释放租约。HTTP iframe 与应用来源隔离，不提供 preload。建立租约期间显示加载提示，避免先运行 srcDoc 再运行 HTTP 页面；服务不可用时回退有限媒体解析，并移除 allow-same-origin 保持脚本隔离。

## Alternatives considered

仅隐藏导航按钮仍需维护语言服务安装、协议、进程与工程索引，不符合轻量预览定位，因此连同底层链路移除。代价是文件窗口不再提供代码语义导航，需要完整工程导航时交由外部 IDE；只有出现明确且持续的使用需求时才重新评估。升级不删除用户系统中的 clangd，也不主动清理旧版托管下载目录。

保留自动 Diff 并减淡颜色无法恢复普通编辑的空间与行文连续性；隐藏 Diff 高亮还会掩盖实际模式。系统保存弹窗可减少组件代码，但不能满足应用主题一致和失败留窗的交互。仅靠 beforeunload 会进入浏览器卸载确认流程，因此使用主进程关闭请求与 renderer 确认的握手。

仅增加滚动条不能恢复原页面 overflow:hidden 裁掉的内容；统一覆盖 overflow 会改变布局。全量把 CSS／脚本内 URL 重写为 data URL 难以保留模块导入与 fetch 语义，因此 HTML 使用只读 HTTP 来源，Markdown 的图片继续沿用轻量二进制读取。Markdown 直接放开全部 HTML 会使文档干扰应用，故解析后保留安全标签和属性。

## Consequences

文件打开不再等待 Git 基线，差异视图成为显式选择；关闭与保存结果可被行为测试覆盖。滚动同步需要维护源码块到 DOM 的对应关系，每次滚动帧按当前几何位置计算，长文性能或块内精度不足时再考虑缓存锚点和更细映射。完整应用退出与强制销毁仍遵循现有机制。

## HTML 对照诊断

`html-preview-diagnostics.spec.ts` 已由诊断断言改为目标行为验收，覆盖响应式页面、固定画布、overflow:hidden 画布、外部资源、草稿刷新、脚本开关、租约释放及 srcDoc 降级隔离。

1100×760 窗口的默认双栏 iframe 实测约 549×655。响应式 100vw/100vh 样例完整显示；1000×700 固定画布在浏览器中完整显示，在双栏中同时产生横纵溢出。原始页面给 html/body 设置 overflow:hidden 时，超出部分被页面裁切，单独添加 iframe 滚动条不能恢复。样例中未发现 iframe 越出父容器边界。

原 srcDoc 中相对 theme.css 和 page.js 因基址不同未加载，现由资源服务修复，详见 [本地资源解析](./markdown-preview-local-assets.md)。适合窗口只保证所选视口完整显示；超过视口的长页面或比 1920×1080 更大的固定画布仍受原页面布局规则约束，可按页面选择视口和缩放。需要 Node／开发服务器、服务端路由或构建的项目不由静态预览执行。

## 验证

语言服务移除验证（2026-10-24）：`editor-find`、`editor-tabs`、`editor-cache`、`workspace-ipc-contract`、`app-shutdown` 和 `workspace-runtime-files` 共 47 项单测通过。真实 Electron 的定义导航移除、文件内搜索控件、标签复用、保存关闭和 HTML 草稿预览共 5 项通过；导航用例修正搜索输入的填充方式后单独复测通过。WSL 中的 Office 扫描专项通过，源码扫描模式被拒绝。严格 unused 类型检查、应用构建、中英文文案检查和触及源码 ESLint 通过。全库 Note 校验仍有本次未修改文件中的 3 项错误：`entrance-choreography.md` 缺少 AC 且 updated 早于 created，`island-behavior-system.md` 缺少 Evidence；外部链接诊断保持未解析。未运行全库 verify。

通用设置浏览器回归 `theme-settings.spec.ts` 6/6 通过，覆盖 1100／480／320px 布局、主题切换与保存失败恢复，并确认语言服务和 clangd 入口均已移除。

### 原有预览功能验证（历史记录）

`npx vitest run tests/unit/html-preview-server.test.ts tests/unit/markdown-preview-html.test.ts tests/unit/local-asset-resolver.test.ts tests/unit/markdown-scroll.test.ts tests/unit/editor-tabs.test.ts tests/unit/editor-window-manager.test.ts tests/unit/editor-viewed-ipc.test.ts tests/unit/editor-find.test.ts`：42/42 通过，包含真实 HTTP 服务的租约、草稿、相对资源和路径边界。

Playwright 的 `editor-preview.spec.ts`、`html-preview-diagnostics.spec.ts`、`markdown-preview-html.spec.ts`、`product-preview.spec.ts`（island，单 worker）：13/13 通过，包含默认编辑、差异与草稿保留、自定义关闭确认、Markdown 块对齐、HTML 视口与缩放、资源加载与释放、降级脚本隔离、Markdown picture 主题切换和本地 srcset。截图保存在 `artifacts/html-markdown-verified/`，已人工检查固定画布完整显示与 Markdown 图片布局。Star History 远程接口使用确定性 SVG 测试替身，未将外部服务可用性计入验收。

`editor-window-tabs.spec.ts` 与 `editor-find-widget.spec.ts`（desktop，单 worker）：4/4 通过，覆盖原生关闭、真实写盘、失败留窗、不保存、标签复用、紧凑查找控件，以及真实 HTTP iframe 的 CSS、嵌套模块、根相对 fetch、图片、preload 隔离、草稿刷新和租约释放，证据保存在 `artifacts/html-editor-desktop/`。`npm run typecheck`、`npm run build:app`、触及源码的 ESLint 和 `npm run i18n:check` 通过；`npm run check:notes` 验证 322 篇 harness Notes，0 错误，保留 17 条既有外部链接诊断。未执行整个仓库的 verify。
