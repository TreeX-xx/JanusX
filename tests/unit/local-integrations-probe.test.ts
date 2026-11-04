import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { probeMcp } from '../../src/main/local-integrations/probe'

let temporary: string, server: Server | undefined
beforeEach(async () => { temporary = await mkdtemp(join(tmpdir(), 'janus-mcp-probe-')) })
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined }; await rm(temporary, { recursive: true, force: true }) })

it('performs a real stdio handshake, lists tools and closes the child', async () => {
  const pidFile = join(temporary, 'pid')
  const script = `require('fs').writeFileSync(process.argv[1],String(process.pid));require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}}));if(m.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'read_only',description:'Test',inputSchema:{type:'object'}}]}}));});`
  const result = await probeMcp({ command: process.execPath, args: ['-e', script, pidFile] }, temporary)
  expect(result).toMatchObject({ state: 'passed', tools: 1 })
  const pid = Number(await readFile(pidFile, 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
})

it('times out and closes a silent process without leaking its output', async () => {
  const pidFile = join(temporary, 'pid')
  const result = await probeMcp({ command: process.execPath, args: ['-e', `require('fs').writeFileSync(process.argv[1],String(process.pid));console.error('secret-do-not-display');setInterval(()=>{},1000)`, pidFile] }, temporary, process.env, 700)
  expect(result).toMatchObject({ state: 'failed', issue: 'timeout' })
  expect(JSON.stringify(result)).not.toContain('secret')
  const pid = Number(await readFile(pidFile, 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
})

it('reports HTTP authentication separately and never returns server error bodies', async () => {
  server = createServer((_req, res) => { res.writeHead(401); res.end('secret-credential') })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const result = await probeMcp({ url: `http://127.0.0.1:${address.port}/mcp` }, temporary)
  expect(result).toMatchObject({ state: 'needs-auth', issue: 'needs-auth' })
  expect(JSON.stringify(result)).not.toContain('secret-credential')
})

it('reports missing environment variables before starting the process', async () => {
  expect(await probeMcp({ command: '${JANUS_MISSING_TEST_COMMAND}' }, temporary, {})).toMatchObject({ state: 'failed', issue: 'missing-env' })
})

it('performs a real HTTP handshake with environment-based URL and authorization', async () => {
  let authorization = ''
  server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const message = JSON.parse(Buffer.concat(chunks).toString())
    authorization = req.headers.authorization ?? ''
    if (message.id === undefined) { res.writeHead(202); res.end(); return }
    const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, serverInfo: { name: 'http-test', version: '1' }, capabilities: { tools: {} } } : { tools: [] }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const result = await probeMcp({ url: '${SERVER_URL}', bearer_token_env_var: 'TOKEN' }, temporary, { SERVER_URL: `http://127.0.0.1:${address.port}/mcp`, TOKEN: 'fixture-token' })
  expect(result).toMatchObject({ state: 'passed', tools: 0 })
  expect(authorization).toBe('Bearer fixture-token')
})
