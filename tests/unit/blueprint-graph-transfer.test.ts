import { expect, it } from 'vitest'
import { nativeValueSchema } from '@janusx/plugin-sdk'
import { GraphTransfers } from '../../plugins/blueprint/src/main/graph-transfer'

it('preserves Unicode and escapes across part boundaries and rejects foreign, invalid and released transfers', () => {
  const transfers = new GraphTransfers()
  const source = { text: '汉字\n"\\😀'.repeat(150_000) }
  const snapshot = transfers.open('/root', 1, source)
  const parts: string[] = []
  for (let index = 0; index < snapshot.parts; index++) {
    const part = transfers.part('/root', 1, snapshot.id, index)
    expect(nativeValueSchema.safeParse(part).success).toBe(true)
    parts.push(part.text)
  }
  expect(JSON.parse(parts.join(''))).toEqual(source)
  expect(() => transfers.part('/other', 1, snapshot.id, 0)).toThrow('RESOURCE_CHANGED')
  expect(() => transfers.part('/root', 2, snapshot.id, 0)).toThrow('RESOURCE_CHANGED')
  expect(() => transfers.part('/root', 1, snapshot.id, snapshot.parts)).toThrow('INVALID_REQUEST')
  transfers.release(1)
  expect(() => transfers.part('/root', 1, snapshot.id, 0)).toThrow('RESOURCE_CHANGED')
})
