// Note: local trust belongs only to this development build, never the production catalog.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import base from '../../electron.vite.config'

export default defineConfig(async env => {
  const root = resolve(process.cwd())
  const directory = resolve(process.env.JANUSX_CPA_LOCAL_DIRECTORY ?? resolve(root, '.cache/cpa-local'))
  const build = JSON.parse(readFileSync(resolve(directory, 'build.json'), 'utf8'))
  const config = typeof base === 'function' ? await base(env) : await base
  config.main ??= {}
  config.main.define = { ...config.main.define, __JANUSX_LOCAL_PLUGIN__: JSON.stringify(build) }
  config.main.resolve ??= {}
  const aliases = config.main.resolve.alias ?? {}
  const localTrust = { find: /^.*plugins\/catalog\/trust\.json$/, replacement: resolve(directory, 'trust.json') }
  config.main.resolve.alias = [localTrust, ...(Array.isArray(aliases) ? aliases : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement })))]
  return config
})
