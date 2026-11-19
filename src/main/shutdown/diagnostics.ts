import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Structured lifecycle facts only: never persist commands, environment or prompts. */
export function logShutdown(event: string, detail: Record<string, string | number | boolean | undefined> = {}): void {
  const record = { time: new Date().toISOString(), pid: process.pid, event, ...detail }
  console.info('[AppShutdown]', JSON.stringify(record))
  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    appendFileSync(join(directory, 'shutdown.log'), JSON.stringify(record) + '\n')
  } catch {
    // Diagnostics must never prevent the remaining resources from stopping.
  }
}
