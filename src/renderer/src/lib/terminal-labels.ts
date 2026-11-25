import type { Terminal, TerminalPreset } from '@/types'
import { resolveContextWindows } from './runtime-telemetry'
import { useThemeDefinition } from '@/stores/theme'

/** 终端预设的本地化名称。抽屉卡片、悬浮提示与顶栏共用同一映射。 */
export function providerLabel(preset: TerminalPreset, t: (key: string) => string): string {
  switch (preset) {
    case 'claude':
      return t('terminal:provider.claude')
    case 'codex':
      return t('terminal:provider.codex')
    case 'opencode':
      return t('terminal:provider.opencode')
    case 'janus':
      return t('terminal:provider.janus')
    case 'pi':
      return t('terminal:provider.pi')
    case 'dsh':
      return t('terminal:provider.dsh')
    case 'shell':
      return t('terminal:provider.shell')
  }
}

/** 模型名：shell 无模型，未检出时显示探测中。 */
export function modelLabel(terminal: Terminal, t: (key: string) => string): string {
  if (terminal.preset === 'shell') return t('terminal:model.na')
  return terminal.detectedModel ?? t('terminal:model.detecting')
}

/** 紧凑计数：卡片等窄空间用 4.0k/200k，悬浮提示用精确值。 */
export function formatTokenCount(value?: number): string {
  if (!value) return '0'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function contextWindow(terminal: Terminal): number | undefined {
  return resolveContextWindows(
    terminal.preset,
    terminal.detectedModel,
    terminal.contextWindowTokens,
  ).effectiveWindow
}

export function contextRatio(terminal: Terminal): number | undefined {
  const windowTokens = contextWindow(terminal)
  if (!windowTokens || terminal.contextTokens === undefined) return undefined
  return Math.min(1, terminal.contextTokens / windowTokens)
}

/** 按当前主题的上下文用量刻度插值，主题切换时同步更新。 */
export function useContextRatioColor(ratio: number | undefined): string {
  const scale = useThemeDefinition().ctxScale
  if (ratio === undefined) return scale.empty
  const r = Math.max(0, Math.min(1, ratio))
  const [c0, c50, c85, c100] = scale.stops.map(hexToRgb)
  // 三段插值：[0,0.5] 宽裕→正常，[0.5,0.85] 正常→警告，[0.85,1] 警告加深
  if (r <= 0.5) {
    const t = r / 0.5
    return mixColor(c0, c50, t)
  }
  if (r <= 0.85) {
    const t = (r - 0.5) / 0.35
    return mixColor(c50, c85, t)
  }
  const t = (r - 0.85) / 0.15
  return mixColor(c85, c100, t)
}

function hexToRgb(hex: string): number[] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function mixColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  return `rgb(${r}, ${g}, ${Math.round(a[2] + (b[2] - a[2]) * t)})`
}

export function contextLabel(terminal: Terminal, t: (key: string) => string): string {
  if (terminal.contextTokens === undefined) return t('terminal:telemetry.contextUnknown')
  const used = terminal.contextTokens
  const windowTokens = contextWindow(terminal)
  if (!windowTokens) return `${formatTokenCount(used)} ctx`
  return `${formatTokenCount(used)} / ${formatTokenCount(windowTokens)}`
}

/** 展开面板/悬浮提示用的精确占用：4,000 / 200,000；徽章窄空间仍用紧凑版。 */
export function contextExactLabel(terminal: Terminal, t: (key: string) => string): string {
  if (terminal.contextTokens === undefined) return t('terminal:telemetry.contextUnknown')
  const used = terminal.contextTokens.toLocaleString('en-US')
  const windowTokens = contextWindow(terminal)
  if (!windowTokens) return `${used} ctx`
  return `${used} / ${windowTokens.toLocaleString('en-US')}`
}

export function contextPercentLabel(terminal: Terminal): string {
  const ratio = contextRatio(terminal)
  return ratio === undefined ? '--' : `${(ratio * 100).toFixed(1)}%`
}
