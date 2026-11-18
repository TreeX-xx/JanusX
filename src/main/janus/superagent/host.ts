import type { SuperAgentService } from './service'

// Note: .agents/notes/agent/superagent-plugin-migration.md — checking admission never constructs a service.
type ServiceFactory = (workspaceId?: string) => SuperAgentService
let host: { resolve: ServiceFactory; allow: (senderId?: number, workspaceId?: string) => boolean; signal?: (workspaceId?: string) => AbortSignal | undefined } | undefined

export function bindSuperAgentService(resolve: ServiceFactory, allow: (senderId?: number, workspaceId?: string) => boolean, signal?: (workspaceId?: string) => AbortSignal | undefined) {
  const binding = { resolve, allow, signal }
  host = binding
  return () => { if (host === binding) host = undefined }
}

export function superAgentAvailable(senderId?: number, workspaceId?: string): boolean {
  return host?.allow(senderId, workspaceId) === true
}

export const superAgentSignal = (workspaceId?: string) => host?.signal?.(workspaceId)

export function superAgentService(senderId?: number, workspaceId?: string): SuperAgentService {
  if (!host) throw new Error('SuperAgent is unavailable')
  if (!host.allow(senderId, workspaceId)) throw new Error('SuperAgent chat is only available to application windows')
  return host.resolve(workspaceId)
}
