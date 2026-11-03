---
{
  "schema": "harness-note/2",
  "id": "280efc6c-1dbc-46bb-80ab-1db698680d65",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-11-03",
  "updated": "2026-11-03T14:01:22Z",
  "class": "feature",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 本机 Skills 与 MCP 管理

## Problem

技能与 MCP 配置分散在不同客户端的用户目录和项目目录。只按文件所在目录分组会混淆用户级、项目共享和项目个人配置，也无法区分发现配置与会话实际加载。本机管理首版需要让用户确认来源、查看和修改内容，并显式检测 MCP 连接。

## Decision

设置增加“技能与 MCP”，本机工作区右键菜单可直达同页并带入工作区。管理范围选择用户级或注册的本机工作区，客户端选择 Codex、Claude Code、OpenCode 或 Janus，Skills／MCP 为页内标签。工作区视图同时展示继承的用户级来源，编辑继承项前提示其影响范围。列表支持搜索、详情、原始路径、异常和同名来源；同名不统一推断覆盖者。

本机来源由主进程适配，渲染层只提交来源／条目 ID 和注册工作区 ID，不接受任意文件路径。主要目录如下；`~` 指本机用户目录，环境变量取 JanusX 主进程启动环境。

| 客户端 | 技能来源 | MCP 来源 |
| --- | --- | --- |
| Codex | 用户与项目 `.agents/skills`，兼容 `.codex/skills` | 用户与项目 `.codex/config.toml` 的 `mcp_servers` |
| Claude Code | 用户与项目 `.claude/skills` | 用户 `.claude.json:mcpServers`、项目 `.mcp.json`、用户文件 `projects[项目绝对路径].mcpServers` 的项目个人配置 |
| OpenCode | 用户 `.config/opencode/skills`、项目 `.opencode/skills`，兼容 `.claude/skills` 与 `.agents/skills` | 用户 `.config/opencode/opencode.json/jsonc`、项目 `opencode.json/jsonc` 的 `mcp` |
| Janus | 已安装插件清单声明的技能，只读展示 | 尚未接入独立配置 |

Codex 用户目录识别 `CODEX_HOME`；Claude 用户目录及 `.claude.json` 识别 `CLAUDE_CONFIG_DIR`；OpenCode 识别 `XDG_CONFIG_HOME` 与额外的 `OPENCODE_CONFIG` 文件。Claude 的自定义目录行为依据[官方目录说明](https://code.claude.com/docs/en/claude-directory)。扫描不等于原生客户端完整有效配置解析，不枚举全部祖先目录、第三方插件缓存、企业策略、临时 CLI 参数及远端环境；OpenCode 的额外目录和资源路径配置尚未覆盖。实际信任和加载仍由原客户端决定。

新增技能创建独立目录中的 `SKILL.md`，编辑保留完整文本；新建名称要求小写字母、数字和短横线，并与 YAML name 一致。MCP 编辑器只接受当前服务的 JSON，保存到原生格式：JSONC 使用局部修改保留其他字段与注释；TOML 只替换明确的目标表，并重新解析确认其他配置没有变化，内联等不安全布局拒绝写入。未解析文件、链接来源和 Janus 插件技能不直接写入，插件技能提供管理入口。

保存携带内容版本，串行执行并在写入前重新扫描、核对内容哈希与路径；外部改动时拒绝覆盖，界面保留草稿。临时文件加 rename 防止半写，创建文件使用私有 mode，既有文件沿用 mode，失败清理临时文件。此检查不等于跨进程文件锁，校验与替换间仍有操作系统级竞态窗口。读取限制为 UTF-8、单文件 1 MiB；提交限 256 KiB；技能每来源最多 600 个目录、深度 4，MCP 每来源最多 500 项，达到上限明确提示。

“已发现／已配置／已禁用／配置异常／同名来源”描述资源，不表示在线。用户点击“检测连接”后才通过 MCP SDK 建立临时 stdio、Streamable HTTP 或 SSE 连接，握手并读取首批工具数量后关闭；总请求等待上限 10 秒，Windows 关闭前清理所属进程树。支持环境变量引用、环境请求头和 bearer token 环境变量；结果显示本次时间与耗时，不复用 CLI OAuth 会话，不自动登录、不执行工具调用。错误只返回稳定代码，不输出服务 stderr 或含凭据的响应体。所有 IPC 限定受信应用窗口的主 frame。

## Alternatives considered

按客户端各建一个管理页会重复范围和编辑交互，因此保留统一页面与独立配置适配。统一移动资源到 Janus 自建目录会改变原客户端行为，因此直接读取并局部修改已知原生来源。当前版本不添加缺乏统一原生语义的技能开关，也不把扫描结果标记为当前会话已经启用。

## Consequences

首版提供查看、新建、编辑、打开所在位置及 MCP 检测。远端／WSL／SSH、市场安装、目录导入、删除、跨客户端同步、OAuth 登录编排和会话运行状态未接入。技能引用的脚本与资源由用户放入对应目录。保存后客户端可能需要重新加载或新会话，项目授权保持原客户端流程。

验证使用临时本机目录和合成页面数据，不修改真实用户配置。`local-integrations.test.ts` 覆盖来源继承、项目个人配置、编码和限额、符号链接只读、外部修改冲突以及 JSONC／TOML 保留；`local-integrations-ipc.test.ts` 覆盖窗口、frame 与请求边界；`local-integrations-probe.test.ts` 完成真实 stdio／HTTP 握手、认证失败、超时和进程回收，共 17 项通过。`local-integrations.spec.ts` 的 7 项浏览器用例覆盖中英文操作、草稿保留、插件跳转和深色／白色／石板色宽窄布局；截图在 `artifacts/local-integrations/`。原生各 CLI 的完整加载与 OAuth 会话、SSE 真实服务及非 Windows 平台未做端到端验收。

2026-11-03 最终验证命令为 `npx vitest run tests/unit/local-integrations.test.ts tests/unit/local-integrations-ipc.test.ts tests/unit/local-integrations-probe.test.ts`（17 项）及 `npx playwright test tests/e2e/local-integrations.spec.ts tests/e2e/settings-layout.spec.ts --project=island --workers=1 --timeout=30000`（19 项，包含既有设置导航与布局）。`npm run typecheck`、修改范围 ESLint、`npm run i18n:check`、`npm run check:notes` 和 `npm run build:app` 均通过；Notes 检查保留 17 条既有跨仓链接提示、0 错误。构建日志位于 `artifacts/local-integrations/build.log`。
