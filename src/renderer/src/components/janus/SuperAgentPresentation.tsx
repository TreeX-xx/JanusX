import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import type { SuperAgentWorkDetail } from '../../../../shared/superagent'
import { useSuperAgentUIStore } from '../../stores/superagent-ui'

export interface ReportTarget { title: string; summary: string; content?: string; workspaceId?: string; resourceId?: string }
export const workerReportKey = (workId: string, target: ReportTarget) => JSON.stringify([workId, target.resourceId ?? target.content ?? target.title])
interface Link { roundId?: string; inputIds?: string[]; workIds: string[] }
type Highlight = { owner: string; link: Link } | null
interface Presentation {
  focusWork(workId: string): void
  active: Link | null
  highlight(kind: 'hover' | 'focus', owner: string, value: Link | null): void
  refreshHighlight(owner: string, value: Link | null): void
  releaseHighlight(owner: string): void
  worksForInputs(ids: string[]): string[]
  workForReport(reportId: string): string | undefined
  reportSource(reportId: string): { workId: string; workspaceId: string; resourceId: string } | undefined
  registerReport(key: string, element: HTMLElement | null): void
  report: { workId: string; target: ReportTarget; trigger: HTMLElement; inline: boolean } | null
  openReport(workId: string, target: ReportTarget, trigger: HTMLElement): void
  closeReport(): void
}
const Context = createContext<Presentation | null>(null)
export const useSuperAgentPresentation = () => useContext(Context)

/** Only explicit source/delivery identities link a round to work; never infer from log text. */
export function SuperAgentPresentationProvider({ details, children, revealWork, revealConversation, workspaceId }: { details: SuperAgentWorkDetail[]; children: ReactNode; revealWork?(): void; revealConversation?(): void; workspaceId: string | null }) {
  const [hovered, hover] = useState<Highlight>(null), [focused, focus] = useState<Highlight>(null)
  const [report, setReport] = useState<Presentation['report']>(null)
  const anchors = useRef(new Map<string, HTMLElement>())
  const registerReport = useCallback((key: string, element: HTMLElement | null) => {
    if (element) anchors.current.set(key, element); else anchors.current.delete(key)
    setReport(current => current && workerReportKey(current.workId, current.target) === key && current.inline !== !!element ? { ...current, inline: !!element } : current)
  }, [])
  useEffect(() => { hover(null); focus(null); setReport(null) }, [workspaceId])
  useEffect(() => {
    const clear = () => { hover(null); focus(null) }
    window.addEventListener('blur', clear)
    return () => window.removeEventListener('blur', clear)
  }, [])
  const highlight = useCallback<Presentation['highlight']>((kind, owner, link) => {
    if (kind === 'focus' && link) hover(null)
    const set = kind === 'hover' ? hover : focus
    set(current => link ? { owner, link } : current?.owner === owner ? null : current)
  }, [])
  const releaseHighlight = useCallback((owner: string) => {
    hover(current => current?.owner === owner ? null : current)
    focus(current => current?.owner === owner ? null : current)
  }, [])
  const refreshHighlight = useCallback((owner: string, link: Link | null) => {
    const refresh = (current: Highlight): Highlight => current?.owner !== owner ? current
      : !link ? null : sameLink(current.link, link) ? current : { owner, link }
    hover(refresh); focus(refresh)
  }, [])
  const links = useMemo(() => {
    const inputs = new Map<string, Set<string>>(), reports = new Map<string, { workId: string; workspaceId: string; resourceId: string }>()
    for (const detail of details) {
      const ids = new Set([detail.work.sourceInputId, ...detail.deliveries.map(row => row.inputId)])
      for (const input of detail.inputs.filter(row => ids.has(row.id))) {
        const works = inputs.get(input.eventId) ?? new Set<string>(); works.add(detail.work.id); inputs.set(input.eventId, works)
      }
      for (const row of detail.reports) reports.set(row.id, { workId: detail.work.id, workspaceId: detail.work.workspaceId, resourceId: row.resourceId })
    }
    return { inputs, reports }
  }, [details])
  const worksForInputs = (ids: string[]) => [...new Set(ids.flatMap(id => [...(links.inputs.get(id) ?? [])]))]
  const selected = (hovered ?? focused)?.link
  const active = selected ? { ...selected, workIds: selected.inputIds ? worksForInputs(selected.inputIds) : selected.workIds } : null
  return <Context.Provider value={{ active, highlight, refreshHighlight, releaseHighlight, worksForInputs,
    focusWork: workId => { useSuperAgentUIStore.setState({ focusedWorkId: workId }); revealWork?.() },
    workForReport: id => links.reports.get(id)?.workId, reportSource: id => links.reports.get(id), registerReport, report,
    openReport: (workId, target, trigger) => {
      const anchor = anchors.current.get(workerReportKey(workId, target))
      for (let fold = anchor?.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null) {
        if (!fold.open) fold.querySelector<HTMLElement>(':scope > summary')?.click()
      }
      setReport({ workId, target, trigger, inline: !!anchor }); revealConversation?.()
    },
    closeReport: () => {
      const trigger = report?.trigger, anchor = report && anchors.current.get(workerReportKey(report.workId, report.target))
      const workspace = trigger?.closest('[data-superagent-workspace]') ?? anchor?.closest('[data-superagent-workspace]')
      setReport(null); requestAnimationFrame(() => {
        const visible = trigger?.isConnected && trigger.checkVisibility() && !trigger.closest('[inert]')
        const fallback = anchor?.querySelector<HTMLButtonElement>('button') ?? workspace?.querySelector<HTMLElement>('.janus-chat-input')
        ;(visible ? trigger : fallback)?.focus({ preventScroll: true })
      })
    },
  }}>{children}</Context.Provider>
}

function sameLink(a: Link, b: Link): boolean {
  return a.roundId === b.roundId && JSON.stringify(a.inputIds) === JSON.stringify(b.inputIds)
    && JSON.stringify(a.workIds) === JSON.stringify(b.workIds)
}

/** Pointer hover is temporary; only keyboard focus keeps an association highlighted. */
export function useSuperAgentHighlight(link: Link | null) {
  const presentation = useSuperAgentPresentation(), owner = useId()
  const refresh = presentation?.refreshHighlight, release = presentation?.releaseHighlight
  useEffect(() => { refresh?.(owner, link) }, [refresh, owner, link])
  useEffect(() => () => release?.(owner), [release, owner])
  if (!presentation || !link) return {}
  const resolved = link.inputIds ? { ...link, workIds: presentation.worksForInputs(link.inputIds) } : link
  return {
    'data-cross-highlight': linkedHighlight(presentation.active, resolved),
    onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch') presentation.highlight('hover', owner, link) },
    onPointerLeave: () => presentation.highlight('hover', owner, null),
    onPointerDown: () => presentation.highlight('focus', owner, null),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target.matches(':focus-visible')) presentation.highlight('focus', owner, link)
    },
    onKeyDown: () => presentation.highlight('focus', owner, link),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) presentation.highlight('focus', owner, null)
    },
  }
}

export function SuperAgentMessage({ round, className, children, userMessage }: { round?: { id: string; inputIds: string[] }; className: string; children: ReactNode; userMessage?: { id: string; text: string } }) {
  const highlight = useSuperAgentHighlight(round ? { roundId: round.id, inputIds: round.inputIds, workIds: [] } : null)
  return <div className={className} data-user-message={userMessage?.id} data-navigation-text={userMessage?.text} data-round-id={round?.id} tabIndex={round ? 0 : undefined} {...highlight}>{children}</div>
}

export function linkedHighlight(active: Link | null | undefined, link: Link): boolean {
  return !!active && (active.roundId && link.roundId ? active.roundId === link.roundId : active.workIds.some(id => link.workIds.includes(id)))
}
