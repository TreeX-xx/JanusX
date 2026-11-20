import { clearTimeout, setTimeout } from 'node:timers'
import { createUserMessage } from '__DSH_LLM_URL__'
import { bridge } from './native-bridge.mjs'
import { nativeQuestions } from './native-questions.mjs'

export const inject = ['agents', 'commands']
export function apply(ctx) {
  let active, turnId = '', step = 0, text = '', reasoning = ''
  let nativeDialogs = 0
  const sides = new Map()
  const sideFor = agent => sides.get(String(agent?.session?.id))
  const sideForSession = session => sides.get(String(session.id))
  const publishSide = (side, status, error) => {
    clearTimeout(side.timer)
    side.timer = undefined
    if (side.requestId) link.emit({ type: 'side-update', sideId: side.id, requestId: side.requestId,
      text: (side.settled + side.partial).slice(0, 64000), status, error })
  }
  const disposeSide = async side => {
    sides.delete(side.id)
    clearTimeout(side.timer)
    await side.handle?.dispose()
  }
  const questions = nativeQuestions(event => link.emit(event))
  const link = bridge(async command => {
    if (!active || String(active.session.id) !== command.sessionId) throw new Error('DSH session changed')
    if (command.type === 'side-fork') {
      const owner = active
      const history = owner.session.snapshotEvents()
      const boundary = history.findLastIndex(event => event.type === 'turn/end' &&
        !['aborted', 'error', 'blocked', 'forked'].includes(event.data.reason.kind))
      const seed = boundary >= 0 ? history.slice(0, boundary + 1) : undefined
      const model = owner.model.current()
      const side = { id: command.sideId, settled: '', partial: '' }
      sides.set(side.id, side)
      try {
        side.handle = await ctx.agents.create({
          sessionId: side.id, seed, inheritedEventCount: seed?.length,
          meta: { cwd: owner.session.header.cwd, origin: 'subagent', isSeeded: Boolean(seed) },
          agentOptions: model ?? owner.options,
          setup(agentCtx, agent) {
            agentCtx.tools.restrict({ allow: [] })
            agentCtx.systemPrompt.section({ name: 'janusx-side-chat', order: 10000, text: command.policy, interpolate: false })
            agent.inbox.clear()
            if (model) agent.model.select(model)
          },
        })
        if (active !== owner || !sides.has(side.id)) throw new Error('DSH parent session changed')
        return side.id
      } catch (error) { await disposeSide(side); throw error }
    }
    if (command.type.startsWith('side-')) {
      const side = sides.get(command.sideId)
      if (!side?.handle) throw new Error('DSH side session is unavailable')
      if (command.type === 'side-dispose') { await disposeSide(side); return }
      const agent = side.handle.agent
      if (command.type === 'side-stop') {
        if (side.requestId !== command.requestId) return
        agent.cancel({ kind: 'user' })
        return
      }
      if (command.type !== 'side-ask' || agent.status !== 'idle' || side.requestId) throw new Error('DSH side session is busy')
      side.requestId = command.requestId
      side.settled = side.partial = ''
      try {
        agent.followup(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
      } catch (error) { side.requestId = undefined; throw error }
      return
    }
    if (command.type === 'catalog') {
      const { LOCAL_COMMANDS = [] } = await import('__DSH_COMMANDS_URL__').catch(() => ({}))
      const entries = new Map(LOCAL_COMMANDS.map(row => [row.name, { ...row, source: 'builtin' }]))
      for (const row of ctx.commands.list(active)) entries.set(row.name, { name: row.name, description: row.description, source: 'extension' })
      return [...entries.values()]
    }
    if (command.type === 'display-mode') { questions.setMode(command.mode); return }
    if (command.type === 'answer') { questions.answer(command); return }
    if (command.type === 'interrupt') {
      if (command.turnId !== turnId) throw new Error('DSH turn changed')
      questions.cancel()
      active.cancel({ kind: 'user' })
    } else {
      if (active.status !== 'idle') throw new Error('DSH is busy')
      active.followup(createUserMessage({ content: [{ type: 'text', text: command.text }], source: { kind: 'user' } }))
    }
  }, questions.setMode)
  const bind = agent => {
    if (sideFor(agent) || agent.session.header.origin === 'subagent') return
    if (active && active !== agent) return
    active = agent
    link.emit({ type: 'session', sessionId: String(agent.session.id), model: agent.options?.model })
  }
  const item = (id, type, value, status = 'inProgress') => link.emit({ type: 'item', item: { id, turnId, type, text: value, status } })
  ctx.on('agent/created', ({ agent }) => bind(agent))
  for (const agent of ctx.agents.list()) bind(agent)
  ctx.on('agent/disposed', ({ agent }) => {
    if (agent !== active) return
    questions.cancel(); active = null; turnId = ''
    for (const side of sides.values()) void disposeSide(side).catch(() => {})
    // The TUI prepares the replacement before disposing the previous root.
    // Select only an unambiguous surviving root, never an arbitrary background agent.
    const roots = ctx.agents.list().filter(candidate => candidate !== agent && candidate.session.header.origin !== 'subagent')
    if (roots.length === 1) bind(roots[0])
    else link.emit({ type: 'attention', pending: true })
  })
  ctx.on('session/event', (session, event) => {
    const side = sideForSession(session)
    if (side) {
      if (!side.requestId) return
      if (event.type === 'assistant/message') {
        const answer = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
        if (answer) side.settled = (side.settled + answer + '\n\n').slice(0, 64000)
        side.partial = ''
        publishSide(side, 'streaming')
      } else if (event.type === 'turn/end') {
        const reason = event.data.reason
        void side.handle.agent.whenIdle().then(() => {
          publishSide(side, reason.kind === 'aborted' ? 'stopped' : ['error', 'blocked'].includes(reason.kind) ? 'failed' : 'done', reason.error?.message)
          side.requestId = undefined
        }, error => {
          publishSide(side, 'failed', String(error))
          side.requestId = undefined
        })
      }
      return
    }
    if (!active || session !== active.session) return
    const d = event.data
    if (event.type === 'turn/start') { turnId = String(d.turn); link.emit({ type: 'start', turnId }) }
    else if (event.type === 'turn/end') { link.emit({ type: 'end', error: d.reason.error?.message, outcome: d.reason.kind === 'aborted' ? 'interrupted' : d.reason.kind === 'error' || d.reason.kind === 'blocked' ? 'failed' : 'completed' }); turnId = '' }
    else if (event.type === 'step/start') { step = d.step; text = ''; reasoning = '' }
    else if (event.type === 'user/message' && d.source?.kind === 'user') item(d.id, 'userMessage', d.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), 'completed')
    else if (event.type === 'assistant/message') {
      const status = d.interrupted ? 'interrupted' : 'completed'
      const content = d.message.content
      const finalText = content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      const finalReasoning = content.filter(b => b.type === 'reasoning').map(b => b.text).join('\n')
      if (finalText) item(`answer:${turnId}:${d.step}`, 'agentMessage', finalText, status)
      if (finalReasoning) item(`reasoning:${turnId}:${d.step}`, 'reasoning', finalReasoning, status)
    } else if (event.type === 'tool/call') item(`tool:${d.callId}`, 'commandExecution', `${d.name}\n${d.arguments}`)
    else if (event.type === 'tool/result') item(`tool:${d.message.source.callId}`, 'commandExecution', d.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n'), d.message.isError ? 'failed' : 'completed')
  })
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const side = sideFor(agent)
    if (side) {
      if (side.requestId && frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
        side.partial = (side.partial + frame.chunk.text).slice(0, 64000)
        side.timer ??= setTimeout(() => publishSide(side, 'streaming'), 100)
      }
      return
    }
    if (agent !== active) return
    if (frame.type === 'start') { text = ''; reasoning = ''; return }
    if (frame.type !== 'chunk') return
    if (frame.chunk.type === 'text-delta') { text = (text + frame.chunk.text).slice(0, 32001); item(`answer:${turnId}:${step}`, 'agentMessage', text) }
    if (frame.chunk.type === 'reasoning-delta') { reasoning = (reasoning + frame.chunk.text).slice(0, 32001); item(`reasoning:${turnId}:${step}`, 'reasoning', reasoning) }
  })
  async function native(next) {
    link.emit({ type: 'attention', pending: ++nativeDialogs > 0 })
    try { return await next() } finally { link.emit({ type: 'attention', pending: --nativeDialogs > 0 }) }
  }
  ctx.on('approval/request', async (request, next) => {
    if (sideFor(request.agent)) return 'rejected'
    if (request.agent !== active) return next()
    const reply = await questions.ask({ turnId, itemId: request.callId ? `tool:${request.callId}` : undefined,
      questions: [{ id: 'decision', text: request.displayReason ?? request.reason ?? request.toolName,
        options: [{ id: 'yes', label: 'Yes — allow once' }, { id: 'no', label: 'No — reject' }] }] }, request.signal)
    if (reply.native) return native(next)
    return reply.cancelled ? 'cancelled' : reply.answers[0].selected[0] === 'yes' ? 'allowed-once' : 'rejected'
  })
  ctx.on('user-questions/request', async (request, next) => {
    if (sideFor(request.agent)) return { answers: [] }
    if ((request.agent && request.agent !== active) || request.wait?.timed || !Array.isArray(request.questions) || !request.questions.length) return native(next)
    const reply = await questions.ask({ turnId, questions: request.questions.map(q => ({ id: q.id,
      text: q.question, header: q.header, detail: q.detail, multiple: q.multiSelect === true, allowText: true,
      options: (q.options ?? []).map((option, i) => ({ id: String(i), label: option.label, description: option.description })),
    })) }, request.signal)
    if (reply.native) return native(next)
    if (reply.cancelled) return { answers: [] }
    return { answers: reply.answers.map(answer => ({ id: answer.id,
      selected: answer.selected.map(id => request.questions.find(q => q.id === answer.id).options[Number(id)].label),
      ...(answer.text?.trim() ? { custom: answer.text } : {}),
    })) }
  })
  ctx.on('dispose', () => {
    questions.cancel()
    for (const side of sides.values()) void disposeSide(side).catch(() => {})
    link.stop()
  })
}
