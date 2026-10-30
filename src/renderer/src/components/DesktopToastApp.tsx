import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleHelp, TriangleAlert } from 'lucide-react'
import { getTerminalPresetMeta, isTerminalPreset } from '../../../shared/terminalLaunch'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import styles from './DesktopToastApp.module.css'
import { applyThemeToDocument, getAppTheme } from '@/services/theme'

interface DesktopToastPayload {
  deliveryId?: number
  id?: string
  type?: 'completed' | 'failed' | 'attention'
  engine?: string
  title?: string
  body?: string
  terminalId?: string
  workspaceId?: string
  createdAt?: string
}

interface DesktopToastState {
  deliveryId?: number
  id: string
  type: 'completed' | 'failed' | 'attention'
  title: string
  body: string
  engine?: string
}

function normalizePayload(payload: unknown): DesktopToastState | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as DesktopToastPayload
  if (typeof record.title !== 'string' || typeof record.body !== 'string') return null

  const type =
    record.type === 'completed' || record.type === 'failed' || record.type === 'attention'
      ? record.type
      : 'attention'

  return {
    deliveryId: typeof record.deliveryId === 'number' ? record.deliveryId : undefined,
    id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
    type,
    title: record.title,
    body: record.body,
    engine: typeof record.engine === 'string' ? record.engine : undefined,
  }
}

export function DesktopToastApp() {
  const [toast, setToast] = useState<DesktopToastState | null>(null)
  const [closing, setClosing] = useState(false)
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelAction = useCallback(() => {
    if (actionTimer.current !== null) clearTimeout(actionTimer.current)
    actionTimer.current = null
  }, [])

  const sendAction = useCallback((action: 'activate' | 'dismiss') => {
    cancelAction()
    setClosing(true)
    actionTimer.current = setTimeout(() => {
      actionTimer.current = null
      window.electron.desktopToast.action(action)
      setToast(null)
      setClosing(false)
    }, 120)
  }, [cancelAction])

  useEffect(() => {
    const deliveryId = toast?.deliveryId
    if (deliveryId === undefined) return
    // The second frame runs after React's committed card has had a paint
    // opportunity. The main process rejects acknowledgements for old deliveries.
    let paintedFrame = 0
    const frame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => window.electron.desktopToast.painted(deliveryId))
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(paintedFrame)
    }
  }, [toast])

  useEffect(() => {
    document.body.classList.add('desktop-toast-body')
    // 主题统一控制：独立 Toast 窗口不经过 App 根的 theme store，自行拉取持久化主题
    // 并订阅 theme:changed（主进程 show 前也会主动推送一次，补齐后创建窗口错过广播的缺口）。
    let disposed = false
    const themeReady = getAppTheme().then((theme) => {
      if (!disposed) applyThemeToDocument(theme)
    })
    const unsubscribeTheme = window.electron?.theme?.onChanged
      ? window.electron.theme.onChanged((next) => applyThemeToDocument(next))
      : undefined
    const unsubscribeShow = window.electron.desktopToast.onShow((payload) => {
      const nextToast = normalizePayload(payload)
      if (!nextToast) return
      cancelAction()
      setClosing(false)
      setToast(nextToast)
    })
    // 主进程超时隐藏时清空旧帧：下次 show 从空透明态起笔，不闪旧内容
    const unsubscribeHide = window.electron.desktopToast.onHide(() => {
      cancelAction()
      setClosing(false)
      setToast(null)
    })
    void themeReady.then(() => {
      if (!disposed) window.electron.desktopToast.ready()
    })

    return () => {
      disposed = true
      cancelAction()
      document.body.classList.remove('desktop-toast-body')
      unsubscribeTheme?.()
      unsubscribeShow()
      unsubscribeHide()
    }
  }, [cancelAction])

  if (!toast) return <div className={styles.empty} />

  const preset = isTerminalPreset(toast.engine) ? toast.engine : 'shell'
  const engineLabel = isTerminalPreset(toast.engine)
    ? getTerminalPresetMeta(toast.engine).label
    : toast.engine || 'Agent'
  const StatusIcon = toast.type === 'completed' ? Check : toast.type === 'failed' ? TriangleAlert : CircleHelp

  // Note: standard desktop layout and restrained status colors — see .agents/notes/desktop/desktop-toast.md
  return (
    <div className={styles.viewport}>
      <section className={`${styles.toast} ${toast.type === 'failed' ? styles.failed : ''} ${closing ? styles.closing : ''}`}>
        <button
          type="button"
          className={styles.content}
          onClick={() => sendAction('activate')}
          aria-label="Open JanusX notification"
        >
          <span className={styles.kicker}>
            <TerminalPresetIcon preset={preset} className={`${styles.engineIcon} ${preset === 'codex' ? styles.codexIcon : ''}`} />
            <span className={styles.engineName}>{engineLabel}</span>
            <span className={styles.separator} aria-hidden="true" />
            <span>JanusX</span>
          </span>
          <span className={styles.title}>
            <StatusIcon className={styles.statusIcon} aria-hidden="true" strokeWidth={1.7} />
            <span className={styles.titleText}>{toast.title}</span>
          </span>
          <span className={styles.body}>{toast.body}</span>
        </button>
        <div className={styles.controlColumn}>
          <button
            type="button"
            className={styles.close}
            aria-label="Dismiss notification"
            onClick={() => sendAction('dismiss')}
          />
        </div>
      </section>
    </div>
  )
}
