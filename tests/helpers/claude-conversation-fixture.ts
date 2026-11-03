import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function claudeConversationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-claude-managed-'))
  const cwd = join(root, 'workspace')
  const config = join(root, 'config')
  await mkdir(cwd); await mkdir(config)
  await writeFile(join(cwd, 'stages.txt'), 'Local staged streaming fixture.\n')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'pathext', 'programfiles', 'programfiles(x86)', 'claude_code_git_bash_path'].includes(key.toLowerCase())))
  Object.assign(env, { HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: config,
    APPDATA: join(root, 'AppData/Roaming'), LOCALAPPDATA: join(root, 'AppData/Local'),
    ANTHROPIC_API_KEY: 'local-fixture-only', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', NO_PROXY: '127.0.0.1,localhost' })
  await writeFile(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', autoUpdates: false }))
  await writeFile(join(config, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'manual' } }))
  const requests: any[] = []
  let number = 0
  const server = createServer(async (req, res) => {
    const buffers = []
    for await (const buffer of req) buffers.push(buffer)
    const body = JSON.parse(Buffer.concat(buffers).toString() || '{}')
    const json = (value: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    if (req.url?.includes('count_tokens')) { json({ input_tokens: 8 }); return }
    if (!req.url?.includes('messages')) { json({ data: [] }); return }
    const marker = [...JSON.stringify(body.messages).matchAll(/CC_[A-Z_]+/g)].at(-1)?.[0] ?? 'CC_NONE'
    const n = ++number
    const request = { n, marker, model: body.model, effort: body.output_config?.effort, messages: body.messages, stream: body.stream, tools: body.tools?.map((tool: any) => tool.name), startedAt: Date.now(), finishedAt: 0 }; requests.push(request)
    if (marker === 'CC_STAGES' && body.stream) {
      const stage = body.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
        .filter((block: any) => block.type === 'tool_use' && block.id.startsWith('toolu_stages_')).length
      const parts = [['Inspecting ', 'the first file.'], ['Found the first result. ', 'Checking again.'], ['Both checks ', 'finished.']][Math.min(stage, 2)]
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const event = (type: string, value: object) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`) }
      event('message_start', { message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 8, output_tokens: 1 } } })
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: parts[0] } })
      await new Promise(resolve => setTimeout(resolve, 700))
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: parts[1] } })
      event('content_block_stop', { index: 0 })
      if (stage < 2) {
        event('content_block_start', { index: 1, content_block: { type: 'tool_use', id: `toolu_stages_${stage}`, name: 'Read', input: {} } })
        event('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: join(cwd, 'stages.txt') }) } })
        event('content_block_stop', { index: 1 })
      }
      event('message_delta', { delta: { stop_reason: stage < 2 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } })
      event('message_stop', {}); res.end(); request.finishedAt = Date.now()
      return
    }
    const latest = body.messages.at(-1)?.content
    const hasResult = (Array.isArray(latest) && latest.some((item: any) => item.type === 'tool_result')) || JSON.stringify(latest).includes('<task-notification>')
    const plans: Record<string, { name: string; input: object }> = {
      CC_QUESTION: { name: 'AskUserQuestion', input: { questions: [
        { header: 'Deploy', question: 'Deploy now?', options: [{ label: 'Yes', description: 'Deploy once' }, { label: 'No', description: 'Keep current version' }], multiSelect: false },
        { header: 'Checks', question: 'Select checks', options: [{ label: 'Unit', description: 'Run units' }, { label: 'Browser', description: 'Run browser' }], multiSelect: true },
        { header: 'Notes', question: 'Additional notes?', options: [{ label: 'None', description: 'No notes' }, { label: 'Later', description: 'Add later' }], multiSelect: false },
      ] } },
      CC_PLAN_CREATE: { name: 'TaskCreate', input: { subject: 'Verify native todo', description: 'Exercise the real task store', activeForm: 'Verifying native todo' } },
      CC_PLAN_PROGRESS: { name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } },
      CC_PLAN_COMPLETE: { name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
      CC_PLAN_DELETE: { name: 'TaskUpdate', input: { taskId: '1', status: 'deleted' } },
      CC_PLAN_MISSING: { name: 'TaskUpdate', input: { taskId: 'missing', status: 'completed' } },
      CC_TODO_START: { name: 'TodoWrite', input: { todos: [{ content: 'Verify legacy todo', status: 'in_progress', activeForm: 'Verifying legacy todo' }] } },
      CC_TODO_CLEAR: { name: 'TodoWrite', input: { todos: [] } },
    }
    // Native reminder messages may follow the result. Identify this prompt's
    // actual tool use instead of assuming the final message is its result.
    const promptIndex = body.messages.findLastIndex((message: any) => message.role === 'user' &&
      (typeof message.content === 'string' ? message.content.includes(marker) : message.content?.some((block: any) => block.type === 'text' && block.text?.includes(marker))))
    const planUsed = body.messages.slice(promptIndex + 1).some((message: any) => Array.isArray(message.content) && message.content.some((block: any) => block.type === 'tool_use' && block.name === plans[marker]?.name))
    const toolCase = plans[marker] ? !planUsed : ['CC_WRITE', 'CC_DENY', 'CC_NATIVE_APPROVAL', 'CC_TOOL', 'CC_BACKGROUND'].includes(marker) && !hasResult
    const tool = plans[marker] ? { type: 'tool_use', id: `toolu_${n}`, ...plans[marker] } : ['CC_TOOL', 'CC_BACKGROUND'].includes(marker) ? { type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: {
      command: marker === 'CC_BACKGROUND' ? 'node -e "setTimeout(()=>console.log(123),2500)"' : `node "${join(root, 'delay.cjs').replaceAll('\\', '/')}"`,
      description: 'Isolated delayed command', timeout: 20000, ...(marker === 'CC_BACKGROUND' ? { run_in_background: true } : {}),
    } } : { type: 'tool_use', id: `toolu_${n}`, name: 'Write', input: { file_path: join(cwd, marker + '.txt'), content: marker } }
    const message = { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model,
      content: toolCase ? [tool] : [{ type: 'text', text: `First ${marker} final` }], stop_reason: toolCase ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 8, output_tokens: 4 } }
    if (!body.stream) { json({ ...message, content: [{ type: 'text', text: '{"summary":"Local fixture"}' }], stop_reason: 'end_turn' }); request.finishedAt = Date.now(); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const event = (type: string, value: object) => { if (!res.destroyed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`) }
    event('message_start', { message: { ...message, content: [], stop_reason: null } })
    event('content_block_start', { index: 0, content_block: toolCase ? { ...tool, input: {} } : { type: 'text', text: '' } })
    event('content_block_delta', { index: 0, delta: toolCase ? { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } : { type: 'text_delta', text: `First ${marker}` } })
    if (!toolCase) {
      await new Promise(resolve => setTimeout(resolve, marker === 'CC_CANCEL' ? 8000 : 600))
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ' final' } })
    }
    event('content_block_stop', { index: 0 }); event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 4 } })
    event('message_stop', {}); res.end(); request.finishedAt = Date.now()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`
  const pidFile = join(root, 'child.json'), sideEffect = join(root, 'late.txt')
  await writeFile(join(root, 'delay.cjs'), `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid,startedAt:Date.now()}));setTimeout(()=>fs.writeFileSync(${JSON.stringify(sideEffect)},'late'),9000);`)
  return { root, cwd, config, env, requests, pidFile, sideEffect, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
