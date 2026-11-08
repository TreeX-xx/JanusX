import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, TerminalSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSuperAgentUIStore } from '@/stores/superagent-ui'
import { useGlobalToolsStore } from '@/stores/global-tools'
import { openSuperAgentChanges } from '@/lib/superagent-navigation'
import { JanusChat } from './JanusChat'
import { useJanusChatController } from './JanusChatProvider'
import { SuperAgentDecisions, SuperAgentWork, SuperAgentWorkProvider } from './SuperAgentWork'
import styles from './SuperAgentWorkspace.module.css'

/** A global tool pane: terminal splits retain their identity and never sit behind this view. */
export function SuperAgentWorkspace({ visible, focused, toolbarHost }: { visible: boolean; focused: boolean; toolbarHost: HTMLDivElement | null }) {
  const { t } = useTranslation('janus')
  const chat = useJanusChatController()
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
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
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => measure(element.clientWidth))
    observer.observe(element); measure(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (width > 0) setCompact(previous => width < 649 + (previous ? 24 : 0))
  }, [width])
  useEffect(() => { if (!compact) setNarrowOpen(false) }, [compact])
  const expanded = compact ? narrowOpen : !collapsed
  const sidebarWidth = Math.max(280, Math.min(preferredWidth, width - 369))
  const maxWidth = Math.max(280, Math.min(440, width - 369))
  const hideTerminalLauncher = !hasProjectPanes && terminalLauncher
  const changeSidebar = () => {
    if (compact) setNarrowOpen(value => !value)
    else setCollapsed(!collapsed)
  }
  return <SuperAgentWorkProvider onViewChanges={openSuperAgentChanges}>
    <section ref={root} className={styles.workspace} data-superagent-workspace="" data-compact={compact} aria-label={t('superagent.workspace')}>
      {visible && toolbarHost && createPortal(<div className={styles.toolbar} data-superagent-toolbar="">
        <button type="button" disabled={!workspaceId} aria-label={t(hideTerminalLauncher ? 'superagent.hideTerminal' : 'superagent.showTerminal')}
          title={t(hideTerminalLauncher ? 'superagent.hideTerminal' : 'superagent.showTerminal')} aria-expanded={hasProjectPanes ? undefined : terminalLauncher}
          onClick={() => {
            useSuperAgentUIStore.setState({ terminalLauncher: !hideTerminalLauncher })
            useGlobalToolsStore.getState().setFocused(hideTerminalLauncher)
            if (hideTerminalLauncher) window.requestAnimationFrame(() => root.current?.querySelector<HTMLTextAreaElement>('.janus-chat-input')?.focus({ preventScroll: true }))
          }}><TerminalSquare size={15} aria-hidden="true" /></button>
        <button className={styles.workersToggle} type="button" aria-label={expanded ? t('superagent.hideWorkers') : t('superagent.showWorkers')}
          title={compact && expanded ? t('superagent.backToChat') : expanded ? t('superagent.hideWorkers') : t('superagent.showWorkers')} aria-expanded={expanded}
          aria-controls="superagent-workers" onClick={changeSidebar}>
          <span>{t('superagent.workers')}</span>
          {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        </button>
      </div>, toolbarHost)}
      <div className={styles.body} data-resizing={resizing} style={{ gridTemplateColumns: compact
        ? `${narrowOpen ? '0px' : 'minmax(0, 1fr)'} 0px ${narrowOpen ? 'minmax(0, 1fr)' : '0px'}`
        : `minmax(0, 1fr) ${expanded ? 9 : 0}px ${expanded ? sidebarWidth : 0}px` }}>
        <div className={styles.chat} hidden={compact && narrowOpen}>
          <JanusChat docked conversationStyle emptyState={false} showConversationNavigation={false} showWorkspaceScope={false} showContextIndicator={false}
            visible={visible && !(compact && narrowOpen)} focused={focused && !(compact && narrowOpen)} modeColor="var(--interaction-accent)"
            messages={chat.messages} pendingContent={chat.pendingContent} isStreaming={chat.isStreaming} error={chat.error}
            modelOptions={chat.modelOptions} activeModel={chat.activeModel} modelNotice={chat.modelNotice}
            onSelectModel={chat.selectModel} onSend={chat.send} onRewrite={chat.rewrite} onStop={chat.stop}
            onRetry={chat.retry} onClear={chat.clear} conversationController={chat} resourceController={chat.resourceController}
            toolTraces={chat.toolTraces} discussionFooter={<SuperAgentDecisions conversationId={chat.conversationId} />} />
        </div>
        <div className={styles.divider} role="separator" aria-label={t('superagent.resizeWorkers')} aria-orientation="vertical"
          aria-valuemin={280} aria-valuemax={Math.round(maxWidth)} aria-valuenow={Math.round(sidebarWidth)}
          tabIndex={expanded && !compact ? 0 : -1} aria-hidden={!expanded || compact}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true) }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId) && root.current) setWidth(Math.min(maxWidth, root.current.getBoundingClientRect().right - event.clientX - 4.5)) }}
          onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false) }}
          onLostPointerCapture={() => setResizing(false)} onPointerCancel={() => setResizing(false)}
          onDoubleClick={() => setWidth(320)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            setWidth(event.key === 'Home' ? 280 : event.key === 'End' ? maxWidth : Math.min(maxWidth, sidebarWidth + (event.key === 'ArrowLeft' ? 20 : -20)))
          }} />
        <aside id="superagent-workers" className={styles.sidebar} aria-label={t('superagent.heading')}
          aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})} data-visible={expanded}>
          <div className={styles.sidebarHeader}><strong>{t('superagent.heading')}</strong></div>
          <SuperAgentWork conversationId={chat.conversationId} />
        </aside>
      </div>
    </section>
  </SuperAgentWorkProvider>
}
