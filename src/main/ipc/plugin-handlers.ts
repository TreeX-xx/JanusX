import { app, dialog, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { join, basename } from 'node:path'
import { NativeDesktop } from '../plugins/native-desktop'
import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import { PluginError, messageSchema } from '@janusx/plugin-sdk'
import { PLUGIN_CHANNELS, type PluginManageRequest, type PluginHostResult } from '../../shared/ipc/plugins'
import type { ResolveWorkspaceRoot } from '../office/office-workspace-guard'
import { listRegisteredWorkspaces } from '../companion/workspace-registry'
import { PluginService } from '../plugins/service'
import { PluginRuntime } from '../plugins/runtime'
import { hostPluginModelBackend } from '../plugins/model-backend'
import { listWorktrees } from '../git/worktrees'
import { promises as originalFiles } from 'original-fs'
import { configurePluginFileSystem } from '../plugins/files'
import { PluginWindowLayout } from '../plugins/window-layout'
import { PluginDistributionService } from '../plugins/distribution/service'
import { downloadHostAsset } from '../lib/download'
import officialTrust from '../../../plugins/catalog/trust.json'
import { createOfficialNativeService } from '../plugins/native-process'
import { appShutdown } from '../shutdown/AppShutdown'
import { installLocalDevelopmentPlugin, type LocalPluginBuild } from '../plugins/local-development'
import { readPluginImport } from '../plugins/distribution/import'

declare const __JANUSX_LOCAL_PLUGIN__: LocalPluginBuild | null

const text = z.string().min(1).max(256)
const nullableText = z.string().max(4096).nullable()
const instance = { instanceId: text, binding: text }
const inputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('windowOpen'), id: text, view: text, projectId: text.nullable(), scopePath: nullableText }).strict(),
  z.object({ type: z.literal('windowCover'), covered: z.boolean() }).strict(),
  z.object({ type: z.literal('taskStart'), id: text, task: text, projectId: text.nullable(), scopePath: nullableText, input: messageSchema }).strict(),
  z.object({ type: z.literal('taskCancel'), runId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('credentialStatus'), id: text, slot: text, projectId: text.nullable(), scopePath: nullableText }).strict(),
  z.object({ type: z.literal('credentialSet'), id: text, slot: text, projectId: text.nullable(), scopePath: nullableText, value: z.string().min(1).max(4096).nullable() }).strict(),
  z.object({ type: z.literal('list') }).strict(),
  z.object({ type: z.literal('catalogRefresh') }).strict(),
  z.object({ type: z.literal('installCancel') }).strict(),
  z.object({ type: z.literal('installOfficial'), id: text }).strict(),
  z.object({ type: z.literal('importPackage') }).strict(),
  z.object({ type: z.literal('development'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('import'), kind: z.enum(['linked', 'copied']) }).strict(),
  z.object({ type: z.literal('enable'), id: text, projects: z.array(text).max(256).optional() }).strict(),
  ...(['disable', 'reload', 'uninstall', 'deleteData', 'rollback'] as const).map(type => z.object({ type: z.literal(type), id: text }).strict()),
  z.object({ type: z.literal('context'), projectId: text.nullable(), scopePath: nullableText, locale: z.string().max(32),
    theme: z.object({ id: z.string().max(256), tokens: z.record(z.string().max(512)).refine(tokens => Object.keys(tokens).length <= 512) }).strict() }).strict(),
  z.object({ type: z.literal('mount'), id: text, view: text, projectId: text.nullable(), scopePath: nullableText,
    instanceKey: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    document: z.object({ viewer: text, path: z.string().min(1).max(4096) }).strict().optional() }).strict(),
  ...(['close', 'devtools'] as const).map(type => z.object({ type: z.literal(type), ...instance }).strict()),
  z.object({ type: z.literal('bounds'), ...instance, bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict() }).strict(),
  z.object({ type: z.literal('active'), ...instance, active: z.boolean() }).strict(),
  z.object({ type: z.literal('call'), ...instance, packet: z.unknown() }).strict(),
  z.object({ type: z.literal('documentEditResult'), ...instance, editId: text, applied: z.boolean() }).strict(),
  z.object({ type: z.literal('documentDraftResult'), ...instance, editId: text, draft: z.object({
    text: z.string().max(1024 * 1024).refine(value => Buffer.byteLength(value) <= 1024 * 1024 && !value.includes('\0')),
    revision: z.number().int().nonnegative(), version: z.string().regex(/^[a-f0-9]{64}$/), dirty: z.boolean(), externalChanged: z.boolean(),
  }).strict().nullable() }).strict(),
  z.object({ type: z.literal('configurationGet'), id: text, projectId: text.nullable(), scopePath: nullableText }).strict(),
  z.object({ type: z.literal('configurationUpdate'), id: text, projectId: text.nullable(), scopePath: nullableText,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), reset: z.boolean(), migrate: z.boolean().optional(),
    patch: z.record(z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])).refine(value => Object.keys(value).length <= 64) }).strict(),
  z.object({ type: z.literal('islandAction'), pluginId: text, id: text, instanceId: text, command: text }).strict(),
])

export function registerPluginHandlers(getWindow: () => BrowserWindow | null, resolveRoot: ResolveWorkspaceRoot): PluginService {
  configurePluginFileSystem(originalFiles)
  const send = (channel: string, payload?: unknown) => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(channel, payload) }
  const resolvePluginProject = async (id: string, scopePath: string | null) => {
    const registered = await resolveRoot(id)
    if (!registered) throw new PluginError('CONTEXT_UNAVAILABLE', 'Project is not registered.')
    let root = await realpath(registered)
    if (scopePath) {
      const requested = await realpath(scopePath)
      if (requested !== root) {
        const known = await Promise.all((await listWorktrees(id, root)).map(item => realpath(item.path).catch(() => '')))
        if (!known.includes(requested)) throw new PluginError('CONTEXT_UNAVAILABLE', 'Worktree is not registered.')
        root = requested
      }
    }
    return { root, name: basename(root) }
  }
  const service = new PluginService({
    modelBackend: hostPluginModelBackend,
    directory: join(app.getPath('userData'), 'janusx', 'plugins'),
    official: { keys: officialTrust.keys, nativePlugins: officialTrust.nativePlugins, hostVersion: app.getVersion(), platform: `${process.platform}-${process.arch}` },
    createNativeService: (record, directory, stopped, credentials) => {
      const desktop = new NativeDesktop(record, () => runtime, () => native)
      const native = createOfficialNativeService(record, directory, code => { desktop.dispose(); stopped(code) }, resolvePluginProject, credentials, desktop.call)
      return native
    },
    encryption: {
      encrypt: value => {
        if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Encryption unavailable')
        return safeStorage.encryptString(value)
      },
      decrypt: value => {
        if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Encryption unavailable')
        return safeStorage.decryptString(value)
      },
    },
    protectedDirectories: [app.getPath('userData'), app.getPath('sessionData')],
    legacyCredentials: { 'official.blueprint': [{ slot: 'jev', origin: 'https://api.typesafe.ai', path: join(app.getPath('userData'), 'janusx', 'knowledge-jev.credential') }] },
    resolveProject: resolvePluginProject,
    listProjects: async () => (await listRegisteredWorkspaces(join(app.getPath('userData'), 'janusx', 'workspaces'))).map(project => project.id),
    worktrees: async id => {
      const project = await resolvePluginProject(id, null)
      const entries = await listWorktrees(id, project.root)
      const roots = (await Promise.all(entries.filter(entry => !entry.prunable).slice(0, 128).map(async entry => ({
        root: await realpath(entry.path), name: basename(entry.path), branch: entry.branch, isMain: entry.isMain,
      })).map(result => result.catch(() => null)))).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      return roots.length ? roots : [{ root: project.root, name: project.name, branch: null, isMain: true }]
    },
    changed: () => send(PLUGIN_CHANNELS.changed),
    event: (instanceId, packet) => { runtime?.send(instanceId, packet); send(PLUGIN_CHANNELS.event, { instanceId, packet }) },
    workspaceHandoff: packet => send(PLUGIN_CHANNELS.event, { instanceId: '', packet }),
    workbenchAction: packet => send(PLUGIN_CHANNELS.event, { instanceId: '', packet }),
    closed: instanceId => runtime?.close(instanceId),
    openView: (pluginId, viewId, instanceKey) => send(PLUGIN_CHANNELS.event, { instanceId: '', packet: { type: 'openView', pluginId, viewId, ...(instanceKey ? { instanceKey } : {}) } }),
    toast: (pluginId, message, level) => send(PLUGIN_CHANNELS.event, { instanceId: '', packet: { type: 'toast', pluginId, message, level } }),
  })
  const runtime = new PluginRuntime(service, getWindow, new PluginWindowLayout(join(app.getPath('userData'), 'janusx', 'plugins', 'window-layout.json'), () => service.log('STORAGE_UNAVAILABLE')))
  const host = getWindow()!
  host.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) service.closeAll() })
  host.webContents.on('render-process-gone', () => service.closeAll())
  host.on('closed', () => service.closeAll())
  const distribution = new PluginDistributionService({
    directory: join(app.getPath('userData'), 'janusx', 'plugins'), catalogUrl: officialTrust.catalogUrl, keys: officialTrust.keys,
    hostVersion: app.getVersion(), platform: `${process.platform}-${process.arch}`,
    download: downloadHostAsset, install: (bytes, release) => service.installOfficial(bytes, release), changed: () => send(PLUGIN_CHANNELS.changed),
  })
  const ready = Promise.all([service.initialize(), distribution.initialize()]).then(async () => {
    if (typeof __JANUSX_LOCAL_PLUGIN__ !== 'undefined' && __JANUSX_LOCAL_PLUGIN__) {
      await installLocalDevelopmentPlugin(service, __JANUSX_LOCAL_PLUGIN__, { packaged: app.isPackaged, profile: app.getPath('userData') })
    }
  })
  appShutdown.configure({ stopPlugins: async () => { distribution.dispose(); await service.dispose(); runtime.dispose() } })
  // Observe rejection immediately; management requests still report the original error.
  void ready.catch(() => service.log('STORAGE_UNAVAILABLE'))
  app.on('will-quit', () => { distribution.dispose(); service.dispose(); runtime.dispose() })
  ipcMain.handle(PLUGIN_CHANNELS.manage, async (event, input: unknown): Promise<PluginHostResult> => {
    try {
      const window = getWindow()
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new PluginError('INVALID_SENDER', 'Plugin management requires the main window.')
      }
      await ready
      const checked = inputSchema.safeParse(input)
      if (!checked.success) throw new PluginError('INVALID_REQUEST', 'Invalid plugin management request.')
      const request = checked.data as PluginManageRequest
      let data: unknown = null
      switch (request.type) {
        case 'windowOpen': await runtime.openWindow(request.id, request.view, request.projectId, request.scopePath); break
        case 'windowCover': runtime.setCovered(request.covered); break
        case 'taskStart': case 'taskCancel': case 'credentialStatus': case 'credentialSet': data = await service.backgroundManage(request); break
        case 'list': data = { ...service.snapshot(), distribution: distribution.snapshot() }; break
        case 'catalogRefresh': await distribution.refresh(); break
        case 'installCancel': distribution.cancel(); break
        case 'installOfficial': await distribution.install(request.id); break
        case 'importPackage': {
          const selection = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'JanusX plugin', extensions: ['jxp'] }] })
          if (selection.canceled || !selection.filePaths[0]) { data = { imported: false }; break }
          await service.installPackage(await readPluginImport(selection.filePaths[0]))
          data = { imported: true }
          break
        }
        case 'development': await service.setDevelopment(request.enabled); break
        case 'import': {
          const selection = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
          if (!selection.canceled && selection.filePaths[0]) await service.import(selection.filePaths[0], request.kind)
          break
        }
        case 'enable': await service.enable(request.id, request.projects); break
        case 'disable': await service.disable(request.id); break
        case 'reload': await service.reload(request.id, true); break
        case 'rollback': await service.rollback(request.id); break
        case 'uninstall': await service.uninstall(request.id); break
        case 'deleteData': await service.deleteData(request.id); break
        case 'context': await service.setContext(request.projectId, request.scopePath, request.locale, request.theme); break
        case 'mount': {
          const mount = await service.mount(request.id, request.view, request.projectId, request.scopePath, request.document, request.instanceKey)
          try { await runtime.create(request.id, mount); data = mount }
          catch (cause) { service.close(mount.instanceId); throw cause }
          break
        }
        case 'devtools': {
          const snapshot = service.snapshot()
          if (!snapshot.developmentMode) throw new PluginError('DEVELOPMENT_MODE_REQUIRED', 'Local development mode is off.')
          runtime.inspect(request.instanceId, request.binding); break
        }
        case 'bounds': runtime.setBounds(request.instanceId, request.binding, request.bounds); break
        case 'close': service.close(request.instanceId, request.binding); break
        case 'active': service.active(request.instanceId, request.binding, request.active); break
        case 'call': data = await service.call(request.instanceId, request.binding, request.packet); break
        case 'documentEditResult': service.documentEditResult(request.instanceId, request.binding, request.editId, request.applied); break
        case 'documentDraftResult': service.documentDraftResult(request.instanceId, request.binding, request.editId, request.draft); break
        case 'configurationGet': data = await service.getConfiguration(request.id, request.projectId, request.scopePath); break
        case 'configurationUpdate': data = await service.updateConfiguration(request); break
        case 'islandAction': service.islandAction(request.pluginId, request.id, request.instanceId, request.command); break
      }
      return { ok: true, data }
    } catch (cause) {
      const distributionRequest = typeof input === 'object' && input !== null && 'type' in input
        && ['catalogRefresh', 'installOfficial', 'importPackage', 'installCancel', 'rollback'].includes(String(input.type))
      const code = cause instanceof PluginError ? cause.code : distributionRequest && cause instanceof Error && /^[A-Z_]+$/.test(cause.message) ? cause.message : 'INTERNAL_ERROR'
      service.log(code)
      return { ok: false, code, message: code }
    }
  })
  return service
}
