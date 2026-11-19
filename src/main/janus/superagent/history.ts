// Note: .agents/notes/agent/superagent-plugin-migration.md — history has no execution or recovery hooks.
import { SuperAgentPersistence } from './persistence'
import { SuperAgentStore } from './store'
import { identity } from './schema'

export class SuperAgentHistory {
  constructor(private directory: string, private resolveRoot: (id: string) => Promise<string | undefined>) {}

  private async open(workspace: unknown) {
    const id = identity.parse(workspace)
    if (!await this.resolveRoot(id)) throw new Error('SuperAgent workspace is not registered')
    // The live writer publishes records.json by atomic rename. A new reader sees the latest
    // published revision even if a previous activation wrote it in a different process.
    return { id, store: new SuperAgentStore(new SuperAgentPersistence(this.directory)) }
  }

  async snapshot(workspace: unknown) {
    const { id, store } = await this.open(workspace)
    return store.snapshot(id)
  }

  async workDetail(workspace: unknown, workId: unknown) {
    const work = identity.parse(workId)
    const { id, store } = await this.open(workspace)
    return store.workDetail(id, work)
  }

  async readResource(workspace: unknown, resourceId: unknown) {
    const resource = identity.parse(resourceId)
    const { id, store } = await this.open(workspace)
    return store.readResource(id, resource)
  }
}
