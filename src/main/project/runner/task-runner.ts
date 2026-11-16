import { runProcess } from '../../platform/process-host'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectTaskResult } from '../../../shared/ipc/project'

const MAX_OUTPUT_LINES = 800
const TASK_TIMEOUT_MS = 120_000
const SAFE_SCRIPT_NAME = /^[\w:.-]+$/

type PackageManifest = { scripts?: Record<string, string> }

function packageManager(projectPath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'bun.lockb')) || existsSync(join(projectPath, 'bun.lock'))) return 'bun'
  return 'npm'
}

export async function listProjectScripts(projectPath: string): Promise<Record<string, string>> {
  const content = await readFile(join(projectPath, 'package.json'), 'utf-8')
  const manifest = JSON.parse(content) as PackageManifest
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts)) return {}
  return Object.fromEntries(Object.entries(manifest.scripts).filter(([name, value]) => SAFE_SCRIPT_NAME.test(name) && typeof value === 'string'))
}

export async function resolveProjectTestScript(projectPath: string, requestedScript?: string): Promise<{ name: string; command: string }> {
  const scripts = await listProjectScripts(projectPath)
  const script = requestedScript || ['test:unit', 'test', 'verify'].find((name) => scripts[name])
  if (!script || !SAFE_SCRIPT_NAME.test(script) || !scripts[script]) {
    throw new Error(requestedScript ? `Project test script not found: ${requestedScript}` : 'No test script found in package.json')
  }
  return { name: script, command: scripts[script] }
}

export async function runProjectTest(projectPath: string, requestedScript?: string): Promise<ProjectTaskResult> {
  const selected = await resolveProjectTestScript(projectPath, requestedScript)
  const script = selected.name

  const manager = packageManager(projectPath)
  const args = ['run', script]
  if (/\bvitest\b/i.test(selected.command) && !/\b(run|watch)\b/i.test(selected.command)) args.push('--', '--run')
  const startedAt = Date.now()
  const output: string[] = []
  const capture = (chunk: string) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue
      output.push(line)
      if (output.length > MAX_OUTPUT_LINES) output.splice(0, output.length - MAX_OUTPUT_LINES)
    }
  }
  const outcome = await runProcess(manager, args, { cwd: projectPath, timeoutMs: TASK_TIMEOUT_MS, maxOutputBytes: 16 * 1024 * 1024, onStdout: capture, onStderr: capture })
  if (outcome.status !== 'exited' && outcome.status !== 'timed-out') throw outcome.error ?? new Error(`Project task ${outcome.status}`)

  return {
    command: `${manager} run ${script}`,
    script,
    exitCode: outcome.exitCode,
    output,
    durationMs: Date.now() - startedAt,
    timedOut: outcome.status === 'timed-out',
  }
}
