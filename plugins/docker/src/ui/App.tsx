import { useEffect, useRef, useState } from 'react'
import { Box, Search, RefreshCw, Play, Square, RotateCw, ExternalLink, ChevronLeft, Layers, TerminalSquare, X } from 'lucide-react'
import { call } from './bridge'
import { useLocale, errorText } from './i18n'
import { LogsPane } from './LogsPane'
import { TerminalPane } from './TerminalPane'
import type { ContainerTerminalOutput } from '@janusx/plugin-sdk'
import type { Container, Engine, ViewState, ContainerView, DetailTab } from '../shared/docker'
interface Snapshot { engine: Engine; containers: Container[]; operation: { busy: boolean; pending: string[]; results: { id: string; ok: boolean; error?: string }[] } }
const initial: ViewState = { selected: '', search: '', runningOnly: false, containers: {} }
const defaults: ContainerView = { tab: 'overview', logSearch: '', scroll: 0, paused: false }
export function App({ active }: { active: boolean }) {
  const t = useLocale(), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [state, setState] = useState(initial), [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [showDetail, setShowDetail] = useState(false), [shell, setShell] = useState('/bin/sh')
  const [sessions, setSessions] = useState<Record<string, string>>({}), [ended, setEnded] = useState<Record<string, boolean>>({})
  const polling = useRef(false), connected = useRef(false)
  const visible = useRef(active); visible.current = active
  const load = async (connect = false) => {
    if (polling.current) return; polling.current = true
    if (connect) setBusy(true)
    try { const next = await call<Snapshot>(connect ? 'engine.connect' : 'containers.list'); setSnapshot(next); setError(''); connected.current = true }
    catch (cause) { setError(errorText(cause)); connected.current = false }
    finally { polling.current = false; setBusy(false) }
  }
  useEffect(() => {
    let disposed = false
    void call<ViewState>('ui.read').then(next => {
      if (disposed) return; setState(next); setReady(true)
      setSessions(Object.fromEntries(Object.entries(next.containers).filter(([, item]) => item.terminal).map(([id, item]) => [id, item.terminal!])))
      setShowDetail(Boolean(next.selected)); void load(true)
    }).catch(cause => setError(errorText(cause)))
    const timer = setInterval(() => { if (connected.current && visible.current) void load() }, 2000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  useEffect(() => { if (ready) void call('ui.save', { state }).catch(() => {}) }, [state, ready])
  const selected = snapshot?.containers.find(item => item.id === state.selected), view = state.containers[state.selected] ?? defaults
  const updateView = (patch: Partial<ContainerView>) => setState(value => ({ ...value, containers: { ...value.containers, [value.selected]: { ...(value.containers[value.selected] ?? defaults), ...patch } } }))
  const choose = (item: Container) => { setState(value => ({ ...value, selected: item.id })); setShell(snapshot?.engine.os === 'windows' ? 'cmd.exe' : '/bin/sh'); setShowDetail(true) }
  const operate = async (action: string, input: object) => { setBusy(true); setError(''); try { await call('containers.operate', { ...input, action }); await load() } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) } }
  const openShell = async () => {
    if (!selected) return; setBusy(true)
    try { const output = await call<ContainerTerminalOutput>('terminal.open', { id: selected.id, shell }); setSessions(value => ({ ...value, [selected.id]: output.id })); setEnded(value => ({ ...value, [selected.id]: output.exited })); setError('') }
    catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }
  const closeShell = async () => { if (!selected) return; try { await call('terminal.close', { container: selected.id, id: sessions[selected.id] }); setSessions(value => { const next = { ...value }; delete next[selected.id]; return next }) } catch (cause) { setError(errorText(cause)) } }
  const filtered = snapshot?.containers.filter(item => (!state.runningOnly || item.state === 'running') && `${item.name} ${item.image} ${item.project}`.toLowerCase().includes(state.search.toLowerCase())) ?? []
  const groups = new Map<string, Container[]>()
  for (const item of filtered) groups.set(item.project, [...(groups.get(item.project) ?? []), item])
  const disabled = busy || snapshot?.operation.busy || !connected.current
  return <main className={`docker-app ${showDetail ? 'detail-open' : ''}`}>
    <header className="toolbar"><Box size={16}/><strong>Docker</strong><span className="engine-label"><i className={snapshot && connected.current ? 'dot running' : 'dot'}/>{snapshot?.engine.name ?? t('local')}</span><button className="icon" aria-label={t('refresh')} title={t('refresh')} disabled={busy} onClick={() => { void load(!connected.current) }}><RefreshCw size={14} className={busy ? 'spin' : ''}/></button><button className="icon" aria-label={t('desktop')} title={t('desktop')} onClick={() => { void call('desktop.open').catch(cause => setError(errorText(cause))) }}><ExternalLink size={14}/></button></header>
    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => { void load(true) }}>{t('retry')}</button><button className="icon" aria-label={t('clear')} onClick={() => setError('')}><X size={13}/></button></div>}
    {!snapshot ? <div className="empty connection"><Box size={30} strokeWidth={1.2}/><h2>{t('disconnected')}</h2><p>{t('connectHelp')}</p><button className="primary" disabled={busy} onClick={() => { void load(true) }}>{busy ? t('working') : t('connect')}</button><button onClick={() => { void call('desktop.open').catch(cause => setError(errorText(cause))) }}>{t('desktop')}</button></div>
      : <div className="workspace">
        <aside className="container-list">
          <div className="list-heading"><strong>{t('containers')}</strong><span className="count">{snapshot.containers.length}</span></div>
          <label className="search"><Search size={14}/><input aria-label={t('search')} placeholder={t('search')} value={state.search} onChange={event => setState(value => ({ ...value, search: event.target.value }))}/></label>
          <div className="filters" role="group" aria-label={t('status')}>{[false, true].map(runningOnly => <button key={String(runningOnly)} aria-pressed={state.runningOnly === runningOnly} onClick={() => setState(value => ({ ...value, runningOnly }))}>{t(runningOnly ? 'running' : 'all')}</button>)}</div>
          <div className="list-scroll">{[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([project, items]) => <section className="group" key={project}>
            <div className="group-heading"><Layers size={12}/><span title={project || t('standalone')}>{project || t('standalone')}</span>{project && <div className="row-actions" title={t('groupHelp')}><button className="icon" disabled={disabled} aria-label={`${t('startGroup')} ${project}`} title={t('startGroup')} onClick={() => { void operate('start', { project }) }}><Play size={12}/></button><button className="icon" disabled={disabled} aria-label={`${t('stopGroup')} ${project}`} title={t('stopGroup')} onClick={() => { void operate('stop', { project }) }}><Square size={11}/></button></div>}</div>
            {items.map(item => <button key={item.id} className={`container-row ${selected?.id === item.id ? 'selected' : ''}`} aria-pressed={selected?.id === item.id} onClick={() => choose(item)}>
              <i className={`dot ${item.state === 'running' ? 'running' : ''}`}/><span className="row-content"><strong>{item.name}</strong><small>{item.image}</small><span className="row-meta">{item.state === 'running' ? t('running') : t('stopped')}{item.ports.length ? ` · ${[...new Set(item.ports.map(port => port.port))].join(', ')}` : ''}</span></span>{sessions[item.id] && !ended[item.id] && <TerminalSquare size={13} className="muted"/>}
            </button>)}
          </section>)}{!filtered.length && <div className="empty small"><p>{snapshot.containers.length ? t('noMatch') : t('empty')}</p>{!snapshot.containers.length && <p className="hint">{t('emptyHelp')}</p>}</div>}</div>
          <footer className="list-footer">{t('local')} · {snapshot.engine.version}</footer>
        </aside>
        <section className="detail">{!selected ? <div className="empty"><Box size={27} strokeWidth={1.2}/><h2>{t('select')}</h2><p>{t('selectHelp')}</p></div> : <>
          <header className="detail-heading"><button className="icon back" aria-label={t('back')} onClick={() => setShowDetail(false)}><ChevronLeft size={16}/></button><div className="detail-title"><h1 title={selected.name}>{selected.name}</h1><span><i className={`dot ${selected.state === 'running' ? 'running' : ''}`}/>{selected.status}</span></div><div className="actions">
            <button disabled={disabled} aria-label={t(selected.state === 'running' ? 'stop' : 'start')} title={t(selected.state === 'running' ? 'stop' : 'start')} onClick={() => { void operate(selected.state === 'running' ? 'stop' : 'start', { id: selected.id }) }}>{selected.state === 'running' ? <Square size={13}/> : <Play size={13}/>}<span>{t(selected.state === 'running' ? 'stop' : 'start')}</span></button>
            <button className="icon" disabled={disabled || selected.state !== 'running'} aria-label={t('restart')} title={t('restart')} onClick={() => { void operate('restart', { id: selected.id }) }}><RotateCw size={14}/></button></div></header>
          <nav className="tabs" aria-label="Docker">{(['overview', 'logs', 'terminal'] as DetailTab[]).map(tab => <button key={tab} aria-current={view.tab === tab ? 'page' : undefined} onClick={() => updateView({ tab })}>{t(tab)}</button>)}</nav>
          {(snapshot.operation.busy || snapshot.operation.results.length > 0) && <div className={`notice ${snapshot.operation.results.some(item => !item.ok) ? 'error' : ''}`} role="status"><span>{snapshot.operation.busy ? t('working') : snapshot.operation.results.some(item => !item.ok) ? t('failed') : t('complete')}{snapshot.operation.results.map(item => <small key={item.id}>{snapshot.containers.find(container => container.id === item.id)?.name ?? item.id.slice(0, 12)}: {item.ok ? t('complete') : item.error}</small>)}</span></div>}
          {view.tab === 'overview' && <div className="overview"><dl><dt>{t('image')}</dt><dd>{selected.image}</dd><dt>{t('status')}</dt><dd>{selected.status}</dd><dt>{t('id')}</dt><dd className="mono">{selected.id}</dd>{selected.project && <><dt>{t('project')}</dt><dd>{selected.project}{selected.service && ` / ${selected.service}`}</dd></>}</dl><h3>{t('ports')}</h3><div className="port-list">{[...new Set(selected.ports.filter(port => port.protocol === 'tcp').map(port => port.port))].map(port => <button className="port-link" key={port} onClick={() => { void call('service.open', { id: selected.id, port }).catch(cause => setError(errorText(cause))) }}>127.0.0.1:{port}<ExternalLink size={12}/></button>)}</div>{!selected.ports.some(port => port.protocol === 'tcp') && <p className="hint">{t('noPorts')}</p>}<p className="hint">{t('portHelp')}</p></div>}
          {view.tab === 'logs' && active && <LogsPane key={selected.id} container={selected.id} view={view} update={updateView}/>}
          {view.tab === 'terminal' && <><div className="sub-toolbar"><label className="shell-select">{t('shell')}<select aria-label={t('shell')} value={shell} onChange={event => setShell(event.target.value)} disabled={Boolean(sessions[selected.id] && !ended[selected.id])}>{['/bin/sh', '/bin/bash', 'cmd.exe', 'powershell.exe'].map(value => <option key={value}>{value}</option>)}</select></label><span className="spacer"/>{sessions[selected.id] && !ended[selected.id] ? <button onClick={() => { void closeShell() }}>{t('closeTerminal')}</button> : <button disabled={busy || selected.state !== 'running'} onClick={() => { void openShell() }}><TerminalSquare size={14}/>{t('openTerminal')}</button>}</div>{sessions[selected.id] ? active && <TerminalPane key={sessions[selected.id]} container={selected.id} session={sessions[selected.id]} onEnded={() => setEnded(value => ({ ...value, [selected.id]: true }))}/> : <div className="empty"><TerminalSquare size={26} strokeWidth={1.2}/><p>{t(selected.state === 'running' ? 'terminalHelp' : 'notRunning')}</p></div>}</>}
        </>}</section>
      </div>}
  </main>
}
