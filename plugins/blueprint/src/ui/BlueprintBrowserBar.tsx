// Note: one navigation model for canvas, search and Chat — see .agents/notes/blueprint/navigation/requirements/module-browsing.md
import { ArrowLeft, ChevronRight } from './WorkbenchIcons'
import type { Blueprint } from '../shared/janus/types'
import { blueprintText as t } from './blueprint-text'
import { NOTE_KIND_LABEL_KEY, noteKindOf } from './blueprintStatus'

export function BlueprintBrowserBar({ source, trail, showOverview, canGoBack, onBack, onScope, searching, matches, unassigned, onReveal, hasModules }: {
  source: Blueprint; trail: string[]; showOverview: boolean; canGoBack: boolean; onBack: () => void
  onScope: (id: string | null) => void; searching: boolean; matches: string[]
  unassigned: string[]; onReveal: (id: string) => void; hasModules: boolean
}) {
  const list = (ids: string[]) => <ul className="bp-browser-document-list">
    {ids.map(id => {
      const node = source.nodes[id], kind = noteKindOf(node)
      return <li key={id}><button type="button" onClick={() => onReveal(id)}>
        <span>{node.title}</span><small>{t(NOTE_KIND_LABEL_KEY[kind] ?? kind)}</small>
      </button></li>
    })}
  </ul>
  return <div className="bp-browser-bar">
    <nav className="bp-browser-navigation" aria-label={t('blueprint:browse.navigation')}>
      <button className="blueprint-btn" onClick={onBack} disabled={!canGoBack} aria-label={t('blueprint:browse.back')}><ArrowLeft size={14} />{t('blueprint:browse.back')}</button>
      {showOverview && <button className="blueprint-btn" onClick={() => onScope(null)} aria-current={!trail.length ? 'page' : undefined}>{t('blueprint:browse.overview')}</button>}
      {trail.map((id, index) => <span className="bp-browser-crumb" key={id}>
        {(showOverview || index > 0) && <ChevronRight size={12} aria-hidden="true" />}
        <button className="blueprint-btn" aria-current={index === trail.length - 1 ? 'page' : undefined} onClick={() => onScope(id)}>{source.nodes[id].title}</button>
      </span>)}
    </nav>
    {!hasModules && <p className="bp-browser-hint">{t('blueprint:browse.noModules')}</p>}
    {searching && <section className="bp-browser-results" aria-label={t('blueprint:browse.results')}>
      <div className="bp-browser-results__title">{t('blueprint:browse.resultCount', { count: matches.length })}</div>
      {list(matches)}
    </section>}
    {unassigned.length > 0 && <details className="bp-browser-unassigned">
      <summary>{t('blueprint:browse.unassigned', { count: unassigned.length })}</summary>
      {list(unassigned)}
    </details>}
  </div>
}
