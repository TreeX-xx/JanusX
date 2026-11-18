import type { SuperAgentService } from './service'

// Note: .agents/notes/agent/superagent-plugin-migration.md — checking admission never constructs a service.
type ServiceFactory = () => SuperAgentService
let host: { resolve: ServiceFactory; allow: (senderId?: number) => boolean } | undefined

export function bindSuperAgentService(resolve: ServiceFactory, allow: (senderId?: number) => boolean) {
  const binding = { resolve, allow }
  host = binding
  return () => { if (host === binding) host = undefined }
}

export function superAgentAvailable(senderId?: number): boolean {
  return host?.allow(senderId) === true
}

export function superAgentService(senderId?: number): SuperAgentService {
  if (!host) throw new Error('SuperAgent is unavailable')
  if (!host.allow(senderId)) throw new Error('SuperAgent chat is only available to application windows')
  return host.resolve()
}
