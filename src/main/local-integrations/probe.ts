import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { LocalIntegrationProbe } from '../../shared/local-integrations'
import { IntegrationError, mcpTransport, object } from './config'

function expand(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}|\{env:([A-Za-z_][\w]*)\}/g, (_match, name, fallback, otherName) => {
    const result = env[name || otherName] ?? fallback
    if (result === undefined) throw new IntegrationError('missing-env')
    return result
  })
}
/** This makes a disposable connection on explicit user action; it never reports a CLI session as connected. */
export async function probeMcp(config: Record<string, unknown>, cwd: string, env: NodeJS.ProcessEnv = process.env, timeoutMs = 10_000): Promise<LocalIntegrationProbe> {
  const started = Date.now(), client = new Client({ name: 'janusx-connection-check', version: '1.0.0' })
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = (state: LocalIntegrationProbe['state'], issue?: string, tools?: number): LocalIntegrationProbe => ({ state, issue, tools, checkedAt: new Date().toISOString(), durationMs: Date.now() - started })
  try {
    const type = mcpTransport(config)
    if (type === 'stdio') {
      const command = Array.isArray(config.command) ? config.command as string[] : [String(config.command), ...(Array.isArray(config.args) ? config.args as string[] : [])]
      const variables = { ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
      for (const [name, value] of Object.entries(object(config.env ?? config.environment ?? {}))) variables[name] = expand(String(value), env)
      transport = new StdioClientTransport({ command: expand(command[0], env), args: command.slice(1).map(value => expand(value, env)), env: variables, cwd, stderr: 'pipe' })
      transport.stderr?.on('data', () => {})
    } else {
      const url = new URL(expand(String(config.url), env))
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return result('unsupported', 'unsupported-probe')
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(object(config.http_headers ?? config.headers ?? {}))) headers[key] = expand(String(value), env)
      for (const [key, value] of Object.entries(object(config.env_http_headers ?? {}))) {
        if (!env[String(value)]) throw new IntegrationError('missing-env')
        headers[key] = env[String(value)]!
      }
      if (typeof config.bearer_token_env_var === 'string') {
        if (!env[config.bearer_token_env_var]) throw new IntegrationError('missing-env')
        headers.Authorization = `Bearer ${env[config.bearer_token_env_var]}`
      }
      transport = type === 'sse' ? new SSEClientTransport(url, { requestInit: { headers } }) : new StreamableHTTPClientTransport(url, { requestInit: { headers } })
    }
    const connection = (async () => {
      await client.connect(transport!)
      const tools = client.getServerCapabilities()?.tools ? (await client.listTools()).tools.length : 0
      return tools
    })()
    const tools = await Promise.race([connection, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new IntegrationError('timeout')), timeoutMs) })])
    return result('passed', undefined, tools)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // Return only stable codes: SDK errors and server stderr may contain credentials.
    const code = (error as { code?: unknown } | null)?.code
    return error instanceof UnauthorizedError || code === 401 || code === 403 || /401|403|unauthorized/i.test(message)
      ? result('needs-auth', 'needs-auth') : result('failed', error instanceof IntegrationError ? error.code : 'probe-failed')
  } finally {
    if (timer) clearTimeout(timer)
    // npx/cmd wrappers can leave a descendant running if only the wrapper is closed.
    if (process.platform === 'win32' && transport instanceof StdioClientTransport && transport.pid) {
      await promisify(execFile)('taskkill', ['/PID', String(transport.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }).catch(() => {})
    }
    await client.close().catch(() => {})
    await transport?.close().catch(() => {})
  }
}
