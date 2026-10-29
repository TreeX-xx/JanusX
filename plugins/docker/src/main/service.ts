import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { JsonValue, ContainerTerminalOutput } from '@janusx/plugin-sdk'
import type { NativePeer, NativePluginImplementation } from '@janusx/plugin-sdk/native'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { DockerCli } from './cli'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ManagedWsl } from './managed-wsl'
import type { Container, ViewState, LogBatch } from '../shared/docker'

const LIMIT = 256 * 1024
interface Follow { id: string; owner: string; container: string; child: ChildProcessWithoutNullStreams; text: string; timer: ReturnType<typeof setInterval>; truncated: boolean }
export async function createDockerService(_context: JsonValue, host: NativePeer, cli = new DockerCli(), managed = new ManagedWsl(join(process.env.LOCALAPPDATA ?? homedir(), 'JanusX', 'docker-runtime'), host)): Promise<NativePluginImplementation> {
  let stopped = false, list: Container[] = [], connecting = false
  let runtimeProbe: Promise<unknown> | undefined
  const probeRuntime = (refresh = false) => {
    if (!runtimeProbe) runtimeProbe = managed.inspect(refresh).then(status => {
      if (!stopped && status.phase === 'stopped' && (!cli.engine || cli.wsl)) managed.start()
    }).catch(() => {}).finally(() => { runtimeProbe = undefined })
  }
  let operation: { busy: boolean; results: { id: string; ok: boolean; error?: string }[]; pending: string[] } = { busy: false, results: [], pending: [] }
  let ui: ViewState = { selected: '', search: '', runningOnly: false, containers: {} }
  const follows = new Map<string, Follow>(), sessions = new Map<string, string>(), abort = new AbortController()
  const emit = (batch: LogBatch) => { if (!stopped) host.emit('docker.logs', { scope: null, data: batch as unknown as JsonValue }) }
  const endFollow = (id: string) => { const follow = follows.get(id); if (!follow) return; follows.delete(id); clearInterval(follow.timer); follow.child.kill() }
  const container = (id: unknown) => { const item = list.find(item => item.id === id); if (!item) throw new Error('docker-container-gone'); return item }
  const desktop = (method: string, input: object) => host.call(`desktop.${method}`, input as JsonValue)
  const refresh = async (signal: AbortSignal) => {
    const next = await cli.list(signal)
    if (stopped) throw new Error('docker-stopped')
    list = next
    for (const [id, session] of sessions) if (!list.some(item => item.id === id && item.state === 'running')) { await desktop('terminal.end', { id: session }); sessions.delete(id) }
    return { engine: cli.engine, containers: list, operation }
  }
  return {
    async call(method, value, signal) {
      try {
        if (stopped) throw new Error('docker-stopped')
        const { input: raw, instanceId } = value as { input: Record<string, unknown>; instanceId?: string }, input = raw ?? {}
        const owner = () => { if (!instanceId) throw new Error('docker-page-unavailable'); return instanceId }
        let data: unknown = null
        const activeSignal = AbortSignal.any([signal, abort.signal])
        switch (method) {
          case 'runtime.inspect': probeRuntime(Boolean(input.refresh)); data = managed.state; break
          case 'runtime.status': data = managed.state; break
          case 'runtime.prepare':
            if (connecting || operation.busy || cli.engine && !cli.wsl) throw new Error('docker-busy')
            data = managed.start(); break
          case 'engine.connect': {
            if (connecting || operation.busy) throw new Error('docker-busy')
            if (managed.state.busy) throw new Error('docker-runtime-starting')
            connecting = true
            try {
              const connect = () => cli.connect(AbortSignal.any([activeSignal, AbortSignal.timeout(12_000)]))
              let engine
              try { engine = await connect() }
              catch (cause) {
                // A selected remote/broken external context must never silently switch engines.
                if (!(cause instanceof Error) || cause.message !== 'docker-cli-missing' && !cli.wsl) throw cause
                if (cli.wsl) { probeRuntime(true); throw new Error('docker-runtime-starting') }
                const status = managed.state
                if (status.phase === 'checking') { probeRuntime(); throw cause }
                if (status.phase === 'stopped') { managed.start(); throw new Error('docker-runtime-starting') }
                if (status.phase !== 'ready') throw cause
                cli.useManaged(managed.executable); engine = await connect()
              }
              data = { ...await refresh(activeSignal), engine }
            } finally { connecting = false }
            break
          }
          case 'containers.list': data = await refresh(activeSignal); break
          case 'containers.operate': {
            if (operation.busy || connecting) throw new Error('docker-busy')
            if (!['start', 'stop', 'restart'].includes(String(input.action))) throw new Error('docker-invalid-action')
            const targets = input.project !== undefined ? list.filter(item => item.project && item.project === input.project) : [container(input.id)]
            if (!targets.length) throw new Error('docker-container-gone')
            operation = { busy: true, results: [], pending: targets.map(item => item.id) }
            const job = operation
            // Operate existing containers in stable name order. This is not Compose dependency orchestration.
            void (async () => {
              for (const item of targets.sort((a, b) => a.name.localeCompare(b.name))) {
                if (stopped) break
                try {
                  await cli.operate(item.id, input.action as 'start' | 'stop' | 'restart', abort.signal)
                  job.results.push({ id: item.id, ok: true })
                  if (input.action !== 'start') { const session = sessions.get(item.id); if (session) await desktop('terminal.end', { id: session }); sessions.delete(item.id) }
                } catch (cause) { job.results.push({ id: item.id, ok: false, error: message(cause) }) }
                job.pending = job.pending.filter(id => id !== item.id)
              }
            })().catch(cause => { job.results.push({ id: '', ok: false, error: message(cause) }) }).finally(() => { job.busy = false })
            data = operation; break
          }
          case 'ui.read': {
            data = { ...ui, containers: Object.fromEntries([...new Set([...Object.keys(ui.containers), ...sessions.keys()])].map(id => [id,
              { ...(ui.containers[id] ?? { tab: 'overview', logSearch: '', scroll: 0, paused: false }), ...(sessions.has(id) ? { terminal: sessions.get(id) } : {}) }])) }
            break
          }
          case 'ui.save': {
            // Only bounded display preferences survive a page close; no credentials or project identity.
            const next = input.state as ViewState
            if (!next || JSON.stringify(next).length > 64 * 1024 || !next.containers || !['string'].includes(typeof next.selected) || typeof next.search !== 'string') throw new Error('docker-invalid-state')
            ui = { selected: next.selected.slice(0, 64), search: next.search.slice(0, 200), runningOnly: Boolean(next.runningOnly), containers: {} }
            for (const [id, state] of Object.entries(next.containers).slice(-128)) if (/^[a-f0-9]{64}$/.test(id) && state && ['overview', 'logs', 'terminal'].includes(state.tab)) {
              ui.containers[id] = { tab: state.tab, logSearch: String(state.logSearch ?? '').slice(0, 200), scroll: Math.max(0, Math.min(10_000_000, Number(state.scroll) || 0)), paused: Boolean(state.paused) }
            }
            break
          }
          case 'logs.subscribe': {
            const item = container(input.id), page = owner()
            for (const follow of follows.values()) if (follow.owner === page) endFollow(follow.id)
            const id = randomUUID(), child = cli.follow(item.id)
            const stdout = new StringDecoder('utf8'), stderr = new StringDecoder('utf8')
            const follow: Follow = { id, owner: page, container: item.id, child, text: '', truncated: false, timer: setInterval(() => flush(), 120) }
            const flush = (ended = false, error?: string) => {
              if (follows.get(id) !== follow) return
              if (follow.text || ended || error) emit({ subscription: id, container: item.id, text: follow.text, truncated: follow.truncated, ended, ...(error ? { error } : {}) })
              follow.text = ''; follow.truncated = false
            }
            const append = (text: string) => { follow.text += text; if (follow.text.length > LIMIT) { follow.text = follow.text.slice(-LIMIT); follow.truncated = true } }
            follows.set(id, follow); child.stdin.end()
            child.stdout.on('data', chunk => append(stdout.write(chunk))); child.stderr.on('data', chunk => append(stderr.write(chunk)))
            child.on('error', cause => { flush(true, message(cause)); endFollow(id) })
            child.on('close', code => { append(stdout.end() + stderr.end()); flush(true, code ? 'docker-logs-ended' : undefined); endFollow(id) })
            data = { subscription: id }; break
          }
          case 'logs.unsubscribe': { const follow = follows.get(String(input.subscription)); if (follow?.owner === owner()) endFollow(follow.id); break }
          case 'logs.copy': {
            if (typeof input.text !== 'string' || input.text.length > LIMIT) throw new Error('docker-output-limit')
            await desktop('clipboard', { text: input.text }); break
          }
          case 'terminal.open': {
            const item = container(input.id)
            if (item.state !== 'running') throw new Error('docker-container-not-running')
            const shell = input.shell ?? (cli.engine?.os === 'windows' ? 'cmd.exe' : '/bin/sh')
            const output = await desktop('terminal.open', { owner: owner(), request: { executable: cli.executable, endpoint: cli.engine!.endpoint, container: item.id, shell, cols: 80, rows: 24, ...(cli.wsl ? { wsl: cli.wsl } : {}) } }) as unknown as ContainerTerminalOutput
            if (stopped) { await desktop('terminal.end', { id: output.id }); throw new Error('docker-stopped') }
            sessions.set(item.id, output.id); data = output; break
          }
          case 'terminal.read': case 'terminal.write': case 'terminal.resize': case 'terminal.close': {
            const session = sessions.get(String(input.container))
            if (!session || session !== input.id) throw new Error('docker-session-ended')
            data = await desktop(method, { ...input, owner: owner() })
            if (method === 'terminal.close') sessions.delete(String(input.container))
            break
          }
          case 'service.open': {
            const item = container(input.id), port = Number(input.port)
            if (!item.ports.some(item => item.port === port && item.protocol === 'tcp')) throw new Error('docker-port-unavailable')
            await desktop('service.open', { url: `http://127.0.0.1:${port}/` }); break
          }
          case 'desktop.open': await desktop('docker.open', {}); break
          default: throw new Error('docker-unknown-method')
        }
        return JSON.parse(JSON.stringify({ ok: true, data })) as JsonValue
      } catch (cause) { return { ok: false, error: message(cause) } }
    },
    async releaseContext(owner) { for (const follow of follows.values()) if (follow.owner === owner) endFollow(follow.id) },
    async stop() { stopped = true; abort.abort(); managed.stop(); for (const id of follows.keys()) endFollow(id); for (const id of sessions.values()) await desktop('terminal.end', { id }).catch(() => {}); sessions.clear() },
  }
}
function message(cause: unknown): string { return (cause instanceof Error ? cause.message : String(cause)).slice(0, 1000) }
