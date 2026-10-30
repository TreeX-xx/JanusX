import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkPackageBoundary, parseFilesList, validateFilePatterns, validatePackagedPluginEntries } from '../../scripts/check-package-boundary.mjs'

const inclusions = ['**/*', 'package.json']

const treeExclusions = [
  '  - !.agents{,/**/*}',
  '  - !.cache{,/**/*}',
  '  - !.claude{,/**/*}',
  '  - !.codex{,/**/*}',
  '  - !.github{,/**/*}',
  '  - !.janusX{,/**/*}',
  '  - !.janusx{,/**/*}',
  '  - !artifacts{,/**/*}',
  '  - !apps{,/**/*}',
  '  - !scripts/android-lab{,/**/*}',
  '  - !scripts/remote-lab{,/**/*}',
  '  - !design{,/**/*}',
  '  - !docs{,/**/*}',
  '  - !packages{,/**/*}',
  '  - !plugins{,/**/*}',
  '  - !release{,/**/*}',
  '  - !src{,/**/*}',
  '  - !test-results{,/**/*}',
  '  - !tests{,/**/*}',
  '  - !wiki{,/**/*}',
]

function filesYaml(lines: string[]): string {
  return ['files:', ...lines, 'asarUnpack:', '  - node_modules/node-pty/**/*'].join('\n')
}

describe('package boundary parser', () => {
  it('accepts blanks and comments without truncating the files sequence', () => {
    const yaml = filesYaml(['  - **/*', '', '  # runtime renderer assets', '  - package.json', ...treeExclusions])

    expect(() => validateFilePatterns(parseFilesList(yaml))).not.toThrow()
  })

  it('accepts quoted and negated glob patterns', () => {
    const yaml = filesYaml([
      '  - "**/*"',
      '  - "!node_modules/.bin{,/**/*}"',
      '  - "!node_modules/.vite{,/**/*}"',
      '  - package.json',
      ...treeExclusions,
    ])

    expect(() => validateFilePatterns(parseFilesList(yaml))).not.toThrow()
  })

  it('accepts an extension-wide exclusion for a debug artifact class', () => {
    const yaml = filesYaml([
      '  - **/*',
      '  - "!node_modules/electron{,/**/*}"',
      '  - "!**/*.map"',
      '  - package.json',
      ...treeExclusions,
    ])

    expect(() => validateFilePatterns(parseFilesList(yaml))).not.toThrow()
  })

  it('rejects an extension-wide exclusion that is not a plain file suffix', () => {
    const yaml = filesYaml(['  - **/*', '  - "!**/*.{map,cjs}"', '  - package.json', ...treeExclusions])

    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/unknown paths/)
  })

  it('rejects dropping the verbatim tree inclusion', () => {
    const yaml = filesYaml(['  - package.json', ...treeExclusions])

    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/\*\*\/\*/)
  })

  it('rejects including a repository source directly', () => {
    const yaml = filesYaml(['  - **/*', '  - src', '  - package.json', ...treeExclusions])

    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/must not include/)
  })

  it('rejects a missing repository exclusion', () => {
    const yaml = filesYaml(['  - **/*', '  - package.json', ...treeExclusions.filter((p) => !p.includes('src'))])

    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/must exclude.*src/)
  })

  it('requires downloadable plugin trees to be excluded and rejects explicit payload reinclusion', () => {
    const yaml = filesYaml(['  - **/*', '  - package.json', ...treeExclusions.filter((p) => !p.includes('!plugins'))])
    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/must exclude.*plugins/)
    const reinclude = filesYaml(['  - **/*', '  - package.json', ...treeExclusions, '  - plugins/blueprint/dist/**/*'])
    expect(() => validateFilePatterns(parseFilesList(reinclude))).toThrow(/must not include/)
  })
  it('rejects duplicate entries', () => {
    const yaml = filesYaml(['  - **/*', '  - **/*', '  - package.json', ...treeExclusions])

    expect(() => validateFilePatterns(parseFilesList(yaml))).toThrow(/duplicate entries/)
  })

  it('rejects duplicate top-level files keys', () => {
    const yaml = `${filesYaml(['  - **/*', '  - package.json', ...treeExclusions])}\nfiles:\n  - out`

    expect(() => parseFilesList(yaml)).toThrow(/Duplicate top-level files key/)
  })

  it('rejects unsupported sequence content instead of truncating', () => {
    const yaml = filesYaml(['  - path: out/main/**'])

    expect(() => parseFilesList(yaml)).toThrow(/Unsupported files sequence content/)
  })
})

describe('downloadable plugin package boundary', () => {
  it('rejects source, vendor and runtime payloads in the assembled archive', () => {
    for (const path of ['plugins/blueprint/src/main/service.ts', '/plugins/blueprint/vendor/dependency.tgz',
      '\\plugins\\blueprint\\dist\\service.cjs', 'node_modules/@janusx/blueprint/dist/ui/main.js',
      'node_modules/@xyflow/react/package.json', 'node_modules/@xyflow/system/dist/esm/index.js']) {
      expect(() => validatePackagedPluginEntries(['out/main/index.js', path])).toThrow(/Downloadable plugin files/)
    }
    expect(() => validatePackagedPluginEntries(['out/main/plugin-mcp.js', 'out/main/chunks/plugin-runtime.js',
      'node_modules/@janusx/plugin-sdk/package.json', 'node_modules/@janus-agent/harness-node/dist/index.js'])).not.toThrow()
  })
})

describe('package output contract', () => {
  it('checks the declared main and bin entries, including a renamed MCP entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'janusx-boundary-'))
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content)
    }
    try {
      write('electron-builder.yml', filesYaml(['  - **/*', '  - package.json', ...treeExclusions]))
      write('package.json', JSON.stringify({ main: 'out/main/index.js', bin: { mcp: 'out/main/note-mcp.js' }, dependencies: { ai: '3.4.33', '@janusx/llm-core': 'file:packages/llm-core' } }))
      write('packages/llm-core/package.json', JSON.stringify({ peerDependencies: { ai: '3.4.33' }, devDependencies: { ai: '3.4.33' } }))
      write('tsconfig.json', '{}')
      for (const path of ['out/main/index.js', 'out/main/note-mcp.js', 'out/preload/index.mjs', 'out/renderer/index.html']) write(path, '')
      expect(() => checkPackageBoundary(root)).not.toThrow()
      rmSync(join(root, 'out/main/note-mcp.js'))
      expect(() => checkPackageBoundary(root)).toThrow('out/main/note-mcp.js')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
