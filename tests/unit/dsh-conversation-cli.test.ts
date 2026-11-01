import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { writeFile, mkdir, symlink, cp, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import pty from 'node-pty'
import { DshConversation } from '../../src/main/terminal/extension-conversation'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'

const binary = process.env.JANUSX_TEST_DSH_BIN
describe.skipIf(!binary || process.platform !== 'win32')('DSH native dual mode', () => {
  it('observes the native TUI agent and submits and cancels in the same session', async () => {
    const f = await nativeConversationFixture()
    f.env.DSH_HOME = join(f.root, 'dsh'); f.env.DSH_TELEMETRY_DISABLED = '1'
    f.env.DEEPSEEK_API_KEY = 'fixture'; f.env.DEEPSEEK_BASE_URL = f.url
    const profile = join(f.env.DSH_HOME, 'profiles/dsh-tui')
    await mkdir(join(profile, 'node_modules/@deepseek-harness-tui'), { recursive: true })
    const tui = join(dirname(binary!), 'node_modules/@deepseek-harness-tui/dsh-tui')
    const installed = join(profile, 'node_modules/@deepseek-harness-tui/dsh-tui')
    await mkdir(installed)
    for (const file of await readdir(tui)) if (file !== 'node_modules') await cp(join(tui, file), join(installed, file), { recursive: true })
    // Assemble only this disposable profile's dependencies; never repair the user's global install in a test.
    for (const name of await readdir(join(tui, 'node_modules'))) {
      if (name === '.bin' || name === '@deepseek-ai' || name === '@deepseek-harness-tui') continue
      await symlink(join(tui, 'node_modules', name), join(profile, 'node_modules', name), 'junction')
    }
    await symlink(join(dirname(binary!), 'node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'), join(profile, 'node_modules/@deepseek-ai'), 'junction')
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: { '@deepseek-harness-tui/dsh-tui': '0.12.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'] } } }))
    await writeFile(join(profile, 'cordis.yml'), '[]')
    const mock = join(f.root, 'model.mjs')
    await writeFile(mock, `export const inject=['llm']; export function apply(ctx){ctx.on('llm/stream', options => (async function*(){
      const marker=JSON.stringify(options.messages).match(/NATIVE_[A-Z]+/g)?.at(-1)??'OTHER';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'First '+marker};
      await new Promise(r=>setTimeout(r,marker==='NATIVE_CANCEL'?3000:300));
      if(options.signal?.aborted)throw options.signal.reason;
      yield {type:'text-delta',index:0,text:' final'};yield {type:'block-end',index:0};yield {type:'finish',reason:'stop'};
    })())}`)
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'fixture-model', name: pathToFileURL(mock).href }] }]))
    const c = new DshConversation('dsh-test', () => {})
    let terminal: pty.IPty | undefined, output = ''
    const wait = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 25000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(c.snapshot())}\n${output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-4000)}`); await new Promise(r => setTimeout(r, 50)) }
    }
    try {
      const launch = await c.start({ command: binary!, args: ['--profile', 'dsh-tui'], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
      terminal = pty.spawn(process.execPath, [join(dirname(binary!), 'node_modules/@deepseek-ai/dsh/lib/bin.js'), ...launch.args], { cwd: f.cwd, env: f.env as Record<string, string>, cols: 120, rows: 35 })
      terminal.onData(data => { output += data })
      await wait(() => c.state.connection === 'ready', 'ready')
      await new Promise(r => setTimeout(r, 1000))
      terminal.write('\x1b'); await new Promise(r => setTimeout(r, 700))
      terminal.write('NATIVE_FIRST'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
      const done = (text: string) => wait(() => !c.state.turnId && c.state.items.some(i => i.text.includes(`${text} final`)), text)
      await done('NATIVE_FIRST')
      const session = c.state.threadId
      await c.command({ type: 'mode', mode: 'conversation' })
      const send = (text: string) => c.command({ type: 'send', text, commandId: text, controlEpoch: c.state.controlEpoch })
      await send('NATIVE_SECOND'); await send('NATIVE_SECOND'); await done('NATIVE_SECOND')
      expect(c.state.items.filter(i => i.type === 'userMessage' && i.text === 'NATIVE_SECOND')).toHaveLength(1)
      expect(c.state.threadId).toBe(session)
      await send('NATIVE_CANCEL'); await wait(() => c.state.items.some(i => i.type === 'agentMessage' && i.text.includes('NATIVE_CANCEL')), 'cancel started')
      await c.command({ type: 'interrupt', controlEpoch: c.state.controlEpoch }); await wait(() => !c.state.turnId, 'cancel settled')
      expect(c.state.items.some(i => i.status === 'interrupted')).toBe(true)
    } finally { terminal?.kill(); await c.dispose(); f.close() }
  })
})
