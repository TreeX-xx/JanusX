import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexConversation } from '../../terminal/codex-conversation'
import type { ManagedWorkerStart } from './workers'
import { confirmDarwinGroupExit, darwinGroupLeader } from './darwin-process'

// The engine creates a detached group. Persist its leader before exec replaces the shell with the CLI.
// All paths and CLI arguments are positional parameters, including the engine-appended app-server argument.
const launch = [
  'umask 077', 'printf "%s" "$$" > "$1/pid" || exit 1',
  'i=0; while [ "$i" -lt 200 ]; do',
  '  if [ -f "$1/ready" ]; then shift; exec "$@"; fi',
  '  i=$((i+1)); /bin/sleep 0.05', 'done', 'exit 1',
].join('\n')

export class DarwinCodexWorker extends CodexConversation {
  private group?: number
  private stopped = false

  override async startManaged(options: ManagedWorkerStart) {
    const directory = await mkdtemp(join(tmpdir(), 'janus-owned-'))
    try {
      if (this.stopped) throw new Error('Worker launch cancelled')
      const start = super.startManaged({ ...options, command: '/bin/sh', args: ['-c', launch, 'janus-codex', directory, options.command, ...options.args] })
      const identify = async () => {
        for (let i = 0; i < 160 && !this.stopped; i++) {
          const raw = await readFile(join(directory, 'pid'), 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error
            return ''
          })
          if (/^\d+$/.test(raw)) {
            const tree = await darwinGroupLeader(Number(raw), process.pid)
            this.group = tree[0].pid
            await options.onProcessTree?.(tree)
            if (this.stopped) throw new Error('Worker launch cancelled')
            await writeFile(join(directory, 'ready'), '', { flag: 'wx' })
            return
          }
          await delay(50)
        }
        throw new Error('Worker process ownership could not be established')
      }
      const ownership = identify()
      try { await Promise.all([start, ownership]) }
      catch (error) {
        try { await this.dispose() } finally { await Promise.allSettled([start, ownership]) }
        throw error
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  }

  override async dispose() {
    this.stopped = true
    await super.dispose()
    if (this.group) { await confirmDarwinGroupExit(this.group); this.group = undefined }
  }
}
