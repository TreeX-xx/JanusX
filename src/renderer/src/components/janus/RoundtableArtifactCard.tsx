import { useEffect, useMemo, useState } from 'react'
// Note: roundtable result card builds/applies native bundles — see .agents/notes/agent/roundtable-artifact-bundle-s5.md
import { useI18n } from '@/i18n/useI18n'
import type { RoundtableFact } from '../../../../shared/roundtable/events'

interface BundleDiagnostic {
  code: string
  message: string
  path?: string
}

interface BundlePreview {
  bundle: {
    id: string
    revision: number
    artifacts: Array<{ artifactId: string; operationId: string; sourceRefs: string[] }>
    changeSet: { operations: Array<{ operationId: string; type: string; uri: string }> }
    coverage: Array<{ sourceRef: string; operationId?: string; section?: string; status: string; reason?: string }>
    unresolved: Array<{ from: string; target: string }>
  }
  diagnostics: BundleDiagnostic[]
}

interface ScopeInfo {
  root: string
  repoId: string
  repoName: string
}

interface ParentOption {
  id: string
  title: string
  sourceUri: string
}

interface RoundtableArtifactCardProps {
  sessionId: string
  facts: RoundtableFact[]
  roundNumber: number
  cwd: string | null
}

/** Display-only kind mirror of the main-process producer mapping. */
function noteKindOf(factKind: string): 'requirement' | 'decision' | 'task' | 'idea' {
  switch (factKind) {
    case 'requirement':
      return 'requirement'
    case 'solution':
    case 'decision':
      return 'decision'
    case 'action':
      return 'task'
    default:
      return 'idea'
  }
}

const KIND_LABEL_KEY = {
  requirement: 'janus:roundtable.artifact.kind.requirement',
  decision: 'janus:roundtable.artifact.kind.decision',
  task: 'janus:roundtable.artifact.kind.task',
  idea: 'janus:roundtable.artifact.kind.idea',
} as const

function failureMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as Record<string, unknown>).message)
  return String(err)
}

/**
 * Result card (S5): builds a native artifact proposal from session facts,
 * previews coverage and diagnostics, applies it to the bound checkout, and
 * reads parent Notes through the shared snapshot and refreshes the shared index.
 * The meeting-log Markdown export stays a separate explicit action.
 */
export function RoundtableArtifactCard({ sessionId, facts, roundNumber, cwd }: RoundtableArtifactCardProps) {
  const { t } = useI18n('janus')
  const [scope, setScope] = useState<ScopeInfo | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [parents, setParents] = useState<ParentOption[]>([])
  const [checked, setChecked] = useState<string[]>(() => facts.map((fact) => fact.id))
  const [parentId, setParentId] = useState('')
  const [preview, setPreview] = useState<BundlePreview | null>(null)
  const [building, setBuilding] = useState(false)
  const [applying, setApplying] = useState(false)
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // New rounds add facts; earlier selections survive.
  useEffect(() => {
    setChecked((current) => {
      const known = new Set(current)
      const next = [...current]
      for (const fact of facts) {
        if (!known.has(fact.id)) next.push(fact.id)
      }
      return next.filter((id) => facts.some((fact) => fact.id === id))
    })
    setPreview(null)
    setAppliedCount(null)
  }, [facts, sessionId])

  useEffect(() => {
    let cancelled = false
    setScope(null)
    setScopeError(null)
    setParents([])
    setPreview(null)
    if (!cwd || !window.electron?.harness) return
    void (async () => {
      try {
        const resolved = await window.electron.harness.resolve(cwd)
        if (cancelled) return
        if (!resolved.ok || !resolved.root || !resolved.repoId) {
          setScopeError(!resolved.ok ? t('janus:roundtable.artifact.resolveFailed') : t('janus:roundtable.artifact.noRepoId'))
          return
        }
        setScope({ root: resolved.root, repoId: resolved.repoId, repoName: resolved.repoName ?? '' })
        const snapshot = await window.electron.harness.noteSnapshot(cwd)
        if (cancelled) return
        setParents(
          snapshot.entries.flatMap(entry => entry.doc && entry.uri ? [{ id: entry.doc.id, title: entry.doc.title, sourceUri: entry.uri }] : [])
            .sort((a, b) => a.title.localeCompare(b.title)),
        )
      } catch (err: unknown) {
        if (!cancelled) setScopeError(failureMessage(err))
      }
    })()
    return () => { cancelled = true }
  }, [cwd, t])

  const factById = useMemo(() => new Map(facts.map((fact) => [fact.id, fact])), [facts])
  const parentUri = parents.find((option) => option.id === parentId)?.sourceUri

  if (!cwd) {
    return (
      <div className="janus-roundtable-artifact" role="status">
        <span className="janus-roundtable-artifact__notice">{t('janus:roundtable.artifact.noWorkspace')}</span>
      </div>
    )
  }

  const toggle = (id: string) => {
    setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
    setPreview(null)
    setAppliedCount(null)
  }

  const handleBuild = async () => {
    if (!scope || building) return
    setBuilding(true)
    setError(null)
    setAppliedCount(null)
    try {
      const selected = new Set(checked)
      const result = await window.electron.roundtable.buildBundle(sessionId, {
        factIds: facts.map((fact) => fact.id),
        repoId: scope.repoId,
        root: scope.root,
        ...(parentUri ? { parentUri } : {}),
        excluded: facts.filter((fact) => !selected.has(fact.id)).map((fact) => ({ factId: fact.id, reason: t('janus:roundtable.artifact.reasonDeselected') })),
      })
      setPreview(result as BundlePreview)
    } catch (err: unknown) {
      setError(t('janus:roundtable.artifact.buildFailed', { message: failureMessage(err) }))
    } finally {
      setBuilding(false)
    }
  }

  const handleApply = async () => {
    if (!scope || !preview || applying || preview.diagnostics.length > 0) return
    setApplying(true)
    setError(null)
    try {
      const result = await window.electron.roundtable.applyBundle(scope.root, preview.bundle, `roundtable ${sessionId} r${roundNumber}`)
      await window.electron.harness.rescan(scope.root)
      setAppliedCount(result.applied.length)
    } catch (err: unknown) {
      setError(t('janus:roundtable.artifact.applyFailed', { message: failureMessage(err) }))
    } finally {
      setApplying(false)
    }
  }

  const operations = preview?.bundle.changeSet.operations ?? []
  const canApply = !!preview && preview.diagnostics.length === 0 && operations.length > 0 && !applying

  return (
    <div className="janus-roundtable-artifact" aria-label={t('janus:roundtable.artifact.title')}>
      <div className="janus-roundtable-artifact__head">
        <span className="janus-roundtable-artifact__title">{t('janus:roundtable.artifact.title')}</span>
        {scope ? <span className="janus-roundtable-artifact__target">{t('janus:roundtable.artifact.targetLabel')} · {scope.repoName}</span> : null}
      </div>
      {scopeError ? <p className="janus-roundtable-artifact__notice" role="alert">{scopeError}</p> : null}
      {scope ? (
        <>
          <label className="janus-roundtable-artifact__row">
            <span>{t('janus:roundtable.artifact.parentLabel')}</span>
            <select value={parentId} onChange={(event) => { setParentId(event.target.value); setPreview(null); setAppliedCount(null) }} aria-label={t('janus:roundtable.artifact.parentLabel')}>
              <option value="">{t('janus:roundtable.artifact.parentNone')}</option>
              {parents.map((option) => (
                <option key={option.id} value={option.id}>{option.title}</option>
              ))}
            </select>
          </label>
          <div className="janus-roundtable-artifact__row">
            <span>{t('janus:roundtable.artifact.factsLabel')} · {t('janus:roundtable.artifact.selectedCount', { selected: checked.length, total: facts.length })}</span>
            <span className="janus-roundtable-artifact__toggles">
              <button type="button" onClick={() => { setChecked(facts.map((fact) => fact.id)); setPreview(null) }}>{t('janus:roundtable.artifact.selectAll')}</button>
              <button type="button" onClick={() => { setChecked([]); setPreview(null) }}>{t('janus:roundtable.artifact.clearAll')}</button>
            </span>
          </div>
          <ul className="janus-roundtable-artifact__facts">
            {facts.map((fact) => (
              <li key={fact.id}>
                <label>
                  <input type="checkbox" checked={checked.includes(fact.id)} onChange={() => toggle(fact.id)} />
                  <span className="janus-roundtable-artifact__kind" data-kind={noteKindOf(fact.kind)}>{t(KIND_LABEL_KEY[noteKindOf(fact.kind)])}</span>
                  <span>{fact.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="janus-roundtable-artifact__actions">
            <button type="button" disabled={building || facts.length === 0} onClick={() => void handleBuild()}>
              {building ? t('janus:roundtable.artifact.building') : preview ? t('janus:roundtable.artifact.rebuild') : t('janus:roundtable.artifact.build')}
            </button>
            {preview ? (
              <button type="button" disabled={!canApply} onClick={() => void handleApply()}>
                {applying ? t('janus:roundtable.artifact.applying') : t('janus:roundtable.artifact.apply')}
              </button>
            ) : null}
          </div>
          {preview ? (
            <div className="janus-roundtable-artifact__preview">
              {preview.diagnostics.length > 0 ? (
                <p className="janus-roundtable-artifact__notice" role="alert">
                  {t('janus:roundtable.artifact.blockedDiagnostics', { count: preview.diagnostics.length })}
                </p>
              ) : null}
              <ul>
                {preview.diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.path ?? 'bundle'}-${index}`} className="janus-roundtable-artifact__diag">
                    {diagnostic.code} · {diagnostic.message}
                  </li>
                ))}
              </ul>
              <ul>
                {preview.bundle.artifacts.map((artifact) => {
                  const fact = factById.get(artifact.sourceRefs[0])
                  return (
                    <li key={artifact.artifactId}>
                      <span className="janus-roundtable-artifact__kind" data-kind={fact ? noteKindOf(fact.kind) : 'idea'}>
                        {fact ? t(KIND_LABEL_KEY[noteKindOf(fact.kind)]) : artifact.sourceRefs[0]}
                      </span>
                      <span>{fact?.title ?? artifact.sourceRefs[0]}</span>
                    </li>
                  )
                })}
                {preview.bundle.coverage.filter((entry) => entry.status === 'excluded').map((entry) => (
                  <li key={`excluded-${entry.sourceRef}`} className="janus-roundtable-artifact__excluded">
                    <span>{factById.get(entry.sourceRef)?.title ?? entry.sourceRef}</span>
                    <span> · {t('janus:roundtable.artifact.excludedMark')}{entry.reason ? `：${entry.reason}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {appliedCount !== null ? <p className="janus-roundtable-artifact__done" role="status">{t('janus:roundtable.artifact.applied', { count: appliedCount })}</p> : null}
          {error ? <p className="janus-roundtable-artifact__notice" role="alert">{error}</p> : null}
        </>
      ) : null}
    </div>
  )
}
