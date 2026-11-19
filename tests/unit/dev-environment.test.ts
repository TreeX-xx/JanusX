import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkDevEnvironment } from '../../scripts/check-dev-environment.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'janusx-dev-')); roots.push(root)
  const put = (path: string, text = '') => { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text) }
  put('package.json', JSON.stringify({ dependencies: { '@janus-agent/agent-core': 'file:../core' } }))
  return { root, put }
}
function tools(put: (path: string, text?: string) => void) {
  const shim = process.platform === 'win32' ? '.cmd' : ''
  for (const file of ['typescript/bin/tsc', `.bin/tsc${shim}`, 'electron-vite/bin/electron-vite.js', `.bin/electron-vite${shim}`, 'electron/cli.js']) put(`node_modules/${file}`)
  put('node_modules/electron/path.txt', 'electron.exe')
  put('node_modules/electron/dist/electron.exe')
  put('node_modules/@janus-agent/agent-core/package.json', JSON.stringify({ main: 'dist/index.js' }))
  put('node_modules/@janus-agent/agent-core/dist/index.js')
}

describe('dev startup prerequisites', () => {
  it('reports missing local tooling before the workspace invokes tsc', () => {
    const { root } = fixture()
    expect(checkDevEnvironment(root)[0]).toContain('npm ci --include=dev')
    expect(checkDevEnvironment(root)[0]).toContain('typescript/bin/tsc')
  })
  it('detects missing npm shims even when the TypeScript package exists', () => {
    const { root, put } = fixture(); tools(put)
    rmSync(join(root, `node_modules/.bin/tsc${process.platform === 'win32' ? '.cmd' : ''}`))
    expect(checkDevEnvironment(root)[0]).toContain('.bin/tsc')
  })
  it('reports skipped Electron installation and unbuilt sibling packages separately', () => {
    const { root, put } = fixture(); tools(put)
    rmSync(join(root, 'node_modules/electron/dist/electron.exe'))
    rmSync(join(root, 'node_modules/@janus-agent/agent-core/dist/index.js'))
    const issues = checkDevEnvironment(root)
    expect(issues).toHaveLength(2)
    expect(issues[0]).toContain('npm run postinstall')
    expect(issues[1]).toContain('npm run prepackage')
  })
  it('accepts a locally installed toolchain, runtime and built sibling', () => {
    const { root, put } = fixture(); tools(put)
    expect(checkDevEnvironment(root)).toEqual([])
  })
})
