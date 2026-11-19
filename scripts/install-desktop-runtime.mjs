// Note: development runtime setup — see .agents/notes/desktop/reproducible-verification.md
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const modules = new URL('../node_modules/', import.meta.url)
const electronInstaller = new URL('electron/install.js', modules)
if (existsSync(electronInstaller)) {
  execFileSync(process.execPath, [fileURLToPath(electronInstaller)], { stdio: 'inherit' })
}

if (process.platform === 'darwin') {
  // npm can extract the node-pty prebuild helper without its executable bit.
  const helper = new URL(`node-pty/prebuilds/darwin-${process.arch}/spawn-helper`, modules)
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
