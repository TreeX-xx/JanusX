// Runs inside the native CLI. Credentials are generated per terminal.
/* global fetch, AbortSignal, clearInterval, setInterval */
import { endpoint, token } from './connection.mjs'
import { randomUUID } from 'node:crypto'

export function bridge(execute, setMode = () => {}) {
  const instanceId = randomUUID()
  let sequence = 0, stopped = false, sessionId, timer, busy = false, overflow = false, lastSeen = Date.now()
  const events = [], acks = new Map(), executed = new Set()
  function emit(event) {
    if (stopped) return
    if (event.type === 'session') sessionId = event.sessionId
    if (event.item?.text?.length > 32000) event.item = { ...event.item, text: event.item.text.slice(0, 32000), truncated: true }
    if (events.length >= 1000) { overflow = true; return }
    events.push({ seq: ++sequence, event })
  }
  async function exchange() {
    if (stopped || busy || !sessionId) return
    busy = true
    try {
      const response = await fetch(`${endpoint}/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JanusX-Token': token },
        body: JSON.stringify({ sessionId, instanceId, overflow, events: events.slice(0, 50), acks: [...acks.values()] }), signal: AbortSignal.timeout(3000) })
      if (!response.ok) { if ([403, 409, 410].includes(response.status)) stop(); else if (Date.now() - lastSeen > 6000) setMode('terminal'); return }
      const reply = await response.json()
      lastSeen = Date.now()
      if (reply.mode === 'terminal' || reply.mode === 'conversation') setMode(reply.mode)
      while (events[0]?.seq <= reply.seq) events.shift()
      for (const id of reply.acks ?? []) acks.delete(id)
      for (const command of reply.commands ?? []) {
        if (executed.has(command.id)) continue
        executed.add(command.id)
        try {
          if (command.sessionId !== sessionId) throw new Error('Native session changed')
          const result = await execute(command)
          acks.set(command.id, { id: command.id, ok: true, result })
        } catch (error) { acks.set(command.id, { id: command.id, ok: false, error: String(error) }) }
        if (executed.size > 2500) { overflow = true; break }
      }
    } catch {
      // Release unanswered dialogs if the host disappeared; keep sequenced events
      // for reconciliation, without replaying a consumed command.
      if (Date.now() - lastSeen > 6000) setMode('terminal')
    }
    finally { busy = false }
  }
  function stop() { setMode('terminal'); stopped = true; clearInterval(timer) }
  timer = setInterval(() => void exchange(), 100)
  timer.unref?.()
  return { emit, stop }
}
