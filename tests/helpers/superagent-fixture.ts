import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { SuperAgentPersistence, type AtomicWriter } from '../../src/main/janus/superagent/persistence'
import { SuperAgentStore } from '../../src/main/janus/superagent/store'

export const workspace = { workspaceId: 'workspace-a', workspacePath: 'C:/repos/a' }
export const otherWorkspace = { workspaceId: 'workspace-b', workspacePath: 'C:/repos/b' }
export const submission = (text = 'Implement the requested feature', eventId = randomUUID()) => ({
  eventId, workspaceId: workspace.workspaceId, conversationId: 'conversation-a', text,
})

export async function superAgentFixture() {
  const root = await mkdtemp(join(tmpdir(), 'janusx-superagent-test-'))
  const stores: SuperAgentStore[] = []
  const createStore = (writer?: AtomicWriter) => {
    const persistence = new SuperAgentPersistence(root, writer)
    const store = new SuperAgentStore(persistence)
    stores.push(store)
    return { persistence, store }
  }
  return {
    root, createStore, ...createStore(),
    async dispose() {
      await Promise.all(stores.map(store => store.close()))
      const target = resolve(root)
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('janusx-superagent-test-')) {
        throw new Error('Refusing cleanup outside the test temp directory')
      }
      await rm(target, { recursive: true, force: true })
    },
  }
}

export async function createWork(store: SuperAgentStore, title = 'Feature A') {
  const { input } = await store.receiveInput(workspace, submission())
  return store.createWork(workspace.workspaceId, { creationId: randomUUID(), sourceInputId: input.id, title, goal: title })
}

export async function recordExecution(store: SuperAgentStore, workId: string) {
  const { work } = await store.workDetail(workspace.workspaceId, workId)
  return store.recordExecution(workspace.workspaceId, {
    executionId: randomUUID(), workId, expectedRevision: work.revision,
    instanceId: randomUUID(), cwd: workspace.workspacePath,
    providerSessionId: 'native-session', nativeTurnId: randomUUID(),
  })
}
