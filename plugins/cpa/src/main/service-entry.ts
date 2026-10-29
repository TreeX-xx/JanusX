import { startNativePlugin } from '@janusx/plugin-sdk/native'
import { createCpaService } from './service'
startNativePlugin(createCpaService)
