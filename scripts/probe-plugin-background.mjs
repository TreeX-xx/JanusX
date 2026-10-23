// A process boundary and Node's permission mode do not enforce our network contract.
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
const directory = await mkdtemp(join(tmpdir(), 'janusx-p5-probe-'))
try {
  const entry = join(directory, 'probe.mjs')
  const secret = join(directory, 'outside.txt')
  await writeFile(secret, 'permission-boundary-fixture')
  await writeFile(entry, `import { readFileSync } from 'node:fs'; import { createServer, connect } from 'node:net';
let fileBlocked = false; try { readFileSync(${JSON.stringify(secret)}) } catch (error) { fileBlocked = error.code === 'ERR_ACCESS_DENIED' }
const server = createServer(socket => socket.end('network-accessible'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const reply = await new Promise((resolve, reject) => { const socket = connect(server.address().port, '127.0.0.1'); socket.once('data', bytes => resolve(bytes.toString())); socket.once('error', reject) });
await new Promise(resolve => server.close(resolve));
console.log(JSON.stringify({ fileBlocked, networkAccessible: reply === 'network-accessible', environmentAccessible: process.env.JANUS_P5_PROBE === 'fixture', decision: 'declarative-host-tasks' }));`)
  const permission = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission'
  const output = execFileSync(process.execPath, [permission, `--allow-fs-read=${entry}`, entry],
    { env: { ...process.env, JANUS_P5_PROBE: 'fixture' }, encoding: 'utf8', timeout: 10_000 })
  const result = JSON.parse(output.trim())
  if (!result.fileBlocked || !result.networkAccessible || !result.environmentAccessible) throw new Error('Probe result changed; reassess background isolation')
  console.log(JSON.stringify({ probe: 'node-permission-network-boundary', node: process.version, ...result }))
} finally { await rm(directory, { recursive: true, force: true }) }
