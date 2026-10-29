import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ContainerTerminalOutput } from '@janusx/plugin-sdk'
import '@xterm/xterm/css/xterm.css'
import { call } from './bridge'
import { useLocale, errorText } from './i18n'
export function TerminalPane({ container, session, onEnded }: { container: string; session: string; onEnded(): void }) {
  const body = useRef<HTMLDivElement>(null), [ended, setEnded] = useState(false), [error, setError] = useState(''), t = useLocale()
  const onEnd = useRef(onEnded); onEnd.current = onEnded
  useEffect(() => {
    let disposed = false, cursor = 0, pending = false, input = ''
    let inputTimer: ReturnType<typeof setTimeout> | undefined
    const root = body.current!, colors = getComputedStyle(root)
    const terminal = new Terminal({ fontFamily: 'Consolas, "Cascadia Code", monospace', fontSize: 12, cursorBlink: true, scrollback: 3000,
      theme: { background: colors.getPropertyValue('--shell-canvas').trim() || '#171717', foreground: colors.getPropertyValue('--shell-text').trim() || '#dddddd' }, allowProposedApi: false })
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(root)
    const theme = new MutationObserver(() => {
      const colors = getComputedStyle(root)
      terminal.options.theme = { background: colors.getPropertyValue('--shell-canvas').trim(), foreground: colors.getPropertyValue('--shell-text').trim() }
    })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    const resize = () => { if (!root.clientWidth || !root.clientHeight) return; fit.fit(); void call('terminal.resize', { container, id: session, cols: Math.min(500, Math.max(2, terminal.cols)), rows: Math.min(200, Math.max(1, terminal.rows)) }).catch(() => {}) }
    const observer = new ResizeObserver(resize); observer.observe(root); resize()
    const flushInput = () => {
      inputTimer = undefined
      const data = input.slice(0, 16 * 1024); input = input.slice(data.length)
      if (data) void call('terminal.write', { container, id: session, data }).catch(cause => { if (!disposed) setError(errorText(cause)) })
      if (input && !disposed) inputTimer = setTimeout(flushInput, 75)
    }
    terminal.onData(data => { input = (input + data).slice(0, 256 * 1024); inputTimer ??= setTimeout(flushInput, 75) })
    const poll = async () => {
      if (pending || disposed) return; pending = true
      try {
        const output = await call<ContainerTerminalOutput>('terminal.read', { container, id: session, cursor })
        if (!disposed) {
          if (output.truncated) { terminal.reset(); terminal.writeln(t('truncated')) }
          terminal.write(output.data); cursor = output.cursor
          if (output.exited) { setEnded(true); onEnd.current(); clearInterval(timer) }
        }
      } catch (cause) { if (!disposed) {
        setError(errorText(cause))
        if (!(cause instanceof Error && ['RATE_LIMITED', 'STALE_CONTEXT'].includes(cause.message))) { setEnded(true); clearInterval(timer); onEnd.current() }
      } }
      finally { pending = false }
    }
    const timer = setInterval(() => { void poll() }, 200); void poll(); terminal.focus()
    return () => { disposed = true; clearInterval(timer); if (inputTimer) clearTimeout(inputTimer); if (input) flushInput(); observer.disconnect(); theme.disconnect(); terminal.dispose() }
  }, [container, session])
  return <div className="terminal-pane"><div className="xterm-body" ref={body}/>{ended && <p className="hint" role="status">{t('ended')} · {t('shellMissing')}</p>}{error && <p role="alert" className="error-text">{error}</p>}</div>
}
