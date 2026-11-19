import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_CLI_TOOL_META,
  EXTERNAL_CLI_TOOL_ORDER,
} from '../../../src/shared/ipc/external-cli'
import { EXTERNAL_CLI_TOOLS, getExternalCliTool } from '../../../src/main/external-cli/tool-registry'

describe('external-cli tool registry', () => {
  it('keeps order, descriptors, and display metadata on the same id set', () => {
    expect([...EXTERNAL_CLI_TOOL_ORDER].sort()).toEqual(Object.keys(EXTERNAL_CLI_TOOLS).sort())
    expect([...EXTERNAL_CLI_TOOL_ORDER].sort()).toEqual(Object.keys(EXTERNAL_CLI_TOOL_META).filter(id => id !== 'janus').sort())
    for (const id of EXTERNAL_CLI_TOOL_ORDER) {
      const tool = getExternalCliTool(id)
      expect(tool?.displayName).toBe(EXTERNAL_CLI_TOOL_META[id]?.displayName)
      // Only active external tools have install strategies.
      expect(tool?.npmPackage).toMatch(/^(@[^/]+\/[^/]+|[^/]+)$/)
    }
  })

  it('rejects unknown ids at the IPC boundary', () => {
    expect(getExternalCliTool('shell')).toBeUndefined()
    expect(getExternalCliTool('')).toBeUndefined()
    expect(getExternalCliTool('janus')).toBeUndefined()
    expect(EXTERNAL_CLI_TOOL_META.janus.displayName).toBe('Janus')
  })
})
