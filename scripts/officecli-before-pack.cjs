'use strict'

// Note: .agents/notes/desktop/officecli-bundled.md
module.exports = async function beforePack(context) {
  const platform = context.electronPlatformName
  // Linux OfficeCLI support is not part of the bundled platform contract yet.
  if (platform !== 'win32' && platform !== 'darwin') return
  const { Arch } = require('builder-util')
  const { checkOfficecliResource } = await import('./officecli-resources.mjs')
  const resource = await checkOfficecliResource({
    platform, arch: Arch[context.arch], root: context.packager.projectDir,
  })
  if (platform === 'darwin') await require('node:fs/promises').chmod(resource.binary, 0o755)
}
