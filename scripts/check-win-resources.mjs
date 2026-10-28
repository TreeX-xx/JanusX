import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const binary = new URL('../resources/officecli/officecli.exe', import.meta.url)
const expected = '937db176b585e874aa5bff48d536bce78037665cd862b5deefe56e79977e6588'
let bytes
try { bytes = readFileSync(binary) }
catch { throw new Error('Missing resources/officecli/officecli.exe. Prepare OfficeCLI 1.0.135 (Windows x64) before packaging; see resources/officecli/README.md.') }
if (createHash('sha256').update(bytes).digest('hex') !== expected) {
  throw new Error('Bundled OfficeCLI SHA256 mismatch: expected OfficeCLI 1.0.135 (Windows x64).')
}
console.log('Windows resources verified: OfficeCLI 1.0.135 SHA256 matches.')
