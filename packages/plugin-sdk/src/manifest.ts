import { z } from 'zod'
import semver from 'semver'
import { parseTree, type Node as JsonNode, type ParseError } from 'jsonc-parser'
import { PluginError } from './errors.js'
import { isSensitivePluginPath, validatePluginPath } from './paths.js'
import { isReservedPluginKeybinding, normalizePluginKeybinding } from './keybindings.js'
import { pluginViewerSchema } from './documents.js'
import { pluginSettingSchema, pluginSettingMigrationSchema, isPluginSettingValue } from './configuration.js'

export const PLUGIN_API_VERSION = '1.0.0'
/** Implemented host features; old hosts reject unknown required capabilities. */
export const PLUGIN_CAPABILITIES = [
  'views.workspace', 'views.right', 'commands.openView', 'menus.toolbox', 'menus.workspace-add',
  'keybindings.local', 'context.project', 'files.readText', 'storage.kv', 'storage.watch', 'ui.toast',
  'views.workbench', 'views.island', 'island.status',
  'documents.viewers', 'documents.readText', 'documents.applyEdit',
  'configuration.settings', 'configuration.open', 'configuration.migrations', 'configuration.customViews',
] as const
export const PLUGIN_PERMISSION_NAMES = ['workspace.context.read', 'workspace.files.read', 'plugin.storage', 'ui.views.open', 'ui.toast', 'ui.island', 'documents.read', 'documents.edit', 'configuration.read', 'configuration.propose'] as const
const identifier = (min: number, max: number) => z.string().min(min).max(max).regex(/^[a-z][a-z0-9.-]*$/).refine((value) => !value.endsWith('.') && !value.includes('..'))
const id = identifier(1, 64)
const title = z.string().min(1).max(80).refine((value) => value.trim().length > 0)
const order = z.number().int().min(-1000).max(1000).optional()
const condition = z.enum(['always', 'projectOpen']).optional()
const uniqueStrings = z.array(z.string().min(1).max(128)).max(64).refine((items) => new Set(items).size === items.length)
const path = z.string().superRefine((value, ctx) => {
  try { validatePluginPath(value) } catch { ctx.addIssue({ code: 'custom', message: 'Invalid relative path' }) }
})
export const pluginViewSchema = z.object({
  id, title, entry: path.refine((value) => value.endsWith('.html')),
  location: z.enum(['workspace', 'right', 'workbench', 'island']), scope: z.enum(['application', 'project']),
  instancePolicy: z.literal('single'), icon: z.enum(['puzzle', 'book', 'list', 'chart', 'file', 'code', 'clock']).optional(), order,
}).strict()
export const pluginCommandSchema = z.object({ id, title, action: z.object({ type: z.literal('openView'), view: id }).strict() }).strict()
export const pluginIslandSchema = z.object({
  id, title, scope: z.enum(['application', 'project']), order,
  actions: z.array(id).max(3).refine(items => new Set(items).size === items.length).optional(),
}).strict()
export const pluginMenuSchema = z.object({ location: z.enum(['toolbox', 'workspace-add']), command: id, when: condition, order }).strict()
export const pluginKeybindingSchema = z.object({
  command: id, key: z.string().refine((value) => normalizePluginKeybinding(value) !== null && !isReservedPluginKeybinding(value)),
  mac: z.string().refine((value) => normalizePluginKeybinding(value) !== null && !isReservedPluginKeybinding(value)).optional(), when: condition,
}).strict()
const permission = z.union([
  z.object({ name: z.literal('workspace.files.read'), paths: z.array(path).min(1).max(64)
    .refine((items) => new Set(items.map((item) => item.toLowerCase())).size === items.length)
    .refine((items) => !items.some(isSensitivePluginPath)) }).strict(),
  z.object({ name: z.enum(['workspace.context.read', 'plugin.storage', 'ui.views.open', 'ui.toast', 'ui.island', 'documents.read', 'documents.edit', 'configuration.read', 'configuration.propose']) }).strict(),
])
export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1), id: identifier(3, 128).refine((value) => !value.startsWith('janusx.')),
  name: title, description: z.string().max(1000).optional(), version: z.string().refine((value) => semver.valid(value) !== null),
  engines: z.object({ pluginApi: z.string().max(128).refine((value) => Boolean(value.trim()) && semver.validRange(value) !== null) }).strict(),
  capabilities: z.object({ required: uniqueStrings, optional: uniqueStrings }).strict(),
  permissions: z.array(permission).max(10).refine((items) => new Set(items.map((item) => item.name)).size === items.length),
  contributes: z.object({ views: z.array(pluginViewSchema).min(1).max(16), commands: z.array(pluginCommandSchema).max(64).optional(),
    menus: z.array(pluginMenuSchema).max(128).optional(), keybindings: z.array(pluginKeybindingSchema).max(32).optional(),
    island: z.array(pluginIslandSchema).max(4).optional(), viewers: z.array(pluginViewerSchema).max(16).optional(),
    settings: z.array(pluginSettingSchema).min(1).max(64).optional(),
    settingMigrations: z.array(pluginSettingMigrationSchema).min(1).max(64).optional(),
    configurationViews: z.object({ application: id.optional(), project: id.optional() }).strict()
      .refine(value => Boolean(value.application || value.project)).optional() }).strict(),
}).strict().superRefine((manifest, ctx) => {
  const { views, commands = [], menus = [], keybindings = [] } = manifest.contributes
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  const settings = manifest.contributes.settings ?? []
  const configurationViews = manifest.contributes.configurationViews
  if (configurationViews) {
    if (!settings.length || !manifest.capabilities.required.includes('configuration.customViews')
      || !manifest.permissions.some(item => item.name === 'configuration.propose')) fail('Custom configuration views require settings, configuration.customViews and configuration.propose')
    for (const scope of ['application', 'project'] as const) if (configurationViews[scope]
      && !views.some(view => view.id === configurationViews[scope] && view.location === 'workbench' && view.scope === scope)) fail('Custom configuration view requires a workbench view of the same scope')
  }
  if (manifest.permissions.some(item => item.name === 'configuration.propose') && !configurationViews) fail('Configuration proposals require a declared editor view')
  const migrations = manifest.contributes.settingMigrations ?? []
  if (migrations.length && (!settings.length || !manifest.capabilities.required.includes('configuration.migrations'))) fail('Setting migrations require settings and configuration.migrations')
  if (new Set(migrations.map(item => item.from)).size !== migrations.length || new Set(migrations.map(item => item.to)).size !== migrations.length) fail('Ambiguous setting migrations')
  for (const migration of migrations) {
    if (settings.some(setting => setting.key === migration.from) || !settings.some(setting => setting.key === migration.to)) fail('Migration must rename a retired key to a current setting')
  }
  if (manifest.capabilities.required.includes('configuration.open') && !settings.length) fail('Configuration navigation requires settings')
  if (new Set(settings.map(setting => setting.key)).size !== settings.length) fail('Duplicate setting key')
  if (settings.length && (!manifest.capabilities.required.includes('configuration.settings')
    || !manifest.permissions.some(permission => permission.name === 'configuration.read'))) fail('Settings require configuration.settings and configuration.read')
  for (const setting of settings) {
    if (!isPluginSettingValue(setting, setting.default)) fail('Invalid setting default')
    if (setting.type === 'string' && (setting.minLength ?? 0) > (setting.maxLength ?? 4096)) fail('Invalid string bounds')
    if (setting.type === 'number' && (setting.minimum ?? -Infinity) > (setting.maximum ?? Infinity)) fail('Invalid number bounds')
  }
  if (new Set(views.map((view) => view.id)).size !== views.length || new Set(commands.map((command) => command.id)).size !== commands.length) fail('Duplicate contribution ID')
  if (commands.some((command) => !views.some((view) => view.id === command.action.view))) fail('Command references an unknown view')
  if ([...menus, ...keybindings].some((entry) => !commands.some((command) => command.id === entry.command))) fail('Entry references an unknown command')
  if (new Set(menus.map((menu) => `${menu.location}:${menu.command}`)).size !== menus.length) fail('Duplicate menu entry')
  if (manifest.capabilities.required.some((item) => manifest.capabilities.optional.includes(item))) fail('Required and optional capabilities overlap')
  const viewers = manifest.contributes.viewers ?? []
  if (new Set(viewers.map(viewer => viewer.id)).size !== viewers.length) fail('Duplicate viewer ID')
  if (viewers.length && (!manifest.permissions.some(item => item.name === 'documents.read')
    || !manifest.capabilities.required.includes('documents.viewers') || !manifest.capabilities.required.includes('documents.readText'))) fail('Viewers require documents.read and required document capabilities')
  for (const viewer of viewers) if (!views.some(view => view.id === viewer.view && view.scope === 'project' && view.location === 'workspace')) fail('Viewer requires a project workspace view')
  if (manifest.permissions.some(item => item.name === 'documents.edit') && (!viewers.length
    || !manifest.capabilities.required.includes('documents.applyEdit'))) fail('Document editing requires viewers and the required documents.applyEdit capability')
  const island = manifest.contributes.island ?? []
  if (new Set(island.map(item => item.id)).size !== island.length) fail('Duplicate Island ID')
  if (island.length && !manifest.permissions.some(item => item.name === 'ui.island')) fail('Island requires ui.island permission')
  for (const item of island) for (const action of item.actions ?? []) {
    const command = commands.find(command => command.id === action)
    const view = views.find(view => view.id === command?.action.view)
    if (!view || view.scope !== item.scope || !manifest.permissions.some(item => item.name === 'ui.views.open')) fail('Island action requires a declared command of the same scope and ui.views.open')
  }
})

export type PluginManifest = z.infer<typeof pluginManifestSchema>
export type PluginView = z.infer<typeof pluginViewSchema>
export type PluginCommand = z.infer<typeof pluginCommandSchema>
export type PluginMenu = z.infer<typeof pluginMenuSchema>
export type PluginKeybinding = z.infer<typeof pluginKeybindingSchema>
export type PluginPermission = PluginManifest['permissions'][number]

export function parsePluginManifest(source: string, host: { apiVersion: string; capabilities: readonly string[] } = {
  apiVersion: PLUGIN_API_VERSION, capabilities: PLUGIN_CAPABILITIES,
}): PluginManifest {
  if (new TextEncoder().encode(source).byteLength > 64 * 1024) throw new PluginError('PACKAGE_LIMIT_EXCEEDED', 'Manifest exceeds 64 KiB.')
  const errors: ParseError[] = []
  let tree: JsonNode | undefined
  try { tree = parseTree(source, errors, { disallowComments: true, allowTrailingComma: false }) } catch {
    throw new PluginError('MANIFEST_INVALID', 'Manifest is too deeply nested.')
  }
  function inspect(node: JsonNode, depth = 0): void {
    if (depth > 64) throw new PluginError('MANIFEST_INVALID', 'Manifest is too deeply nested.')
    if (node.type === 'object') {
      const keys = node.children?.map((property) => property.children?.[0].value) ?? []
      if (new Set(keys).size !== keys.length) throw new PluginError('MANIFEST_INVALID', 'Duplicate JSON key.')
    }
    for (const child of node.children ?? []) inspect(child, depth + 1)
  }
  if (!tree || errors.length) throw new PluginError('MANIFEST_INVALID', 'Manifest must be strict JSON.')
  try { inspect(tree) } catch (error) {
    if (error instanceof PluginError) throw error
    throw new PluginError('MANIFEST_INVALID', 'Manifest is too deeply nested.')
  }
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new PluginError('MANIFEST_INVALID', 'Manifest must be strict JSON.') }
  const raw = value as { permissions?: unknown; contributes?: { views?: unknown } }
  if (raw && Array.isArray(raw.permissions) && raw.permissions.some((item: unknown) => item && typeof item === 'object'
    && 'name' in item && !PLUGIN_PERMISSION_NAMES.includes(item.name as typeof PLUGIN_PERMISSION_NAMES[number]))) {
    throw new PluginError('UNSUPPORTED_PERMISSION', 'Manifest requests an unsupported permission.')
  }
  if (raw && typeof raw === 'object') {
    const paths: unknown[] = []
    if (Array.isArray(raw.contributes?.views)) for (const view of raw.contributes.views) {
      if (view && typeof view === 'object' && 'entry' in view) paths.push(view.entry)
    }
    if (Array.isArray(raw.permissions)) for (const permission of raw.permissions) {
      if (permission && typeof permission === 'object' && 'paths' in permission && Array.isArray(permission.paths)) paths.push(...permission.paths)
    }
    for (const path of paths) if (typeof path === 'string') validatePluginPath(path)
  }
  const result = pluginManifestSchema.safeParse(value)
  if (!result.success) throw new PluginError('MANIFEST_INVALID', result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  if (!semver.satisfies(host.apiVersion, result.data.engines.pluginApi)
    || result.data.capabilities.required.some((capability) => !host.capabilities.includes(capability))) {
    throw new PluginError('INCOMPATIBLE_API', 'Required plugin API or capability is unavailable.')
  }
  return result.data
}
