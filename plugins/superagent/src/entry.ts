import { startNativePlugin } from '@janusx/plugin-sdk/native'
import { createCoordinator } from './coordinator'
startNativePlugin(async (_context, host) => createCoordinator(host))
