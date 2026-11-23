import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { findTerminalInState, useWorkspaceStore } from '../stores/workspace'
import { useTranslation } from 'react-i18next'
import { useBrowserOcclusion } from '@/hooks/useBrowserOcclusion'
import { useOutsidePress } from '@/hooks/useOutsidePress'
import { ArrowUp, Check, ChevronDown, Square, Sparkles, Terminal, FileText, Command, Plus, SlidersHorizontal, RefreshCw } from 'lucide-react'
import { parseConversationSlashCommand, type ConversationCommand, type ConversationSnapshot, type ConversationSpeedTier } from '../../../shared/conversation-display'
import styles from './AgentSessionPane.module.css'
import { ConversationContext } from './ConversationContext'
import { ConversationInput, type ConversationInputHandle } from './ConversationInput'
import { activeConversationReferences, type ConversationReference } from '../../../shared/conversation-context'
import { insertConversationNewline } from '../lib/conversation-input'
import { InputHistoryCursor, rememberConversationInput, mergeInputHistory, useConversationInputHistory, type InputHistoryEntry } from '../stores/conversation-input-history'
import { EffortActivation, EffortGlyph, effortToneClass } from './ReasoningEffort'
import { SpeedGlyph, SpeedTrace, speedLevel, type SpeedLevel } from './ResponseSpeed'
import { ComposerOptions, ComposerOptionTrigger, composerOptionIndex, type ComposerChoice as Choice } from './ComposerOptions'
import optionStyles from './ComposerOptions.module.css'

// Interaction contract: .agents/notes/workbench/terminal-dialog-dual-mode.md
type Panel = 'commands' | 'model' | 'effort' | 'speed'
type SpeedFeedback = { tier: SpeedLevel; phase: 'pending' | 'accepted' | 'confirmed' }
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export function AgentComposer({ terminalId, historyScope, workspacePath, references, snapshot, visible, setDraft, inputRef, canSend, hasOutgoing, busy, switching, send, action, changeMode }: {
  terminalId: string
  historyScope: string
  workspacePath?: string
  references: ConversationReference[]
  snapshot: ConversationSnapshot | null
  visible: boolean
  setDraft(text: string): void
  inputRef: RefObject<ConversationInputHandle>
  canSend: boolean
  hasOutgoing: boolean
  busy: boolean
  switching: boolean
  send(delivery?: 'queue' | 'steer'): Promise<void>
  action(command: ConversationCommand): Promise<boolean>
  changeMode(mode: 'terminal' | 'conversation'): Promise<void>
}) {
  const { t } = useTranslation('terminal')
  const draft = useWorkspaceStore(state => findTerminalInState(state, terminalId)?.conversationDraft ?? '')
  const activeReferences = activeConversationReferences(draft, references)
  const hasDraft = Boolean(draft.trim() || activeReferences.length)
  const localHistory = useConversationInputHistory(state => state.entries[historyScope])
  const [nativeHistory, setNativeHistory] = useState<InputHistoryEntry[]>([])
  const historyCursor = useRef(new InputHistoryCursor())
  useEffect(() => {
    historyCursor.current.reset()
    setNativeHistory([])
    let active = true
    void window.electron.terminal.inputHistory?.(terminalId).then(rows => { if (active) setNativeHistory(rows) }).catch(() => {})
    return () => { active = false }
  }, [terminalId, historyScope, snapshot?.mode, snapshot?.threadId])
  const [importing, setImporting] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [search, setSearch] = useState('')
  const [modelProvider, setModelProvider] = useState('')
  const [pickerHeight, setPickerHeight] = useState<number>()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [selectionFailed, setSelectionFailed] = useState(false)
  const [effortFeedback, setEffortFeedback] = useState<{ id: number; effort: string | null }>({ id: 0, effort: null })
  const [speedFeedback, setSpeedFeedback] = useState<SpeedFeedback | null>(null)
  const speedRequest = useRef<SpeedFeedback | null>(null)
  const [acceptedCommand, setAcceptedCommand] = useState<string | null>(null)
  useEffect(() => { setAcceptedCommand(null) }, [terminalId, snapshot?.threadId])
  const root = useRef<HTMLFormElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionList = useRef<HTMLDivElement>(null)
  const modelButton = useRef<HTMLButtonElement>(null)
  const effortButton = useRef<HTMLButtonElement>(null)
  const speedButton = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const slash = parseConversationSlashCommand(draft, snapshot?.commands)
  const commandQuery = Boolean(slash)
  const showStop = Boolean((snapshot?.turnId || snapshot?.backgroundTasks) && snapshot?.capabilities.cancel && !slash)
  const catalogRequested = useRef<string>()
  useEffect(() => {
    if (!commandQuery || busy || switching || !snapshot?.capabilities.commands || snapshot.connection !== 'ready' || snapshot.mode !== 'conversation' || snapshot.commands !== undefined || snapshot.commandsLoading || snapshot.commandsError) return
    const key = `${terminalId}:${snapshot.threadId}:${snapshot.controlEpoch}`
    if (catalogRequested.current === key) return
    catalogRequested.current = key
    void action({ type: 'commands', controlEpoch: snapshot.controlEpoch }).then(ok => { if (!ok) catalogRequested.current = undefined })
  }, [action, commandQuery, busy, switching, terminalId, snapshot?.threadId, snapshot?.capabilities.commands, snapshot?.connection, snapshot?.mode, snapshot?.commands, snapshot?.commandsLoading, snapshot?.commandsError, snapshot?.controlEpoch])
  const model = snapshot?.models.find(option => option.model === snapshot.model)
  const fastTier = model?.speedTiers?.find(tier => tier === 'fast' || tier === 'priority')
  const hasUltrafast = model?.speedTiers?.includes('ultrafast') ?? false
  const showSpeed = snapshot?.engine === 'codex' && snapshot.connection === 'ready' && snapshot.capabilities.settings
    && !snapshot.modelsLoading && !snapshot.modelsError && (Boolean(fastTier) || hasUltrafast)
  const hasSpeedMenu = showSpeed && hasUltrafast
  const currentTier = snapshot?.serviceTier
  const speed = speedLevel(currentTier)
  const speedPending = !!speedFeedback && speedFeedback.phase !== 'confirmed'
  const speedIcon = speedPending ? speedFeedback.tier : speed
  const speedPhase = speedPending ? 'pending' : speedFeedback?.tier === speed ? 'confirmed' : null
  useLayoutEffect(() => {
    setSpeedFeedback(null)
    return () => { speedRequest.current = null }
  }, [terminalId, snapshot?.threadId, snapshot?.controlEpoch, snapshot?.model, showSpeed, visible])
  useEffect(() => {
    if (!speedFeedback || speedFeedback.phase === 'pending') return
    if (speedFeedback.phase === 'accepted' && currentTier !== undefined && speed === speedFeedback.tier) {
      setSpeedFeedback({ ...speedFeedback, phase: 'confirmed' })
      return
    }
    // The settings notification may follow the IPC reply. Expire the decoration
    // if it never arrives; the persistent icon always uses the native snapshot.
    const delay = speedFeedback.phase === 'accepted' ? 3000 : 420
    const timer = window.setTimeout(() => setSpeedFeedback(current => current === speedFeedback ? null : current), delay)
    return () => window.clearTimeout(timer)
  }, [speedFeedback, speed, currentTier])
  const speedTitle = currentTier === undefined ? t('conversation.speedUnknown')
    : hasSpeedMenu ? t('conversation.speedMenu', { speed: t(`conversation.speed.${speed}`) })
    : speed === 'ultrafast' ? t('conversation.speedReset')
    : t(speed === 'fast' ? 'conversation.speedOn' : 'conversation.speedOff')
  useEffect(() => {
    if (panel === 'speed' && !hasSpeedMenu) setPanel(null)
  }, [panel, hasSpeedMenu])
  const slashPanel: Panel = snapshot?.capabilities.settings && slash?.name === 'model' ? 'model' : snapshot?.capabilities.settings && slash?.name === 'effort' ? 'effort' : 'commands'
  const currentPanel = contextOpen ? null : (panel === 'speed' && !hasSpeedMenu ? null : panel) ?? (slash && dismissed !== draft ? slashPanel : null)
  useLayoutEffect(() => {
    const composer = root.current, body = composer?.closest(`.${styles.conversation}`)
    if (!currentPanel || !composer || !body) return
    const measure = () => setPickerHeight(Math.min(360, Math.max(0, composer.getBoundingClientRect().top - body.getBoundingClientRect().top - 12)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body); observer.observe(composer)
    return () => observer.disconnect()
  }, [currentPanel])
  const query = panel ? search : slashPanel === 'commands' ? slash?.name ?? '' : slash?.query ?? ''
  const groupedModels = snapshot?.engine === 'opencode' && snapshot.models.some(option => option.provider)
  const modelProviders = groupedModels ? [...new Map(snapshot.models.flatMap(option => option.provider ? [[option.provider.id, option.provider] as const] : [])).values()] : []
  const providerFilter = modelProviders.some(provider => provider.id === modelProvider) ? modelProvider : ''
  useEffect(() => { setModelProvider('') }, [terminalId, snapshot?.threadId, currentPanel])
  const efforts = [...(model?.efforts ?? [])]
  if (snapshot?.engine !== 'opencode') efforts.sort((a, b) => effortOrder.indexOf(a.effort) - effortOrder.indexOf(b.effort))
  const initializing = !snapshot || snapshot.connection === 'starting'
  const available = snapshot?.connection === 'ready' && !importing && !busy && !switching && !snapshot.settingsUpdating && !snapshot.submitting && !snapshot.questions?.some(request => request.blocking !== false)
  const canConfigure = available && snapshot?.capabilities.settings && !snapshot.modelsLoading && !snapshot.modelsError
    && !(['claude', 'opencode'].includes(snapshot.engine) && (snapshot.turnId || snapshot.approvals.length || snapshot.needsTerminal))
  const panelTrigger = panel === 'model' ? modelButton : panel === 'effort' ? effortButton : panel === 'speed' ? speedButton : null
  const close = (restore = false) => {
    if (restore) (panelTrigger?.current ?? inputRef.current)?.focus()
    setPanel(null); setDismissed(draft)
  }
  const changeContextOpen = useCallback((value: boolean) => {
    setContextOpen(value)
    if (value) { setPanel(null); setDismissed(draft) }
  }, [draft])
  const open = (next: Panel) => { setContextOpen(false); setPanel(next); setSearch(''); setActive(next === 'effort' ? Math.max(0, efforts.findIndex(option => option.effort === snapshot?.effort)) : 0) }
  useEffect(() => { if (panel === 'effort' || panel === 'speed') optionList.current?.focus(); else if (panel) searchRef.current?.focus() }, [panel])
  const pickerVisible = visible && currentPanel !== null
  useBrowserOcclusion(pickerVisible)
  useOutsidePress(pickerVisible, target => Boolean(
    picker.current?.contains(target) || panelTrigger?.current?.contains(target)
    // Apply command needs the highlighted option until the form submits.
    || commandQuery && submitButton.current?.contains(target)
  ), close)
  useEffect(() => {
    if (snapshot?.mode !== 'conversation') { setPanel(null); setDismissed(null) }
  }, [snapshot?.mode])

  const selectSettings = async (nextModel: string, effort: string | null) => {
    if (!snapshot || !canConfigure) return
    setSelectionFailed(false)
    const originalDraft = draft
    if (await action({ type: 'settings', model: nextModel, effort, controlEpoch: snapshot.controlEpoch })) {
      if (effort !== snapshot.effort) setEffortFeedback(value => ({ id: value.id + 1, effort }))
      // A quick picker must never erase a message being composed.
      if (!panel && slash && inputRef.current?.value === originalDraft) setDraft('')
      setPanel(null); setDismissed(null); inputRef.current?.focus()
    } else setSelectionFailed(true)
  }
  const selectSpeed = async (serviceTier: ConversationSpeedTier | null) => {
    if (!snapshot || !canConfigure || currentTier === undefined || !showSpeed || speedPending || speedRequest.current) return
    const tier = speedLevel(serviceTier)
    const menu = panel === 'speed' ? picker.current : null
    if (tier !== speed) {
      const request: SpeedFeedback = { tier, phase: 'pending' }
      speedRequest.current = request
      setSpeedFeedback(request)
      const ok = await action({ type: 'speed', serviceTier, controlEpoch: snapshot.controlEpoch })
      if (speedRequest.current !== request) return
      speedRequest.current = null
      setSpeedFeedback(ok ? { tier, phase: 'accepted' } : null)
      if (!ok) return
    }
    if (menu && picker.current === menu && menu.dataset.panel === 'speed') {
      const restoreFocus = menu.contains(document.activeElement)
      close()
      if (restoreFocus) inputRef.current?.focus()
    }
  }
  const speedChoices = [
    { id: 'standard', tier: null },
    ...(fastTier ? [{ id: 'fast', tier: fastTier } as const] : []),
    { id: 'ultrafast', tier: 'ultrafast' },
  ] as const
  const commands: Choice[] = [
    { id: 'new', icon: Plus, label: '/new', description: t('conversation.commands.new'), disabled: !available || hasOutgoing || !!snapshot?.turnId || !!snapshot?.approvals.length || !!snapshot?.needsTerminal || !!(slash?.name === 'new' && slash.query), run: () => {
      if (snapshot) void action({ type: 'new', controlEpoch: snapshot.controlEpoch }).then(ok => {
        if (ok && inputRef.current?.value === draft) setDraft('')
        if (ok) { setPanel(null); setDismissed(null); inputRef.current?.focus() }
      })
    } },
    { id: 'model', icon: SlidersHorizontal, label: '/model', description: t('conversation.commands.model'), run: () => { setDraft('/model '); setPanel(null); setDismissed(null); inputRef.current?.focus() } },
    { id: 'effort', icon: SlidersHorizontal, label: '/effort', description: t('conversation.commands.effort'), run: () => { setDraft('/effort '); setPanel(null); setDismissed(null); inputRef.current?.focus() } },
    { id: 'terminal', icon: Terminal, label: '/terminal', description: t('conversation.commands.terminal'), disabled: busy || switching || !!(slash?.name === 'terminal' && slash.query), run: () => { void changeMode('terminal') } },
    { id: 'stop', icon: Square, label: '/stop', description: t('conversation.commands.stop'), disabled: !(snapshot?.turnId || snapshot?.backgroundTasks) || !available || !!(slash?.name === 'stop' && slash.query), run: () => {
      if (snapshot) void action({ type: 'interrupt', controlEpoch: snapshot.controlEpoch }).then(ok => { if (ok && inputRef.current?.value === draft) setDraft('') })
    } },
  ].filter(option => (option.id !== 'model' && option.id !== 'effort' || snapshot?.capabilities.settings)
    && (option.id !== 'stop' || snapshot?.capabilities.cancel)
    && (option.id !== 'terminal' || snapshot?.engine !== 'opencode')
    && (option.id !== 'new' || snapshot?.capabilities.newThread))
  // Session controls own their reserved names; avoid two indistinguishable rows.
  const nativeChoices: Choice[] = (snapshot?.commands ?? []).filter(entry => !commands.some(option => option.label === '/' + entry.name)).map(entry => ({
    id: entry.id, label: '/' + entry.name, completion: '/' + entry.name + ' ',
    description: [entry.label !== entry.name ? entry.label : '', entry.description, entry.argumentHint].filter(Boolean).join(' \u00b7 '),
    icon: entry.kind === 'skill' ? Sparkles : entry.kind === 'prompt' ? FileText : Command,
    source: entry.execution === 'terminal' ? t('conversation.catalog.terminal') : t(`conversation.catalog.${entry.kind}`),
    disabled: !available || hasOutgoing || !!activeReferences.length || !!snapshot?.turnId || !!snapshot?.needsTerminal || !!snapshot?.approvals.length || !!snapshot?.commandsLoading || !!snapshot?.commandsError,
    run: () => {
      if (!snapshot) return
      if (slash?.name !== entry.name) { setDraft('/' + entry.name + ' '); setPanel(null); setDismissed(null); inputRef.current?.focus(); return }
      const original = draft
      void action({ type: 'invoke', entryId: entry.id, catalogRevision: snapshot.commandsRevision!, arguments: slash.query,
        commandId: crypto.randomUUID(), controlEpoch: snapshot.controlEpoch }).then(ok => {
        if (ok) {
          if (entry.execution === 'native') setAcceptedCommand(entry.label)
          rememberConversationInput(historyScope, original)
          if (inputRef.current?.value === original) setDraft('')
          setPanel(null); setDismissed(null); inputRef.current?.focus()
        }
      })
    },
  }))
  // A CLI's interactive commands are not necessarily in its service catalog.
  // Hand an explicitly typed command to that CLI instead of sending it as chat.
  const terminalChoice: Choice[] = slash?.name && !commands.some(option => option.label === '/' + slash.name)
    && !(snapshot?.commands ?? []).some(entry => entry.name === slash.name) ? [{
      id: 'terminal:' + slash.name, label: '/' + slash.name, icon: Terminal,
      description: t('conversation.catalog.terminalRun'),
      disabled: !available || hasOutgoing || !!activeReferences.length || !!snapshot?.turnId || !!snapshot?.needsTerminal || !!snapshot?.approvals.length,
      run: () => {
        if (!snapshot) return
        const original = draft
        void action({ type: 'terminal-command', name: slash.name, arguments: slash.query,
          commandId: crypto.randomUUID(), controlEpoch: snapshot.controlEpoch }).then(ok => {
          if (ok) {
            rememberConversationInput(historyScope, original)
            if (inputRef.current?.value === original) setDraft('')
            setPanel(null); setDismissed(null)
          }
        })
      },
    }] : []
  // Preserve native identities while grouping only the OpenCode presentation.
  // All engines retain the same option rows and keyboard navigation.
  const orderedModels = groupedModels ? [...modelProviders.flatMap(provider => (snapshot?.models ?? []).filter(option => option.provider?.id === provider.id)), ...snapshot.models.filter(option => !option.provider)] : snapshot?.models ?? []
  const modelNameCounts = new Map<string, number>()
  if (currentPanel === 'model') for (const option of orderedModels) {
    const key = JSON.stringify([option.provider?.id, option.displayName])
    modelNameCounts.set(key, (modelNameCounts.get(key) ?? 0) + 1)
  }
  const choices: Choice[] = (currentPanel === 'model' ? orderedModels.filter(option => !groupedModels || !providerFilter || option.provider?.id === providerFilter).map<Choice>(option => {
    const repeatedName = (modelNameCounts.get(JSON.stringify([option.provider?.id, option.displayName])) ?? 0) > 1
    return {
      id: option.model, label: option.displayName, provider: groupedModels ? option.provider : undefined,
      title: option.description && option.description !== option.model ? `${option.model}\n${option.description}` : option.model,
      description: repeatedName ? option.model : '',
      selected: option.model === snapshot?.model, disabled: !canConfigure,
      run: () => void selectSettings(option.model, option.efforts.some(value => value.effort === snapshot?.effort) ? snapshot!.effort : option.defaultEffort),
    }
  }) : currentPanel === 'effort' ? efforts.map<Choice>(option => ({
    id: option.effort, label: option.effort === 'default' ? t('conversation.defaultEffort') : t(`conversation.efforts.${option.effort}`, { defaultValue: option.effort }), description: '',
    selected: option.effort === snapshot?.effort, disabled: !canConfigure,
    run: () => void selectSettings(model!.model, option.effort),
  })) : currentPanel === 'speed' ? speedChoices.map<Choice>(option => ({
    id: option.id, label: t(`conversation.speed.${option.id}`),
    description: option.id === 'standard' ? '' : t('conversation.speed.higherUsage'),
    selected: currentTier !== undefined && option.id === speed, disabled: !canConfigure || currentTier === undefined || speedPending,
    run: () => void selectSpeed(option.tier),
  })) : [...commands, ...nativeChoices, ...terminalChoice]).filter(option => currentPanel === 'commands' && !panel
    ? option.label.toLowerCase().startsWith('/' + query.toLowerCase())
    : `${option.id} ${option.label} ${option.title ?? option.description} ${option.provider?.name ?? ''} ${option.provider?.id === 'opencode' ? 'zen' : ''}`.toLowerCase().includes(query.toLowerCase()))
  const activeChoice = choices[Math.min(active, choices.length - 1)]
  const selectedIndex = currentPanel === 'commands' && slash?.name
    ? choices.findIndex(option => option.label === '/' + slash.name && !option.id.startsWith('terminal:'))
    : !query ? choices.findIndex(option => option.selected) : -1
  const unsupportedArguments = Boolean(slash?.query && ['new', 'stop', 'terminal'].includes(slash.name) && commands.some(option => option.label === '/' + slash.name))
  useEffect(() => { setActive(Math.max(0, selectedIndex)); setSelectionFailed(false) }, [query, currentPanel, selectedIndex, providerFilter])
  const submit = () => {
    if (slash) {
      setDismissed(null)
      if (unsupportedArguments) return
      // Prefix search is completion, never permission to run a different command.
      if (currentPanel === 'commands' && activeChoice && activeChoice.label !== '/' + slash.name) {
        setDraft(activeChoice.completion ?? activeChoice.label + ' '); return
      }
      if (activeChoice && !activeChoice.disabled) activeChoice.run()
    } else if (!importing) { setAcceptedCommand(null); void send() }
  }
  const keyboard = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>) => {
    if (insertConversationNewline(event, text => { setDraft(text); setPanel(null); setDismissed(null) })) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter' && event.currentTarget.tagName === 'INPUT') event.preventDefault()
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !currentPanel && event.target === inputRef.current?.element && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const input = inputRef.current!
      const text = input.isHistoryBoundary(event.key)
        ? historyCursor.current.move(event.key, draft, input.selectionStart, input.selectionEnd, mergeInputHistory(localHistory ?? [], nativeHistory))
        : undefined
      if (text !== undefined) {
        event.preventDefault(); event.stopPropagation(); setDraft(text); setDismissed(text)
        requestAnimationFrame(() => { if (input.isConnected) { const position = event.key === 'ArrowUp' ? 0 : text.length; input.setSelectionRange(position, position) } })
        return
      }
    }
    if (event.key === 'Escape' && currentPanel) { event.preventDefault(); event.stopPropagation(); if (!panel && currentPanel !== 'commands') { setDraft('/'); inputRef.current?.focus() } else close(true); return }
    const nextIndex = currentPanel ? composerOptionIndex(event.key, active, choices.length, currentPanel === 'effort') : undefined
    if (nextIndex !== undefined) {
      event.preventDefault(); setActive(nextIndex)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (panel) { if (activeChoice && !activeChoice.disabled) activeChoice.run() }
      else submit()
    } else if (event.key === 'Tab' && currentPanel && activeChoice && !activeChoice.disabled) {
      event.preventDefault()
      if (currentPanel === 'commands') { setDraft(activeChoice.completion ?? activeChoice.label + ' '); setPanel(null); setDismissed(null); inputRef.current?.focus() }
      else if (!panel) setDraft('/' + currentPanel + ' ' + activeChoice.id)
      else close(true)
    }
  }

  return <form ref={root} className={styles.composer} onSubmit={event => { event.preventDefault(); submit() }}>
    {visible && showSpeed && speedPhase && <SpeedTrace tier={speedIcon} phase={speedPhase} />}
    {showSpeed && <span className="sr-only" role="status">{speedPhase && t(speedPending ? 'conversation.speedChanging' : 'conversation.speedChanged', { speed: t(`conversation.speed.${speedIcon}`) })}</span>}
    {effortFeedback.id > 0 && <EffortActivation key={effortFeedback.id} effort={effortFeedback.effort} suppressed={Boolean(currentPanel || speedFeedback)}
      label={effortFeedback.effort && effortFeedback.effort !== 'default' ? t(`conversation.efforts.${effortFeedback.effort}`, { defaultValue: effortFeedback.effort }) : t('conversation.defaultEffort')}
      status={t('conversation.effortActivated')} />}
    {currentPanel && <ComposerOptions id={listId} kind={currentPanel} title={t(`conversation.picker.${currentPanel}`)} options={choices} active={active} onActiveChange={setActive} onKeyDown={keyboard}
      maxHeight={pickerHeight} containerRef={picker} searchRef={searchRef} listRef={optionList} focusList={panel === 'effort' || panel === 'speed'}
      back={!panel && currentPanel !== 'commands' ? {label:t('conversation.picker.commands'),run:()=>{setDraft('/');inputRef.current?.focus()}} : undefined}
      hint={currentPanel !== 'effort' ? {label:t('conversation.compactCommandKeys'),title:t('conversation.commandKeys')} : undefined}
      search={currentPanel === 'model' || panel === 'commands' ? {value:query,onChange:value=>panel?setSearch(value):setDraft('/model '+value),label:t('conversation.searchOptions'),placeholder:t(groupedModels && currentPanel === 'model'?'conversation.searchModels':'conversation.searchOptions')} : undefined}
      emptyMessage={currentPanel === 'model' && !snapshot?.modelsLoading && !snapshot?.modelsError
        ? t(orderedModels.length ? 'model:empty.noResultsTitle' : 'model:empty.emptyTitle')
        : undefined}
      providers={currentPanel === 'model' && groupedModels ? {label:t('conversation.modelProvider'),allLabel:t('conversation.allProviders'),value:providerFilter,options:modelProviders,onChange:setModelProvider} : undefined}
      footer={currentPanel !== 'commands' && <><span title={t(snapshot?.engine === 'claude'?'conversation.claudeSessionSettings':'conversation.nextTurnSettings')}>{t('conversation.nextTurnShort')}</span>{currentPanel === 'effort' && <span>{t('conversation.effortKeys')}</span>}
        {currentPanel === 'model' && snapshot?.engine === 'opencode' && <button className={styles.modelRefresh} type="button" disabled={!available || snapshot.modelsLoading} title={t('conversation.refreshModels')} onClick={()=>void action({type:'models',controlEpoch:snapshot.controlEpoch})}><RefreshCw size={12} aria-hidden="true" />{t('conversation.refreshModels')}</button>}</>}>
      {currentPanel === 'commands' && snapshot?.capabilities.commands && <div className={styles.pickerMessage}>
        {snapshot.commandsLoading ? <span role="status">{t('conversation.catalog.loading')}</span> : <button type="button" disabled={!available} onClick={() => void action({ type: 'commands', controlEpoch: snapshot.controlEpoch })}><RefreshCw size={12} aria-hidden="true" /> {t('conversation.catalog.refresh')}</button>}
        {snapshot.commandsError && <span role="alert">{t('conversation.catalog.failed')}</span>}
      </div>}
      {currentPanel !== 'commands' && snapshot?.modelsLoading && <p className={styles.pickerMessage} role="status">{t('conversation.modelsLoading')}</p>}
      {currentPanel !== 'commands' && snapshot?.modelsError && <div className={styles.pickerMessage} role="alert">{t('conversation.modelsFailed')}<button type="button" disabled={!available} onClick={() => snapshot && void action({ type: 'models', controlEpoch: snapshot.controlEpoch })}>{t('conversation.retryModels')}</button></div>}
      {unsupportedArguments && <p className={styles.pickerMessage} role="status">{t('conversation.commandArgumentsUnsupported')}</p>}
      {currentPanel !== 'model' && !choices.length && (currentPanel === 'commands' || (!snapshot?.modelsLoading && !snapshot?.modelsError)) && <p className={styles.pickerMessage}>{t(currentPanel === 'commands' ? 'conversation.unsupportedCommand' : currentPanel === 'effort' && !model ? 'conversation.effortUnavailable' : 'conversation.noOptions')}</p>}
      {currentPanel === 'commands' && !choices.length && <button className={styles.terminalCommand} type="button" onClick={() => void changeMode('terminal')}>{t('conversation.openTerminalCommand')}</button>}
      {selectionFailed && currentPanel !== 'commands' && <p className={styles.pickerMessage} role="status">{t('conversation.settingsFailed')}</p>}
    </ComposerOptions>}
    {acceptedCommand && !draft && !snapshot?.turnId && <p className={styles.pickerMessage} role="status">{t('conversation.catalog.accepted', { command: acceptedCommand })}</p>}
    <ConversationContext inputRef={inputRef} terminalId={terminalId} workspacePath={workspacePath} references={references} draft={draft} setDraft={setDraft} disabled={busy || switching} onImporting={setImporting} open={contextOpen} onOpenChange={changeContextOpen} pickerActive={Boolean(currentPanel)}>
    {addControl => <>
    <ConversationInput ref={inputRef} references={references} value={draft} disabled={switching} onChange={text => { setDraft(text); setContextOpen(false); setPanel(null); setDismissed(null) }}
      aria-autocomplete="list" aria-expanded={Boolean(currentPanel && !panel)} aria-controls={currentPanel && !panel ? listId : undefined}
      aria-activedescendant={currentPanel && !panel && activeChoice ? `${listId}-${Math.min(active, choices.length - 1)}` : undefined}
      label={t('conversation.prompt', { agent: snapshot ? t(`provider.${snapshot.engine}`) : '' })} placeholder={t('conversation.placeholder')} title={t('conversation.inputHint')} onKeyDown={keyboard} />
    <div className={styles.composerActions}>
      {addControl}
      <div className={styles.modelControls}>
        {snapshot?.engine === 'claude' && <button type="button" className={optionStyles.control}
          aria-label={t('conversation.ultracode.label')} aria-pressed={snapshot.ultracode?.enabled}
          title={t(!snapshot.ultracode ? 'conversation.ultracode.unknown' : !snapshot.ultracode.available || snapshot.model !== snapshot.ultracode.model
            ? 'conversation.ultracode.unavailable' : 'conversation.ultracode.hint')}
          disabled={!canConfigure || !snapshot.ultracode || !snapshot.ultracode.enabled && (!snapshot.ultracode.available || snapshot.model !== snapshot.ultracode.model)}
          onClick={() => void action({ type: 'ultracode', enabled: !snapshot.ultracode!.enabled, controlEpoch: snapshot.controlEpoch })}>
          <Sparkles size={12} aria-hidden="true" /><span>Ultracode</span>{snapshot.ultracode?.enabled && <Check size={12} aria-hidden="true" />}</button>}
        {showSpeed && <ComposerOptionTrigger ref={speedButton} className={styles.speedControl} data-speed-active={speed !== 'standard'} data-speed-display={speedIcon} aria-busy={speedPending || undefined}
          aria-label={speedTitle} title={speedTitle} aria-pressed={!hasSpeedMenu && currentTier !== undefined ? speed !== 'standard' : undefined}
          aria-haspopup={hasSpeedMenu ? 'listbox' : undefined} aria-expanded={hasSpeedMenu ? currentPanel === 'speed' : undefined}
          aria-controls={currentPanel === 'speed' ? listId : undefined} disabled={!canConfigure || currentTier === undefined || speedPending}
          onClick={() => {
            if (hasSpeedMenu) panel === 'speed' ? close() : open('speed')
            else void selectSpeed(speed === 'standard' ? fastTier ?? null : null)
          }}>
          <SpeedGlyph tier={speedIcon} phase={speedPhase} />{hasSpeedMenu && <ChevronDown size={10} aria-hidden="true" />}</ComposerOptionTrigger>}
        {(!snapshot || snapshot.capabilities.settings) ? <><ComposerOptionTrigger ref={modelButton} disabled={!snapshot || snapshot.connection !== 'ready'} aria-label={t('conversation.chooseModel')} title={snapshot?.model ?? t('conversation.chooseModel')} aria-expanded={currentPanel === 'model'} onClick={() => panel === 'model' ? close() : open('model')}>
          {groupedModels && model?.provider && <small className={styles.modelProviderTag} title={model.provider.name}>{model.provider.name}</small>}
          <span>{model?.displayName || snapshot?.model || t('conversation.chooseModel')}</span><ChevronDown size={12} aria-hidden="true" /></ComposerOptionTrigger>
        <ComposerOptionTrigger ref={effortButton} disabled={!snapshot || snapshot.connection !== 'ready'} className={`${styles.effortControl} ${effortToneClass(snapshot?.effort)}`} aria-label={t('conversation.chooseEffort')} aria-expanded={panel === 'effort'} onClick={() => panel === 'effort' ? close() : open('effort')}>
          <EffortGlyph effort={snapshot?.effort} /><span>{snapshot?.effort && snapshot.effort !== 'default' ? t(`conversation.efforts.${snapshot.effort}`, { defaultValue: snapshot.effort }) : initializing ? t('conversation.chooseEffort') : t('conversation.defaultEffort')}</span><ChevronDown size={12} aria-hidden="true" /></ComposerOptionTrigger></>
          : <><span className={optionStyles.control}>{snapshot.model || t(`provider.${snapshot.engine}`)}</span>{snapshot.effort && <span className={`${optionStyles.control} ${styles.effortControl} ${effortToneClass(snapshot.effort)}`}><EffortGlyph effort={snapshot.effort} />{t(`conversation.efforts.${snapshot.effort}`, { defaultValue: snapshot.effort })}</span>}</>}
      </div>
      <span className={styles.inputHint}>{t(snapshot?.settingsUpdating && !speedPending ? 'conversation.settingsUpdating' : 'conversation.inputHint')}</span>
      <div className={styles.composerSubmit} data-composer-submit>
        {showStop && <button className={styles.submit} data-secondary={hasDraft || undefined} type="button" disabled={!available} aria-label={t('conversation.stop')} title={t('conversation.stop')} onClick={() => void action({ type: 'interrupt', controlEpoch: snapshot!.controlEpoch })}><Square size={12} fill="currentColor" aria-hidden="true" /></button>}
        {(!showStop || hasDraft) && <button ref={submitButton} className={styles.submit} type="submit" disabled={slash ? unsupportedArguments || !activeChoice || activeChoice.disabled : !canSend || importing || !hasDraft} aria-label={t(slash ? 'conversation.runCommand' : 'conversation.send')} title={t(slash ? 'conversation.runCommand' : 'conversation.send')}><ArrowUp size={18} aria-hidden="true" /></button>}
      </div>
    </div>
    </>}
    </ConversationContext>
  </form>
}
