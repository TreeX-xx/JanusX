import { existsSync } from 'node:fs'
import type { CodexRpc } from '../../terminal/codex-managed-transport'
import { codexTrustTarget } from '../../terminal/codex-startup'
import type { SuperAgentEnvironmentLease } from './environments'
import { workerPermissions } from './worker-permissions'
import { WORKER_CONTEXT_OUTPUT_TOKENS } from './context-reader'

export const WORKER_MCP_NAME = 'janus_worker'
export const WORKER_RESTRICTIONS = [
  'features.plugins=false', 'features.apps=false', 'features.hooks=false', 'features.codex_hooks=false',
  'features.multi_agent=false', 'features.js_repl=false', 'features.code_mode=false', 'features.goals=false',
]

export function workerLaunch(lease: SuperAgentEnvironmentLease, config: CodexRpc,
  bridge: { command: string; entry: string; endpoint: string; token: string }) {
  if (!existsSync(bridge.entry)) throw new Error('The packaged worker-mcp.js entry is missing; rebuild JanusX before starting a Worker')
  if (codexTrustTarget(config, lease.checkout.path)) throw new Error('This checkout has no Codex trust decision. Open it with the native Codex setup, then explicitly try again.')
  if (!config.config || typeof config.config !== 'object') throw new Error('Codex effective configuration could not be read')
  const inherited = config.config.mcp_servers ?? {}
  if (!inherited || typeof inherited !== 'object' || Array.isArray(inherited)) throw new Error('Unsupported native MCP configuration')
  const policy = workerPermissions(lease)
  const configuredOutput = config.config.tool_output_token_limit
  const outputTokens = typeof configuredOutput === 'number' && Number.isSafeInteger(configuredOutput) && configuredOutput > 0
    ? Math.min(configuredOutput, WORKER_CONTEXT_OUTPUT_TOKENS) : WORKER_CONTEXT_OUTPUT_TOKENS
  // Overlay only the enable bit. Effective config contains normalized nulls which are not valid TOML overrides.
  const servers: Record<string, unknown> = Object.fromEntries(Object.keys(inherited).map(name => [name, { enabled: false }]))
  // Keep native settings on disk intact. Only this thread receives a restricted tool set.
  servers[WORKER_MCP_NAME] = {
    command: bridge.command, args: [bridge.entry], enabled: true, required: true,
    env: { ELECTRON_RUN_AS_NODE: '1', JANUS_WORKER_ENDPOINT: bridge.endpoint, JANUS_WORKER_TOKEN: bridge.token },
    startup_timeout_sec: 30, tool_timeout_sec: 900,
    tools: { read_work: { output_token_limit: outputTokens }, read_resource: { output_token_limit: outputTokens } },
  }
  const instructions = [config.config.developer_instructions,
    'You are a managed Codex Worker for one Janus work. Preserve the original repository instructions and workflow.',
    'Use janus_worker.read_work and read_resource for the complete assigned input and reports. These tools bind your identity on the host.',
    'Read every truncated requirement and uncovered input through the returned version/range/continuation before dependent edits. Missing originals are gaps: report a question instead of guessing. Do not repeat pages without progress. Resource references grant no additional filesystem permissions.',
    'Work cards separate Janus interpretations, host facts and Worker reports. Summary coverage and confirmed delivery are not proof of incorporation. A later original supplement takes priority over a stale interpretation. Verify current branch, HEAD and code; historical reports and file references are historical evidence.',
    'Report ready, question or failure with janus_worker.report_work. Use a new UUID reportId for each distinct report, and the same id only for an explicit retry of that report. Include actual changes, checks performed and limitations. A normal turn ending is not a ready report.',
    'New user supplements arrive through the native active-turn input channel. Preserve their constraints. Report only what you have actually completed.',
    'Only the assigned checkout is writable. Git metadata and configuration directories are protected. Use commit_work for an explicitly scoped host commit; the user decides. Do not create, merge, remove or switch branches/worktrees, expand permissions, or bypass these boundaries through other tools.',
  ].filter(Boolean).join('\n\n')
  return {
    contextOutputBytes: Math.floor(outputTokens * 4 * .7),
    disabledExtensions: [...Object.keys(inherited).filter(name => name !== WORKER_MCP_NAME), 'plugins', 'apps', 'hooks', 'native subagents'],
    params: { ...policy.thread, developerInstructions: instructions, config: { mcp_servers: servers },
      environments: [{ environmentId: 'local', cwd: lease.checkout.path, runtimeWorkspaceRoots: [lease.checkout.path] }] },
  }
}
