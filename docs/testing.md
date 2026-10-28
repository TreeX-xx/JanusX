# 测试与验证

日常修改先运行相关用例；需要广泛反馈时运行快速组，集成前运行完整验证。测试组按实际运行成本划分，不能用快速组的通过结果代替集成或桌面验收。

| 命令 | 覆盖范围与准备 |
| --- | --- |
| `npm run test:related -- src/main/某个文件.ts` | Vitest 根据源码导入关系选择相关测试；动态导入和运行时资源变化仍需人工补选 |
| `npm run test:unit -- tests/unit/某个文件.test.ts` | 指定文件，适合确认一个修复 |
| `npm run test:unit:fast` | 日常单测组，不启动真实 Chromium，不运行已明确分出的慢集成文件 |
| `npm run test:integration` | 实际 Git、子进程、构建和仓库语料等慢集成测试 |
| `npm run test:browser` | Vitest 中通过真实 Chromium 验证组件的用例；先运行 `npx playwright install chromium` |
| `npm run test:unit` | 上述三个组全部运行，每个用例只属于一个组 |
| `npm run test:unit:watch -- tests/unit/某个文件.test.ts` | 持续监听指定测试文件 |
| `npm run test:llm-core` | 独立 LLM 包的全部测试 |
| `npm run test:e2e -- tests/e2e/某个文件.spec.ts` | 浏览器工作区交互；自动启动测试 Vite 服务器 |
| `npm run test:e2e:desktop -- tests/e2e/某个文件.spec.ts` | 已构建 Electron 的交互；串行执行，不启动浏览器测试服务器 |
| `npm run verify:quick` | 主题、类型、国际化、lint 和快速单测；不构建桌面、不代替完整验收 |
| `npm run verify` | 完整插件验证、三个 Vitest 组、LLM 测试、类型、构建、包边界、Notes、lint 和 Electron 检查 |

`verify:quick` 需要已经准备好 sibling 发布入口；完整环境步骤见[开发指南](./development.md)。缺失的工具或依赖应先修复，不能把环境失败当成某组测试已经通过。`verify` 保留现有的完整检查范围，CI 继续对 `main`、`dev` 的 PR 运行它的各个阶段。

## 分组与重复执行

[test-suites.ts](../tests/helpers/test-suites.ts) 明确列出 14 个真实浏览器文件及 15 个慢集成文件。其他 `tests/unit/**/*.test.ts` 默认进入快速组，新增测试不会因为命名规则而漏掉。分组改变时应重新收集测试列表，确认三个组互不相交，合并后仍覆盖全部文件。

独立的 `plugins:check`、`plugins:distribution:check` 保留专项完整验证。全量 `verify` 先运行平台与分发工具检查，再在统一单测阶段运行对应 Vitest 文件，避免 22 个插件测试文件各执行两遍。

Playwright 的浏览器和 Electron 文件清单互斥；`blueprint-local` 使用自己的配置和命令。桌面入口使用 `playwright.desktop.config.ts`，不占用浏览器组的 Vite 端口。CI 保留单 worker；本地 Vitest 最多使用 4 个 worker，并保持文件隔离。

Playwright 在测试进程中把 loopback 地址加入 `NO_PROXY`，保留已有排除项，使本地服务探测直接访问测试服务器。否则继承的 HTTP 代理可能对空闲端口返回页面，导致错误的“端口已占用”判断。

## 用例维护原则

优先验证输出、用户行为、权限边界和状态变化。保存失败保留草稿、终端隐藏后继续接收输出、并发写入冲突、插件信任与回滚、安装包边界等回归用例应保留。

源码中出现某个调用、精确 JSX 排版或固定 CSS 圆角只能证明实现文字存在；已有行为覆盖时删除这类重复断言。纯函数的空 `reset()` 不需要“不抛错”用例，有状态解析器仍需验证重置后能正确解析。样式测试优先检查可访问性、点击命中、布局溢出和对比度。

组件测试使用固定小样例，避免依赖开发者当前 Notes 数量或标题。仓库语料读取保留在集成组，真实 Notes 的结构与引用由 `npm run check:notes` 单独验证；机械校验器自身的单测使用隔离样例。测试年龄不构成删除依据，历史协议、迁移和曾经修复过的故障仍可能是现行契约。

全仓库文档可达性测试先显式建立真实索引，再验证所有文档的归属、可达性和源数据不变。建索引耗时不作为该用例的通过条件；前台冷读取超时、冷启动共享索引和锁竞争仍由专门的服务测试验证。

主题状态映射用注册的测试主题验证，避免锁死可调整的历史色值。悬浮提示约束检查交互控件的 DOM 属性，允许组件提示参数和静态地址徽标。文件编辑的链接拒绝用例通过现有文件系统注入边界验证拒绝写入，不要求 Windows 文件符号链接权限；真实目录链接越界仍由插件文件、目录和上下文测试覆盖。

安装失败回滚使用固定磁盘样例，模拟已写入部分文件和锁文件后失败，并验证原包及两个锁文件恢复。真实 npm 的发布文件规则和依赖安装保留在成功路径集成测试中，避免其他回滚用例重复安装来准备数据。

本轮审计与执行报告保存在本机忽略目录 `artifacts/test-audit-20261028`。耗时缓存包含旧文件和不同运行环境，仅用于定位成本，不能作为优化前后的基准测试结果。
