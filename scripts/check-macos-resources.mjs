// Note: .agents/notes/desktop/macos-compatibility.md — static evidence, not native execution.
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const cpus = { arm64: 0x0100000c, x64: 0x01000007 }
const version = number => [number >>> 16, (number >>> 8) & 255, number & 255].join('.')
function versionNumber(value) {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid minimum macOS version: ' + value)
  const [major, minor, patch = 0] = value.split('.').map(Number)
  return major * 65536 + minor * 256 + patch
}

/** These per-architecture resources must be little-endian 64-bit Mach-O, never a foreign/fat binary. */
export function inspectMachO(bytes, arch) {
  if (!Object.hasOwn(cpus, arch)) throw new Error('Unsupported Mac architecture: ' + arch)
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error('Expected a 64-bit Mach-O resource')
  if (bytes.readUInt32LE(4) !== cpus[arch]) throw new Error('Mach-O architecture mismatch: ' + arch)
  const count = bytes.readUInt32LE(16), end = 32 + bytes.readUInt32LE(20)
  if (end > bytes.length || count > 4096) throw new Error('Invalid Mach-O load commands')
  let offset = 32, minimum = 0
  for (let index = 0; index < count; index++) {
    if (offset + 8 > end) throw new Error('Truncated Mach-O load command')
    const command = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4)
    if (size < 8 || offset + size > end) throw new Error('Invalid Mach-O load command size')
    if (command === 0x32) { // LC_BUILD_VERSION
      if (size < 24 || bytes.readUInt32LE(offset + 8) !== 1) throw new Error('Expected a macOS build target')
      minimum = Math.max(minimum, bytes.readUInt32LE(offset + 12))
    } else if (command === 0x24) { // LC_VERSION_MIN_MACOSX
      if (size < 16) throw new Error('Truncated macOS version command')
      minimum = Math.max(minimum, bytes.readUInt32LE(offset + 8))
    }
    offset += size
  }
  if (offset !== end || !minimum) throw new Error('Missing or inconsistent macOS deployment target')
  return { architecture: arch, deploymentTarget: version(minimum), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function checkMacNativeResources({ root, arch }) {
  if (!Object.hasOwn(cpus, arch)) throw new Error('Unsupported Mac architecture: ' + arch)
  const config = parse(await readFile(path.join(root, 'electron-builder.yml'), 'utf8'))
  const declared = config.mac?.minimumSystemVersion
  // Reviewed 2026-11-15: Node 24.22.2 requires 13.5; OfficeCLI net10.0's supported OS list starts at 15.
  // The latter is a distribution support policy, not proof that lower versions cannot execute.
  if (typeof declared !== 'string' || versionNumber(declared) < versionNumber('15.0')) throw new Error('Mac distribution must declare at least 15.0 (OfficeCLI/.NET support policy)')
  if (!config.asarUnpack?.includes('node_modules/node-pty/**/*')) throw new Error('node-pty must be unpacked')
  const records = []
  for (const file of [`node_modules/node-pty/prebuilds/darwin-${arch}/pty.node`, `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`, `resources/officecli/darwin-${arch}/officecli`]) {
    const info = inspectMachO(await readFile(path.join(root, file)), arch)
    if (versionNumber(info.deploymentTarget) > versionNumber(declared)) throw new Error(file + ' requires macOS ' + info.deploymentTarget + ', above declared ' + declared)
    records.push({ file, ...info })
  }
  return { architecture: arch, minimumSystemVersion: declared, resources: records, nativeExecution: 'not-run', signatureAndNotarization: 'not-run' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const archIndex = process.argv.indexOf('--arch'), reportIndex = process.argv.indexOf('--report')
  const architectures = archIndex < 0 ? ['arm64', 'x64'] : [process.argv[archIndex + 1]]
  const report = { generatedAt: new Date().toISOString(), host: { platform: process.platform, arch: process.arch, node: process.version }, results: [] }
  for (const arch of architectures) {
    try { report.results.push({ status: 'passed', ...await checkMacNativeResources({ root, arch }) }) }
    catch (error) { report.results.push({ status: 'failed', architecture: arch, error: error.message }); process.exitCode = 1 }
  }
  if (reportIndex >= 0) {
    const target = path.resolve(process.argv[reportIndex + 1])
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report, null, 2))
}
