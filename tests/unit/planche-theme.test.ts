import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import {
  DEFAULT_APP_THEME,
  normalizeAppTheme,
  THEME_CHANNELS,
} from '../../src/shared/ipc/theme'
import {
  getMonacoThemeName,
  JANUSX_DARK_THEME_NAME,
  JANUSX_PLANCHE_THEME_NAME,
} from '../../src/renderer/src/lib/monaco-theme'
import {
  getTerminalDefaultColors,
  getXtermPalette,
  createTerminalColorQueryResponder,
  TERMINAL_DEFAULT_COLORS,
  PLANCHE_TERMINAL_COLORS,
} from '../../src/shared/terminalColorQuery'
import { getThemeDefinition } from '../../src/shared/theme/registry'

// 声明扫描用：注释里允许引用旧色值做说明，声明里不许再出现。
const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

// Interactive controls use themed hints. Component title props and passive
// metadata badges (such as a WSL/SSH endpoint) are outside that contract.
function nativeControlTitleElements(source: string): string[] {
  const tree = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const elements: string[] = []
  const controlTags = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])
  const controlRoles = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'combobox', 'slider', 'spinbutton', 'textbox'])
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree)
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      const interactive = controlTags.has(tag) || attributes.some(attribute => {
        const name = attribute.name.getText(tree)
        if (name === 'onClick' || name === 'onKeyDown' || name === 'onKeyUp') return true
        const value = attribute.initializer
        return name === 'role' && value && ts.isStringLiteral(value) && controlRoles.has(value.text)
      })
      if (/^[a-z]/.test(tag) && interactive && attributes.some(attribute => attribute.name.getText(tree) === 'title')) elements.push(tag)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return elements
}

describe('planche theme contract', () => {
  it('keeps classic black as default and passes open theme ids through (read-side fallback)', () => {
    expect(DEFAULT_APP_THEME).toBe('dark')
    expect(normalizeAppTheme('planche')).toBe('planche')
    expect(normalizeAppTheme('dark')).toBe('dark')
    expect(normalizeAppTheme(undefined)).toBe('dark')
    // 未知 id 原样持久化，读取时由 registry 回落默认（历史 'light' 同理）
    expect(normalizeAppTheme('light')).toBe('light')
    expect(normalizeAppTheme('nope')).toBe('nope')
    expect(getThemeDefinition('nope').id).toBe('dark')
    expect(getThemeDefinition('light').id).toBe('dark')
  })

  it('exposes get/update/changed channels', () => {
    expect(THEME_CHANNELS.get).toBe('theme:get')
    expect(THEME_CHANNELS.update).toBe('theme:update')
    expect(THEME_CHANNELS.changed).toBe('theme:changed')
  })

  it('routes monaco theme names with dark fallback', () => {
    expect(getMonacoThemeName('planche')).toBe(JANUSX_PLANCHE_THEME_NAME)
    expect(getMonacoThemeName('dark')).toBe(JANUSX_DARK_THEME_NAME)
  })

  it('returns paper/ink for planche terminal probes and dark otherwise', () => {
    expect(getTerminalDefaultColors('planche')).toEqual({ ...PLANCHE_TERMINAL_COLORS })
    expect(getTerminalDefaultColors('dark')).toEqual({ ...TERMINAL_DEFAULT_COLORS })
    expect(getXtermPalette('planche').background).toBe('#EFE4C5')
    expect(getXtermPalette('dark').background).toBe('#151517')
    expect(getXtermPalette('planche').cursor).toBe('#D43D2A')
  })

  it('answers OSC 11 with the active theme background', () => {
    const dark = createTerminalColorQueryResponder(() => 'dark')
    const planche = createTerminalColorQueryResponder(() => 'planche')
    const probe = '\x1b]11;?\x1b\\'
    // rgb:EFxx/E4xx/C5xx for paper vs 15/15/17 for dark
    expect(planche.push(probe)).toContain('rgb:EFEF/E4E4/C5C5')
    expect(dark.push(probe)).toContain('rgb:1515/1515/1717')
  })

  it('pins planche overrides to additive selectors (dark stays untouched)', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n').replace(/\r\n/g, '\n')
    const island = read('components/janus/styles/13-janus-planche.css')
    // 全态覆盖：折叠纸胶囊墨眼 / 一级 capsule / 二级 tray-banner / 展开大眼 / 运行球
    for (const selector of [
      "[data-theme='planche'] .janus-island",
      "[data-theme='planche'] .janus-island[data-mode='order'] .janus-eye-mini",
      "[data-theme='planche'] .janus-capsule-title",
      "[data-theme='planche'] .janus-notify-tray",
      "[data-theme='planche'] .janus-notify-banner",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-island",
      '[data-theme=\'planche\'] .mode-running .janus-eye-lg',
      '[data-theme=\'planche\'] .janus-run-orb-popover',
      '[data-theme=\'planche\'] .janus-island[data-mode=\'running\'][data-stage=\'collapsed\']::before',
      '[data-theme=\'planche\'] .janus-island-shell[data-stage=\'collapsed\'] .janus-island',
    ]) {
      expect(island, selector).toContain(selector)
    }
    // 折叠态纸面无黑块：纸底 + 墨眼 + 零阴影
    expect(island).toContain('[data-theme=\'planche\'] .janus-island {\n  background: #EFE4C5;')
    // 无大模糊/渐变残留（扫描条纹用的 repeating 硬阶梯除外，非渐变洗色）
    expect(island).not.toMatch(/backdrop-filter:\s*blur/)
    expect(island.replaceAll('repeating-linear-gradient', '')).not.toMatch(/linear-gradient/)
    const selector = read('components/TerminalSelector.module.css')
    expect(selector).toContain(":global([data-theme='planche']) .card:hover")
    // 选择器悬浮用套印影，不用黑硬影
    expect(selector).toContain('3px 3px 0 #E8A08A')
    expect(selector).not.toContain('3px 3px 0 #1C343B')
    const switcher = read('components/WorkbenchSwitcher.module.css')
    expect(switcher).toContain(":global([data-theme='planche']) .button:hover")
    expect(switcher).toContain('#D43D2A')
    const area = read('components/TerminalArea.tsx')
    expect(area).toContain('plancheMenu')
    expect(area).not.toContain("style.background = 'rgb(36, 27, 21)'")
    // M2c：悬浮改色走 CSS 类，JS 不再直接写 style
    const hovers = readFileSync(resolve(root, 'styles/theme-hovers.css'), 'utf8')
    for (const cls of ['.tbtn-ghost:hover', '.tbtn-accent:not(:disabled):hover', '.tbtn-danger:hover', '.terminal-preset-item:hover', '.terminal-empty-new:hover']) {
      expect(hovers, cls).toContain(cls)
    }
    expect(area).toContain('terminal-preset-item')
    expect(area).toContain('terminal-empty-new')
    expect(area).not.toContain('onMouseEnter={(event) => {')
    const gitPanel = read('components/GitPanel.tsx')
    expect(gitPanel).toContain('tbtn-ghost')
    expect(gitPanel).toContain('tbtn-accent')
    expect(gitPanel).not.toContain('currentTarget.style.background')
    const sidebar = read('components/Sidebar.tsx')
    expect(sidebar).toContain('tbtn-ghost')
    expect(sidebar).toContain('tbtn-danger')
    expect(sidebar).not.toContain('currentTarget.style.background')
    // M3：预览器文字走令牌，分栏条/脚本钮 hover 走 CSS 类
    for (const viewer of [
      'components/viewers/markdown-components.tsx',
      'components/viewers/MarkdownViewer.tsx',
      'components/viewers/HtmlViewer.tsx',
      'components/viewers/PreviewModeToggle.tsx',
      'components/viewers/ImageViewer.tsx',
      'components/viewers/BinaryInfo.tsx',
      'components/viewers/MonacoViewer.tsx',
      'components/FileViewerContent.tsx',
      'components/FileEditor.tsx',
    ]) {
      const source = read(viewer)
      expect(source, viewer).not.toMatch(/color:\s*'#(fff|d4d4d4|ddd|eee|aaa|888|777|555|666)'/)
    }
    // Monaco 加载态/容器/错误浮层不写字面量色（preview-editor-display-style 外壳收敛）
    expect(read('components/viewers/MonacoViewer.tsx')).not.toMatch(/(background|borderColor):\s*'#/)
    // 文件窗口外壳图标钮：命中膨胀 + 选中 2px 强调条，不做 accent-soft 填充
    const shellEditor = read('components/StandaloneFileEditor.tsx')
    expect(shellEditor).toContain('shell-icon-btn')
    expect(shellEditor).toContain('data-on=')
    expect(shellEditor).not.toContain('shell-accent-soft')
    expect(shellEditor).toContain('filetab-indicator')
    expect(read('components/viewers/MarkdownViewer.tsx')).toContain('viewer-divider')
    expect(read('components/viewers/HtmlViewer.tsx')).toContain('viewer-divider')
    expect(read('components/StandaloneFileEditor.tsx')).toContain('filetab-close')
    expect(read('components/viewers/markdown-preview.css')).toContain('var(--shell-accent-soft)')
    expect(hovers).toContain('.viewer-divider:hover')
    expect(hovers).toContain('.filetab-close:hover')
    // 展开态黑块 + 蓝图画布：纸底与卡片收敛
    const bp = readFileSync(resolve(__dirname, '../../plugins/blueprint/src/ui/blueprint.css'), 'utf8')
    for (const selector of [
      "[data-theme='planche'] .blueprint-view",
      "[data-theme='planche'] .bp-node-card",
      "[data-theme='planche'] .bp-node-card--selected",
      "[data-theme='planche'] .bp-node-card__title",
    ]) {
      expect(bp, selector).toContain(selector)
    }
    const canvas = readFileSync(resolve(__dirname, '../../plugins/blueprint/src/ui/Graph.tsx'), 'utf8')
    expect(canvas).toContain("colorMode={planche ? 'light' : 'dark'}")
    expect(canvas).toContain('getBlueprintStatusVisual(')
    expect(canvas).not.toContain('STATUS_VISUALS[')
    const edgeLabel = bp.slice(bp.indexOf('.bp-edge-label {'), bp.indexOf('.bp-edge-label__leader {'))
    expect(edgeLabel).toContain('color: var(--shell-text)')
    expect(edgeLabel).toContain('background: var(--shell-card)')
    // 右缘 TurnChange 浮岛：收缩/展开同色走 chrome 底，文字走 shell 令牌，增减数走同源 DiffCounts 徽标
    const turn = read('components/TurnChangeIsland.tsx')
    expect(turn).toContain('<DiffCounts')
    expect(turn).toContain('var(--shell-chrome)')
    expect(turn).not.toContain("background: '#000'")
    expect(turn).not.toContain("color: '#fff'")
    const diffCounts = read('components/shared/DiffCounts.tsx')
    expect(diffCounts).toContain('var(--shell-diff-add)')
    expect(diffCounts).toContain('var(--shell-diff-del)')
    // diff 呈现同源（preview-editor-display-style C/D）：文件窗口复用 DiffCounts，行号染色走 decoration；
    // 变更竖条经视觉复核撤除——文件预览界面不得出现竖线
    expect(read('components/StandaloneFileEditor.tsx')).toContain('<DiffCounts')
    expect(hovers).toContain('.diff-num-add')
    expect(hovers).not.toContain('diff-bar')
    expect(read('components/viewers/MonacoViewer.tsx')).toContain('lineNumberClassName')
    expect(read('components/viewers/MonacoViewer.tsx')).not.toContain('linesDecorationsClassName')
    // 竖线零容忍：缩进/括号参考线禁用（文件编辑界面不得出现竖线）
    expect(read('components/viewers/MonacoViewer.tsx')).toContain('indentation: false')
    // 无工程上下文的 TS/JS 语义假错误不显示；标签条滚动条隐藏由滚轮控制
    expect(read('components/viewers/MonacoViewer.tsx')).toContain('noSemanticValidation: true')
    // 黄框防回潮：Unicode 可疑字符高亮（全角标点金色边框盒）整项关闭
    expect(read('components/viewers/MonacoViewer.tsx')).toContain(
      'unicodeHighlight: { nonBasicASCII: false, invisibleCharacters: false, ambiguousCharacters: false }')
    expect(hovers).toContain('.filetab-strip')
    // 标签条滚轮横向滚 + 选中 tab 自动入视口：文件窗口与工作台 pane 条同规
    expect(shellEditor).toContain('attachWheelScrollX')
    expect(shellEditor).toContain('revealStripItem')
    expect(read('components/TerminalArea.tsx')).toContain('attachWheelScrollX')
    // diff 令牌双主题都有定义（M1 后唯一事实源为 definition.ts，CSS 由脚本生成）
    const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles/themes.generated.css'), 'utf8')
    expect(css).toContain('--shell-diff-add: #4ec9b0')
    expect(css).toContain('--shell-diff-add: #2E6B5E')
    // 右 Dock 面板 + 左栏：文字走 shell 令牌，不再硬编码白/灰字
    for (const panel of [
      'components/SessionPanel.tsx',
      'components/GitPanel.tsx',
      'components/FileExplorerTool.tsx',
      'components/TurnChangeIsland.tsx',
      'components/Sidebar.tsx',
      'components/WorktreeDialogs.tsx',
    ]) {
      const source = read(panel)
      expect(source, panel).toContain('var(--shell-text)')
      expect(source, panel).not.toMatch(/color:\s*'#(fff|d4d4d4|ddd|eee)'/)
      expect(source, panel).not.toMatch(/text-\[#(fff|d4d4d4|ddd|eee)\]/)
    }
    // 会话面板三元色同样收敛（含 diff 语义色），杜绝 ? '#ddd' 式漏网
    const session = read('components/SessionPanel.tsx')
    for (const hex of ['#d4d4d4', '#ddd', '#e06c75', '#4ec9b0']) {
      expect(session, hex).not.toContain(`'${hex}'`)
    }
    expect(session).toContain('var(--shell-diff-del)')
    // 会话表面（列表卡片、详情 turn 卡片、轮次导航、输入框）
    // Session surfaces use theme tokens; modal scrims remain independent.
    // plankhe 的 --shell-void/canvas/pane/chrome/card 全是 #EFE4C5，纸面里没有更深的
    // 台阶：写死 rgba(0,0,0,.2x) 是冷灰油渍，写死 rgba(255,255,255,.0x) 等于没画，
    // 硬编码的 #8ab4ff 蓝在朱红纸面上完全跑调。三条都不许回来。
    expect(session).toContain(
      "const SURFACE_CARD = 'color-mix(in srgb, var(--shell-chrome) 94%, var(--shell-text))'",
    )
    expect(session).toContain(
      "const SURFACE_INSET = 'color-mix(in srgb, var(--shell-chrome) 90%, var(--shell-text))'",
    )
    expect(session.match(/background: SURFACE_CARD/g) ?? []).toHaveLength(1)
    // 内容卡（首轮提示/最近轮次）走 module .sheet 浅纸面，不占 SURFACE_INSET 名额
    expect(session.match(/background: SURFACE_INSET/g) ?? []).toHaveLength(3)
    // 会话面板三阶：地吃 --shell-canvas（planche=软件纸面底色，dark=v6 画布），
    // 内卡沿用外卡色相，轻微提亮并通过细边框分层
    const sessionMod = read('components/SessionPanel.module.css')
    expect(sessionMod).toContain('background: var(--shell-canvas)')
    expect(sessionMod).not.toContain('#E8E6E2')
    expect(sessionMod).toContain('--session-card-surface: var(--shell-canvas)')
    expect(sessionMod).toContain('background: var(--session-card-surface)')
    expect(sessionMod).toContain('color-mix(in srgb, var(--session-card-surface) var(--session-sheet-base-weight), white)')
    expect(sessionMod).not.toContain(":global([data-theme='dark']) .sheet")
    expect(getThemeDefinition('planche').tokens['session-sheet-base-weight']).toBe('84%')
    expect(getThemeDefinition('dark').tokens['session-sheet-base-weight']).toBe('96%')
    // 折叠控件为无边框 chevron 按钮（token 化，不吃填充；hover/聚焦走强调色）
    expect(sessionMod).toContain('.foldBtn')
    expect(sessionMod).toMatch(/\.foldBtn \{[^}]*border: none/s)
    expect(sessionMod).toContain('var(--shell-accent-border)')
    expect(session.match(/CARD_BORDER,/g) ?? []).toHaveLength(1)
    expect(session).not.toMatch(/background: 'rgba\(255,\s*255,\s*255/)
    expect(session).not.toMatch(/background: 'rgba\(0,\s*0,\s*0,\s*0\.[1-5]\d\)'/)
    expect(session).not.toMatch(/(solid|dashed) rgba\(255,\s*255,\s*255/)
    expect(session).not.toMatch(/rgba\(138,\s*180,\s*255/)
    expect(session).not.toContain('#8ab4ff')
    expect(session).not.toContain("background: 'var(--shell-card)'")
    // 设置面板白字标签收敛到墨字（:global 加法层，吃令牌）
    for (const mod of [
      'components/LlmConfigModal.module.css',
      'components/ModelCatalogPanel.module.css',
      'components/NotificationSettingsPanel.module.css',
      'components/ProjectSettings.module.css',
      'components/AppSettingsModal.module.css',
    ]) {
      const source = read(mod)
      expect(source, mod).toContain(":global([data-theme='planche'])")
    }
    const llm = read('components/LlmConfigModal.module.css')
    expect(llm).toContain(":global([data-theme='planche']) .formGroup label")
    expect(llm).toContain(":global([data-theme='planche']) .providerName")
    const catalog = read('components/ModelCatalogPanel.module.css')
    expect(catalog).toContain(":global([data-theme='planche']) .metadata strong")
    expect(catalog).toContain(":global([data-theme='planche']) .empty strong")
    const notif = read('components/NotificationSettingsPanel.module.css')
    expect(notif).toContain(":global([data-theme='planche']) .labelText")
    const project = read('components/ProjectSettings.module.css')
    expect(project).toContain(":global([data-theme='planche']) .promptBox textarea")
    // 运行配置分体浮岛：错峰入场 + reduced-motion 兜底，卡片层吃 --card-index
    expect(project).toContain('projectIslandRise')
    expect(project).toContain('var(--card-index')
    expect(project).toContain('prefers-reduced-motion')
    expect(read('components/ProjectSettings.tsx')).toContain('cardIndexStyle')
    // 彻底分体：弹窗壳透明不做窗面（无底/无框/无影），顶栏是一张独立浮岛卡，
    // 内层容器不垫整块地色——缝隙直接露出共享遮罩。
    const globalsAll = read('styles/globals.css')
    expect(globalsAll).toMatch(/\.ws-config-modal\s*\{[^}]*background:\s*transparent/)
    expect(globalsAll).toMatch(/\.ws-config-modal\s*\{[^}]*box-shadow:\s*none/)
    expect(globalsAll).toContain('.ws-config-head')
    expect(globalsAll).toContain('ws-config-card-rise')
    expect(globalsAll).toContain("[data-theme='planche'] .ws-config-head")
    const launcherCss = stripCssComments(read('components/ProjectLauncher.module.css'))
    expect(launcherCss).toContain('background: transparent')
    expect(launcherCss).not.toMatch(/background:\s*var\(--shell-canvas\)/)
    expect(stripCssComments(project)).not.toMatch(/background:\s*var\(--shell-canvas\)/)
    // 设置底栏不再写死 dark 的 canvas 色值。#151517 只在 dark 成立，留在声明里
    // 会让默认的 planche 纸面主题在内容底部压一条近黑横条，并永久盖住尾部内容。
    for (const mod of [
      'components/LlmConfigModal.module.css',
      'components/ModelCatalogPanel.module.css',
      'components/NotificationSettingsPanel.module.css',
      'components/ProjectSettings.module.css',
      'components/AppSettingsModal.module.css',
    ]) {
      const declared = stripCssComments(read(mod))
      expect(declared, mod).not.toMatch(/#151517|rgba\(\s*21\s*,\s*21\s*,\s*23/)
    }
    expect(notif).toContain("background: color-mix(in srgb, var(--shell-canvas) 90%, transparent);")
    expect(stripCssComments(notif)).toContain(":global([data-theme='planche']) .footer")
    // 文件树 CSS 同样收敛到令牌
    const fileTree = read('components/file-tree/file-tree.module.css')
    expect(fileTree).toContain('color: var(--shell-text)')
    expect(fileTree).not.toMatch(/color:\s*#(d4d4d4|ccc|999)/)
    // 运行配置四表收编主题令牌（2026-10-07-run-config-island-cards）：
    // 无白字/手写色文字、无白 alpha 边框、无黑底填充；文字与边框走 --shell-*
    for (const mod of [
      'components/ProjectSettings.module.css',
      'components/ProjectConfigForm/QuickConfigForm.module.css',
      'components/ProjectTypeSelector.module.css',
      'components/ProjectConfigForm/JsonEditor.module.css',
      'components/ProjectLauncher.module.css',
    ]) {
      const source = stripCssComments(read(mod))
      expect(source, mod).not.toMatch(/color:\s*#/)
      expect(source, mod).not.toMatch(/border[a-z-]*:\s*[^;{}]*rgba\(\s*255\s*,\s*255\s*,\s*255/)
      expect(source, mod).not.toMatch(/background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0/)
      expect(source, mod).not.toMatch(/background:\s*#/)
    }
    // 左栏类型 tab 选中态与设置导航同构：主题底色 + 左 2px 强调条，无整块染色
    const typeSel = read('components/ProjectTypeSelector.module.css')
    expect(typeSel).toContain('.typeItem.selected::before')
    expect(typeSel).toContain('var(--shell-active)')
    expect(typeSel).toContain('var(--shell-accent)')
    // configTab 选中态：文字提亮 + 2px 强调条，不吃白色填充块
    const quick = stripCssComments(read('components/ProjectConfigForm/QuickConfigForm.module.css'))
    expect(quick).toContain('.configTab.active::after')
    expect(quick).not.toMatch(/\.configTab\.active\s*\{[^}]*background/)
    // 中部组卡与设置内卡同料：柔和发丝线 + 12% 抬升底色，两主题共用一条规则
    const innerCard = 'color-mix(in srgb, var(--shell-chrome-raised) 12%, var(--shell-canvas))'
    expect(quick).toContain(innerCard)
    expect(stripCssComments(project)).toContain(innerCard)
  })

  it('covers expanded deep surfaces (brand/tabs/chat/monitor/roundtable/auxiliary)', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n').replace(/\r\n/g, '\n')
    const island = read('components/janus/styles/13-janus-planche.css')
    // 第二轮：压过 05/06/07/09/10 的 (0,5,0)+ 黑底/白字，特异性逐条到位
    for (const selector of [
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-expanded-brand",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-expanded-view-button[data-active='true']",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'][data-view='chat'] .janus-chat-message.user .janus-chat-message-content",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'][data-view='chat'] .janus-chat-input",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-monitor-crt",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-monitor-panel",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'] .janus-runtime-run",
      "[data-theme='planche'] .janus-island-shell[data-stage='expanded'][data-view='roundtable'] .janus-roundtable-center",
      "[data-theme='planche'] .janus-auxiliary-island",
      "[data-theme='planche'] .janus-agent-result-detail",
      "[data-theme='planche'] .janus-roundtable-artifact",
    ]) {
      expect(island, selector).toContain(selector)
    }
    // 辅助岛深色 !important 用同等回敬（仅换色），文件仍无黑底面与毛玻璃
    expect(island).toContain('.janus-auxiliary-island {\n  background: var(--paper, #EFE4C5) !important;')
    expect(island).not.toMatch(/backdrop-filter:\s*blur/)
    expect(island.replaceAll('repeating-linear-gradient', '')).not.toMatch(/linear-gradient/)
  })

  it('keeps close marks visible without red hover and papers menus/selects', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // Close marks stay visible across both themes.
    const globals = read('styles/globals.css')
    expect(globals).toContain('.modal-close-light::after,')
    expect(globals).toContain('.modal-close-light:hover::after')
    expect(globals).not.toMatch(/\.modal-close-light:hover::after\s*\{\s*color:\s*rgba/)
    const bp = readFileSync(resolve(__dirname, '../../plugins/blueprint/src/ui/blueprint.css'), 'utf8')
    expect(bp).toContain('.blueprint-workbench-close::after,')
    expect(bp).toContain('.blueprint-workbench-close:hover::after')
    expect(bp).not.toContain('filter: brightness(1.1);')
    const knowledge = read('components/knowledge/KnowledgeWorkbench.module.css')
    expect(knowledge).toContain('.closeButton::after,')
    expect(knowledge).toContain('.closeButton:hover::after')
    // 运行球 popover 关闭：悬浮静态（13 纸面层同步无红化）
    const island = read('components/janus/styles/13-janus-planche.css')
    expect(island).toContain("[data-theme='planche'] .janus-run-orb-popover-close,")
    expect(island).toContain("[data-theme='planche'] .janus-run-orb-popover-close:hover")
    // 通用 Select：触发器 + 浮层 + 选项纸面化（:global 加法层，吃令牌）
    const select = read('components/ui/Select.module.css')
    for (const selector of [
      ":global([data-theme='planche']) .trigger",
      ":global([data-theme='planche']) .dropdown",
      ":global([data-theme='planche']) .option:hover",
      ":global([data-theme='planche']) .optionSelected",
    ]) {
      expect(select, selector).toContain(selector)
    }
    expect(select).not.toMatch(/linear-gradient/)
    // 模型菜单 / 作者行纸面化
    expect(island).toContain("[data-theme='planche'] .janus-island-shell[data-stage='expanded'][data-view='chat'] .janus-chat-model-menu {")
    const chat = read('components/janus/styles/03-janus-chat-core.css')
    expect(chat).toMatch(/\.janus-chat-message-author\s*\{\s*color:\s*var\(--shell-muted\)/)
    expect(chat).toMatch(/\.janus-chat-message\.assistant \.janus-chat-message-author\s*\{\s*color:\s*var\(--shell-accent\)/)
  })

  it('routes the workspace ⋯ menu through theme tokens', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // Workspace menus use the shared popover palette rather than theme-id branches.
    const sidebar = read('components/Sidebar.tsx')
    expect(sidebar).not.toContain('plancheMenu')
    expect(sidebar).toContain("background: 'var(--popover-background)'")
    expect(sidebar).toContain("border: '1px solid var(--control-border)'")
    expect(sidebar).toContain('separatorClassName')
    expect(sidebar).toContain('bg-[var(--shell-border)]')
    expect(sidebar).not.toContain('rgba(25,25,25,0.98)')
    expect(sidebar).not.toContain("'1px solid rgba(255,255,255,0.09)'")
    expect(sidebar).toContain('hover:bg-[var(--popover-hover)]')
    expect(sidebar).toContain("boxShadow: 'var(--popover-shadow)'")
    expect(sidebar).not.toContain('onMouseEnter={(event) => {')
  })

  it('routes knowledge surfaces through the theme (graph JS + workbench CSS)', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // 图谱 JS 颜色：仿 getBlueprintStatusVisual，dark 快照 + 纸面映射 + 令牌边线
    // 工作台 CSS：壳/头/图谱/列表/审查器纸面化（:global 加法层，吃令牌）
    const wb = read('components/knowledge/KnowledgeWorkbench.module.css')
    for (const selector of [
      ":global([data-theme='planche']) .header",
      ":global([data-theme='planche']) .graphCanvas",
      ":global([data-theme='planche']) .reviewCard",
      ":global([data-theme='planche']) .inspectorTitle",
      ":global([data-theme='planche']) .graphCard",
      ":global([data-theme='planche']) .actionRow button:not(:disabled)",
    ]) {
      expect(wb, selector).toContain(selector)
    }
    // 助手面板：输入/标题纸面化
    const assist = read('components/knowledge/KnowledgeAssist.module.css')
    expect(assist).toContain(":global([data-theme='planche']) .searchInput")
    expect(assist).toContain(":global([data-theme='planche']) .rowTitle")
    // 卡片品类手绘标：石板单线、无辉光（种子生成已移除）
    const topo = read('components/ui/QuantumTopologyPreview.module.css')
    for (const selector of [
      ":global([data-theme='planche']) .mark",
      ":global([data-theme='planche']) .kindFact",
      ":global([data-theme='planche']) .kindWiki",
      ":global([data-theme='planche']) .kindGraph",
    ]) {
      expect(topo, selector).toContain(selector)
    }
    expect(topo).not.toMatch(/linear-gradient/)
    expect(topo).not.toMatch(/drop-shadow/)
    expect(topo).not.toMatch(/backdrop-filter/)
    // 自绘悬浮提示 pill 纸面化（title= 原生提示由系统绘制，不在主题范围内）
    const islandCss = read('components/janus/styles/13-janus-planche.css')
    expect(islandCss).toContain("[data-theme='planche'] .pull-hint {")
  })

  it('routes team entry surfaces through theme tokens (gate + footer)', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // 进入界面（挡板）：基底走 --shell-* 令牌，纸面加法层只翻投影。
    // 遮罩刻意不在加法层里，见下方 "keeps one shared modal scrim" 一条。
    const gate = read('components/team/TeamSetupGate.module.css')
    expect(gate).toContain(":global([data-theme='planche']) .panel")
    expect(gate).toContain('var(--shell-accent-strong)')
    expect(gate).toContain('var(--shell-accent-soft)')
    expect(gate).toContain('var(--shell-diff-del)')
    expect(gate).not.toMatch(/#08080a|#111113|#17171b|#ff8a2e/i)
    expect(gate).not.toMatch(/rgba\(255,\s*255,\s*255/)
    expect(gate).not.toMatch(/rgba\(255,\s*12\d,\s*\d+/)
    // 侧栏团队行：悬浮/聚焦走令牌，纸面只换浮层套印影
    const footer = read('components/team/TeamFooter.module.css')
    expect(footer).toContain(":global([data-theme='planche']) .popover")
    expect(footer).toContain('var(--shell-hover)')
    expect(footer).toContain('var(--shell-accent-border)')
    expect(footer).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.0[345]/)
    expect(footer).not.toMatch(/rgba\(255,\s*120,\s*48/)
    // 设置 team 页复用通知面板样式（已有 planche 层），入口提示走自绘 ThemedTooltip
    const notif = read('components/NotificationSettingsPanel.module.css')
    expect(notif).toContain(":global([data-theme='planche']) .labelText")
    const teamFooter = read('components/team/TeamFooter.tsx')
    expect(teamFooter).toContain('ThemedTooltip')
  })

  it('keeps one shared modal scrim, un-themed (every full-screen surface)', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // 「新建任务盘」是参照实现：它不碰遮罩，所以吃 shared/ModalFrame.css 的
    // rgba(8,8,10,0.62) + blur(10px)。设置中心、蓝图、知识库等曾各自把遮罩翻成
    // 0.18 淡墨罩 + backdrop-filter:none，纸面主题下等于全透明，工作台直接透
    // 出来——同一层遮罩两种结果。这里锁死共享。
    const SHARED_SCRIM = 'rgba(8, 8, 10, 0.62)'
    const frame = read('components/shared/ModalFrame.css')
    expect(frame).toContain(`background: ${SHARED_SCRIM};`)
    expect(frame).toContain('backdrop-filter: blur(10px)')
    for (const mod of [
      'components/AppSettingsModal.module.css',
      'components/LlmConfigModal.module.css',
      'components/team/TeamSetupGate.module.css',
      // 参照实现：任何一方都不得在自己的加法层里翻遮罩
      'components/WorktreeDialogs.module.css',
    ]) {
      const source = read(mod)
      expect(source, mod).not.toMatch(
        /\[data-theme='planche'\][^{]*\.(backdrop|modalBackdrop|blueprint-workbench-backdrop)\s*\{[^}]*background/,
      )
      expect(source, mod).not.toMatch(/rgba\(28,\s*52,\s*59,\s*0\.18\)/)
    }
    // 不自带遮罩的表面照旧继承共享层；自带遮罩的表面必须逐字复制共享参数
    expect(read('components/LlmConfigModal.module.css')).toContain(`background: ${SHARED_SCRIM};`)
    expect(read('components/team/TeamSetupGate.module.css')).toContain(`background: ${SHARED_SCRIM};`)
    expect(read('components/WorktreeDialogs.module.css')).not.toContain('backdrop')
    // 蓝图 / 知识库不走 ModalFrame（各有各的 scrim 类与卡片式逐步唤出），
    // 但全屏遮罩必须与共享层逐字一致，且不得在加法层里被翻淡。
    // 注意：只管全屏遮罩——蓝图内的 prompt-dialog__overlay 是嵌在已压暗父遮罩之上的
    // 次级弹窗，浓度本就该比父层轻，不在此约束内。
    const blueprint = readFileSync(resolve(__dirname, '../../plugins/blueprint/src/ui/blueprint.css'), 'utf8')
    expect(blueprint).toMatch(
      /\.blueprint-workbench-backdrop \{[^}]*background: rgba\(8, 8, 10, 0\.62\);[^}]*backdrop-filter: blur\(10px\);/,
    )
    expect(blueprint).not.toMatch(/\[data-theme='planche'\] \.blueprint-workbench-backdrop/)
    expect(blueprint).not.toContain('modal-frame-backdrop')
    const knowledge = read('components/knowledge/KnowledgeWorkbench.module.css')
    expect(knowledge).toMatch(
      /\.backdrop \{[^}]*background: rgba\(8, 8, 10, 0\.62\);[^}]*backdrop-filter: blur\(10px\);/,
    )
    expect(knowledge).not.toMatch(/:global\(\[data-theme='planche'\]\) \.backdrop/)
    expect(knowledge).not.toContain('modal-frame-backdrop')
  })

  it('keeps knowledge workbench close visible at the right with a stable 30px target', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    const tsx = read('components/knowledge/PersonalMemoryWorkbench.tsx')
    const css = read('components/knowledge/KnowledgeWorkbench.module.css')
    // The existing DOM selector stays stable; flex order places the close action at the right.
    const header = tsx.slice(tsx.indexOf('<header className={styles.header}'), tsx.indexOf('</header>', tsx.indexOf('<header className={styles.header}')))
    expect(header.indexOf('styles.closeButton')).toBeGreaterThan(-1)
    expect(header.indexOf('styles.closeButton')).toBeLessThan(header.indexOf('styles.breadcrumb'))
    // 关闭从动作组里移走，那一组只剩刷新一类动作
    const actions = header.slice(header.indexOf('styles.headerActions'))
    expect(actions).not.toContain('styles.closeButton')
    // A 28px button with 1px hit slop preserves a 30px target without press-time scaling.
    expect(css).toMatch(/\.closeButton \{[^}]*flex: 0 0 auto;/)
    expect(css).toMatch(/\.closeButton \{[^}]*order: 100;/)
    expect(css).toMatch(/\.closeButton \{[^}]*width: 28px;/)
    expect(css).toMatch(/\.header \{[^}]*padding: 0 12px 0 14px;/)
    expect(css).toMatch(/\.closeButton::before \{[^}]*inset: -1px;/)
  })

  it('serves left-rail hover hints from ThemedTooltip, not native title', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8').replace(/\r\n/g, '\n')
    // 自绘提示走 portal + 令牌 + planche 加法层（display:contents 锚点不改布局）
    const tip = read('components/ui/ThemedTooltip.tsx')
    expect(tip).toContain('createPortal')
    expect(tip).toContain('role="tooltip"')
    const tipCss = read('components/ui/ThemedTooltip.module.css')
    expect(tipCss).toContain('display: contents')
    expect(tipCss).toContain(":global([data-theme='planche']) .tip")
    expect(tipCss).toContain('var(--shell-text')
    // 左侧工作区不再挂原生 title（原生黑框系统绘制，主题够不着）
    for (const file of [
      'components/Sidebar.tsx',
      'components/WorkbenchSwitcher.tsx',
      'components/team/TeamFooter.tsx',
    ]) {
      const source = read(file)
      expect(source, file).toContain('ThemedTooltip')
      expect(nativeControlTitleElements(source), file).toEqual([])
    }
    // 右侧同样：dock 栏/页签/会话面板提示走 ThemedTooltip
    for (const file of [
      'components/right-tools/RightToolRail.tsx',
      'components/SessionPanel.tsx',
    ]) {
      const source = read(file)
      expect(source, file).toContain('ThemedTooltip')
      expect(nativeControlTitleElements(source), file).toEqual([])
    }
    // 终端区同样：菜单/页签/遥测卡/底部抽屉栏提示走 ThemedTooltip
    const area = read('components/TerminalArea.tsx')
    expect(area).toContain('ThemedTooltip')
    expect(nativeControlTitleElements(area)).toEqual([])
  })
})
