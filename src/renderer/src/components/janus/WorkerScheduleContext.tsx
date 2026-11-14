import { createContext } from 'react'
import type { SuperAgentScheduleSnapshot } from '../../../../shared/superagent-scheduling'

export const WorkerScheduleContext = createContext<SuperAgentScheduleSnapshot | undefined>(undefined)
