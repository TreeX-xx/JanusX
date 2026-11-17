import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { TerminalSquare, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { openSuperAgentChanges } from '@/lib/superagent-navigation'
import { ConversationWelcome } from '../ConversationWelcome'
import { JanusChat } from './JanusChat'
import { useJanusChatController, useJanusChatRegistry } from './JanusChatProvider'
import { SuperAgentTopics } from './SuperAgentTopics'
import { SuperAgentStartup } from './SuperAgentStartup'
import { SuperAgentDecisions, SuperAgentMonitorRail, SuperAgentWork, SuperAgentWorkHeader, SuperAgentWorkProvider, SuperAgentWorkflowPlans, useSuperAgentWelcomeState } from './SuperAgentWork'
import { SuperAgentReportFallback } from './WorkerReportCard'
import { useSuperAgentPresentation } from './SuperAgentPresentation'
import styles from './SuperAgentWorkspace.module.css'
import scrollbars from '../../styles/native-scrollbars.module.css'

const WORKER_RAIL_WIDTH = 48
const WORKER_CHAT_SPACE = 369

/** A global tool pane: terminal splits retain their identity and never sit behind this view. */
export function SuperAgentWorkspace({ visible, focused, toolbarHost }: { visible: boolean; focused: boolean; toolbarHost: HTMLDivElement | null }) {
  const { t } = useTranslation('janus')
  const chat = useJanusChatController()
  const registry = useJanusChatRegistry()
  const [startupComplete, setStartupComplete] = useState(false)
  const finishStartup = useCallback(() => setStartupComplete(true), [])
  const [sendError, setSendError] = useState('')
  const [targetId,setTargetId]=useState<string|null>(null)
  const agentMode = useSuperAgentUIStore(state => state.agentMode)
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const target=registry.topicConversations.find(c=>c.id===targetId&&c.topic?.rootId===chat.conversationId&&c.topic.workspaceId===workspaceId)
  useEffect(()=>setTargetId(null),[chat.conversationId,workspaceId])
  const activeTopics = registry.topicConversations.filter(c => c.topic?.rootId === chat.conversationId && c.topic.workspaceId === workspaceId
    && (registry.getController(c.id).isStreaming || c.topic.inputs.some(input => ['running', 'queued', 'steering', 'accepted'].includes(input.state))))
  const canStop = chat.isStreaming || activeTopics.length > 0
  const stopConversation = () => {
    for (const topic of activeTopics) registry.topics.stop(topic.id)
    if (chat.isStreaming) chat.stop()
  }
  const workspacePath = useWorkspaceStore(state => state.workspaces.find(row => row.id === state.activeWorkspaceId)?.path)
  const hasProjectPanes = useWorkspaceStore(state => state.paneTree !== null)
  const terminalLauncher = useSuperAgentUIStore(state => state.terminalLauncher)
  const collapsed = useSuperAgentUIStore(state => state.workersCollapsed)
  const preferredWidth = useSuperAgentUIStore(state => state.workersWidth)
  const setCollapsed = useSuperAgentUIStore(state => state.setWorkersCollapsed)
  const setWidth = useSuperAgentUIStore(state => state.setWorkersWidth)
  const root = useRef<HTMLDivElement>(null)
  const [width, measure] = useState(0)
  const [compact, setCompact] = useState(false)
  const [narrowOpen, setNarrowOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const drag = useRef({ x: 0, moved: false })
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => measure(element.clientWidth))
    observer.observe(element); measure(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (width > 0) setCompact(previous => width < 280 + WORKER_CHAT_SPACE + (previous ? 24 : 0))
  }, [width])
  useEffect(() => { if (!compact) setNarrowOpen(false) }, [compact])
  const expanded = compact ? narrowOpen : !collapsed
  const sidebarWidth = Math.max(280, Math.min(preferredWidth, width - WORKER_CHAT_SPACE))
  const maxWidth = Math.max(280, Math.min(440, width - WORKER_CHAT_SPACE))
  const workersAction = compact && expanded ? t('superagent.backToChat') : expanded ? t('superagent.hideWorkers') : t('superagent.showWorkers')
  const expandDock = () => { if (compact) setNarrowOpen(true); else setCollapsed(false) }
  const changeSidebar = () => {
    if (compact) setNarrowOpen(value => !value)
    else setCollapsed(!collapsed)
    if (compact && expanded) window.requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('.janus-chat-input')?.focus({ preventScroll: true }))
  }
  useLayoutEffect(() => {
    const focused = document.activeElement
    if (!root.current?.contains(focused)) return
    if (!expanded && root.current.querySelector('#superagent-workers')?.contains(focused)) root.current.querySelector<HTMLButtonElement>('[data-dock-toggle]')?.focus({ preventScroll: true })
    if (expanded && root.current.querySelector('[data-monitor-rail]')?.contains(focused)) root.current.querySelector<HTMLButtonElement>('[data-dock-toggle]')?.focus({ preventScroll: true })
  }, [expanded])
  return <SuperAgentWorkProvider onViewChanges={openSuperAgentChanges} revealWork={expandDock} revealConversation={() => { if (compact) setNarrowOpen(false) }}>
    <section ref={root} className={styles.workspace} data-superagent-workspace="" data-compact={compact} aria-label={t('superagent.workspace')}>
      {startupComplete && visible && toolbarHost && createPortal(<div className={styles.toolbar} data-superagent-toolbar="">
        {!hasProjectPanes && <button className={styles.terminalToggle} type="button" disabled={!workspaceId} aria-label={t(terminalLauncher ? 'superagent.hideTerminal' : 'superagent.showTerminal')}
          title={t(terminalLauncher ? 'superagent.hideTerminal' : 'superagent.showTerminal')} aria-expanded={terminalLauncher}
          onClick={() => {
            useSuperAgentUIStore.setState({ terminalLauncher: !terminalLauncher })
            useGlobalToolsStore.getState().setFocused(terminalLauncher)
            if (terminalLauncher) window.requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('.janus-chat-input')?.focus({ preventScroll: true }))
          }}><TerminalSquare size={15} aria-hidden="true" /></button>}
      </div>, toolbarHost)}
      {!startupComplete ? <SuperAgentStartup ready={registry.persistenceReady} active={visible} onComplete={finishStartup} /> : <div className={styles.body} data-resizing={resizing} style={{ gridTemplateColumns: compact
        ? `${narrowOpen ? '0px' : 'minmax(0, 1fr)'} 0px ${narrowOpen ? 'minmax(0, 1fr)' : `${WORKER_RAIL_WIDTH}px`}`
        : `minmax(0, 1fr) ${expanded ? 9 : 0}px ${expanded ? sidebarWidth : WORKER_RAIL_WIDTH}px` }}>
        <div className={styles.chat} data-superagent-design="multi-input" hidden={compact && narrowOpen}>
          <JanusChat key={chat.conversationId + ':' + workspaceId} docked conversationStyle emptyState={false} showConversationNavigation={false} showWorkspaceScope={false} showContextIndicator={false}
            aboveComposer={<>{target&&<div className={styles.branchTarget} data-branch-target={target.id}>
              <span>{t('topics.target',{title:target.title})}</span><button type="button" aria-label={t('topics.cancelTarget')} onClick={()=>{setTargetId(null);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('.janus-chat-input')?.focus({preventScroll:true}))}}><X size={13}/></button>
            </div>}<SuperAgentWelcome rootId={chat.conversationId} workspaceId={workspaceId} error={sendError} active={visible && !(compact && narrowOpen)} /></>}
            contextComposer={{ id: 'superagent:' + chat.conversationId + ':' + workspaceId, workspacePath }}
            workerShortcuts={agentMode === 'superagent' ? { workspaceId } : undefined}
            modelOptions={chat.modelOptions} activeModel={chat.activeModel} modelNotice={chat.modelNotice} onSelectModel={(provider, model) => chat.selectModel(provider, model, true)}
            inputPlaceholderOverride={target?t('topics.targetPlaceholder',{title:target.title}):t('topics.placeholder')}
            visible={visible && !(compact && narrowOpen)} focused={focused && !(compact && narrowOpen)} modeColor="var(--interaction-accent)"
            messages={[]} pendingContent="" isStreaming={canStop} error={sendError || null}
            onSend={async (text, context) => {
              try {
                if (!registry.persistenceReady) throw new Error(t('topics.loading'))
                setSendError('')
                if(targetId&&!target)throw new Error(t('topics.targetUnavailable'))
                if(target&&context?.worker?.kind==='worker')throw new Error(t('topics.targetConflict'))
                await registry.topics.submit(chat.conversationId, workspaceId, text, false, context, target ? { targetId: target.id } : undefined)
                setTargetId(null)
              } catch (error) { setSendError(String(error)); throw error }
            }} onRewrite={chat.rewrite} onStop={stopConversation}
            onRetry={chat.retry} onClear={chat.clear} conversationController={chat} resourceController={chat.resourceController}
            toolTraces={chat.toolTraces}
            transcriptContent={<><SuperAgentTopics rootId={chat.conversationId} workspaceId={workspaceId} onSupplement={id=>{setTargetId(id);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('.janus-chat-input')?.focus({preventScroll:true}))}} /><SuperAgentWorkflowPlans conversationId={chat.conversationId}
              relatedConversationIds={registry.topicConversations.filter(c => c.topic?.rootId === chat.conversationId && c.topic.workspaceId === workspaceId).map(c => c.id)}
            /><SuperAgentReportFallback /><SuperAgentDecisions conversationId={chat.conversationId} />{sendError && <p role="alert">{sendError}</p>}</>} />
        </div>
        <div className={styles.divider} role="separator" aria-label={t('superagent.resizeWorkers')} aria-orientation="vertical"
          aria-valuemin={280} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={!compact && expanded ? 0 : -1} aria-hidden={compact || !expanded}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); drag.current = { x: event.clientX, moved: false }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return
            if (Math.abs(event.clientX - drag.current.x) > 4) drag.current.moved = true
            if (drag.current.moved) { setResizing(true); setWidth(Math.min(maxWidth, root.current.getBoundingClientRect().right - event.clientX - 4.5)) }
          }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false) }}
          onLostPointerCapture={() => setResizing(false)} onPointerCancel={() => setResizing(false)}
          onDoubleClick={() => { expandDock(); setWidth(340) }} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            expandDock()
            setWidth(event.key === 'Home' ? 280 : event.key === 'End' ? maxWidth : Math.min(maxWidth, sidebarWidth + (event.key === 'ArrowLeft' ? 20 : -20)))
          }} />
        <div className={styles.dock} data-worker-dock="" data-open={expanded} style={{ '--dock-width': `${compact ? width : sidebarWidth}px`, '--worker-rail-width': `${WORKER_RAIL_WIDTH}px` } as CSSProperties}>
        <aside id="superagent-workers" className={styles.sidebar} aria-label={t('superagent.heading')}
          aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})} data-visible={expanded}>
          <SuperAgentWorkHeader />
          <div className={`${styles.sidebarContent} ${scrollbars.scope}`}><SuperAgentWork conversationId={chat.conversationId} /></div>
        </aside>
        <div className={styles.dockControls} data-worker-controls="">
          <button type="button" className={styles.dockToggle} data-dock-toggle="" aria-label={workersAction} title={workersAction}
            aria-expanded={expanded} aria-controls="superagent-workers" onClick={changeSidebar}>
            <svg className={styles.dockGlyph} width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" data-open={expanded}>
              <path d="M3.5 6.5H18.5M3.5 15.5H18.5" stroke="currentColor" strokeWidth="1" opacity=".35" />
              <path d="M18.5 4.5V17.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M4.5 11H15.5" stroke="currentColor" strokeWidth="1" strokeDasharray="1 3" opacity=".4" />
              <rect x="4.5" y="8.5" width="5" height="5" rx=".8" fill="currentColor" />
            </svg>
          </button>
          <SuperAgentMonitorRail visible={!expanded} />
        </div>
        </div>
      </div>}
    </section>
  </SuperAgentWorkProvider>
}

function SuperAgentWelcome({ rootId, workspaceId, error, active }: { rootId: string; workspaceId: string | null; error: string; active: boolean }) {
  const registry = useJanusChatRegistry()
  const presentation = useSuperAgentPresentation()
  const root = registry.getController(rootId)
  const workspace = useWorkspaceStore(state => state.workspaces.find(row => row.id === workspaceId))
  const work = useSuperAgentWelcomeState(rootId)
  if (presentation?.report || error || root.error || root.messages.length || root.pendingContent || root.isStreaming || root.pendingQuestions.length
    || registry.topicConversations.some(row => row.topic?.rootId === rootId && row.topic.workspaceId === workspaceId) || work.hasContent) return null
  return <div className={styles.welcome}><ConversationWelcome brand="janusx" workspacePath={workspace?.path} workspaceName={workspace?.name}
    loading={!registry.persistenceReady || work.loading} active={active} /></div>
}
