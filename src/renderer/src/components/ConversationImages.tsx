import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationImage } from '../../../shared/conversation-display'
import { loadLocalAssetDataUrl } from './viewers/local-asset'
import styles from './ConversationImages.module.css'

export function ConversationImages({ terminalId, itemId, images, canReference, onReference }: {
  terminalId: string; itemId: string; images: ConversationImage[]; canReference: boolean
  onReference(image: ConversationImage): void
}) {
  return <div className={styles.gallery}>{images.map((image, index) => <ImageCard key={`${image.id}:${index}`} {...{ terminalId, itemId, image, canReference, onReference }} />)}</div>
}
function ImageCard({ terminalId, itemId, image, canReference, onReference }: {
  terminalId: string; itemId: string; image: ConversationImage; canReference: boolean; onReference(image: ConversationImage): void
}) {
  const { t } = useTranslation('terminal')
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [visible, setVisible] = useState(false)
  const card = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '300px' })
    if (card.current) observer.observe(card.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    if (visible && image.status === 'ready' && image.path) void loadLocalAssetDataUrl(image.path).then(value => {
      if (active) { setUrl(value); setFailed(!value) }
    })
    return () => { active = false }
  }, [image.path, image.status, visible])
  const ready = image.status === 'ready' && url && !failed
  const save = async () => {
    setSaving(true); setError('')
    try { await window.electron.terminal.saveConversationImage!(terminalId, itemId, image.id) }
    catch (error) { setError(String(error)) }
    finally { setSaving(false) }
  }
  return <figure ref={card} className={styles.card}>
    {ready ? <button type="button" className={styles.preview} onClick={() => dialog.current?.showModal()} aria-label={t('conversation.images.preview')}>
      <img src={url} alt={t('conversation.images.result')} onError={() => setFailed(true)} />
    </button> : <p role="status" title={image.error}>{t(image.status === 'unavailable' || failed ? 'conversation.images.unavailable' : 'conversation.images.loading')}</p>}
    <figcaption className={styles.actions}>
      <button type="button" disabled={!ready || saving || !window.electron.terminal.saveConversationImage} onClick={() => void save()}><Download size={14} />{t('conversation.images.save')}</button>
      <button type="button" disabled={!ready || !canReference} onClick={() => onReference(image)}><ImagePlus size={14} />{t('conversation.images.reference')}</button>
    </figcaption>
    {error && <p role="alert">{error}</p>}
    <dialog ref={dialog} className={styles.dialog} aria-label={t('conversation.images.preview')} onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
      <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label={t('conversation.images.close')}><X size={20} /></button>
      {ready && <img src={url} alt={t('conversation.images.result')} />}
    </dialog>
  </figure>
}
