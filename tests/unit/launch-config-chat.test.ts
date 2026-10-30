import { describe, expect, it, vi } from 'vitest'
import type { ChatTurnPorts } from '@janus-agent/janus-agent'
import { ProjectType, type LaunchConfig, type LaunchConfiguration } from '../../src/shared/ipc/project'
import { applyLaunchConfigOps, type LaunchConfigOp } from '../../src/shared/launch-config-chat'
import { attachLaunchConfigTools, LAUNCH_CONFIG_TOOLS } from '../../src/main/harness/launch-config-chat'

const validConfig = (): LaunchConfig => ({
  version: '0.1.0',
  projectType: ProjectType.Vite,
  projectName: 'demo',
  configurations: [{ name: 'dev', type: ProjectType.Vite, request: 'launch', program: 'start.exe', env: { TOKEN: 'secret' } }],
})

const invalidConfig = (): LaunchConfig => ({
  version: '0.1.0',
  projectType: ProjectType.Vite,
  projectName: 'demo',
  configurations: [{ name: '', type: ProjectType.Vite, request: 'launch' }],
})

const configuration = (name: string): LaunchConfiguration => ({ name, type: ProjectType.Vite, request: 'launch' })

/** A ChatTurnPorts whose generic tool surface is a recording stub, as note-chat.test.ts does. */
function makePorts(execute: (input: { call: { toolName: string; input?: unknown; preview?: unknown } }, callerId: string) => Promise<unknown>) {
  return {
    tools: { registry: { list: () => [] }, executeFunctionCall: execute },
  } as unknown as ChatTurnPorts
}

function attach(config: LaunchConfig, execute: ReturnType<typeof makePorts>['tools']['executeFunctionCall']) {
  const ports = makePorts(execute)
  const changes: Array<Record<string, unknown>> = []
  attachLaunchConfigTools(ports, {
    draft: { config, projectPath: 'C:/proj' },
    workspaceId: 'ws-1',
    resources: [{ agentSessionId: 'session-1', workspaceId: 'ws-1', workspacePath: 'C:/proj' }],
    signal: new AbortController().signal,
    onChange: change => changes.push(change as unknown as Record<string, unknown>),
  })
  const invoke = (toolName: string, input: object = {}) =>
    ports.tools.executeFunctionCall({ sessionId: 'session-1', call: { toolName, input } } as never, 'test') as Promise<{
      status: string; error?: string; output?: Record<string, unknown>
    }>
  return { invoke, changes }
}

describe('launch-config ops engine', () => {
  it('rejects prototype traversal without changing shared object prototypes', () => {
    for (const path of ['__proto__.launchConfigPolluted', 'configurations[0].__proto__.launchConfigPolluted', 'constructor.prototype.launchConfigPolluted']) {
      expect(() => applyLaunchConfigOps(validConfig(), [{ op: 'setField', path, value: true }])).toThrow('Unsafe field path')
    }
    expect(Object.hasOwn(Object.prototype, 'launchConfigPolluted')).toBe(false)
  })
  it('applies setField to nested paths and top-level fields without mutating the draft', () => {
    const draft = validConfig()
    const before = JSON.stringify(draft)
    const { config, summary } = applyLaunchConfigOps(draft, [
      { op: 'setField', path: 'configurations[0].program', value: 'debug.exe' },
      { op: 'setField', path: 'projectName', value: 'renamed' },
    ] as LaunchConfigOp[])
    expect(config.configurations[0].program).toBe('debug.exe')
    expect(config.projectName).toBe('renamed')
    expect(summary).toBe('set configurations[0].program; set projectName')
    expect(JSON.stringify(draft)).toBe(before)
  })

  it('adds, updates and removes configurations by name', () => {
    const draft = validConfig()
    const added = applyLaunchConfigOps(draft, [{ op: 'addConfiguration', configuration: configuration('prod') }])
    expect(added.config.configurations.map(item => item.name)).toEqual(['dev', 'prod'])
    const updated = applyLaunchConfigOps(added.config, [{ op: 'updateConfiguration', name: 'prod', configuration: { ...configuration('prod'), program: 'prod.exe' } }])
    expect(updated.config.configurations.find(item => item.name === 'prod')?.program).toBe('prod.exe')
    const removed = applyLaunchConfigOps(updated.config, [{ op: 'removeConfiguration', name: 'dev' }])
    expect(removed.config.configurations.map(item => item.name)).toEqual(['prod'])
  })

  it('merges env onto a named configuration and reports the touched keys', () => {
    const { config, summary } = applyLaunchConfigOps(validConfig(), [{ op: 'setEnv', name: 'dev', env: { PORT: '3000' } }])
    expect(config.configurations[0].env).toEqual({ TOKEN: 'secret', PORT: '3000' })
    expect(summary).toBe('set env on dev: PORT')
  })

  it('rejects unknown configurations, bad field paths, duplicates and empty op lists', () => {
    expect(() => applyLaunchConfigOps(validConfig(), [{ op: 'removeConfiguration', name: 'nope' }])).toThrow('Configuration not found')
    expect(() => applyLaunchConfigOps(validConfig(), [{ op: 'setField', path: 'configurations[2].program', value: 'x' }])).toThrow('Field path not found')
    expect(() => applyLaunchConfigOps(validConfig(), [{ op: 'addConfiguration', configuration: configuration('dev') }])).toThrow('already exists')
    expect(applyLaunchConfigOps(validConfig(), []).summary).toBe('no-op')
  })
})

describe('launch-config tool surface', () => {
  it('exposes get/edit/apply alongside the untouched registry', () => {
    const ports = makePorts(async () => { throw new Error('unused') })
    const list = vi.fn(() => [{ name: 'workspace.read' }])
    ;(ports.tools as { registry: { list: typeof list } }).registry.list = list
    attachLaunchConfigTools(ports, {
      draft: { config: validConfig(), projectPath: 'C:/proj' }, workspaceId: 'ws-1',
      resources: [{ agentSessionId: 'session-1', workspaceId: 'ws-1', workspacePath: 'C:/proj' }],
      signal: new AbortController().signal, onChange: () => {},
    })
    const names = ports.tools.registry.list().map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining(['workspace.read', 'launch-config.get', 'launch-config.edit', 'launch-config.apply']))
    expect(LAUNCH_CONFIG_TOOLS.map(tool => tool.name)).toEqual(['launch-config.get', 'launch-config.edit', 'launch-config.apply'])
  })

  it('redacts env values in the get receipt and reports validation', async () => {
    const { invoke } = attach(validConfig(), async () => { throw new Error('unused') })
    const result = await invoke('launch-config.get')
    expect(result.status).toBe('completed')
    expect(JSON.stringify(result.output?.config)).not.toContain('secret')
    expect(JSON.stringify(result.output?.config)).toContain('[REDACTED]')
    expect(result.output?.validation).toMatchObject({ valid: true })
  })

  it('applies ops and feeds the ValidationResult back to the model', async () => {
    const { invoke, changes } = attach(validConfig(), async () => { throw new Error('unused') })
    const result = await invoke('launch-config.edit', { ops: [{ op: 'setField', path: 'configurations[0].program', value: 'debug.exe' }] })
    expect(result.status).toBe('completed')
    expect(result.output?.summary).toBe('set configurations[0].program')
    expect(result.output?.validation).toMatchObject({ valid: true })
    expect(changes[0]).toMatchObject({ summary: 'set configurations[0].program' })
    expect((changes[0] as { config: LaunchConfig }).config.configurations[0].program).toBe('debug.exe')
  })

  it('takes a full config as the escape hatch and refuses ops+config or neither', async () => {
    const { invoke } = attach(validConfig(), async () => { throw new Error('unused') })
    const replaced = await invoke('launch-config.edit', { config: { ...validConfig(), projectName: 'full' } })
    expect((replaced.output?.config as LaunchConfig).projectName).toBe('full')
    expect(replaced.output?.summary).toBe('replace full config')

    const both = await invoke('launch-config.edit', { ops: [{ op: 'setField', path: 'projectName', value: 'x' }], config: validConfig() })
    expect(both.status).toBe('failed')
    expect(both.error).toContain('not both')
    const neither = await invoke('launch-config.edit', {})
    expect(neither.status).toBe('failed')
    expect(neither.error).toContain('Provide ops or a full config')
  })

  it('keeps original env values when the model echoes [REDACTED]', async () => {
    const { invoke } = attach(validConfig(), async () => { throw new Error('unused') })
    await invoke('launch-config.edit', {
      config: { ...validConfig(), configurations: [{ ...configuration('dev'), env: { TOKEN: '[REDACTED]' } }] },
    })
    const read = await invoke('launch-config.get')
    const draft = read.output?.config as LaunchConfig
    expect(JSON.stringify(draft)).toContain('[REDACTED]')
    const applied = await invoke('launch-config.edit', { ops: [{ op: 'setEnv', name: 'dev', env: { TOKEN: '[REDACTED]', PORT: '1' } }] })
    expect(applied.status).toBe('completed')
  })

  it('stops after two consecutive invalid drafts and hands the errors to the user', async () => {
    const { invoke } = attach(validConfig(), async () => { throw new Error('unused') })
    const first = await invoke('launch-config.edit', { config: invalidConfig() })
    expect(first.output?.validation).toMatchObject({ valid: false })
    expect(first.output?.stopped).toBeUndefined()
    const second = await invoke('launch-config.edit', { config: invalidConfig() })
    expect(second.output?.stopped).toBe(true)
    expect(String(second.output?.message)).toContain('停手')
    const third = await invoke('launch-config.edit', { ops: [{ op: 'setField', path: 'projectName', value: 'x' }] })
    expect(third.status).toBe('failed')
    expect(third.error).toContain('停止编辑')
  })

  it('refuses to write an invalid draft and never calls apply', async () => {
    const execute = vi.fn(async () => { throw new Error('must not apply') })
    const { invoke } = attach(invalidConfig(), execute as never)
    const result = await invoke('launch-config.apply')
    expect(result.status).toBe('completed')
    expect(result.output?.message).toContain('不写盘')
    expect(execute).not.toHaveBeenCalled()
  })

  it('writes a valid draft through project.apply-config with a preview and settles the baseline', async () => {
    const calls: Array<{ call: { toolName: string; input?: { config: LaunchConfig }; preview?: { summary: string } } }> = []
    const execute = vi.fn(async (input: { call: { toolName: string; input?: { config: LaunchConfig }; preview?: { summary: string } } }) => {
      calls.push(input)
      return { status: 'completed', output: { applied: true } }
    })
    const { invoke, changes } = attach(validConfig(), execute as never)
    const result = await invoke('launch-config.apply')
    expect(result.status).toBe('completed')
    expect(result.output?.applied).toBe(true)
    expect(String(result.output?.summary)).toContain('written JanusX launch configuration')
    expect(calls[0].call.toolName).toBe('project.apply-config')
    expect(calls[0].call.input?.config.projectName).toBe('demo')
    expect(calls[0].call.preview?.summary).toContain('demo')
    expect(changes.at(-1)).toMatchObject({ applied: true })
  })

  it('reports a failed apply without pretending the file landed', async () => {
    const execute = vi.fn(async () => ({ status: 'failed', error: 'denied by workspace policy' }))
    const { invoke, changes } = attach(validConfig(), execute as never)
    const result = await invoke('launch-config.apply')
    expect(result.output?.applied).toBeUndefined()
    expect(String(result.output?.error)).toContain('denied')
    expect(changes.some(change => change.applied)).toBe(false)
  })

  it('denies a session outside the authorized workspace resources', async () => {
    const ports = makePorts(async () => { throw new Error('unused') })
    attachLaunchConfigTools(ports, {
      draft: { config: validConfig(), projectPath: 'C:/proj' }, workspaceId: 'ws-1',
      resources: [{ agentSessionId: 'other-session', workspaceId: 'ws-1', workspacePath: 'C:/proj' }],
      signal: new AbortController().signal, onChange: () => {},
    })
    const result = await ports.tools.executeFunctionCall({ sessionId: 'session-1', call: { toolName: 'launch-config.get', input: {} } } as never, 'test') as { status: string; error?: string }
    expect(result.status).toBe('failed')
    expect(result.error).toContain('PERMISSION_DENIED')
  })

  it('falls through non-launch tools to the underlying registry', async () => {
    const execute = vi.fn(async () => ({ status: 'completed', output: { ok: true } }))
    const { invoke } = attach(validConfig(), execute as never)
    const result = await invoke('workspace.read', { path: 'package.json' })
    expect(result.status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
