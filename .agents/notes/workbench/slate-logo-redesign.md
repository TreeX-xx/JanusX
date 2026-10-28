---
{
  "schema": "harness-note/2",
  "id": "cf5310f1-3f10-484b-9823-a510d178ec02",
  "kind": "decision",
  "lifecycle": "implemented",
  "created": "2026-09-29",
  "class": "feature",
  "tags": ["branding","logo","planche","slate","icon"],
  "updated": "2026-10-28T09:29:00Z",
  "module": "note://972afef3-2fc7-49de-a3ee-7e041225d28c/19cd1394-b2cb-4819-8fde-5f12de16574c"
}
---

# 应用主题与 Logo

## 当前决定（2026-10-27）

默认主题恢复为经典黑（dark），设置列表经典黑排第一、石板色排第二。缺失或未知主题回落经典黑；已保存的有效主题继续保留，不再执行旧的石板色迁移。启动 CSS 的 :root 同步使用经典黑令牌。

resources/icon.png 与 resources/icon.ico 恢复为历史提交 e97b9153 中的黑底、白橙 X 版本，README、应用窗口与打包入口继续引用这两个资源。未执行打包后的任务栏与安装器实机检查。

设置页中英文名称同步标注经典黑为默认，石板色不再带默认标记。dev 主进程监听 PNG／ICO 资源，更新图标时触发重建以重新加载原生窗口图标。2026-10-27 直接读取运行中 dev 窗口的 WM_GETICON，确认当前原生图标为黑底白橙 X；Electron nativeImage 解码当前 ICO 也为黑色版本。窗口图标正确不等于任务栏图标正确。Windows dev 入口使用独立 AppUserModelID（com.janusx.app.dev）；主窗口通过 setAppDetails 显式指定相同标识、开发启动命令和图标路径。ICO 复制到 dev profile 的 shell-icons/janusx-<内容哈希>.ico，颜色变更生成新路径，避开 Windows 对同一路径旧图标的缓存。生产版不改变任务栏身份；已有固定快捷方式不自动改写。类型检查与 8 项 dev 环境／构建隔离测试通过。

2026-10-28：非打包启动的任务栏 ICO 读取和重启入口按主窗口已有的 resources 路径解析，不再依赖 app.getAppPath()。直接执行 out/main/index.js 时 appPath 是 out/main，原实现会在创建窗口时读取不存在的 out/main/resources/icon.ico 并阻止启动。生产包不进入该任务栏分支。固定 Node／sibling 环境重建后，`npx playwright test --config playwright.desktop.config.ts tests/e2e/desktop-cpa.spec.ts --grep "CPA settings use" --workers=1` 通过（1 项，14.7 秒），覆盖直接启动、主题切换及窄宽度设置布局。

以下为已被当前决定取代的石板版设计记录。

## 历史：石板 Logo

## Problem

这件事有两层，第二层比第一层重要。

第一层是旧账：`resources/icon.png` 已经按方案 B 换成石板版（板 `#1B2F35` / 纸杠 `#F1E7CB` / 朱红杠 `#D43D2A`），README 第 8 行引用它，所以 GitHub 上看到的是新图标；但 `resources/icon.ico` 的七个 DIB 档位从未重打，仍是近黑底 `#121212` + 橙杠 `#FF7830`。**同一品牌在 README 和任务栏上是两套颜色**，而橙色在 planche 里已无位置（`primary` 与 `shell-accent` 都是朱红），图标和应用内 accent 直接打架。

第二层是评审时才浮出来的：planche 是默认主题（`registry.ts:11` 排在 Map 第一位），且它的 `bg-app` / `bg-deep` / `bg-dark` / `shell-canvas` / `shell-pane` / `workbench-canvas` / `surface-elevated` **七个 token 全是 `#EFE4C5`**（`src/shared/theme/definition.ts:204–234`）。也就是说应用是「纸底 + 墨字 + 朱红点」，而图标是「墨底 + 纸字 + 朱红杠」—— 同一套三色，**明暗极性完全相反**。任务栏上它读作「一个深色应用」，点开却是一片纸色。这是色相之外的第二层错位，靠换强调色永远修不掉。

## Decision

几何一个字没动：沿用现有 X 形（圆角板 + 两根圆头斜笔画），逐像素保留原 alpha 轮廓与抗锯齿，只重写颜色。落地形态是**纸底无边**：

- 板 `#EFE4C5`（`--paper`）、墨杠 `#1C343B`（`--ink`）、朱红杠 `#D43D2A`（`primary`，一个像素未改）。
- 由 `resources/icon.png` 逐像素最近邻分类重建（三个源色 `#1B2F35` / `#D43D2A` / `#F1E7CB` 取最近者，抗锯齿过渡像素按距离向目标色插值），不重画、不描边、不加 keyline。
- `resources/icon.ico` 由同一张 master 线性光面积重采样出 16 / 24 / 32 / 48 / 64 / 128 / 256 七档，32bpp BGRA DIB（`BITMAPINFOHEADER` + XOR + 空 AND mask，透明度走 alpha 通道），与 PNG 同源。
- 降采样在线性光里做面积平均而非 sRGB，避免小尺寸档位边缘发暗。

README 顺带收口：logo 那行引用 `icon.png` 会自动跟随，不改；改的是 6 个徽章 —— `2A211B` → `1C343B`（License / Codex）、`FF5A1F` → `D43D2A`（Release，同时把白字对比从 3.12:1 抬到 4.67:1）、`4A4038` → `1C343B`（Downloads）、`FF5A1F` → `D97757`（Claude Code，改用 Anthropic 自己的品牌色 —— 原来那个是 JanusX 旧橙误用，用错色比用对方色更糟）、`FF8A24` → `E5A422`（Janus-agentX，palette 里已有的 `planche-ochre`）。

## Alternatives considered

- **纸底 + 墨 keyline（当时推荐，最终未取）**。给板加一圈 `#1C343B` 边线，让轮廓由边线而非底色承担。实测五个真实环境（README 白 / 暗、Win11 深 / 浅任务栏、亮色壁纸）全部过线：13.09 / 14.94 / 12.86 / 11.80 / 10.13。规则它的是墨边会把「纯印章」的干净感吃掉，纸面品牌露出从 5.0% 墨变成 10.5% 墨。**这是评审推荐但作者未采纳的一版，记录在案以免日后当成 oversight 重开。**
- **墨底 + 提亮杠（`#E8513C`）**。最小改动，只把红杠从 2.99:1 抬到 3.77:1。规则它的是极性反向的原样保留 —— 也就是第二层错位原样保留。
- **墨底原样（`#1B2F35`）**。零设计决策。规则它的是在 Win11 深色任务栏上板色只有 1.17:1、GitHub 暗色 README 上 1.36:1，方块轮廓基本消失，图标退化成两根悬浮的杠，丧失「这是个 App」的身份。
- **纸底 + 粗 keyline（2px）**。16px 更保险，代价是墨占比 13.4%，图标偏重。
- **墨底 + 墨 keyline**。用来验证 keyline 不是万能补丁：墨上加墨几乎看不见（实测 1.2:1 级别），所以 keyline 只在纸底上起作用。
- **朱红板反转 / 纯墨板 / 赭黄杠 / 压深板色**。朱红板气质与纸面主面相反；纯墨板没解决红杠问题且更差（2.81:1）；赭黄杠脱离界面朱红强调族；压深板色等于放弃这次对齐的视觉声明。四版都在「引入新不一致」这一侧出局。
- **重画几何**。石板主题本可以配一方印章式图形。规则它的是 X 形已有认知（标题栏、终端 logo、Island 像素标全是 X 族），换图形等于推翻整套识别，本次只是主题跟随而非品牌重塑。

## Acceptance criteria

- [x] `icon.png` 与 `icon.ico` 同源，`.ico` 含 16 / 24 / 32 / 48 / 64 / 128 / 256 七档，实测七档主色均为纸 `#EFE4C5` 主导 + `#D43D2A` + `#1C343B`。
- [x] 板色与界面 token 逐字一致（`#EFE4C5` / `#1C343B` / `#D43D2A`），界面 accent 未被图标反向绑架。
- [x] 图形未变：alpha 轮廓与抗锯齿逐像素保留，圆角板与圆头笔画尺寸不变。
- [x] README 无残留旧品牌色（`FF5A1F` / `FF8A24` / `4A4038` / `2A211B` 全部清零）。
- [ ] 打包后实机看任务栏 + 安装器图标 —— **未做**，见 Risks。

## Consequences

板色从墨底翻成纸底后，图形元素的对比度账变了：墨杠对纸是 10.33:1（原先纸杠对墨底 11.32:1，都很稳），但**朱红杠对纸底是 3.68:1，比原先朱红杠对墨底的 2.99:1 更好** —— 顺手修掉了旧账里那个「擦线不过」的问题。板色对亮环境则从 10.80–13.96 掉到 1.02–1.27，这是本次选择付出的代价，数字记在 Risks 里。

dark 主题用户看到的是一个纸底图标配深色应用，一致性上是改善而不是倒退：旧版墨底图标对他们而言才是隐形的那一版。

## Risks

- **已接受的代价：浅色环境下图标会变淡。** 板 `#EFE4C5` 对 Win11 浅色任务栏 `#F3F3F3` 只有 1.14:1、对亮色壁纸 `#DDE3EA` 只有 1.02:1，方块轮廓在这两处基本不存在，只剩两根杠。GitHub 亮色 README 白底上同理（1.27:1）。这是评审明确提示过、作者仍选择纸底无边的结果，不是遗漏；若实机反馈变糊，回退位是加一圈 1.4px `@256` 的 `#1C343B` keyline（该版实测五环境全过）。
- **打包后未实机验证。** 上述对比度全部是像素实算与静态环境模拟，没有在真实 Windows 任务栏和安装器上看过。任务栏实际底色受用户主题与壁纸透明度影响，可能比模拟更接近或更远离纸色。
- **仓库仍无 SVG 源，`.ico` 靠一次性脚本产出。** 同源问题这次靠人工重打解决，机制上没根治 —— 下次改图标仍可能只改 PNG 漏掉 ICO。同源守卫（构建期比对 PNG 与 ICO 调色板）或补 `resources/icon.svg` 作为唯一真源，都还没做。
- **`electron-builder.yml:524` 引用 `resources/icon.icns`，文件不存在**，mac 包本来就是坏的。本次未补。
- **主题收敛债仍在。** `GitPanel` / `FileExplorerTool` / `blueprint.css` 等处硬编码的 `rgba(255,120,48,…)` 不吃主题 token，石板纸面上会漏旧橙 —— 独立议题，不在本 Note 范围。
