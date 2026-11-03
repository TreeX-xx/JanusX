// Note: .agents/notes/workbench/local-skills-mcp.md
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronRight, CircleCheck, FileCode2, FolderOpen, Monitor, Plus, RefreshCw, Search, Server, X } from 'lucide-react'
import { Button, Input, InputGroup } from '@janusx/ui'
import { useI18n } from '@/i18n/useI18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { Select } from './ui/Select'
import { LOCAL_INTEGRATION_CLIENTS, type LocalIntegrationClient, type LocalIntegrationKind, type LocalIntegrationCatalog, type LocalIntegrationDocument, type LocalIntegrationQuery, type LocalIntegrationProbe, type LocalIntegrationSource } from '../../../shared/local-integrations'
import styles from './LocalIntegrationsPanel.module.css'

const clientNames: Record<LocalIntegrationClient, string> = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', janus: 'Janus' }
const EMPTY: LocalIntegrationCatalog = { entries: [], sources: [], scannedAt: '', limited: false }
const api = () => { if (!window.electron?.localIntegrations) throw new Error('local-only'); return window.electron.localIntegrations }

export function LocalIntegrationsPanel({ initialWorkspaceId, onManagePlugins }: { initialWorkspaceId?: string; onManagePlugins: () => void }) {
  const { t } = useI18n('integrations')
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const [scope, setScope] = useState(initialWorkspaceId ? `workspace:${initialWorkspaceId}` : 'user')
  const [client, setClient] = useState<LocalIntegrationClient>('codex')
  const [kind, setKind] = useState<LocalIntegrationKind>('skill')
  const [search, setSearch] = useState('')
  const [catalog, setCatalog] = useState<LocalIntegrationCatalog>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [document, setDocument] = useState<LocalIntegrationDocument | null>(null)
  const [reading, setReading] = useState(false)
  const [editor, setEditor] = useState<{ source: LocalIntegrationSource; entryId?: string; revision: string; name: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [probe, setProbe] = useState<LocalIntegrationProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const generation = useRef(0)
  const selectionGeneration = useRef(0)
  const query = useMemo<LocalIntegrationQuery>(() => ({ client, scope: scope === 'user' ? 'user' : 'workspace', ...(scope.startsWith('workspace:') ? { workspaceId: scope.slice(10) } : {}) }), [client, scope])
  const failure = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    const codes = ['invalid-config', 'invalid-server', 'invalid-skill', 'invalid-name', 'changed', 'read-only', 'read-failed', 'entry-missing', 'already-exists', 'workspace-unavailable', 'local-only', 'toml-layout', 'missing-env', 'probe-busy', 'file-limit', 'encoding', 'invalid-request']
    const code = codes.find(code => message.includes(code)) ?? 'unknown'
    return t(`errors.${code}`)
  }, [t])
  const refresh = useCallback(async () => {
    const current = ++generation.current
    selectionGeneration.current++; setReading(false)
    setLoading(true); setError(''); setDocument(null); setSelected(null); setProbe(null)
    try {
      const data = await api().scan(query)
      if (current === generation.current) setCatalog(data)
    } catch (cause) { if (current === generation.current) { setCatalog(EMPTY); setError(failure(cause)) } }
    finally { if (current === generation.current) setLoading(false) }
  }, [query, failure])
  const invalidate = useCallback(() => { generation.current++; selectionGeneration.current++ }, [])
  useEffect(() => { setEditor(null); setSaved(false); void refresh(); return invalidate }, [refresh, invalidate])
  const entries = catalog.entries.filter(entry => entry.kind === kind && `${entry.name} ${entry.description} ${entry.path}`.toLowerCase().includes(search.toLowerCase()))
  const sources = catalog.sources.filter(source => source.kind === kind)
  const addSources = sources.filter(source => source.writable && (query.scope === 'user' ? source.scope === 'user' : source.scope === 'workspace' || source.scope === 'private')).sort((a, b) => Number(b.exists) - Number(a.exists))
  const total = catalog.entries.filter(entry => entry.kind === kind).length
  const locked = Boolean(editor || saving || probing)
  const choose = async (id: string) => {
    const current = ++selectionGeneration.current
    setSelected(id); setDocument(null); setReading(true); setError(''); setProbe(null); setSaved(false)
    try { const data = await api().read(query, id); if (current === selectionGeneration.current) setDocument(data) }
    catch (cause) { if (current === selectionGeneration.current) setError(failure(cause)) }
    finally { if (current === selectionGeneration.current) setReading(false) }
  }
  const add = () => {
    const source = addSources[0]
    if (!source) return
    selectionGeneration.current++; setReading(false)
    setSelected(null); setDocument(null); setError(''); setSaved(false); setProbe(null)
    setEditor({ source, name: '', revision: source.revision, content: kind === 'skill' ? `---\nname: my-skill\ndescription: ${t('skillExampleDescription')}\n---\n\n${t('skillExampleBody')}\n` : JSON.stringify(client === 'opencode' ? { type: 'local', command: ['node', '/path/to/server.js'], enabled: true } : { command: 'node', args: ['/path/to/server.js'] }, null, 2) })
  }
  const save = async () => {
    if (!editor) return
    setSaving(true); setError('')
    try {
      const data = await api().save({ query, sourceId: editor.source.id, entryId: editor.entryId, name: editor.name, content: editor.content, expectedRevision: editor.revision })
      setEditor(null); await refresh(); setSelected(data.entry.id); setDocument(data); setSaved(true)
    } catch (cause) { setError(failure(cause)) }
    finally { setSaving(false) }
  }
  const test = async () => {
    if (!document) return
    setProbing(true); setProbe(null); setError('')
    try { setProbe(await api().probe(query, document.entry.id, document.revision)) }
    catch (cause) { setError(failure(cause)) }
    finally { setProbing(false) }
  }
  return <section className={styles.panel} aria-label={t('title')}>
    <div className={styles.context}>
      <label><span>{t('scope')}</span><Select value={scope} onChange={setScope} disabled={locked} ariaLabel={t('scope')}
        options={[{ value: 'user', label: t('userScope') }, ...workspaces.filter(workspace => !workspace.runtime || workspace.runtime.kind === 'windows').map(workspace => ({ value: `workspace:${workspace.id}`, label: workspace.name }))]} /></label>
      <label><span>{t('client')}</span><Select value={client} onChange={value => setClient(value as LocalIntegrationClient)} disabled={locked} ariaLabel={t('client')} options={LOCAL_INTEGRATION_CLIENTS.map(value => ({ value, label: clientNames[value] }))} /></label>
      <span className={styles.environment}><Monitor size={14} />{t('localEnvironment')}</span>
    </div>
    <div className={styles.tabs} role="tablist" aria-label={t('type')}>
      {(['skill', 'mcp'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} disabled={locked} onClick={() => { setKind(value); setSelected(null); setDocument(null); setProbe(null); setSearch(''); setError(''); setSaved(false); setReading(false); selectionGeneration.current++ }}>
        {value === 'skill' ? <BookOpen size={16} /> : <Server size={16} />} {value === 'skill' ? 'Skills' : 'MCP'}<span>{catalog.entries.filter(entry => entry.kind === value).length}</span>
      </button>)}
    </div>
    <div className={styles.toolbar}>
      <InputGroup as="label" className={styles.search}><Search size={15} /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder={t('search')} aria-label={t('search')} disabled={Boolean(editor)} /></InputGroup>
      <Button variant="ghost" size="icon" disabled={loading || locked} aria-label={t('refresh')} title={t('refresh')} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? styles.spinning : undefined} /></Button>
      <Button variant="primary" disabled={loading || locked || !addSources.length} onClick={add}><Plus size={15} />{t(kind === 'skill' ? 'addSkill' : 'addMcp')}</Button>
    </div>
    <p className={styles.caption}>{t(query.scope === 'user' ? 'userHint' : 'workspaceHint')}</p>
    {client === 'janus' && <p className={styles.notice}>{t('janusHint')} <button type="button" onClick={onManagePlugins}>{t('managePlugins')}</button></p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {saved && <p className={styles.success} role="status"><CircleCheck size={14} />{t('saved')}</p>}
    <div className={`${styles.browser} ${selected || editor ? styles.hasDetail : ''}`}>
      <div className={styles.list} aria-label={t('list')} aria-busy={loading}>
        {loading ? <div className={styles.empty}>{t('scanning')}</div> : entries.length ? entries.map(entry => <button type="button" key={entry.id} className={`${styles.entry} ${selected === entry.id ? styles.selected : ''}`} disabled={locked} aria-pressed={selected === entry.id} onClick={() => void choose(entry.id)}>
          <span className={styles.entryIcon}>{kind === 'skill' ? <BookOpen size={17} /> : <Server size={17} />}</span>
          <span className={styles.entryMain}><strong>{entry.name}</strong><span>{entry.description || t('noDescription')}</span><small>{t(`origin.${entry.scope}`)}{entry.inherited ? ` · ${t('inherited')}` : ''}</small></span>
          <span className={styles.state} data-state={entry.state}>{t(`state.${entry.state}`)}</span><ChevronRight size={14} />
        </button>) : <div className={styles.empty}><span>{kind === 'skill' ? <BookOpen size={26} /> : <Server size={26} />}</span><strong>{t(search ? 'noMatch' : 'empty')}</strong><p>{t(search ? 'searchHint' : 'emptyHint')}</p></div>}
      </div>
      {(selected || editor) && <aside className={styles.detail} aria-label={t('details')}>
        <div className={styles.detailHeader}><span>{editor ? t(editor.entryId ? 'edit' : kind === 'skill' ? 'addSkill' : 'addMcp') : t('details')}</span><Button variant="ghost" size="icon" disabled={saving || probing} aria-label={t('closeDetails')} onClick={() => { selectionGeneration.current++; setReading(false); setSelected(null); setDocument(null); setEditor(null); setError(''); setSaved(false) }}><X size={15} /></Button></div>
        {reading && !editor ? <p className={styles.caption}>{t('loading')}</p> : editor ? <form onSubmit={event => { event.preventDefault(); void save() }} className={styles.editor}>
          {!editor.entryId && <label>{t('saveTo')}<Select ariaLabel={t('saveTo')} value={editor.source.id} disabled={saving} onChange={value => { const source = addSources.find(item => item.id === value)!; setEditor({ ...editor, source, revision: source.revision }) }} options={addSources.map(source => ({ value: source.id, label: `${t(`origin.${source.scope}`)} · ${source.path}` }))} /></label>}
          <label>{t('name')}<Input value={editor.name} disabled={saving || Boolean(editor.entryId)} placeholder={kind === 'skill' ? 'my-skill' : 'my-server'} onChange={event => {
            const name = event.target.value
            setEditor({ ...editor, name, content: !editor.entryId && kind === 'skill' ? editor.content.replace(/(^---\r?\nname:\s*)[^\r\n]*/, `$1${name}`) : editor.content })
          }} /></label>
          <label>{t(kind === 'skill' ? 'skillContent' : 'mcpContent')}<textarea value={editor.content} onChange={event => setEditor({ ...editor, content: event.target.value })} spellCheck={false} disabled={saving} rows={14} /></label>
          <p className={styles.path}>{editor.entryId ? document?.entry.path : editor.source.path}</p>
          <p className={styles.caption}>{t(kind === 'skill' ? 'skillEditHint' : 'mcpEditHint')}</p>
          <div className={styles.actions}><Button variant="ghost" disabled={saving} onClick={() => { setEditor(null); setError('') }}>{t('cancel')}</Button><Button variant="primary" type="submit" disabled={saving || !editor.name.trim() || !editor.content.trim()}>{t(saving ? 'saving' : 'save')}</Button></div>
        </form> : document && <>
          <h3>{document.entry.name}</h3><p className={styles.description}>{document.entry.description}</p>
          <dl className={styles.facts}><div><dt>{t('source')}</dt><dd>{t(`origin.${document.entry.scope}`)}{document.entry.inherited ? ` · ${t('inherited')}` : ''}</dd></div><div><dt>{t('status')}</dt><dd>{t(`state.${document.entry.state}`)}</dd></div>{document.entry.transport && <div><dt>{t('transport')}</dt><dd>{document.entry.transport.toUpperCase()}</dd></div>}</dl>
          <p className={styles.path}>{document.entry.path}</p>
          {document.entry.issue && <p className={styles.error}>{failure(new Error(document.entry.issue))}</p>}
          {document.entry.state === 'duplicate' && <p className={styles.notice}>{t('duplicateHint')}</p>}
          <div className={styles.actions}>
            <Button variant="ghost" disabled={probing} onClick={() => void api().reveal(query, document.entry.id).catch(cause => setError(failure(cause)))}><FolderOpen size={14} />{t('reveal')}</Button>
            {document.entry.pluginId ? <Button variant="ghost" onClick={onManagePlugins}>{t('managePlugins')}</Button> : <Button variant="ghost" disabled={!document.entry.writable || probing} onClick={() => { const source = catalog.sources.find(item => item.id === document.entry.sourceId)!; setEditor({ source, entryId: document.entry.id, name: document.entry.kind === 'skill' ? document.entry.path.split(/[/\\]/).at(-2)! : document.entry.name, content: document.content, revision: document.revision }); setSaved(false) }}><FileCode2 size={14} />{t('edit')}</Button>}
          </div>
          {kind === 'skill' ? <pre className={styles.content}>{document.content}</pre> : <>
            <p className={styles.caption}>{t('probeHint')}</p>
            <Button disabled={probing || ['invalid', 'disabled'].includes(document.entry.state)} onClick={() => void test()}><RefreshCw size={14} className={probing ? styles.spinning : undefined} />{t(probing ? 'probing' : 'probe')}</Button>
            {probe && <div className={styles.probeResult} data-state={probe.state} role="status"><strong>{t(`probeState.${probe.state}`)}</strong><span>{new Date(probe.checkedAt).toLocaleTimeString()} · {probe.durationMs} ms{probe.tools !== undefined ? ` · ${t('toolCount', { count: probe.tools })}` : ''}</span>{probe.issue && <p>{t(`errors.${probe.issue}`, { defaultValue: t('errors.probe-failed') })}</p>}</div>}
            <details className={styles.raw}><summary>{t('configuration')}</summary><pre className={styles.content}>{document.content}</pre></details>
          </>}
        </>}
      </aside>}
    </div>
    <details className={styles.sources}><summary>{t('scannedSources', { count: sources.length })}<span>{t('found', { count: total })}</span></summary>
      <p>{t('sourceHint')}</p>{catalog.limited && <p className={styles.error}>{t('limited')}</p>}
      {sources.map(source => <div key={source.id}><code>{source.path}</code><span>{source.issue ? failure(new Error(source.issue)) : t(source.exists ? 'sourceExists' : 'sourceMissing')}</span></div>)}
    </details>
  </section>
}
