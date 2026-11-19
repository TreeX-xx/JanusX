// Keeps electron-builder.yml's dev-only `files` negations in sync with the
// production dependency closure. The packaged archive copies node_modules
// verbatim (`beforeBuild` returns false), so a devDependency that is not negated
// lands in app.asar and app.asar.unpacked: electron-builder's own binaries,
// `electron`'s dist and the test toolchain were 612 MiB of a 301 MiB installer's
// 870 MiB payload.
// Note: entry — see .agents/notes/desktop/packaged-hoisted-deps.md
//
// Usage:
//   npm run exclusions:sync                  # rewrite the marked block in electron-builder.yml
//   npm run exclusions:check                 # fail when the committed block is stale
//   node scripts/sync-packaging-exclusions.mjs --print   # YAML lines only

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const configPath = join(root, 'electron-builder.yml')
const BACKSLASH = String.fromCharCode(92)
const MARKER = '/node_modules/'
const BEGIN = '  # --- BEGIN dev-only node_modules (generated: npm run exclusions:sync) ---'
const END = '  # --- END dev-only node_modules ---'

// `npm ls` exits non-zero on workspace file: dependencies even when it prints the
// whole tree, so the status is ignored and the printed tree is the only input.
// Windows resolves npm through the shell only, and Node flags that pairing as
// deprecated; the arguments here are constants, so the warning is filtered out
// rather than left in every packaging log.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
  if (`${warning}`.includes('shell option true')) return
  emitWarning(warning, ...rest)
}

const listed = spawnSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
  maxBuffer: 1 << 28,
})
const closure = new Set()
for (const line of (listed.stdout || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
  const normalized = line.split(BACKSLASH).join('/')
  const index = normalized.lastIndexOf(MARKER)
  if (index !== -1) closure.add(normalized.slice(index + MARKER.length))
}

const installed = []
for (const name of readdirSync(join(root, 'node_modules')).filter((entry) => !entry.startsWith('.'))) {
  if (!name.startsWith('@')) {
    installed.push(name)
    continue
  }
  for (const scoped of readdirSync(join(root, 'node_modules', name))) installed.push(`${name}/${scoped}`)
}

const topLevelOf = (installPath) => {
  const parts = installPath.split('/')
  return installPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}
const closureTopLevel = new Set([...closure].map(topLevelOf))

// A production dependency nested under a dev-only package cannot be pruned with
// its parent: the nested copy is the one Node resolves from inside the archive.
const blocked = [...closure]
  .filter((installPath) => installPath.includes('/') && !closureTopLevel.has(topLevelOf(installPath)))
  .map((installPath) => `  node_modules/${installPath}`)
if (blocked.length > 0) {
  console.error('Production dependencies sit under dev-only packages; excluding those parents')
  console.error('would drop them from the archive:')
  for (const entry of blocked) console.error(entry)
  process.exit(1)
}

// A scope whose every installed member is dev-only is negated as one directory.
// Anything narrower stays per-package, so a single production package inside a
// dev-only scope is never caught by a scope-wide negation.
// fsevents is excluded explicitly so its host-specific presence cannot change the list.
const devOnly = installed.filter((name) => !closureTopLevel.has(name) && name !== 'fsevents').sort()
const scopes = new Map()
for (const name of devOnly) {
  if (!name.startsWith('@')) continue
  const scope = name.slice(0, name.indexOf('/'))
  const members = scopes.get(scope) ?? []
  members.push(name)
  scopes.set(scope, members)
}
const collapsedScopes = new Set()
const negations = []
for (const [scope, members] of scopes) {
  if (installed.filter((name) => name.startsWith(`${scope}/`)).length === members.length) {
    negations.push(`  - "!node_modules/${scope}{,/**/*}"`)
    for (const member of members) collapsedScopes.add(member)
  }
}
for (const name of devOnly) if (!collapsedScopes.has(name)) negations.push(`  - "!node_modules/${name}{,/**/*}"`)
negations.sort()

const config = readFileSync(configPath, 'utf8')
const eol = config.includes('\r\n') ? '\r\n' : '\n'
const rows = config.split(/\r?\n/)
const begin = rows.findIndex((line) => line.trim() === BEGIN.trim())
const end = rows.findIndex((line) => line.trim() === END.trim())
if (begin === -1 || end === -1 || end < begin) {
  console.error(`electron-builder.yml is missing the generated block markers:\n  ${BEGIN}\n  ${END}`)
  process.exit(1)
}
const committed = rows.slice(begin + 1, end).filter((line) => line.trim() !== '')

if (process.argv.includes('--print')) {
  for (const line of negations) console.log(line)
} else if (process.argv.includes('--check')) {
  const stale = negations
    .filter((line) => !committed.includes(line))
    .concat(committed.filter((line) => !negations.includes(line)))
  if (stale.length > 0) {
    console.error(`electron-builder.yml dev-only negations are stale (${stale.length} differ). Run \`npm run exclusions:sync\`.`)
    for (const line of stale.slice(0, 20)) console.error(`  ${line}`)
    process.exit(1)
  }
  console.log(`Packaging exclusions verified: ${negations.length} negations match the production closure.`)
} else {
  writeFileSync(configPath, [...rows.slice(0, begin), BEGIN, ...negations, END, ...rows.slice(end + 1)].join(eol), 'utf8')
  console.log(`electron-builder.yml: ${negations.length} dev-only negations (was ${committed.length}).`)
}

// Independent confirmations that the three closure-reported exceptions stay
// excluded: monaco-editor ships as renderer assets, `electron` resolves to
// Electron's built-in module, and no installed copy of typescript is required at
// runtime by the two SDKs that declare it.
for (const [name, reason] of [
  ['monaco-editor', 'bundled into out/renderer'],
  ['electron', 'resolves to the Electron built-in module at runtime'],
  ['typescript', 'declared by the MCP and Lark SDKs, never required at runtime'],
]) {
  if (existsSync(join(root, 'node_modules', name, 'package.json')) && closureTopLevel.has(name)) {
    console.log(`note: ${name} is in the production closure and stays excluded — ${reason}`)
  }
}
