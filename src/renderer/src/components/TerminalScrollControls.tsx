import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { focusTerminal, scrollTerminalPage, subscribeTerminalNavigation, terminalViewportState } from '@/lib/terminal-navigation'
import { useI18n } from '@/i18n/useI18n'

// Note: .agents/notes/terminal/terminal-scrollback-navigation.md
export function TerminalScrollControls({ terminalId, focused }: { terminalId: string; focused: boolean }) {
  const { t } = useI18n('terminal')
  const viewport = useSyncExternalStore(subscribeTerminalNavigation, () => terminalViewportState(terminalId))
  const delay = useRef<ReturnType<typeof setTimeout>>()
  const repeat = useRef<ReturnType<typeof setInterval>>()
  const pressed = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const stop = useCallback(() => {
    clearTimeout(delay.current)
    clearInterval(repeat.current)
    pressed.current = false
    root.current?.removeAttribute('data-scrolling')
  }, [])

  useEffect(() => {
    const hidden = () => { if (document.hidden) stop() }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      stop()
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [stop])
  useEffect(() => { if (!focused) stop() }, [focused, stop])

  return <div ref={root} className="terminal-scroll-controls" data-terminal-scroll={terminalId}
    role="group" aria-label={t('terminal:navigation.controls')}>
    {([-1, 1] as const).map(direction => {
      const label = t(direction < 0 ? 'terminal:navigation.up' : 'terminal:navigation.down')
      const Icon = direction < 0 ? ChevronUp : ChevronDown
      return <button key={direction} type="button" aria-label={label}
        title={`${label} · ${t('terminal:navigation.hold')}`} disabled={direction < 0 ? !viewport.canUp : !viewport.canDown}
        onMouseDown={event => event.preventDefault()}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          stop()
          pressed.current = true
          root.current?.setAttribute('data-scrolling', direction < 0 ? 'up' : 'down')
          event.currentTarget.setPointerCapture(event.pointerId)
          focusTerminal(terminalId)
          scrollTerminalPage(terminalId, direction)
          delay.current = setTimeout(() => {
            repeat.current = setInterval(() => {
              if (!root.current?.checkVisibility({ visibilityProperty: true })) { stop(); return }
              scrollTerminalPage(terminalId, direction)
            }, 120)
          }, 320)
        }}
        onLostPointerCapture={stop}
        onClick={event => {
          // Pointer activation already scrolls on press. Keyboard/assistive activation clicks once.
          if (event.detail === 0 && !pressed.current) scrollTerminalPage(terminalId, direction)
        }}>
        <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>
    })}
  </div>
}
