import { execFileSync } from 'node:child_process'
import { isIP } from 'node:net'

/** scutil prints nested (interface-scoped) dictionaries too. Only use the global settings. */
export function parseMacSystemProxy(output: string): NodeJS.ProcessEnv {
  const fields = new Map<string, string>()
  const exceptions: string[] = []
  let depth = 0
  let inExceptions = false
  for (const line of output.split('\n')) {
    const value = line.trim()
    if (value === '}') {
      depth--
      if (depth < 2) inExceptions = false
    } else if (value.endsWith('{')) {
      if (depth === 1) inExceptions = value === 'ExceptionsList : <array> {'
      depth++
    } else {
      const match = /^([^ ]+) : (.+)$/.exec(value)
      if (!match) continue
      if (depth === 1) fields.set(match[1]!, match[2]!)
      if (depth === 2 && inExceptions) exceptions.push(match[2]!)
    }
  }

  const settings: NodeJS.ProcessEnv = {}
  for (const protocol of ['HTTP', 'HTTPS']) {
    if (fields.get(protocol + 'Enable') !== '1') continue
    const raw = fields.get(protocol + 'Proxy') ?? ''
    const port = Number(fields.get(protocol + 'Port'))
    const host = raw.replace(/^\[([^\]]+)\]$/, '$1')
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue
    if (!/^[\w.-]+$/.test(host) && isIP(host) !== 6) continue
    // HTTPSProxy is an HTTP CONNECT endpoint for HTTPS destinations.
    settings[protocol + '_PROXY'] = `http://${isIP(host) === 6 ? '[' + host + ']' : host}:${port}`
  }
  if (settings.HTTP_PROXY || settings.HTTPS_PROXY) {
    // NO_PROXY has no portable equivalent for macOS's <local> (all simple hostnames).
    settings.NO_PROXY = [...new Set(['localhost', '127.0.0.1', '::1', ...exceptions.filter(x => x !== '<local>')])].join(',')
  }
  return settings
}

let cached: NodeJS.ProcessEnv = {}
let expires = 0
function readMacSystemProxy(): NodeJS.ProcessEnv {
  if (Date.now() >= expires) {
    try {
      cached = parseMacSystemProxy(execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: 1000, maxBuffer: 256 * 1024 }))
    } catch {
      cached = {}
    }
    expires = Date.now() + 1000
  }
  return cached
}

export function macProxyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return env
  // Keep explicit proxy routing intact, including different endpoints or a catch-all.
  if (['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'].some(key => env[key]?.trim())) return env
  const settings = readMacSystemProxy()
  if (!settings.NO_PROXY) return env
  const bypass = [...new Set([env.no_proxy, env.NO_PROXY, settings.NO_PROXY].flatMap(value => (value ?? '').split(/[\s,]+/)).filter(Boolean))].join(',')
  return { ...env, ...settings, NO_PROXY: bypass, no_proxy: bypass }
}
