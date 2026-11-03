// Loaded by Claude Code, not by Electron. Kept as source so the native Mods
// validator sees the original module, and never an Electron bundle.
import { endpoint, token, terminalId } from './connection.js'

let sessionId = null
let sequence = 0
let events = []
let eventBytes = 0
let overflow = false
let flushing = false
let currentTurn = null
const blocked = new Set()
const executions = new Map()
const finishedTasks = new Map()
const activeTools = new Map()
const metaPrompts = new Set()
let userPrompts = []
let settings = null
let originalEffort
let settingsBusy = false
let planSource = null
let lastTodos = null
let planReads = Promise.resolve()

function recordPlan(turnId, rows, source) {
  if (!turnId || turnId !== currentTurn) return
  if (!Array.isArray(rows) || rows.length > 100 || !rows.every(row => row &&
    typeof (source === 'tasks' ? row.subject : row.content) === 'string' && ['pending', 'in_progress', 'completed'].includes(row.status))) {
    record('plan.unavailable', { turnId }); return
  }
  const plan = rows.map(row => ({ step: (source === 'tasks' ? row.subject : row.content).slice(0, 2000),
    status: row.status === 'in_progress' ? 'inProgress' : row.status }))
  planSource = source
  if (source === 'todos') lastTodos = rows.map(row => ({ content: row.content.slice(0, 2000), status: row.status }))
  record('plan.updated', { turnId, plan })
}

function refreshTasks($, turnId) {
  planSource = 'tasks'
  // Serialize readbacks so slower reads cannot replace a newer native list.
  planReads = planReads.then(async () => {
    if (turnId !== currentTurn) return
    try {
      const result = await $.tool.call({ tool: 'TaskList' })
      if (result.deny || result.isError) throw new Error('Native task list unavailable')
      recordPlan(turnId, result.result?.tasks, 'tasks')
    } catch { if (turnId === currentTurn) record('plan.unavailable', { turnId }) }
  })
  return planReads
}

async function resetSettings($) {
  if (!settings) return
  const restored = await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', originalEffort)
  if (restored.deny) throw new Error(restored.deny)
  settings = null
  record('settings', { model: await $.session.model(), effort: null, override: false })
  $.ui.invalidate('ui.render')
}

function record(type, data) {
  if (overflow) return
  const event = { seq: ++sequence, type, data }
  const size = JSON.stringify(event).length
  if (events.length >= 4000 || eventBytes + size > 2000000) { overflow = true; return }
  events.push(event); eventBytes += size
}

// Completion belongs to the native lifecycle, not transcript visibility.
// See .agents/notes/workbench/terminal-dialog-dual-mode.md.
function finishTask(taskId, status, toolUseId) {
  if (typeof taskId !== 'string' || !['completed', 'failed', 'killed', 'missing'].includes(status)) return
  if (!finishedTasks.has(taskId) || (finishedTasks.get(taskId) === 'missing' && status !== 'missing')) {
    finishedTasks.set(taskId, status)
    if (finishedTasks.size > 1000) finishedTasks.delete(finishedTasks.keys().next().value)
    record('task.complete', { taskId, toolUseId, status })
  }
  for (const [id, tool] of activeTools) if (tool.taskId === taskId || id === toolUseId) activeTools.delete(id)
}

function observeTaskNotification(e) {
  if (e.origin.kind !== 'task-notification' || typeof e.text !== 'string') return
  // The pinned CLI's machine envelope, never an assistant answer or user text.
  for (const match of e.text.matchAll(/<task-notification>\s*([\s\S]*?)<\/task-notification>/g)) {
    const envelope = match[1].split('<summary>')[0]
    const taskId = envelope.match(/<task-id>([\w-]+)<\/task-id>/)?.[1]
    const status = envelope.match(/<status>(completed|failed|killed)<\/status>/)?.[1]
    const toolUseId = envelope.match(/<tool-use-id>([\w-]+)<\/tool-use-id>/)?.[1]
    if (taskId && status) finishTask(taskId, status, toolUseId)
  }
}

function taskMissing(error, taskId) {
  const text = String(error).replace(/^(?:Error:\s*)+/, '').trim()
  const message = `No task found with ID: ${taskId}`
  return text === message || text === `<tool_use_error>${message}</tool_use_error>`
}

async function execute($, command) {
  try {
    let result
    if (command.type === 'settings') {
      if (currentTurn || settingsBusy) throw new Error('Wait until Claude is idle before changing settings')
      settingsBusy = true
      try {
        const modelRow = (await $.config.list()).find(row => row.key === 'model')
        if (modelRow?.isLocked) throw new Error('Claude model is controlled by managed settings')
        const levels = ['low', 'medium', 'high', 'xhigh', 'max']
        const layers = await Promise.all(['user', 'project', 'local', 'flag', 'policy'].map(source => $.settings.read({ source })))
        const limits = layers.flatMap(layer => {
          const perModel = Object.entries(layer.modelSettings ?? {})
            .filter(([key]) => command.model.toLowerCase().includes(key.toLowerCase()))
            .map(([, value]) => value.maxEffortLevel).filter(cap => levels.includes(cap))
          return perModel.length ? perModel : [layer.maxEffortLevel]
        })
        if (command.effort !== null && (!levels.includes(command.effort) || limits.some(cap => levels.includes(cap) && levels.indexOf(command.effort) > levels.indexOf(cap)))) {
          throw new Error('Claude effort exceeds the model or organization limit')
        }
        // Native turn.step compares a rewritten effort with the incoming one.
        // On a model change an equal level can otherwise fall back to the new
        // model default. The worker-local env makes that explicit too.
        const applied = await $.env.set('CLAUDE_CODE_EFFORT_LEVEL', command.effort ?? originalEffort)
        if (applied.deny) throw new Error(applied.deny)
        settings = { model: command.model, effort: command.effort }
        record('settings', { ...settings, override: true })
        $.ui.invalidate('ui.render')
        result = settings
      } finally { settingsBusy = false }
    } else if (command.type === 'stop') {
      blocked.add(command.turnId)
      const toolIds = [...new Set([...command.toolIds, ...[...activeTools].filter(([, tool]) => tool.turnId === command.turnId).map(([id]) => id)])]
      try { await $.turn.abort({ turnId: command.turnId }) } catch (error) {
        // A completed turn can still have background tasks to stop. A different
        // active turn must never be cancelled with this command.
        if (currentTurn === command.turnId) throw error
      }
      // abort schedules foreground Bash backgrounding; its result can arrive
      // after abort resolves. Wait for the selected tools' structured outcomes.
      let history = []
      for (let attempt = 0; attempt < 60; attempt++) {
        history = await $.session.messages()
        const finished = history.flatMap(row => row.toolUses ?? []).filter(tool =>
          toolIds.includes(tool.tool_use_id) && (tool.result || tool.deny || tool.isError))
        if (toolIds.every(id => finished.some(tool => tool.tool_use_id === id))) break
        await $.clock.sleep(100)
      }
      const tasks = new Set(command.taskIds)
      for (const row of history) for (const tool of row.toolUses ?? []) {
        if (toolIds.includes(tool.tool_use_id) && tool.result?.backgroundTaskId) tasks.add(tool.result.backgroundTaskId)
      }
      const stopped = []
      const settled = []
      for (const taskId of tasks) {
        let status = finishedTasks.get(taskId)
        if (!status) {
          let outcome
          try {
            outcome = await $.tool.call({ tool: 'TaskStop', task_id: taskId })
          } catch (error) {
            if (!taskMissing(error, taskId)) throw error
            status = 'missing'
          }
          if (outcome?.deny) throw new Error(outcome.deny)
          if (outcome?.isError) {
            if (!taskMissing(outcome.text, taskId)) throw new Error(outcome.text ?? 'Task stop failed')
            status = 'missing'
          } else if (!status) { status = 'killed'; stopped.push(taskId) }
          // Publish each confirmed result even if stopping a later task fails.
          finishTask(taskId, status)
        }
        settled.push({ taskId, status: finishedTasks.get(taskId) })
      }
      const selected = history.flatMap(row => row.toolUses ?? []).filter(tool => toolIds.includes(tool.tool_use_id))
      if (toolIds.some(id => !selected.some(tool => tool.tool_use_id === id && (tool.result || tool.deny || tool.isError)))) {
        throw new Error('Tool termination is unknown. Check the native terminal.')
      }
      for (const id of toolIds) activeTools.delete(id)
      result = { stopped, settled, history: selected.map(tool => ({ tool_use_id: tool.tool_use_id,
        result: tool.result ? { backgroundTaskId: tool.result.backgroundTaskId, interrupted: tool.result.interrupted } : undefined,
        deny: tool.deny, isError: tool.isError })) }
    } else throw new Error('Unsupported controller command')
    executions.set(command.id, { id: command.id, ok: true, result })
  } catch (error) { executions.set(command.id, { id: command.id, ok: false, error: String(error) }) }
}

async function flush($) {
  if (flushing) return
  flushing = true
  try {
    const batch = events.slice(0, 48)
    const response = await $.http.fetch(endpoint + '/exchange', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-JanusX-Token': token },
      body: JSON.stringify({ terminalId, sessionId, overflow, events: batch, acks: [...executions.values()].filter(Boolean) }) })
    if (!response.ok) return
    const reply = JSON.parse(response.text)
    events = events.filter(event => event.seq > reply.seq)
    eventBytes = events.reduce((sum, event) => sum + JSON.stringify(event).length, 0)
    for (const id of reply.acks ?? []) executions.delete(id)
    for (const command of reply.commands ?? []) {
      if (executions.has(command.id)) continue
      executions.set(command.id, null)
      void execute($, command)
    }
  } catch { /* Buffer and retry transport only; never repeat a model submission. */ }
  finally { flushing = false }
}

export function register(on) {
  on('command.run', async ($, e, next) => {
    if (!['model', 'effort', 'config'].includes(e.command)) return next(e)
    while (settingsBusy) await $.clock.sleep(20)
    settingsBusy = true
    record('native.settings', { pending: true })
    try {
      await resetSettings($)
      const result = await next(e)
      record('settings', { model: await $.session.model(), effort: null, override: false })
      return result
    } finally { settingsBusy = false; record('native.settings', { pending: false }) }
  })
  on('classic.PostModelSwitch', async ($, e, next) => {
    if (!e.agent_id) await resetSettings($)
    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const original = await next(e)
    if (!settings) return original
    return { type: 'Box', props: { flexDirection: 'column' }, children: [original,
      { type: 'Text', props: { dimColor: true }, children: [`JanusX session: ${settings.model} · ${settings.effort ?? 'default'} effort (/model or /effort to use native settings)`] }] }
  })
  on('prompt.submit', async ($, e, next) => {
    observeTaskNotification(e)
    if (e.isMeta || e.origin.kind === 'task-notification') {
      metaPrompts.add(e.text)
      if (metaPrompts.size > 100) metaPrompts.delete(metaPrompts.values().next().value)
    }
    const prompt = !e.isMeta && e.origin.kind !== 'task-notification' ? { text: e.text } : null
    if (prompt) {
      userPrompts.push(prompt)
      if (userPrompts.length > 100) userPrompts.shift()
    }
    try {
      const result = await next(e)
      if (result?.drop && prompt) userPrompts = userPrompts.filter(value => value !== prompt)
      return result
    } catch (error) {
      if (prompt) userPrompts = userPrompts.filter(value => value !== prompt)
      throw error
    }
  })
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const task = e.props.task
    if (task) finishTask(task.id, task.status, task.toolUseId)
    return next(e)
  })
  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id()
    originalEffort = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
    record('session.start', { model: await $.session.model() })
    $.clock.every(100, async () => { await flush($) })
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      while (settingsBusy) await $.clock.sleep(20)
      blocked.clear(); currentTurn = e.turnId
      const inputs = userPrompts.map(value => value.text); userPrompts = []
      record('turn.start', { turnId: e.turnId, text: e.text, inputs, isMeta: metaPrompts.delete(e.text), model: await $.session.model() })
      if (planSource === 'tasks') await refreshTasks($, e.turnId)
      else if (lastTodos?.some(row => row.status !== 'completed')) recordPlan(e.turnId, lastTodos, 'todos')
    }
    return next(e)
  })
  on('turn.step', async function* ($, e, next) {
    const selected = !e.agentId && settings
    const input = selected ? { ...e, model: selected.model, ...(selected.effort !== null ? { effort: selected.effort } : {}) } : e
    if (!e.agentId && !settings) record('settings', { model: e.model, effort: e.effort ?? null, override: false })
    const stream = next(input)
    let done = false
    try {
      while (true) {
        const item = await stream.next()
        if (item.done) { done = true; return item.value }
        if (!e.agentId && ['text', 'tool'].includes(item.value.kind)) {
          record('chunk', { turnId: e.turnId, step: e.index, chunk: item.value })
        }
        yield item.value
      }
    } finally { if (!done) await stream.return() }
  })
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await planReads
      record('turn.complete', { turnId: e.turnId, reason: e.reason, answer: e.answer?.slice(0, 32000) })
      if (currentTurn === e.turnId) currentTurn = null
    }
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    if (e.agentId || e.tool === 'TaskStop') return next(e)
    if (blocked.has(currentTurn)) return { deny: 'The user stopped this turn.' }
    const turnId = currentTurn
    activeTools.set(e.tool_use_id, { turnId })
    record('tool.start', { turnId, toolUseId: e.tool_use_id, tool: e.tool,
      command: e.command?.slice(0, 16000), path: e.file_path, old: e.old_string?.slice(0, 16000), text: (e.new_string ?? e.content)?.slice(0, 16000) })
    try {
      const result = await next(e)
      if (result.result?.backgroundTaskId && !finishedTasks.has(result.result.backgroundTaskId)) activeTools.set(e.tool_use_id, { turnId, taskId: result.result.backgroundTaskId })
      else activeTools.delete(e.tool_use_id)
      record('tool.complete', { turnId, toolUseId: e.tool_use_id, text: result.text?.slice(0, 24000),
        taskId: result.result?.backgroundTaskId, failed: Boolean(result.deny || result.isError) })
      if (!result.deny && !result.isError) {
        if (e.tool === 'TodoWrite') recordPlan(turnId, result.result?.newTodos, 'todos')
        else if ((e.tool === 'TaskCreate' && result.result?.task?.id) || (e.tool === 'TaskUpdate' && result.result?.success === true)) await refreshTasks($, turnId)
        else if (e.tool === 'TaskList' && Array.isArray(result.result?.tasks)) recordPlan(turnId, result.result.tasks, 'tasks')
      }
      return result
    } catch (error) { record('tool.error', { turnId, toolUseId: e.tool_use_id, text: String(error).slice(0, 2000) }); throw error }
  })
}
