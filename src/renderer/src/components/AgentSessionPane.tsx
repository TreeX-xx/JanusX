import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Clock, LoaderCircle, CircleAlert, Undo2, Trash2, ArrowDown, Check, ChevronRight, FileCode2, ShieldCheck, TerminalSquare, MessageSquare } from 'lucide-react'
import type { ConversationCommand, ConversationItem, ConversationSnapshot } from '../../../shared/conversation-display'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRightToolStore } from '@/stores/right-tools'
import { useConversationOutbox, bindConversationOutbox, conversationOutbox, enqueueConversationMessage, observeConversationOutbox, removeOutgoingMessage } from '@/stores/conversation-outbox'
import { WorkDisclosure } from './chat/WorkDisclosure'
import { ConversationFileChanges } from './ConversationFileChanges'
import { ConversationImages } from './ConversationImages'
import { conversationImageText } from '../../../shared/conversation-images'
import { createConversationTurns } from '../lib/conversation-turns'
import { VirtualHistory, LazyDetails } from './chat/VirtualHistory'
import { MarkdownContent } from './chat/ChatContent'
import { ConversationStartupPanel } from './ConversationStartupPanel'
import { CLITerminal } from './CLITerminal'
import { TerminalPresetIcon } from './ui/TerminalPresetIcon'
import { TurnChangeIsland } from './TurnChangeIsland'
import { AgentComposer } from './AgentComposer'
import { ConversationQuestions } from './ConversationQuestions'
import { hasBlockingQuestions } from '../../../shared/conversation-questions'
import { ConversationPlanPanel } from './ConversationPlanPanel'
import { ConversationDuration } from './ConversationDuration'
import { ConversationMessageActions } from './ConversationMessageActions'
import { ConversationMessageEditor } from './ConversationMessageEditor'
import { ConversationPrompt } from './ConversationPrompt'
import styles from './AgentSessionPane.module.css'
import { conversationPrompt, activeConversationReferences, MAX_CONVERSATION_ATTACHMENTS, type ConversationReference } from '../../../shared/conversation-context'
import type { ConversationInputHandle } from './ConversationInput'
import { useConversationContext, setConversationReferences } from '../stores/conversation-context'
import { inputHistoryScope, rememberConversationInput } from '../stores/conversation-input-history'

export const AgentSessionPane = memo(function AgentSessionPane({ terminalId, visible, focused, workspaceVisible }: {
  terminalId: string; visible: boolean; focused: boolean; workspaceVisible: boolean
}) {
  const { t } = useTranslation('terminal')
  const references = useConversationContext(state => state.entries[terminalId]) ?? []
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingSend, setPendingSend] = useState<string | null>(null)
  const outgoing = useConversationOutbox(s => s.entries[terminalId]) ?? []
  const delivering = outgoing.some(item => item.status === 'sending' || item.status === 'accepted')
  const sending = outgoing.some(item => item.status === 'sending')
  const [editing, setEditing] = useState<{ item: ConversationItem; text: string; threadId: string | null; epoch: number } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [modeTransition, setModeTransition] = useState<'terminal' | 'conversation' | null>(null)
  const [showLatest, setShowLatest] = useState(false)
  const busyRef = useRef(false)
  const latest = useRef<ConversationSnapshot | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<ConversationInputHandle>(null)
  const terminalHost = useRef<HTMLDivElement>(null)
  const conversationHost = useRef<HTMLDivElement>(null)
  const composerOrigin = useRef<{ terminalId: string; top: number } | null>(null)
  const follow = useRef(true)
  const readingTop = useRef<number | undefined>(undefined)
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const switchRequest = useRef(0)
  const switchLocked = useRef(false)
  const [requestedMode, setRequestedMode] = useState<'terminal' | 'conversation' | null>(null)
  // Draft changes belong to AgentComposer; do not subscribe the history tree to them.
  // Contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
  const terminal = useWorkspaceStore(useShallow(s => {
    const row = s.terminals.find(item => item.id === terminalId)
      ?? Object.values(s.terminalSnapshots).flatMap(entry => entry.terminals).find(item => item.id === terminalId)
    return row && { pid: row.pid, cwd: row.cwd, workspaceId: row.workspaceId, preset: row.preset,
      conversationInitialView: row.conversationInitialView, conversationScrollTop: row.conversationScrollTop }
  }))
  const identityPreset = snapshot?.engine ?? terminal?.preset ?? 'shell'
  const historyScope = inputHistoryScope(terminal?.workspaceId ?? '', terminal?.cwd ?? '', snapshot?.engine ?? '')
  const projectPath = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId && workspace.id === terminal?.workspaceId)?.path)
  // GitPanel owns the active project root; never route a worktree diff to another checkout.
  const canReviewProject = !!projectPath && projectPath.replace(/\\/g, '/').replace(/\/$/, '') === terminal?.cwd.replace(/\\/g, '/').replace(/\/$/, '')
  const setDraft = (text: string) => useWorkspaceStore.getState().updateTerminal(terminalId, { conversationDraft: text })
  const conversation = (snapshot?.mode ?? terminal?.conversationInitialView) === 'conversation'
  const startup = snapshot?.startup
  const startupActive = Boolean(startup && startup.status !== 'cancelled')
  const starting = !startup && (!snapshot || snapshot.connection === 'starting') && !error && !snapshot?.error
  const terminalVisible = !conversation
  const transitioning = switching || modeTransition !== null
  const newestPlan = snapshot?.plans?.at(-1)
  const currentPlan = newestPlan && (!snapshot?.turnId || newestPlan.turnId === snapshot.turnId) ? newestPlan : undefined
  const pastPlans = snapshot?.plans?.filter(plan => plan !== currentPlan) ?? []
  // Drop cached turn identities when the native session changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projectTurns = useMemo(() => createConversationTurns(), [terminalId, snapshot?.threadId])
  const turns = useMemo(() => projectTurns(snapshot?.items ?? [], snapshot?.turnId ?? null), [projectTurns, snapshot?.items, snapshot?.turnId])
  const working = Boolean(pendingSend || delivering || snapshot?.turnId || snapshot?.submitting || snapshot?.backgroundTasks)
  const empty = !outgoing.length && !editing && !working && !snapshot?.items.length && !snapshot?.approvals.length && !snapshot?.questions?.length && !snapshot?.plans?.length

  const accept = useCallback((next: ConversationSnapshot) => {
    if (next.id !== terminalId || (latest.current && next.revision < latest.current.revision)) return
    latest.current = next
    observeConversationOutbox(next)
    if (visibleRef.current) setSnapshot(latest.current)
  }, [terminalId])
  useEffect(() => {
    let mounted = true
    bindConversationOutbox(terminalId, terminal?.pid ?? undefined)
    latest.current = null
    setSnapshot(null)
    setError('')
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
  }, [visible, conversation, snapshot?.revision, outgoing.length])
  useEffect(() => {
    if (!visible || !focused || transitioning) return
    if (conversation && !startupActive) { if (!editing) inputRef.current?.focus() }
    else if (!conversation) terminalHost.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
  }, [visible, focused, conversation, startupActive, transitioning, snapshot?.capabilities.submit, editing])
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
    const composer = inputRef.current?.form
    if (!visible || !conversation || transitioning || !composer) {
      composerOrigin.current = null
      return
    }
    const origin = composerOrigin.current
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: Animation | undefined
    const remember = () => {
      // Store layout coordinates, never an intermediate animated position.
      if (animation?.playState === 'running' || animation?.playState === 'paused') return
      composerOrigin.current = { terminalId, top: composer.getBoundingClientRect().top }
    }
    const destination = composer.getBoundingClientRect().top
    composerOrigin.current = { terminalId, top: destination }
    if (origin?.terminalId === terminalId && !motion.matches) {
      const offset = origin.top - destination
      if (Math.abs(offset) >= 1) {
        // The same mounted form moves both into history and back to the empty state.
        animation = composer.animate([
          { transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' },
        ], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' })
        animation.onfinish = remember
      }
    }
    const observer = new ResizeObserver(remember)
    observer.observe(composer)
    if (conversationHost.current) observer.observe(conversationHost.current)
    if (scrollRef.current) observer.observe(scrollRef.current)
    const cancel = () => { animation?.cancel(); remember() }
    motion.addEventListener('change', cancel)
    return () => {
      observer.disconnect()
      animation?.cancel()
      motion.removeEventListener('change', cancel)
    }
  }, [empty, conversation, visible, transitioning, terminalId, snapshot?.capabilities.submit])

  const action = async (command: ConversationCommand): Promise<boolean> => {
    if (busyRef.current || switchLocked.current || !visible) return false
    busyRef.current = true; setBusy(true); setError('')
    try { accept(await window.electron.terminal.conversationCommand(terminalId, command)); if (command.type === 'new') setConversationReferences(terminalId, () => []); return true }
    catch (e) { setError(String(e)); return false }
    finally { busyRef.current = false; setBusy(false) }
  }
  const changeMode = async (mode: 'terminal' | 'conversation') => {
    if (switchLocked.current || editing || busyRef.current || conversationOutbox(terminalId).some(item => item.status === 'sending') || !visible || snapshot?.mode === mode) return
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
  const canSend = snapshot?.capabilities.submit && snapshot.connection === 'ready' && !snapshot.turnId && !snapshot.submitting && !snapshot.settingsUpdating && !snapshot.approvals.length && !hasBlockingQuestions(snapshot) && !snapshot.needsTerminal && !busy && !transitioning
  const canEnqueue = snapshot?.capabilities.submit && snapshot.connection === 'ready' && !snapshot.needsTerminal && !busy && !transitioning && outgoing.length < 100
  const send = async (delivery?: 'queue' | 'steer') => {
    if (editing || !canEnqueue || !snapshot || busyRef.current || switchLocked.current) return
    // Read synchronously: a second Enter before React renders must not send the old draft again.
    const text = useWorkspaceStore.getState().terminals.find(item => item.id === terminalId)?.conversationDraft ?? ''
    const refs = activeConversationReferences(text, useConversationContext.getState().entries[terminalId] ?? [])
    const prompt = conversationPrompt(text, refs)
    if (prompt.length > 32000) { setError(t('conversation.context.tooLong')); return }
    if (!enqueueConversationMessage(snapshot, prompt, delivery, snapshot.engine === 'codex' ? refs.filter(ref => ref.kind === 'image').map(ref => ref.path) : undefined, refs, text)) return
    setError('')
    rememberConversationInput(historyScope, prompt)
    setConversationReferences(terminalId, () => [])
    setDraft('')
    follow.current = true
    setShowLatest(false)
  }
  const addFeedback = (path: string, quote: string, turnId: string) => {
    const refs = useConversationContext.getState().entries[terminalId] ?? []
    if (refs.length >= MAX_CONVERSATION_ATTACHMENTS) { setError(t('conversation.context.limit')); return }
    if (quote.length > 8000) { setError(t('conversation.context.selectionLong')); return }
    const ref: ConversationReference = { id: crypto.randomUUID(), name: path.split(/[\\/]/).pop() ?? path, path, kind: 'diff', quote: `Turn ${turnId} (historical diff, not current file):\n${quote}` }
    setConversationReferences(terminalId, current => [...current, ref])
    inputRef.current?.focus()
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
    if (!editing || !canSend || outgoing.length || !editing.text.trim() || !snapshot || busyRef.current || switchLocked.current) return
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
    const resolvedPath = /^(?:[a-z]:[\\/]|[\\/])/i.test(filePath) ? filePath : `${terminal.cwd.replace(/[\\/]+$/, '')}/${filePath}`
    try { await window.electron.window.openEditor({ filePath: resolvedPath, workspacePath: terminal.cwd }) }
    catch (e) { setError(String(e)) }
  }
  useLayoutEffect(() => {
    if (terminalHost.current) terminalHost.current.inert = !terminalVisible || !visible || transitioning
    if (conversationHost.current) conversationHost.current.inert = !conversation || !visible || transitioning
  }, [conversation, terminalVisible, visible, transitioning])

  return <section className={styles.root} data-agent-session={terminalId} data-view-transition={modeTransition ?? undefined} data-switching={switching || undefined} aria-busy={switching || undefined}>
    <header className={styles.header}>
      <div className={styles.toggle} data-mode={requestedMode ?? (conversation ? 'conversation' : 'terminal')} data-switching={transitioning || undefined} role="group" aria-label={t('conversation.display')}>
        <span className={styles.toggleIndicator} aria-hidden="true" />
        <button type="button" aria-pressed={!conversation} disabled={transitioning || busy || !!editing || sending || !snapshot || (snapshot.engine === 'codex' && snapshot.connection === 'starting')} onClick={() => void changeMode('terminal')}><TerminalSquare size={14} aria-hidden="true" />{t('conversation.terminal')}</button>
        <button type="button" aria-pressed={conversation} disabled={transitioning || busy || !!editing || sending || !snapshot || (snapshot.engine === 'codex' && snapshot.connection === 'starting')} onClick={() => void changeMode('conversation')}><MessageSquare size={14} aria-hidden="true" />{t('conversation.dialog')}</button>
      </div>
    </header>
    {!conversation && (error || snapshot?.error) && <p className={styles.error} role="alert">{error || snapshot?.error}</p>}
    <div className={styles.body}>
      <div ref={terminalHost} className={`${styles.terminal} ${modeTransition === 'terminal' ? styles.viewEntering : ''}`} style={{ visibility: terminalVisible ? 'visible' : 'hidden', pointerEvents: !terminalVisible || transitioning ? 'none' : 'auto' }} aria-hidden={!terminalVisible}>
        <CLITerminal terminalId={terminalId} visible={visible && terminalVisible} focused={focused && terminalVisible && !transitioning} workspaceVisible={workspaceVisible} />
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
            {startupActive && startup && <ConversationStartupPanel key={startup.id} startup={startup} epoch={snapshot!.controlEpoch} busy={busy} action={action} />}
            {(starting || (empty && !startupActive)) && <div className={styles.welcome} data-conversation-welcome data-loading={starting} data-animate={starting && visible && conversation}>
              <div className={styles.startingIdentity}><span className={styles.startingMark} aria-hidden="true"><TerminalPresetIcon preset={identityPreset} style={{ width: 20, height: 20 }} /><span className={styles.startingRing} /></span><span>{t(`provider.${identityPreset}`)}</span></div>
              <div className={styles.welcomeLayers}>
                <div className={styles.starting} data-active={starting} data-conversation-loading={starting ? '' : undefined} aria-hidden={!starting} role={starting ? 'status' : undefined} aria-live={starting ? 'polite' : undefined}>
                  <h2>{t('conversation.starting')}</h2><p>{t('conversation.startingHint')}</p>
                  <div className={styles.startingLines} aria-hidden="true"><span /><span /><span /></div>
                </div>
                <div className={styles.empty} data-active={!starting} aria-hidden={starting}><h2>{t('conversation.emptyTitle')}</h2><p>{t('conversation.emptyHint')}</p></div>
              </div>
            </div>}
            {snapshot?.truncated && <p className={styles.notice}>{t('conversation.truncated')}</p>}
            {snapshot && <VirtualHistory key={terminalId + ':' + snapshot.threadId} items={turns} itemKey={turn => turn.key} scrollRef={scrollRef} following={follow} active={visible && conversation} pinnedKey={editing?.item.turnId} renderItem={turn => turn.groups.map((group, groupIndex) => {
              const renderNodes = () => group.items.map((item, index) => item.type === 'userMessage' ? <div className={styles.userMessage} key={item.id} data-user-message={item.id}>{editing?.item.id === item.id ? editor : <><div className={styles.user}><ConversationPrompt text={item.text} /></div><ConversationMessageActions item={item} editDisabled={!canSend || !!editing || working || !!outgoing.length}
              onEdit={snapshot.capabilities.edit && !item.truncated && item.editable !== false ? () => {
                if (!canSend || working || outgoing.length || busyRef.current) return
                follow.current = false; setError('')
                setEditing({ item, text: item.text, threadId: snapshot.threadId, epoch: snapshot.controlEpoch })
              } : undefined} /></>}</div>
              : item.images?.length || item.type === 'imageGeneration' ? <article className={styles.answer} key={item.id}>
                <div className={styles.answerIdentity}><TerminalPresetIcon preset={identityPreset} style={{ width: 14, height: 14, flexShrink: 0 }} /><span>{t('conversation.images.result')}</span>
                  <span>{t(`conversation.state.${item.status}`, { defaultValue: item.status })}</span></div>
                {item.text && <MarkdownContent content={conversationImageText(item.text, (item.images ?? []).flatMap(image => image.source ? [image.source] : []))} variant="conversation" workspacePath={terminal?.cwd} />}
                <ConversationImages terminalId={terminalId} itemId={item.id} images={item.images ?? []} canReference={Boolean(canSend && !busy && !switching && references.length < MAX_CONVERSATION_ATTACHMENTS)}
                  onReference={image => {
                    if (!image.path) return
                    setConversationReferences(terminalId, current => current.some(ref => ref.path === image.path) || current.length >= MAX_CONVERSATION_ATTACHMENTS ? current : [...current, { id: image.id, name: 'generated-image.' + (image.mimeType?.split('/')[1] ?? 'png'), path: image.path!, kind: 'image' }])
                    inputRef.current?.focus()
                  }} />
              </article>
              : item.type === 'agentMessage' ? <article className={styles.answer} key={item.id} hidden={!item.text}>
                {(group.items[index - 1] ?? turn.groups[groupIndex - 1]?.items.at(-1))?.type !== 'agentMessage' && <div className={styles.answerIdentity}><TerminalPresetIcon preset={identityPreset} style={{ width: 14, height: 14, flexShrink: 0 }} /><span>{t(`provider.${snapshot.engine}`)}</span></div>}
                <MarkdownContent content={item.text} variant="conversation" workspacePath={terminal?.cwd} />{item.truncated && <p>{t('conversation.truncated')}</p>}{item.text && item.status !== 'inProgress' && <ConversationMessageActions item={item} />}
              </article>
                : <LazyDetails stateKey={item.id} className={styles.activity} key={item.id} data-state={item.status} summary={
                  <summary><ChevronRight size={14} className={styles.chevron} aria-hidden="true" /><span>{t(`conversation.kind.${item.type}`, { defaultValue: t('conversation.activity') })}</span>
                    <span className={styles.activityPreview}>{item.files?.length ? item.files.map(file => file.path.split(/[\\/]/).pop()).join(', ') : item.text.split('\n')[0]}</span>
                    <span className={styles.activityState} data-state={item.status}>{item.status === 'completed' && <Check size={12} aria-hidden="true" />}{t(`conversation.state.${item.status}`, { defaultValue: item.status })}</span></summary>}>{() => <div className={styles.activityBody}>
                    {item.text && <pre>{item.text}</pre>}
                    {item.files?.map(file => <div className={styles.file} key={file.path}>
                      <button type="button" onClick={() => void openFile(file.path)} aria-label={file.path} title={`${t('conversation.openFile')} · ${file.path}`}><FileCode2 size={15} aria-hidden="true" /><span>{file.path.split(/[\\/]/).pop()}</span><span className={styles.filePath}>{file.path}</span></button>
                      <pre className={styles.diff}>{file.diff.split('\n').map((line, index) => <span key={index} data-change={line.startsWith('+') ? 'add' : line.startsWith('-') ? 'delete' : undefined}>{line}{'\n'}</span>)}</pre>
                    </div>)}
                    {item.truncated && <p>{t('conversation.truncated')}</p>}
                  </div>}
                </LazyDetails>)
              const turnId = group.items[0].turnId
              const changes = turn.changes
              const lastGroup = turn.groups[groupIndex + 1]?.items[0].turnId !== turnId
              return <div key={group.items[0].id}>
                {group.process ? <WorkDisclosure stateKey={group.items[0].id} activity={group.activity} summary={{ ...group.summary,
                  waiting: group.items.filter(item => snapshot.approvals.some(approval => approval.itemId === item.id) || snapshot.questions?.some(request => request.itemId === item.id)).length || group.summary.waiting,
                  incomplete: group.summary.incomplete || !!snapshot.truncated }} settled={group.settled && !snapshot.truncated}>{renderNodes}</WorkDisclosure> : renderNodes()}
                {lastGroup && changes && snapshot.turnId !== turnId && <ConversationFileChanges turnId={turnId} files={changes.files} incomplete={changes.incomplete || snapshot.truncated} openFile={openFile} onReview={canReviewProject ? () => useRightToolStore.getState().openTool('git') : undefined} onFeedback={snapshot.capabilities.submit ? (path, quote) => addFeedback(path, quote, turnId) : undefined} />}
              </div>
            })} />}
            {outgoing.map(item => <div className={styles.userMessage} key={item.id} data-outgoing-message={item.id} data-delivery={item.status}>
              <div className={styles.user}><ConversationPrompt text={item.text} /></div>
              <div className={styles.delivery} role="status">
                <span title={t(`conversation.delivery.${item.status}`)} aria-label={t(`conversation.delivery.${item.status}`)} role="img">{item.status === 'queued' ? <Clock size={14} /> : item.status === 'sending' ? <LoaderCircle size={14} /> : item.status === 'accepted' ? <Check size={14} /> : <CircleAlert size={14} />}</span>
                {(item.status === 'queued' || item.status === 'failed') && <button type="button" title={t('conversation.delivery.restore')} aria-label={t('conversation.delivery.restore')} onClick={() => {
                  if (references.length + (item.references?.filter(ref => !references.some(old => old.id === ref.id)).length ?? 0) > MAX_CONVERSATION_ATTACHMENTS) { setError(t('conversation.context.limit')); return }
                  const draft = useWorkspaceStore.getState().terminals.find(terminal => terminal.id === terminalId)?.conversationDraft ?? ''
                  setDraft(draft ? `${draft}\n\n${item.draftText ?? item.text}` : item.draftText ?? item.text)
                  if (item.references?.length) setConversationReferences(terminalId, current => [...current, ...item.references!.filter(ref => !current.some(old => old.id === ref.id))])
                  removeOutgoingMessage(terminalId, item.id); inputRef.current?.focus()
                }}><Undo2 size={14} aria-hidden="true" /></button>}
                {(item.status === 'queued' || item.status === 'failed') && <button type="button" title={t('conversation.delivery.remove')} aria-label={t('conversation.delivery.remove')} onClick={() => removeOutgoingMessage(terminalId, item.id)}><Trash2 size={14} aria-hidden="true" /></button>}
              </div>
              {item.error && <p className={styles.error} role="alert">{item.error}</p>}
            </div>)}
            {editing && !snapshot?.items.some(item => item.id === editing.item.id) && <div className={styles.userMessage}>{editor}</div>}
            {working && !snapshot?.approvals.length && !snapshot?.questions?.length && !snapshot?.needsTerminal && <div className={styles.thinking} role="status"><span className={styles.statusDot} aria-hidden="true" /><span>{t('conversation.thinking')}</span>{visible && snapshot?.turnId && <ConversationDuration startedAt={snapshot.turnStartedAt} />}</div>}
            {pastPlans.length > 0 && <details className={styles.planHistory}><summary>{t('conversation.planHistory')}</summary>{pastPlans.map(plan => <ConversationPlanPanel key={`${snapshot?.threadId}:${plan.turnId}:${plan.version}`} plan={plan} connection={snapshot!.connection} historical />)}</details>}
            {snapshot?.approvals.map(approval => <div className={styles.approval} key={approval.id} role="group" aria-label={t('conversation.approval')}>
              <strong><ShieldCheck size={17} aria-hidden="true" />{t(approval.kind === 'file' ? 'conversation.approveFile' : 'conversation.approveCommand')}</strong>
              {approval.description && <pre>{approval.description}</pre>}
              <div>{(approval.choices ?? [{ id: 'decline', label: t('conversation.decline') }, { id: 'accept', label: t('conversation.accept') }]).map(choice => <button key={choice.id} type="button" title={choice.description} className={choice.id === 'accept' ? styles.primary : undefined} disabled={busy || switching || snapshot.connection !== 'ready'} onClick={() => void action({ type: 'approve', requestId: approval.id, decision: choice.id, controlEpoch: snapshot.controlEpoch })}>{t(`conversation.approvalChoices.${choice.id}`, { defaultValue: choice.label })}</button>)}</div>
            </div>)}
            {snapshot?.questions?.map(request => <ConversationQuestions key={`${snapshot.threadId}:${typeof request.id}:${request.id}:${request.version}`} request={request} disabled={busy || transitioning || snapshot.connection !== 'ready' || !visible || !conversation}
              answer={answer => void action({ type: 'answer', requestId: request.id, version: request.version, answer, controlEpoch: snapshot.controlEpoch })} />)}
            {startup?.status === 'cancelled' && <p className={styles.notice}>{t('conversation.startupPaused')} <button type="button" disabled={busy} onClick={() => void action({ type: 'startup', startupId: startup.id, action: 'resume', controlEpoch: snapshot!.controlEpoch })}>{t('conversation.startupResume')}</button></p>}
            {snapshot?.needsTerminal && <p className={styles.notice}>{t('conversation.useTerminal')} <button type="button" onClick={() => void changeMode('terminal')}>{t('conversation.terminal')}</button></p>}
            {!editing && (error || snapshot?.error) && <p className={styles.error} role="alert">{error || snapshot?.error}</p>}
          </div>
        </div>
        <div className={styles.latestAnchor}>{showLatest && <button type="button" className={styles.latest} aria-label={t('conversation.latest')} title={t('conversation.latest')} onClick={() => {
          follow.current = true; setShowLatest(false)
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }}><ArrowDown size={16} aria-hidden="true" /></button>}</div>
        {currentPlan && <div className={styles.planDock}><ConversationPlanPanel key={`${terminalId}:${snapshot?.threadId}:${currentPlan.turnId}`} plan={currentPlan} connection={snapshot!.connection} /></div>}
        {(!snapshot || snapshot.capabilities.submit) ? <AgentComposer terminalId={terminalId} historyScope={historyScope} workspacePath={terminal?.cwd} references={references} snapshot={snapshot} visible={visible && conversation} setDraft={setDraft} inputRef={inputRef} canSend={Boolean(canEnqueue && !editing)} hasOutgoing={!!outgoing.length} busy={busy || !!editing} switching={transitioning} send={send} action={action} changeMode={changeMode} />
          : <div className={styles.readOnly}><span>{t('conversation.readOnly')}</span><button type="button" onClick={() => void changeMode('terminal')}>{t('conversation.openTerminalCommand')}</button></div>}
      </div>
      {transitioning && <div className={styles.modeLoading} role="status" aria-live="polite"><span className={styles.modeSpinner} aria-hidden="true" />{t('conversation.switching')}</div>}
    </div>

  </section>
})
