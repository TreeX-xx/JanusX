import { useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { Button } from '@janusx/ui'
import { ModalFrame } from './shared/ModalFrame'
import { HostedConnectionNotice } from './HostedConnectionNotice'
import { useHostedStore } from '@/stores/hosted'
import { useRightToolStore } from '@/stores/right-tools'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from '@/i18n/useI18n'
import type { HostedConnection } from '../../../shared/ipc/hosted'
import '@xterm/xterm/css/xterm.css'
import styles from './RepositoryPanel.module.css'

function LoginSession({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useI18n('common')
  const host = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [connection, setConnection] = useState<HostedConnection | null>(null)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState(false)
  const [started, setStarted] = useState(false)
  const complete = useRef(() => {})
  complete.current = () => {
    if (useHostedStore.getState().loginPath !== path) return
    useHostedStore.getState().authorized()
    const state = useWorkspaceStore.getState()
    if (state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.path === path) useRightToolStore.getState().openTool('repository')
  }
  useEffect(() => {
    let alive = true
    let id: string | undefined
    let terminal: Terminal | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: ResizeObserver | undefined
    let previousOutput = ''
    setError(''); setFinished(false); setStarted(false)
    const check = async () => {
      const status = await useHostedStore.getState().refresh(path)
      if (!alive) return
      setConnection(status)
      if (status?.status === 'ready') complete.current()
    }
    const start = async () => {
      const status = await useHostedStore.getState().refresh(path)
      if (!alive) return
      setConnection(status)
      if (status?.status === 'ready') { complete.current(); return }
      if (!status) { setError(t('common:repository.unsupported')); setFinished(true); return }
      if (status.status === 'cli-missing') return
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
      if (!alive || !host.current) return
      const style = getComputedStyle(host.current)
      terminal = new Terminal({ cols: 76, rows: 16, fontSize: 12, cursorBlink: true, scrollback: 500,
        theme: { background: style.getPropertyValue('--shell-canvas').trim(), foreground: style.getPropertyValue('--shell-text').trim() } })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(host.current)
      const session = await window.electron.hosted.loginStart(path)
      id = session.id
      if (!alive) { await window.electron.hosted.loginStop(id); return }
      const resize = () => { fit.fit(); if (id && terminal) window.electron.terminal.resize(id, terminal.cols, terminal.rows) }
      observer = new ResizeObserver(resize); observer.observe(host.current); resize()
      setStarted(true)
      terminal.onData(data => { if (id) void window.electron.hosted.loginInput(id, data).catch(err => { if (alive) setError(String(err)) }) })
      terminal.focus()
      const poll = async () => {
        if (!alive || !id) return
        try {
          const next = await window.electron.hosted.loginRead(id)
          if (!alive) return
          if (!next.output.startsWith(previousOutput)) { terminal?.reset(); previousOutput = '' }
          terminal?.write(next.output.slice(previousOutput.length)); previousOutput = next.output
          if (next.finished) { setFinished(true); await check(); return }
          timer = setTimeout(() => void poll(), 400)
        } catch (err) { if (alive) { setError(String(err)); setFinished(true) } }
      }
      await poll()
    }
    void start().catch(err => { if (alive) { setError(String(err)); setFinished(true) } })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      observer?.disconnect()
      terminal?.dispose()
      if (id) void window.electron.hosted.loginStop(id).catch(() => {})
    }
  }, [path, attempt, t])
  return <>
    <div className={styles.loginHeader}><strong>{t('common:repository.signIn')}</strong><Button variant="ghost" onClick={onClose}>{t('common:action.close')}</Button></div>
    <p>{t('common:repository.loginHelp')}</p>
    {connection?.status === 'cli-missing' && <HostedConnectionNotice connection={connection} onRetry={() => setAttempt(value => value + 1)} />}
    <div ref={host} className={styles.loginTerminal} style={{ display: connection?.status === 'cli-missing' ? 'none' : undefined }} />
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {finished && <p role="status">{t('common:repository.loginEnded')}</p>}
    <div className={styles.actions}>
      <Button variant="secondary" onClick={() => { void useHostedStore.getState().refresh(path).then(status => { if (status?.status === 'ready') complete.current(); else setConnection(status) }).catch(err => setError(String(err))) }}>{t('common:hosted.retry')}</Button>
      {finished && <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>{t('common:repository.tryAgain')}</Button>}
      {!started && !finished && !connection && <span role="status">{t('common:repository.loading')}</span>}
    </div>
  </>
}

export function HostedLoginDialog() {
  const path = useHostedStore(state => state.loginPath)
  const { t } = useI18n('common')
  if (!path) return null
  return <ModalFrame label={t('common:repository.signIn')} onClose={() => useHostedStore.getState().signIn(null)} panelClassName={styles.loginPanel}>
    {({ requestClose }) => <LoginSession key={path} path={path} onClose={requestClose} />}
  </ModalFrame>
}
