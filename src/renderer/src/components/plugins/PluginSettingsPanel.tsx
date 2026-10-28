// Note: .agents/notes/workbench/plugin-contract-v1.md - all-workspace access and entry preferences.
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
import { PluginBackgroundPanel } from './PluginBackgroundPanel'
import type { PluginAuthorizationTarget, PluginConfigurationTarget } from '@/extensions/plugin-configuration-navigation'
import { openExtensionView } from '@/extensions/workbench'
import { pluginConfigurationDrafts } from '@/extensions/plugin-configuration-drafts'
import { PluginCatalog } from './PluginCatalog'

function PluginThemes({ manifest }: { manifest: InstalledPlugin['manifest'] }) {
  const { t } = useI18n('plugins')
  if (!manifest.contributes.themes?.length) return null
  return <section data-plugin-themes><strong>{t('plugins:themes')}</strong><p className={styles.hint}>{t('plugins:themeHint')}</p>
    {manifest.contributes.themes.map(theme => <div className={styles.row} key={theme.id}><span>{theme.title} · {theme.base}</span>
      <code>{Object.values(theme.colors).join(' · ')}</code></div>)}
  </section>
}

function PluginWindows({ manifest, review = false, enabled = false }: { manifest: InstalledPlugin['manifest']; review?: boolean; enabled?: boolean }) {
  const { t } = useI18n('plugins')
  const windows = manifest.contributes.views.filter(view => view.location === 'window')
  if (!windows.length) return null
  return <details open={review || undefined} data-plugin-windows><summary>{t('plugins:windows')}</summary>
    <p className={styles.hint}>{t('plugins:windowHint')}</p>
    {windows.map(view => <div className={styles.row} key={view.id}><span>{view.title} · {view.scope}</span>
      {!review && <button disabled={!enabled} onClick={() => openExtensionView(`extension:${manifest.id}/${view.id}`)}>{t('plugins:openWindow')} · {view.title}</button>}
    </div>)}
  </details>
}

function PluginContexts({ manifest, review = false }: { manifest: InstalledPlugin['manifest']; review?: boolean }) {
  const { t } = useI18n('plugins')
  if (!manifest.contributes.contextProviders?.length) return null
  return <details open={review || undefined} data-plugin-contexts><summary>{t('plugins:contextProviders')}</summary>
    <p className={styles.hint}>{t('plugins:contextHint')}</p>
    {manifest.contributes.contextProviders.map(provider => <div className={styles.card} key={provider.id}>
      <strong>{provider.title} · v{provider.version}</strong><p>{provider.description}</p><pre className={styles.path}>{provider.path}</pre>
    </div>)}
  </details>
}

function PluginWorkflows({ manifest, review = false }: { manifest: InstalledPlugin['manifest']; review?: boolean }) {
  const { t } = useI18n('plugins')
  if (!manifest.contributes.workflows?.length) return null
  return <details open={review || undefined} data-plugin-workflows><summary>{t('plugins:workflows')}</summary>
    <p className={styles.hint}>{t('plugins:workflowHint')}</p>
    {manifest.contributes.workflows.map(workflow => {
      const service = manifest.contributes.services?.find(service => service.id === workflow.service && service.version === workflow.version)
      const task = manifest.contributes.tasks?.find(task => task.id === service?.task)
      return <div className={styles.card} key={workflow.id}><strong>{workflow.title} · v{workflow.version}</strong>
        <ol>{task?.steps.map((step, index) => step.type === 'service' && <li key={index}>{step.plugin}/{step.service}@{step.version}
          <pre className={styles.path}>{JSON.stringify({ input: step.input, inputFromTask: step.inputFromTask ?? {} }, null, 2)}</pre>
        </li>)}</ol>
      </div>
    })}
  </details>
}

function PluginSkills({ manifest, review = false }: { manifest: InstalledPlugin['manifest']; review?: boolean }) {
  const { t } = useI18n('plugins')
  if (!manifest.contributes.skills?.length) return null
  return <details open={review || undefined} data-plugin-skills><summary>{t('plugins:skills')}</summary>
    <p className={styles.hint}>{t('plugins:skillHint')}</p>
    {manifest.contributes.skills.map(skill => <div className={styles.card} key={skill.id}>
      <strong>{skill.title} · v{skill.version}</strong>
      <p>{skill.description}</p><pre className={styles.path}>{skill.instructions}</pre>
      <span>{skill.services.map(service => `${service.service}@${service.version}`).join(', ')}</span>
    </div>)}
  </details>
}

export function PluginSettingsPanel({ configurationTarget, authorizationTarget, onOpened }: { configurationTarget?: PluginConfigurationTarget | null; authorizationTarget?: PluginAuthorizationTarget | null; onOpened?: () => void }) {
  const { t } = useI18n('plugins')
  const snapshot = usePluginSnapshot()
  const [tab, setTab] = useState<'installed' | 'discover' | 'developer'>('installed')
  useEffect(() => { if (configurationTarget) setTab('installed') }, [configurationTarget])
  const configurationSection = useRef<HTMLDetailsElement>(null)
  const locatedConfiguration = useRef<PluginConfigurationTarget | null>(null)
  useEffect(() => {
    const section = configurationSection.current
    if (!configurationTarget || !section || locatedConfiguration.current === configurationTarget) return
    locatedConfiguration.current = configurationTarget
    section.open = true
    section.scrollIntoView({ block: 'nearest' })
    section.querySelector('summary')?.focus({ preventScroll: true })
  }, [configurationTarget, snapshot.plugins, tab])
  const commands = useExtensionCommands()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const projectOpen = Boolean(activeWorkspaceId)

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [imported, setImported] = useState(false)
  const [authorize, setAuthorize] = useState<InstalledPlugin | null>(null)
  const locatedAuthorization = useRef<PluginAuthorizationTarget | null>(null)
  useEffect(() => {
    if (!authorizationTarget || locatedAuthorization.current === authorizationTarget) return
    const record = snapshot.plugins.find(record => record.manifest.id === authorizationTarget.pluginId)
    if (!record || !workspaces.some(workspace => workspace.id === authorizationTarget.projectId)) return
    locatedAuthorization.current = authorizationTarget
    setTab('installed'); setAuthorize(record)
  }, [authorizationTarget, snapshot.plugins, workspaces])
  const [confirmation, setConfirmation] = useState<{ id: string; type: 'uninstall' | 'deleteData' | 'rollback' } | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})
  const actionSection = useRef<HTMLElement>(null)
  useEffect(() => {
    const section = actionSection.current
    if (!section) return
    section.scrollIntoView({ block: 'nearest' })
    section.focus({ preventScroll: true })
  }, [authorize, confirmation])
  const run = async (request: PluginManageRequest) => {
    setBusy(true); setFailure(''); setImported(false)
    try {
      const result = await pluginRequest<{ imported?: boolean }>(request)
      if (request.type === 'deleteData' || request.type === 'uninstall') pluginConfigurationDrafts.clearPlugin(request.id)
      await refreshPlugins(); setAuthorize(null); setConfirmation(null)
      if (request.type === 'enable' && request.id === authorizationTarget?.pluginId) onOpened?.()
      if (request.type === 'import' || request.type === 'importPackage') setTab('installed')
      if (request.type === 'importPackage') setImported(Boolean(result?.imported))
    }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : 'INTERNAL_ERROR'
      setFailure(request.type !== 'importPackage' ? code : t(
        code === 'INVALID_SIGNATURE' || code === 'PERMISSION_DENIED' ? 'plugins:importUntrusted'
          : code === 'INVALID_PACKAGE' ? 'plugins:importInvalid'
          : code === 'INCOMPATIBLE_PLUGIN' ? 'plugins:incompatible'
          : code === 'INVALID_REQUEST' || code === 'DUPLICATE_PLUGIN' ? 'plugins:importBlocked'
          : code === 'PACKAGE_READ_FAILED' ? 'plugins:importReadFailed' : 'plugins:importFailed',
      ))
    }
    finally { setBusy(false) }
  }
  useEffect(() => { void refreshPlugins().catch(cause => setFailure(cause.message)) }, [])
  const preference = (update: () => void) => { try { update(); setFailure('') } catch (cause) { setFailure(cause instanceof Error ? cause.message : 'STORAGE_UNAVAILABLE') } }
  const conflicts = extensionCommands.resolveKeybindings(/Mac/.test(navigator.platform), projectOpen).diagnostics
  const preferences = extensionCommands.getPreferences()
  return <div className={styles.root} data-plugin-settings>
    <div className={styles.tabs} role="tablist" aria-label={t('plugins:title')}>
      {(['installed', 'discover', 'developer'] as const).map((id, index, tabs) => <button key={id} role="tab" id={`plugin-tab-${id}`} aria-controls={`plugin-panel-${id}`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => { setTab(id); setAuthorize(null); setConfirmation(null) }}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null
          if (next) { event.preventDefault(); setTab(next); document.getElementById(`plugin-tab-${next}`)?.focus() }
        }}>{t(`plugins:${id}`)}{id === 'installed' ? ` (${snapshot.plugins.length})` : ''}</button>)}
    </div>
    {failure && <p role="alert" className={styles.error}>{failure}</p>}
    {tab === 'discover' && <div role="tabpanel" id="plugin-panel-discover" aria-labelledby="plugin-tab-discover"><PluginCatalog onUninstall={id => { setTab('installed'); setAuthorize(null); setConfirmation({ type: 'uninstall', id }) }} /></div>}
    {tab === 'developer' && <div className={styles.root} role="tabpanel" id="plugin-panel-developer" aria-labelledby="plugin-tab-developer">
    <label className={styles.settingRow}>
      <span className={styles.settingText}><span className={styles.label}>{t('plugins:development')}</span>
        <span className={styles.hint}>{t('plugins:developmentHint')}</span></span>
      <input type="checkbox" className={styles.switch} aria-label={t('plugins:development')} checked={snapshot.developmentMode} disabled={busy}
        onChange={event => { void run({ type: 'development', enabled: event.target.checked }) }} />
    </label>
    <p className={styles.hint}>{t('plugins:hostBoundary')}</p>
    <div className={styles.actions}>
      <button disabled={busy} onClick={() => { void run({ type: 'import', kind: 'linked' }) }}>{t('plugins:link')}</button>
      <button disabled={busy} onClick={() => { void run({ type: 'import', kind: 'copied' }) }}>{t('plugins:copy')}</button>
      <button disabled={busy} aria-pressed={logsOpen} onClick={() => { setLogsOpen(value => !value); void refreshPlugins() }}>{t('plugins:logs')}</button>
    </div>
    {logsOpen && <section className={styles.card}><div className={styles.toolbar}><span className={styles.label}>{t('plugins:logs')}</span><button onClick={() => { void refreshPlugins() }}>{t('plugins:refresh')}</button></div>
      <pre className={styles.logs}>{snapshot.logs.map(log => `${log.time} ${log.pluginId ?? ''} ${log.instanceId ?? ''} ${log.method ?? ''} ${log.code} ${log.duration === undefined ? '' : `${log.duration}ms`}`).join('\n')}</pre></section>}
    </div>}
    {tab === 'installed' && <div className={styles.root} role="tabpanel" id="plugin-panel-installed" aria-labelledby="plugin-tab-installed">
    <div className={styles.toolbar}>
      <p className={styles.hint}>{t('plugins:importPackageHint')}</p>
      <button disabled={busy || Boolean(snapshot.distribution?.operation)} onClick={() => { void run({ type: 'importPackage' }) }}>{t('plugins:importPackage')}</button>
    </div>
    {imported && <p role="status">{t('plugins:importSucceeded')}</p>}
    {!snapshot.plugins.length && <p className={styles.hint}>{t('plugins:empty')}</p>}
    <div className={styles.list}>
    {snapshot.plugins.map(record => {
      const ownCommands = commands.commands.filter(command => command.id.startsWith(`command:${record.manifest.id}/`))
      const source = record.source.kind === 'official' ? t('plugins:official') : record.source.kind === 'linked' ? t('plugins:linked') : t('plugins:copied')
      return <section key={record.manifest.id} className={styles.card} data-plugin-id={record.manifest.id}>
        <div className={styles.cardHeader}>
          <span className={styles.avatar} aria-hidden="true">{record.manifest.name.trim().charAt(0).toUpperCase() || '?'}</span>
          <div className={styles.cardTitle}>
            <strong>{record.manifest.name}</strong>
            <span className={styles.meta}>v{record.manifest.version} · {source} · <code>{record.manifest.id}</code></span>
          </div>
          <span className={styles.chip} data-state={record.state}>{t(`plugins:state.${record.state}`)}</span>
        </div>
        {record.error && <p role="status" className={styles.error}>{record.error}</p>}
        <div className={styles.actions}>
          {!record.enabled && <button className={styles.primary} disabled={busy || record.source.kind !== 'official' && !snapshot.developmentMode} onClick={() => { setAuthorize(record) }}>{t('plugins:authorize')}</button>}
          {record.manifest.contributes.views.filter(view => view.location === 'settings').map(view => <button key={view.id} disabled={busy || !record.enabled}
            onClick={() => openExtensionView(`extension:${record.manifest.id}/${view.id}`)}>{view.title}</button>)}
          {record.enabled && <button disabled={busy || record.source.kind !== 'official' && !snapshot.developmentMode} onClick={() => { setAuthorize(record) }}>{t('plugins:authorize')}</button>}
          {record.enabled && <button disabled={busy} onClick={() => { void run({ type: 'disable', id: record.manifest.id }) }}>{t('plugins:disable')}</button>}
          {record.previousVersion && <button disabled={busy || record.enabled} onClick={() => setConfirmation({ type: 'rollback', id: record.manifest.id })}>{t('plugins:rollback')} · {record.previousVersion}</button>}
          <button className={styles.danger} disabled={busy} onClick={() => setConfirmation({ type: 'uninstall', id: record.manifest.id })}>{t('plugins:uninstall')}</button>
        </div>
        <div className={styles.sections}>
        <details><summary>{t('plugins:permissions')}</summary><pre className={styles.path}>{JSON.stringify(record.manifest.permissions, null, 2)}</pre></details>
        <PluginSkills manifest={record.manifest} />
        <PluginContexts manifest={record.manifest} />
        <PluginWorkflows manifest={record.manifest} />
        <PluginWindows manifest={record.manifest} enabled={record.enabled && (record.source.kind === 'official' || snapshot.developmentMode)} />
        <PluginThemes manifest={record.manifest} />
        <PluginBackgroundPanel record={record} runs={snapshot.tasks ?? []} />
        {Boolean(record.manifest.contributes.settings?.length) && <details ref={configurationTarget?.pluginId === record.manifest.id ? configurationSection : undefined}><summary>{t('plugins:configuration')}</summary>
          <PluginConfigurationForm key={configurationTarget?.pluginId === record.manifest.id ? `${configurationTarget.scope}:${configurationTarget.proposal?.expectedRevision ?? ''}` : 'application'} record={record}
            initialScope={configurationTarget?.pluginId === record.manifest.id ? configurationTarget.scope : undefined}
            proposal={configurationTarget?.pluginId === record.manifest.id ? configurationTarget.proposal : undefined} onOpened={onOpened} />
        </details>}
        {ownCommands.length > 0 && <details><summary>{t('plugins:entries')}</summary>
          {ownCommands.map(command => <div key={command.id} className={styles.commandPreference}>
            <strong>{command.title}</strong>
            <div className={styles.preference}>
              <label className={styles.shortcutField}>{t('plugins:shortcut')}
                <input aria-label={t('plugins:shortcut') + ' ' + command.title} placeholder={t('plugins:shortcutUnset')} value={shortcuts[command.id] ?? preferences.keybindings[command.id] ?? (Object.hasOwn(preferences.keybindings, command.id) ? '' : commands.bindings.find(binding => binding.commandId === command.id)?.key ?? '')}
                  onChange={event => setShortcuts(values => ({ ...values, [command.id]: event.target.value }))} />
              </label>
              <button onClick={() => preference(() => { if (shortcuts[command.id] !== undefined) extensionCommands.setKeybinding(command.id, shortcuts[command.id] || null) })}>{t('plugins:applyShortcut')}</button>
              <button onClick={() => preference(() => { extensionCommands.setKeybinding(command.id, undefined); setShortcuts(values => { const next = { ...values }; delete next[command.id]; return next }) })}>{t('plugins:resetShortcut')}</button>
            </div>
            {(record.manifest.contributes.menus ?? []).filter(menu => command.id === 'command:' + record.manifest.id + '/' + menu.command).map(menu => {
              const id = 'menu:' + record.manifest.id + '/' + menu.location + '/' + menu.command
              const location = menu.location === 'toolbox' ? t('plugins:showInToolbox') : t('plugins:showInWorkspaceAdd')
              return <label key={id} className={styles.entryPreference}>
                <span>{location}</span>
                <input type="checkbox" role="switch" className={styles.switch} aria-label={command.title + ' - ' + location} checked={!preferences.menus[id]?.hidden}
                  onChange={event => preference(() => extensionCommands.setMenuPreference(id, { hidden: !event.target.checked }))} />
              </label>
            })}
          </div>)}
        </details>}
        <details><summary>{t('plugins:advanced')}</summary>
          <div className={styles.path}>{record.source.directory}</div>
          <p className={styles.hint} data-plugin-runtime>{t('plugins:runtime', { pages: record.runtime?.pages ?? 0, connected: record.runtime?.connected ?? 0, ready: record.runtime?.ready ?? 0 })}</p>
          <div className={styles.actions}>
            <button disabled={busy} onClick={() => { void run({ type: 'reload', id: record.manifest.id }) }}>{t('plugins:reload')}</button>
            <button className={styles.danger} disabled={busy} onClick={() => setConfirmation({ type: 'deleteData', id: record.manifest.id })}>{t('plugins:deleteData')}</button>
          </div>
        </details>
        </div>
      </section>
    })}
    </div>
    {authorize && <section ref={actionSection} tabIndex={-1} className={`${styles.card} ${styles.review}`} role="region" aria-label={t('plugins:authorize')}>
      <span className={styles.label}>{authorize.manifest.name} — {t('plugins:permissions')}</span>
      <pre className={styles.path}>{JSON.stringify(authorize.manifest.permissions, null, 2)}</pre>
      {authorize.manifest.native && <p role="note">{t('plugins:nativePermissionHint')}</p>}
      <PluginSkills manifest={authorize.manifest} review />
      <PluginContexts manifest={authorize.manifest} review />
      <PluginWorkflows manifest={authorize.manifest} review />
      <PluginWindows manifest={authorize.manifest} review />
      <PluginThemes manifest={authorize.manifest} />
      {authorize.manifest.permissions.some(permission => permission.name === 'models.generate') && <p className={styles.hint}>{t('plugins:modelHint')}</p>}
      {authorize.manifest.permissions.some(permission => permission.name === 'ui.workspace') && <p className={styles.hint}>{t('plugins:workspaceHandoffHint')}</p>}
      <p className={styles.hint}>{t('plugins:grantHint')}</p>
      <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => { void run({ type: 'enable', id: authorize.manifest.id }) }}>{t('plugins:confirmEnable')}</button>
        <button onClick={() => setAuthorize(null)}>{t('plugins:cancel')}</button></div>
    </section>}
    {confirmation && <section ref={actionSection} tabIndex={-1} className={`${styles.card} ${styles.review}`} role="alertdialog" aria-label={t(`plugins:${confirmation.type}`)}>
      <span className={styles.label}>{snapshot.plugins.find(record => record.manifest.id === confirmation.id)?.manifest.name ?? confirmation.id}</span>
      <p className={styles.description}>{confirmation.type === 'uninstall' ? t('plugins:uninstallHint') : confirmation.type === 'rollback' ? t('plugins:rollbackHint') : t('plugins:deleteHint')}</p>
      <div className={styles.actions}><button className={styles.primary} disabled={busy} onClick={() => { void run({ ...confirmation }) }}>{t('plugins:confirm')}</button>
        <button onClick={() => setConfirmation(null)}>{t('plugins:cancel')}</button></div>
    </section>}
    {conflicts.map(conflict => <p key={conflict.key} role="status" className={styles.error}>KEYBINDING_CONFLICT · {conflict.key} · {conflict.commandIds.join(', ')}</p>)}
    </div>}
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
