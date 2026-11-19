import { resolve } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { CliDetector } from '../../../src/main/external-cli/cli-detector'
import { CliInstaller } from '../../../src/main/external-cli/installer'
import { EXTERNAL_CLI_TOOLS, getExternalCliTool } from '../../../src/main/external-cli/tool-registry'
import { EXTERNAL_CLI_TOOL_ORDER, type ExternalCliToolId } from '../../../src/shared/ipc/external-cli'

const VERSIONS: Record<ExternalCliToolId, string> = {
  janus: '0.2.0',
  claude: '1.2.3',
  codex: '0.30.0',
  opencode: '0.5.5',
  pi: '0.9.1',
  dsh: '0.1.0',
}

function detectorFor(toolId: ExternalCliToolId, files: string[], version: string, exitCode = 0) {
  const known = new Set(files.map((file) => resolve(file)))
  return new CliDetector(toolId, {
    env: { PATH: 'C:\\tools', APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
    platform: 'win32',
    homeDir: 'C:\\Users\\test',
    isRegularFile: async (candidate) => known.has(resolve(candidate)),
    run: async () => ({ exitCode, stdout: exitCode === 0 ? `${toolId} ${version}` : '', stderr: exitCode === 0 ? '' : 'boom' }),
  })
}

describe('external CLI tool matrix', () => {
  it('declares every ordered tool exactly once with a runnable strategy', () => {
    expect(Object.keys(EXTERNAL_CLI_TOOLS).sort()).toEqual([...EXTERNAL_CLI_TOOL_ORDER].sort())
    for (const toolId of EXTERNAL_CLI_TOOL_ORDER) {
      const tool = EXTERNAL_CLI_TOOLS[toolId]
      expect(tool.displayName.trim().length).toBeGreaterThan(0)
      expect(tool.binaryNames.length).toBeGreaterThan(0)
      expect(tool.manualInstallCommand.trim().length).toBeGreaterThan(0)
      // Active external tools use their npm distribution.
      expect(tool.npmPackage).toMatch(/^(@[^/]+\/[^/]+|[^/]+)$/)
    }
    expect(getExternalCliTool('janus')).toBeUndefined()
  })

  it.each(EXTERNAL_CLI_TOOL_ORDER)('detects %s on PATH with a parsed version', async (toolId) => {
    const binary = resolve(`C:\\tools\\${toolId}.cmd`)
    const detector = detectorFor(toolId, [binary], VERSIONS[toolId])
    await expect(detector.detect()).resolves.toMatchObject({
      toolId,
      installed: true,
      runnable: true,
      version: VERSIONS[toolId],
      path: binary,
      source: 'path',
    })
  })

  it.each(EXTERNAL_CLI_TOOL_ORDER)('marks %s installed-but-broken instead of guessing', async (toolId) => {
    const binary = resolve(`C:\\tools\\${toolId}.cmd`)
    const detector = detectorFor(toolId, [binary], VERSIONS[toolId], 1)
    await expect(detector.detect()).resolves.toMatchObject({
      toolId,
      installed: true,
      runnable: false,
    })
  })

  it('builds npm install commands for every active external tool', () => {
    const installer = new CliInstaller({
      platform: 'win32',
      env: { PATH: '' },
      homeDir: 'C:\\Users\\test',
      isRegularFile: async () => false,
      run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    })
    for (const toolId of EXTERNAL_CLI_TOOL_ORDER) {
      const command = installer.buildCommand('C:\\npm\\npm.cmd', EXTERNAL_CLI_TOOLS[toolId])
      expect(command.display).toContain(`i -g ${EXTERNAL_CLI_TOOLS[toolId].npmPackage}`)
    }
  })

  it('refuses to build an install command without an npm package', () => {
    const installer = new CliInstaller({
      platform: 'win32',
      env: { PATH: '' },
      homeDir: 'C:\\Users\\test',
      isRegularFile: async () => false,
      run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
    })
    const sourceless = { ...EXTERNAL_CLI_TOOLS.codex, npmPackage: undefined }
    expect(() => installer.buildCommand('C:\\npm\\npm.cmd', sourceless)).toThrow()
  })
})
