// Release tooling uses the same verifier as installation, with no second format implementation.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { Module } from 'node:module'
import { resolve } from 'node:path'

let library
export async function distributionLibrary() {
  if (library) return library
  const result = await build({ entryPoints: ['src/main/plugins/distribution/package.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent', external: ['zod', 'semver', 'jsonc-parser'] })
  const filename = resolve('scripts/plugins/distribution.generated.cjs')
  const compiled = new Module(filename)
  compiled.filename = filename
  compiled.require = createRequire(filename)
  compiled._compile(result.outputFiles[0].text, filename)
  return library = compiled.exports
}
