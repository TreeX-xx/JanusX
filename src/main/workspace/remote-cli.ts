import type { RemoteCliProbe, RemoteCliInstallState } from '../../shared/workspace-runtime'
import { getExternalCliTool } from '../external-cli/tool-registry'
import { prepareRuntimeBackend, readWorkspaceRecord, runtimeCliRequest } from './runtime'

async function target(workspaceId: string, toolId: string) {
  const tool = getExternalCliTool(toolId)
  if (!tool?.npmPackage) throw new Error('Unsupported Agent CLI')
  const workspace = await readWorkspaceRecord(workspaceId)
  const runtime = workspace.runtime
  if (!runtime || runtime.kind === 'windows') throw new Error('Select a WSL or SSH workspace')
  return { runtime, tool }
}

export async function detectRemoteCli(workspaceId: string, toolId: string): Promise<RemoteCliProbe> {
  const { runtime, tool } = await target(workspaceId, toolId)
  return runtimeCliRequest(runtime, { method: 'detect', tool: tool.id })
}

export async function installRemoteCli(workspaceId: string, toolId: string): Promise<RemoteCliInstallState> {
  const { runtime, tool } = await target(workspaceId, toolId)
  const existing = await runtimeCliRequest<RemoteCliInstallState>(runtime, { method: 'status', tool: tool.id })
  if (existing.state === 'running') return existing
  const probe = await runtimeCliRequest<RemoteCliProbe>(runtime, { method: 'detect', tool: tool.id })
  if (probe.installed) return { state: 'complete', log: '' }
  if (probe.platform !== 'linux' || !['x86_64', 'aarch64', 'arm64'].includes(probe.architecture)) throw new Error('Automatic installation requires Linux x64 or arm64')
  // The private Linux runtime includes npm; never use the Windows npm or sudo.
  if (!probe.node || !probe.npm || (probe.nodeMajor ?? 0) < 22) {
    const [libc, version] = probe.libc ?? ['', '']
    const [major, minor] = version.split('.').map(Number)
    if (libc !== 'glibc' || !(major > 2 || major === 2 && minor >= 28)) {
      throw new Error('This Linux environment needs a compatible Node.js 22+ and npm. Open its terminal to install them, then retry.')
    }
    await prepareRuntimeBackend(runtime)
  }
  return runtimeCliRequest(runtime, { method: 'install', tool: tool.id,
    packages: [tool.npmPackage, ...(tool.id === 'dsh' ? ['@deepseek-harness-tui/dsh-tui'] : [])] })
}

export async function remoteCliInstallStatus(workspaceId: string, toolId: string): Promise<RemoteCliInstallState> {
  const { runtime, tool } = await target(workspaceId, toolId)
  return runtimeCliRequest(runtime, { method: 'status', tool: tool.id })
}
