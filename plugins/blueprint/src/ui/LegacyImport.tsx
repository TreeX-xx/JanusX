import { useState } from 'react'
import { call } from './client'
import { t } from './i18n'
import { WorkbenchPopover } from './WorkbenchPopover'

type Source = { id: string; name: string; nodes?: number; error?: string }
type Preview = { token: string; notes: Array<{ uri: string; title: string; kind: string }>; warnings: string[];
  documents: Array<{ relativePath: string; markdown: string }> }

export function LegacyImport({ changed }: { changed(): void }) {
  const [loaded, setLoaded] = useState(false), [sources, setSources] = useState<Source[]>([])
  const [preview, setPreview] = useState<Preview>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await work() } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <WorkbenchPopover label={t('导入旧蓝图')}>
    <button type="button" className="blueprint-btn" disabled={busy} onClick={() => {
      void run(async () => { setPreview(undefined); setSources(await call('legacy.list')); setLoaded(true) })
    }}>{t('读取旧蓝图')}</button>
    <div>
      <p>{t('预览后确认转换为当前项目的 Notes。原始旧数据保留，不自动执行历史任务。')}</p>
      {loaded && !busy && !sources.length && <p>{t('没有待导入的旧蓝图。')}</p>}
      {sources.map(source => <div key={source.id}>
        <button type="button" className="blueprint-btn" disabled={busy || !!source.error} onClick={() => void run(async () => setPreview(await call('legacy.preview', source.id)))}>{source.name} · {source.nodes ?? 0}</button>
        {source.error && <p role="alert">{source.error}</p>}
      </div>)}
      {preview && <div>
        <ul>{preview.notes.map(note => <li key={note.uri}>{note.kind} · {note.title}</li>)}</ul>
        {preview.documents.map(document => <details key={document.relativePath}>
          <summary>{document.relativePath}</summary>
          <pre>{document.markdown}</pre>
        </details>)}
        {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        <button type="button" className="blueprint-btn" disabled={busy} onClick={() => {
          const token = preview.token
          setPreview(undefined)
          void run(async () => { await call('legacy.apply', token); setSources(await call('legacy.list')); changed() })
        }}>{t('确认导入')}</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">{t('正在处理…')}</p>}
    </div>
  </WorkbenchPopover>
}
