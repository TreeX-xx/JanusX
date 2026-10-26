import type { z } from 'zod'
import type { BlueprintNotes } from '../../notes/service'
import type { Blueprint } from '../../../shared/janus/types'
import type { BlueprintMaintenanceTask, BlueprintOperation } from '../../../shared/janus/maintenance-types'

export interface MaintenanceModelSelection { providerId: string; modelId: string; contextWindow?: number; maxOutputTokens?: number }
export interface MaintenanceModelPort {
  select(providerId: string, modelId?: string): Promise<MaintenanceModelSelection>
  generate<T>(request: { model: MaintenanceModelSelection; schema: z.ZodType<T, any, any>; name: string; mode: 'json'; system: string;
    messages: Array<{ role: 'user'; content: string }>; temperature: number; abortSignal: AbortSignal }): Promise<{ object: T }>
}
export interface MaintenancePorts {
  notes: BlueprintNotes
  store: {
    loadBlueprint(scope: string, id: string): Promise<Blueprint | null>
    applyMaintenanceOperations(id: string, revision: number, operations: BlueprintOperation[], allowed: Set<string>): Promise<{ before: Blueprint; after: Blueprint; createdNodeIds: Record<string, string>; createdRelationIds: Record<string, string> }>
  }
  models: MaintenanceModelPort
  workspaces(): Promise<Array<{ id: string; path: string }>>
  auditDirectory: string
  changed(task: BlueprintMaintenanceTask): void
}
