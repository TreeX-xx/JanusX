import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@janusx/ui'
import type { HostedTarget } from '../../../shared/ipc/hosted'
import { useI18n } from '@/i18n/useI18n'
import { resolveRepositoryImage } from '@/lib/repository-image'
import styles from './RepositoryPanel.module.css'
import { hostedCache, hostedKey, HOSTED_TTL } from '@/lib/hosted-cache'

export function RepositoryImage({ src, alt, readmeUrl, revision, target }: { src: string; alt: string; readmeUrl: string; revision: string; target: HostedTarget }) {
  const { t } = useI18n('common')
  const holder = useRef<HTMLSpanElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [openError, setOpenError] = useState(false)
  const resource = resolveRepositoryImage(src, readmeUrl, target.repositoryKey, revision)
  const resourceUrl = resource?.url
  const path = resource?.path
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    if (holder.current) observer.observe(holder.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let alive = true
    setUrl(''); setLoaded(false); setFailed(false)
    if (visible) {
      if (!resourceUrl) setFailed(true)
      else if (path) void hostedCache.load(hostedKey(target, 'image', path, revision), () => window.electron.hosted.image(target, path, revision), HOSTED_TTL.image, retry > 0).then(url => { if (alive) setUrl(url) }).catch(() => { if (alive) setFailed(true) })
      else setUrl(resourceUrl)
    }
    return () => { alive = false }
  }, [visible, path, resourceUrl, revision, target, retry])
  const openOriginal = () => {
    if (resourceUrl) void window.electron.file.openPreviewLink(resourceUrl).catch(() => setOpenError(true))
  }
  return <span ref={holder} className={styles.readmeImage}>
    {url && !failed && <button type="button" className={styles.imagePreview} disabled={!loaded} aria-label={t('common:repository.previewImage', { name: alt || t('common:repository.image') })} onClick={() => dialog.current?.showModal()}>
      <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </button>}
    {(!loaded || failed) && <span className={styles.imagePlaceholder}>{alt && <span>{alt} · </span>}{t(failed ? 'common:repository.imageFailed' : 'common:repository.imageLoading')}
      {failed && <><Button variant="ghost" onClick={() => setRetry(value => value + 1)}>{t('common:repository.retryOverview')}</Button>{resourceUrl && <Button variant="ghost" onClick={openOriginal}>{t('common:repository.openImage')}</Button>}</>}
    </span>}
    {openError && <span role="alert">{t('common:repository.imageOpenFailed')}</span>}
    {createPortal(<dialog ref={dialog} className={styles.imageDialog} aria-label={alt || t('common:repository.image')} onClick={event => { if (event.target === dialog.current) dialog.current.close() }}>
      <div className={styles.imageDialogToolbar}><Button variant="ghost" onClick={openOriginal}>{t('common:repository.openImage')}</Button><Button variant="ghost" autoFocus aria-label={t('common:repository.closeImage')} onClick={() => dialog.current?.close()}><X size={18} /></Button></div>
      {loaded && !failed && <img src={url} alt={alt} referrerPolicy="no-referrer" />}
    </dialog>, document.body)}
  </span>
}
