import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { AutomationService } from '../../src/main/automations/service'
import { atomicJson } from '../../src/main/automations/storage'
import { reminderTemplate } from '../../src/shared/automations'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'janus-cards-'))
  cleanups.push(async () => { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }) })
  const clock = { now: Date.parse('2026-11-04T00:00:00Z') }
  const ports = { resolveWorkspace: vi.fn(), review: vi.fn(), changed: vi.fn(), completed: vi.fn(), removed: vi.fn(), now: () => clock.now }
  const restart = async () => { const service = new AutomationService(directory, ports); await service.initialize(false); cleanups.push(() => service.stop()); return service }
  return { directory, clock, ports, restart, service: await restart() }
}
it('schedules and disables sibling tasks independently, and keeps the group name separate', async () => {
  const { service, clock, ports } = await fixture()
  const card = await service.saveCard('Daily work')
  const one = await service.save({ ...reminderTemplate('One minute'), cardId: card.id, enabled: true })
  const two = await service.save({ ...reminderTemplate('Two minutes'), cardId: card.id, enabled: true, intervalMinutes: 2 })
  const nextTwo = two.nextRunAt
  clock.now += 60_000; await service.tick()
  await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledOnce())
  expect(service.history(one.id)[0]).toMatchObject({ message: 'One minute', trigger: 'scheduled' })
  expect(service.history(two.id)).toEqual([])
  await service.save({ ...service.input(service.list().find(task => task.id === one.id)!), enabled: false, name: 'Paused task' }, one.id, one.revision)
  expect(service.list().find(task => task.id === two.id)?.nextRunAt).toBe(nextTwo)
  const latest = service.listCards()[0]; await service.saveCard('Renamed group', latest.id, latest.revision)
  expect(service.list().map(task => task.name)).toEqual(['Paused task', 'Two minutes'])
  clock.now += 60_000; await service.tick()
  await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledTimes(2))
  expect(service.history(one.id)).toHaveLength(1); expect(service.history(two.id)).toHaveLength(1)
})
it('removing tasks retains the card, siblings and their histories across restart, including an empty card', async () => {
  const { service, ports, restart } = await fixture()
  const card = await service.saveCard('Keep container')
  const one = await service.save({ ...reminderTemplate('Delete only me'), cardId: card.id })
  const two = await service.save({ ...reminderTemplate('Keep me'), cardId: card.id })
  await service.run(two.id, 'manual'); await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledOnce())
  await service.remove(one.id, one.revision); await service.stop()
  const restored = await restart()
  expect(restored.list().map(task => task.id)).toEqual([two.id]); expect(restored.listCards()[0].name).toBe(card.name)
  expect(restored.history(two.id)).toHaveLength(1)
  await restored.remove(two.id, two.revision); await restored.stop()
  const empty = await restart(); expect(empty.list()).toEqual([]); expect(empty.listCards()).toHaveLength(1)
})
it('migrates a legacy definition to one task without changing its ID, revision, schedule, cursor or runs', async () => {
  const { service, directory, ports, restart } = await fixture()
  const task = await service.save({ ...reminderTemplate('Legacy'), enabled: true })
  await service.run(task.id, 'legacy-run'); await vi.waitFor(() => expect(ports.completed).toHaveBeenCalledOnce())
  await service.stop()
  const { cardId: _cardId, ...legacy } = task
  await atomicJson(join(directory, task.id, 'definition.json'), legacy)
  await rm(join(directory, 'cards', `${task.cardId}.json`))
  const cursor = await readFile(join(directory, task.id, 'cursor.json'), 'utf8')
  const restored = await restart()
  expect(restored.list()[0]).toEqual(task); expect(restored.listCards()[0]).toMatchObject({ id: task.id, name: task.name })
  expect(restored.history(task.id)[0].occurrenceKey).toBe(`${task.id}:manual:legacy-run`)
  expect(await readFile(join(directory, task.id, 'cursor.json'), 'utf8')).toBe(cursor)
  expect(ports.completed).toHaveBeenCalledOnce()
})
it('invalidates group deletion after child changes and prevents saves into a deleted card', async () => {
  const { service } = await fixture()
  const card = await service.saveCard('Group')
  const task = await service.save({ ...reminderTemplate('First'), cardId: card.id })
  await expect(service.removeCard(card.id, card.revision)).rejects.toThrow('revision_conflict')
  const current = service.listCards()[0]
  await service.save({ ...service.input(task), name: 'Edited' }, task.id, task.revision)
  await expect(service.removeCard(card.id, current.revision)).rejects.toThrow('revision_conflict')
  await service.removeCard(card.id, service.listCards()[0].revision)
  expect(service.list()).toEqual([]); expect(service.listCards()).toEqual([])
  await expect(service.save({ ...reminderTemplate('Late draft'), cardId: card.id })).rejects.toThrow('card not found')
})
it('recovers a group deletion before replaying child edit journals and preserves unrelated cards', async () => {
  const { service, directory, restart } = await fixture()
  const card = await service.saveCard('Delete group')
  const tasks = await Promise.all(['one', 'two'].map(message => service.save({ ...reminderTemplate(message), cardId: card.id })))
  const keep = await service.save(reminderTemplate('Keep'))
  await service.stop()
  for (const task of tasks) await atomicJson(join(directory, task.id, 'edit.json'), { definition: task, cursor: JSON.parse(await readFile(join(directory, task.id, 'cursor.json'), 'utf8')) })
  await atomicJson(join(directory, 'cards', `${card.id}.json`), { ...service.listCards().find(item => item.id === card.id), deletedTaskIds: tasks.map(task => task.id) })
  const restored = await restart()
  expect(restored.list().map(task => task.id)).toEqual([keep.id]); expect(restored.listCards().map(item => item.id)).toEqual([keep.cardId])
  for (const task of tasks) await expect(readFile(join(directory, task.id, 'edit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
