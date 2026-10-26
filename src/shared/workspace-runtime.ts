// Note: .agents/notes/sessions/workspace-runtime-import.md
export type WorkspaceRuntime =
  | { kind: 'windows' }
  | { kind: 'wsl'; distro: string; root: string }
  | { kind: 'ssh'; host: string; user?: string; port?: number; identityFile?: string; root: string }

export interface RuntimeDirectory { name: string; path: string; directory: boolean }
export interface RuntimeProbe {
  home: string; platform: string; architecture: string; python: string; git: boolean
}
export interface RuntimeTerminal {
  preset?: string
  id: string; workspaceId: string; cwd: string; argv: string[]; pid: number
  cols: number; rows: number; exitCode: number | null; sequence: number; createdAt: string
}
export const WORKSPACE_RUNTIME_CHANNELS = {
  detectCli: 'workspace-runtime:cli:detect',
  installCli: 'workspace-runtime:cli:install',
  cliInstallStatus: 'workspace-runtime:cli:status',
  distributions: 'workspace-runtime:distributions',
  hosts: 'workspace-runtime:hosts',
  connect: 'workspace-runtime:connect',
  browse: 'workspace-runtime:browse',
  terminals: 'workspace-runtime:terminals',
} as const
export interface WorkspaceRuntimeAPI {
  detectCli(workspaceId: string, tool: string): Promise<RemoteCliProbe>
  installCli(workspaceId: string, tool: string): Promise<RemoteCliInstallState>
  cliInstallStatus(workspaceId: string, tool: string): Promise<RemoteCliInstallState>
  distributions(): Promise<string[]>
  hosts(): Promise<string[]>
  connect(runtime: Exclude<WorkspaceRuntime, { kind: 'windows' }>): Promise<RuntimeProbe>
  browse(runtime: Exclude<WorkspaceRuntime, { kind: 'windows' }>, path: string): Promise<{ path: string; entries: RuntimeDirectory[] }>
  terminals(workspaceId: string): Promise<RuntimeTerminal[]>
}

export interface RemoteCliProbe {
  installed: boolean
  environment: string
  platform: string
  architecture: string
  executable?: string
  node?: string
  npm?: string
  nodeMajor?: number
  libc?: [string, string]
}
export interface RemoteCliInstallState {
  state: 'idle' | 'running' | 'complete' | 'failed'
  log?: string
  error?: string
}

/** Remote paths are opaque resources at IPC boundaries, never Windows paths. */
export function runtimeResource(workspaceId: string, path: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId) || !path.startsWith('/') || path.includes('\0')) throw new Error('Invalid workspace resource')
  return `janusx-workspace://${workspaceId}${path.split('/').map(encodeURIComponent).join('/')}`
}
export function parseRuntimeResource(value: unknown): { workspaceId: string; path: string } | null {
  if (typeof value !== 'string' || !value.startsWith('janusx-workspace://')) return null
  const match = /^janusx-workspace:\/\/([a-zA-Z0-9_-]{1,128})(\/.*)$/.exec(value)
  if (!match) throw new Error('Invalid workspace resource')
  const segments = match[2].split('/').map(decodeURIComponent)
  if (segments.some(segment => segment === '..' || /[\0\\/]/.test(segment))) throw new Error('Invalid workspace resource path')
  return { workspaceId: match[1], path: segments.join('/') }
}
