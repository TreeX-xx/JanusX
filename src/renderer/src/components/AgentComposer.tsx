import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Check, ChevronDown, Search, Square } from 'lucide-react'
import { parseConversationSlashCommand, type ConversationCommand, type ConversationSnapshot } from '../../../shared/conversation-display'
import styles from './AgentSessionPane.module.css'

type Panel = 'commands' | 'model' | 'effort'
interface Choice { id: string; label: string; description: string; selected?: boolean; disabled?: boolean; run(): void }
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

function EffortGlyph({ level }: { level: number }) {
  return <svg className={styles.effortGlyph} width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
    {[4, 6, 8, 10, 12, 14].map((height, index) => <rect key={height} x={index * 3} y={15 - height} width="2" height={height} rx=".7" fill="currentColor" data-filled={index < level} />)}
  </svg>
}

export function AgentComposer({ snapshot, draft, setDraft, inputRef, canSend, busy, switching, send, action, changeMode }: {
  snapshot: ConversationSnapshot | null
  draft: string
  setDraft(text: string): void
  inputRef: RefObject<HTMLTextAreaElement>
  canSend: boolean
  busy: boolean
  switching: boolean
  send(): Promise<void>
  action(command: ConversationCommand): Promise<boolean>
  changeMode(mode: 'terminal' | 'conversation'): Promise<void>
}) {
  const { t } = useTranslation('terminal')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [search, setSearch] = useState('')
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [selectionFailed, setSelectionFailed] = useState(false)
  const root = useRef<HTMLFormElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const effortRef = useRef<HTMLDivElement>(null)
  const modelButton = useRef<HTMLButtonElement>(null)
  const effortButton = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const slash = parseConversationSlashCommand(draft)
  const slashPanel: Panel = snapshot?.capabilities.settings && slash?.name === 'model' ? 'model' : snapshot?.capabilities.settings && slash?.name === 'effort' ? 'effort' : 'commands'
  const currentPanel = panel ?? (slash && dismissed !== draft ? slashPanel : null)
  const query = panel ? search : slashPanel === 'commands' ? (slash?.name === 'help' ? '' : slash?.name ?? '') : slash?.query ?? ''
  const model = snapshot?.models.find(option => option.model === snapshot.model)
  const efforts = [...(model?.efforts ?? [])]
  if (snapshot?.engine !== 'opencode') efforts.sort((a, b) => effortOrder.indexOf(a.effort) - effortOrder.indexOf(b.effort))
  const initializing = !snapshot || snapshot.connection === 'starting'
  const available = snapshot?.connection === 'ready' && !busy && !switching && !snapshot.settingsUpdating && !snapshot.submitting
  const canConfigure = available && snapshot?.capabilities.settings && !snapshot.modelsLoading && !snapshot.modelsError
    && !(['claude', 'opencode'].includes(snapshot.engine) && (snapshot.turnId || snapshot.approvals.length || snapshot.needsTerminal))
  const close = (restore = false) => {
    if (restore) (panel === 'model' ? modelButton.current : panel === 'effort' ? effortButton.current : inputRef.current)?.focus()
    setPanel(null); setDismissed(draft)
  }
  const open = (next: Panel) => { setPanel(next); setSearch(''); setActive(next === 'effort' ? Math.max(0, efforts.findIndex(option => option.effort === snapshot?.effort)) : 0) }
  useEffect(() => { if (panel === 'effort') effortRef.current?.focus(); else if (panel) searchRef.current?.focus() }, [panel])
  useEffect(() => {
    if (!currentPanel) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setPanel(null); setDismissed(draft) } }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [currentPanel, draft])
  useEffect(() => {
    if (snapshot?.mode !== 'conversation') { setPanel(null); setDismissed(null) }
  }, [snapshot?.mode])

  const selectSettings = async (nextModel: string, effort: string | null) => {
    if (!snapshot || !canConfigure) return
    setSelectionFailed(false)
    const originalDraft = draft
    if (await action({ type: 'settings', model: nextModel, effort, controlEpoch: snapshot.controlEpoch })) {
      // A quick picker must never erase a message being composed.
      if (!panel && slash && inputRef.current?.value === originalDraft) setDraft('')
      setPanel(null); setDismissed(null); inputRef.current?.focus()
    } else setSelectionFailed(true)
  }
  const commands: Choice[] = [
    { id: 'model', label: '/model', description: t('conversation.commands.model'), run: () => { setDraft('/model '); setPanel(null); setDismissed(null); inputRef.current?.focus() } },
    { id: 'effort', label: '/effort', description: t('conversation.commands.effort'), run: () => { setDraft('/effort '); setPanel(null); setDismissed(null); inputRef.current?.focus() } },
    { id: 'terminal', label: '/terminal', description: t('conversation.commands.terminal'), run: () => { setDraft(''); void changeMode('terminal') } },
    { id: 'stop', label: '/stop', description: t('conversation.commands.stop'), disabled: !(snapshot?.turnId || snapshot?.backgroundTasks) || !available, run: () => {
      if (snapshot) void action({ type: 'interrupt', controlEpoch: snapshot.controlEpoch }).then(ok => { if (ok && inputRef.current?.value === draft) setDraft('') })
    } },
    { id: 'help', label: '/help', description: t('conversation.commands.help'), run: () => { setDraft('/'); setDismissed(null) } },
  ].filter(option => (option.id !== 'model' && option.id !== 'effort' || snapshot?.capabilities.settings)
    && (option.id !== 'stop' || snapshot?.capabilities.cancel))
  const choices: Choice[] = (currentPanel === 'model' ? (snapshot?.models ?? []).map(option => ({
    id: option.model, label: option.displayName, description: option.description || option.model, selected: option.model === snapshot?.model, disabled: !canConfigure,
    run: () => void selectSettings(option.model, option.efforts.some(value => value.effort === snapshot?.effort) ? snapshot!.effort : option.defaultEffort),
  })) : currentPanel === 'effort' ? efforts.map(option => ({
    id: option.effort, label: option.effort === 'default' ? t('conversation.defaultEffort') : t(`conversation.efforts.${option.effort}`, { defaultValue: option.effort }), description: '',
    selected: option.effort === snapshot?.effort, disabled: !canConfigure,
    run: () => void selectSettings(model!.model, option.effort),
  })) : commands).filter(option => `${option.id} ${option.label}`.toLowerCase().includes(query.toLowerCase()))
  const activeChoice = choices[Math.min(active, choices.length - 1)]
  const selectedIndex = currentPanel === 'effort' ? choices.findIndex(option => option.selected) : -1
  const effortLevel = Math.max(0, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].indexOf(snapshot?.effort ?? '') + 1)
  useEffect(() => { setActive(Math.max(0, selectedIndex)); setSelectionFailed(false) }, [query, currentPanel, selectedIndex])
  const submit = () => {
    if (slash) {
      setDismissed(null)
      if (activeChoice && !activeChoice.disabled) activeChoice.run()
    } else void send()
  }
  const keyboard = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter' && event.currentTarget.tagName === 'INPUT') event.preventDefault()
      return
    }
    if (event.key === 'Escape' && currentPanel) { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (currentPanel === 'effort' && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, choices.length - 1))
    } else if (currentPanel && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (currentPanel === 'effort' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')))) {
      event.preventDefault()
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
      setActive(value => !choices.length ? 0 : currentPanel === 'effort'
        ? Math.max(0, Math.min(choices.length - 1, value + step))
        : (value + step + choices.length) % choices.length)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (panel) { if (activeChoice && !activeChoice.disabled) activeChoice.run() }
      else submit()
    } else if (event.key === 'Tab' && currentPanel && activeChoice && !activeChoice.disabled) {
      event.preventDefault(); activeChoice.run()
    }
  }
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  return <form ref={root} className={styles.composer} onSubmit={event => { event.preventDefault(); submit() }}>
    {currentPanel && <div className={styles.commandPanel} data-panel={currentPanel}>
      <div className={styles.commandHeader}><span>{t(`conversation.picker.${currentPanel}`)}</span><span title={t('conversation.commandKeys')}>{currentPanel === 'effort' ? activeChoice?.label : t('conversation.compactCommandKeys')}</span></div>
      {panel && panel !== 'effort' && <label className={styles.pickerSearch}><Search size={14} aria-hidden="true" /><input ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={keyboard}
        role="combobox" aria-label={t('conversation.searchOptions')} aria-expanded aria-controls={listId} aria-activedescendant={activeChoice ? `${listId}-${Math.min(active, choices.length - 1)}` : undefined} placeholder={t('conversation.searchOptions')} /></label>}
      <div className={currentPanel === 'effort' ? styles.effortScale : styles.commandList} role="listbox" id={listId} aria-label={t(`conversation.picker.${currentPanel}`)}
        ref={currentPanel === 'effort' ? effortRef : undefined} tabIndex={panel === 'effort' ? 0 : undefined} onKeyDown={panel === 'effort' ? keyboard : undefined}
        aria-orientation={currentPanel === 'effort' ? 'horizontal' : 'vertical'} aria-activedescendant={panel === 'effort' && activeChoice ? `${listId}-${Math.min(active, choices.length - 1)}` : undefined}>
        <div className={currentPanel === 'effort' ? styles.effortTrack : undefined} style={currentPanel === 'effort' ? { '--effort-count': Math.max(1, choices.length), '--effort-active': Math.min(active, Math.max(0, choices.length - 1)) } as CSSProperties : undefined}>
        {currentPanel === 'effort' && choices.length > 0 && <span className={styles.effortIndicator} aria-hidden="true" />}
        {choices.map((option, index) => <button key={option.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={Boolean(option.selected)} aria-disabled={option.disabled || undefined}
          className={currentPanel === 'effort' ? styles.effortOption : styles.commandOption} data-active={index === Math.min(active, choices.length - 1)} tabIndex={-1} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => { if (!option.disabled) option.run() }}
          title={currentPanel === 'effort' ? undefined : option.description} aria-label={currentPanel === 'effort' ? option.label : undefined}>
          {currentPanel === 'effort' ? <><span className={styles.effortStep} aria-hidden="true"><span style={{ height: 6 + Math.max(0, effortOrder.indexOf(option.id) - 2) * 3 }} data-filled={index <= active} /></span><span>{option.label}</span></>
            : <><span><strong>{option.label}</strong><small>{option.description}</small></span>{option.selected && <Check size={14} aria-hidden="true" />}</>}
        </button>)}
        </div>
      </div>
      {currentPanel !== 'commands' && snapshot?.modelsLoading && <p className={styles.pickerMessage} role="status">{t('conversation.modelsLoading')}</p>}
      {currentPanel !== 'commands' && snapshot?.modelsError && <div className={styles.pickerMessage} role="alert">{t('conversation.modelsFailed')}<button type="button" disabled={!available} onClick={() => snapshot && void action({ type: 'models', controlEpoch: snapshot.controlEpoch })}>{t('conversation.retryModels')}</button></div>}
      {!choices.length && (currentPanel === 'commands' || (!snapshot?.modelsLoading && !snapshot?.modelsError)) && <p className={styles.pickerMessage}>{t(currentPanel === 'commands' ? 'conversation.unsupportedCommand' : currentPanel === 'effort' && !model ? 'conversation.effortUnavailable' : 'conversation.noOptions')}</p>}
      {currentPanel === 'commands' && !choices.length && <button className={styles.terminalCommand} type="button" onClick={() => void changeMode('terminal')}>{t('conversation.openTerminalCommand')}</button>}
      {currentPanel !== 'commands' && <p className={styles.pickerFootnote} title={t(snapshot?.engine === 'claude' ? 'conversation.claudeSessionSettings' : 'conversation.nextTurnSettings')}><span>{t('conversation.nextTurnShort')}</span>{currentPanel === 'effort' && <span>{t('conversation.effortKeys')}</span>}</p>}
      {selectionFailed && currentPanel !== 'commands' && <p className={styles.pickerMessage} role="status">{t('conversation.settingsFailed')}</p>}
    </div>}
    <textarea ref={inputRef} rows={2} value={draft} disabled={switching} maxLength={32000} onChange={event => { setDraft(event.target.value); setPanel(null); setDismissed(null) }}
      role="combobox" aria-autocomplete="list" aria-expanded={Boolean(currentPanel && !panel)} aria-controls={currentPanel && !panel ? listId : undefined}
      aria-activedescendant={currentPanel && !panel && activeChoice ? `${listId}-${Math.min(active, choices.length - 1)}` : undefined}
      aria-label={t('conversation.prompt', { agent: snapshot ? t(`provider.${snapshot.engine}`) : '' })} placeholder={t('conversation.placeholder')} title={t('conversation.inputHint')} onKeyDown={keyboard} />
    <div className={styles.composerActions}>
      <div className={styles.modelControls}>
        {(!snapshot || snapshot.capabilities.settings) ? <><button type="button" ref={modelButton} disabled={!snapshot || snapshot.connection !== 'ready'} className={styles.modelControl} aria-label={t('conversation.chooseModel')} title={snapshot?.model ?? t('conversation.chooseModel')} aria-haspopup="listbox" aria-expanded={panel === 'model'} onClick={() => panel === 'model' ? close() : open('model')}>
          <span>{model?.displayName || snapshot?.model || t('conversation.chooseModel')}</span><ChevronDown size={12} aria-hidden="true" /></button>
        <button type="button" ref={effortButton} disabled={!snapshot || snapshot.connection !== 'ready'} className={styles.modelControl} aria-label={t('conversation.chooseEffort')} aria-haspopup="listbox" aria-expanded={panel === 'effort'} onClick={() => panel === 'effort' ? close() : open('effort')}>
          <EffortGlyph level={effortLevel} /><span>{snapshot?.effort && snapshot.effort !== 'default' ? t(`conversation.efforts.${snapshot.effort}`, { defaultValue: snapshot.effort }) : initializing ? t('conversation.chooseEffort') : t('conversation.defaultEffort')}</span><ChevronDown size={12} aria-hidden="true" /></button></>
          : <><span className={styles.modelControl}>{snapshot.model || t(`provider.${snapshot.engine}`)}</span>{snapshot.effort && <span className={styles.modelControl}><EffortGlyph level={effortLevel} />{t(`conversation.efforts.${snapshot.effort}`, { defaultValue: snapshot.effort })}</span>}</>}
      </div>
      <span className={styles.inputHint}>{t(snapshot?.settingsUpdating ? 'conversation.settingsUpdating' : 'conversation.inputHint')}</span>
      {(snapshot?.turnId || snapshot?.backgroundTasks) && snapshot?.capabilities.cancel && !slash ? <button className={styles.submit} type="button" disabled={!available} aria-label={t('conversation.stop')} title={t('conversation.stop')} onClick={() => void action({ type: 'interrupt', controlEpoch: snapshot.controlEpoch })}><Square size={13} fill="currentColor" aria-hidden="true" /></button>
        : <button className={styles.submit} type="submit" disabled={slash ? !activeChoice || activeChoice.disabled : !canSend || !draft.trim()} aria-label={t(slash ? 'conversation.runCommand' : 'conversation.send')} title={t(slash ? 'conversation.runCommand' : 'conversation.send')}><ArrowUp size={18} aria-hidden="true" /></button>}
    </div>
  </form>
}
