import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, Check, ChevronRight, FileCode2, ShieldCheck, TerminalSquare, MessageSquare } from 'lucide-react'
import type { ConversationCommand, ConversationItem, ConversationSnapshot } from '../../../shared/conversation-display'
import { useWorkspaceStore } from '@/stores/workspace'
import { MarkdownContent } from './chat/ChatContent'
import { CLITerminal } from './CLITerminal'
import { TurnChangeIsland } from './TurnChangeIsland'
import { AgentComposer } from './AgentComposer'
import { ConversationPlanPanel } from './ConversationPlanPanel'
import { ConversationDuration } from './ConversationDuration'
import { ConversationMessageActions } from './ConversationMessageActions'
import { ConversationMessageEditor } from './ConversationMessageEditor'
import styles from './AgentSessionPane.module.css'

export const AgentSessionPane = memo(function AgentSessionPane({ terminalId, visible, focused, workspaceVisible }: {
  terminalId: string; visible: boolean; focused: boolean; workspaceVisible: boolean
}) {
  const { t } = useTranslation('terminal')
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingSend, setPendingSend] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ item: ConversationItem; text: string; threadId: string | null; epoch: number } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [modeTransition, setModeTransition] = useState<'terminal' | 'conversation' | null>(null)
  const [showLatest, setShowLatest] = useState(false)
  const busyRef = useRef(false)
  const latest = useRef<ConversationSnapshot | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const terminalHost = useRef<HTMLDivElement>(null)
  const conversationHost = useRef<HTMLDivElement>(null)
  const composerOrigin = useRef<{ terminalId: string; top: number } | null>(null)
  const follow = useRef(true)
  const readingTop = useRef<number | undefined>(undefined)
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const switchRequest = useRef(0)
  const switchLocked = useRef(false)
  const [requestedMode, setRequestedMode] = useState<'terminal' | 'conversation' | null>(null)
  const terminal = useWorkspaceStore(s => s.terminals.find(item => item.id === terminalId)
    ?? Object.values(s.terminalSnapshots).flatMap(entry => entry.terminals).find(item => item.id === terminalId))
  const draft = terminal?.conversationDraft ?? ''
  const setDraft = (text: string) => useWorkspaceStore.getState().updateTerminal(terminalId, { conversationDraft: text })
  const conversation = (snapshot?.mode ?? terminal?.conversationInitialView) === 'conversation'
  const transitioning = switching || modeTransition !== null
  const newestPlan = snapshot?.plans?.at(-1)
  const currentPlan = newestPlan && (!snapshot?.turnId || newestPlan.turnId === snapshot.turnId) ? newestPlan : undefined
  const pastPlans = snapshot?.plans?.filter(plan => plan !== currentPlan) ?? []
  const working = Boolean(pendingSend || snapshot?.turnId || snapshot?.submitting || snapshot?.backgroundTasks)
  const empty = !editing && !working && !snapshot?.items.length && !snapshot?.approvals.length && !snapshot?.plans?.length

  const accept = useCallback((next: ConversationSnapshot) => {
    if (next.id !== terminalId || (latest.current && next.revision < latest.current.revision)) return
    latest.current = next
    if (visibleRef.current) setSnapshot(next)
  }, [terminalId])
  useEffect(() => {
    let mounted = true
    latest.current = null
    setSnapshot(null)
    setPendingSend(null)
    setEditing(null)
    const off = window.electron.terminal.onConversation(accept)
    void window.electron.terminal.conversation(terminalId).then(value => { if (mounted && value) accept(value) }).catch(e => { if (mounted) setError(String(e)) })
    return () => { mounted = false; off() }
  }, [terminalId, terminal?.pid, accept])
  useLayoutEffect(() => { if (visible && latest.current) setSnapshot(latest.current) }, [visible])
  useLayoutEffect(() => {
    if (visible && conversation && scrollRef.current) {
      const el = scrollRef.current
      el.scrollTop = terminal?.conversationScrollTop ?? el.scrollHeight
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
      setShowLatest(!follow.current)
    }
  }, [visible, conversation, terminalId, terminal?.conversationScrollTop]) // Restore each view's own reading position.
  useEffect(() => () => {
    if (readingTop.current !== undefined) useWorkspaceStore.getState().updateTerminal(terminalId, { conversationScrollTop: readingTop.current })
  }, [terminalId, visible])
  useLayoutEffect(() => {
    if (visible && conversation && follow.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [visible, conversation, snapshot?.revision])
  useEffect(() => {
    if (!visible || !focused || transitioning) return
    if (conversation) { if (!editing) inputRef.current?.focus() }
    else terminalHost.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, [visible, focused, conversation, transitioning, snapshot?.capabilities.submit, editing])
  useEffect(() => {
    if (editing && snapshot && (snapshot.threadId !== editing.threadId || snapshot.controlEpoch !== editing.epoch)) setEditing(null)
  }, [editing, snapshot])
  useEffect(() => {
    const request = switchRequest
    switchLocked.current = false
    setSwitching(false)
    setModeTransition(null)
    setRequestedMode(null)
    return () => {
      request.current++
      if (transitionTimer.current) clearTimeout(transitionTimer.current)
    }
  }, [terminalId])
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input || !visible || !conversation) return
    const resize = () => { input.style.height = '0px'; input.style.height = `${Math.min(input.scrollHeight, 200)}px` }
    resize()
    let width = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; resize() }
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [draft, visible, conversation])

  useLayoutEffect(() => {
    const composer = inputRef.current?.form
    if (!visible || !conversation || transitioning || !composer) {
      composerOrigin.current = null
      return
    }
    if (empty) {
      const remember = () => { composerOrigin.current = { terminalId, top: composer.getBoundingClientRect().top } }
      remember()
      // Keep the starting position current as the draft, pane or intro resizes.
      const observer = new ResizeObserver(remember)
      observer.observe(composer)
      if (conversationHost.current) observer.observe(conversationHost.current)
      if (scrollRef.current) observer.observe(scrollRef.current)
      return () => observer.disconnect()
    }
    const origin = composerOrigin.current
    composerOrigin.current = null
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!origin || origin.terminalId !== terminalId || motion.matches) return
    const offset = origin.top - composer.getBoundingClientRect().top
    if (Math.abs(offset) < 1) return
    // Animate the existing form from its empty-state position to its new layout;
    // transport, focus and streaming do not wait for the visual transition.
    const animation = composer.animate([
      { transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' },
    ], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    const cancel = () => animation.cancel()
    motion.addEventListener('change', cancel)
    return () => { animation.cancel(); motion.removeEventListener('change', cancel) }
  }, [empty, conversation, visible, transitioning, terminalId, snapshot?.capabilities.submit])

  const action = async (command: ConversationCommand): Promise<boolean> => {
    if (busyRef.current || switchLocked.current || !visible) return false
    busyRef.current = true; setBusy(true); setError('')
    try { accept(await window.electron.terminal.conversationCommand(terminalId, command)); return true }
    catch (e) { setError(String(e)); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  const changeMode = async (mode: 'terminal' | 'conversation') => {
    if (switchLocked.current || editing || busyRef.current || !visible || snapshot?.mode === mode) return
    const request = ++switchRequest.current
    switchLocked.current = true
    if (scrollRef.current && conversation) useWorkspaceStore.getState().updateTerminal(terminalId, { conversationScrollTop: scrollRef.current.scrollTop })
    setSwitching(true)
    setRequestedMode(mode)
    setError('')
    try {
      const next = await window.electron.terminal.conversationCommand(terminalId, { type: 'mode', mode })
      if (request !== switchRequest.current) return
      accept(next)
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setModeTransition(mode)
        transitionTimer.current = setTimeout(() => {
          transitionTimer.current = null
          switchLocked.current = false
          setModeTransition(null)
        }, 220)
      } else switchLocked.current = false
    }
    catch (e) {
      if (request === switchRequest.current) { setError(String(e)); switchLocked.current = false }
    }
    finally {
      if (request === switchRequest.current) { setSwitching(false); setRequestedMode(null) }
    }
  }
  const canSend = snapshot?.capabilities.submit && snapshot.connection === 'ready' && !snapshot.turnId && !snapshot.submitting && !snapshot.settingsUpdating && !snapshot.approvals.length && !snapshot.needsTerminal && !busy && !transitioning
  const send = async () => {
    if (editing || !canSend || !draft.trim() || !snapshot || busyRef.current || switchLocked.current) return
    const text = draft
    const commandId = crypto.randomUUID()
    // Move and show activity immediately, before IPC or the first native snapshot.
    setPendingSend(commandId)
    follow.current = true
    setShowLatest(false)
    try {
      if (await action({ type: 'send', text, commandId, controlEpoch: snapshot.controlEpoch })) {
        const current = useWorkspaceStore.getState().terminals.find(item => item.id === terminalId)
        if (current?.conversationDraft === text) setDraft('')
      }
    } finally {
      setPendingSend(current => current === commandId ? null : current)
    }
  }
  const cancelEdit = () => {
    if (busyRef.current) return
    setEditing(null); setError('')
    requestAnimationFrame(() => {
      const trigger = editing && scrollRef.current?.querySelector<HTMLButtonElement>(`[data-user-message="${CSS.escape(editing.item.id)}"] [data-message-edit]`)
      if (trigger) trigger.focus({ preventScroll: true })
      else inputRef.current?.focus()
    })
  }
  const submitEdit = async () => {
    if (!editing || !canSend || !editing.text.trim() || !snapshot || busyRef.current || switchLocked.current) return
    const commandId = crypto.randomUUID()
    setPendingSend(commandId)
    // Retain the editing position while the native history is replaced.
    follow.current = false
    try {
      if (await action({ type: 'edit', itemId: editing.item.id, text: editing.text, commandId, controlEpoch: editing.epoch })) {
        setEditing(null); follow.current = true; setShowLatest(false)
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })
      }
    } finally { setPendingSend(current => current === commandId ? null : current) }
  }
  const editor = editing && <ConversationMessageEditor text={editing.text} setText={text => setEditing(current => current && { ...current, text })}
    busy={Boolean(pendingSend)} disabled={!canSend} error={error || snapshot?.error || ''} cancel={cancelEdit} submit={submitEdit} />
  const openFile = async (filePath: string) => {
    if (!terminal) return
    try { await window.electron.window.openEditor({ filePath, workspacePath: terminal.cwd }) }
    catch (e) { setError(String(e)) }
  }
  useLayoutEffect(() => {
    if (terminalHost.current) terminalHost.current.inert = conversation || !visible || transitioning
    if (conversationHost.current) conversationHost.current.inert = !conversation || !visible || transitioning
  }, [conversation, visible, transitioning])

  return <section className={styles.root} data-agent-session={terminalId} data-view-transition={modeTransition ?? undefined} data-switching={switching || undefined} aria-busy={switching || undefined}>
    <header className={styles.header}>
      <div className={styles.toggle} data-mode={requestedMode ?? (conversation ? 'conversation' : 'terminal')} data-switching={transitioning || undefined} role="group" aria-label={t('conversation.display')}>
        <span className={styles.toggleIndicator} aria-hidden="true" />
        <button type="button" aria-pressed={!conversation} disabled={transitioning || busy || !!editing || !snapshot} onClick={() => void changeMode('terminal')}><TerminalSquare size={14} aria-hidden="true" />{t('conversation.terminal')}</button>
        <button type="button" aria-pressed={conversation} disabled={transitioning || busy || !!editing || !snapshot} onClick={() => void changeMode('conversation')}><MessageSquare size={14} aria-hidden="true" />{t('conversation.dialog')}</button>
      </div>
    </header>
    {!conversation && (error || snapshot?.error) && <p className={styles.error} role="alert">{error || snapshot?.error}</p>}
    <div className={styles.body}>
      <div ref={terminalHost} className={`${styles.terminal} ${modeTransition === 'terminal' ? styles.viewEntering : ''}`} style={{ visibility: conversation ? 'hidden' : 'visible', pointerEvents: conversation || transitioning ? 'none' : 'auto' }} aria-hidden={conversation}>
        <CLITerminal terminalId={terminalId} visible={visible && !conversation} focused={focused && !conversation && !transitioning} workspaceVisible={workspaceVisible} />
        <TurnChangeIsland terminalId={terminalId} focused={visible && focused && !conversation && !transitioning} />
      </div>
      <div ref={conversationHost} className={`${styles.conversation} ${modeTransition === 'conversation' ? styles.viewEntering : ''}`} hidden={!conversation} data-empty={empty}>
        <div className={styles.scroll} ref={scrollRef} role="region" aria-label={t('conversation.history')} tabIndex={0} onScroll={event => {
          const el = event.currentTarget
          readingTop.current = el.scrollTop
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
          setShowLatest(!follow.current)
        }} onBlur={() => {
          if (scrollRef.current) useWorkspaceStore.getState().updateTerminal(terminalId, { conversationScrollTop: scrollRef.current.scrollTop })
        }}>
          <div className={styles.content}>
            {empty && <div className={styles.empty}><div className={styles.emptyIdentity}><TerminalSquare size={17} aria-hidden="true" />{snapshot && t(`provider.${snapshot.engine}`)}</div><h2>{t('conversation.emptyTitle')}</h2><p>{t('conversation.emptyHint')}</p></div>}
            {snapshot?.truncated && <p className={styles.notice}>{t('conversation.truncated')}</p>}
            {snapshot?.items.map((item, index) => item.type === 'userMessage' ? <div className={styles.userMessage} key={item.id} data-user-message={item.id}>{editing?.item.id === item.id ? editor : <><div className={styles.user}>{item.text}</div><ConversationMessageActions item={item} editDisabled={!canSend || !!editing || working}
              onEdit={snapshot.capabilities.edit && !item.truncated && item.editable !== false ? () => {
                if (!canSend || working || busyRef.current) return
                follow.current = false; setError('')
                setEditing({ item, text: item.text, threadId: snapshot.threadId, epoch: snapshot.controlEpoch })
              } : undefined} /></>}</div>
              : item.type === 'agentMessage' ? <article className={styles.answer} key={item.id} hidden={!item.text}>
                {(snapshot.items[index - 1]?.type !== 'agentMessage' || snapshot.items[index - 1]?.turnId !== item.turnId) && <div className={styles.answerIdentity}><TerminalSquare size={14} aria-hidden="true" /><span>{t(`provider.${snapshot.engine}`)}</span></div>}
                <MarkdownContent content={item.text} variant="conversation" />{item.truncated && <p>{t('conversation.truncated')}</p>}{item.text && item.status !== 'inProgress' && <ConversationMessageActions item={item} />}
              </article>
                : <details className={styles.activity} key={item.id} data-state={item.status}>
                  <summary><ChevronRight size={14} className={styles.chevron} aria-hidden="true" /><span>{t(`conversation.kind.${item.type}`, { defaultValue: t('conversation.activity') })}</span>
                    <span className={styles.activityPreview}>{item.files?.length ? item.files.map(file => file.path.split(/[\\/]/).pop()).join(', ') : item.text.split('\n')[0]}</span>
                    <span className={styles.activityState} data-state={item.status}>{item.status === 'completed' && <Check size={12} aria-hidden="true" />}{t(`conversation.state.${item.status}`, { defaultValue: item.status })}</span></summary>
                  <div className={styles.activityBody}>
                    {item.text && <pre>{item.text}</pre>}
                    {item.files?.map(file => <div className={styles.file} key={file.path}>
                      <button type="button" onClick={() => void openFile(file.path)} aria-label={file.path} title={`${t('conversation.openFile')} · ${file.path}`}><FileCode2 size={15} aria-hidden="true" /><span>{file.path.split(/[\\/]/).pop()}</span><span className={styles.filePath}>{file.path}</span></button>
                      <pre className={styles.diff}>{file.diff.split('\n').map((line, index) => <span key={index} data-change={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'delete' : undefined}>{line}{'\n'}</span>)}</pre>
                    </div>)}
                    {item.truncated && <p>{t('conversation.truncated')}</p>}
                  </div>
                </details>)}
            {editing && !snapshot?.items.some(item => item.id === editing.item.id) && <div className={styles.userMessage}>{editor}</div>}
            {working && !snapshot?.approvals.length && !snapshot?.needsTerminal && <div className={styles.thinking} role="status"><span className={styles.statusDot} aria-hidden="true" /><span>{t('conversation.thinking')}</span>{visible && snapshot?.turnId && <ConversationDuration startedAt={snapshot.turnStartedAt} />}</div>}
            {pastPlans.length > 0 && <details className={styles.planHistory}><summary>{t('conversation.planHistory')}</summary>{pastPlans.map(plan => <ConversationPlanPanel key={`${snapshot?.threadId}:${plan.turnId}:${plan.version}`} plan={plan} connection={snapshot!.connection} historical />)}</details>}
            {snapshot?.approvals.map(approval => <div className={styles.approval} key={approval.id} role="group" aria-label={t('conversation.approval')}>
              <strong><ShieldCheck size={17} aria-hidden="true" />{t(approval.kind === 'file' ? 'conversation.approveFile' : 'conversation.approveCommand')}</strong>
              {approval.description && <pre>{approval.description}</pre>}
              <div><button type="button" disabled={busy || switching} onClick={() => void action({ type: 'approve', requestId: approval.id, decision: 'decline', controlEpoch: snapshot.controlEpoch })}>{t('conversation.decline')}</button>
                <button type="button" className={styles.primary} disabled={busy || switching} onClick={() => void action({ type: 'approve', requestId: approval.id, decision: 'accept', controlEpoch: snapshot.controlEpoch })}>{t('conversation.accept')}</button></div>
            </div>)}
            {(!snapshot || snapshot.connection === 'starting') && !error && !snapshot?.error && <p className={styles.notice} role="status">{t('conversation.starting')}</p>}
            {snapshot?.needsTerminal && <p className={styles.notice}>{t('conversation.useTerminal')} <button type="button" onClick={() => void changeMode('terminal')}>{t('conversation.terminal')}</button></p>}
            {!editing && (error || snapshot?.error) && <p className={styles.error} role="alert">{error || snapshot?.error}</p>}
          </div>
        </div>
        <div className={styles.latestAnchor}>{showLatest && <button type="button" className={styles.latest} aria-label={t('conversation.latest')} title={t('conversation.latest')} onClick={() => {
          follow.current = true; setShowLatest(false)
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }}><ArrowDown size={16} aria-hidden="true" /></button>}</div>
        {currentPlan && <div className={styles.planDock}><ConversationPlanPanel key={`${terminalId}:${snapshot?.threadId}:${currentPlan.turnId}`} plan={currentPlan} connection={snapshot!.connection} /></div>}
        {(!snapshot || snapshot.capabilities.submit) ? <AgentComposer snapshot={snapshot} draft={draft} setDraft={setDraft} inputRef={inputRef} canSend={Boolean(canSend && !editing)} busy={busy || !!editing} switching={transitioning} send={send} action={action} changeMode={changeMode} />
          : <div className={styles.readOnly}><span>{t('conversation.readOnly')}</span><button type="button" onClick={() => void changeMode('terminal')}>{t('conversation.openTerminalCommand')}</button></div>}
      </div>
      {transitioning && <div className={styles.modeLoading} role="status" aria-live="polite"><span className={styles.modeSpinner} aria-hidden="true" />{t('conversation.switching')}</div>}
    </div>
  </section>
})
