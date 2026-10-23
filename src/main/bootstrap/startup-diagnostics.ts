import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let startupLog: string | undefined

/** Configure before Chromium initializes, so native GPU launch failures persist. */
export function configureStartupDiagnostics(): void {
  if (!app.isPackaged) return
  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    startupLog = join(directory, 'startup.log')
    appendFileSync(startupLog, `[${new Date().toISOString()}] Starting JanusX ${app.getVersion()} (${process.platform}/${process.arch})\n`)
    if (!app.commandLine.hasSwitch('enable-logging')) app.commandLine.appendSwitch('enable-logging', 'file')
    if (!app.commandLine.hasSwitch('log-file')) app.commandLine.appendSwitch('log-file', join(directory, 'startup-chromium.log'))
  } catch (error) {
    console.warn('[startup] Could not configure diagnostic logs:', error)
  }
}

export function logStartupFailure(message: string, error: unknown): void {
  console.error(message, error)
  if (!startupLog) return
  try {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    appendFileSync(startupLog, `[${new Date().toISOString()}] ${message} ${detail}\n`)
  } catch {
    // An unwritable log must not replace the original startup failure.
  }
}
