import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parsePluginManifest, PluginError, validatePluginCall, validatePluginPath,
  normalizePluginKeybinding, type PluginManifest,
} from '../../packages/plugin-sdk/src/index'

const source = readFileSync('packages/plugin-sdk/template/manifest.json', 'utf8')
const sample = (): PluginManifest => JSON.parse(source)
const parse = (value: unknown) => parsePluginManifest(JSON.stringify(value))
const code = (action: () => unknown, expected: string) => {
  try { action(); expect.fail(`Expected ${expected}`) } catch (error) {
    expect(error).toBeInstanceOf(PluginError)
    expect((error as PluginError).code).toBe(expected)
  }
}

describe('public plugin manifest', () => {
  it('accepts the independent dual-view scaffold and the maintained contract sample', () => {
    expect(parsePluginManifest(source).contributes.views).toHaveLength(2)
    const note = readFileSync('.agents/notes/workbench/plugin-contract-v1.md', 'utf8')
    const example = note.match(/```json\s+([\s\S]*?)```/)![1]
    expect(parsePluginManifest(example)).toEqual(parsePluginManifest(source))
  })

  it.each([
    source.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 1,'),
    source.replace('"type": "openView"', '"type": "openView", "type": "openView"'),
    source.replace('"id": "details"', '"id": "details", "\\u0069d": "details"'),
    '// comment\n' + source, source.replace('"schemaVersion": 1,', '"schemaVersion": 1,,'),
    'null', '[]', '{"schemaVersion":1,}',
  ])('rejects malformed or duplicate-key JSON %#', (value) => code(() => parsePluginManifest(value), 'MANIFEST_INVALID'))

  it('rejects unknown fields and future contributions rather than silently ignoring them', () => {
    const value = sample()
    code(() => parse({ ...value, main: 'index.js' }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, contributes: { ...value.contributes, workbenches: [] } }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, contributes: { ...value.contributes, views: [{ ...value.contributes.views[0], scope: 'window' }] } }), 'MANIFEST_INVALID')
  })

  it('checks identity lengths, the built-in namespace, semver and required capabilities', () => {
    const value = sample()
    expect(parse({ ...value, id: 'a'.repeat(128) }).id).toHaveLength(128)
    for (const id of ['janusx.spoof', 'a'.repeat(129), 'ab', 'bad..id', 'bad.', '../bad']) code(() => parse({ ...value, id }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, version: 'latest' }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, engines: { pluginApi: '^2.0.0' } }), 'INCOMPATIBLE_API')
    code(() => parse({ ...value, capabilities: { required: ['future'], optional: [] } }), 'INCOMPATIBLE_API')
    expect(parse({ ...value, capabilities: { required: [], optional: ['future'] } })).toBeDefined()
    code(() => parse({ ...value, capabilities: { required: ['views.right'], optional: ['views.right'] } }), 'MANIFEST_INVALID')
  })

  it('rejects unsupported, duplicate and sensitive file permissions', () => {
    const value = sample()
    for (const name of ['net.fetch', 'workspace.files.write', 'terminal.execute', 'models.invoke']) {
      code(() => parse({ ...value, permissions: [{ name }] }), 'UNSUPPORTED_PERMISSION')
    }
    code(() => parse({ ...value, permissions: [value.permissions[0], value.permissions[0]] }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, permissions: [{ name: 'workspace.files.read', paths: ['.env.local'] }] }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, permissions: [{ name: 'ui.toast', paths: ['README.md'] }] }), 'MANIFEST_INVALID')
  })

  it('rejects duplicate IDs, dangling references and duplicate entries', () => {
    const value = sample()
    const contributes = value.contributes
    code(() => parse({ ...value, contributes: { ...contributes, views: [contributes.views[0], contributes.views[0]] } }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, contributes: { ...contributes, commands: [{ id: 'open', title: 'Open', action: { type: 'openView', view: 'missing' } }] } }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, contributes: { ...contributes, commands: [] } }), 'MANIFEST_INVALID')
    code(() => parse({ ...value, contributes: { ...contributes, menus: [contributes.menus![0], contributes.menus![0]] } }), 'MANIFEST_INVALID')
  })

  it('enforces byte budgets and single-instance first-version scope', () => {
    code(() => parsePluginManifest(' '.repeat(64 * 1024) + source), 'PACKAGE_LIMIT_EXCEEDED')
    code(() => parsePluginManifest('['.repeat(2000) + '0' + ']'.repeat(2000)), 'MANIFEST_INVALID')
    const value = sample()
    code(() => parse({ ...value, contributes: { ...value.contributes, views: [{ ...value.contributes.views[0], instancePolicy: 'multiple' }] } }), 'MANIFEST_INVALID')
  })

  it.each(['../escape.html', '/absolute.html', 'C:/file.html', 'a\\b.html', 'a//b.html', '%2e/file.html', 'a.html?x', 'a.html#x', 'a:stream', 'NUL.html', 'foo./a', 'foo /a', 'a\0b'])('rejects package path %j', (path) => {
    code(() => validatePluginPath(path), 'INVALID_PACKAGE_PATH')
    const value = sample()
    value.contributes.views[0].entry = path
    code(() => parse(value), 'INVALID_PACKAGE_PATH')
  })

  it.each(['Ctrl+R', 'Ctrl+Shift+P', 'Alt+F4', 'Ctrl+F12', 'R', 'Ctrl+Ctrl+R', 'Ctrl++R'])('rejects reserved or malformed shortcut %s', (key) => {
    const value = sample()
    value.contributes.keybindings![0].key = key
    code(() => parse(value), 'MANIFEST_INVALID')
  })

  it('normalizes modifier order and case without changing shortcut semantics', () => {
    expect(normalizePluginKeybinding('Shift+Alt+Ctrl+r')).toBe('Ctrl+Alt+Shift+R')
  })
})

describe('pure plugin call policy gate', () => {
  it('rejects unknown methods and calls outside the manifest permissions', () => {
    code(() => validatePluginCall(sample(), 'net.fetch', {}), 'UNKNOWN_METHOD')
    code(() => validatePluginCall(sample(), '__proto__', {}), 'UNKNOWN_METHOD')
    const value = sample()
    value.permissions = []
    code(() => validatePluginCall(value, 'workspace.readText', { path: 'README.md' }), 'PERMISSION_DENIED')
    expect(() => validatePluginCall(value, 'app.getInfo', {})).not.toThrow()
  })

  it('only permits exact declared files and own declared views', () => {
    expect(() => validatePluginCall(sample(), 'workspace.readText', { path: 'README.md' })).not.toThrow()
    code(() => validatePluginCall(sample(), 'workspace.readText', { path: 'src/index.ts' }), 'PATH_NOT_GRANTED')
    code(() => validatePluginCall(sample(), 'workspace.readText', { path: '.env' }), 'SENSITIVE_PATH_DENIED')
    code(() => validatePluginCall(sample(), 'workspace.readText', { path: 'README.md', rootId: 'spoof' }), 'INVALID_REQUEST')
    code(() => validatePluginCall(sample(), 'views.open', { view: 'other.plugin/view' }), 'INVALID_REQUEST')
  })

  it('rejects non-JSON storage values, dangerous keys and unbounded values', () => {
    for (const value of [undefined, NaN, Infinity, () => {}, new Date(), { nested: undefined }, 'x'.repeat(65536)]) {
      code(() => validatePluginCall(sample(), 'storage.set', { key: 'value', value }), 'INVALID_REQUEST')
    }
    code(() => validatePluginCall(sample(), 'storage.get', { key: '__proto__' }), 'INVALID_REQUEST')
    expect(() => validatePluginCall(sample(), 'storage.set', { key: 'value', value: { nested: [true, 2, null] } })).not.toThrow()
  })
})
