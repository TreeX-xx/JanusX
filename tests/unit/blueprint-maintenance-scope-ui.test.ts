import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Blueprint } from '../../plugins/blueprint/src/shared/janus/types'
const graph = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/src/services/harness', () => ({ projectGraph: graph }))
import { resolveMaintenanceContext } from '../../src/renderer/src/components/blueprint/maintenanceContext'

const uri = 'note://repo/node'
const source = (path: string, hash = 'hash-a') => ({ id: 'harness:project:' + path, nodes: { node: { id: 'node', sourceUri: uri, sourceHash: hash } }, composition: { nodes: { node: { path, status: 'bound' } } } } as unknown as Blueprint)

describe('maintenance checkout context', () => {
  beforeEach(() => { graph.mockReset() })
  it('routes the same repo and URI through the selected checkout, preserving its hash', async () => {
    const composed = source('C:/checkout-b', 'hash-b')
    graph.mockImplementation(async (path: string) => ({ blueprint: source(path, path.endsWith('b') ? 'hash-b' : 'hash-a') }))
    await expect(resolveMaintenanceContext(composed, 'node', 'C:/checkout-a')).resolves.toMatchObject({ checkoutPath: 'C:/checkout-b', graphId: 'harness:project:C:/checkout-b', uri, expectedHash: 'hash-b', stale: false })
    expect(graph).toHaveBeenCalledExactlyOnceWith('C:/checkout-b')
  })
  it('keeps a stale displayed hash visible instead of silently accepting a newer source', async () => {
    graph.mockResolvedValue({ blueprint: source('C:/checkout-b', 'new-hash') })
    await expect(resolveMaintenanceContext(source('C:/checkout-b'), 'node', null)).resolves.toMatchObject({ expectedHash: 'hash-a', stale: true })
  })
  it('rejects unbound and ambiguous source identities', async () => {
    const unbound = source('C:/checkout-b')
    unbound.composition!.nodes.node.status = 'unbound'
    await expect(resolveMaintenanceContext(unbound, 'node', 'C:/checkout-a')).rejects.toThrow('MAINTENANCE_CHECKOUT_UNAVAILABLE')
    expect(graph).not.toHaveBeenCalled()
    const duplicate = source('C:/checkout-b')
    duplicate.nodes.other = { ...duplicate.nodes.node, id: 'other' }
    graph.mockResolvedValue({ blueprint: duplicate })
    await expect(resolveMaintenanceContext(source('C:/checkout-b'), 'node', null)).rejects.toThrow('MAINTENANCE_SOURCE_UNAVAILABLE')
  })
})
