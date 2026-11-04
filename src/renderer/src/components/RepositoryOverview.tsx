import { useState } from 'react'
import { BookOpen, ExternalLink, GitBranch, Globe, Lock } from 'lucide-react'
import { Button } from '@janusx/ui'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HostedOverview, HostedTarget } from '../../../shared/ipc/hosted'
import { useI18n } from '@/i18n/useI18n'
import styles from './RepositoryPanel.module.css'
import { RepositoryImage } from './RepositoryImage'
import { hostedKey, HOSTED_TTL } from '@/lib/hosted-cache'
import { useHostedResource } from './useHostedResource'

export function RepositoryOverview({ target, refreshKey }: { target: HostedTarget; refreshKey: number }) {
  const { t } = useI18n('common')
  const { data, error: readError, loading, refresh } = useHostedResource<HostedOverview>(hostedKey(target, 'overview'), () => window.electron.hosted.overview(target), HOSTED_TTL.overview, refreshKey)
  const [openError, setOpenError] = useState('')
  const error = readError || openError
  const open = (url: string) => { void window.electron.file.openPreviewLink(url).catch(error => setOpenError(String(error))) }
  const resolveLink = (href?: string) => {
    if (!href || !data?.readme) return undefined
    try {
      const url = new URL(href, data.readme.url)
      return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
    } catch { return undefined }
  }
  return <div className={styles.scroll}>
    {error && <div className={styles.error} role="alert">{error}<Button variant="ghost" onClick={() => { setOpenError(''); void refresh() }}>{t('common:repository.retryOverview')}</Button></div>}
    {data && loading && <p className={styles.hint} role="status">{t('common:repository.refreshing')}</p>}
    {!data && !error && <p className={styles.empty} role="status">{t('common:repository.loading')}</p>}
    {data && <>
      <section className={styles.overviewSummary} aria-label={t('common:repository.overview')}>
        <p className={data.description ? styles.description : styles.hint}>{data.description || t('common:repository.noDescription')}</p>
        <dl className={styles.repoFacts}>
          <div><dt>{data.visibility === 'private' ? <Lock size={13} /> : <Globe size={13} />}{t('common:repository.visibility')}</dt><dd>{t(`common:repository.visibilityValue.${data.visibility}`)}</dd></div>
          <div><dt><GitBranch size={13} />{t('common:repository.defaultBranch')}</dt><dd>{data.defaultBranch || t('common:repository.noBranch')}</dd></div>
        </dl>
      </section>
      <section className={styles.readmeSection} aria-label="README">
        <div className={styles.readmeHeading}><span><BookOpen size={14} />README</span>{data.readme && <Button variant="ghost" aria-label={t('common:repository.openReadme')} onClick={() => open(data.readme!.url)}><ExternalLink size={14} /></Button>}</div>
        {data.readmeError ? <div className={styles.error} role="alert">{data.readmeError}<Button variant="ghost" onClick={() => void refresh()}>{t('common:repository.retryOverview')}</Button></div>
          : data.readme ? <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
            a: ({ href, children, node }) => { const url = resolveLink(href); return node?.children.some(child => child.type === 'element' && child.tagName === 'img') ? <span>{children}</span> : url ? <a href={url} onClick={event => { event.preventDefault(); open(url) }}>{children}</a> : <span>{children}</span> },
            img: ({ src, alt }) => <RepositoryImage key={String(src)} src={typeof src === 'string' ? src : ''} alt={alt ?? ''} readmeUrl={data.readme!.url} revision={data.defaultBranch!} target={target} />,
          }}>{data.readme.text}</ReactMarkdown></div> : <p className={styles.hint}>{t('common:repository.noReadme')}</p>}
      </section>
    </>}
  </div>
}
