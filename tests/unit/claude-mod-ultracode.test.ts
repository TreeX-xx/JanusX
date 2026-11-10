import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'

async function fixture() {
  const source = readFileSync('src/main/terminal/claude-mod.js', 'utf8')
    .replace("import { endpoint, token, terminalId } from './connection.js'", "const endpoint = '', token = '', terminalId = 'fixture'")
    .replace('export function register', 'function register')
  const context: any = {}
  runInNewContext(source + '\nglobalThis.runCommand = execute; globalThis.receipt = id => executions.get(id); globalThis.readEvents = () => events;', context)
  const hooks = new Map<string, any>()
  context.register((name: string, ...args: any[]) => hooks.set(name, args.at(-1)))
  let enabled = false, available = true, unconfirmed = false, loseAfterToggle = false
  const messages: any[] = []
  const env = new Map([['CLAUDE_CODE_EFFORT_LEVEL', 'high']])
  const $: any = {
    session: { id: async () => 's', model: async () => 'opus', messages: async () => [...messages] },
    config: { list: async () => [] }, settings: { read: async () => ({}) },
    env: { get: async (key: string) => env.get(key), set: vi.fn(async (key: string, value: string) => { env.set(key, value); return {} }) },
    clock: { every: () => {} }, ui: { invalidate: () => {} },
    command: { run: vi.fn(async (args: { command: string; args: string }) => hooks.get('command.run')($, args, async () => {
      let text = ''
      if (args.args === 'help') text = `Usage: /effort [low|medium|high|xhigh|max|auto${available ? '|ultracode [on|off]' : ''}]`
      else if (args.args === 'status') text = `Current effort level: ${env.get('CLAUDE_CODE_EFFORT_LEVEL')} (description)${enabled ? ' · Ultracode on' : ''}`
      else if (args.args === 'ultracode on' && available) { enabled = true; text = 'Ultracode on. Effort stays medium.'; if (loseAfterToggle) unconfirmed = true }
      else if (args.args === 'ultracode off') { enabled = false; text = 'Ultracode off. Effort stays medium.' }
      messages.push({ role: 'user', text: `<command-name>/effort</command-name>\n<command-args>${args.args}</command-args>` },
        { role: unconfirmed ? 'assistant' : 'user', text: `<local-command-stdout>${text}</local-command-stdout>` })
      return {}
    })) },
  }
  await hooks.get('session.start')($, {}, async () => ({}))
  const run = async (command: object) => {
    await context.runCommand($, { id: 'test', ...command })
    return context.receipt('test')
  }
  return { $, env, run, events: context.readEvents, available: (value: boolean) => { available = value }, unconfirmed: () => { unconfirmed = true }, loseAfterToggle: () => { loseAfterToggle = true } }
}

it('runs session-only native toggles without releasing the JanusX effort override', async () => {
  const f = await fixture()
  expect((await f.run({ type: 'settings', model: 'opus', effort: 'medium' })).ok).toBe(true)
  f.$.env.set.mockClear()
  for (const enabled of [true, false]) {
    expect((await f.run({ type: 'ultracode', enabled })).ok).toBe(true)
    expect(f.events().at(-1)).toMatchObject({ type: 'ultracode', data: { enabled, available: true, model: 'opus' } })
    expect(f.env.get('CLAUDE_CODE_EFFORT_LEVEL')).toBe('medium')
  }
  expect(f.$.env.set).not.toHaveBeenCalled()
  expect(f.events().some((e: any) => e.type === 'native.settings')).toBe(false)
})

it('rejects disabled workflows and never accepts assistant text as native confirmation', async () => {
  const f = await fixture()
  f.available(false)
  expect(await f.run({ type: 'ultracode', enabled: true })).toMatchObject({ ok: false, error: expect.stringContaining('supported native session model') })
  expect(f.$.command.run.mock.calls.some(([cmd]: any[]) => cmd.args === 'ultracode on')).toBe(false)
  f.available(true); f.unconfirmed()
  expect(await f.run({ type: 'ultracode', enabled: true })).toMatchObject({ ok: false, error: expect.stringContaining('did not confirm') })
  expect(f.events().some((e: any) => e.type === 'ultracode' && e.data.enabled)).toBe(false)
})

it('invalidates the old state if a dispatched toggle cannot be confirmed', async () => {
  const f = await fixture()
  f.loseAfterToggle()
  expect(await f.run({ type: 'ultracode', enabled: true })).toMatchObject({ ok: false, error: expect.stringContaining('did not confirm') })
  expect(f.events().at(-1)).toMatchObject({ type: 'ultracode', data: {} })
})
