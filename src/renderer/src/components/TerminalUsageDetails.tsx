// Note: direct usage content and terminal lifetime — see .agents/notes/terminal/requirements/usage-panel-direct-content.md
import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import type { Terminal } from '@/types'
import type { ReactNode } from 'react'
import { resolveContextWindows } from '@/lib/runtime-telemetry'
import { contextPercentLabel, contextRatio, contextRatioColor, providerLabel } from '@/lib/terminal-labels'
import { cacheSplitFor } from '@/lib/usage-stats'
import { ThemedTooltip } from './ui/ThemedTooltip'

const tokenCount = (value?: number) => value === undefined ? '–' : value.toLocaleString('en-US')

/**
 * 运行时间：本次终端实例从 telemetryStartedAt 到当前的时长。异常退出且保留的
 * 终端以退出时的 updatedAt 为结束时间；启动时间缺失时显示「–」。
 */
export function formatRuntimeDuration(terminal: Terminal, now: number = Date.now()): string {
  const startedAt = terminal.telemetryStartedAt
  const end = terminal.exitCode === undefined ? now : terminal.updatedAt
  const seconds = startedAt === undefined || end === undefined ? undefined : Math.max(0, Math.floor((end - startedAt) / 1000))
  return seconds === undefined
    ? '–'
    : `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function TerminalRuntime({ terminal }: { terminal: Terminal }) {
  const { t } = useI18n('terminal')
  const [now, setNow] = useState(Date.now)
  const startedAt = terminal.telemetryStartedAt
  useEffect(() => {
    if (startedAt === undefined || terminal.exitCode !== undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt, terminal.exitCode])
  return <span className="shrink-0 tabular-nums text-[10px] text-[var(--shell-muted)]">{t('terminal:context.row.runtime')} {formatRuntimeDuration(terminal, now)}</span>
}

/**
 * 会话累计缓存命中率：与设置页统计共用 `cacheSplitFor` 口径（命中为缓存读取，
 * 未命中为新鲜输入加缓存写入，输出不入分母），只是范围收窄到本终端绑定的会话。
 * 缺少缓存读取或新鲜输入字段时显示「–」，明确的零命中显示 `0.0%`。
 */
function cacheHitRateLabel(terminal: Terminal): string {
  const { cacheReadTokens, inputTokens, cacheWriteTokens } = terminal
  if (cacheReadTokens === undefined || inputTokens === undefined) return '–'
  const split = cacheSplitFor(cacheReadTokens, inputTokens, cacheWriteTokens ?? 0)
  return split.rate === undefined ? '–' : `${(split.rate * 100).toFixed(1)}%`
}

/**
 * 用量统计的唯一定义：抽屉卡片（grid）与悬浮提示（rows）都从这里取数，
 * 两边内容不会漂移。展开态一律用精确值；紧凑值只属于折叠徽章。
 */
function usageStatEntries(terminal: Terminal, t: (key: string) => string) {
  return [
    { key: 'cacheHitRate', label: t('terminal:context.row.cacheHitRate'), value: cacheHitRateLabel(terminal) },
    { key: 'cacheRead', label: t('terminal:context.row.cacheRead'), value: tokenCount(terminal.cacheReadTokens) },
    { key: 'cacheWrite', label: t('terminal:context.row.cacheWrite'), value: tokenCount(terminal.cacheWriteTokens) },
    { key: 'sessionTotal', label: t('terminal:context.row.sessionTotal'), value: tokenCount(terminal.totalTokens) },
    { key: 'inputOutput', label: t('terminal:context.row.inputOutput'), value: `${tokenCount(terminal.inputTokens)} / ${tokenCount(terminal.outputTokens)}` },
  ]
}

/** 五项统计：卡片用 2 列网格（末项通栏），悬浮用标签/数值行。 */
export function TerminalUsageStats({ terminal, layout }: { terminal: Terminal; layout: 'grid' | 'rows' }) {
  const { t } = useI18n('terminal')
  const stats = usageStatEntries(terminal, t)

  if (layout === 'rows') {
    return (
      <span className="grid gap-0.5">
        {stats.map((stat) => (
          <span key={stat.key} className="flex items-baseline justify-between gap-4">
            <span className="text-[10px] text-[var(--shell-muted)]">{stat.label}</span>
            <span className="text-[var(--shell-text)]">{stat.value}</span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-2" style={{ borderColor: 'var(--shell-border-soft)' }}>
      {stats.map((stat, index) => (
        <span key={stat.key} className={`flex min-w-0 flex-col${index === stats.length - 1 ? ' col-span-2' : ''}`}>
          <span className="truncate text-[10px] text-[var(--shell-muted)]">{stat.label}</span>
          <span className="truncate text-[11px] text-[var(--shell-text)]">{stat.value}</span>
        </span>
      ))}
    </span>
  )
}

/** 悬浮提示的上下文明细：占用/窗口与占比、剩余、运行窗口、模型容量、压缩次数。 */
function TerminalContextFacts({ terminal }: { terminal: Terminal }) {
  const { t } = useI18n('terminal')
  const windows = resolveContextWindows(terminal.preset, terminal.detectedModel, terminal.contextWindowTokens)
  const ratio = contextRatio(terminal)
  const remaining = windows.effectiveWindow === undefined || terminal.contextTokens === undefined
    ? undefined : Math.max(0, windows.effectiveWindow - terminal.contextTokens)
  const facts: Array<{ key: string; label: string; value: string; accent?: string }> = [
    { key: 'context', label: t('terminal:context.row.context'), value: `${tokenCount(terminal.contextTokens)} / ${tokenCount(windows.effectiveWindow)}`, accent: contextRatioColor(ratio) },
    { key: 'remaining', label: t('terminal:context.row.remaining'), value: tokenCount(remaining) },
    { key: 'runtimeWindow', label: t('terminal:context.row.runtimeWindow'), value: tokenCount(windows.runtimeWindow) },
    { key: 'modelCapacity', label: t('terminal:context.row.modelCapacity'), value: tokenCount(windows.modelCapacity) },
    { key: 'compactions', label: t('terminal:context.row.compactions'), value: tokenCount(terminal.compactionCountConfidence === 'exact' ? terminal.compactionCount ?? 0 : undefined) },
  ]
  return (
    <span className="grid gap-0.5">
      {facts.map((fact) => (
        <span key={fact.key} className="flex items-baseline justify-between gap-4">
          <span className="text-[10px] text-[var(--shell-muted)]">{fact.label}</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[var(--shell-text)]">{fact.value}</span>
            {fact.accent && <span style={{ color: fact.accent }}>{contextPercentLabel(terminal)}</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * 用量悬浮提示：与底部抽屉卡片同一份数据（五项统计 + 上下文明细 + 运行
 * 时间），悬浮即可看全，不必打开抽屉。
 */
export function TerminalContextTooltip({ terminal, children }: { terminal: Terminal; children: ReactNode }) {
  const { t } = useI18n('terminal')
  return (
    <ThemedTooltip
      variant="panel"
      label={
        <span className="grid min-w-0 gap-1.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-semibold text-[var(--shell-text)]">
              {providerLabel(terminal.preset, t)} · {terminal.detectedModel ?? '–'}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--shell-dim)]">{t('terminal:context.row.runtime')} {formatRuntimeDuration(terminal)}</span>
          </span>
          <TerminalContextFacts terminal={terminal} />
          <span className="border-t pt-1.5" style={{ borderColor: 'var(--shell-border-soft)' }}>
            <TerminalUsageStats terminal={terminal} layout="rows" />
          </span>
        </span>
      }
    >
      {children}
    </ThemedTooltip>
  )
}
