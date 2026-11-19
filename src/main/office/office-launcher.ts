#!/usr/bin/env node
// Note: OfficeCLI is a bundled asset, not a managed download — see .agents/notes/desktop/officecli-bundled.md
import type { ChildProcess } from 'node:child_process'
import { spawnProcess as spawn } from '../platform/process-host/core'
import { join } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { OFFICECLI_BUNDLED_VERSION, resolveBundledOfficecliBinary } from './office-bundled-path'
import { buildOfficeAgentSession } from './office-agent-policy'
import {
  applyOfficeProjectRules,
  previewCodexOfficeMcp,
  previewOfficeProjectRules,
  OFFICE_MCP_START,
  OFFICE_PROJECT_POLICY,
  OFFICE_RULE_START,
} from './office-project-rules'

type LauncherEngine = 'codex' | 'claude' | 'opencode'
type LauncherCommand =
  | { command: 'status' }
  | { command: 'configure' | 'unconfigure'; workspace: string; apply: boolean }
  | { command: 'run'; engine: LauncherEngine; workspace: string; args: string[] }

export interface OfficeLauncherDependencies {
  bundledBinary?: string
  resourcesPath?: string
  mcpEntry: string
  env: NodeJS.ProcessEnv
  spawn(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit'; shell: false }): ChildProcess
  platform: NodeJS.Platform
}

export function parseOfficeLauncherArgs(argv: readonly string[]): LauncherCommand {
  const [command, ...rest] = argv
  if (command === 'status') return { command }
  if (command === 'configure' || command === 'unconfigure') {
    const workspaceIndex = rest.indexOf('--workspace')
    if (workspaceIndex < 0 || !rest[workspaceIndex + 1]) throw new Error('--workspace is required')
    return { command, workspace: rest[workspaceIndex + 1], apply: rest.includes('--apply') }
  }
  if (command === 'run') {
    const engineIndex = rest.indexOf('--engine')
    const workspaceIndex = rest.indexOf('--workspace')
    const separator = rest.indexOf('--')
    const engine = rest[engineIndex + 1]
    if (engineIndex < 0 || !['codex', 'claude', 'opencode'].includes(engine) || workspaceIndex < 0 || !rest[workspaceIndex + 1]) {
      throw new Error('run requires --engine <codex|claude|opencode> and --workspace <path>')
    }
    return { command, engine: engine as LauncherEngine, workspace: rest[workspaceIndex + 1], args: separator < 0 ? [] : rest.slice(separator + 1) }
  }
  throw new Error('Expected status, run, configure, or unconfigure')
}

async function resolveLauncherBinary(deps: OfficeLauncherDependencies): Promise<string | undefined> {
  const candidates = [
    deps.bundledBinary,
    resolveBundledOfficecliBinary({ resourcesPath: deps.resourcesPath, env: deps.env, platform: deps.platform }),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {}
  }
  return undefined
}

export async function runOfficeLauncher(
  argv: readonly string[],
  overrides: Partial<OfficeLauncherDependencies> = {},
): Promise<number> {
  const env = overrides.env ?? process.env
  const deps: OfficeLauncherDependencies = {
    bundledBinary: overrides.bundledBinary,
    resourcesPath: overrides.resourcesPath,
    mcpEntry: overrides.mcpEntry ?? join(import.meta.dirname, 'office-mcp.js'),
    env,
    spawn: overrides.spawn ?? ((command, args, options) => spawn(command, args, options)),
    platform: overrides.platform ?? process.platform,
  }
  const parsed = parseOfficeLauncherArgs(argv)
  if (parsed.command === 'status') {
    const binary = await resolveLauncherBinary(deps)
    process.stdout.write(`${JSON.stringify({ state: binary ? 'ready' : 'missing', version: OFFICECLI_BUNDLED_VERSION, location: 'bundled', binary })}\n`)
    return 0
  }
  const workspace = await realpath(parsed.workspace)
  if (parsed.command === 'configure' || parsed.command === 'unconfigure') {
    const remove = parsed.command === 'unconfigure'
    const previews = [
      await previewOfficeProjectRules(workspace, remove),
      await previewCodexOfficeMcp(workspace, remove),
    ]
    if (!parsed.apply) {
      process.stdout.write(`${JSON.stringify(previews.map(({ filePath, before, after, changed }) => ({ filePath, before, after, changed })), null, 2)}\n`)
      return previews.some((preview) => preview.changed) ? 2 : 0
    }
    await Promise.all(previews.map((preview) => applyOfficeProjectRules(preview, true)))
    return 0
  }
  if (parsed.command !== 'run') throw new Error('Unsupported launcher command')
  const binary = await resolveLauncherBinary(deps)
  if (!binary) throw new Error('Bundled OfficeCLI is missing; reinstall JanusX first')
  if (parsed.engine !== 'codex') {
    throw new Error(`${parsed.engine} has no verified Office policy/config adapter in this build`)
  }
  const [rules, config] = await Promise.all([
    readFile(join(workspace, 'AGENTS.md'), 'utf8').catch(() => ''),
    readFile(join(workspace, '.codex', 'config.toml'), 'utf8').catch(() => ''),
  ])
  if (!rules.includes(OFFICE_RULE_START) || !rules.includes(OFFICE_PROJECT_POLICY) ||
    !config.includes(OFFICE_MCP_START) || !config.includes('command = "janusx-office-mcp"')) {
    throw new Error('Run office:launcher configure --workspace <path> --apply before launching Codex')
  }
  const session = buildOfficeAgentSession(parsed.engine, workspace, binary, deps.mcpEntry, env.PATH, true)
  const child = deps.spawn(parsed.engine, parsed.args, {
    cwd: workspace,
    env: { ...env, ...session.env },
    stdio: 'inherit',
    shell: false,
  })
  const forwardSigint = () => { if (!child.killed) child.kill('SIGINT') }
  const forwardSigterm = () => { if (!child.killed) child.kill('SIGTERM') }
  process.on('SIGINT', forwardSigint)
  process.on('SIGTERM', forwardSigterm)
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
  } finally {
    process.off('SIGINT', forwardSigint)
    process.off('SIGTERM', forwardSigterm)
  }
}

if (process.argv[1]?.endsWith('office-launcher.js')) void runOfficeLauncher(process.argv.slice(2)).then(
  (code) => { process.exitCode = code },
  (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 },
)
