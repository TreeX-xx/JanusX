import { useEffect, useRef, useState } from 'react'
import { ImageOff, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationReference } from '../../../shared/conversation-context'
import { loadLocalAssetDataUrl } from './viewers/local-asset'
import styles from './ConversationAttachment.module.css'
import imageStyles from './ConversationImages.module.css'

export function ConversationAttachment({ reference, disabled, onRemove }: {
  reference: ConversationReference; disabled: boolean; onRemove(): void
}) {
  const { t } = useTranslation('terminal')
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    void loadLocalAssetDataUrl(reference.path).then(value => {
      if (active) { setUrl(value); setFailed(!value) }
    })
    return () => { active = false }
  }, [reference.path])
  const ready = Boolean(url && !failed)
  return <div className={styles.attachment} title={reference.path}>
    <button ref={trigger} type="button" className={styles.thumbnail} disabled={!ready}
      aria-label={`${t('conversation.images.preview')}: ${reference.name}`} onClick={() => dialog.current?.showModal()}>
      {url && !failed ? <img src={url} alt={reference.name} onError={() => setFailed(true)} />
        : <span role="status"><ImageOff size={20} aria-hidden="true" />{t(failed ? 'conversation.images.unavailable' : 'conversation.images.loading')}</span>}
    </button>
    <span className={styles.name}>{reference.name}</span>
    <button type="button" className={styles.remove} disabled={disabled} aria-label={t('conversation.context.remove', { name: reference.name })} onClick={onRemove}><X size={13} /></button>
    <dialog ref={dialog} className={imageStyles.dialog} aria-label={`${t('conversation.images.preview')}: ${reference.name}`}
      onKeyDown={event => event.stopPropagation()} onClose={() => trigger.current?.focus()}
      onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
      <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label={t('conversation.images.close')}><X size={20} /></button>
      {ready && <img src={url!} alt={reference.name} />}
    </dialog>
  </div>
}
