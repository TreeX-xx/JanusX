import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Folder, FolderOpen, LoaderCircle, Monitor, Server, TerminalSquare, X } from 'lucide-react'
import type { Workspace } from '../../../shared/ipc/workspace'
import type { RuntimeDirectory, WorkspaceRuntime } from '../../../shared/workspace-runtime'
import styles from './WorkspaceImport.module.css'
import { ModalFrame } from './shared/ModalFrame'

type ExternalRuntime = Exclude<WorkspaceRuntime, { kind: 'windows' }>

function WorkspaceImport({ finish }: { finish: (workspace: Workspace | null) => void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const text = (cn: string, en: string) => zh ? cn : en
  const [kind, setKind] = useState<'windows' | 'wsl' | 'ssh'>('windows')
  const [distributions, setDistributions] = useState<string[]>([])
  const [hosts, setHosts] = useState<string[]>([])
  const [distro, setDistro] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [identity, setIdentity] = useState('')
  const [path, setPath] = useState('')
  const [connected, setConnected] = useState<ExternalRuntime | null>(null)
  const [entries, setEntries] = useState<RuntimeDirectory[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  const result = useRef<Workspace | null>(null)
  const alive = useRef(true)
  const operation = useRef(0)

  useEffect(() => {
    const api = window.electron.workspaceRuntime
    void api?.distributions().then(items => { if (alive.current) { setDistributions(items); setDistro(items[0] ?? '') } }).catch(() => {})
    void api?.hosts().then(items => { if (alive.current) setHosts(items) }).catch(() => {})
    panel.current?.focus()
    return () => { alive.current = false; operation.current++ }
  }, [])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    const generation = ++operation.current
    setBusy(true); setError('')
    try { await action() } catch (reason) {
      if (alive.current && generation === operation.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (alive.current && generation === operation.current) setBusy(false) }
  }
  const browse = async (runtime: ExternalRuntime, directory: string) => {
    const result = await window.electron.workspaceRuntime!.browse(runtime, directory)
    if (!alive.current) return
    setPath(result.path); setEntries(result.entries.filter(entry => entry.directory)); setConnected(runtime)
  }
  const connect = () => run(async () => {
    const runtime: ExternalRuntime = kind === 'wsl' ? { kind, distro, root: '' }
      : { kind: 'ssh', host: host.trim(), ...(port.trim() ? { port: Number(port) } : {}), ...(identity.trim() ? { identityFile: identity.trim() } : {}), root: '' }
    const result = await window.electron.workspaceRuntime!.connect(runtime)
    if (alive.current) await browse(runtime, result.home)
  })
  const addLocal = (requestClose: () => void) => run(async () => {
    const selection = await window.electron.dialog.openDirectory()
    if (!alive.current || selection.canceled || !selection.filePaths[0]) return
    const path = selection.filePaths[0]
    const workspace = await window.electron.workspace.create({ name: path.split(/[/\\]/).pop() || 'Workspace', path })
    if (alive.current) { result.current = workspace; requestClose() }
  })
  const addRemote = (requestClose: () => void) => run(async () => {
    if (!connected) return
    // Revalidate typed paths before registration, rather than registering the
    // last browsed directory when the path field has changed.
    const directory = await window.electron.workspaceRuntime!.browse(connected, path)
    const workspace = await window.electron.workspace.create({ name: directory.path.split('/').pop() || '/', path: directory.path, runtime: { ...connected, root: directory.path } })
    if (alive.current) { result.current = workspace; requestClose() }
  })

  const sources = [
    { kind: 'windows' as const, label: 'Local', icon: Monitor },
    { kind: 'wsl' as const, label: 'WSL', icon: TerminalSquare },
    { kind: 'ssh' as const, label: 'SSH', icon: Server },
  ]
  const activity = connected ? text('正在读取文件夹…', 'Reading folder…') : kind === 'windows'
    ? text('正在打开文件夹…', 'Opening folder…') : text('正在连接…', 'Connecting…')

  return <ModalFrame label={text('添加工作区', 'Add workspace')} onClose={() => finish(result.current)}
    dismissable={!busy} zIndex={12000} panelClassName={styles.panel} backdropClassName={styles.backdrop}>
    {({ requestClose }) => <div ref={panel} tabIndex={-1} className={styles.content}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); if (!busy) requestClose() }
        if (event.key === 'Tab') {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])]
            .filter(element => element.getClientRects().length > 0)
          const first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <header className={styles.header}>
        <div><h2>{text('添加工作区', 'Add workspace')}</h2><p>{text('从哪里打开项目？', 'Where is your project?')}</p></div>
        <button className={styles.iconButton} type="button" disabled={busy} aria-label={text('关闭', 'Close')} onClick={requestClose}><X size={16} /></button>
      </header>
      <div className={styles.sources} role="group" aria-label={text('工作区来源', 'Workspace source')}>
        {sources.map(({ kind: value, label, icon: Icon }) => <button type="button" key={value} disabled={busy} aria-pressed={kind === value}
          onClick={() => { setKind(value); setConnected(null); setEntries([]); setPath(''); setError('') }}><Icon size={15} aria-hidden="true" />{label}</button>)}
      </div>
      <div className={styles.body}>
      {kind === 'windows' ? <div className={styles.local}>
        <span className={styles.folderIcon}><FolderOpen size={24} strokeWidth={1.5} /></span>
        <div><h3>{text('本机文件夹', 'A folder on this computer')}</h3><p>{text('选择已有项目，文件保留在原位置。', 'Open an existing project. Your files stay where they are.')}</p></div>
      </div> : !connected ? <div className={styles.form}>
          {kind === 'wsl' ? <label>{text('WSL 发行版', 'WSL distribution')}<select value={distro} disabled={busy} onChange={event => setDistro(event.target.value)}>
            {!distributions.length && <option value="">{text('未发现 WSL 发行版', 'No WSL distributions found')}</option>}
            {distributions.map(item => <option key={item}>{item}</option>)}
          </select></label> : <>
            <label>{text('SSH 主机', 'SSH host')}<input autoComplete="off" spellCheck={false} value={host} list="workspace-ssh-hosts" placeholder="user@host" disabled={busy} onChange={event => setHost(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && host.trim()) void connect() }} /></label>
            <datalist id="workspace-ssh-hosts">{hosts.map(item => <option key={item} value={item} />)}</datalist>
            <p className={styles.hint}>{text('输入 SSH 配置中的主机名，或 user@host。', 'Enter a host from your SSH config, or user@host.')}</p>
            <details className={styles.advanced}><summary><ChevronRight size={14} />{text('高级连接', 'Advanced connection')}<span>{text('可选', 'Optional')}</span></summary>
              <div className={styles.advancedFields}>
              <label>{text('端口', 'Port')}<input type="number" min={1} max={65535} placeholder={text('使用 SSH 配置', 'SSH config default')} value={port} disabled={busy} onChange={event => setPort(event.target.value)} /></label>
              <label>{text('身份文件', 'Identity file')}<input spellCheck={false} placeholder="~/.ssh/id_ed25519" value={identity} disabled={busy} onChange={event => setIdentity(event.target.value)} /></label>
              </div>
            </details>
          </>}
          {kind === 'wsl' && <p className={styles.hint}>{text('连接后，选择 Linux 中的项目文件夹。', 'Connect, then choose a project folder in Linux.')}</p>}
        </div> : <div className={styles.browser}>
          <div className={styles.browserHeading}><span>{connected.kind === 'wsl' ? <TerminalSquare size={14} /> : <Server size={14} />}{connected.kind === 'wsl' ? connected.distro : connected.host}</span>
            <button className={styles.backButton} disabled={busy} onClick={() => { setConnected(null); setError('') }}><ArrowLeft size={13} />{text('返回', 'Back')}</button></div>
          <div className={styles.location}><button className={styles.iconButton} disabled={busy || path === '/'} aria-label={text('上级目录', 'Parent directory')} onClick={() => void run(() => browse(connected, path.slice(0, path.lastIndexOf('/')) || '/'))}><ArrowUp size={16} /></button>
            <input aria-label={text('目标目录', 'Directory')} spellCheck={false} value={path} disabled={busy} onChange={event => setPath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void run(() => browse(connected, path)) }} />
            <button className={styles.iconButton} aria-label={text('打开', 'Open')} disabled={busy} onClick={() => void run(() => browse(connected, path))}><ArrowRight size={16} /></button></div>
          <div className={styles.directories} aria-label={text('文件夹', 'Folders')}>
            {entries.map(entry => <button key={entry.path} disabled={busy} onClick={() => void run(() => browse(connected, entry.path))}><Folder size={16} strokeWidth={1.5} /><span>{entry.name}</span><ChevronRight size={13} /></button>)}
            {!entries.length && <div className={styles.empty}><FolderOpen size={24} strokeWidth={1.5} /><p>{text('此目录没有子文件夹', 'No subfolders in this directory')}</p></div>}
          </div>
        </div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
      <footer className={styles.footer}>
        <span className={styles.status} role="status">{busy ? activity : connected ? text('打开当前文件夹', 'Open the current folder') : ''}</span>
        <button className={styles.cancel} disabled={busy} onClick={requestClose}>{text('取消', 'Cancel')}</button>
        <button className={styles.primary} disabled={busy || (kind === 'wsl' && !distro) || (kind === 'ssh' && !host.trim())} onClick={() => void (kind === 'windows' ? addLocal(requestClose) : connected ? addRemote(requestClose) : connect())}>
          {busy && <LoaderCircle className={styles.spinner} size={14} />}{kind === 'windows' ? text('选择文件夹', 'Choose folder') : connected ? text('添加并打开', 'Add and open') : text('连接', 'Connect')}
        </button>
      </footer>
    </div>}
  </ModalFrame>
}

let current: Promise<Workspace | null> | null = null
export function openWorkspaceImport(): Promise<Workspace | null> {
  if (current) return current
  const previousFocus = document.activeElement as HTMLElement | null
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  current = new Promise(resolve => {
    root.render(<WorkspaceImport finish={workspace => {
      root.unmount(); container.remove(); current = null; previousFocus?.focus(); resolve(workspace)
    }} />)
  })
  return current
}
