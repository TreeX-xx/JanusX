import { describe, it, expect } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pty from 'node-pty'
import { OpenCodeConversation } from '../../src/main/terminal/opencode-conversation'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'

const binary = process.env.JANUSX_TEST_OPENCODE_BIN
describe.skipIf(!binary || process.platform !== 'win32')('OpenCode native dual mode', () => {
  it('shares terminal and dialog prompts and cancels through the owned service', async () => {
    const f = await nativeConversationFixture()
    f.env.OPENCODE_TEST_HOME = f.root
    f.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1'
    await mkdir(join(f.cwd, '.opencode/commands/team'), { recursive: true })
    await writeFile(join(f.cwd, '.opencode/commands/team/review.md'), ['---', 'description: Test command', '---', 'NATIVE_COMMAND $ARGUMENTS'].join('\n'))
    await mkdir(join(f.cwd, '.opencode/skills/native-skill'), { recursive: true })
    await writeFile(join(f.cwd, '.opencode/skills/native-skill/SKILL.md'), ['---', 'name: native-skill', 'description: Test skill', '---', 'OPENCODE_SKILL_BODY_MARKER'].join('\n'))
    f.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'fixture/fixture', update: 'disable', share: 'disabled', snapshots: false,
      providers: { fixture: { package: '@ai-sdk/openai-compatible', settings: { baseURL: f.url, apiKey: 'fixture' }, models: {
        fixture: { limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false } },
        deep: { name: 'Fixture Deep', limit: { context: 32000, output: 1000 }, capabilities: { input: ['text'], output: ['text'], tools: false },
          variants: [{ id: 'careful', settings: { reasoningEffort: 'high' }, body: { reasoning_effort: 'high' } }] },
      } } } })
    const c = new OpenCodeConversation('oc-test', () => {})
    let terminal: pty.IPty | undefined, output = ''
    const wait = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 20000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(c.snapshot())}\n${output.slice(-3000)}`); await new Promise(r => setTimeout(r, 50)) }
    }
    try {
      const launch = await c.start({ command: binary!, args: [], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
      terminal = pty.spawn(launch.command, launch.args, { cwd: f.cwd, env: { ...f.env, ...launch.env } as Record<string, string>, cols: 120, rows: 35 })
      terminal.onData(data => { output += data })
      await wait(() => output.includes('fixture'), 'native ready')
      await new Promise(r => setTimeout(r, 700))
      terminal.write('NATIVE_FIRST'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
      const done = (text: string) => wait(() => !c.state.turnId && c.state.items.some(i => i.text.includes(`${text} final`)), text)
      await done('NATIVE_FIRST')
      const session = c.state.threadId
      await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'models', controlEpoch: c.state.controlEpoch })
      expect(c.state.models.find(m => m.model === 'fixture/deep')?.efforts.map(v => v.effort)).toEqual(['default', 'careful'])
      const count = f.requests.length
      await c.command({ type: 'settings', model: 'fixture/deep', effort: 'careful', controlEpoch: c.state.controlEpoch })
      expect(c.state).toMatchObject({ model: 'fixture/deep', effort: 'careful', threadId: session })
      expect(f.requests).toHaveLength(count)
      const endpoint = launch.args[launch.args.indexOf('--server') + 1]
      const nativeSettings = () => fetch(`${endpoint}/api/session/${session}/model`, { method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`opencode:${launch.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { providerID: 'fixture', id: 'fixture' } }) })
      expect((await nativeSettings()).status).toBe(409)
      await c.command({ type: 'commands', controlEpoch: c.state.controlEpoch })
      const entry = c.state.commands?.find(value => value.name === 'team/review')
      expect(entry?.execution).toBe('native')
      await c.command({ type: 'invoke', entryId: entry!.id, arguments: 'ARGUMENT_OK', catalogRevision: c.state.commandsRevision!, commandId: 'command', controlEpoch: c.state.controlEpoch })
      await done('NATIVE_COMMAND')
      expect(f.requestBodies.some(body => JSON.stringify(body.messages).includes('NATIVE_COMMAND ARGUMENT_OK'))).toBe(true)
      const skill = c.state.commands?.find(value => value.kind === 'skill' && value.name === 'native-skill')
      expect(skill?.execution).toBe('native')
      await c.command({ type: 'invoke', entryId: skill!.id, arguments: 'NATIVE_SKILL', catalogRevision: c.state.commandsRevision!, commandId: 'skill', controlEpoch: c.state.controlEpoch })
      await done('NATIVE_SKILL')
      expect(f.requestBodies.some(body => JSON.stringify(body.messages).includes('OPENCODE_SKILL_BODY_MARKER'))).toBe(true)
      const send = (text: string) => c.command({ type: 'send', text, commandId: text, controlEpoch: c.state.controlEpoch })
      await send('NATIVE_SECOND'); await send('NATIVE_SECOND'); await done('NATIVE_SECOND')
      expect(c.state).toMatchObject({ model: 'fixture/deep', effort: 'careful' })
      expect(f.requests.filter(r => r === 'NATIVE_SECOND')).toHaveLength(1)
      expect(f.requestBodies.find(b => JSON.stringify(b.messages).includes('NATIVE_SECOND'))).toMatchObject({ model: 'deep', reasoning_effort: 'high' })
      expect(c.state.threadId).toBe(session)
      await send('NATIVE_LIVE')
      await wait(() => f.requests.includes('NATIVE_LIVE') && !!c.state.turnId, 'live request active')
      expect(c.state.turnId).toBeTruthy()
      await send('NATIVE_STEER'); await send('NATIVE_EXTRA')
      expect(f.completedRequests).not.toContain('NATIVE_LIVE')
      await wait(() => f.requestBodies.some(body => JSON.stringify(body.messages).includes('NATIVE_STEER') && JSON.stringify(body.messages).includes('NATIVE_EXTRA')), 'live inputs consumed')
      await done('NATIVE_EXTRA')
      expect(c.state.items.filter(item => item.type === 'userMessage').map(item => item.text)).toEqual(expect.arrayContaining(['NATIVE_STEER', 'NATIVE_EXTRA']))
      expect(c.state).toMatchObject({ threadId: session, connection: 'ready' })
      await send('NATIVE_CANCEL'); await wait(() => f.requests.includes('NATIVE_CANCEL'), 'cancel started')
      await c.command({ type: 'interrupt', controlEpoch: c.state.controlEpoch }); await wait(() => !c.state.turnId, 'cancel settled')
      await c.command({ type: 'mode', mode: 'terminal' })
      terminal.write('NATIVE_RETURN'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
      await done('NATIVE_RETURN')
      expect(f.requestBodies.find(b => JSON.stringify(b.messages).includes('NATIVE_RETURN'))).toMatchObject({ model: 'deep', reasoning_effort: 'high' })
      // Exercise the same native endpoint used by the TUI, then let polling synchronize the dialog.
      const response = await nativeSettings()
      expect(response.status).toBe(204)
      await wait(() => c.state.model === 'fixture/fixture' && c.state.effort === 'default', 'native settings synchronized')
    } finally { terminal?.kill(); await c.dispose(); f.close() }
  })
})
