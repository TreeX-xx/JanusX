import { it, describe, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import pty from 'node-pty'
import { ClaudeConversation } from '../../src/main/terminal/claude-conversation'
import { claudeConversationFixture } from '../helpers/claude-conversation-fixture'
import type { ConversationSnapshot } from '../../src/shared/conversation-display'
import { conversationOutputGroups } from '../../src/shared/conversation-output'

const binary = process.env.JANUSX_TEST_CLAUDE_BIN
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
describe.skipIf(!binary || process.platform !== 'win32')('managed Claude native dialog', () => {
  it('streams interleaved commentary and tools through the native Mods bridge before the final answer', async () => {
    const fixture = await claudeConversationFixture()
    const snapshots: ConversationSnapshot[] = []
    const main = new ClaudeConversation('claude-stages', snapshot => snapshots.push(snapshot))
    const stepEvents: unknown[] = []
    const wire = main as any
    const receive = wire.receive.bind(main)
    wire.receive = (event: any) => { if (event.type === 'step.complete') stepEvents.push(event.data); receive(event) }
    let stagedState: ConversationSnapshot | undefined
    let setup: pty.IPty | undefined, exited = false, output = ''
    const until = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 20000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(main.snapshot())}\n${output.slice(-1000)}`); await delay(50) }
    }
    const clean = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    try {
      setup = pty.spawn(binary!, ['--model', 'claude-sonnet-4-6', '--tools', ''], { cwd: fixture.cwd, env: fixture.env as Record<string, string>, cols: 130, rows: 36 })
      setup.onData(data => { output += data }); setup.onExit(() => { exited = true })
      await until(() => output.includes('trust'), 'trust'); await delay(1200)
      setup.write('\x1b[B'); await delay(200); setup.write('\r'); await delay(1500)
      await until(() => clean().includes('DoyouwanttousethisAPIkey'), 'key')
      setup.write('\x1b[A'); await delay(200); setup.write('\r')
      await until(() => clean().includes('Sonnet4.6'), 'ready'); await delay(500)
      await promisify(execFile)('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true })
      await until(() => exited, 'setup exit')
      await main.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', 'Read', '--allowedTools', 'Read', '--permission-mode', 'manual'],
        cwd: fixture.cwd, env: fixture.env, assetsDir: join(fixture.root, 'assets') })
      await main.command({ type: 'mode', mode: 'conversation' })
      await main.command({ type: 'send', text: 'CC_STAGES', commandId: 'stages', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId && main.state.items.some(item => item.text === 'Both checks finished.'), 'staged answer')
      expect(fixture.requests.filter(request => request.stream)).toHaveLength(3)
      expect(main.state.items.map(item => item.type)).toEqual(['userMessage', 'agentMessage', 'commandExecution', 'agentMessage', 'commandExecution', 'agentMessage'])
      expect(main.state.items.filter(item => item.type === 'agentMessage').map(item => item.text)).toEqual(['Inspecting the first file.', 'Found the first result. Checking again.', 'Both checks finished.'])
      expect(main.state.items.filter(item => item.type === 'commandExecution').every(item => item.activity?.includes('stages.txt') && item.status === 'completed')).toBe(true)
      for (const partial of ['Inspecting ', 'Found the first result. ', 'Both checks ']) {
        expect(snapshots.some(snapshot => snapshot.turnId && snapshot.items.some(item => item.text === partial && item.status === 'inProgress'))).toBe(true)
      }
      expect(snapshots.some(snapshot => snapshot.turnId && snapshot.items.some(item => item.text === 'Found the first result. ') && snapshot.items.some(item => item.text === 'Inspecting the first file.' && item.status === 'completed'))).toBe(true)
      expect(conversationOutputGroups(main.state.items, null).map(group => group.process)).toEqual([false, false, true, false, true, false])
      stagedState = main.snapshot()
      await main.command({ type: 'send', text: 'CC_CANCEL', commandId: 'cancel-stage', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.items.some(item => item.text === 'First CC_CANCEL'), 'partial before interrupt')
      await main.command({ type: 'interrupt', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId, 'interrupted turn ends')
      expect(main.state.items.find(item => item.text === 'First CC_CANCEL')?.status).toBe('interrupted')
      expect(main.state.items.filter(item => item.turnId === stagedState!.items[0].turnId).every(item => item.status === 'completed')).toBe(true)
      await main.command({ type: 'send', text: 'CC_AFTER_STOP', commandId: 'after-stop', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId && main.state.items.some(item => item.text === 'First CC_AFTER_STOP final'), 'continues after interruption')
      expect(main.state.threadId).toBe(stagedState.threadId)
    } finally {
      await mkdir('artifacts/claude-progress', { recursive: true })
      await writeFile('artifacts/claude-progress/native.json', JSON.stringify({ binary, stepEvents, state: stagedState ?? main.snapshot(), interruptedState: main.snapshot(), snapshots, requests: fixture.requests }, null, 2))
      await main.dispose()
      if (setup && !exited) await promisify(execFile)('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
      await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { env: fixture.env, cwd: fixture.cwd, windowsHide: true, timeout: 10000 }).catch(() => {})
      await fixture.close()
    }
  }, 90000)
  it('answers native questions with choices and custom text without an attached terminal', async () => {
    const fixture = await claudeConversationFixture()
    const main = new ClaudeConversation('claude-questions', () => {})
    let setup: pty.IPty | undefined, exited = false, output = ''
    const until = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 20000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(main.snapshot())}\n${output.slice(-1000)}`); await delay(50) }
    }
    const clean = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    try {
      setup = pty.spawn(binary!, ['--model', 'claude-sonnet-4-6', '--tools', ''], { cwd: fixture.cwd, env: fixture.env as Record<string, string>, cols: 130, rows: 36 })
      setup.onData(data => { output += data }); setup.onExit(() => { exited = true })
      await until(() => output.includes('trust'), 'trust'); await delay(1200)
      setup.write('\x1b[B'); await delay(200); setup.write('\r'); await delay(1500)
      await until(() => clean().includes('DoyouwanttousethisAPIkey'), 'key')
      setup.write('\x1b[A'); await delay(200); setup.write('\r')
      await until(() => clean().includes('Sonnet4.6'), 'ready'); await delay(500)
      await promisify(execFile)('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true })
      await until(() => exited, 'setup exit')
      await main.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', 'AskUserQuestion', '--permission-mode', 'manual'],
        cwd: fixture.cwd, env: { ...fixture.env, JANUSX_HOOK_TERMINAL_ID: main.id }, assetsDir: join(fixture.root, 'assets') })
      await main.command({ type: 'mode', mode: 'conversation' })
      await main.command({ type: 'send', text: 'CC_QUESTION', commandId: 'question', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.questions?.length === 1, 'question projected')
      // Human idle time must outlive both the 10s Mods budget and one 20s
      // long-poll renewal, without handing the unanswered request to the TUI.
      await delay(25000)
      const request = main.state.questions![0]
      expect(main.state.needsTerminal).toBe(false)
      await main.command({ type: 'answer', requestId: request.id, version: request.version, controlEpoch: main.state.controlEpoch,
        answer: { answers: [{ id: '0', selected: ['1'] }, { id: '1', selected: ['0', '1'] }, { id: '2', selected: [], text: '中文 notes from conversation' }] } })
      await until(() => !main.state.turnId && main.state.items.some(item => item.type === 'agentMessage' && item.text.includes('CC_QUESTION final')), 'native consumes answers')
      const result = fixture.requests.filter(r => r.marker === 'CC_QUESTION' && r.stream).at(-1)
      expect(JSON.stringify(result.messages)).toContain('中文 notes from conversation')
      expect(JSON.stringify(result.messages)).toContain('Unit, Browser')
      expect(main.state.questions).toEqual([])
      expect(main.state.items.filter(item => item.type === 'userMessage')).toHaveLength(1)
      // Cancelling a later request must not reuse the first answer or leave a
      // wait in the Mod alive after the native turn is interrupted.
      await main.command({ type: 'send', text: 'CC_QUESTION', commandId: 'question-cancel', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.questions?.length === 1, 'cancel question projected')
      await main.command({ type: 'interrupt', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId && !main.state.questions?.length, 'question interrupted')
      await main.command({ type: 'send', text: 'CC_QUESTION', commandId: 'question-native', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.questions?.length === 1, 'native handoff question projected')
      const stale = main.state.questions![0]
      await main.command({ type: 'mode', mode: 'terminal' })
      await until(() => !main.state.questions?.length && main.state.needsTerminal, 'native owns question')
      await main.command({ type: 'mode', mode: 'conversation' })
      await expect(main.command({ type: 'answer', requestId: stale.id, version: stale.version, controlEpoch: main.state.controlEpoch,
        answer: { cancelled: true, answers: [] } })).rejects.toThrow('expired')
      await main.command({ type: 'interrupt', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId, 'native question interrupted')
    } finally {
      await mkdir('artifacts/conversation-interactions', { recursive: true })
      await writeFile('artifacts/conversation-interactions/claude-native.json', JSON.stringify({ state: main.snapshot(), root: fixture.root, requests: fixture.requests }, null, 2))
      if (setup && !exited) setup.kill()
      await main.dispose(); await fixture.close()
    }
  }, 90000)
  it('settles real background work without an attached native transcript', async () => {
    const fixture = await claudeConversationFixture()
    const main = new ClaudeConversation('claude-background', () => {})
    let setup: pty.IPty | undefined
    let setupExited = false
    let output = ''
    const until = async (fn: () => boolean, label: string) => {
      const end = Date.now() + 20000
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(main.snapshot())}\n${output.slice(-1000)}`); await delay(50) }
    }
    const clean = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    try {
      setup = pty.spawn(binary!, ['--model', 'claude-sonnet-4-6', '--tools', ''], { cwd: fixture.cwd, env: fixture.env as Record<string, string>, cols: 130, rows: 36 })
      setup.onData(data => { output += data }); setup.onExit(() => { setupExited = true })
      await until(() => output.includes('trust'), 'native trust'); await delay(1200)
      setup.write('\x1b[B'); await delay(200); setup.write('\r'); await delay(1500)
      await until(() => clean().includes('DoyouwanttousethisAPIkey'), 'native API key')
      setup.write('\x1b[A'); await delay(200); setup.write('\r')
      await until(() => clean().includes('Sonnet4.6'), 'native ready'); await delay(500)
      // The setup TUI can still be showing a tip after login; close only this
      // fixture process once its isolated login/trust state has been persisted.
      await promisify(execFile)('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true })
      await until(() => setupExited, 'setup exits')
      await main.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', 'Bash,TaskStop', '--permission-mode', 'manual'],
        cwd: fixture.cwd, env: { ...fixture.env, JANUSX_HOOK_TERMINAL_ID: main.id }, assetsDir: join(fixture.root, 'assets') })
      await main.command({ type: 'mode', mode: 'conversation' })
      const session = main.state.threadId
      await main.command({ type: 'send', text: 'CC_BACKGROUND', commandId: 'background', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.approvals.length === 1, 'background approval')
      await main.command({ type: 'approve', requestId: main.state.approvals[0].id, decision: 'accept', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.items.some(item => item.type === 'commandExecution' && item.status === 'inProgress'), 'background starts')
      await until(() => !main.state.turnId && main.state.backgroundTasks === 0 && main.state.items.some(item => item.type === 'commandExecution' && item.status === 'completed'), 'background settles without UI')
      await main.command({ type: 'send', text: 'CC_TOOL', commandId: 'stop-running', controlEpoch: main.state.controlEpoch })
      await until(() => main.state.approvals.length === 1, 'foreground approval')
      await main.command({ type: 'approve', requestId: main.state.approvals[0].id, decision: 'accept', controlEpoch: main.state.controlEpoch })
      await until(() => existsSync(fixture.pidFile), 'foreground child starts')
      const child = JSON.parse(await readFile(fixture.pidFile, 'utf8'))
      await main.command({ type: 'interrupt', controlEpoch: main.state.controlEpoch })
      await until(() => { try { process.kill(child.pid, 0); return false } catch { return true } }, 'foreground child stops')
      await delay(Math.max(0, child.startedAt + 9500 - Date.now()))
      expect(existsSync(fixture.sideEffect)).toBe(false)
      await main.command({ type: 'send', text: 'CC_AFTER_STOP', commandId: 'continue', controlEpoch: main.state.controlEpoch })
      await until(() => !main.state.turnId && main.state.items.some(item => item.type === 'agentMessage' && item.text.includes('CC_AFTER_STOP') && item.status === 'completed'), 'next turn completes')
      expect(main.state.threadId).toBe(session)
      expect(main.state.backgroundTasks).toBe(0)
      expect(main.state.items.some(item => item.type === 'userMessage' && item.text.includes('<task-notification>'))).toBe(false)
    } finally {
      await mkdir('artifacts/claude-completion-fix', { recursive: true })
      await writeFile('artifacts/claude-completion-fix/native.json', JSON.stringify({ state: main.snapshot(), root: fixture.root }, null, 2))
      await main.dispose()
      if (setup && !setupExited) await promisify(execFile)('taskkill', ['/PID', String(setup.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
      await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { env: fixture.env, cwd: fixture.cwd, windowsHide: true, timeout: 10000 }).catch(() => {})
      await fixture.close()
    }
  }, 120000)

  it('streams, survives native Esc, approves, stops real Bash and closes only its own worker', async () => {
    const fixture = await claudeConversationFixture()
    await mkdir(join(fixture.cwd, '.claude/skills/native-review'), { recursive: true })
    await writeFile(join(fixture.cwd, '.claude/skills/native-review/SKILL.md'), ['---', 'name: native-review', 'description: Catalog-only test', '---', 'Never invoked by this test.'].join('\n'))
    const snapshots: any[] = []
    const main = new ClaudeConversation('claude-main', state => snapshots.push(state))
    const controls: any[] = []
    const originalCall = (main as any).call.bind(main)
    ;(main as any).call = async (command: any) => { const result = await originalCall(command); controls.push({ command, result }); return result }
    const other = new ClaudeConversation('claude-other', () => {})
    const terminals = new Set<pty.IPty>()
    let output = ''
    const clean = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\s/g, '')
    const until = async (fn: () => boolean, label: string, timeout = 15000) => {
      const end = Date.now() + timeout
      while (!fn()) { if (Date.now() > end) throw new Error(`${label}: ${JSON.stringify(main.snapshot())}\n${output.slice(-1500)}`); await delay(50) }
    }
    const spawn = (args: string[]) => {
      const terminal = pty.spawn(binary!, args, { cwd: fixture.cwd, env: fixture.env as Record<string, string>, cols: 130, rows: 36 })
      terminals.add(terminal); terminal.onExit(() => terminals.delete(terminal)); terminal.onData(data => { output += data }); return terminal
    }
    const sendNative = async (terminal: pty.IPty, text: string) => { terminal.write(text); await delay(150); terminal.write('\r') }
    const send = (text: string) => main.command({ type: 'send', text, commandId: text, controlEpoch: main.state.controlEpoch })
    const done = (text: string) => until(() => !main.state.turnId && main.state.items.some(item => item.type === 'agentMessage' && item.text.includes(text) && item.status === 'completed'), text)
    try {
      // Real native setup accepts only the newly generated fixture directory/key.
      const setup = spawn(['--model', 'claude-sonnet-4-6', '--tools', ''])
      await until(() => output.includes('trust'), 'native trust'); await delay(1200)
      setup.write('\x1b[B'); await delay(200); setup.write('\r'); await delay(1500)
      await until(() => clean().includes('DoyouwanttousethisAPIkey'), 'native API key')
      setup.write('\x1b[A'); await delay(200); setup.write('\r')
      await until(() => clean().includes('Sonnet4.6'), 'native ready'); await delay(500)
      await sendNative(setup, '/exit'); await delay(600)
      const start = (controller: ClaudeConversation, extra: string[] = [], env = {}) => controller.start({ command: binary!, args: ['--model', 'claude-sonnet-4-6', '--tools', 'Write,Bash,TaskStop,TaskCreate,TaskUpdate,TaskList', '--permission-mode', 'manual', ...extra],
        cwd: fixture.cwd, env: { ...fixture.env, ...env, JANUSX_HOOK_TERMINAL_ID: controller.id }, assetsDir: join(fixture.root, 'assets') })
      const launch = await start(main)
      expect(fixture.requests).toHaveLength(0)
      const session = main.state.threadId
      output = ''
      const terminal = spawn(launch.args)
      await until(() => clean().includes('forshortcuts'), 'attach ready'); await delay(700)
      await sendNative(terminal, 'CC_FIRST'); await done('CC_FIRST')
      expect(snapshots.some(state => state.items.some((item: any) => item.text === 'First CC_FIRST' && item.status === 'inProgress'))).toBe(true)
      await sendNative(terminal, 'CC_PLAN_CREATE'); await done('CC_PLAN_CREATE')
      expect(main.state.plans?.at(-1)).toMatchObject({ outcome: 'completed', steps: [{ step: 'Verify native todo', status: 'pending' }] })
      await main.command({ type: 'mode', mode: 'conversation' })
      const beforeCatalog = fixture.requests.length
      await main.command({ type: 'commands', controlEpoch: main.state.controlEpoch })
      expect(main.state.commands?.find(entry => entry.name === 'native-review')?.execution).toBe('terminal')
      expect(fixture.requests).toHaveLength(beforeCatalog)
      for (const [marker, status] of [['CC_PLAN_PROGRESS', 'inProgress'], ['CC_PLAN_MISSING', 'inProgress'], ['CC_PLAN_COMPLETE', 'completed'], ['CC_PLAN_DELETE', null]]) {
        await send(marker!); await done(marker!)
        expect(main.state.plans?.at(-1)?.steps).toEqual(status ? [{ step: 'Verify native todo', status }] : [])
      }
      expect(main.state.plans?.filter(plan => plan.steps.some(step => step.status === 'inProgress')).length).toBeGreaterThan(0)
      await send('CC_SECOND'); await send('CC_SECOND'); await done('CC_SECOND')
      expect(fixture.requests.filter(r => r.marker === 'CC_SECOND' && r.stream)).toHaveLength(1)
      expect(main.state.items.filter(item => item.type === 'userMessage' && item.text === 'CC_SECOND')).toHaveLength(1)
      await send('CC_CANCEL')
      await until(() => main.state.items.some(item => item.text === 'First CC_CANCEL'), 'live input partial')
      await send('CC_LIVE_FIRST'); await send('CC_LIVE_SECOND')
      expect(fixture.requests.find(request => request.marker === 'CC_CANCEL' && request.stream)?.finishedAt).toBe(0)
      await until(() => fixture.requests.some(request => request.stream && JSON.stringify(request.messages).includes('CC_LIVE_SECOND')), 'live input consumed', 20000)
      await until(() => !main.state.turnId, 'live input done', 20000)
      expect(main.state.items.filter(item => item.type === 'userMessage').map(item => item.text)).toEqual(expect.arrayContaining(['CC_LIVE_FIRST', 'CC_LIVE_SECOND']))
      expect(main.state.threadId).toBe(session)
      await until(() => main.state.models.length > 0, 'native model catalog')
      const userSettingsBefore = await readFile(join(fixture.config, 'settings.json'), 'utf8')
      for (const [name, effort] of [['Haiku', 'low'], ['Sonnet', 'high'], ['Opus', 'max']]) {
        const model = main.state.models.find(option => option.displayName === name)!
        expect(model.efforts.some(option => option.effort === effort)).toBe(true)
        const before = fixture.requests.length
        await main.command({ type: 'settings', model: model.model, effort, controlEpoch: main.state.controlEpoch })
        expect(main.state).toMatchObject({ model: model.model, effort, settingsOverride: true })
        expect(fixture.requests.length).toBe(before)
        const marker = `CC_MODEL_${name.toUpperCase()}`
        await send(marker); await done(marker)
        expect(fixture.requests.find(r => r.marker === marker && r.stream)).toMatchObject({ model: model.model, effort })
      }
      expect(await readFile(join(fixture.config, 'settings.json'), 'utf8')).toBe(userSettingsBefore)
      await until(() => clean().includes('JanusXsession:'), 'native session selection label')
      await main.command({ type: 'mode', mode: 'terminal' })
      await sendNative(terminal, 'CC_MODEL_NATIVE'); await done('CC_MODEL_NATIVE')
      expect(fixture.requests.find(r => r.marker === 'CC_MODEL_NATIVE' && r.stream)).toMatchObject({ model: main.state.model, effort: 'max' })
      await sendNative(terminal, '/model claude-sonnet-4-6')
      await until(() => !main.state.settingsOverride, 'native model takes control')
      await until(() => clean().includes('SetmodeltoSonnet4.6'), 'native model command completed'); await delay(1000)
      await sendNative(terminal, '/effort low')
      await until(() => clean().includes('Changeeffortlevel?') || clean().includes('Seteffortleveltolow'), 'native effort confirmation')
      if (!clean().includes('Seteffortleveltolow')) { await delay(500); terminal.write('\r') }
      await until(() => clean().includes('Seteffortleveltolow'), 'native effort command completed'); await delay(1000)
      await sendNative(terminal, 'CC_NATIVE_SETTINGS'); await done('CC_NATIVE_SETTINGS')
      expect(fixture.requests.find(r => r.marker === 'CC_NATIVE_SETTINGS' && r.stream)).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'low' })
      expect(main.state.threadId).toBe(session)
      await main.command({ type: 'mode', mode: 'terminal' })
      await sendNative(terminal, 'CC_CANCEL')
      await until(() => main.state.items.some(item => item.text === 'First CC_CANCEL'), 'cancel partial')
      terminal.write('\x1b'); await until(() => !main.state.turnId, 'native cancellation')
      await main.command({ type: 'mode', mode: 'conversation' })
      await send('CC_RECOVERED'); await done('CC_RECOVERED')
      expect(main.state.threadId).toBe(session)
      expect(JSON.stringify(fixture.requests.find(r => r.marker === 'CC_RECOVERED').messages)).toContain('CC_SECOND')
      for (const marker of ['CC_WRITE', 'CC_DENY']) {
        await send(marker); await until(() => main.state.approvals.length === 1, 'file approval')
        await main.command({ type: 'approve', requestId: main.state.approvals[0].id, decision: marker === 'CC_WRITE' ? 'accept' : 'decline', controlEpoch: main.state.controlEpoch })
        await done(marker); expect(existsSync(join(fixture.cwd, marker + '.txt'))).toBe(marker === 'CC_WRITE')
      }
      await send('CC_NATIVE_APPROVAL'); await until(() => main.state.approvals.length === 1, 'native approval')
      const staleApproval = main.state.approvals[0].id
      await main.command({ type: 'mode', mode: 'terminal' })
      await delay(500); terminal.write('\r'); await done('CC_NATIVE_APPROVAL')
      expect(main.state.approvals).toHaveLength(0)
      expect(existsSync(join(fixture.cwd, 'CC_NATIVE_APPROVAL.txt'))).toBe(true)
      await main.command({ type: 'mode', mode: 'conversation' })
      await expect(main.command({ type: 'approve', requestId: staleApproval, decision: 'accept', controlEpoch: main.state.controlEpoch })).rejects.toThrow('expired')
      await send('CC_TOOL'); await until(() => main.state.approvals.length === 1, 'Bash approval')
      await main.command({ type: 'approve', requestId: main.state.approvals[0].id, decision: 'accept', controlEpoch: main.state.controlEpoch })
      await until(() => existsSync(fixture.pidFile), 'child starts')
      const child = JSON.parse(await readFile(fixture.pidFile, 'utf8'))
      await main.command({ type: 'interrupt', controlEpoch: main.state.controlEpoch })
      await until(() => { try { process.kill(child.pid, 0); return false } catch { return true } }, 'child exits after TaskStop', 4000)
      await delay(Math.max(0, child.startedAt + 9500 - Date.now()))
      expect(existsSync(fixture.sideEffect)).toBe(false)
      await send('CC_AFTER_STOP'); await done('CC_AFTER_STOP')
      await send('CC_BACKGROUND'); await until(() => main.state.approvals.length === 1, 'background approval')
      await main.command({ type: 'approve', requestId: main.state.approvals[0].id, decision: 'accept', controlEpoch: main.state.controlEpoch })
      await done('CC_BACKGROUND')
      await until(() => main.state.backgroundTasks === 0, 'background completion notification')
      await until(() => !main.state.turnId, 'background completion answer')
      expect(main.state.items.some(item => item.type === 'userMessage' && item.text.includes('<task-notification>'))).toBe(false)
      await start(other, ['--settings', JSON.stringify({ maxEffortLevel: 'high' }), '--tools', 'TodoWrite'], { CLAUDE_CODE_ENABLE_TASKS: '0' })
      expect(other.state.threadId).not.toBe(session)
      await main.command({ type: 'settings', model: main.state.models.find(option => option.displayName === 'Opus')!.model, effort: 'max', controlEpoch: main.state.controlEpoch })
      await main.dispose()
      const state = await other.command({ type: 'mode', mode: 'conversation' })
      await until(() => other.state.models.length > 0, 'second worker model catalog')
      await expect(other.command({ type: 'settings', model: other.state.models.find(option => option.displayName === 'Opus')!.model, effort: 'max', controlEpoch: state.controlEpoch })).rejects.toThrow('limit')
      expect(other.state.settingsOverride).toBeFalsy()
      await other.command({ type: 'send', text: 'CC_OTHER', commandId: 'other', controlEpoch: state.controlEpoch })
      await until(() => !other.state.turnId && other.state.items.some(item => item.text.includes('CC_OTHER') && item.type === 'agentMessage' && item.status === 'completed'), 'other survives')
      expect(JSON.stringify(fixture.requests.find(r => r.marker === 'CC_OTHER').messages)).not.toContain('CC_FIRST')
      expect(fixture.requests.find(r => r.marker === 'CC_OTHER' && r.stream)).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'low' })
      for (const marker of ['CC_TODO_START', 'CC_TODO_CARRY', 'CC_TODO_CLEAR']) {
        await other.command({ type: 'send', text: marker, commandId: marker, controlEpoch: other.state.controlEpoch })
        await until(() => !other.state.turnId && other.state.items.some(item => item.type === 'agentMessage' && item.text.includes(marker) && item.status === 'completed'), marker)
        expect(other.state.plans?.at(-1)?.steps).toEqual(marker === 'CC_TODO_CLEAR' ? [] : [{ step: 'Verify legacy todo', status: 'inProgress' }])
      }
      await mkdir('artifacts/claude-dual-mode', { recursive: true })
      await writeFile('artifacts/claude-dual-mode/managed.json', JSON.stringify({ session, snapshots, requests: fixture.requests, root: fixture.root }, null, 2))
    } finally {
      await mkdir('artifacts/claude-dual-mode', { recursive: true })
      await writeFile('artifacts/claude-dual-mode/managed-last.json', JSON.stringify({ state: main.snapshot(), controls, snapshots, requests: fixture.requests, root: fixture.root, output }, null, 2))
      for (const terminal of terminals) { try { terminal.write('\x1a') } catch {} }
      await delay(500)
      await Promise.allSettled([main.dispose(), other.dispose()])
      await delay(500)
      for (const terminal of terminals) await promisify(execFile)('taskkill', ['/PID', String(terminal.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
      // Only the fixture's isolated supervisor; product dispose never does this.
      await promisify(execFile)(binary!, ['daemon', 'stop', '--any'], { env: fixture.env, cwd: fixture.cwd, windowsHide: true, timeout: 10000 }).catch(() => {})
      await fixture.close()
    }
    expect(main.state.connection).toBe('closed')
  }, 180000)
})
