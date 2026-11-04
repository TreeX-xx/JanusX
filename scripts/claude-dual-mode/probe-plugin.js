// Copied into a disposable --plugin-dir by mods-probe.mjs. No user installation.
import { endpoint, token, label } from './probe-config.js'

let sessionId = null
let sequence = 0
let polling = false
let missedEvents = 0
let stepSettings = null

async function post($, route, value) {
  const response = await $.http.fetch(`${endpoint}/${route}/${label}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Probe-Token': token },
    body: JSON.stringify(value),
  })
  if (!response.ok) throw new Error(`Probe bridge: ${response.status}`)
  return JSON.parse(response.text)
}

async function emit($, type, data) {
  // Observing a native event must not turn a disconnected bridge or a native
  // cancellation into a different tool/stream error. Sequence gaps stay visible.
  const value = { sequence: ++sequence, sessionId, type, data, missedEvents }
  try { return await post($, 'events', value) } catch { missedEvents++ }
}

async function execute($, command) {
  try {
    let result
    if (command.type === 'send') result = await $.prompt.submit({ text: command.text, asUser: true })
    else if (command.type === 'step-settings') {
      stepSettings = command.settings
      if (command.envEffort) await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', command.settings.effort)
      result = { settings: stepSettings, nativeModel: await $.session.model(), commands: await $.command.list() }
    }
    else if (command.type === 'abort') result = await $.turn.abort({ turnId: command.turnId })
    else if (command.type === 'draft') result = await $.prompt.read()
    else if (command.type === 'clear-draft') result = await $.prompt.fill({ text: '', mode: 'replace' })
    else if (command.type === 'messages') result = await $.session.messages()
    else if (command.type === 'config') result = await $.config.list()
    else if (command.type === 'stop-task') result = await $.tool.call({ tool: 'TaskStop', task_id: command.taskId })
    else if (command.type === 'config-set') result = await $.config.set({ key: command.key, value: command.value })
    else if (command.type === 'model') {
      const pending = $.command.run({ command: 'model', args: command.model })
      $.ui.invalidate()
      result = await pending
    } else if (command.type === 'effort') {
      const pending = $.command.run({ command: 'effort', args: command.effort })
      $.ui.invalidate()
      result = await pending
    }
    else throw new Error('Unknown probe command')
    await post($, 'acks', { id: command.id, ok: true, result: result ?? null })
  } catch (error) {
    await post($, 'acks', { id: command.id, ok: false, error: String(error) })
  }
}

async function poll($) {
  if (polling) return
  polling = true
  try {
    const result = await post($, 'poll', {})
    if (result.command) void execute($, result.command)
  } finally { polling = false }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id()
    await emit($, 'session.start', { event: e, model: await $.session.model(),
      terminalId: await $.env.get('JANUSX_HOOK_TERMINAL_ID'), workspaceId: await $.env.get('JANUSX_HOOK_WORKSPACE_ID') })
    $.clock.every(80, async () => { try { await poll($) } catch (error) { await emit($, 'poll.error', String(error)) } })
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => { await emit($, 'prompt.submit', e); return next(e) })
  on('turn.start', async ($, e, next) => { await emit($, 'turn.start', e); return next(e) })
  on('turn.step', async function* ($, e, next) {
    await emit($, 'step.start', e)
    const input = !e.agentId && stepSettings ? { ...e, ...stepSettings } : e
    await emit($, 'step.effective', input)
    const stream = next(input)
    let done = false
    try {
      while (true) {
        const item = await stream.next()
        if (item.done) {
          done = true
          await emit($, 'step.complete', { turnId: e.turnId, index: e.index, result: item.value })
          return item.value
        }
        if (item.value.kind !== 'engine') await emit($, 'step.chunk', { turnId: e.turnId, step: e.index, agentId: e.agentId, chunk: item.value })
        yield item.value
      }
    } finally { if (!done) await stream.return() }
  })
  on('turn.complete', async ($, e, next) => { await emit($, 'turn.complete', e); return next(e) })
  on('tool.call', async ($, e, next) => {
    await emit($, 'tool.start', e)
    try {
      const result = await next(e)
      await emit($, 'tool.complete', { toolUseId: e.tool_use_id, result })
      if (!e.agentId && ['TaskCreate', 'TaskUpdate', 'TodoWrite'].includes(e.tool)) {
        const snapshot = e.tool === 'TodoWrite' ? undefined : await $.tool.call({ tool: 'TaskList' })
        await emit($, 'task.snapshot', { input: e, result, snapshot })
      }
      return result
    } catch (error) { await emit($, 'tool.error', { toolUseId: e.tool_use_id, error: String(error) }); throw error }
  })
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    await emit($, 'tool.check', { input: e, result })
    return result
  })
}
