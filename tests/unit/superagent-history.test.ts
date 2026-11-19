import { readFile, stat } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { SuperAgentHistory } from '../../src/main/janus/superagent/history'
import { createWork, otherWorkspace, recordExecution, submission, superAgentFixture, workspace } from '../helpers/superagent-fixture'

it('reads an old profile without execution, observes later publications, and refuses cross-workspace resources', async () => {
  const fixture = await superAgentFixture()
  try {
    const scope = workspace.workspaceId
    const work = await createWork(fixture.store)
    await recordExecution(fixture.store, work.id)
    const history = new SuperAgentHistory(fixture.root, async id =>
      [scope, otherWorkspace.workspaceId].includes(id) ? fixture.root : undefined)
    expect((await history.workDetail(scope, work.id)).executions).toHaveLength(1)
    const input = submission('Preserve this old original')
    const accepted = await fixture.store.receiveInput(workspace, input)
    expect((await fixture.store.receiveInput(workspace, input)).duplicate).toBe(true)
    await fixture.store.close()
    const filename = fixture.persistence.indexPath
    const before = await readFile(filename), stamp = (await stat(filename)).mtimeMs
    expect((await history.snapshot(scope)).inputs.at(-1)?.id).toBe(accepted.input.id)
    expect((await history.readResource(scope, accepted.input.resourceId)).text).toBe(input.text)
    await expect(history.readResource(otherWorkspace.workspaceId, accepted.input.resourceId)).rejects.toThrow()
    await expect(history.workDetail('unregistered', work.id)).rejects.toThrow('not registered')
    expect(await readFile(filename)).toEqual(before)
    expect((await stat(filename)).mtimeMs).toBe(stamp)
  } finally { await fixture.dispose() }
})
