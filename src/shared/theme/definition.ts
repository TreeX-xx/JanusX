/**
 * 主题契约（M1 统一结构的核心）。
 *
 * 一个主题 = 一份 ThemeDefinition：id + 语义令牌 + xterm palette + Monaco theme。
 * 调色只改这里；CSS 变量 / xterm / Monaco 由 scripts/generate-theme-css.mjs
 * 从同一份 definition 生成，三端不可能漂移。
 * 扩展新主题：复制 PLANCHE_THEME_DEFINITION 改值 + registry.defineTheme()，详见 README。
 */
import type { AppTheme } from '../ipc/theme'

export type ThemeBase = 'dark' | 'light'

export interface MonacoThemeDefinition {
  base: string
  inherit: boolean
  rules: readonly unknown[]
  colors: Record<string, string>
}

export type TerminalStatusKind = 'running' | 'wait' | 'attention' | 'degraded' | 'error'

export interface TerminalStatusDefinition {
  color: string
  background: string
}

/** 上下文用量三段刻度：empty 缺省色 + 0%/50%/85%/100% 四个插值锚点。 */
export interface ContextScaleDefinition {
  empty: string
  stops: [string, string, string, string]
}

export interface ThemeDefinition {
  /** Authorized plugin palettes inherit built-in structural styles. */
  pluginBase?: 'planche' | 'dark'
  overrides?: Record<string, string>
  /** 主题 id，与 GlobalConfig.theme / data-theme 取值一致。 */
  id: AppTheme
  /** 回退展示名（renderer 侧优先走 i18n）。 */
  label: string
  /** 明暗基底：决定 color-scheme 与对比度家族。 */
  base: ThemeBase
  /** 生成文件的注释说明。 */
  notes?: string
  /** CSS 变量表（key 不带 -- 前缀，值原样写入，允许 var() 引用）。 */
  tokens: Record<string, string>
  /** 文本选中底色（::selection）。 */
  selection: string
  /** 中部工作区 xterm 全量 palette。 */
  xterm: Record<string, string>
  /** Monaco 注册名。 */
  monacoName: string
  /** Monaco 主题体（只允许 #RRGGBB / #RRGGBBAA，Monaco 会静默丢弃 rgba()）。 */
  monaco: MonacoThemeDefinition
  /** 终端状态点（侧栏圆环/徽标/attention 排序共用，禁止各处自建色值）。 */
  status: Record<TerminalStatusKind, TerminalStatusDefinition>
  /** 上下文用量条三段刻度（宽裕→正常→警告→逼近）。 */
  ctxScale: ContextScaleDefinition
}

/* ── dark（经典黑，第二位）：值与历史 :root 逐字一致 ─────────────────────────── */

// Shared visual constants preserve the existing component artwork.
const SHARED_UI_TOKENS = {
  'support-star-stroke': '#d99a0b',
  'support-star-fill': '#facc15',
  'dialog-backdrop': 'rgba(0,0,0,.3)',
  'dialog-shadow': 'rgba(0,0,0,.45)',
  'run-bud-border': 'rgba(0, 255, 136, 0.35)',
  'run-bud-glow': 'rgba(0, 255, 136, 0.12)',
  'run-bud-skin-top': '#1a1a1c',
  'run-bud-skin-bottom': '#0b0b0d',
  'run-bud-text': '#b8ffd9',
  'run-bud-hover': 'rgba(0, 255, 136, 0.85)',
  'run-bud-active-ring': 'rgba(0, 255, 136, 0.45)',
  'run-bud-active-glow': 'rgba(0, 255, 136, 0.28)',
  'run-bud-stop-border': 'rgba(255, 95, 87, 0.8)',
  'run-bud-stop-text': '#ffc9c4',
  'run-bud-stop-glow': 'rgba(210, 72, 72, 0.35)',
  'run-scope-accent': '#5b8def',
  'usage-heatmap-mid': '#238636',
  'usage-heatmap-high': '#40c463',
  'preview-paper': '#fff',
  'preview-shadow': 'rgba(0,0,0,.15)',
  'font-mono': '"Cascadia Mono", "SF Mono", Consolas, monospace',
  'focus-progress': '0',
}

const DARK_TOKENS = {
  ...SHARED_UI_TOKENS,
  'sidebar-codex-filter': 'invert(1)',
  'session-sheet-base-weight': '96%',
  'cli-logo-light': '#f4f4f4',
  'cli-logo-dark': '#202024',
  'shell-void': '#101012',
  'shell-canvas': '#151517',
  'shell-pane': '#191919',
  'shell-pane-chrome': '#1e1e1f',
  'shell-chrome': '#1e1e20',
  'shell-chrome-raised': '#252527',
  'shell-card': '#1c1c1f',
  'shell-drawer': '#0c0c0e',
  'island-panel-background': 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.045), transparent 30%), #030303',
  'island-panel-border': 'rgba(255,255,255,0.075)',
  'island-panel-radius': '26px',
  'island-panel-shadow': 'inset 0 1px 0 rgba(255,255,255,0.045), 0 24px 64px rgba(0,0,0,0.6), 0 0 16px rgba(255,120,48,0.06)',
  'tool-canvas': '#1e1e20',
  'tool-card': '#1c1c1f',
  'tool-chrome': '#1e1e1f',
  'tool-hover': '#2b2b2e',
  'popover-background': '#252527',
  'popover-hover': 'rgba(255,255,255,0.06)',
  'popover-shadow': '0 14px 36px rgba(0,0,0,0.55)',
  'control-h': '30px',
  'control-border': 'rgba(255, 255, 255, 0.07)',
  'shell-hover': '#2b2b2e',
  'shell-active': '#333336',
  'shell-border': 'rgb(255 255 255 / 0.07)',
  'shell-border-soft': 'rgb(255 255 255 / 0.045)',
  'shell-text': '#fafafa',
  'shell-muted': '#a1a1a1',
  'shell-dim': '#737373',
  'shell-diff-add': '#4ec9b0',
  'shell-diff-del': '#e06c75',
  'status-success': '#6bd89b',
  'status-warning': '#f0a35e',
  'status-danger': '#ff7474',
  'shell-accent': '#f47d43',
  'shell-accent-strong': '#ff9159',
  'shell-accent-soft': 'rgb(244 125 67 / 0.08)',
  'shell-accent-border': 'rgb(244 125 67 / 0.42)',
  'primary': '#ff7830',
  'bg-app': 'var(--shell-void)',
  'bg-deep': 'var(--shell-canvas)',
  'bg-dark': 'var(--shell-pane)',
  'bg-darker': 'var(--shell-void)',
  'workbench-canvas': '#131315',
  'workbench-grid': '#101012',
  'surface': 'rgba(30, 30, 32, 0.75)',
  'surface-elevated': 'rgba(30, 30, 32, 0.9)',
  'chrome-bg': 'rgba(30, 30, 32, 0.9)',
  'text': '#e0e0e0',
  'text-secondary': '#888',
  'text-dim': '#555',
  'border': 'rgba(255, 255, 255, 0.055)',
  'border-soft': 'rgba(255, 255, 255, 0.04)',
  'accent-soft': 'rgba(255, 120, 48, 0.1)',
  'accent-mid': 'rgba(255, 120, 48, 0.18)',
  'accent-glow': 'rgba(255, 120, 48, 0.3)',
} as const

const DARK_XTERM = {
  background: '#151517',
  foreground: '#d4d4d4',
  cursor: '#ff7830',
  cursorAccent: '#151517',
  selectionBackground: 'rgba(255, 120, 48, 0.18)',
  black: '#1f1f23',
  red: '#e06c75',
  green: '#4ec9b0',
  yellow: '#e5c07b',
  blue: '#58a6ff',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#888888',
  brightBlack: '#666666',
  brightRed: '#ff8585',
  brightGreen: '#00ff88',
  brightYellow: '#f0d28a',
  brightBlue: '#79b8ff',
  brightMagenta: '#d7a8d9',
  brightCyan: '#6ee7cf',
  brightWhite: '#f2f2f3',
} as const

const DARK_MONACO: MonacoThemeDefinition = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#151517',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#1c1c1e',
    'editorCursor.foreground': '#ff7830',
    'editor.selectionBackground': '#264f7859',
    'editor.inactiveSelectionBackground': '#264f782e',
    'editorLineNumber.foreground': '#444444',
    'editorLineNumber.activeForeground': '#888888',
    'editorWidget.background': '#1e1e1f',
    'editorWidget.foreground': '#e0e0e0',
    'editorWidget.border': '#2b2b2e',
    'input.background': '#151517',
    'input.foreground': '#e0e0e0',
    'input.border': '#2b2b2e',
    'focusBorder': '#f47d43',
    'inputOption.activeBackground': '#f47d431f',
    'inputOption.activeBorder': '#f47d436b',
    'inputOption.activeForeground': '#ff9159',
    'toolbar.hoverBackground': '#2b2b2e',
    'editor.findMatchBackground': '#ff783059',
    'editor.findMatchBorder': '#ff7830',
    'editor.findMatchHighlightBackground': '#ff78302e',
    // preview-editor-display-style A：正文薄纱（8%）、gutter 色带（30%）、词强调 1:4（32%）
    'diffEditor.insertedLineBackground': '#37633f14',
    'diffEditor.removedLineBackground': '#713a3a14',
    'diffEditor.insertedTextBackground': '#4d8a5852',
    'diffEditor.removedTextBackground': '#9a4d4d52',
    'diffEditorGutter.insertedLineBackground': '#5a9d644d',
    'diffEditorGutter.removedLineBackground': '#bd62624d',
  },
}

export const DARK_THEME_DEFINITION: ThemeDefinition = {
  id: 'dark',
  label: 'Classic Black',
  base: 'dark',
  notes: 'Default. Surface ramp keeps canvas below chrome (~9pt gap) so panes read sunk, not punched.',
  tokens: { ...DARK_TOKENS },
  selection: 'rgba(38, 79, 120, 0.35)',
  xterm: { ...DARK_XTERM },
  monacoName: 'janusx-dark',
  monaco: DARK_MONACO,
  status: {
    running: { color: '#6bd89b', background: 'rgba(70, 190, 125, 0.1)' },
    wait: { color: '#8a8a93', background: 'rgba(255,255,255,0.05)' },
    attention: { color: '#f0a35e', background: 'rgba(240, 163, 94, 0.12)' },
    degraded: { color: '#c9a0ff', background: 'rgba(160, 110, 255, 0.1)' },
    error: { color: '#ff7474', background: 'rgba(255, 88, 88, 0.1)' },
  },
  ctxScale: {
    empty: 'rgba(255,255,255,0.18)',
    stops: ['#58a6ff', '#ff7830', '#ff5858', '#e02b2b'],
  },
}

/* ── planche（石板色，可选主题）：值与历史 [data-theme='planche'] 逐字一致 ──
   来源 design/pelican-lithograph-style.md：纸 #EFE4C5 / 墨 #1C343B / 朱红 #D43D2A。 */

const PLANCHE_TOKENS = {
  ...SHARED_UI_TOKENS,
  'sidebar-codex-filter': 'none',
  'session-sheet-base-weight': '84%',
  'cli-logo-light': '#f4f4f4',
  'cli-logo-dark': '#202024',
  'paper': '#EFE4C5',
  'paper-deep': '#DCCFA8',
  'ink': '#1C343B',
  'ink-soft': 'rgba(28, 52, 59, 0.62)',
  'ink-faint': 'rgba(28, 52, 59, 0.38)',
  'line': '#1C343B',
  'line-soft': 'rgba(28, 52, 59, 0.22)',
  'planche-red': '#D43D2A',
  'planche-ochre': '#E5A422',
  'planche-green-deep': '#2E6B5E',
  'planche-green-pale': '#A9C8BB',
  'planche-misprint': '#E8A08A',
  'shell-void': '#EFE4C5',
  'shell-canvas': '#EFE4C5',
  'shell-pane': '#EFE4C5',
  'shell-pane-chrome': '#E7D9B4',
  'shell-chrome': '#EFE4C5',
  'shell-chrome-raised': '#DCCFA8',
  'shell-card': '#EFE4C5',
  'shell-drawer': '#E7D9B4',
  'island-panel-background': 'var(--shell-canvas)',
  'island-panel-border': 'var(--shell-text)',
  'island-panel-radius': '26px',
  'island-panel-shadow': '3px 3px 0 var(--shell-text)',
  'tool-canvas': '#EFE4C5',
  'tool-card': '#F2E9D2',
  'tool-chrome': '#EAE0C6',
  'tool-hover': '#E5D9BB',
  'popover-background': '#F3EBD7',
  'popover-hover': '#EAE0C8',
  'popover-shadow': '0 8px 24px rgba(28,52,59,0.12), 0 2px 6px rgba(28,52,59,0.06)',
  'control-h': '30px',
  'control-border': 'rgba(28, 52, 59, 0.22)',
  'shell-hover': '#DCCFA8',
  'shell-active': '#DCCFA8',
  'shell-border': 'rgba(28, 52, 59, 0.22)',
  'shell-border-soft': 'rgba(28, 52, 59, 0.14)',
  'shell-text': '#1C343B',
  'shell-muted': 'rgba(28, 52, 59, 0.62)',
  'shell-dim': 'rgba(28, 52, 59, 0.42)',
  'shell-diff-add': '#2E6B5E',
  'shell-diff-del': '#D43D2A',
  /* 状态色：纸面上 #E5A422 对比度不足，Ochre 加深到约 4.4:1 供小字号粗体使用。 */
  'status-success': '#2E6B5E',
  'status-warning': '#8A5A12',
  'status-danger': '#D43D2A',
  'shell-accent': '#D43D2A',
  'shell-accent-strong': '#D43D2A',
  'shell-accent-soft': 'rgba(212, 61, 42, 0.1)',
  'shell-accent-border': 'rgba(212, 61, 42, 0.45)',
  'primary': '#D43D2A',
  'bg-app': '#EFE4C5',
  'bg-deep': '#EFE4C5',
  'bg-dark': '#EFE4C5',
  'bg-darker': '#DCCFA8',
  'workbench-canvas': '#EFE4C5',
  'workbench-grid': '#DCCFA8',
  'surface': 'rgba(239, 228, 197, 0.92)',
  'surface-elevated': '#EFE4C5',
  'chrome-bg': 'rgba(239, 228, 197, 0.95)',
  'text': '#1C343B',
  'text-secondary': 'rgba(28, 52, 59, 0.62)',
  'text-dim': 'rgba(28, 52, 59, 0.38)',
  'border': 'rgba(28, 52, 59, 0.22)',
  'border-soft': 'rgba(28, 52, 59, 0.14)',
  'accent-soft': 'rgba(212, 61, 42, 0.1)',
  'accent-mid': 'rgba(212, 61, 42, 0.18)',
  'accent-glow': 'rgba(212, 61, 42, 0.18)',
} as const

const PLANCHE_XTERM = {
  background: '#EFE4C5',
  foreground: '#1C343B',
  cursor: '#D43D2A',
  cursorAccent: '#EFE4C5',
  selectionBackground: 'rgba(212, 61, 42, 0.18)',
  black: '#1C343B',
  red: '#D43D2A',
  green: '#2E6B5E',
  yellow: '#E5A422',
  blue: '#1C343B',
  magenta: '#D43D2A',
  cyan: '#2E6B5E',
  white: '#5a6d72',
  brightBlack: '#7a8b90',
  brightRed: '#D43D2A',
  brightGreen: '#2E6B5E',
  brightYellow: '#E5A422',
  brightBlue: '#1C343B',
  brightMagenta: '#D43D2A',
  brightCyan: '#2E6B5E',
  brightWhite: '#1C343B',
} as const

const PLANCHE_MONACO: MonacoThemeDefinition = {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#EFE4C5',
    'editor.foreground': '#1C343B',
    'editor.lineHighlightBackground': '#E7D9B4',
    'editorCursor.foreground': '#D43D2A',
    'editor.selectionBackground': '#D43D2A2E',
    'editor.inactiveSelectionBackground': '#D43D2A1F',
    'editorLineNumber.foreground': '#7a8b90',
    'editorLineNumber.activeForeground': '#1C343B',
    'editorWidget.background': '#EFE4C5',
    'editorWidget.foreground': '#1C343B',
    'editorWidget.border': '#1C343B',
    'input.background': '#EFE4C5',
    'input.foreground': '#1C343B',
    'input.border': '#1C343B',
    'focusBorder': '#D43D2A',
    'inputOption.activeBackground': '#D43D2A1F',
    'inputOption.activeBorder': '#D43D2A6B',
    'inputOption.activeForeground': '#D43D2A',
    'toolbar.hoverBackground': '#DCCFA8',
    'editor.findMatchBackground': '#D43D2A59',
    'editor.findMatchBorder': '#D43D2A',
    'editor.findMatchHighlightBackground': '#D43D2A2E',
    // preview-editor-display-style A：正文薄纱（8%）、gutter 色带（30%）、词强调 1:4（32%）
    'diffEditor.insertedLineBackground': '#2E6B5E14',
    'diffEditor.removedLineBackground': '#D43D2A14',
    'diffEditor.insertedTextBackground': '#2E6B5E52',
    'diffEditor.removedTextBackground': '#D43D2A52',
    'diffEditorGutter.insertedLineBackground': '#2E6B5E4D',
    'diffEditorGutter.removedLineBackground': '#D43D2A4D',
  },
}

export const PLANCHE_THEME_DEFINITION: ThemeDefinition = {
  id: 'planche',
  label: 'Slate',
  base: 'light',
  notes: 'Print-style light: paper/ink single-vermilion accent, flat fills, no gradients.',
  tokens: { ...PLANCHE_TOKENS },
  selection: 'rgba(212, 61, 42, 0.22)',
  xterm: { ...PLANCHE_XTERM },
  monacoName: 'janusx-planche',
  monaco: PLANCHE_MONACO,
  status: {
    running: { color: '#2E6B5E', background: 'rgba(46, 107, 94, 0.12)' },
    wait: { color: 'rgba(28, 52, 59, 0.45)', background: 'rgba(28, 52, 59, 0.06)' },
    attention: { color: '#D43D2A', background: 'rgba(212, 61, 42, 0.1)' },
    degraded: { color: '#6E5A9E', background: 'rgba(110, 90, 158, 0.12)' },
    error: { color: '#D43D2A', background: 'rgba(212, 61, 42, 0.1)' },
  },
  ctxScale: {
    empty: 'rgba(28, 52, 59, 0.18)',
    stops: ['#2E6B5E', '#E5A422', '#D43D2A', '#A3281C'],
  },
}
