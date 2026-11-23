import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ConversationImages.module.css'

interface ImagePreviewRequest {
  src: string
  alt: string
  restoreFocus(): void
}

const ImagePreviewContext = createContext<((request: ImagePreviewRequest) => void) | null>(null)

export function ConversationImagePreviewScope({ scopeKey, active = true, children }: { scopeKey: string; active?: boolean; children: ReactNode }) {
  const [request, setRequest] = useState<(ImagePreviewRequest & { scopeKey: string }) | null>(null)
  const open = useCallback((image: ImagePreviewRequest) => setRequest({ ...image, scopeKey }), [scopeKey])
  useEffect(() => { setRequest(null) }, [scopeKey, active])
  return <ImagePreviewContext.Provider value={open}>
    {children}
    {active && request?.scopeKey === scopeKey && <ConversationImagePreview {...request} onClose={() => setRequest(null)} />}
  </ImagePreviewContext.Provider>
}

export function useConversationImagePreview() {
  const openInScope = useContext(ImagePreviewContext)
  const [image, setImage] = useState<ImagePreviewRequest | null>(null)
  const open = (src: string, alt: string, trigger: HTMLButtonElement) => {
    // A live reply can become a history row while the modal remains open.
    const transcript = trigger.closest<HTMLElement>('.janus-chat, [role="region"]')
    ;(openInScope ?? setImage)({ src, alt, restoreFocus: () => {
      (trigger.isConnected ? trigger : transcript)?.focus({ preventScroll: true })
    } })
  }
  return { open, preview: image && <ConversationImagePreview {...image} onClose={() => setImage(null)} /> }
}

function ConversationImagePreview({ src, alt, restoreFocus, onClose }: ImagePreviewRequest & { onClose(): void }) {
  const { t } = useTranslation('terminal')
  const dialog = useRef<HTMLDialogElement>(null)
  const [original, setOriginal] = useState(false)

  useLayoutEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [])

  return createPortal(
    <dialog ref={dialog} className={`${styles.dialog} ${styles.outputDialog}`} aria-label={t('conversation.images.preview')}
      onClose={event => { event.stopPropagation(); onClose(); restoreFocus() }} onCancel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
      <button type="button" className={styles.scale} onClick={() => setOriginal(value => !value)}>
        {t(original ? 'conversation.images.fitWindow' : 'conversation.images.actualSize')}
      </button>
      <button type="button" autoFocus aria-label={t('conversation.images.close')} onClick={() => dialog.current?.close()}><X size={18} /></button>
      <div className={original ? styles.original : undefined} tabIndex={original ? 0 : undefined}><img src={src} alt={alt} /></div>
    </dialog>, document.body,
  )
}
