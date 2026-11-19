// Note: local dev prerequisites — see .agents/notes/desktop/reproducible-verification.md
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkDevEnvironment(root) {
  const modules = join(root, 'node_modules')
  const shim = process.platform === 'win32' ? '.cmd' : ''
  const missing = [
    'typescript/bin/tsc', `.bin/tsc${shim}`,
    'electron-vite/bin/electron-vite.js', `.bin/electron-vite${shim}`,
    'electron/cli.js',
  ].filter(path => !existsSync(join(modules, path)))
  if (missing.length) return [`Missing local development dependencies: ${missing.join(', ')}. Run npm ci --include=dev in ${root}.`]

  const issues = []
  try {
    const binary = readFileSync(join(modules, 'electron/path.txt'), 'utf8').trim()
    if (!binary || !existsSync(join(modules, 'electron/dist', binary))) throw new Error('missing binary')
  } catch {
    issues.push('Electron runtime is missing. Run npm run postinstall.')
  }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const name of Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@janus-agent/'))) {
    try {
      const directory = join(modules, name)
      const dependency = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (!dependency.main || !existsSync(join(directory, dependency.main))) throw new Error('missing build output')
    } catch {
      issues.push(`${name} has no installed build output. Run npm ci, then npm run prepackage to verify the pinned engine artifacts.`)
    }
  }
  return issues
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  try {
    const issues = checkDevEnvironment(root)
    if (issues.length) {
      console.error(`[dev] ${issues.join('\n[dev] ')}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`[dev] ${error.message}`)
    process.exitCode = 1
  }
}
