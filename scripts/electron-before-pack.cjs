'use strict'

// electron-builder calls beforeBuild before it packs, and a `false` return tells
// it that node_modules is already prepared outside of electron-builder. That
// makes electron-builder copy the installed tree verbatim through `files` instead
// of re-deriving a dependency tree with `node-dep-tree --flatten`.
//
// That re-derivation is what nested a hoisted package under the wrong parent and
// left it absent from app.asar's node_modules root, so root-level consumers threw
// ERR_MODULE_NOT_FOUND and the 0.8.7 portable and setup builds died during
// bootstrap with no window, no dialog and no log. Copying the tree npm actually
// installed keeps every hoisted dependency resolvable from the archive.
//
// This also skips electron-builder's dependency install/rebuild pass. In v26,
// npmRebuild: false would prevent this hook from running.
// Note: entry — see .agents/notes/desktop/packaged-hoisted-deps.md

async function beforeBuild() {
  return false
}

function beforePack({ packager }) {
  const { files } = packager.config
  if (files.some(entry => entry.from === 'node_modules')) return
  const appFilter = files.find(entry => entry.from == null && entry.to == null)?.filter
  if (!Array.isArray(appFilter)) throw new Error('Expected the default application file filter')
  const filter = ['**/*', '!**/*.d.ts']
  if (!packager.config.includePdb) filter.push('!**/*.pdb')
  for (const pattern of appFilter) {
    if (pattern.startsWith('!node_modules/')) {
      filter.push(`!${pattern.slice('!node_modules/'.length)}`)
    } else if (pattern.startsWith('!**/')) {
      filter.push(pattern)
      if (pattern.startsWith('!**/node_modules/')) {
        filter.push(`!${pattern.slice('!**/node_modules/'.length)}`)
      }
    }
  }
  // The v26 file walker always skips the top-level node_modules directory.
  files.push({ from: 'node_modules', to: 'node_modules', filter })
}

module.exports = beforeBuild
module.exports.beforeBuild = beforeBuild
module.exports.beforePack = beforePack
