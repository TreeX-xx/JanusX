import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { useI18n } from '@/i18n/useI18n'
import './WindowControls.css'

// Note: .agents/notes/desktop/window-controls.md
export function WindowControls({ onClose }: { onClose?: () => void }) {
  const { t } = useI18n('common')
  const mac = window.electron.platform === 'darwin'
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.electron.window
    let active = true
    let receivedEvent = false
    const unsubscribe = api.onMaximizedChanged?.((value) => {
      receivedEvent = true
      setMaximized(value)
    })
    void api.getMaximized?.().then((value) => {
      if (active && !receivedEvent) setMaximized(value)
    }).catch(() => {})
    return () => { active = false; unsubscribe?.() }
  }, [])

  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    if (!mac) return
    const api = window.electron.window
    let acceptInitial = true
    const unsubscribe = api.onFocusChanged(value => {
      acceptInitial = false
      setFocused(value)
    })
    void api.getFocused().then(value => { if (acceptInitial) setFocused(value) }).catch(() => {})
    return () => { acceptInitial = false; unsubscribe() }
  }, [mac])

  const zoomIcon = mac
    ? <svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
        <path d={maximized ? 'M1 5h4V1z M9 5H5v4z' : 'M1 1h5L1 6z M9 9H4l5-5z'} />
      </svg>
    : maximized ? <Copy /> : <Square />
  const controls = {
    close: { label: t('common:trafficLight.close'), icon: <X />, action: onClose ?? (() => { void window.electron.window.close() }) },
    minimize: { label: t('common:trafficLight.minimize'), icon: <Minus />, action: () => { void window.electron.window.minimize() } },
    maximize: { label: t(maximized ? 'common:trafficLight.restore' : 'common:trafficLight.maximize'), icon: zoomIcon, action: () => { void window.electron.window.maximize() } },
  }
  const order = mac ? ['close', 'minimize', 'maximize'] as const : ['minimize', 'maximize', 'close'] as const
  return (
    <div className="window-controls" data-platform={mac ? 'mac' : 'windows'} data-maximized={maximized} data-focused={mac ? focused : undefined}>
      {order.map((key) => (
        <button key={key} type="button" data-window-action={key} aria-label={controls[key].label}
          title={controls[key].label} onClick={controls[key].action}>
          <span aria-hidden="true">{controls[key].icon}</span>
        </button>
      ))}
    </div>
  )
}
