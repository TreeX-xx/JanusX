// Note: .agents/notes/planning/blueprint-official-plugin.md - the package supplies the settings UI through the isolated carrier.
import { PluginViewShell } from '@/extensions/plugin-runtime'
import type { PluginSettingsPage } from '@/extensions/plugin-settings'
import { useI18n } from '@/i18n/useI18n'

export function PluginSettingsView({ page, active, onManage }: { page: PluginSettingsPage; active: boolean; onManage: () => void }) {
  const { t } = useI18n('plugins')
  return <section className="h-full min-h-0 w-full" data-plugin-settings-page={page.id}>
    {page.enabled ? <PluginViewShell key={`${page.id}:${page.digest}`} pluginId={page.pluginId} localViewId={page.viewId}
      viewId={page.id} location="settings" workspaceId={null} workspacePath={null} active={active} />
      : <div className="p-4"><p role="status">{t('plugins:settingsEnableRequired')}</p>
        <button type="button" onClick={onManage}>{t('plugins:managePlugin')}</button></div>}
  </section>
}
