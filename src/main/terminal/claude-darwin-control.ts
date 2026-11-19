// Note: .agents/notes/agent/superagent-plugin-migration.md
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Derive the control endpoint only from the roster row of our already bound background session. */
export async function claudeDarwinControlEndpoint(config: string, session: string | null, pid?: number) {
  const uid = process.getuid?.()
  if (uid === undefined || !session || !pid) throw new Error('Claude daemon session is unbound')
  const roster = JSON.parse(await readFile(join(config, 'daemon/roster.json'), 'utf8')) as {
    workers?: Record<string, { pid?: number; replPid?: number; sessionId?: string; rendezvousSock?: string }>
  }
  const job = Object.values(roster.workers ?? {}).find(row => row.sessionId === session && (row.pid === pid || row.replPid === pid))
  const path = job?.rendezvousSock
  const parent = '/tmp/cc-daemon-' + uid
  const match = typeof path === 'string' && path.replace(/^\/private\/tmp\//, '/tmp/').match(new RegExp('^' + parent + '/([a-f0-9]{8})/'))
  if (!match) throw new Error('Claude daemon did not identify the owned Worker endpoint')
  const directory = join(parent, match[1])
  for (const folder of [parent, directory]) {
    const meta = await lstat(folder)
    if (!meta.isDirectory() || meta.uid !== uid || (meta.mode & 0o022)) throw new Error('Claude daemon socket directory has unexpected ownership')
  }
  const endpoint = join(directory, 'control.sock')
  const socket = await lstat(endpoint)
  if (!socket.isSocket() || socket.uid !== uid) throw new Error('Claude daemon control socket has unexpected ownership')
  return endpoint
}
