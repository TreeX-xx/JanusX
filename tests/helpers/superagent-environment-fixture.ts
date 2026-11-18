import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { controlledGit } from '../../src/main/git/controlled-worktree'
import { SuperAgentEnvironmentStore } from '../../src/main/janus/superagent/environment-store'
import { SuperAgentEnvironments, type SuperAgentGitEffects } from '../../src/main/janus/superagent/environments'
import type { AtomicWriter } from '../../src/main/janus/superagent/persistence'
import { superAgentFixture } from './superagent-fixture'

export async function environmentFixture() {
  const records = await superAgentFixture()
  const repo = join(records.root, 'repo with space 中文')
  await mkdir(repo)
  const git = (args: string[], cwd = repo) => controlledGit(cwd, args).then(value => value.trim())
  await git(['init', '-b', 'main'])
  await git(['config', 'user.name', 'P2 fixture'])
  await git(['config', 'user.email', 'p2@example.invalid'])
  await git(['config', 'core.autocrlf', 'false'])
  await writeFile(join(repo, 'feature.txt'), 'initial\n')
  await writeFile(join(repo, '.gitignore'), 'node_modules\n.env\n.env.local\n')
  await git(['add', '.']); await git(['commit', '-m', 'Initial fixture'])
  const workspace = { workspaceId: 'workspace-p2', workspacePath: repo }
  let time = 1000
  let registeredPath = repo
  const occupied: string[] = []
  const services: SuperAgentEnvironments[] = []
  const createService = (writer?: AtomicWriter, effects?: SuperAgentGitEffects) => {
    const ledger = new SuperAgentEnvironmentStore(records.root, writer)
    const service = new SuperAgentEnvironments(ledger, records.store, async id => id === workspace.workspaceId ? registeredPath : undefined,
      () => occupied, () => time, effects)
    services.push(service)
    return service
  }
  const service = createService()
  return {
    ...records, repo, git, workspace, service, occupied, createService,
    advance: (ms: number) => { time += ms },
    registeredPath: (path: string) => { registeredPath = path },
    async work() {
      const { input } = await records.store.receiveInput(workspace, { eventId: randomUUID(), workspaceId: workspace.workspaceId, conversationId: 'chat', text: 'Implement a feature' })
      return records.store.createWork(workspace.workspaceId, { creationId: randomUUID(), sourceInputId: input.id, title: 'Feature', goal: 'Implement a feature' })
    },
    async commit(cwd: string, text: string, file = 'feature.txt') {
      await writeFile(join(cwd, file), text)
      await git(['add', '--', file], cwd)
      await git(['commit', '-m', 'Fixture change'], cwd)
    },
    async dispose() {
      await Promise.all(services.map(service => service.close()))
      await records.dispose()
    },
  }
}
