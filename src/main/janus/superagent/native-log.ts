import { appendFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SerialQueue } from '../../lib/atomic-file'
import type { SuperAgentNativeLog } from '../../../shared/superagent-worker'

const PER_EXECUTION_BYTES = 2 * 1024 * 1024
const TOTAL_BYTES = 32 * 1024 * 1024
const TRUNCATED = '[Earlier native log content was not retained]\n'

/** Optional native diagnostics only. This directory never contains user inputs or formal reports. */
export class SuperAgentNativeLogs {
  private queue = new SerialQueue()
  constructor(private readonly directory: string) {}
  append(executionId: string, event: unknown): Promise<void> {
    return this.queue.run(async () => {
      await mkdir(this.directory, { recursive: true })
      const file = this.file(executionId)
      const line = JSON.stringify(event) + '\n'
      await appendFile(file, line.length > PER_EXECUTION_BYTES ? TRUNCATED + line.slice(-PER_EXECUTION_BYTES / 4) : line, 'utf8')
      if ((await stat(file)).size > PER_EXECUTION_BYTES) {
        const body = await readFile(file)
        const tail = body.subarray(body.length - PER_EXECUTION_BYTES / 2).toString('utf8')
        await writeFile(file, TRUNCATED + tail.slice(tail.indexOf('\n') + 1), 'utf8')
      }
      const files = await Promise.all((await readdir(this.directory)).filter(name => /^[a-f0-9-]{36}\.jsonl$/.test(name)).map(async name => ({ name, ...(await stat(join(this.directory, name))) })))
      let bytes = files.reduce((sum, item) => sum + item.size, 0)
      for (const item of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (bytes <= TOTAL_BYTES) break
        if (join(this.directory, item.name) === file) continue
        await unlink(join(this.directory, item.name)); bytes -= item.size
      }
    })
  }
  read(executionId: string): Promise<SuperAgentNativeLog> {
    return this.queue.run(async () => {
      try {
        const text = await readFile(this.file(executionId), 'utf8')
        return { text, available: true, truncated: text.includes(TRUNCATED) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return { text: '', available: false, truncated: false }
      }
    })
  }
  close(): Promise<void> { return this.queue.run(async () => {}) }
  private file(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid execution identity')
    return join(this.directory, `${id}.jsonl`)
  }
}
