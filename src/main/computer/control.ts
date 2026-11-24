// Note: .agents/notes/desktop/browser-computer-use.md
import { app } from 'electron'
import { localPlatform } from '../platform/local-platform'
import { runProcess } from '../platform/process-host'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { configService } from '../config/service'
import { computerTools } from './tools'
import type { ComputerActivity, ComputerPermission, ControlStatus } from '../../shared/ipc/control'

const bundleExecutable = '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
export function computerExecutable(custom: string) {
  return custom || (localPlatform() === 'darwin' && existsSync(bundleExecutable) ? bundleExecutable : 'cua-driver')
}
interface DesktopWindow { pid: number; window_id: number; app_name: string; title: string }
interface Turn {
  signal: AbortController
  owner: string
  session: string
  windows: Map<string, DesktopWindow>
  window?: DesktopWindow
  elements: Set<string>
  capture?: { id: string; width: number; height: number }
}
const windowsSchema = z.array(z.object({ pid: z.number().int(), window_id: z.number().int(), app_name: z.string(), title: z.string().nullish() }))
const keyOf = (win: DesktopWindow) => win.pid + '/' + win.window_id
const turns = new Map<string, Turn>()
let queue: Promise<unknown> = Promise.resolve()
let runtime: { executable: string; client: Client; ready: Promise<Client> } | undefined
let generation = 0
let updating = 0

export function computerActivities(): ComputerActivity[] {
  return [...turns].flatMap(([runId, t]) => t.window ? [{ runId, owner: t.owner, target: [t.window.app_name, t.window.title].filter(Boolean).join(' · ') }] : [])
}
export function endComputerTurn(runId: string) {
  const turn = turns.get(runId)
  turns.delete(runId)
  turn?.signal.abort(new Error('Computer control stopped. Start a new turn or reconnect.'))
}
export function resetComputer() {
  generation++
  for (const id of turns.keys()) endComputerTurn(id)
  const old = runtime
  runtime = undefined
  if (old) void old.ready.then(client => client.close()).catch(() => {})
}
export async function updateComputerConfiguration<T>(save: () => Promise<T>) {
  updating++
  resetComputer()
  try { return await save() } finally { updating-- }
}
function connection(executable: string) {
  if (runtime?.executable === executable) return runtime.ready
  const client = new Client({ name: 'janusx-computer', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: executable, args: ['mcp'], stderr: 'ignore' })
  const ready = client.connect(transport, { timeout: 7000 }).then(() => client).catch(async error => {
    if (runtime?.client === client) runtime = undefined
    await client.close().catch(() => {})
    throw error
  })
  runtime = { executable, client, ready }
  client.onclose = () => { if (runtime?.client === client) resetComputer() }
  return ready
}
async function invoke(client: Client, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 15000 }) as CallToolResult
  signal?.throwIfAborted()
  if (result.isError) throw new Error(result.content.filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0,1000) || 'Desktop action failed')
  return result
}
class PermissionError extends Error {
  constructor(readonly missing: ComputerPermission[]) { super('CuaDriver · ' + missing.map(p => p === 'accessibility' ? 'Accessibility' : 'Screen Recording').join(' / ')) }
}
function parsePermissionReport(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}
function checkMacPermissions(p: Record<string, unknown> | undefined) {
  const missing: ComputerPermission[] = []
  if (p?.accessibility !== true) missing.push('accessibility')
  if (p?.screen_recording !== true) missing.push('screenRecording')
  if (missing.length) throw new PermissionError(missing)
}
async function readyClient() {
  const stamp = generation
  const { computer } = await configService.getControlSettings()
  if (!computer.enabled || updating || generation !== stamp) throw new Error('Computer control is disabled or its configuration changed')
  const executable = computerExecutable(computer.executable)
  try {
    const client = await connection(executable)
    const result = await invoke(client, 'check_permissions', {})
    if (localPlatform() === 'darwin') checkMacPermissions(result.structuredContent)
    if (generation !== stamp || updating) throw new Error('Computer control configuration changed')
    return client
  } catch (error) {
    if (generation === stamp) for (const id of turns.keys()) endComputerTurn(id)
    // A gated macOS daemon may refuse even its MCP permission query.
    if (localPlatform() === 'darwin' && !(error instanceof PermissionError) && generation === stamp && !updating) {
      const probe = await runProcess(executable, ['permissions', 'status', '--json'], { timeoutMs: 5000, maxOutputBytes: 16384 })
      if (probe.exitCode === 0) {
        const permissions = z.object({ accessibility: z.boolean(), screen_recording: z.boolean() }).safeParse(parsePermissionReport(probe.stdout))
        if (permissions.success) checkMacPermissions(permissions.data)
      }
    }
    throw error
  }
}
export async function computerStatus(): Promise<ControlStatus['computer']> {
  const { computer } = await configService.getControlSettings()
  const base = { provider: 'cua-driver' as const, configured: !!computer.executable, connected: false }
  if (!computer.enabled) return base
  try { await readyClient(); return { ...base, connected: true } }
  catch (e) { return { ...base, error: e instanceof Error ? e.message : String(e), missingPermissions: e instanceof PermissionError ? e.missing : undefined } }
}
export async function beginComputerTurn(runId: string, owner: string) {
  const stamp = generation
  await readyClient()
  if (stamp !== generation || updating) throw new Error('Computer control configuration changed')
  turns.set(runId, { owner, signal: new AbortController(), session: randomUUID(), windows: new Map(), elements: new Set() })
}
export function computerTurnSignal(id: string) {
  const turn = turns.get(id)
  if (!turn) throw new Error('Computer control stopped. Start a new turn or reconnect.')
  return turn.signal.signal
}
export function callComputer(runId: string, name: string, input: Record<string, unknown>, callerSignal: AbortSignal) {
  const turn = turns.get(runId)
  if (!turn) throw new Error('Computer control stopped. Start a new turn or reconnect.')
  const signal = AbortSignal.any([turn.signal.signal, callerSignal])
  const action = queue.then(async () => {
    signal.throwIfAborted()
    const def = computerTools.find(d => d.tool.name === name)
    if (!def) throw new Error('Unknown computer tool')
    def.schema.parse(input)
    const client = await readyClient()
    signal.throwIfAborted()
    const call = (tool: string, args: Record<string, unknown>) => invoke(client, tool, { ...args, session: turn.session }, signal)
    if (name === 'list_windows') {
      const result = await call('list_windows', { app: input.app })
      turn.windows.clear()
      for (const item of windowsSchema.parse(result.structuredContent?.windows)) {
        if (item.pid === process.pid) continue
        const win = { ...item, title: item.title ?? '' }
        const held = [...turns.values()].some(other => other !== turn && other.window && keyOf(other.window) === keyOf(win))
        if (!held) turn.windows.set(keyOf(win), win)
      }
      return [...turn.windows].map(([window, w]) => ({ window, app: w.app_name, title: w.title }))
    }
    if (name === 'select_window') {
      const win = turn.windows.get(String(input.window))
      if (!win || [...turns.values()].some(other => other !== turn && other.window && keyOf(other.window) === keyOf(win))) throw new Error('List available windows again')
      turn.window = win
      turn.elements.clear(); turn.capture = undefined
      return { app: win.app_name, title: win.title }
    }
    if (!turn.window) throw new Error('Select a window first')
    const { pid, window_id } = turn.window
    const target = { pid, window_id }
    if (name === 'read_window' || name === 'screenshot') {
      const screenshot = name === 'screenshot'
      const result = await call('get_window_state', { ...target, tree_format: 'elements', include_screenshot: screenshot })
      const info = result.structuredContent
      const elements = z.array(z.object({ element_token: z.string() }).passthrough()).parse(info?.elements)
      turn.elements = new Set(elements.map(e => e.element_token))
      turn.capture = undefined
      if (!screenshot) return { title: info?.window_title, elements }
      const image = result.content.find(b => b.type === 'image')
      if (!image || typeof info?.capture_id !== 'string') throw new Error('Window screenshot unavailable')
      const directory = join(app.getPath('userData'), 'janusx', 'computer-control', 'screenshots')
      await mkdir(directory, { recursive: true })
      signal.throwIfAborted()
      const path = join(directory, randomUUID() + (image.mimeType === 'image/jpeg' ? '.jpg' : '.png'))
      await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 })
      signal.throwIfAborted()
      turn.capture = { id: info.capture_id, width: Number(info.screenshot_width), height: Number(info.screenshot_height) }
      return { path, capture: turn.capture.id, width: turn.capture.width, height: turn.capture.height }
    }
    const args: Record<string, unknown> = { ...target, delivery_mode: 'background' }
    if (name === 'click_at') {
      const cap = turn.capture
      if (!cap || input.capture !== cap.id || Number(input.x) >= cap.width || Number(input.y) >= cap.height) throw new Error('Get a fresh window screenshot')
      Object.assign(args, { x: input.x, y: input.y, capture_id: cap.id })
    } else {
      if (!turn.elements.has(String(input.element))) throw new Error('Read the selected window for a fresh element token')
      args.element_token = input.element
      if (name === 'press_key') args.key = input.key
      if (name === 'type_text') args.text = input.text
    }
    turn.elements.clear(); turn.capture = undefined
    const result = await call(name === 'click_at' ? 'click' : name, args)
    return result.structuredContent ?? result.content.filter(b => b.type === 'text')
  })
  queue = action.catch(() => {})
  return action
}
