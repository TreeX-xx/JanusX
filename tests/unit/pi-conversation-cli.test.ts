import { describe, it, expect } from 'vitest'
import { join, dirname } from 'node:path'
import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises'
import pty from 'node-pty'
import { PiConversation } from '../../src/main/terminal/extension-conversation'
import { nativeConversationFixture } from '../helpers/native-conversation-fixture'
import { PNG_PIXEL } from '../helpers/image-fixture'

const binary = process.env.JANUSX_TEST_PI_BIN
describe.skipIf(!binary || process.platform !== 'win32')('Pi native dual mode', () => {
  it('shares terminal and dialog turns, streams, deduplicates and cancels', async () => {
    const f = await nativeConversationFixture({ imageTool: true })
    await mkdir(join(f.config, 'bin'))
    for (const name of ['fd.exe', 'rg.exe']) await copyFile(join(process.env.USERPROFILE!, '.pi/agent/bin', name), join(f.config, 'bin', name))
    await writeFile(join(f.config, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: f.url, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture', contextWindow: 32000, maxTokens: 1000 }] } } }))
    const extension = join(f.root, 'probe-extension.mjs')
    const marker = join(f.root, 'command.txt')
    await writeFile(extension, 'import {writeFile} from "node:fs/promises";export default pi=>{pi.registerCommand("probe-local",{description:"Local command",handler:async args=>{await writeFile(' + JSON.stringify(marker) + ',args)}});pi.registerTool({name:"fixture_image",label:"Fixture image",description:"Return a local test image",parameters:{type:"object",properties:{}},execute:async()=>({content:[{type:"image",mimeType:"image/png",data:' + JSON.stringify(PNG_PIXEL) + '}],details:{}})})}')
    const snapshots: ReturnType<PiConversation['snapshot']>[] = []
    const c = new PiConversation('pi-test', s => snapshots.push(s))
    let terminal: pty.IPty | undefined, output = ''
    const wait = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 20000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(c.snapshot())}\n${output.slice(-3000)}`); await new Promise(r => setTimeout(r, 50)) }
    }
    try {
      const launch = await c.start({ command: binary!, args: ['--provider', 'fixture', '--model', 'fixture', '--no-skills', '--no-prompt-templates', '--no-themes', '--extension', extension], cwd: f.cwd, env: f.env, assetsDir: join(f.root, 'assets') })
      // npm's shim is not directly executable by ConPTY; use the same package's entry.
      terminal = pty.spawn(process.execPath, [join(dirname(binary!), 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'), ...launch.args], { cwd: f.cwd, env: f.env as Record<string, string>, cols: 120, rows: 35 })
      terminal.onData(data => { output += data })
      await wait(() => c.state.connection === 'ready', 'ready')
      await new Promise(r => setTimeout(r, 700))
      terminal.write('NATIVE_FIRST'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
      const done = (text: string) => wait(() => !c.state.turnId && c.state.items.some(i => i.text.includes(`${text} final`)), text)
      await done('NATIVE_FIRST')
      const session = c.state.threadId
      await c.command({ type: 'mode', mode: 'conversation' })
      await c.command({ type: 'commands', controlEpoch: c.state.controlEpoch })
      const local = c.state.commands?.find(entry => entry.name === 'probe-local')
      expect(local?.execution).toBe('native')
      const beforeCommand = f.requests.length
      await c.command({ type: 'invoke', entryId: local!.id, arguments: 'LOCAL_COMMAND_OK', catalogRevision: c.state.commandsRevision!, commandId: 'local-command', controlEpoch: c.state.controlEpoch })
      expect(await readFile(marker, 'utf8')).toBe('LOCAL_COMMAND_OK')
      expect(f.requests).toHaveLength(beforeCommand)
      expect(c.state.commandReceipts?.at(-1)).toEqual({ id: 'local-command', status: 'accepted' })
      const send = (text: string) => c.command({ type: 'send', text, commandId: text, controlEpoch: c.state.controlEpoch })
      await send('NATIVE_IMAGE')
      await wait(() => c.state.items.some(item => item.images?.[0].status === 'ready'), 'native tool image')
      const image = c.state.items.find(item => item.images?.[0].status === 'ready')!.images![0]
      expect((await readFile(image.path!)).toString('base64')).toBe(PNG_PIXEL)
      expect(JSON.stringify(c.snapshot())).not.toContain(PNG_PIXEL)
      await wait(() => !c.state.turnId, 'image turn completed')
      await send('NATIVE_SECOND'); await send('NATIVE_SECOND'); await done('NATIVE_SECOND')
      expect(f.requests.filter(r => r === 'NATIVE_SECOND')).toHaveLength(1)
      expect(c.state.threadId).toBe(session)
      expect(snapshots.some(s => s.items.some(i => i.type === 'agentMessage' && i.status === 'inProgress' && i.text.includes('NATIVE_SECOND')))).toBe(true)
      await send('NATIVE_CANCEL'); await wait(() => f.requests.includes('NATIVE_CANCEL'), 'cancel started')
      await c.command({ type: 'interrupt', controlEpoch: c.state.controlEpoch }); await wait(() => !c.state.turnId, 'cancel settled')
      expect(c.state.items.some(i => i.status === 'interrupted')).toBe(true)
      await c.command({ type: 'mode', mode: 'terminal' })
      terminal.write('NATIVE_RETURN'); await new Promise(r => setTimeout(r, 100)); terminal.write('\r')
      await done('NATIVE_RETURN')
    } finally { terminal?.kill(); await c.dispose(); f.close() }
  })
})
