import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight, FileText, Folder, Paperclip, Plus, Search } from 'lucide-react'
import type { FileNode } from '../../../shared/ipc/workspace'
import { MAX_CONVERSATION_ATTACHMENTS, MAX_CONVERSATION_ATTACHMENT_BYTES, activeConversationReferences, type ConversationReference } from '../../../shared/conversation-context'
import { setConversationReferences } from '../stores/conversation-context'
import { readWorkspaceFileDragData, hasWorkspaceFileDrag } from '../lib/terminal-file-reference'
import styles from './AgentSessionPane.module.css'
import type { ConversationInputHandle } from './ConversationInput'

export function ConversationContext({ inputRef, terminalId, workspacePath, references, draft, setDraft, disabled, onImporting, open, onOpenChange, pickerActive, children }: {
  inputRef: RefObject<ConversationInputHandle>
  open: boolean; onOpenChange(value: boolean): void; pickerActive: boolean
  terminalId: string; workspacePath?: string; references: ConversationReference[]; draft: string; setDraft(text: string): void; disabled: boolean; onImporting(value: boolean): void; children(addControl: ReactNode): ReactNode
}) {
  const { t } = useTranslation('terminal')
  const setOpen = onOpenChange
  const [filesOpen, setFilesOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [nodes, setNodes] = useState<FileNode[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const addControl = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const focusInput = () => inputRef.current?.focus()
  const activeReferences = activeConversationReferences(draft, references)
  useEffect(() => {
    const pending = references.filter(ref => !ref.inline)
    if (!pending.length || !inputRef.current) return
    const inline = pending.map(ref => ({ ...ref, inline: true }))
    setConversationReferences(terminalId, current => current.map(ref => inline.find(item => item.id === ref.id) ?? ref))
    inputRef.current.insertReferences(inline)
  }, [references, terminalId, inputRef])
  useEffect(() => {
    if (!open) return
    addControl.current?.querySelector<HTMLButtonElement>('[role="dialog"] button')?.focus()
    const outside = (event: PointerEvent) => { if (!addControl.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, setOpen])
  useEffect(() => { if (!open) { setFilesOpen(false); setFileQuery('') } }, [open])
  useEffect(() => { if (filesOpen) searchRef.current?.focus() }, [filesOpen])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled, setOpen])
  const importLock = useRef(false)
  const mention = /(?:^|\s)@(?:"([^"]*)|([^\s]*))$/.exec(draft)
  const query = open && filesOpen ? fileQuery : mention?.[1] ?? mention?.[2] ?? ''
  const beforeMention = draft.slice(0, draft.length - query.length - (mention?.[1] !== undefined ? 2 : 1))
  const directory = query.includes('/') ? query.slice(0, query.lastIndexOf('/') + 1) : ''
  const filter = query.slice(directory.length).toLowerCase()
  const browsing = Boolean(workspacePath && !disabled && !pickerActive && (open ? filesOpen : mention && mentionDismissed !== draft))
  const matches = nodes.filter(node => node.name.toLowerCase().includes(filter)).slice(0, 50)
  useEffect(() => { setActive(0) }, [query])
  useEffect(() => {
    if (!browsing || !workspacePath) return
    let active = true
    setLoading(true); setError(''); setNodes([])
    void window.electron.fileTree.children(workspacePath, directory).then(items => {
      if (active) setNodes(items)
    }).catch(e => { if (active) setError(String(e)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [browsing, workspacePath, directory])
  const add = (ref: ConversationReference, range?: [number, number]) => {
    let inline = { ...ref, inline: true }
    setConversationReferences(terminalId, current => {
      const existing = current.find(item => item.path === ref.path && item.quote === ref.quote)
      if (existing) { inline = { ...existing, inline: true }; return current.map(item => item.id === existing.id ? inline : item) }
      return [...current, inline]
    })
    inputRef.current?.insertReferences([inline], range)
  }
  const importFiles = async (files: File[]) => {
    if (disabled || importLock.current || !files.length) return
    if (activeReferences.length + files.length > MAX_CONVERSATION_ATTACHMENTS) { setError(t('conversation.context.limit')); return }
    if (files.some(file => !file.size || file.size > MAX_CONVERSATION_ATTACHMENT_BYTES)) { setError(t('conversation.context.size')); return }
    importLock.current = true; setImporting(true); onImporting(true); setError('')
    try {
      for (const file of files) add(await window.electron.file.importConversationAttachment(file.name, new Uint8Array(await file.arrayBuffer())))
    } catch (e) { setError(String(e)) }
    finally { importLock.current = false; setImporting(false); onImporting(false) }
  }
  const attachNode = (node: FileNode) => {
    if (activeReferences.length >= MAX_CONVERSATION_ATTACHMENTS) { setError(t('conversation.context.limit')); return }
    const path = `${workspacePath!.replace(/[\\/]+$/, '')}/${node.path}`
    add({ id: crypto.randomUUID(), path, name: node.name, kind: node.type === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(node.name) ? 'image' : node.type }, !open ? [beforeMention.length, draft.length] : undefined)
    setOpen(false); focusInput()
  }
  const navigate = (path: string) => open ? setFileQuery(path) : setDraft(`${beforeMention}@"${path}`)
  const choose = (node: FileNode) => node.type === 'directory' ? navigate(node.path + '/') : attachNode(node)
  const returnToMenu = () => {
    setFilesOpen(false)
    requestAnimationFrame(() => addControl.current?.querySelector<HTMLButtonElement>('[role="dialog"] button')?.focus())
  }
  useEffect(() => {
    if (!browsing || open) return
    const outside = (event: PointerEvent) => { if (!area.current?.contains(event.target as Node)) setMentionDismissed(draft) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [browsing, open, draft])
  useEffect(() => {
    area.current?.querySelector('[data-file-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, browsing, nodes])
  const fileList = <>
    <div className={styles.commandHeader}>
      {(open || directory) && <button type="button" aria-label={t('conversation.context.back')} onClick={() => directory ? navigate(directory.replace(/[^/]+\/$/, '')) : returnToMenu()}><ArrowLeft size={15} /></button>}
      <span>{directory || t('conversation.context.reference')}</span>
    </div>
    {open && <label className={styles.pickerSearch}><Search size={15} /><input ref={searchRef} aria-label={t('conversation.context.search')} placeholder={t('conversation.context.search')} value={fileQuery} onChange={event => setFileQuery(event.target.value)} /></label>}
    <div className={styles.commandList}>
      {loading ? <p className={styles.pickerMessage} role="status">{t('conversation.context.loading')}</p> : <>
        {matches.map((node, index) => <div key={node.path} className={styles.contextFileRow}>
          <button type="button" className={styles.commandOption} data-file-active={active === index} data-active={active === index} onMouseEnter={() => setActive(index)} onClick={() => choose(node)}>
            {node.type === 'directory' ? <Folder size={16} /> : <FileText size={16} />}<span>{node.name}{node.type === 'directory' ? '/' : ''}</span>{node.type === 'directory' && <ChevronRight size={14} />}
          </button>
          {node.type === 'directory' && <button type="button" className={styles.contextUseFolder} onClick={() => attachNode(node)}>{t('conversation.context.useFolder')}</button>}
        </div>)}
        {!matches.length && !error && <p className={styles.pickerMessage}>{t('conversation.context.empty')}</p>}
      </>}
    </div>
    {error && <p className={styles.pickerMessage} role="alert">{error}</p>}
  </>
  const attachmentControl = <div ref={addControl} className={styles.contextAdd} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      if (filesOpen) returnToMenu()
      else { setOpen(false); addButton.current?.focus() }
    } else if (filesOpen && event.target === searchRef.current) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1)))) }
      else if (event.key === 'Enter') { event.preventDefault(); if (matches[active]) choose(matches[active]) }
    } else if (!filesOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const buttons = Array.from(addControl.current!.querySelectorAll<HTMLButtonElement>('[role="dialog"] button:not(:disabled)'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
  }}>
    <button ref={addButton} className={styles.contextAddButton} type="button" disabled={disabled || importing} title={t('conversation.context.add')} aria-label={t('conversation.context.add')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}><Plus size={18} aria-hidden="true" /></button>
    {open && <div id={menuId} className={styles.commandPanel + (!filesOpen ? ' ' + styles.contextMenu : '')} role="dialog" aria-label={t('conversation.context.add')}>
      {filesOpen ? fileList : <>
        <div className={styles.commandHeader}><span>{t('conversation.context.add')}</span></div>
        <div className={styles.commandList}>
          <button className={styles.commandOption} aria-label={t('conversation.context.attach')} type="button" disabled={disabled || importing} onClick={() => { picker.current?.click(); setOpen(false); focusInput() }}><Paperclip size={16} /><span><strong>{t('conversation.context.attach')}</strong><small>{t('conversation.context.attachHint')}</small></span></button>
          {workspacePath && <button className={styles.commandOption} aria-label={t('conversation.context.reference')} type="button" disabled={disabled || importing} onClick={() => { setFileQuery(''); setFilesOpen(true) }}><Folder size={16} /><span><strong>{t('conversation.context.reference')}</strong><small>{t('conversation.context.referenceHint')}</small></span><ChevronRight size={14} /></button>}
        </div>
      </>}
    </div>}
  </div>
  return <div ref={area} className={styles.contextArea} onKeyDownCapture={event => {
    if (!browsing || event.target !== inputRef.current?.element || event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMentionDismissed(draft); return }
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setActive(value => Math.max(0, Math.min(matches.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))))
      else if (matches[active]) choose(matches[active])
    }
  }} onPaste={event => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void importFiles(files) }
  }} onDragOver={event => {
    if (hasWorkspaceFileDrag(event.dataTransfer) || event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; if (!disabled) inputRef.current?.setDropPoint(event.clientX, event.clientY) }
  }} onDrop={event => {
    if (!hasWorkspaceFileDrag(event.dataTransfer) && !event.dataTransfer.files.length) return
    event.preventDefault(); event.stopPropagation()
    if (disabled) return
    inputRef.current?.setDropPoint(event.clientX, event.clientY)
    const payload = readWorkspaceFileDragData(event.dataTransfer)
    if (payload) {
      if (activeReferences.length >= MAX_CONVERSATION_ATTACHMENTS) { setError(t('conversation.context.limit')); return }
      add({ id: crypto.randomUUID(), name: payload.name, path: `${payload.workspacePath.replace(/[\\/]+$/, '')}/${payload.path}`, kind: payload.type === 'file' && /\.(png|jpe?g|webp|gif)$/i.test(payload.name) ? 'image' : payload.type })
    } else void importFiles(Array.from(event.dataTransfer.files))
  }}>
    <input ref={picker} type="file" multiple hidden onChange={event => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {importing && <span role="status">{t('conversation.context.importing')}</span>}
    {browsing && !open && <div className={styles.commandPanel} aria-label={t('conversation.context.reference')}>{fileList}</div>}
    {error && !browsing && <p className={styles.error} role="alert">{error}</p>}
    {children(attachmentControl)}
  </div>
}
