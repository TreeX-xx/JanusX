import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceAgentRuntime } from '@janus-agent/agent-core'
import { parsePluginManifest, PLUGIN_CAPABILITIES, type PluginManifest } from '../../packages/plugin-sdk/src'
import { PluginService } from '../../src/main/plugins/service'
import { registerPluginTools } from '../../src/main/agent/runtime/tools/plugin-tools'

const cleanup: Array<() => unknown> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const signal = () => new AbortController().signal
async function manifest() { return parsePluginManifest(await readFile('packages/plugin-sdk/examples/p6-skill-provider/manifest.json', 'utf8')) }
async function fixture(value?: PluginManifest) {
  const data = value ?? await manifest()
  const directory = await mkdtemp(join(tmpdir(), 'janusx-skills-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }))
  const root = join(directory, 'root'); const other = join(directory, 'other'); await mkdir(root); await mkdir(other)
  const service = new PluginService({ directory: join(directory, 'profile'), resolveProject: async (_id, scope) => ({ root: scope ?? root, name: 'Project' }),
    changed: vi.fn(), event: vi.fn(), openView: vi.fn(), toast: vi.fn() })
  cleanup.push(() => service.dispose()); await service.initialize(); await service.setDevelopment(true)
  const install = async (data: PluginManifest) => {
    const source = join(directory, data.id); await mkdir(source); await writeFile(join(source, 'manifest.json'), JSON.stringify(data))
    await service.import(source, 'linked'); await service.enable(data.id, ['project']); return source
  }
  const source = await install(data); await service.setContext('project', root, 'en', { id: '', tokens: {} })
  const context = { workspaceId: 'project', workspaceRoot: root }
  const discovered = (await service.discoverAgentSkills(context, signal())).skills[0]
  const request = { plugin: data.id, skill: discovered.skill, version: discovered.version, revision: discovered.revision }
  const read = (input: unknown = request) => service.readAgentSkill(context, input, signal())
  const runtime = new WorkspaceAgentRuntime(async () => root); registerPluginTools(runtime.registry, () => service)
  const session = await runtime.createSession({ ...context, approvalMode: 'plan' })
  return { data, directory, root, other, source, service, context, discovered, request, read, install, runtime, session }
}

describe('P6 inert plugin skills', () => {
  it('requires explicit capability and permission and rejects unknown host capability', async () => {
    const data = await manifest()
    for (const changed of [
      { ...data, permissions: data.permissions.filter(item => item.name !== 'agent.skills') },
      { ...data, capabilities: { ...data.capabilities, required: data.capabilities.required.filter(item => item !== 'agent.skills') } },
    ]) expect(() => parsePluginManifest(JSON.stringify(changed))).toThrow()
    expect(() => parsePluginManifest(JSON.stringify(data), { apiVersion: '1.0.0', capabilities: PLUGIN_CAPABILITIES.filter(item => item !== 'agent.skills') })).toThrow()
  })
  it.each(['duplicate', 'extra', 'blank', 'bytes', 'control', 'private', 'version', 'scope'])('rejects invalid %s declarations', async kind => {
    const data = await manifest(); const skill = data.contributes.skills![0]
    if (kind === 'duplicate') data.contributes.skills!.push(skill)
    if (kind === 'extra') Object.assign(skill, { entry: 'skill.js' })
    if (kind === 'blank') skill.instructions = ' '
    if (kind === 'bytes') skill.instructions = '汉'.repeat(6000)
    if (kind === 'control') skill.instructions = 'hidden\u202ecommand'
    if (kind === 'private') data.contributes.services![0].consumers = []
    if (kind === 'version') skill.services[0].version = 2
    if (kind === 'scope') skill.scope = 'application'
    expect(() => parsePluginManifest(JSON.stringify(data))).toThrow()
  })
  it('supports a manifest-only guidance package without tasks or executable assets', async () => {
    const data = await manifest(); data.capabilities.required = ['agent.skills']; data.permissions = [{ name: 'agent.skills' }]
    delete data.contributes.tasks; delete data.contributes.services; data.contributes.skills![0].services = []
    const f = await fixture(parsePluginManifest(JSON.stringify(data)))
    expect(await f.read()).toMatchObject({ trust: 'untrusted-plugin-content', services: [] })
    expect(f.service.snapshot().plugins[0].runtime?.pages).toBe(0); expect(f.service.snapshot().tasks).toEqual([])
  })
  it('discovers metadata only and reads an exact revision with live service schemas as inert data', async () => {
    const f = await fixture()
    expect(f.discovered).not.toHaveProperty('instructions')
    const result = await f.read()
    expect(result).toMatchObject({ ...f.discovered, trust: 'untrusted-plugin-content', instructions: f.data.contributes.skills![0].instructions,
      services: [{ plugin: f.data.id, service: 'status', version: 1, scope: 'project', input: {} }] })
    result.services[0].input.extra = 'string'
    expect((await f.read()).services[0].input).toEqual({})
    expect(f.service.snapshot().tasks).toEqual([])
  })
  it('permits inspect tools in plan mode while actual service execution retains the run gate', async () => {
    const f = await fixture()
    const execute = (toolName: string, input: unknown) => f.runtime.executeTool({ sessionId: f.session.id, call: { toolName, input } })
    expect(await execute('plugin.skills', {})).toMatchObject({ status: 'completed', output: { skills: [f.discovered], truncated: false } })
    expect(await execute('plugin.read-skill', f.request)).toMatchObject({ status: 'completed', output: { trust: 'untrusted-plugin-content' } })
    expect((await execute('plugin.call-service', { plugin: f.data.id, service: 'status', version: 1, input: {} })).status).toBe('failed')
    expect(f.service.snapshot().tasks).toEqual([])
  })
  it('rejects malformed and stale requests without running a task', async () => {
    const f = await fixture()
    for (const request of [{ ...f.request, version: 2 }, { ...f.request, revision: '0'.repeat(64) }, { ...f.request, instructions: 'replacement' },
      { ...f.request, skill: 'missing' }, { ...f.request, revision: '' }]) await expect(f.read(request)).rejects.toThrow()
    expect(f.service.snapshot().tasks).toEqual([])
  })
  it('enforces active worktree and revocation with all-workspace authorization', async () => {
    const f = await fixture()
    for (const context of [{ ...f.context, workspaceRoot: f.other }, { ...f.context, workspaceId: 'other' }]) {
      await expect(f.service.discoverAgentSkills(context, signal())).rejects.toThrow()
      await expect(f.service.readAgentSkill(context, f.request, signal())).rejects.toThrow()
    }
    await f.service.enable(f.data.id, [])
    expect((await f.service.discoverAgentSkills(f.context, signal())).skills).toHaveLength(1)
    await f.read()
    await f.service.disable(f.data.id)
    expect((await f.service.discoverAgentSkills(f.context, signal())).skills).toEqual([])
    await expect(f.read()).rejects.toThrow()
  })
  it('allows application skills without a project grant but still binds each read to the current Agent workspace', async () => {
    const data = await manifest(); data.contributes.skills![0].scope = 'application'; data.contributes.tasks![0].scope = 'application'
    const f = await fixture(data); await f.service.enable(data.id, [])
    expect((await f.service.discoverAgentSkills(f.context, signal())).skills[0].scope).toBe('application')
    expect((await f.read()).scope).toBe('application')
    await f.service.setContext('project', f.other, 'en', { id: '', tokens: {} })
    await expect(f.read()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    expect((await f.service.discoverAgentSkills({ ...f.context, workspaceRoot: f.other }, signal())).skills).toHaveLength(1)
  })
  it.each(['disable', 'development', 'uninstall'])('revokes discovery and reads after %s', async kind => {
    const f = await fixture()
    if (kind === 'disable') await f.service.disable(f.data.id)
    if (kind === 'development') await f.service.setDevelopment(false)
    if (kind === 'uninstall') await f.service.uninstall(f.data.id)
    expect((await f.service.discoverAgentSkills(f.context, signal())).skills).toEqual([])
    await expect(f.read()).rejects.toThrow()
  })
  it('requires renewed authorization for instruction edits even without a version bump', async () => {
    const f = await fixture(); f.data.contributes.skills![0].instructions = 'Changed guidance'
    await writeFile(join(f.source, 'manifest.json'), JSON.stringify(f.data)); await f.service.reload(f.data.id)
    expect(f.service.snapshot().plugins[0].error).toBe('PERMISSION_RECONFIRM_REQUIRED')
    expect((await f.service.discoverAgentSkills(f.context, signal())).skills).toEqual([])
    await expect(f.read()).rejects.toThrow()
    await f.service.enable(f.data.id, ['project']); await expect(f.read()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    const found = (await f.service.discoverAgentSkills(f.context, signal())).skills[0]
    expect(await f.read({ ...f.request, revision: found.revision })).toMatchObject({ instructions: 'Changed guidance' })
  })
  it('rejects a reactivation while workspace validation is awaiting', async () => {
    const f = await fixture(); const original = (f.service as any).agentContext.bind(f.service)
    vi.spyOn(f.service as any, 'agentContext').mockImplementation(async (...args) => {
      const valid = await original(...args); await f.service.disable(f.data.id); await f.service.enable(f.data.id, ['project']); return valid
    })
    await expect(f.read()).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
  })
  it('honors pre-cancellation and cancellation during workspace validation', async () => {
    const f = await fixture(); const abort = new AbortController(); abort.abort()
    await expect(f.service.discoverAgentSkills(f.context, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    await expect(f.service.readAgentSkill(f.context, f.request, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
    const during = new AbortController(); const original = (f.service as any).agentContext.bind(f.service)
    vi.spyOn(f.service as any, 'agentContext').mockImplementation(async (...args) => { const valid = await original(...args); during.abort(); return valid })
    await expect(f.service.readAgentSkill(f.context, f.request, during.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
  })
  it('bounds global metadata discovery and reports truncation without returning instruction bodies', async () => {
    const f = await fixture()
    for (let index = 0; index < 4; index++) {
      const data = await manifest(); data.id = `example.many-${index}`
      data.contributes.skills = Array.from({ length: 8 }, (_, n) => ({ ...data.contributes.skills![0], id: `skill-${n}` }))
      await f.install(data)
    }
    const found = await f.service.discoverAgentSkills(f.context, signal())
    expect(found.skills).toHaveLength(32); expect(found.truncated).toBe(true)
    expect(JSON.stringify(found)).not.toContain('instructions')
  })
})
