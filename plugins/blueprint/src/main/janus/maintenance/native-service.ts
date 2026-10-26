import { join } from 'node:path'
import { z } from 'zod'
import { NativeServiceError, ReentrantAsyncLock, type NativePeer } from '@janusx/plugin-sdk/native'
import type { JsonValue } from '@janusx/plugin-sdk'
import type { BlueprintNoteService } from '../../notes/service'
import { BlueprintMaintenanceService } from './service'
import { nativeMaintenanceModels } from './native-models'
import { readJson, writeJson } from '../blueprint-persistence'
import { applyOperations } from './changeset'
import type { Blueprint } from '../../../shared/janus/types'
import type { BlueprintMaintenanceTask } from '../../../shared/janus/maintenance-types'
import { json } from '../../blueprint/review/native-models'
import { ChatSessionRuntime } from '@janus-agent/chat-core'

const text = z.string().min(1).max(256), id = z.string().uuid(), ids = z.array(text).max(1000)
const selection = { taskId: id, changeSetId: id, operationIds: ids, groupIds: ids.optional() }
const start = z.object({ conversationId: text, goal: z.string().min(1).max(32_000),
  nodeScope: z.discriminatedUnion('type', [z.object({ type: z.literal('blueprint') }).strict(),
    z.object({ type: z.literal('node'), nodeId: text }).strict(), z.object({ type: z.literal('subtree'), nodeId: text }).strict()]) }).strict()
const turn = z.object({ taskId: id, conversationId: text, providerId: z.string().max(256), modelId: text.optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(300_000) }).strict()).min(1).max(100),
  projectContext: z.string().max(400_000).optional(), noteRefs: z.array(z.object({ uri: z.string().max(512), expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()).max(100).optional(),
}).strict()
type Project = { id: string; root: string; name: string }

export function nativeMaintenance(options: { directory: string; notes: BlueprintNoteService; host: Pick<NativePeer, 'call'>; projects(): Project[];
  changed(task: BlueprintMaintenanceTask): void; job(root: string, method: string, work: (signal: AbortSignal) => Promise<unknown>): { id: string } }) {
  const lock = new ReentrantAsyncLock()
  const legacyFile = (value: string) => join(options.directory, 'legacy', id.parse(value) + '.json')
  const service = new BlueprintMaintenanceService({
    notes: options.notes, models: nativeMaintenanceModels(options.host), workspaces: async () => options.projects().map(project => ({ id: project.id, path: project.root })),
    changed: options.changed,
    store: {
      loadBlueprint: async (_scope, id) => readJson<Blueprint>(legacyFile(id)),
      applyMaintenanceOperations: (id, revision, operations, allowed) => lock.run(async () => {
        const before = await readJson<Blueprint>(legacyFile(id))
        if (!before || before.contentRevision !== revision) throw new NativeServiceError('RESOURCE_CHANGED')
        const { blueprint: after, createdNodeIds, createdRelationIds } = applyOperations(before, operations, allowed)
        await writeJson(legacyFile(id), after)
        return { before, after, createdNodeIds, createdRelationIds }
      }),
    },
  })
  const checkTask = (taskId: string, project: Project) => {
    const task = service.list().find(task => task.id === taskId)
    if (!task || task.workspaceId !== project.id || task.workspacePath !== project.root) throw new NativeServiceError('PATH_NOT_GRANTED')
    return task
  }
  return {
    close: () => service.cancelAll(),
    async call(method: string, input: JsonValue, project: Project): Promise<JsonValue> {
      if (method === 'maintenance.list') return json(service.list().filter(task => task.workspaceId === project.id && task.workspacePath === project.root))
      if (method === 'maintenance.start') {
        const args = start.parse(input), { blueprint } = await options.notes.projectView(project.root)
        return json(await service.start({ ...args, blueprintId: blueprint.id, workspaceId: project.id, workspacePath: project.root, workspaceName: project.name }))
      }
      if (method === 'maintenance.propose' || method === 'maintenance.dispatch') {
        const args = turn.parse(input); checkTask(args.taskId, project)
        return options.job(project.root, method, signal => {
          const request = { ...args, signal, chatSession: new ChatSessionRuntime(), workspaceIds: [project.id], workspaceRoots: { [project.id]: project.root } }
          return method === 'maintenance.propose' ? service.proposeForConversation(request) : service.composeDispatchBrief(request)
        })
      }
      if (method === 'maintenance.preview') {
        const args = z.object({ ...selection, conversationId: text }).strict().parse(input); checkTask(args.taskId, project)
        return json(await service.preview({ ...args, workspaceId: project.id, workspacePath: project.root }))
      }
      if (method === 'maintenance.apply') {
        const args = z.object({ ...selection, previewId: id, confirmedDeleteOperationIds: ids.optional() }).strict().parse(input); checkTask(args.taskId, project)
        return json(await service.apply(args))
      }
      if (['maintenance.cancel', 'maintenance.complete', 'maintenance.dismiss'].includes(method)) {
        const taskId = id.parse(input); checkTask(taskId, project)
        return json(method === 'maintenance.cancel' ? service.cancel(taskId) : method === 'maintenance.complete' ? service.complete(taskId) : service.dismissProposal(taskId))
      }
      throw new NativeServiceError('UNKNOWN_METHOD')
    },
  }
}
