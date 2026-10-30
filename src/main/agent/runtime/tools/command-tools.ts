// Note: agentX owns command execution; Janus owns its process surface — see .agents/notes/blueprint/agentx-harness-inheritance.md
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createCommandRunTool, type JobStartInput } from '@janus-agent/node-hosts'
import { commandLogReadTool, type ToolRegistry } from '@janus-agent/agent-core'
import { getProjectRunner } from '../../../project/runner/service'
export { commandExecutionMode, filterCommandEnv, SAFE_COMMAND_ENV_KEYS } from '@janus-agent/node-hosts'

export const commandRunTool = createCommandRunTool({
  async start(input: JobStartInput) {
    const { projectId, handle, logPath } = await getProjectRunner().runAdhoc({
      cwd: input.cwd, program: input.program, args: input.args, label: input.label,
      storageRoot: input.workspaceRoot,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(Object.keys(input.env).length ? { env: input.env } : {}),
    })
    const path = logPath ? relative(resolve(input.workspaceRoot), resolve(logPath)) : ''
    return { projectId, pid: handle.pid, name: handle.config.name,
      logPath: logPath ? (path && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path) ? path.split(sep).join('/') : logPath.split(/[\\/]/).at(-1)!) : '',
    }
  },
})

export function registerCommandTools(registry: ToolRegistry): void {
  if (!registry.get(commandLogReadTool.name)) registry.register(commandLogReadTool)
  if (!registry.get(commandRunTool.name)) registry.register(commandRunTool)
}
