import { afterEach, expect, it, vi } from 'vitest'
import { SettingsAutosave, type SettingsSaveState } from '../../plugins/blueprint/src/ui/settings-autosave'
import { DEFAULT_BLUEPRINT_REVIEW_SETTINGS, type BlueprintSettingsSnapshot } from '../../plugins/blueprint/src/shared/blueprint-review-settings'

afterEach(() => vi.useRealTimers())
const snapshot = (): BlueprintSettingsSnapshot => ({ value: structuredClone(DEFAULT_BLUEPRINT_REVIEW_SETTINGS), revision: 'a'.repeat(64) })

it('coalesces text edits, rejects invalid input and applies the latest valid value automatically', async () => {
  vi.useFakeTimers()
  const base = snapshot(), states: SettingsSaveState[] = []
  const persist = vi.fn(async value => ({ value, revision: 'b'.repeat(64) }))
  const save = new SettingsAutosave(base, persist, value => states.push(value))
  save.change({ ...base.value, automatic: { enabled: false, commits: 0 } })
  await vi.runAllTimersAsync()
  expect(persist).not.toHaveBeenCalled()
  expect(states.at(-1)?.phase).toBe('invalid')
  save.change({ ...base.value, automatic: { enabled: false, commits: 7 } })
  save.change({ ...base.value, automatic: { enabled: false, commits: 9 } })
  await vi.runAllTimersAsync()
  expect(persist).toHaveBeenCalledTimes(1)
  expect(persist.mock.calls[0][0].automatic.commits).toBe(9)
  expect(states.at(-1)?.phase).toBe('saved')
})

it('serializes edits made during a write and uses its returned revision for the next write', async () => {
  vi.useFakeTimers()
  const base = snapshot()
  let release!: (value: BlueprintSettingsSnapshot) => void
  const persist = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockImplementationOnce(async value => ({ value, revision: 'c'.repeat(64) }))
  const save = new SettingsAutosave(base, persist, () => {})
  const first = { ...base.value, automatic: { enabled: false, commits: 7 } }
  save.change(first)
  await vi.advanceTimersByTimeAsync(350)
  save.change({ ...first, automatic: { enabled: false, commits: 11 } })
  await vi.advanceTimersByTimeAsync(350)
  expect(persist).toHaveBeenCalledTimes(1)
  release({ value: first, revision: 'b'.repeat(64) })
  await vi.runAllTimersAsync()
  expect(persist).toHaveBeenCalledTimes(2)
  expect(persist.mock.calls[1][1]).toBe('b'.repeat(64))
  expect(save.base.value.automatic.commits).toBe(11)
})

it('stops after a conflict and preserves later edits until an explicit reload; closing cancels unsent work', async () => {
  vi.useFakeTimers()
  const base = snapshot(), states: SettingsSaveState[] = []
  const persist = vi.fn().mockRejectedValueOnce(new Error('RESOURCE_CHANGED'))
    .mockImplementation(async value => ({ value, revision: 'c'.repeat(64) }))
  const save = new SettingsAutosave(base, persist, value => states.push(value))
  save.change({ ...base.value, automatic: { enabled: false, commits: 7 } })
  await vi.runAllTimersAsync()
  save.change({ ...base.value, automatic: { enabled: false, commits: 8 } })
  await vi.runAllTimersAsync()
  expect(persist).toHaveBeenCalledTimes(1)
  expect(states.at(-1)?.error).toContain('RESOURCE_CHANGED')
  save.reset({ ...base, revision: 'b'.repeat(64) })
  save.change({ ...base.value, automatic: { enabled: false, commits: 9 } })
  await vi.runAllTimersAsync()
  expect(persist.mock.calls[1][1]).toBe('b'.repeat(64))
  save.change(base.value)
  save.dispose()
  await vi.runAllTimersAsync()
  expect(persist).toHaveBeenCalledTimes(2)
})

it('retains invalid edits made during a write and reports them after the valid write completes', async () => {
  vi.useFakeTimers()
  const base = snapshot(), states: SettingsSaveState[] = []
  let release!: (value: BlueprintSettingsSnapshot) => void
  const persist = vi.fn(() => new Promise<BlueprintSettingsSnapshot>(resolve => { release = resolve }))
  const save = new SettingsAutosave(base, persist, state => states.push(state))
  const value = { ...base.value, automatic: { enabled: false, commits: 7 } }
  save.change(value)
  await vi.advanceTimersByTimeAsync(350)
  save.change({ ...value, automatic: { enabled: false, commits: 0 } })
  await vi.advanceTimersByTimeAsync(350)
  expect(save.saving).toBe(true)
  release({ value, revision: 'b'.repeat(64) })
  await vi.runAllTimersAsync()
  expect(save.saving).toBe(false)
  expect(save.base.value.automatic.commits).toBe(7)
  expect(states.at(-1)?.phase).toBe('invalid')
  expect(persist).toHaveBeenCalledTimes(1)
})
