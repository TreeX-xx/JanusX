import type { SuperAgentService } from './service'

let resolveService: (() => SuperAgentService) | undefined
let authorize: ((senderId: number | undefined) => boolean) | undefined
export function bindSuperAgentService(value: () => SuperAgentService, allow?: (senderId: number | undefined) => boolean): void { resolveService = value; authorize = allow }
export function superAgentService(senderId?: number): SuperAgentService {
  if (!resolveService) throw new Error('SuperAgent is not initialized')
  if (authorize && !authorize(senderId)) throw new Error('SuperAgent chat is only available to application windows')
  return resolveService()
}
