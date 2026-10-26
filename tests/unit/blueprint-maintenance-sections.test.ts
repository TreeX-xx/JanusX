import { expect, it } from 'vitest'
import { editMaintenanceSections } from '../../plugins/blueprint/src/main/notes/maintenance-sections'

it('preserves nested headings and code when removing an added section', () => {
  const original = '# Document\n\n## Design\n\n    indented code\n\n### Detail\n\n~~~md\n## Fake heading\n~~~\n\n## Next\n\nKeep.\n'
  const added = editMaintenanceSections(original, { Extra: 'Optional prose.' })
  expect(added.before).toEqual({ Extra: null })
  const removed = editMaintenanceSections(added.body, added.before)
  expect(removed.body).toBe(original)
  const replaced = editMaintenanceSections(original, { Design: 'New design.' })
  expect(replaced.before.Design).toContain('    indented code')
  expect(replaced.before.Design).toContain('## Fake heading')
  expect(replaced.body).toContain('## Next\n\nKeep.')
  expect(editMaintenanceSections(replaced.body, replaced.before).body).toBe(original)
})

it('refuses ambiguous headings before changing either occurrence', () => {
  expect(() => editMaintenanceSections('# Doc\n\n## Same\n\nOne\n\n## Same\n\nTwo', { Same: null })).toThrow('Ambiguous')
})
