import { createInterface } from 'node:readline'
import { spawnProcess, stopOwnedProcess } from '../platform/process-host'

// A single question runs in an owned CLI process. Wait for its exit before resuming its session.
export function runSideChatProcess(
  command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal,
  read: (frame: Record<string, any>) => void,
  input?: string,
): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const lines = createInterface({ input: child.stdout! })
    let diagnostic = ''
    let failure: unknown
    let stopping: Promise<void> | undefined
    const stop = () => {
      stopping ??= stopOwnedProcess(child)
      void stopping.catch(reject)
    }
    const timer = setTimeout(() => { failure = new Error('Side question timed out.'); stop() }, 10 * 60_000)
    signal.addEventListener('abort', stop, { once: true })
    child.on('error', error => { failure ??= error })
    child.stderr?.on('data', data => { diagnostic = (diagnostic + data).slice(-1000) })
    child.stdin?.on('error', () => {})
    child.once('close', async code => {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      lines.close()
      try {
        await stopping
        if (failure) throw failure
        if (!signal.aborted && code !== 0) throw new Error(diagnostic.trim() || 'The side session exited before answering.')
        resolve()
      } catch (error) { reject(error) }
    })
    lines.on('line', line => {
      if (signal.aborted || failure || !line.trim()) return
      try {
        if (line.length > 8_000_000) throw new Error('The side session returned an oversized message.')
        read(JSON.parse(line))
      } catch (error) { failure = error; stop() }
    })
    child.stdin?.end(input)
  })
}
