import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/useI18n'
import { pluginRequest, refreshPlugins, usePluginSnapshot } from '@/extensions/plugin-runtime'
import { useExtensionCommands } from '@/extensions/react'
import { extensionCommands } from '@/extensions/commands'
import { useWorkspaceStore } from '@/stores/workspace'
import { acquireBrowserOcclusion } from '@/stores/browser-occlusion'
import type { InstalledPlugin, PluginManageRequest } from '../../../../shared/ipc/plugins'
import styles from './PluginSettingsPanel.module.css'
import { PluginConfigurationForm } from './PluginConfigurationForm'
import type { PluginConfigurationTarget } from '@/extensions/plugin-configuration-navigation'

export function PluginSettingsPanel({ configurationTarget, onOpened }: { configurationTarget?: PluginConfigurationTarget | null; onOpened?: () => void }) {
  const { t } = useI18n('plugins')
  const snapshot = usePluginSnapshot()
  const configurationSection = useRef<HTMLDetailsElement>(null)
  const locatedConfiguration = useRef<PluginConfigurationTarget | null>(null)
  useEffect(() => {
    const section = configurationSection.current
    if (!configurationTarget || !section || locatedConfiguration.current === configurationTarget) return
    locatedConfiguration.current = configurationTarget
    section.open = true
    section.scrollIntoView({ block: 'nearest' })
    section.querySelector('summary')?.focus({ preventScroll: true })
  }, [configurationTarget, snapshot.plugins])
  const commands = useExtensionCommands()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const projectOpen = useWorkspaceStore(state => Boolean(state.activeWorkspaceId))
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [authorize, setAuthorize] = useState<InstalledPlugin | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<{ id: string; type: 'uninstall' | 'deleteData' } | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const run = async (request: PluginManageRequest) => {
    setBusy(true); setFailure('')
    try { await pluginRequest(request); await refreshPlugins(); setAuthorize(null); setConfirmation(null) }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : 'INTERNAL_ERROR') }
    finally { setBusy(false) }
  }
  useEffect(() => { void refreshPlugins().catch(cause => setFailure(cause.message)) }, [])
  const preference = (update: () => void) => { try { update(); setFailure('') } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'STORAGE_UNAVAILABLE') } }
  const conflicts = extensionCommands.resolveKeybindings(/Mac/.test(navigator.platform), projectOpen).diagnostics
  const preferences = extensionCommands.getPreferences()
  return <div className={styles.root} data-plugin-settings>
    <label className={styles.row}><input type="checkbox" checked={snapshot.developmentMode} disabled={busy}
      onChange={event => { void run({ type: 'development', enabled: event.target.checked }) }} />{t('plugins:development')}</label>
    <p className={styles.hint}>{t('plugins:developmentHint')}</p>
    <p className={styles.hint}>{t('plugins:hostBoundary')}</p>
    <div className={styles.actions}>
      <button disabled={busy} onClick={() => { void run({ type: 'import', kind: 'linked' }) }}>{t('plugins:link')}</button>
      <button disabled={busy} onClick={() => { void run({ type: 'import', kind: 'copied' }) }}>{t('plugins:copy')}</button>
      <button disabled={busy} onClick={() => { setLogsOpen(value => !value); void refreshPlugins() }}>{t('plugins:logs')}</button>
    </div>
    {failure && <p role="alert" className={styles.error}>{failure}</p>}
    {!snapshot.plugins.length && <p className={styles.hint}>{t('plugins:empty')}</p>}
    {snapshot.plugins.map(record => {
      const ownCommands = commands.commands.filter(command => command.id.startsWith(`command:${record.manifest.id}/`))
      return <section key={record.manifest.id} className={styles.card} data-plugin-id={record.manifest.id}>
        <div className={styles.row}><strong>{record.manifest.name}</strong><span>{record.manifest.version}</span><span>{t(`plugins:state.${record.state}`)}</span></div>
        <div className={styles.hint}>{record.manifest.id} · {record.source.kind === 'linked' ? t('plugins:linked') : t('plugins:copied')}</div>
        <div className={styles.path}>{record.source.directory}</div>
        <p className={styles.hint} data-plugin-runtime>{t('plugins:runtime', { pages: record.runtime?.pages ?? 0, connected: record.runtime?.connected ?? 0, ready: record.runtime?.ready ?? 0 })}</p>
        {record.error && <p role="status" className={styles.error}>{record.error}</p>}
        <div className={styles.actions}>
          <button disabled={busy || !snapshot.developmentMode} onClick={() => { setAuthorize(record); setProjects(record.projects) }}>{t('plugins:authorize')}</button>
          <button disabled={busy || !record.enabled} onClick={() => { void run({ type: 'disable', id: record.manifest.id }) }}>{t('plugins:disable')}</button>
          <button disabled={busy} onClick={() => { void run({ type: 'reload', id: record.manifest.id }) }}>{t('plugins:reload')}</button>
          <button disabled={busy} onClick={() => setConfirmation({ type: 'uninstall', id: record.manifest.id })}>{t('plugins:uninstall')}</button>
          <button disabled={busy} onClick={() => setConfirmation({ type: 'deleteData', id: record.manifest.id })}>{t('plugins:deleteData')}</button>
        </div>
        <details><summary>{t('plugins:permissions')}</summary><pre className={styles.path}>{JSON.stringify(record.manifest.permissions, null, 2)}</pre></details>
        {Boolean(record.manifest.contributes.settings?.length) && <details ref={configurationTarget?.pluginId === record.manifest.id ? configurationSection : undefined}><summary>{t('plugins:configuration')}</summary>
          <PluginConfigurationForm key={configurationTarget?.pluginId === record.manifest.id ? `${configurationTarget.scope}:${configurationTarget.proposal?.expectedRevision ?? ''}` : 'application'} record={record}
            initialScope={configurationTarget?.pluginId === record.manifest.id ? configurationTarget.scope : undefined}
            proposal={configurationTarget?.pluginId === record.manifest.id ? configurationTarget.proposal : undefined} onOpened={onOpened} />
        </details>}
        {ownCommands.length > 0 && <details><summary>{t('plugins:entries')}</summary>
          {ownCommands.map(command => <div key={command.id} className={styles.preference}>
            <span>{command.title}</span>
            <input aria-label={`${t('plugins:shortcut')} ${command.title}`} placeholder="Ctrl+Alt+Shift+R" value={shortcuts[command.id] ?? preferences.keybindings[command.id] ?? (Object.hasOwn(preferences.keybindings, command.id) ? '' : commands.bindings.find(binding => binding.commandId === command.id)?.key ?? '')}
              onChange={event => setShortcuts(values => ({ ...values, [command.id]: event.target.value }))} />
            <button onClick={() => preference(() => { if (shortcuts[command.id] !== undefined) extensionCommands.setKeybinding(command.id, shortcuts[command.id] || null) })}>{t('plugins:applyShortcut')}</button>
            <button onClick={() => preference(() => { extensionCommands.setKeybinding(command.id, undefined); setShortcuts(values => { const next = { ...values }; delete next[command.id]; return next }) })}>{t('plugins:resetShortcut')}</button>
          </div>)}
          {(record.manifest.contributes.menus ?? []).map(menu => {
            const id = `menu:${record.manifest.id}/${menu.location}/${menu.command}`
            return <div key={id} className={styles.preference}>
              <label><input type="checkbox" checked={hidden[id] ?? !commands.menus.some(entry => entry.id === id)} onChange={event => {
                const checked = event.target.checked
                preference(() => { extensionCommands.setMenuPreference(id, { hidden: checked }); setHidden(values => ({ ...values, [id]: checked })) })
              }} />{t('plugins:hideEntry')} · {menu.location} · {menu.command}</label>
              <input type="number" aria-label={`${t('plugins:order')} ${menu.command} ${menu.location}`} defaultValue={preferences.menus[id]?.order ?? commands.menus.find(entry => entry.id === id)?.order ?? menu.order ?? 100}
                onBlur={event => preference(() => extensionCommands.setMenuPreference(id, { hidden: hidden[id] ?? !commands.menus.some(entry => entry.id === id), order: Number(event.target.value) }))} />
            </div>
          })}
        </details>}
      </section>
    })}
    {authorize && <section className={styles.card} role="region" aria-label={t('plugins:authorize')}>
      <strong>{authorize.manifest.name} — {t('plugins:permissions')}</strong>
      <pre className={styles.path}>{JSON.stringify(authorize.manifest.permissions, null, 2)}</pre>
      <p>{t('plugins:projectScope')}</p>
      {workspaces.map(workspace => <label className={styles.row} key={workspace.id}><input type="checkbox" checked={projects.includes(workspace.id)} onChange={event => {
        setProjects(values => event.target.checked ? [...values, workspace.id] : values.filter(id => id !== workspace.id))
      }} />{workspace.name}</label>)}
      <p className={styles.hint}>{t('plugins:grantHint')}</p>
      <div className={styles.actions}><button disabled={busy} onClick={() => { void run({ type: 'enable', id: authorize.manifest.id, projects }) }}>{t('plugins:confirmEnable')}</button>
        <button onClick={() => setAuthorize(null)}>{t('plugins:cancel')}</button></div>
    </section>}
    {confirmation && <section className={styles.card} role="alertdialog" aria-label={t(`plugins:${confirmation.type}`)}>
      <p>{confirmation.type === 'uninstall' ? t('plugins:uninstallHint') : t('plugins:deleteHint')}</p>
      <div className={styles.actions}><button disabled={busy} onClick={() => { void run({ ...confirmation }) }}>{t('plugins:confirm')}</button>
        <button onClick={() => setConfirmation(null)}>{t('plugins:cancel')}</button></div>
    </section>}
    {conflicts.map(conflict => <p key={conflict.key} role="status" className={styles.error}>KEYBINDING_CONFLICT · {conflict.key} · {conflict.commandIds.join(', ')}</p>)}
    {logsOpen && <section className={styles.card}><strong>{t('plugins:logs')}</strong><button onClick={() => { void refreshPlugins() }}>{t('plugins:refresh')}</button>
      <pre className={styles.logs}>{snapshot.logs.map(log => `${log.time} ${log.pluginId ?? ''} ${log.instanceId ?? ''} ${log.method ?? ''} ${log.code} ${log.duration === undefined ? '' : `${log.duration}ms`}`).join('\n')}</pre></section>}
  </div>
}

export function PluginNotifications() {
  const [message, setMessage] = useState<{ source: string; message: string } | null>(null)
  useEffect(() => {
    const listener = (event: Event) => setMessage((event as CustomEvent<{ source: string; message: string }>).detail)
    window.addEventListener('janusx:plugin-toast', listener)
    return () => window.removeEventListener('janusx:plugin-toast', listener)
  }, [])
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(timer) }, [message])
  useEffect(() => message ? acquireBrowserOcclusion() : undefined, [message])
  return message ? <div className={styles.toast} role="status"><strong>{message.source}</strong><p>{message.message}</p></div> : null
}
