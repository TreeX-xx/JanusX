// A signed fixture uses the production installer, sandboxed view and native transport.
// Keys and provider responses exist only in this test executable.
import { app, BrowserWindow, utilityProcess } from 'electron'
import { promises as originalFiles } from 'original-fs'
import { join } from 'node:path'
import { PluginService } from '../../../src/main/plugins/service'
import { PluginRuntime } from '../../../src/main/plugins/runtime'
import { NativePluginService } from '../../../src/main/plugins/native-service'
import { configurePluginFileSystem } from '../../../src/main/plugins/files'
import { registerPluginScheme } from '../../../src/main/plugins/scheme'
import { NativeServiceError } from '@janusx/plugin-sdk'
import { createHash } from 'node:crypto'
import { PluginStorage } from '../../../src/main/plugins/storage'

registerPluginScheme()
const directory = process.env.BLUEPRINT_FIXTURE_ROOT!
app.setPath('userData', join(directory, 'profile'))
void app.whenReady().then(async () => {
  configurePluginFileSystem(originalFiles)
  const config = JSON.parse(await originalFiles.readFile(join(directory, 'fixture.json'), 'utf8'))
  const root = join(directory, 'project')
  const window = new BrowserWindow({ width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<title>Blueprint plugin fixture</title>')
  let runtime: PluginRuntime, mount: Awaited<ReturnType<PluginService['mount']>> | undefined
  const notifications: unknown[] = []
  const pluginHome = join(directory, 'profile/janusx/plugins')
  const nativeProcesses = new Set<ReturnType<typeof utilityProcess.fork>>()
  let nativeStarts = 0, modelCalls = 0
  let continueDiscussion: (() => void) | undefined
  const service = new PluginService({
    encryption: { encrypt: value => Buffer.from(`fixture:${value}`), decrypt: value => value.toString().slice(8) },
    directory: pluginHome, official: { keys: config.keys, nativePlugins: { 'official.blueprint': ['fixture'] }, hostVersion: '0.9.4', platform: `${process.platform}-${process.arch}` },
    resolveProject: async () => ({ root, name: 'Plugin fixture' }), changed() {},
    event: (id, packet) => { runtime?.send(id, packet); notifications.push(packet) }, closed: id => runtime?.close(id),
    openView(_plugin, view) { setTimeout(() => { void open(view).catch(console.error) }, 0) }, toast() {},
    workbenchAction: packet => { notifications.push(packet); if ((packet as any).action === 'close') setTimeout(() => { if (mount) service.close(mount.instanceId, mount.binding) }, 0) },
    workspaceHandoff: packet => { notifications.push(packet) },
    createNativeService(record, packageDirectory, stopped, credentials) {
      let native: NativePluginService
      native = new NativePluginService({ stopped,
        spawn(generation) {
          const child = utilityProcess.fork(join(packageDirectory, record.manifest.native!.entry), [`--janusx-native-generation=${generation}`], { stdio: 'pipe' })
          nativeStarts++; nativeProcesses.add(child)
          child.once('exit', () => nativeProcesses.delete(child))
          child.stdout?.resume(); child.stderr?.on('data', chunk => console.error(String(chunk)))
          return { send: packet => child.postMessage(packet), listen: listener => { child.on('message', listener); return () => { child.off('message', listener) } },
            exited: listener => { child.on('exit', listener); return () => { child.off('exit', listener) } }, terminate: () => { child.kill() } }
        },
        async host(method, input, signal) {
          if (method === 'models.generate' || method === 'agent.run') modelCalls++
          if (method === 'models.catalog') return [{ id: 'fixture', name: 'Fixture provider', models: [{ id: 'fixture', name: 'Fixture model' }] }]
          if (method === 'mcp.launch') return { launch: { command: process.execPath, args: [join(packageDirectory, 'dist/note-mcp.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } },
            directories: { home: join(directory, 'terminal-config') } }
          if (method === 'models.select') return { providerId: 'fixture', modelId: 'fixture', contextWindow: 262144, maxOutputTokens: 8192 }
          if (method === 'models.probe') return { ready: true }
          if (method === 'models.verify') return { model: (input as any).model, score: 1 }
          if (method === 'models.credential-status' || method === 'models.credential-set') {
            if (method === 'models.credential-set') await credentials.set!('jev', 'https://api.typesafe.ai', (input as any).value)
            return { configured: await credentials.status('jev', 'https://api.typesafe.ai') }
          }
          if (method === 'models.generate' && (input as any).system?.includes('You are JanusX dispatch.')) return { text: JSON.stringify({
            goal: 'Implement the persistent queue', steps: ['Read the Note', 'Implement persistence'], acceptance: ['Queue survives restart'], constraints: ['Keep Note content unchanged'], noteRefs: [] }) }
          if (method === 'models.generate') return { text: JSON.stringify({ summary: 'Clarify planned queue', operations: [{ operationId: 'queue', type: 'update-node', nodeId: config.noteId,
            reason: 'Clarify planned queue', evidenceRefs: [], dependsOn: [], risk: 'low', after: { sections: { Design: 'A persistent queue is planned.' } } }] }) }
          if (method !== 'agent.run') throw new NativeServiceError('UNKNOWN_METHOD')
          const request = input as any
          const review = request.tools.some((tool: any) => tool.name === 'review.read')
          await native.call('agent.tool', { runId: request.runId, tool: review ? 'review.read' : 'project.read', input: { path: '.agents/notes/module.md' } }, signal)
          if (!review && request.progress) {
            await native.call('agent.progress', { runId: request.runId, sequence: 1, text: 'The queue is planned.', phase: 'tool', tool: 'project.read' }, signal)
            await new Promise<void>(resolve => { continueDiscussion = resolve; signal.addEventListener('abort', () => resolve(), { once: true }) })
            signal.throwIfAborted()
          }
          return { text: review ? JSON.stringify({ findings: [{ id: config.findingId, category: 'omission', summary: 'Clarify queue persistence', explanation: 'The planned queue needs a persistence boundary.', suggestion: 'Describe when the queue is persisted.', citations: [{ path: '.agents/notes/module.md', quote: 'A queue is planned.' }], verification: 'not-configured' }], coverage: 'complete', limitations: [] }) : 'The queue is planned. You can confirm a maintenance proposal to clarify persistence.', cancelled: false, toolTraces: [] }
        },
      })
      return native
    },
  })
  let initialPending = true
  let releaseInitial: (() => void) | undefined
  const initialReady = new Promise<void>(resolve => { releaseInitial = resolve })
  const failedCalls: Array<{ method: string; code: string }> = []
  const originalCall = service.nativeCall.bind(service)
  service.nativeCall = async (...args) => {
    if (args[1] === 'blueprint.graph-open') await initialReady
    let result: Awaited<ReturnType<typeof originalCall>>
    try { result = await originalCall(...args) }
    catch (cause) { failedCalls.push({ method: args[1], code: (cause as any).code ?? String(cause) }); throw cause }
    if (initialPending && args[1] === 'workspace.status') return { ...(result as any), diagnostics: Array.from({ length: 33 }, (_, index) => ({ path: `.agents/notes/fixture-${index}.md`, code: 'FIXTURE', message: 'Fixture source warning' })) }
    return result
  }
  runtime = new PluginRuntime(service, () => window)
  await service.initialize()
  const archive = await originalFiles.readFile(join(directory, 'release/official.blueprint-1.0.0.jxp'))
  const startsBeforeInstall = nativeStarts
  await service.installOfficial(archive, config.signed)
  const startsAfterInstall = nativeStarts
  await service.enable('official.blueprint', ['project'])
  await service.setContext('project', root, 'zh-CN', { id: 'dark', tokens: {} })
  const open = async (view = 'blueprint') => {
    if (mount) service.close(mount.instanceId, mount.binding)
    mount = await service.mount('official.blueprint', view, view === 'blueprint' ? 'project' : null, view === 'blueprint' ? root : null)
    await runtime.create('official.blueprint', mount)
    service.active(mount.instanceId, mount.binding, true)
    runtime.setBounds(mount.instanceId, mount.binding, { x: 0, y: 0, width: 1440, height: 920 })
    return mount.url
  }
  ;(globalThis as any).blueprintProbe = { open, notifications, failedCalls, releaseInitial: () => { initialPending = false; releaseInitial?.() },
    resize: (width: number, height: number) => runtime.setBounds(mount!.instanceId, mount!.binding, { x: 0, y: 0, width, height }),
    lifecycle: () => ({ startsBeforeInstall, startsAfterInstall, nativeStarts, processes: nativeProcesses.size, modelCalls }),
    editDiscussionDraft: async (value: string) => new PluginStorage(join(pluginHome, 'data')).mutate('official.blueprint',
      `project:${createHash('sha256').update(root).digest('hex')}`, 'blueprint-discussion-draft', value, undefined, () => {}),
    locale: (locale: string) => service.setContext('project', root, locale, { id: 'dark', tokens: {} }),
    continueDiscussion: () => { continueDiscussion?.(); continueDiscussion = undefined },
    snapshot: () => service.snapshot(),
    async settings(value: unknown, expectedRevision: string) { return service.nativeCall('official.blueprint', 'settings.update', JSON.parse(JSON.stringify({ value, expectedRevision })), null, null, new AbortController().signal) },
    readSettings: () => service.nativeCall('official.blueprint', 'settings.snapshot', null, null, null, new AbortController().signal),
    readReview: () => service.nativeCall('official.blueprint', 'review.read', null, 'project', root, new AbortController().signal),
    readTasks: () => service.nativeCall('official.blueprint', 'maintenance.list', null, 'project', root, new AbortController().signal),
    async disable() { await service.disable('official.blueprint') },
    async uninstall() { await service.uninstall('official.blueprint') },
    async reinstall() { await service.installOfficial(archive, config.signed) },
    async enable() { await service.enable('official.blueprint', ['project']); return open() },
    async close() { service.closeAll(); await service.dispose(); runtime.dispose(); window.destroy(); app.exit(0) },
  }
  await open()
}).catch(cause => { console.error(cause); app.exit(1) })
