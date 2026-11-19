import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { inspectMachO, checkMacNativeResources } from '../../scripts/check-macos-resources.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
for (const arch of ['arm64', 'x64']) test('inspects actual node-pty resources for ' + arch, async () => {
  const bytes = await readFile(new URL(`../../node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`, import.meta.url))
  const result = inspectMachO(bytes, arch)
  assert.equal(result.architecture, arch)
  assert.match(result.deploymentTarget, /^\d+\.\d+\.\d+$/)
  assert.throws(() => inspectMachO(bytes, arch === 'arm64' ? 'x64' : 'arm64'), /architecture mismatch/)
  assert.throws(() => inspectMachO(bytes.subarray(0, 40), arch), /Invalid Mach-O/)
  const invalid = Buffer.from(bytes); invalid.writeUInt32LE(0, 36)
  assert.throws(() => inspectMachO(invalid, arch), /load command size/)
})
test('rejects foreign formats and missing deployment metadata', () => {
  assert.throws(() => inspectMachO(Buffer.from('MZ'), 'x64'), /Mach-O/)
  const bytes = Buffer.alloc(32); bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x0100000c, 4)
  assert.throws(() => inspectMachO(bytes, 'arm64'), /deployment target/)
})
// Office assets are downloaded explicitly; the packaging hook itself must fail if absent.
test('rejects invalid architecture before packaging', async () => {
  await assert.rejects(checkMacNativeResources({ root, arch: 'universal' }), /Unsupported Mac architecture/)
})
