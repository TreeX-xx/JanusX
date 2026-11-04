import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JanusMode } from './JanusEye'
import { JanusChat } from './JanusChat'
import type { Message } from './useJanusChat'
import { useI18n } from '@/i18n/useI18n'

/* ════════════════════════════════════════════════════════════
   JanusExpanded — 展开面板组件
   CRT 效果 + Divine Halo + 大型 CSS 驱动眼 + 对话界面
   ════════════════════════════════════════════════════════════ */

interface JanusExpandedProps {
  stage: 'peek' | 'expanded'
  mode: JanusMode
  isRunning: boolean
  onAdvance: () => void
  onCollapse: () => void
  onStepBack: () => void
  messages: Message[]
  pendingContent: string
  isStreaming: boolean
  error: string | null
  onChatSend: (text: string) => void
  onChatRewrite: (messageId: string, text: string) => void
  onChatStop: () => void
  onChatRetry: () => void
  onChatClear: () => void
}

/** mode → CSS class for large eye container */
function faceClass(mode: JanusMode): string {
  if (mode === 'analytics') return 'mode-analytics'
  if (mode === 'running') return 'mode-running'
  // 'sleep' and 'order' both use cyan management visuals
  return 'mode-order'
}

export function JanusExpanded({
  stage,
  mode,
  isRunning,
  onAdvance,
  onCollapse,
  onStepBack,
  messages,
  pendingContent,
  isStreaming,
  error,
  onChatSend,
  onChatRewrite,
  onChatStop,
  onChatRetry,
  onChatClear,
}: JanusExpandedProps) {
  const { t } = useI18n('janus')
  const [collapsing, setCollapsing] = useState(false)
  const [enteredFromCollapsed, setEnteredFromCollapsed] = useState(true)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<'dual' | 'vision' | 'chat'>('dual')

  useEffect(() => {
    if (stage === 'peek') setView('dual')
  }, [stage])

  useEffect(() => {
    const timer = window.setTimeout(() => setEnteredFromCollapsed(false), 220)
    return () => window.clearTimeout(timer)
  }, [])

  const handleCollapse = useCallback(() => {
    setCollapsing(true)
  }, [])

  const handleCollapseEnd = useCallback(() => {
    setCollapsing(false)
    onCollapse()
  }, [onCollapse])

  const handleBackdropClick = useCallback(() => {
    if (stage === 'expanded') {
      onStepBack()
      return
    }
    handleCollapse()
  }, [handleCollapse, onStepBack, stage])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (stage === 'peek') {
        onAdvance()
        return
      }
      onStepBack()
    },
    [onAdvance, onStepBack, stage],
  )

  // 视图循环：dual → vision → chat → dual
  const cycleView = useCallback(() => {
    setView(prev => (prev === 'dual' ? 'vision' : prev === 'vision' ? 'chat' : 'dual'))
  }, [])

  // 按钮文案显示「下一目标态」
  const nextViewLabel =
    view === 'dual' ? t('janus:expanded.viewToggle.visionOnly') : view === 'vision' ? t('janus:expanded.viewToggle.chatOnly') : t('janus:expanded.viewToggle.dual')

  /*-- 状态文本 --*/
  const modeLabel =
    mode === 'analytics' ? t('janus:expanded.modeLabel.analytics') : mode === 'running' ? t('janus:expanded.modeLabel.running') : t('janus:expanded.modeLabel.order')

  const statusText =
    isRunning
      ? t('janus:expanded.status.runningActive')
      : mode === 'analytics'
        ? t('janus:expanded.status.analyticsProcessing')
        : t('janus:expanded.status.orderIdle')

  /*-- 模式颜色 --*/
  const modeColor = mode === 'running' ? 'var(--status-success)' : 'var(--primary)'
  const peekTitle = useMemo(() => {
    if (isRunning) return t('janus:expanded.peek.running')
    if (mode === 'analytics') return t('janus:expanded.peek.analyzing')
    if (mode === 'sleep') return t('janus:expanded.peek.idle')
    return t('janus:expanded.peek.ready')
  }, [isRunning, mode, t])
  const peekSubtitle = useMemo(() => {
    if (isRunning) return t('janus:expanded.peek.workspaceActive')
    if (mode === 'analytics') return t('janus:expanded.peek.blueprintEngaged')
    if (mode === 'sleep') return t('janus:expanded.peek.noWorkspace')
    return t('janus:expanded.peek.doubleClickToOpen')
  }, [isRunning, mode, t])

  /*-- 粒子系统 --*/
  const [particles, setParticles] = useState<Array<{
    id: number; left: number; size: number; duration: number
  }>>([])
  const pidRef = useRef(0)

  useEffect(() => {
    const isActive = mode === 'analytics' || isRunning
    const speed = isActive ? 200 : 800

    const spawn = () => {
      const id = ++pidRef.current
      const left = 20 + Math.random() * 60
      const size = (isActive && Math.random() > 0.5) ? 6 : (Math.random() > 0.8 ? 12 : 6)
      const duration = isActive ? (1.5 + Math.random() * 2) : (3 + Math.random() * 4)
      setParticles(prev => [...prev, { id, left, size, duration }])
      setTimeout(() => setParticles(prev => prev.filter(p => p.id !== id)), duration * 1000)
    }

    const interval = setInterval(spawn, speed)
    return () => clearInterval(interval)
  }, [mode, isRunning])

  /*-- expanded 面板的模式 class --*/
  const expandedModeClass = isRunning
    ? 'mode-running'
    : mode === 'analytics'
      ? 'mode-analytics'
      : 'mode-order'

  useEffect(() => {
    if (collapsing) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      const shell = shellRef.current
      if (!shell || !target || shell.contains(target)) return
      handleBackdropClick()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      handleBackdropClick()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [collapsing, handleBackdropClick])

  return (
    <>
      {stage === 'expanded' && <div className="janus-veil" />}
      <div
        ref={shellRef}
        className={`janus-expanded ${expandedModeClass}${enteredFromCollapsed ? ' from-collapsed' : ''}${collapsing ? ' collapsing' : ''}`}
        data-stage={stage}
        data-view={view}
        role="region"
        aria-label={t('janus:expanded.regionAria')}
        onDoubleClick={handleDoubleClick}
        onAnimationEnd={collapsing ? handleCollapseEnd : undefined}
      >
        {stage === 'peek' ? (
          <div className="janus-peek-shell">
            <div className="janus-peek-orbit" aria-hidden="true" />
            <div className="janus-peek-core">
              <div className={`janus-peek-sigil ${expandedModeClass}`}>
                <div className="janus-peek-halo halo-outer" aria-hidden="true" />
                <div className="janus-peek-halo halo-inner" aria-hidden="true" />
                <div className="janus-peek-eyes" aria-hidden="true">
                  <div className="janus-peek-eye left" />
                  <div className="janus-peek-eye right" />
                </div>
              </div>
              <div className="janus-peek-copy">
                <div className="janus-peek-title">{peekTitle}</div>
                <div className="janus-peek-subtitle">{peekSubtitle}</div>
              </div>
              <div className="janus-peek-pulse" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        ) : (
          <>
          <div
            className="flex justify-between items-center pb-1.5"
            style={{
              borderBottom: '1px solid color-mix(in srgb, var(--surface-tint) 5%, transparent)',
            }}
          >
            <div
              className="text-[11px] font-bold uppercase tracking-[1px] flex items-center gap-1.5 island-title"
            >
              <span>◎</span> {t('janus:expanded.engineBrand')}
            </div>
            <div className="text-[9px] text-[var(--shell-dim)]">{t('janus:expanded.dismissHint')}</div>
          </div>

          <div
            className="janus-expanded-body"
          >
            {/* CRT 区域（左栏） */}
            <div
              className={`janus-crt ${isRunning ? 'running' : ''}`}
            >
              {/* 透视网格 */}
              <div className={`warp-grid ${isRunning ? 'running' : ''}`} />

              {/* 扫描线 */}
              <div className={`scanline ${isRunning ? 'running' : ''}`} />

              {/* 像素覆盖 */}
              <div className="pixel-overlay" />

              {/* 升腾粒子 */}
              {particles.map(({ id, left, size, duration }) => (
                <div
                  key={id}
                  className="particle"
                  style={{ left: `${left}%`, width: size, height: size, animation: `float-up ${duration}s ease-in forwards` }}
                />
              ))}

              {/* 悬浮大型眼 — CSS 驱动，非 JanusEye 组件 */}
              <div className="levitation-wrapper">
                <div className={`janus-face-lg ${faceClass(mode)}`}>
                  <div className="janus-eye-lg left-eye-lg" />
                  <div className="janus-eye-lg right-eye-lg" />
                </div>
              </div>

              {/* 状态文本 */}
              <div className="janus-status-text">
                {statusText}
              </div>
            </div>

            {/* 对话界面（右栏，停靠态） */}
            <JanusChat
              visible
              docked
              modeColor={modeColor}
              messages={messages}
              pendingContent={pendingContent}
              isStreaming={isStreaming}
              error={error}
              onSend={onChatSend}
              onRewrite={onChatRewrite}
              onStop={onChatStop}
              onRetry={onChatRetry}
              onClear={onChatClear}
            />
          </div>

          {/* Footer */}
          <div
            className="flex justify-between items-center pt-1.5 text-[10px]"
            style={{
              borderTop: '1px solid color-mix(in srgb, var(--surface-tint) 5%, transparent)',
              color: 'var(--shell-dim)',
            }}
          >
            <span className="flex items-center gap-2">
              <span>{t('janus:expanded.divineProtocol')}</span>
              <button
                className="janus-chat-toggle"
                onClick={cycleView}
                style={{ color: modeColor }}
              >
                {nextViewLabel}
              </button>
            </span>
            <span className="text-[10px] font-bold tracking-[1px] island-footer-right">
              {t('janus:expanded.footerMode', { mode: modeLabel })}
            </span>
          </div>
          </>
        )}
      </div>
    </>
  )
}
