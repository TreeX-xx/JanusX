import { startNativePlugin } from '@janusx/plugin-sdk/native'
import { createDockerService } from './service'
startNativePlugin(async (context, host) => {
  const service = await createDockerService(context, host)
  // Also stop CLI collectors on an uncaught exception or a graceful OS termination.
  process.once('exit', () => { void service.stop().catch(() => {}) })
  process.once('SIGTERM', () => { void service.stop().finally(() => process.exit(0)) })
  return service
})
