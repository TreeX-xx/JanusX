import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePackage } from '../../scripts/prepare-package.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), 'janusx-package-test-')); roots.push(temp)
  const root = join(temp, 'app'), source = join(temp, 'core'), leaf = join(temp, 'leaf')
  mkdirSync(root); mkdirSync(join(source, 'dist'), { recursive: true }); mkdirSync(leaf)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'package-test', version: '1.0.0', private: true, dependencies: { '@janus-agent/agent-core': 'file:../core' } }))
  const manifest = { name: '@janus-agent/agent-core', version: '1.0.0', main: 'dist/index.js', files: ['dist'] }
  writeFileSync(join(source, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(source, 'dist/index.js'), 'module.exports = "before"')
  writeFileSync(join(source, 'dist/obsolete.js'), 'old')
  writeFileSync(join(source, 'private.txt'), 'never ship')
  writeFileSync(join(leaf, 'package.json'), JSON.stringify({ name: 'probe-leaf', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(leaf, 'index.js'), 'module.exports = 1')
  return { root, source, leaf, manifest, installed: join(root, 'node_modules/@janus-agent/agent-core') }
}
const options = { installArgs: ['--offline', '--ignore-scripts', '--no-audit', '--no-fund'] }

describe('local package materialization', () => {
  it('refreshes changed and deleted files plus dependency metadata, respecting npm files rules', () => {
    const { root, source, leaf, manifest, installed } = fixture()
    expect(preparePackage(root, options)).toEqual(['@janus-agent/agent-core'])
    const originalLock = readFileSync(join(root, 'package-lock.json'), 'utf8')
    expect(preparePackage(root, options)).toEqual([])
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(originalLock)
    expect(existsSync(join(installed, 'private.txt'))).toBe(false)
    writeFileSync(join(source, 'dist/index.js'), 'module.exports = "after"')
    rmSync(join(source, 'dist/obsolete.js'))
    writeFileSync(join(source, 'dist/new.js'), 'new')
    writeFileSync(join(source, 'package.json'), JSON.stringify({ ...manifest, dependencies: { 'probe-leaf': `file:${leaf.replace(/\\/g, '/')}` } }))
    expect(preparePackage(root, options)).toEqual(['@janus-agent/agent-core'])
    expect(readFileSync(join(installed, 'dist/index.js'), 'utf8')).toContain('after')
    expect(existsSync(join(installed, 'dist/obsolete.js'))).toBe(false)
    expect(existsSync(join(installed, 'dist/new.js'))).toBe(true)
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    expect(lock.packages['node_modules/@janus-agent/agent-core'].dependencies).toHaveProperty('probe-leaf')
    expect(existsSync(join(root, 'node_modules/probe-leaf/index.js'))).toBe(true)
  }, 30000)

  it('fails before npm runs if the sibling or its build output is missing', () => {
    const { root, source } = fixture()
    rmSync(join(source, 'dist/index.js'))
    const npm = () => { throw new Error('npm must not run') }
    expect(() => preparePackage(root, { npm })).toThrow('Missing build output')
    rmSync(source, { recursive: true })
    expect(() => preparePackage(root, { npm })).toThrow('Missing sibling package')
  })

  it('restores the prior local package and lockfile if installation fails', () => {
    const { root, source, installed } = fixture()
    const files = ['package.json', 'dist/index.js', 'dist/obsolete.js'].map((path) => ({ path }))
    // Only the successful-path test needs real npm publication/install. Seed
    // the prior generation directly so rollback does not depend on npm speed.
    mkdirSync(join(installed, 'dist'), { recursive: true })
    for (const { path } of files) copyFileSync(join(source, path), join(installed, path))
    const lockPath = join(root, 'package-lock.json')
    const hiddenLockPath = join(root, 'node_modules/.package-lock.json')
    const originalLock = JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/@janus-agent/agent-core': { version: '1.0.0', resolved: 'file:../core' },
    } }, null, 2) + '\n'
    const originalHiddenLock = JSON.stringify({ lockfileVersion: 3, packages: {} }) + '\n'
    writeFileSync(lockPath, originalLock)
    writeFileSync(hiddenLockPath, originalHiddenLock)
    writeFileSync(join(source, 'dist/index.js'), 'after')
    const npm = (args: string[]) => {
      if (args[0] === 'pack') return JSON.stringify([{ name: '@janus-agent/agent-core', files }])
      // Simulate a failed install that already wrote a partial generation.
      mkdirSync(join(installed, 'dist'), { recursive: true })
      writeFileSync(join(installed, 'dist/index.js'), 'partial install')
      writeFileSync(join(installed, 'partial.txt'), 'incomplete')
      writeFileSync(lockPath, 'partial lock')
      writeFileSync(hiddenLockPath, 'partial hidden lock')
      throw new Error('install failed')
    }
    expect(() => preparePackage(root, { npm })).toThrow('install failed')
    expect(readFileSync(join(installed, 'dist/index.js'), 'utf8')).toContain('before')
    expect(readFileSync(join(installed, 'dist/obsolete.js'), 'utf8')).toBe('old')
    expect(existsSync(join(installed, 'partial.txt'))).toBe(false)
    expect(readFileSync(lockPath, 'utf8')).toBe(originalLock)
    expect(readFileSync(hiddenLockPath, 'utf8')).toBe(originalHiddenLock)
  })
})
