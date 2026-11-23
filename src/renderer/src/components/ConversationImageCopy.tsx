import { useEffect, useState } from 'react'
import { Check, CircleAlert, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ConversationImages.module.css'

function encodePng(image: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image encoding unavailable')
  context.drawImage(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed')), 'image/png')
  })
}

async function clipboardPng(image: HTMLImageElement): Promise<Blob> {
  try {
    return await encodePng(image)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error
    // Copy external images when their host allows cross-origin pixel access.
    const external = new Image()
    external.crossOrigin = 'anonymous'
    external.src = image.currentSrc
    await external.decode()
    return encodePng(external)
  }
}

// Output image actions: .agents/notes/workbench/terminal-dialog-dual-mode.md
export function ConversationImageCopy({ getImage, disabled, compact }: {
  getImage(): HTMLImageElement | null | undefined
  disabled?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation('terminal')
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const feedback = status === 'copied' ? t('conversation.images.copied') : status === 'failed' ? t('conversation.images.copyFailed') : ''
  const label = feedback || t('conversation.images.copy')
  const Icon = status === 'copied' ? Check : status === 'failed' ? CircleAlert : Copy

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setStatus('idle'), 2500)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const copy = async () => {
    const image = getImage()
    if (!image?.complete || !image.naturalWidth) return
    setStatus('copying')
    const png = clipboardPng(image)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setStatus('copied')
    } catch {
      // Clipboard permission can be denied before Chromium consumes the PNG.
      void png.catch(() => {})
      setStatus('failed')
    }
  }

  return <>
    <button type="button" className={compact ? styles.inlineCopyButton : undefined} disabled={disabled || status === 'copying'}
      aria-label={label} title={label} onClick={() => void copy()}>
      <Icon size={14} aria-hidden="true" />{!compact && label}
    </button>
    <span className={styles.copyStatus} role="status">{feedback}</span>
  </>
}
