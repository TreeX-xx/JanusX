import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SuperAgentWorkDetail, SuperAgentSnapshot } from '../../../../shared/superagent'

/** Reads only committed records. Key this component by workspace when changing its scope. */
export function SuperAgentHistory({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('janus')
  const api = window.electron.superAgent
  const [records, setRecords] = useState<SuperAgentSnapshot>()
  const [workId, setWorkId] = useState('')
  const [detail, setDetail] = useState<SuperAgentWorkDetail>()
  const [resource, setResource] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    void api?.snapshot(workspaceId).then(value => { if (current) setRecords(value) })
      .catch(reason => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [api, workspaceId])
  useEffect(() => {
    let current = true
    if (workId) void api?.workDetail(workspaceId, workId).then(value => { if (current) setDetail(value) })
      .catch(reason => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [api, workspaceId, workId])
  useEffect(() => {
    let current = true
    if (resource) void api?.readResource(workspaceId, resource).then(value => { if (current) setBody(value.text) })
      .catch(reason => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [api, workspaceId, resource])
  return <section aria-label={t('superagent.history')}>
    {error && <p role="alert">{error}</p>}
    {records?.works.length === 0 && <p>{t('superagent.emptyHistory')}</p>}
    {records?.works.map(work => <p key={work.id}><button type="button" aria-expanded={workId === work.id} onClick={() => {
      setDetail(undefined); setResource(''); setBody(''); setError(''); setWorkId(workId === work.id ? '' : work.id)
    }}>{work.title}</button></p>)}
    {detail && <article><h3>{detail.work.title}</h3><p>{detail.work.goal}</p>
      {detail.resources.map(row => <p key={row.id}><button type="button" onClick={() => {
        if (row.id !== resource) { setBody(''); setError(''); setResource(row.id) }
      }}>{t(row.kind === 'input' ? 'superagent.historyInput' : 'superagent.historyReport')} · {new Date(row.createdAt).toLocaleString()}</button></p>)}
      {body && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</pre>}
    </article>}
  </section>
}
