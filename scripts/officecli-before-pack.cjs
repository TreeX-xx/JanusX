'use strict'

// Note: .agents/notes/desktop/officecli-bundled.md
module.exports = async function beforePack(context) {
  require('./electron-before-pack.cjs').beforePack(context)
  const platform = context.electronPlatformName
  // Linux OfficeCLI support is not part of the bundled platform contract yet.
  if (platform !== 'win32' && platform !== 'darwin') return
  const { Arch } = require('builder-util')
  const { checkOfficecliResource } = await import('./officecli-resources.mjs')
  const resource = await checkOfficecliResource({
    platform, arch: Arch[context.arch], root: context.packager.projectDir,
  })
  if (platform === 'darwin') {
    // Note: .agents/notes/desktop/platform-runtime-boundaries.md (P7)
    const { checkMacNativeResources } = await import('./check-macos-resources.mjs')
    await checkMacNativeResources({ root: context.packager.projectDir, arch: Arch[context.arch] })
    const { chmod } = require('node:fs/promises')
    await chmod(resource.binary, 0o755)
    await chmod(require('node:path').join(context.packager.projectDir, 'node_modules/node-pty/prebuilds', `darwin-${Arch[context.arch]}`, 'spawn-helper'), 0o755)
  }
}
