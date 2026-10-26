// Note: .agents/notes/planning/blueprint-official-plugin.md — drafts survive scope and settings navigation.
import type { PluginSettingValue } from '@janusx/plugin-sdk'
import type { PluginConfigurationState } from '../../../shared/ipc/plugins'

export interface PluginConfigurationDraft {
  configuration: PluginConfigurationState
  patch: Record<string, PluginSettingValue | null>
  reviewing: boolean
}
export interface PluginConfigurationDraftTarget { id: string; digest: string; projectId: string | null; scopePath: string | null }
const key = (target: PluginConfigurationDraftTarget) => JSON.stringify([target.id, target.digest, target.projectId, target.projectId ? target.scopePath : null])
/** Memory only: ordinary parameters are not copied to persistent browser storage. */
export class PluginConfigurationDrafts {
  private drafts = new Map<string, PluginConfigurationDraft>()
  read(target: PluginConfigurationDraftTarget): PluginConfigurationDraft | undefined {
    const draft = this.drafts.get(key(target))
    return draft ? structuredClone(draft) : undefined
  }
  write(target: PluginConfigurationDraftTarget, draft: PluginConfigurationDraft): void {
    if (Object.keys(draft.patch).length) this.drafts.set(key(target), structuredClone(draft))
    else this.clear(target)
  }
  clear(target: PluginConfigurationDraftTarget): void { this.drafts.delete(key(target)) }
  clearPlugin(id: string): void {
    for (const identity of this.drafts.keys()) if (JSON.parse(identity)[0] === id) this.drafts.delete(identity)
  }
}
export const pluginConfigurationDrafts = new PluginConfigurationDrafts()
