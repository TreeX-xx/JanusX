import { expect, it, vi } from 'vitest'
import { ToolRegistry } from '@janus-agent/agent-core'
import { registerSuggestionTools, type SuggestionToolHost } from '../../plugins/blueprint/src/main/blueprint/suggestions/tools'
const repoId = '11111111-1111-4111-8111-111111111111'
const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
it('filters direct module ownership, returns bounded summaries and refuses unstable continuation', async () => {
  const registry = new ToolRegistry(), target = { repoId, branch: 'main', workspacePath: 'C:/fixture' }
  let revision = 7
  const read = vi.fn(async () => ({ revision, sourceComplete: true, items: [3, 1, 2, 4].map(n => ({
    noteId: id(n), source: { module: `note://${repoId}/${id(n === 4 ? 9 : 1)}` }, availability: 'available', reportRevision: 2,
    pending: null, error: null, report: { stale: false, coverage: 'complete', findings: [{ id: id(10 + n), summary: 'Issue ' + n, explanation: 'Full evidence', citations: [{ quote: 'exact bytes' }], stale: false }] },
  })) }))
  registerSuggestionTools(registry, () => ({ sources: { context: async () => target }, suggestions: { read } }) as unknown as SuggestionToolHost)
  const query = (args: unknown) => registry.get('note.suggestions')!.execute!(args, { workspaceId: 'fixture', workspaceRoot: 'C:/fixture', signal: new AbortController().signal }) as Promise<any>
  const first = await query({ moduleId: id(1), limit: 2 })
  expect(first.total).toBe(3); expect(first.nextOffset).toBe(2)
  expect(first.items.map((item: any) => item.noteId)).toEqual([id(1), id(2)])
  expect(first.items[0].report.findings[0].explanation).toBeUndefined()
  const second = await query({ moduleId: id(1), limit: 2, offset: 2, expectedRevision: first.revision })
  expect(second.items.map((item: any) => item.noteId)).toEqual([id(3)]); expect(second.nextOffset).toBeNull()
  expect((await query({ noteId: id(2) })).items[0].report.findings[0].explanation).toBe('Full evidence')
  await expect(query({ offset: 1 })).rejects.toThrow('expectedRevision')
  revision++
  await expect(query({ offset: 2, expectedRevision: first.revision })).rejects.toThrow('restart pagination')
  await expect(query({ limit: 51 })).rejects.toThrow()
})
